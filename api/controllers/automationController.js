// ========== AUTOMATION CONTROLLER ==========
// Eskiz.uz SMS + qoidalar + shablonlar + loglar

const https = require('https');

// ── Eskiz.uz token cache ──────────────────────────────────────────────────────
const _eskizCache = new Map(); // companyId → { token, expiresAt }

async function eskizRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: { raw: body } }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getEskizToken(db, companyId) {
  const cached = _eskizCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const r = await db.query(
    'SELECT eskiz_email, eskiz_password FROM automation_sms_settings WHERE company_id=$1',
    [companyId]
  );
  if (!r.rows.length || !r.rows[0].eskiz_email) return null;

  const { eskiz_email, eskiz_password } = r.rows[0];
  const res = await eskizRequest('https://notify.eskiz.uz/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: eskiz_email, password: eskiz_password }),
  });

  if (res.data?.data?.token) {
    const token = res.data.data.token;
    _eskizCache.set(companyId, { token, expiresAt: Date.now() + 25 * 60 * 60 * 1000 });
    return token;
  }
  return null;
}

// ── Template o'zgaruvchilarini almashtirish ───────────────────────────────────
function fillTemplate(text, lead, stageName = '') {
  return text
    .replace(/\{ism\}/gi,      lead.name         || '')
    .replace(/\{telefon\}/gi,  lead.phone        || '')
    .replace(/\{menejer\}/gi,  lead.owner        || '')
    .replace(/\{bosqich\}/gi,  stageName         || '')
    .replace(/\{region\}/gi,   lead.region       || '')
    .replace(/\{sana\}/gi,     new Date().toLocaleDateString('uz-UZ'));
}

// ── SMS yuborish ──────────────────────────────────────────────────────────────
async function sendSms(db, companyId, phone, message) {
  const token = await getEskizToken(db, companyId);
  if (!token) return { ok: false, error: 'Eskiz token olishda xato (login/parol tekshiring)' };

  const cleanPhone = phone.replace(/\D/g, '');
  const res = await eskizRequest('https://notify.eskiz.uz/api/message/sms/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ mobile_phone: cleanPhone, message, from: '4546' }),
  });

  if (res.status === 200 && res.data?.status === 'waiting') {
    return { ok: true, msgId: res.data?.id };
  }
  return { ok: false, error: JSON.stringify(res.data) };
}

// ── Instagram / Facebook Messenger javob yuborish (Graph API) ─────────────────
async function sendGraphReply(db, companyId, platform, recipientId, message) {
  try {
    // Integrations jadvalidan access_token olish
    const r = await db.query(
      "SELECT access_token FROM crm_integration_config WHERE platform=$1 AND company_id=$2 ORDER BY id DESC LIMIT 1",
      [platform, companyId]
    );
    const token = r.rows[0]?.access_token || process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) return { ok: false, error: 'Access token topilmadi' };

    const res = await eskizRequest('https://graph.facebook.com/v19.0/me/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message:   { text: message },
        messaging_type: 'RESPONSE',
      }),
    });

    if (res.data?.message_id || res.data?.recipient_id) {
      return { ok: true };
    }
    return { ok: false, error: JSON.stringify(res.data) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Trigger: lead voqeasi sodir bo'lganda qoidalarni ishlatish ────────────────
exports.runTrigger = async (db, triggerType, lead, extra = {}) => {
  if (!db) return;
  try {
    const companyId = lead.company_id;
    const { rows: rules } = await db.query(
      `SELECT ar.*, at2.message as template_msg
       FROM automation_rules ar
       LEFT JOIN automation_templates at2 ON ar.template_id = at2.id
       WHERE ar.company_id=$1 AND ar.trigger_type=$2 AND ar.is_active=true`,
      [companyId, triggerType]
    );
    if (!rules.length) return;

    for (const rule of rules) {
      // Stage filter
      if (rule.stage_filter && extra.stageId && String(rule.stage_filter) !== String(extra.stageId)) continue;

      const stageName  = extra.stageName || '';
      const actionType = rule.action_type || 'sms';
      const msg = fillTemplate(rule.template_msg || '', lead, stageName);
      if (!msg.trim()) continue;

      // IG / FB javob
      if (actionType === 'ig_reply' || actionType === 'fb_reply') {
        const platform   = actionType === 'ig_reply' ? 'instagram' : 'facebook';
        const recipientId = extra.senderId;
        if (!recipientId) continue;

        const result = await sendGraphReply(db, companyId, platform, recipientId, msg);
        await db.query(
          `INSERT INTO automation_logs (company_id, rule_id, lead_id, lead_name, phone, message, status, error_msg)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, rule.id, lead.id, lead.name||'', recipientId, msg,
           result.ok ? 'sent' : 'failed', result.ok ? null : result.error]
        );
        continue;
      }

      // SMS (default)
      const phone = lead.phone;
      if (!phone) continue;

      const result = await sendSms(db, companyId, phone, msg);

      // Log yozish
      await db.query(
        `INSERT INTO automation_logs (company_id, rule_id, lead_id, lead_name, phone, message, status, error_msg)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          companyId, rule.id, lead.id, lead.name || '',
          phone, msg,
          result.ok ? 'sent' : 'failed',
          result.ok ? null : result.error
        ]
      );
    }
  } catch (e) {
    console.error('runTrigger error:', e.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
//  HTTP ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// ── SMS Settings ──────────────────────────────────────────────────────────────

// GET /api/automation/sms-settings
exports.getSmsSettings = async (req, res) => {
  if (!req.db) return res.json({ eskiz_email: '', hasPassword: false });
  const cid = req.user?.companyId;
  try {
    const r = await req.db.query('SELECT eskiz_email FROM automation_sms_settings WHERE company_id=$1', [cid]);
    res.json(r.rows[0] || { eskiz_email: '', hasPassword: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/automation/sms-settings
exports.saveSmsSettings = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  const { eskiz_email, eskiz_password } = req.body;
  if (!eskiz_email || !eskiz_password) return res.status(400).json({ error: 'Email va parol majburiy' });
  try {
    await req.db.query(
      `INSERT INTO automation_sms_settings (company_id, eskiz_email, eskiz_password)
       VALUES ($1,$2,$3)
       ON CONFLICT (company_id) DO UPDATE SET eskiz_email=$2, eskiz_password=$3`,
      [cid, eskiz_email, eskiz_password]
    );
    _eskizCache.delete(cid); // token cache ni tozalash
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/automation/sms-settings/test
exports.testSmsSettings = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  try {
    _eskizCache.delete(cid);
    const token = await getEskizToken(req.db, cid);
    if (token) res.json({ success: true, message: 'Eskiz.uz ga muvaffaqiyatli ulandi!' });
    else res.status(400).json({ success: false, error: 'Login/parol noto\'g\'ri yoki Eskiz hisobi faol emas' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── Templates ─────────────────────────────────────────────────────────────────

// GET /api/automation/templates
exports.getTemplates = async (req, res) => {
  if (!req.db) return res.json([]);
  const cid = req.user?.companyId;
  try {
    const r = await req.db.query('SELECT * FROM automation_templates WHERE company_id=$1 ORDER BY id DESC', [cid]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/automation/templates
exports.createTemplate = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'Nom va xabar majburiy' });
  try {
    const r = await req.db.query(
      'INSERT INTO automation_templates (company_id, name, message) VALUES ($1,$2,$3) RETURNING *',
      [cid, name, message]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// PUT /api/automation/templates/:id
exports.updateTemplate = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  const { name, message } = req.body;
  try {
    const r = await req.db.query(
      'UPDATE automation_templates SET name=COALESCE($1,name), message=COALESCE($2,message) WHERE id=$3 AND company_id=$4 RETURNING *',
      [name||null, message||null, req.params.id, cid]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// DELETE /api/automation/templates/:id
exports.deleteTemplate = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  try {
    await req.db.query('DELETE FROM automation_templates WHERE id=$1 AND company_id=$2', [req.params.id, cid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── Rules ─────────────────────────────────────────────────────────────────────

// GET /api/automation/rules
exports.getRules = async (req, res) => {
  if (!req.db) return res.json([]);
  const cid = req.user?.companyId;
  try {
    const r = await req.db.query(
      `SELECT ar.*, at2.name as template_name
       FROM automation_rules ar
       LEFT JOIN automation_templates at2 ON ar.template_id = at2.id
       WHERE ar.company_id=$1 ORDER BY ar.id DESC`,
      [cid]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/automation/rules
exports.createRule = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  const { name, trigger_type, template_id, stage_filter, action_type } = req.body;
  if (!name || !trigger_type || !template_id) return res.status(400).json({ error: 'Nom, trigger va shablon majburiy' });
  try {
    const r = await req.db.query(
      'INSERT INTO automation_rules (company_id, name, trigger_type, template_id, stage_filter, action_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [cid, name, trigger_type, template_id, stage_filter||null, action_type||'sms']
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// PUT /api/automation/rules/:id
exports.updateRule = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  const { name, trigger_type, template_id, stage_filter, is_active, action_type } = req.body;
  try {
    const r = await req.db.query(
      `UPDATE automation_rules
       SET name=COALESCE($1,name), trigger_type=COALESCE($2,trigger_type),
           template_id=COALESCE($3,template_id), stage_filter=$4,
           is_active=COALESCE($5,is_active), action_type=COALESCE($6,action_type)
       WHERE id=$7 AND company_id=$8 RETURNING *`,
      [name||null, trigger_type||null, template_id||null, stage_filter||null, is_active??null, action_type||null, req.params.id, cid]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// DELETE /api/automation/rules/:id
exports.deleteRule = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB not configured' });
  const cid = req.user?.companyId;
  try {
    await req.db.query('DELETE FROM automation_rules WHERE id=$1 AND company_id=$2', [req.params.id, cid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── Logs ──────────────────────────────────────────────────────────────────────

// GET /api/automation/logs
exports.getLogs = async (req, res) => {
  if (!req.db) return res.json([]);
  const cid = req.user?.companyId;
  const limit = Math.min(parseInt(req.query.limit)||100, 500);
  try {
    const r = await req.db.query(
      `SELECT al.*, ar.name as rule_name
       FROM automation_logs al
       LEFT JOIN automation_rules ar ON al.rule_id = ar.id
       WHERE al.company_id=$1
       ORDER BY al.created_at DESC LIMIT $2`,
      [cid, limit]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};
