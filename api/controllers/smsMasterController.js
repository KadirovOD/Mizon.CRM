// ========== SMS MASTER CONTROLLER (smsmaster.uz / RBSoft Gateway) ==========
//
// Bu — o'z Android telefoningizda ishlaydigan SMS shlyuz uchun API.
// Provider: smsmaster.uz (RB Soft SMS Gateway hostingi).
//
// Barcha endpoint'lar POST + application/x-www-form-urlencoded formatida ishlaydi:
//   POST /services/send.php               → SMS yuborish + balans
//   POST /services/read-messages.php      → status va matn olish
//   POST /services/get-devices.php        → ulangan telefonlar
//   POST /services/resend.php             → qayta yuborish
//
// Auth: har request'ga `key=<API_KEY>` (form maydonida).
// Response: { success: true, data: {...} }  yoki  { success: false, error: {message: "..."} }
//
// Webhook (kiruvchi SMS):
//   Mizon URL'imizga POST keladi, body'da `messages` JSON string maydoni bo'ladi.
//   Header: `X-SG-Signature` = base64(hmac_sha256(POST['messages'], API_KEY))
//   → HMAC tasdiqlash MAJBURIY (aks holda soxta SMS injektsiya qilinishi mumkin).

const https = require('https');
const crypto = require('crypto');

const SMS_MASTER_HOST = 'smsmaster.uz';

// ── Low-level HTTPS POST (form-urlencoded) ────────────────────────────────────
function smsMasterRaw(pathname, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const options = {
      hostname: SMS_MASTER_HOST,
      path:     pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch { /* not JSON */ }
        resolve({ statusCode: res.statusCode, body: chunks, parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── High-level: config'dan API key olib SMS yuborish ──────────────────────────
async function sendSms(cfg, phone, message) {
  if (!cfg?.smsmaster_api_key) return { ok: false, error: 'SMS Master API kaliti sozlanmagan' };

  const cleanPhone = String(phone).replace(/\s+/g, '');
  const params = {
    key:     cfg.smsmaster_api_key,
    number:  cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone.replace(/\D/g,'')}`,
    message: String(message || ''),
    type:    'sms',
    prioritize: 'false',
  };
  if (cfg.smsmaster_devices) params.devices = cfg.smsmaster_devices;
  if (cfg.smsmaster_use_random !== false) params.useRandomDevice = 'true';

  try {
    const raw = await smsMasterRaw('/services/send.php', params);
    if (raw.parsed?.success && raw.parsed?.data?.messages?.[0]) {
      const m = raw.parsed.data.messages[0];
      return { ok: true, msgId: m.ID || m.id || null, groupId: m.groupID || null, status: m.status || 'sent' };
    }
    const err = raw.parsed?.error?.message || raw.parsed?.message || `HTTP ${raw.statusCode}`;
    return { ok: false, error: `SMS Master: ${err}` };
  } catch (e) {
    return { ok: false, error: `SMS Master tarmoq xatosi: ${e.message}` };
  }
}

// ── Balans (kredit) ───────────────────────────────────────────────────────────
async function getBalance(apiKey) {
  const raw = await smsMasterRaw('/services/send.php', { key: apiKey });
  if (raw.parsed?.success) return raw.parsed.data;   // string yoki "Unlimited"
  throw new Error(raw.parsed?.error?.message || `HTTP ${raw.statusCode}`);
}

// ── Ulangan qurilmalar ────────────────────────────────────────────────────────
async function getDevices(apiKey) {
  const raw = await smsMasterRaw('/services/get-devices.php', { key: apiKey });
  if (raw.parsed?.success) return raw.parsed.data?.devices || [];
  throw new Error(raw.parsed?.error?.message || `HTTP ${raw.statusCode}`);
}

// ── HMAC signature tekshirish (webhook uchun) ────────────────────────────────
function verifySignature(rawMessagesString, apiKey, header) {
  if (!rawMessagesString || !apiKey || !header) return false;
  const expected = crypto.createHmac('sha256', apiKey).update(rawMessagesString).digest('base64');
  // Timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// =============================================================================
//  HTTP ENDPOINTS
// =============================================================================

// GET /api/sms-master/balance
exports.getBalance = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  try {
    const r = await req.db.query('SELECT smsmaster_api_key FROM automation_sms_settings WHERE company_id=$1', [cid]);
    const key = r.rows[0]?.smsmaster_api_key;
    if (!key) return res.status(400).json({ error: 'API kalit sozlanmagan' });
    const balance = await getBalance(key);
    res.json({ balance });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /api/sms-master/devices
exports.getDevices = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  try {
    const r = await req.db.query('SELECT smsmaster_api_key FROM automation_sms_settings WHERE company_id=$1', [cid]);
    const key = r.rows[0]?.smsmaster_api_key;
    if (!key) return res.status(400).json({ error: 'API kalit sozlanmagan' });
    const devices = await getDevices(key);
    res.json({ devices });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/sms-master/test  { phone?, message? }
exports.testSend = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  const { phone, message } = req.body || {};
  try {
    const r = await req.db.query(
      'SELECT smsmaster_api_key, smsmaster_devices, smsmaster_use_random FROM automation_sms_settings WHERE company_id=$1',
      [cid]
    );
    if (!r.rows.length || !r.rows[0].smsmaster_api_key) {
      return res.status(400).json({ error: 'SMS Master sozlanmagan' });
    }
    // Faqat konfiguratsiyani tekshirish uchun (phone bo'lmasa) — balans so'rov qilamiz
    if (!phone) {
      const balance = await getBalance(r.rows[0].smsmaster_api_key);
      return res.json({ success: true, message: `SMS Master ga ulandi. Balans: ${balance}` });
    }
    const result = await sendSms(r.rows[0], phone, message || 'Test SMS from Mizon CRM');
    if (result.ok) res.json({ success: true, msgId: result.msgId });
    else res.status(400).json({ success: false, error: result.error });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/webhook/smsmaster — kiruvchi SMS
//   Content-Type: application/x-www-form-urlencoded
//   Body: messages=<JSON string massiv>
//   Header: X-SG-Signature: <base64 HMAC-SHA256(messages, API_KEY)>
exports.handleWebhook = async (req, res) => {
  try {
    const messagesRaw = req.body?.messages;
    if (!messagesRaw || typeof messagesRaw !== 'string') {
      console.log('[smsmaster] webhook: no messages field');
      return res.sendStatus(400);
    }

    if (!req.db) return res.sendStatus(200);

    // Qaysi kompaniya? — company_id query'da yoki header'da bo'lishi kerak
    // (webhook URL ni sozlaganda ?company_id=<id> qo'shib qo'yamiz)
    let companyId = parseInt(req.query.company_id || req.headers['x-mizon-company'] || '', 10);
    if (!companyId || isNaN(companyId)) {
      const cfg = await req.db.query(
        "SELECT company_id FROM automation_sms_settings WHERE provider='smsmaster' AND smsmaster_api_key IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
      );
      companyId = cfg.rows[0]?.company_id || null;
    }
    if (!companyId) {
      console.log('[smsmaster] webhook: no company match');
      return res.sendStatus(200);
    }

    const cfgR = await req.db.query(
      'SELECT smsmaster_api_key FROM automation_sms_settings WHERE company_id=$1',
      [companyId]
    );
    const apiKey = cfgR.rows[0]?.smsmaster_api_key;
    if (!apiKey) {
      console.log(`[smsmaster] webhook: no api key for company ${companyId}`);
      return res.sendStatus(200);
    }

    // HMAC signature tekshirish
    const sig = req.headers['x-sg-signature'] || req.headers['x_sg_signature'];
    const sigOk = verifySignature(messagesRaw, apiKey, sig);
    if (!sigOk) {
      console.warn(`[smsmaster] webhook: HMAC mismatch (company ${companyId}, sig=${sig?.slice(0,10) || 'none'})`);
      return res.status(401).json({ error: 'signature mismatch' });
    }

    let messages;
    try { messages = JSON.parse(messagesRaw); }
    catch { return res.status(400).json({ error: 'invalid messages JSON' }); }
    if (!Array.isArray(messages)) messages = [messages];

    for (const m of messages) {
      const smsId = String(m.ID || m.id || '');
      if (smsId) {
        try {
          const ins = await req.db.query(
            'INSERT INTO sms_master_events (sms_id, company_id) VALUES ($1,$2) ON CONFLICT (sms_id) DO NOTHING RETURNING sms_id',
            [smsId, companyId]
          );
          if (!ins.rows.length) { console.log(`[smsmaster] duplicate sms ignored: ${smsId}`); continue; }
        } catch (e) { console.warn('[smsmaster] idempotency insert failed:', e.message); }
      }

      const phoneRaw = m.number || m.from || m.sender || '';
      const text     = m.message || '';
      const clean    = String(phoneRaw).replace(/\D/g, '');

      if (!clean) { console.log('[smsmaster] webhook message has no phone, skipping'); continue; }

      // Tegishli lead topish
      const leadQ = await req.db.query(
        "SELECT id, chatlogs FROM crm_lead WHERE REGEXP_REPLACE(phone, '\\D', '', 'g')=$1 AND company_id=$2 LIMIT 1",
        [clean, companyId]
      );

      const smsLog = {
        type:      'sms',
        direction: 'in',
        date:      new Date().toISOString(),
        text:      `💬 SMS: ${text}`,
        phone:     `+${clean}`,
        message:   text,
        sms_id:    smsId || null,
        device_id: m.deviceID || null,
        sim_slot:  m.simSlot ?? null,
        sent_at:   m.sentDate || null,
      };

      if (leadQ.rows.length > 0) {
        const lead = leadQ.rows[0];
        const logs = lead.chatlogs || [];
        logs.push(smsLog);
        await req.db.query(
          'UPDATE crm_lead SET chatlogs=$1 WHERE id=$2 AND company_id=$3',
          [JSON.stringify(logs), lead.id, companyId]
        );
        console.log(`💬 SMS Master → lead #${lead.id} (+${clean}): ${text.slice(0, 60)}`);
      } else {
        // Noma'lum raqamdan kelgan SMS — yangi lid yaratish
        try {
          const stageRes = await req.db.query(
            'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence LIMIT 1',
            [companyId]
          );
          const stageId = stageRes.rows[0]?.id || null;
          const ins = await req.db.query(
            `INSERT INTO crm_lead (name, phone, mizon_source, lead_score, stage_id, actualcallattempts, chatlogs, company_id)
             VALUES ($1,$2,'smsmaster',20,$3,0,$4,$5) RETURNING id`,
            [`SMS (+${clean})`, `+${clean}`, stageId, JSON.stringify([smsLog]), companyId]
          );
          console.log(`📌 New lead from incoming SMS: +${clean} (id=${ins.rows[0]?.id})`);
        } catch (e) {
          console.error(`[smsmaster] LEAD INSERT FAILED for +${clean}:`, e.message);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('SMS Master webhook error:', err.message, err.stack);
    res.sendStatus(500);
  }
};

// Modul ichidan avtomatizatsiya sendSms() uchun eksport
module.exports.sendSms = sendSms;
module.exports.getBalance = getBalance;
module.exports.getDevices = getDevices;
module.exports.verifySignature = verifySignature;
