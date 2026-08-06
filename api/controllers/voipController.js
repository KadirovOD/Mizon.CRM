// ========== VOIP CONTROLLER (Moi Zvonki / МойЗвонки) ==========
// REAL API spec (Chrome orqali aniqlangan, 2026-06):
//   Endpoint:  POST https://{subdomain}.moizvonki.ru/api/v1
//   Body:      JSON, flat: { user_name, api_key, action, ...params }
//              Content-Type: application/json (boshqa Content-Type ishlamaydi)
//   Javob:    success uchun ko'pincha plain-text ("OK", "Make call posted") yoki JSON.
//              Xato uchun HTTP 4xx + plain-text xato yoki JSON {error: ...}.
//
// Webhook arxitekturasi: CRM kabinetda webhook URL ni qo'lda kiritmaydi —
//   uning o'rniga `webhook.subscribe` action orqali API dan ro'yxatdan o'tkazadi.
//   Bizning yondashuv: saveConfig'da credentialni saqlagandan keyin avtomatik
//   ro'yxatdan o'tkazamiz. deleteConfig'da unsubscribe qilamiz.
//
// Event ketma-ketligi (har bir qo'ng'iroq uchun, bir xil db_call_id):
//   event_type=1 → call.start  (qo'ng'iroq boshlandi)
//   event_type=2 → call.answer (mijoz/operator javob berdi)
//   event_type=4 → call.finish (yakun + recording URL)
//   event_type=32 → sms.message
// Direction: 0 = kiruvchi, 1 = chiquvchi

const https = require('https');

// ── In-memory call event queue (per company) — UI polling uchun ──────────────
const _callEvents = new Map();
const QUEUE_MAX   = 30;

function _pushEvent(companyId, event) {
  const key = String(companyId || 'default');
  const arr = _callEvents.get(key) || [];
  arr.push({ ...event, id: `ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}` });
  _callEvents.set(key, arr.slice(-QUEUE_MAX));
}

// ── Diagnostika: kelgan har bir POST shu yerga yoziladi (oxirgi 30, company bo'yicha) ──
const _webhookActivity = new Map();
const WH_MAX = 30;
function _logWebhookActivity(companyId, info) {
  const key = String(companyId || 'unknown');
  const arr = _webhookActivity.get(key) || [];
  arr.push({ ...info, at: new Date().toISOString() });
  _webhookActivity.set(key, arr.slice(-WH_MAX));
}

// Public webhook URL helper — APP_URL env yoki request host'dan quriladi
function _publicWebhookUrl(req, companyId) {
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
  return `${appUrl}/api/webhook/moizvonki?company_id=${encodeURIComponent(String(companyId || ''))}`;
}

// ── Moizvonki webhook hodisalari biz ro'yxatdan o'tkazadigan ro'yxat ─────────
// Rasmiy spec: https://www.moizvonki.ru/guide/api/ — nomlar aynan shunday.
// ⚠️ webhook.subscribe faqat Administrator hisobidan ishlaydi: oddiy xodim
// credentiali bilan so'rov HTTP 200 qaytaradi, lekin hech qanday hodisa kelmaydi.
const SUBSCRIBED_EVENTS = ['call.start', 'call.answer', 'call.finish', 'sms.message'];

// =============================================================================
//  DIAGNOSTIC ENDPOINTS
// =============================================================================

// GET /api/voip/webhook-activity — Moizvonki dan kelgan oxirgi hodisalar
exports.getWebhookActivity = (req, res) => {
  const key = String(req.user?.companyId || 'unknown');
  const items = _webhookActivity.get(key) || [];
  res.json({ items: [...items].reverse() });
};

// GET /api/voip/webhook-subscriptions — Moizvonki da ro'yxatdan o'tgan callback URL'lar
exports.getWebhookSubscriptions = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  try {
    const cfg = await req.db.query(
      'SELECT user_name, api_key, subdomain FROM crm_voip_config WHERE company_id=$1 LIMIT 1',
      [cid]
    );
    if (cfg.rows.length === 0) return res.status(400).json({ error: 'Moizvonki sozlanmagan' });
    const { user_name, api_key, subdomain } = cfg.rows[0];
    const r = await moiZvonkiApiRaw(subdomain, user_name, api_key, 'webhook.list', {});
    res.json({
      status:   r.statusCode,
      hooks:    r.parsed || {},
      raw:      r.body,
      expected: _publicWebhookUrl(req, cid),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/voip/subscribe-webhooks — qo'lda webhook ro'yxatdan o'tkazish (re-sync)
exports.subscribeWebhooks = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  try {
    const cfg = await req.db.query(
      'SELECT user_name, api_key, subdomain FROM crm_voip_config WHERE company_id=$1 LIMIT 1',
      [cid]
    );
    if (cfg.rows.length === 0) return res.status(400).json({ error: 'Moizvonki sozlanmagan' });
    const { user_name, api_key, subdomain } = cfg.rows[0];
    const callbackUrl = _publicWebhookUrl(req, cid);
    const result = await _subscribeMoizvonkiWebhooks(subdomain, user_name, api_key, callbackUrl);
    res.json({ ok: result.ok, callback_url: callbackUrl, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/voip/test — credential to'g'riligini tekshirish (qo'ng'iroq qilmaydi)
//   1. company.list_employee'ga so'rov yuboramiz — auth tekshiruvi
//   2. webhook.list'ga so'rov yuboramiz — ro'yxatdan o'tgan callback'larni ko'rsatamiz
//   3. (ixtiyoriy) to_number berilsa — haqiqiy qo'ng'iroq qilamiz
exports.testConnection = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  const { to_number } = req.body || {};
  try {
    const cfg = await req.db.query(
      'SELECT user_name, api_key, subdomain, caller_id FROM crm_voip_config WHERE company_id=$1 LIMIT 1',
      [cid]
    );
    if (cfg.rows.length === 0) {
      return res.status(400).json({ ok: false, stage: 'config', error: 'Moizvonki sozlanmagan — avval ulang.' });
    }
    const { user_name, api_key, subdomain, caller_id } = cfg.rows[0];
    const targetUrl = `https://${subdomain}.moizvonki.ru/api/v1`;

    // 1) Auth tekshiruvi
    const auth = await moiZvonkiApiRaw(subdomain, user_name, api_key, 'company.list_employee', {});
    const authOk = auth.statusCode === 200 && !_extractApiError(auth);

    // 2) Webhook ro'yxati
    const hooks = await moiZvonkiApiRaw(subdomain, user_name, api_key, 'webhook.list', {});

    // 3) Ixtiyoriy: haqiqiy qo'ng'iroq
    let callResult = null;
    if (to_number) {
      const toDigits = normalizePhone(to_number);
      callResult = await moiZvonkiApiRaw(subdomain, user_name, api_key, 'calls.make_call', {
        to:   toDigits,
        from: caller_id || undefined,
      });
    }

    res.json({
      ok:         authOk,
      target_url: targetUrl,
      config:     { user_name, subdomain, caller_id, api_key_preview: api_key ? api_key.slice(0,4)+'…'+api_key.slice(-4) : '(yo\'q)' },
      auth_check: { status: auth.statusCode, body: _truncate(auth.body, 600), parsed_employees: auth.parsed?.results_count },
      webhooks:   { status: hooks.statusCode, registered: hooks.parsed || {}, expected_url: _publicWebhookUrl(req, cid) },
      call_test:  callResult ? { status: callResult.statusCode, body: _truncate(callResult.body, 200) } : null,
      hint: !authOk
        ? 'Auth xato: user_name (email) yoki api_key notogri, yoki subdomain notogri.'
        : Object.keys(hooks.parsed || {}).length < SUBSCRIBED_EVENTS.length
          ? 'Webhooklar toliq royxatdan otmagan. "Qayta royxatdan otkazish"ni bosing; royxat yana bosh qolsa — kiritilgan login Moizvonki Administratori emas (subscribe faqat Administrator hisobidan ishlaydi).'
          : 'Webhooklar joyida. Yozuv kelmasa — Moizvonki mobil ilovasi telefonda ishlab turgani va "qongiroqlarni yozib olish" yoqilganini tekshiring.',
    });
  } catch (e) {
    res.status(500).json({ ok: false, stage: 'request', error: e.message });
  }
};

// GET /api/calls/recent — frontend polling
exports.getRecentEvents = (req, res) => {
  const key    = String(req.user?.companyId || 'default');
  const events = _callEvents.get(key) || [];
  _callEvents.set(key, []);
  res.json({ events });
};

// =============================================================================
//  CONFIG CRUD (+ auto-subscribe / auto-unsubscribe)
// =============================================================================

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

// POST /api/voip/config — save credentials + auto-subscribe webhooks
exports.saveConfig = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  const { user_name, api_key, subdomain, caller_id } = req.body;
  if (!user_name || !api_key || !subdomain) {
    return res.status(400).json({ error: 'user_name, api_key va subdomain majburiy' });
  }
  // subdomain'ni tozalash: "https://mycompany.moizvonki.ru" → "mycompany"
  const sub = String(subdomain)
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.moizvonki\.ru.*$/, '')
    .replace(/\/.*$/, '');

  try {
    // Eskini o'chirib, yangisini saqlaymiz (single config per company)
    await req.db.query('DELETE FROM crm_voip_config WHERE company_id=$1', [cid]);
    await req.db.query(
      'INSERT INTO crm_voip_config (user_name, api_key, subdomain, caller_id, company_id) VALUES ($1,$2,$3,$4,$5)',
      [user_name.trim(), api_key.trim(), sub, caller_id || '', cid]
    );

    // Webhook'larni Moizvonki'da avtomatik ro'yxatdan o'tkazamiz
    const callbackUrl = _publicWebhookUrl(req, cid);
    const subResult = await _subscribeMoizvonkiWebhooks(sub, user_name.trim(), api_key.trim(), callbackUrl);

    res.json({
      success:        true,
      webhook_url:    callbackUrl,
      webhook_status: subResult.ok ? 'subscribed' : 'failed',
      webhook_detail: subResult,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /api/voip/config — unsubscribe webhooks + delete config
exports.deleteConfig = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  try {
    // Best-effort unsubscribe — credential bo'lsa
    const cfg = await req.db.query(
      'SELECT user_name, api_key, subdomain FROM crm_voip_config WHERE company_id=$1 LIMIT 1',
      [cid]
    );
    if (cfg.rows.length > 0) {
      const { user_name, api_key, subdomain } = cfg.rows[0];
      try {
        await moiZvonkiApiRaw(subdomain, user_name, api_key, 'webhook.unsubscribe', {
          hooks: SUBSCRIBED_EVENTS,
        });
      } catch (e) {
        console.warn('[moizvonki] unsubscribe failed (continuing delete):', e.message);
      }
    }
    await req.db.query('DELETE FROM crm_voip_config WHERE company_id=$1', [cid]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// =============================================================================
//  CLICK-TO-CALL
// =============================================================================

// POST /api/call — click-to-call via Moi Zvonki API
//   Moizvonki javob: HTTP 200 + plain-text "Make call posted" (success)
//                    HTTP 4xx + plain-text xato (failure)
//   JSON parsing'ga ishonib bo'lmaydi — HTTP status + body matnini tekshiramiz.
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

    const params = { to: toDigits };
    if (from) params.from = from;
    const raw = await moiZvonkiApiRaw(subdomain, user_name, api_key, 'calls.make_call', params);

    // Success aniqlash:
    //   1. HTTP 2xx
    //   2. body'da xato matni yo'q (yoki parsed JSON ichida error yo'q)
    const apiError = _extractApiError(raw);
    const isHttpOk = raw.statusCode >= 200 && raw.statusCode < 300;
    const isApiOk  = isHttpOk && !apiError;
    const callId   = raw.parsed?.call_id || raw.parsed?.id || raw.parsed?.db_call_id || null;

    // Chatlog yozish
    if (lead_id) {
      const lead = await req.db.query(
        'SELECT id, chatlogs, actualcallattempts FROM crm_lead WHERE id=$1 AND company_id=$2',
        [lead_id, cid]
      );
      if (lead.rows.length > 0) {
        const logs = lead.rows[0].chatlogs || [];
        const attempts = (lead.rows[0].actualcallattempts || 0) + 1;
        if (isApiOk) {
          // Bitta yozuv patterni: bu yerda "calling" holatda yaratamiz, keyin
          // webhook call.finish keladi va shu yozuvni update qiladi (yangi qatordan qo'shmaydi).
          // Matn ham buildCallLogText bilan bir xil formatda — polling almashtirsa ham UI o'zgarmasin.
          logs.push({
            type: 'call',
            date: new Date().toISOString(),
            text: `📞 Chiquvchi qo'ng'iroq: ${phone}`,
            call_id: callId,
            direction: 'out',
            status: 'calling',
          });
        } else {
          const reason = apiError || `HTTP ${raw.statusCode}` || 'noma\'lum xato';
          logs.push({
            type: 'call',
            date: new Date().toISOString(),
            text: `⚠️ Moi Zvonki qo'ng'iroqni boshlay olmadi: ${reason}`,
            direction: 'out',
            status: 'failed',
            error: reason,
            moizvonki_status: raw.statusCode,
          });
        }
        await req.db.query(
          'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3 AND company_id=$4',
          [JSON.stringify(logs), attempts, lead_id, cid]
        );
      }
    }

    if (!isApiOk) {
      console.error('[moizvonki] API call rejected:', { status: raw.statusCode, body: raw.body });
      return res.status(502).json({
        success:         false,
        error:           apiError || `Moizvonki HTTP ${raw.statusCode}`,
        moizvonki_status: raw.statusCode,
        moizvonki_body:  _truncate(raw.body, 500),
      });
    }

    res.json({ success: true, call_id: callId, raw: raw.parsed || raw.body });
  } catch (e) {
    console.error('Call initiate error:', e.message);
    res.status(500).json({ error: e.message });
  }
};

// =============================================================================
//  CLICK-TO-SMS
// =============================================================================

// Moizvonki chiquvchi SMS action'i (kabinet tarmoq so'rovidan aniqlangan):
//   { action: 'calls.send_sms', template_id: 0, text, to }
//   to — xalqaro formatda, "+" bilan (masalan "+998901234567").
const SMS_SEND_ACTION = 'calls.send_sms';

// POST /api/sms — click-to-SMS via Moi Zvonki API (ulangan telefon SIM orqali)
exports.sendSms = async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId;
  const { phone, lead_id, text } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone majburiy' });
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text majburiy' });
  try {
    const cfg = await req.db.query(
      'SELECT user_name, api_key, subdomain FROM crm_voip_config WHERE company_id=$1 LIMIT 1',
      [cid]
    );
    if (cfg.rows.length === 0) return res.status(400).json({ error: 'Moi Zvonki sozlanmagan' });

    const { user_name, api_key, subdomain } = cfg.rows[0];
    const toIntl  = '+' + normalizePhone(phone); // API "+" bilan xalqaro formatni kutadi
    const message = String(text).trim();

    const raw = await moiZvonkiApiRaw(subdomain, user_name, api_key, SMS_SEND_ACTION, {
      template_id: 0,
      text:        message,
      to:          toIntl,
    });
    const apiError = _extractApiError(raw);
    const isHttpOk = raw.statusCode >= 200 && raw.statusCode < 300;
    const isApiOk  = isHttpOk && !apiError;
    if (!isApiOk) {
      console.warn(`[moizvonki] SMS rad etildi: HTTP ${raw.statusCode} ${apiError || raw.body?.slice(0,120)}`);
    }

    // Chatlog yozish (chiquvchi qo'ng'iroq patternini takrorlaydi)
    if (lead_id) {
      const lead = await req.db.query(
        'SELECT id, chatlogs FROM crm_lead WHERE id=$1 AND company_id=$2',
        [lead_id, cid]
      );
      if (lead.rows.length > 0) {
        const logs = lead.rows[0].chatlogs || [];
        if (isApiOk) {
          logs.push({
            type: 'sms',
            date: new Date().toISOString(),
            text: `✉️ Chiquvchi SMS: ${phone} — "${message}"`,
            direction: 'out',
            status: 'sent',
          });
        } else {
          const reason = apiError || `HTTP ${raw.statusCode}` || 'noma\'lum xato';
          logs.push({
            type: 'sms',
            date: new Date().toISOString(),
            text: `⚠️ SMS yuborilmadi: ${reason}`,
            direction: 'out',
            status: 'failed',
            error: reason,
          });
        }
        await req.db.query(
          'UPDATE crm_lead SET chatlogs=$1 WHERE id=$2 AND company_id=$3',
          [JSON.stringify(logs), lead_id, cid]
        );
      }
    }

    if (!isApiOk) {
      console.error('[moizvonki] SMS rad etildi:', { status: raw.statusCode, body: raw.body });
      return res.status(502).json({
        success:          false,
        error:            apiError || `Moizvonki HTTP ${raw.statusCode}`,
        moizvonki_status: raw.statusCode,
        moizvonki_body:   _truncate(raw.body, 500),
      });
    }

    res.json({ success: true, action: SMS_SEND_ACTION, raw: raw.parsed || raw.body });
  } catch (e) {
    console.error('SMS send error:', e.message);
    res.status(500).json({ error: e.message });
  }
};

// =============================================================================
//  WEBHOOK RECEIVER
// =============================================================================

// POST /api/webhook/moizvonki — Moizvonki dan keladigan hodisalar
//   Documented body shape:
//     { webhook: { action, account_id, account_name, user_id, user_login },
//       event:   [ { event_type, direction, client_number, db_call_id,
//                    duration, answered, recording,
//                    start_time, answer_time, end_time, ... } ] }
//   event_type: 1=call.start, 2=call.answer, 4=call.finish, 32=sms.message
//   direction:  0=kiruvchi, 1=chiquvchi
//   Lekin partner CRM webhook formati biroz farq qilishi mumkin — defensive parsing.
exports.handleWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    console.log('📞 Moi Zvonki webhook:', JSON.stringify(body).slice(0, 1500));

    // Diagnostika: kelgan har bir POST ni log buffer'ga yozamiz
    const wcid = parseInt(req.query.company_id || req.headers['x-mizon-company'] || body.company_id || '', 10) || 'unknown';
    _logWebhookActivity(wcid, {
      ip:         (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
      method:     req.method,
      query:      req.query,
      headers:    { 'content-type': req.headers['content-type'], 'user-agent': req.headers['user-agent'] },
      body_keys:  Object.keys(body).slice(0, 20),
      raw_body:   JSON.stringify(body).slice(0, 1500),
    });

    if (!req.db) return res.sendStatus(200);

    // Kompaniyani aniqlash (query > header > body > eski config'dan)
    let companyId = parseInt(req.query.company_id || req.headers['x-mizon-company'] || body.company_id || '', 10);
    if (!companyId || isNaN(companyId)) {
      const cfgR = await req.db.query('SELECT company_id FROM crm_voip_config ORDER BY id DESC LIMIT 1');
      companyId = cfgR.rows[0]?.company_id || null;
    }

    // Events array — documented shape vs flat shape
    let events = [];
    if (Array.isArray(body.event)) {
      events = body.event;
    } else if (body.event && typeof body.event === 'object') {
      events = [body.event];
    } else if (Array.isArray(body.events)) {
      events = body.events;
    } else if (body.event_type !== undefined || body.call_id !== undefined || body.client_number !== undefined) {
      // Flat shape (eski integratsiyalar yoki test webhook)
      events = [body];
    } else {
      console.log('[moizvonki] webhook body has no recognizable event payload');
      return res.sendStatus(200);
    }

    const webhookMeta = body.webhook || {};

    // Parsed summary — foydalanuvchi diagnostika panelida ko'rishi uchun
    const parsedSummary = events.map((ev) => {
      const rawType = ev.event_type !== undefined ? ev.event_type : (ev.event || ev.type || ev.call_type);
      return {
        event_type: normalizeEventType(rawType),
        raw_type:   rawType,
        direction:  parseDirection(ev),
        phone:      ev.client_number || ev.phone || ev.caller_number || ev.from || ev.to || '',
        call_id:    String(ev.db_call_id || ev.call_id || ev.id || ''),
        answered:   ev.answered,
        duration:   ev.duration,
      };
    });
    _logWebhookActivity(companyId || wcid, {
      kind:    'parsed',
      count:   events.length,
      summary: parsedSummary,
    });

    for (const ev of events) {
      try {
        await _processSingleEvent(req.db, companyId, ev, webhookMeta);
      } catch (e) {
        console.error('[moizvonki] event processing error:', e.message, ev);
        _logWebhookActivity(companyId || wcid, {
          kind:  'error',
          error: e.message,
          event: JSON.stringify(ev).slice(0, 400),
        });
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Moi Zvonki Webhook Error:', err.message, err.stack);
    res.sendStatus(500);
  }
};

// =============================================================================
//  EVENT PROCESSOR
// =============================================================================

async function _processSingleEvent(db, companyId, ev, webhookMeta) {
  // event_type: numeric (1/2/4/32) yoki string ("call.start" / "start")
  const rawEventType = ev.event_type !== undefined ? ev.event_type : (ev.event || ev.type || ev.call_type);
  const eventType    = normalizeEventType(rawEventType);

  // direction: numeric (0/1) yoki string ("in"/"out"/"incoming"/"outbound")
  const direction = parseDirection(ev);

  const phoneRaw  = ev.client_number || ev.phone || ev.caller_number || ev.from || ev.to || '';
  const callId    = String(ev.db_call_id || ev.call_id || ev.id || '');

  console.log(`[moizvonki] processing: type=${eventType} dir=${direction} phone="${phoneRaw}" call=${callId} company=${companyId}`);

  // duration — soniyada
  let duration = Number(ev.duration || 0);
  if (!duration && ev.start_time && ev.end_time) {
    duration = Math.max(0, Math.floor((Date.parse(ev.end_time) - Date.parse(ev.start_time)) / 1000));
  }

  // answered — 0/1 yoki status string
  const answered  = ev.answered === 1 || ev.answered === '1' || ev.answered === true;
  const status    = ev.disposition || ev.call_result || ev.status || (answered ? 'answered' : (eventType === 'call.finish' ? 'missed' : ''));
  const recordUrl = ev.recording || ev.record_url || ev.record || null;
  const managerEmail = ev.manager_email || ev.user_login || ev.user_name || ev.employee_email || webhookMeta?.user_login || null;

  if (!phoneRaw) {
    console.log(`[moizvonki] event skipped — no phone (eventType=${eventType}, ev=${JSON.stringify(ev).slice(0,200)})`);
    return;
  }

  // Idempotency
  if (callId) {
    try {
      const ins = await db.query(
        'INSERT INTO crm_call_events (call_id, event_type, company_id) VALUES ($1,$2,$3) ON CONFLICT (call_id, event_type) DO NOTHING RETURNING call_id',
        [callId, eventType, companyId]
      );
      if (ins.rows.length === 0) {
        console.log(`📞 Duplicate event ignored: ${callId} / ${eventType}`);
        return;
      }
    } catch (e) {
      console.warn('[moizvonki] idempotency insert failed (continuing):', e.message);
    }
  }

  const cleanPhone = normalizePhone(phoneRaw);
  // Lidni oxirgi 9 ta muhim raqam bo'yicha topamiz — telefon bazada turli formatlarda
  // saqlangan bo'lishi mumkin ("+998901234567", "998901234567", "901234567", "90 123 45 67").
  // Faqat to'liq raqamli tenglik ishlatilsa, format farqi tufayli lid topilmay, dublikat lid
  // yaratilardi. RIGHT(...,9) bilan formatdan qat'i nazar bitta lidga tushamiz. Bir nechta mos
  // kelsa — avval aniq to'liq mos keluvchisi, so'ng eng oxirgi lid tanlanadi.
  const phoneTail = cleanPhone.slice(-9);
  const leadQ = await db.query(
    companyId
      ? `SELECT id, name, chatlogs, actualcallattempts FROM crm_lead
           WHERE company_id=$2
             AND phone IS NOT NULL
             AND LENGTH(REGEXP_REPLACE(phone, '\\D', '', 'g')) >= 9
             AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
           ORDER BY (REGEXP_REPLACE(phone, '\\D', '', 'g') = $3) DESC, id DESC
           LIMIT 1`
      : `SELECT id, name, chatlogs, actualcallattempts FROM crm_lead
           WHERE phone IS NOT NULL
             AND LENGTH(REGEXP_REPLACE(phone, '\\D', '', 'g')) >= 9
             AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
           ORDER BY (REGEXP_REPLACE(phone, '\\D', '', 'g') = $2) DESC, id DESC
           LIMIT 1`,
    companyId ? [phoneTail, companyId, cleanPhone] : [phoneTail, cleanPhone]
  );

  // call.start (kiruvchi) → UI notification + lead avtomatik yaratish
  if (eventType === 'call.start' && direction === 'in') {
    let leadId   = leadQ.rows[0]?.id || null;
    let leadName = leadQ.rows[0]?.name || null;
    let isNew    = false;

    if (!leadId) {
      try {
        const stageRes = await db.query(
          companyId
            ? 'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence LIMIT 1'
            : 'SELECT id FROM crm_stage ORDER BY sequence LIMIT 1',
          companyId ? [companyId] : []
        );
        const stageId = stageRes.rows[0]?.id || null;
        const ins = await db.query(
          `INSERT INTO crm_lead (name, phone, mizon_source, lead_score, stage_id, actualcallattempts, chatlogs, company_id)
           VALUES ($1,$2,'moizvonki',25,$3,0,$4,$5) RETURNING id, name`,
          [`Noma'lum (+${cleanPhone})`, `+${cleanPhone}`, stageId, JSON.stringify([]), companyId]
        );
        leadId   = ins.rows[0]?.id || null;
        leadName = ins.rows[0]?.name || null;
        isNew    = true;
        console.log(`📌 New lead from incoming call: +${cleanPhone} (id=${leadId}, stage=${stageId})`);
      } catch (e) {
        console.error(`[moizvonki] LEAD INSERT FAILED for +${cleanPhone}:`, e.message, e.stack?.split('\n')[1]);
      }
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
    return;
  }

  // call.finish → chatlog'ga to'liq yozuv
  if (eventType === 'call.finish') {
    const logText = buildCallLogText(direction, phoneRaw, duration, status, recordUrl, managerEmail);

    if (leadQ.rows.length > 0) {
      const lead = leadQ.rows[0];
      const logs = lead.chatlogs || [];

      // Bir xil qo'ng'iroq uchun ikki qatorli yozuv oldini olish:
      //   1) Aynan shu call_id bilan 'calling' / 'requested' yozuvi mavjud bo'lsa — uni update
      //   2) call_id topilmasa: oxirgi 10 daqiqa ichida shu yo'nalishdagi (out/in)
      //      'calling' / 'requested' yozuvni update (click-to-call ↔ webhook call_id
      //      har doim ham bir xil kelmaydi)
      const nowMs = Date.now();
      const TEN_MIN_MS = 10 * 60 * 1000;
      let existingIdx = -1;
      if (callId) {
        existingIdx = logs.findIndex(lg =>
          lg && lg.type === 'call' && lg.call_id != null &&
          String(lg.call_id) === String(callId) &&
          (lg.status === 'calling' || lg.status === 'requested')
        );
      }
      if (existingIdx < 0) {
        // Fallback: yaqindagi 'calling'/'requested' entry (bir xil yo'nalish) — teskaridan qidiramiz
        for (let i = logs.length - 1; i >= 0; i--) {
          const lg = logs[i];
          if (!lg || lg.type !== 'call') continue;
          if (lg.status !== 'calling' && lg.status !== 'requested') continue;
          if (lg.direction && direction && lg.direction !== direction) continue;
          const t = lg.date ? Date.parse(lg.date) : 0;
          if (nowMs - t > TEN_MIN_MS) break; // eski — to'xtat
          existingIdx = i;
          break;
        }
      }

      // Update-in-place yoki yangi push
      const attempts = existingIdx >= 0
        ? (lead.actualcallattempts || 0)                 // urinishlar allaqachon hisoblangan
        : (lead.actualcallattempts || 0) + 1;

      const finalEntry = {
        type:        'call',
        date:        new Date().toISOString(),
        text:        logText,
        call_id:     callId || (existingIdx >= 0 ? logs[existingIdx].call_id : null),
        duration,
        record_url:  recordUrl,
        direction,
        manager:     managerEmail,
        status,
        answered:    answered || undefined,
      };

      if (existingIdx >= 0) {
        logs[existingIdx] = { ...logs[existingIdx], ...finalEntry };
        console.log(`📞 Call.finish MERGED → lead #${lead.id} (idx=${existingIdx}): ${logText}`);
      } else {
        logs.push(finalEntry);
        console.log(`📞 Call.finish logged → lead #${lead.id}: ${logText}`);
      }

      await db.query(
        companyId
          ? 'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3 AND company_id=$4'
          : 'UPDATE crm_lead SET chatlogs=$1, actualcallattempts=$2 WHERE id=$3',
        companyId
          ? [JSON.stringify(logs), attempts, lead.id, companyId]
          : [JSON.stringify(logs), attempts, lead.id]
      );
    } else {
      try {
        const stageRes = await db.query(
          companyId
            ? 'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence LIMIT 1'
            : 'SELECT id FROM crm_stage ORDER BY sequence LIMIT 1',
          companyId ? [companyId] : []
        );
        const stageId = stageRes.rows[0]?.id || null;
        const ins = await db.query(
          `INSERT INTO crm_lead (name, phone, mizon_source, lead_score, stage_id, actualcallattempts, chatlogs, company_id)
           VALUES ($1,$2,'moizvonki',25,$3,1,$4,$5) RETURNING id`,
          [
            `Noma'lum (+${cleanPhone})`, `+${cleanPhone}`, stageId,
            JSON.stringify([{
              type: 'call', date: new Date().toISOString(),
              text: logText, call_id: callId, duration, record_url: recordUrl,
              direction, manager: managerEmail, status, answered: answered || undefined,
            }]),
            companyId
          ]
        );
        console.log(`📌 New lead + call.finish: +${cleanPhone} (id=${ins.rows[0]?.id}, stage=${stageId})`);
      } catch (e) {
        console.error(`[moizvonki] LEAD INSERT FAILED (finish) for +${cleanPhone}:`, e.message, e.stack?.split('\n')[1]);
      }
    }
    return;
  }

  // call.answer va boshqalar — log'ga yozamiz, chatlog'ga emas
  console.log(`📞 Ignored event type: ${rawEventType} (normalized: ${eventType})`);
}

// =============================================================================
//  HELPERS
// =============================================================================

function normalizeEventType(t) {
  // Numeric (Moizvonki rasmiy)
  if (t === 1 || t === '1') return 'call.start';
  if (t === 2 || t === '2') return 'call.answer';
  if (t === 4 || t === '4') return 'call.finish';
  if (t === 32 || t === '32') return 'sms.message';

  // String (qisqartmalar, partner CRM'lar)
  const s = String(t || '').toLowerCase().replace(/[^a-z.]/g, '');
  if (/start|begin|ringing|incoming|inbound|outbound|outgoing/.test(s) && !/finish|end/.test(s)) return 'call.start';
  if (/answer|bridge|connect|accepted/.test(s)) return 'call.answer';
  if (/finish|end|complete|hangup|disconnected|terminated/.test(s)) return 'call.finish';
  if (/sms|message/.test(s)) return 'sms.message';
  return s || 'unknown';
}

function parseDirection(event) {
  const d = event.direction;
  // Numeric: 0=in, 1=out (Moizvonki rasmiy)
  if (d === 0 || d === '0') return 'in';
  if (d === 1 || d === '1') return 'out';

  const raw = String(d || event.call_type || event.type || event.event || '').toLowerCase();
  if (/incoming|inbound|\bin\b/.test(raw)) return 'in';
  if (/outgoing|outbound|\bout\b/.test(raw)) return 'out';
  return 'in';
}

function normalizePhone(p) {
  let digits = String(p || '').replace(/\D/g, '');
  if (digits.length === 9 && /^[3-9]/.test(digits)) digits = '998' + digits;
  return digits;
}

function buildCallLogText(direction, phone, duration, status, /* recordUrl */ _r, /* manager */ _m) {
  // Yozuv URL'i alohida `record_url` maydonida saqlanadi va audio-pleer sifatida
  // ko'rsatiladi — text'ga URL yozmaymiz. Operator ismi ham text'ga qo'shilmaydi
  // (kerak bo'lsa frontend `manager` maydonidan alohida ko'rsatadi).
  const dir = direction === 'in' ? 'Kiruvchi' : 'Chiquvchi';
  const dur = duration > 0 ? ` (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})` : '';
  const st  = status ? ` [${status}]` : '';
  return `📞 ${dir} qo'ng'iroq: ${phone}${dur}${st}`;
}

function _truncate(s, n) { return String(s || '').slice(0, n); }

// Moizvonki javobidan xato sababini chiqarish (JSON yoki plain-text bo'lishi mumkin)
function _extractApiError(raw) {
  if (!raw) return null;
  if (raw.parsed && typeof raw.parsed === 'object') {
    return raw.parsed.error || raw.parsed.error_message || raw.parsed.message || null;
  }
  const body = String(raw.body || '').trim();
  // HTTP 2xx bo'lsa ham Moizvonki xatoni oddiy matn sifatida qaytarishi mumkin
  // (masalan qurilma ulanmagan / SMS ruxsati yo'q). Shuning uchun matnni tekshiramiz.
  if (raw.statusCode >= 200 && raw.statusCode < 300) {
    if (/^OK\b/i.test(body) || /posted/i.test(body)) return null;
    if (/\berror\b|ошибк|unknown|\bfail|denied|не удалось|no device|нет устройств|not connected/i.test(body)) {
      return body.slice(0, 300);
    }
    return null;
  }
  // HTTP 4xx/5xx → body matnini xato deb qaytaramiz
  return body.slice(0, 300) || `HTTP ${raw.statusCode}`;
}

// =============================================================================
//  MOIZVONKI API CLIENT
// =============================================================================

// Asosiy API chaqiruvchi: ixtiyoriy action + ixtiyoriy params bilan
//   { user_name, api_key, action, ...params }
//   Resolve qiladi: { statusCode, headers, body, parsed }
//   Network xato (timeout/DNS) faqat reject qiladi.
function moiZvonkiApiRaw(subdomain, userName, apiKey, action, params = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      user_name: userName,
      api_key:   apiKey,
      action:    action,
      ...params,
    });
    const options = {
      hostname: `${subdomain}.moizvonki.ru`,
      path:     '/api/v1',
      method:   'POST',
      timeout:  10000,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept':         'application/json, text/plain, */*',
        'User-Agent':     'Mizon-CRM/1.0',
      },
    };
    console.log(`[moizvonki] → POST https://${options.hostname}${options.path}  action=${action}  params=${JSON.stringify(Object.keys(params))}`);
    const reqHttp = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        console.log(`[moizvonki] ← ${resp.statusCode} ${data.slice(0, 300)}`);
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({
          statusCode: resp.statusCode,
          headers:    resp.headers,
          body:       data,
          parsed:     parsed,
        });
      });
    });
    reqHttp.on('timeout', () => { reqHttp.destroy(new Error('timeout')); });
    reqHttp.on('error', (e) => {
      console.error(`[moizvonki] network error: ${e.message}`);
      reject(e);
    });
    reqHttp.write(payload);
    reqHttp.end();
  });
}

// Backward-compat wrapper (eski kodda `moiZvonkiCallRaw(sub, user, key, to, action)` ishlatilgan bo'lsa)
function moiZvonkiCallRaw(subdomain, userName, apiKey, to, action = 'calls.make_call') {
  return moiZvonkiApiRaw(subdomain, userName, apiKey, action, { to });
}

// Webhook subscribe — 4 ta event uchun bir vaqtda
async function _subscribeMoizvonkiWebhooks(subdomain, userName, apiKey, callbackUrl) {
  try {
    const hooks = {};
    SUBSCRIBED_EVENTS.forEach(ev => { hooks[ev] = callbackUrl; });
    const r = await moiZvonkiApiRaw(subdomain, userName, apiKey, 'webhook.subscribe', { hooks });
    const apiError = _extractApiError(r);
    const ok = r.statusCode >= 200 && r.statusCode < 300 && !apiError;
    return {
      ok,
      status:  r.statusCode,
      body:    _truncate(r.body, 300),
      error:   apiError,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// =============================================================================
//  EXPORTS for tests / future routes
// =============================================================================

exports._internal = {
  moiZvonkiApiRaw,
  moiZvonkiCallRaw,
  _subscribeMoizvonkiWebhooks,
  normalizeEventType,
  parseDirection,
  normalizePhone,
  buildCallLogText,
};
