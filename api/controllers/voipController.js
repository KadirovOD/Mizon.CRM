// ========== VOIP CONTROLLER (Moi Zvonki / МойЗвонки) ==========
const https = require('https');

// ── In-memory call event queue (per company) ──────────────────────────────────
// Key: String(companyId)  →  [{id, type, phone, lead_id, lead_name, is_new_lead, date}]
const _callEvents = new Map();
const QUEUE_MAX   = 30; // har kompaniya uchun maksimal yozuv

function _pushEvent(companyId, event) {
  const key = String(companyId || 'default');
  const arr  = _callEvents.get(key) || [];
  arr.push({ ...event, id: `ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}` });
  _callEvents.set(key, arr.slice(-QUEUE_MAX)); // eski yozuvlarni chiqarib tashlash
}

// GET /api/calls/recent — frontend polling uchun (o'qigandan keyin tozalanadi)
exports.getRecentEvents = (req, res) => {
  const key    = String(req.user?.companyId || 'default');
  const events = _callEvents.get(key) || [];
  _callEvents.set(key, []); // bir marta o'qilsa — tozalash
  res.json({ events });
};

// GET /api/voip/config — return config (without secret token)
exports.getConfig = async (req, res) => {
  if (!req.db) return res.json({ configured: false });
  const cid = req.user?.companyId;
  try {
    const result = await req.db.query(
      "SELECT account_id, caller_id, domain, created_at FROM crm_voip_config WHERE company_id=$1 ORDER BY id DESC LIMIT 1",
      [cid]
    );
    if (result.rows.length === 0) return res.json({ configured: false });
    res.json({ configured: true, ...result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/voip/config — save Moi Zvonki credentials
exports.saveConfig = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  const { account_id, api_token, caller_id, domain } = req.body;
  if (!account_id || !api_token) {
    return res.status(400).json({ error: 'account_id va api_token majburiy' });
  }
  try {
    await req.db.query('DELETE FROM crm_voip_config WHERE company_id=$1', [cid]);
    await req.db.query(
      'INSERT INTO crm_voip_config (account_id, api_token, caller_id, domain, company_id) VALUES ($1,$2,$3,$4,$5)',
      [account_id, api_token, caller_id || '', domain || 'app.moizvonki.ru', cid]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/call — Click-to-call via Moi Zvonki API
exports.initiateCall = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  const { phone, lead_id, operator_phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone majburiy' });
  try {
    const cfg = await req.db.query(
      'SELECT * FROM crm_voip_config WHERE company_id=$1 LIMIT 1',
      [cid]
    );
    if (cfg.rows.length === 0) return res.status(400).json({ error: 'Moi Zvonki sozlanmagan' });

    const { account_id, api_token, caller_id, domain } = cfg.rows[0];
    const from = operator_phone || caller_id;

    const callResult = await moiZvonkiCall(domain, account_id, api_token, from, phone);

    // Log call attempt to lead's chatlogs
    if (lead_id && req.db) {
      const lead = await req.db.query(
        'SELECT id, chatlogs, actualcallattempts FROM crm_lead WHERE id=$1 AND company_id=$2',
        [lead_id, cid]
      );
      if (lead.rows.length > 0) {
        const logs = lead.rows[0].chatlogs || [];
        const attempts = (lead.rows[0].actualcallattempts || 0) + 1;
        logs.push({
          type: 'call',
          date: new Date().toISOString(),
          text: `📞 Moi Zvonki orqali chiquvchi qo'ng'iroq: ${from} → ${phone}`,
          call_id: callResult.call_id || null
        });
        await req.db.query(
          'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3 AND company_id=$4',
          [JSON.stringify(logs), attempts, lead_id, cid]
        );
      }
    }

    res.json({ success: true, call_id: callResult.call_id });
  } catch (e) {
    console.error('Call initiate error:', e.message);
    res.status(500).json({ error: e.message });
  }
};

// POST /api/webhook/moizvonki — Receive call events from Moi Zvonki
exports.handleWebhook = async (req, res) => {
  try {
    const event = req.body;
    console.log('📞 Moi Zvonki event:', JSON.stringify(event));

    if (!req.db) return res.sendStatus(200);

    const callType  = event.call_type || event.type || '';
    const phone     = event.client_number || event.phone || event.caller_number || '';
    const callId    = event.call_id || event.id || '';
    const duration  = event.duration || 0;
    const status    = event.disposition || event.call_result || callType;
    const recordUrl = event.record_url || event.recording || null;

    if (!phone) return res.sendStatus(200);

    // Kompaniyani VoIP konfiguratsiyasidan aniqlash
    const cfgR = await req.db.query('SELECT company_id FROM crm_voip_config ORDER BY id DESC LIMIT 1');
    const companyId = cfgR.rows[0]?.company_id || null;

    const cleanPhone = phone.replace(/\D/g, '');
    const lead = await req.db.query(
      companyId
        ? "SELECT id, chatlogs, actualcallattempts FROM crm_lead WHERE REGEXP_REPLACE(phone, '\\D', '', 'g')=$1 AND company_id=$2 LIMIT 1"
        : "SELECT id, chatlogs, actualcallattempts FROM crm_lead WHERE REGEXP_REPLACE(phone, '\\D', '', 'g')=$1 LIMIT 1",
      companyId ? [cleanPhone, companyId] : [cleanPhone]
    );

    let logText = buildCallLogText(callType, phone, duration, status, recordUrl);

    if (lead.rows.length > 0) {
      const existingLogs = lead.rows[0].chatlogs || [];
      const attempts     = (lead.rows[0].actualcallattempts || 0) + 1;
      existingLogs.push({
        type: 'call', date: new Date().toISOString(),
        text: logText, call_id: callId, duration, record_url: recordUrl,
        direction: isIncomingCall(callType) ? 'in' : 'out',
      });
      await req.db.query(
        companyId
          ? 'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3 AND company_id=$4'
          : 'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3',
        companyId
          ? [JSON.stringify(existingLogs), attempts, lead.rows[0].id, companyId]
          : [JSON.stringify(existingLogs), attempts, lead.rows[0].id]
      );
      console.log(`📞 Call logged to lead #${lead.rows[0].id}: ${logText}`);

      // Kiruvchi qo'ng'iroq hodisasini queue ga qo'shish
      if (isIncomingCall(callType)) {
        // Lead nomini DB dan olish
        let leadName = null;
        try {
          const nm = await req.db.query('SELECT name FROM crm_lead WHERE id=$1 LIMIT 1', [lead.rows[0].id]);
          leadName = nm.rows[0]?.name || null;
        } catch {}
        _pushEvent(companyId, {
          type:         'incoming',
          phone,
          lead_id:      lead.rows[0].id,
          lead_name:    leadName,
          is_new_lead:  false,
          call_id:      callId,
          duration,
          record_url:   recordUrl,
          date:         new Date().toISOString(),
        });
      }
    } else if (phone && isIncomingCall(callType)) {
      // Noma'lum raqamdan kiruvchi qo'ng'iroq → yangi lead yaratish
      const stageRes = await req.db.query(
        companyId
          ? 'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence LIMIT 1'
          : 'SELECT id FROM crm_stage ORDER BY sequence LIMIT 1',
        companyId ? [companyId] : []
      );
      const stageId = stageRes.rows.length > 0 ? stageRes.rows[0].id : 1;
      const inserted = await req.db.query(
        `INSERT INTO crm_lead (name, phone, mizon_source, lead_score, stage_id, actualcallattempts, chatlogs, company_id)
         VALUES ($1,$2,'voip_incoming',25,$3,1,$4,$5) RETURNING id`,
        [
          `Noma'lum (+${cleanPhone})`, phone, stageId,
          JSON.stringify([{
            type: 'call', date: new Date().toISOString(),
            text: logText, call_id: callId, direction: 'in',
          }]),
          companyId
        ]
      );
      console.log(`📌 New lead from incoming call: ${phone}`);

      _pushEvent(companyId, {
        type:        'incoming',
        phone,
        lead_id:     inserted.rows[0]?.id || null,
        lead_name:   null,
        is_new_lead: true,
        call_id:     callId,
        date:        new Date().toISOString(),
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Moi Zvonki Webhook Error:', err.message);
    res.sendStatus(500);
  }
};

// ---- Helpers ----

function isIncomingCall(type) {
  return ['incoming', 'inbound', 'in'].includes((type || '').toLowerCase());
}

function buildCallLogText(callType, phone, duration, status, recordUrl) {
  const dir = isIncomingCall(callType) ? 'Kiruvchi' : 'Chiquvchi';
  const dur = duration > 0 ? ` (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})` : '';
  const rec = recordUrl ? ` 🎙 Yozuv: ${recordUrl}` : '';
  const st  = status ? ` [${status}]` : '';
  return `📞 ${dir} qo'ng'iroq: ${phone}${dur}${st}${rec}`;
}

function moiZvonkiCall(domain, accountId, apiToken, from, to) {
  return new Promise((resolve, reject) => {
    const path = `/v1/pbx/call/callback?user_token=${apiToken}&user_id=${accountId}&from=${encodeURIComponent(from)}&to_number=${encodeURIComponent(to)}`;
    const options = {
      hostname: domain || 'app.moizvonki.ru',
      path, method: 'GET'
    };
    const reqHttp = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); } });
    });
    reqHttp.on('error', reject);
    reqHttp.end();
  });
}
