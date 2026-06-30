// ========== VOIP CONTROLLER (Moi Zvonki / МойЗвонки) ==========
// API spec: https://api.moizvonki.ru (yii2-moizvonki reference client)
//   Endpoint:  POST https://{subdomain}.moizvonki.ru/api/v1
//   Body:      { user_name, api_key, action, ...params }
//   Webhook:   call.start → call.answer → call.finish (same call_id)

const https = require('https');

// ── In-memory call event queue (per company) ──────────────────────────────────
const _callEvents = new Map();
const QUEUE_MAX   = 30;

function _pushEvent(companyId, event) {
  const key = String(companyId || 'default');
  const arr = _callEvents.get(key) || [];
  arr.push({ ...event, id: `ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}` });
  _callEvents.set(key, arr.slice(-QUEUE_MAX));
}

// GET /api/calls/recent — frontend polling
exports.getRecentEvents = (req, res) => {
  const key    = String(req.user?.companyId || 'default');
  const events = _callEvents.get(key) || [];
  _callEvents.set(key, []);
  res.json({ events });
};

// GET /api/voip/config — return config (api_key hidden)
exports.getConfig = async (req, res) => {
  if (!req.db) return res.json({ configured: false });
  const cid = req.user?.companyId;
  try {
    const result = await req.db.query(
      "SELECT user_name, caller_id, subdomain, created_at FROM crm_voip_config WHERE company_id=$1 ORDER BY id DESC LIMIT 1",
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
  const { user_name, api_key, subdomain, caller_id } = req.body;
  if (!user_name || !api_key || !subdomain) {
    return res.status(400).json({ error: 'user_name, api_key va subdomain majburiy' });
  }
  // subdomain'ni tozalash: agar user "https://mycompany.moizvonki.ru" kiritgan bo'lsa, faqat "mycompany" qoldiramiz
  const sub = String(subdomain)
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.moizvonki\.ru.*$/, '')
    .replace(/\/.*$/, '');

  try {
    await req.db.query('DELETE FROM crm_voip_config WHERE company_id=$1', [cid]);
    await req.db.query(
      'INSERT INTO crm_voip_config (user_name, api_key, subdomain, caller_id, company_id) VALUES ($1,$2,$3,$4,$5)',
      [user_name.trim(), api_key.trim(), sub, caller_id || '', cid]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /api/voip/config — disconnect integration
exports.deleteConfig = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  try {
    await req.db.query('DELETE FROM crm_voip_config WHERE company_id=$1', [cid]);
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
      'SELECT user_name, api_key, subdomain, caller_id FROM crm_voip_config WHERE company_id=$1 LIMIT 1',
      [cid]
    );
    if (cfg.rows.length === 0) return res.status(400).json({ error: 'Moi Zvonki sozlanmagan' });

    const { user_name, api_key, subdomain, caller_id } = cfg.rows[0];
    const from = operator_phone || caller_id;
    const toDigits = normalizePhone(phone);

    const callResult = await moiZvonkiCall(subdomain, user_name, api_key, toDigits);

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
          text: `📞 Moi Zvonki orqali chiquvchi qo'ng'iroq: ${from || user_name} → ${phone}`,
          call_id: callResult.call_id || null,
          direction: 'out',
        });
        await req.db.query(
          'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3 AND company_id=$4',
          [JSON.stringify(logs), attempts, lead_id, cid]
        );
      }
    }

    res.json({ success: true, call_id: callResult.call_id, raw: callResult });
  } catch (e) {
    console.error('Call initiate error:', e.message);
    res.status(500).json({ error: e.message });
  }
};

// POST /api/webhook/moizvonki — call event lifecycle: call.start → call.answer → call.finish
exports.handleWebhook = async (req, res) => {
  try {
    const event = req.body || {};
    console.log('📞 Moi Zvonki event:', JSON.stringify(event));

    if (!req.db) return res.sendStatus(200);

    // Event nomi: rasmiy formati "call.start" / "call.answer" / "call.finish",
    // lekin partner CRM'lar ko'pincha qisqartirilgan ("start"/"answer"/"finish") yoki
    // turli field nomlari (event/type/event_type) ishlatadi.
    const rawEventType = String(event.event || event.event_type || event.type || event.call_type || '').toLowerCase();
    const eventType    = normalizeEventType(rawEventType);

    const phoneRaw  = event.client_number || event.phone || event.caller_number || event.from || event.to || '';
    const callId    = String(event.call_id || event.id || '');
    const duration  = Number(event.duration || 0);
    const status    = event.disposition || event.call_result || event.status || '';
    const recordUrl = event.record_url || event.recording || event.record || null;
    const direction = parseDirection(event);
    const managerEmail = event.manager_email || event.user_name || event.employee_email || null;

    if (!phoneRaw) return res.sendStatus(200);

    // Kompaniyani aniqlash
    let companyId = parseInt(req.query.company_id || req.headers['x-mizon-company'] || event.company_id || '', 10);
    if (!companyId || isNaN(companyId)) {
      const cfgR = await req.db.query('SELECT company_id FROM crm_voip_config ORDER BY id DESC LIMIT 1');
      companyId = cfgR.rows[0]?.company_id || null;
    }

    // Idempotency — bir xil (call_id, event_type) ikkinchi marta kelsa hech narsa qilmaymiz.
    // Lekin call_id bo'sh bo'lsa idempotency'siz ishlaymiz (best-effort).
    if (callId) {
      try {
        const ins = await req.db.query(
          'INSERT INTO crm_call_events (call_id, event_type, company_id) VALUES ($1,$2,$3) ON CONFLICT (call_id, event_type) DO NOTHING RETURNING call_id',
          [callId, eventType, companyId]
        );
        if (ins.rows.length === 0) {
          console.log(`📞 Duplicate event ignored: ${callId} / ${eventType}`);
          return res.sendStatus(200);
        }
      } catch (e) {
        console.warn('[moizvonki] idempotency insert failed (continuing):', e.message);
      }
    }

    const cleanPhone = normalizePhone(phoneRaw);
    const leadQ = await req.db.query(
      companyId
        ? "SELECT id, name, chatlogs, actualcallattempts FROM crm_lead WHERE REGEXP_REPLACE(phone, '\\D', '', 'g')=$1 AND company_id=$2 LIMIT 1"
        : "SELECT id, name, chatlogs, actualcallattempts FROM crm_lead WHERE REGEXP_REPLACE(phone, '\\D', '', 'g')=$1 LIMIT 1",
      companyId ? [cleanPhone, companyId] : [cleanPhone]
    );

    // call.start (kiruvchi) — UI'ga notifikatsiya, chatlog hali yozmaymiz
    if (eventType === 'call.start' && direction === 'in') {
      let leadId   = leadQ.rows[0]?.id || null;
      let leadName = leadQ.rows[0]?.name || null;
      let isNew    = false;

      // Noma'lum raqamdan kiruvchi qo'ng'iroq → yangi lead yaratish (foydalanuvchi javob berishidan oldin ko'rinsin)
      if (!leadId) {
        const stageRes = await req.db.query(
          companyId
            ? 'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence LIMIT 1'
            : 'SELECT id FROM crm_stage ORDER BY sequence LIMIT 1',
          companyId ? [companyId] : []
        );
        const stageId = stageRes.rows.length > 0 ? stageRes.rows[0].id : 1;
        const ins = await req.db.query(
          `INSERT INTO crm_lead (name, phone, mizon_source, lead_score, stage_id, actualcallattempts, chatlogs, company_id)
           VALUES ($1,$2,'voip_incoming',25,$3,0,$4,$5) RETURNING id, name`,
          [`Noma'lum (+${cleanPhone})`, `+${cleanPhone}`, stageId, JSON.stringify([]), companyId]
        );
        leadId   = ins.rows[0]?.id || null;
        leadName = ins.rows[0]?.name || null;
        isNew    = true;
        console.log(`📌 New lead from incoming call: +${cleanPhone}`);
      }

      _pushEvent(companyId, {
        type:        'incoming',
        phone:       `+${cleanPhone}`,
        lead_id:     leadId,
        lead_name:   leadName,
        is_new_lead: isNew,
        call_id:     callId,
        date:        new Date().toISOString(),
      });
      return res.sendStatus(200);
    }

    // call.finish — chatlog'ga to'liq yozuv (duration, status, recording)
    if (eventType === 'call.finish') {
      const logText = buildCallLogText(direction, phoneRaw, duration, status, recordUrl, managerEmail);

      if (leadQ.rows.length > 0) {
        const lead = leadQ.rows[0];
        const logs = lead.chatlogs || [];
        const attempts = (lead.actualcallattempts || 0) + 1;
        logs.push({
          type:        'call',
          date:        new Date().toISOString(),
          text:        logText,
          call_id:     callId,
          duration,
          record_url:  recordUrl,
          direction,
          manager:     managerEmail,
          status,
        });
        await req.db.query(
          companyId
            ? 'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3 AND company_id=$4'
            : 'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3',
          companyId
            ? [JSON.stringify(logs), attempts, lead.id, companyId]
            : [JSON.stringify(logs), attempts, lead.id]
        );
        console.log(`📞 Call.finish logged → lead #${lead.id}: ${logText}`);
      } else {
        // Lead topilmadi — yangi lead yaratish (faqat ringa bo'lib o'tmagan kiruvchi qo'ng'iroqlar uchun)
        // call.start dan o'tmagan (noma'lum sabab) yoki chiquvchi noma'lum raqam — yangi yaratamiz
        const stageRes = await req.db.query(
          companyId
            ? 'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence LIMIT 1'
            : 'SELECT id FROM crm_stage ORDER BY sequence LIMIT 1',
          companyId ? [companyId] : []
        );
        const stageId = stageRes.rows.length > 0 ? stageRes.rows[0].id : 1;
        await req.db.query(
          `INSERT INTO crm_lead (name, phone, mizon_source, lead_score, stage_id, actualcallattempts, chatlogs, company_id)
           VALUES ($1,$2,'voip_incoming',25,$3,1,$4,$5)`,
          [
            `Noma'lum (+${cleanPhone})`, `+${cleanPhone}`, stageId,
            JSON.stringify([{
              type: 'call', date: new Date().toISOString(),
              text: logText, call_id: callId, duration, record_url: recordUrl,
              direction, manager: managerEmail, status,
            }]),
            companyId
          ]
        );
        console.log(`📌 New lead + call.finish: +${cleanPhone}`);
      }
      return res.sendStatus(200);
    }

    // call.answer va boshqa hodisalar — log'da qoldiramiz, ammo chatlog'ga yozmaymiz
    console.log(`📞 Ignored event type: ${rawEventType} (normalized: ${eventType})`);
    res.sendStatus(200);
  } catch (err) {
    console.error('Moi Zvonki Webhook Error:', err.message, err.stack);
    res.sendStatus(500);
  }
};

// ---- Helpers ----

function normalizeEventType(t) {
  const s = String(t || '').toLowerCase().replace(/[^a-z.]/g, '');
  // "start", "call.start", "callstart", "begin" → call.start
  if (/start|begin|ringing|incoming|inbound|outbound|outgoing/.test(s) && !/finish|end/.test(s)) {
    return 'call.start';
  }
  if (/answer|bridge|connect|accepted/.test(s)) return 'call.answer';
  if (/finish|end|complete|hangup|disconnected|terminated/.test(s)) return 'call.finish';
  return s || 'unknown';
}

function parseDirection(event) {
  const raw = String(event.direction || event.call_type || event.type || event.event || '').toLowerCase();
  if (/incoming|inbound|in\b/.test(raw)) return 'in';
  if (/outgoing|outbound|out\b/.test(raw)) return 'out';
  // Default: hech qaysi mos kelmasa, in (chunki ko'pincha kiruvchi qo'ng'iroqlar webhook orqali keladi)
  return 'in';
}

function normalizePhone(p) {
  // Hamma narsa - faqat raqamlar
  let digits = String(p || '').replace(/\D/g, '');
  // Rossiya formatidan keluvchi: 7XXXXXXXXXX (11 ta raqam, 7 bilan) — saqlaymiz
  // O'zbek: 998XXXXXXXXX (12 ta raqam, 998 bilan) — saqlaymiz
  // Faqat 9 ta raqam (O'zbek lokal: 901234567) → 998 prefix qo'shamiz
  if (digits.length === 9 && /^[3-9]/.test(digits)) digits = '998' + digits;
  return digits;
}

function buildCallLogText(direction, phone, duration, status, recordUrl, manager) {
  const dir = direction === 'in' ? 'Kiruvchi' : 'Chiquvchi';
  const dur = duration > 0 ? ` (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})` : '';
  const rec = recordUrl ? ` 🎙 Yozuv: ${recordUrl}` : '';
  const st  = status ? ` [${status}]` : '';
  const mgr = manager ? ` 👤 ${manager}` : '';
  return `📞 ${dir} qo'ng'iroq: ${phone}${dur}${st}${rec}${mgr}`;
}

// POST https://{subdomain}.moizvonki.ru/api/v1  with JSON body
//   { user_name, api_key, action: "calls.make_call", to }
function moiZvonkiCall(subdomain, userName, apiKey, to) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      user_name: userName,
      api_key:   apiKey,
      action:    'calls.make_call',
      to:        to,
    });
    const options = {
      hostname: `${subdomain}.moizvonki.ru`,
      path:     '/api/v1',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const reqHttp = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        if (resp.statusCode >= 400) {
          return reject(new Error(`Moi Zvonki API ${resp.statusCode}: ${data.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data }); }
      });
    });
    reqHttp.on('error', reject);
    reqHttp.write(payload);
    reqHttp.end();
  });
}
