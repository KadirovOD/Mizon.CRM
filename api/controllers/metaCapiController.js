// ========== META CONVERSIONS API (CAPI) CONTROLLER ==========
// Pixel-level CAPI integratsiyasi. App Review talab qilmaydi — Events Manager'dan olinadigan token bilan ishlaydi.
//
// Saqlash: crm_integration_config (platform='meta_capi')
//   - page_id     → Pixel ID
//   - access_token → CAPI Access Token (Events Manager → Pixel → Settings → Generate)
//   - extra_config → { test_event_code, api_version, event_mapping: { won: 'Purchase', lost: 'Lead' } }
//
// API:
//   GET    /api/integrations/meta-capi          — joriy sozlamani olish (token maskirovkalanadi)
//   PUT    /api/integrations/meta-capi          — yangi sozlamani saqlash (yoki yangilash)
//   POST   /api/integrations/meta-capi/test     — test event yuborish (diagnostika)
//   POST   /api/integrations/meta-capi/send     — qo'lda event yuborish (server-tomondan automation uchun)

const https = require('https');
const crypto = require('crypto');

const PLATFORM = 'meta_capi';
const DEFAULT_API_VERSION = 'v18.0';

// SHA-256 hash — Meta PII normalizatsiyasi: lowercase + trim
function sha256(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Telefon raqamini xeshlashga tayyorlash — faqat raqamlar
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  return sha256(digits);
}

// Meta CAPI POST helper — Promise qaytaradi
function postCapi(apiVersion, pixelId, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: 'graph.facebook.com',
      path: `/${apiVersion}/${pixelId}/events`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (resp) => {
      let chunks = '';
      resp.on('data', (c) => (chunks += c));
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          resolve({ status: resp.statusCode, body: parsed });
        } catch {
          resolve({ status: resp.statusCode, body: { raw: chunks } });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// DBdan joriy CAPI konfiguratsiyasini olish
async function loadConfig(db, companyId) {
  if (!db) return null;
  const r = await db.query(
    `SELECT id, page_id, access_token, extra_config, created_at
       FROM crm_integration_config
      WHERE platform=$1 AND company_id=$2
      LIMIT 1`,
    [PLATFORM, companyId]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const extra = row.extra_config || {};
  return {
    id: row.id,
    pixel_id: row.page_id,
    access_token: row.access_token,
    test_event_code: extra.test_event_code || null,
    api_version: extra.api_version || DEFAULT_API_VERSION,
    event_mapping: extra.event_mapping || { lead_created: 'Lead', won: 'Purchase' },
    created_at: row.created_at,
  };
}

// Tokenni maskirovkalash — frontendga to'liq token yubormaslik
function maskToken(token) {
  if (!token) return null;
  if (token.length < 12) return '***';
  return token.slice(0, 6) + '...' + token.slice(-4);
}

// ── GET /api/integrations/meta-capi ────────────────────────────────────────
exports.getConfig = async (req, res) => {
  if (!req.db) return res.json({ configured: false });
  try {
    const cfg = await loadConfig(req.db, req.user?.companyId);
    if (!cfg) return res.json({ configured: false });
    res.json({
      configured: true,
      pixel_id: cfg.pixel_id,
      access_token_masked: maskToken(cfg.access_token),
      test_event_code: cfg.test_event_code,
      api_version: cfg.api_version,
      event_mapping: cfg.event_mapping,
      created_at: cfg.created_at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── PUT /api/integrations/meta-capi ────────────────────────────────────────
exports.saveConfig = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  const cid = req.user?.companyId;
  const { pixel_id, access_token, test_event_code, api_version, event_mapping } = req.body || {};

  if (!pixel_id || !String(pixel_id).trim()) {
    return res.status(400).json({ error: 'Pixel ID majburiy' });
  }
  if (!access_token || !String(access_token).trim()) {
    return res.status(400).json({ error: 'Access Token majburiy' });
  }

  try {
    const extra = {
      test_event_code: test_event_code || null,
      api_version: api_version || DEFAULT_API_VERSION,
      event_mapping: event_mapping || { lead_created: 'Lead', won: 'Purchase' },
    };
    // Bitta kompaniyada faqat bitta CAPI sozlama bo'ladi — eskisini o'chirib qaytadan qo'yamiz
    await req.db.query(
      'DELETE FROM crm_integration_config WHERE platform=$1 AND company_id=$2',
      [PLATFORM, cid]
    );
    const r = await req.db.query(
      `INSERT INTO crm_integration_config
         (platform, page_id, access_token, extra_config, company_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [PLATFORM, String(pixel_id).trim(), String(access_token).trim(), JSON.stringify(extra), cid]
    );
    res.json({ success: true, id: r.rows[0].id, created_at: r.rows[0].created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── DELETE /api/integrations/meta-capi ────────────────────────────────────
exports.deleteConfig = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  try {
    await req.db.query(
      'DELETE FROM crm_integration_config WHERE platform=$1 AND company_id=$2',
      [PLATFORM, req.user?.companyId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── POST /api/integrations/meta-capi/test ─────────────────────────────────
// Diagnostika: hozirgi konfiguratsiya bilan test "Lead" event yuboradi
exports.testEvent = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  try {
    const cfg = await loadConfig(req.db, req.user?.companyId);
    if (!cfg) return res.status(400).json({ error: 'Avval Meta CAPI sozlamasini saqlang' });
    const { email, phone, event_name } = req.body || {};

    const userData = {};
    const hashedEmail = email ? sha256(email) : sha256('test@mizon-crm.uz');
    const hashedPhone = phone ? normalizePhone(phone) : normalizePhone('+998901234567');
    if (hashedEmail) userData.em = [hashedEmail];
    if (hashedPhone) userData.ph = [hashedPhone];
    userData.client_user_agent = req.headers['user-agent'] || 'Mizon-CRM/1.0';
    // Server-side IP (cf-connecting-ip yoki x-forwarded-for)
    const ip = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').split(',')[0].trim();
    if (ip) userData.client_ip_address = ip;

    const payload = {
      data: [
        {
          event_name: event_name || 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: `mizon_test_${Date.now()}`,
          action_source: 'system_generated',
          user_data: userData,
          custom_data: {
            currency: 'UZS',
            value: 0,
            content_name: 'Mizon CRM Test Event',
          },
        },
      ],
      access_token: cfg.access_token,
    };
    if (cfg.test_event_code) payload.test_event_code = cfg.test_event_code;

    const resp = await postCapi(cfg.api_version, cfg.pixel_id, payload);
    if (resp.status >= 200 && resp.status < 300 && resp.body?.events_received) {
      return res.json({
        success: true,
        events_received: resp.body.events_received,
        messages: resp.body.messages || [],
        fbtrace_id: resp.body.fbtrace_id,
        test_event_code: cfg.test_event_code,
      });
    }
    return res.status(400).json({
      success: false,
      error: resp.body?.error?.message || resp.body?.error || 'Meta API xato qaytardi',
      details: resp.body,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── POST /api/integrations/meta-capi/send ──────────────────────────────────
// Server-tomondan event yuborish (automation / webhook trigger uchun)
// Body: { event_name, lead: { name, email, phone, id }, value, currency, event_id? }
exports.sendEvent = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  try {
    const cfg = await loadConfig(req.db, req.user?.companyId);
    if (!cfg) return res.status(400).json({ error: 'Meta CAPI sozlanmagan' });
    const { event_name, lead, value, currency, event_id } = req.body || {};
    if (!event_name) return res.status(400).json({ error: 'event_name majburiy' });

    const userData = {};
    if (lead?.email) userData.em = [sha256(lead.email)];
    if (lead?.phone) { const p = normalizePhone(lead.phone); if (p) userData.ph = [p]; }
    if (lead?.name) {
      const parts = String(lead.name).split(/\s+/);
      if (parts[0]) userData.fn = [sha256(parts[0])];
      if (parts[1]) userData.ln = [sha256(parts.slice(1).join(' '))];
    }
    userData.client_user_agent = req.headers['user-agent'] || 'Mizon-CRM/1.0';

    const payload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id: event_id || `mizon_lead_${lead?.id || Date.now()}`,
          action_source: 'system_generated',
          user_data: userData,
          custom_data: {
            currency: currency || 'UZS',
            value: Number(value) || 0,
          },
        },
      ],
      access_token: cfg.access_token,
    };
    if (cfg.test_event_code) payload.test_event_code = cfg.test_event_code;

    const resp = await postCapi(cfg.api_version, cfg.pixel_id, payload);
    const ok = resp.status >= 200 && resp.status < 300 && resp.body?.events_received;
    res.status(ok ? 200 : 400).json({
      success: !!ok,
      events_received: resp.body?.events_received || 0,
      error: ok ? null : (resp.body?.error?.message || 'Meta xato qaytardi'),
      details: resp.body,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Internal helper — boshqa kontrollerlardan chaqirish uchun (masalan automation)
exports._send = async (db, companyId, eventName, leadObj, opts = {}) => {
  const cfg = await loadConfig(db, companyId);
  if (!cfg) return { skipped: true, reason: 'not_configured' };
  const userData = {};
  if (leadObj?.email) userData.em = [sha256(leadObj.email)];
  if (leadObj?.phone) { const p = normalizePhone(leadObj.phone); if (p) userData.ph = [p]; }
  if (leadObj?.name) {
    const parts = String(leadObj.name).split(/\s+/);
    if (parts[0]) userData.fn = [sha256(parts[0])];
    if (parts[1]) userData.ln = [sha256(parts.slice(1).join(' '))];
  }
  userData.client_user_agent = 'Mizon-CRM/1.0';
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: opts.event_id || `mizon_lead_${leadObj?.id || Date.now()}`,
        action_source: 'system_generated',
        user_data: userData,
        custom_data: {
          currency: opts.currency || 'UZS',
          value: Number(opts.value) || 0,
        },
      },
    ],
    access_token: cfg.access_token,
  };
  if (cfg.test_event_code) payload.test_event_code = cfg.test_event_code;
  try {
    const resp = await postCapi(cfg.api_version, cfg.pixel_id, payload);
    return { success: !!resp.body?.events_received, status: resp.status, body: resp.body };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
