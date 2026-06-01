// ========== WEBHOOK CONTROLLER ==========
// Odoo CRM usuli asosida: Meta Lead Ads, Instagram DM, Telegram Bot
const https  = require('https');
const crypto = require('crypto');

// Automation trigger (index.js tomonidan o'rnatiladi)
let _runTrigger = null;
exports._setAutomation = (fn) => { _runTrigger = fn; };
const runTrigger = (...args) => { if (_runTrigger) _runTrigger(...args).catch(()=>{}); };

// ── Meta App Secret signature verification (X-Hub-Signature-256) ────────────
function verifyMetaSignature(rawBody, signature) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature) return true; // dev: skip
  try {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret)
      .update(rawBody, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
}

// ── Normalize all standard Meta Lead Ads field names → Mizon CRM fields ──────
// Source: Meta Lead Ads field_data format (Odoo crm.lead mapping pattern)
const META_FIELD_MAP = {
  // Name variants
  full_name:          'name',     first_name:       '_first',
  last_name:          '_last',    name:             'name',
  // Contact
  email:              'email',    email_address:    'email',
  phone_number:       'phone',    phone:            'phone',
  mobile_phone:       'phone',    telefon:          'phone',
  // Location
  city:               'region',   state:            'region',
  province:           'region',   country:          'region',
  district:           'region',   region:           'region',
  viloyat:            'region',   shahar:           'region',
  // Company / job
  company_name:       'company',  company:          'company',
  job_title:          'job',      occupation:       'job',
  // Notes
  comments:           'note',     message:          'note',
  description:        'note',     question:         'note',
  additional_info:    'note',
  // Address
  street:             'address',  address:          'address',
  zip_code:           'address',
};

function normalizeMetaFields(fieldData, customMapping = {}) {
  let first = '', last = '';
  const result = {};
  for (const f of fieldData || []) {
    const raw  = (f.values || [])[0] || '';
    const key  = (f.name || '').toLowerCase().replace(/\s+/g, '_');
    // Custom mapping first (from crm_integration_config.field_mapping)
    const target = customMapping[f.name] || customMapping[key] || META_FIELD_MAP[key];
    if (!target || !raw) continue;
    if (target === '_first') { first = raw; continue; }
    if (target === '_last')  { last  = raw; continue; }
    if (!result[target]) result[target] = raw; // first-wins
  }
  if (first || last)
    result.name = result.name || [first, last].filter(Boolean).join(' ');
  return result;
}

// ── Fetch lead details from Meta Graph API v19.0 ──────────────────────────────
function fetchMetaLeadData(leadgenId, accessToken) {
  return new Promise((resolve, reject) => {
    const fields = 'field_data,ad_name,form_name,created_time,ad_id';
    const url = `https://graph.facebook.com/v19.0/${leadgenId}`
      + `?fields=${encodeURIComponent(fields)}`
      + `&access_token=${encodeURIComponent(accessToken)}`;
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) return reject(new Error(`Graph API: ${p.error.message}`));
          resolve(p);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Fetch Instagram sender profile ────────────────────────────────────────────
function fetchIgProfile(igScopedId, accessToken) {
  return new Promise((resolve) => {
    const url = `https://graph.facebook.com/v19.0/${igScopedId}`
      + `?fields=name,username`
      + `&access_token=${encodeURIComponent(accessToken)}`;
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    }).on('error', () => resolve({}));
  });
}

// ── GET /api/webhook/meta — Meta verification handshake ──────────────────────
// Meta sends: ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// Must respond 200 with challenge value
exports.verifyMetaWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const VERIFY    = process.env.META_VERIFY_TOKEN || 'mizon_meta_webhook_v1';

  if (mode === 'subscribe' && token === VERIFY) {
    console.log('✅ Meta webhook verified');
    return res.status(200).send(challenge);
  }
  console.warn('❌ Meta webhook verification failed. Expected token:', VERIFY);
  res.sendStatus(403);
};

// ── POST /api/webhook/meta — Facebook Lead Ads + Instagram DMs ───────────────
exports.handleMetaWebhook = async (req, res) => {
  // ACK immediately — Meta requires response within 10 seconds
  res.status(200).send('EVENT_RECEIVED');

  // Signature check (HMAC-SHA256) — rawBody middleware tomonidan to'ldiriladi
  const rawBody = req.rawBody || JSON.stringify(req.body);
  if (!verifyMetaSignature(rawBody, req.headers['x-hub-signature-256'])) {
    console.warn('❌ Meta webhook: invalid signature');
    return;
  }

  const body = req.body;

  try {
    // ── FACEBOOK LEAD ADS (object: 'page') ───────────────────────────────────
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== 'leadgen') continue;

          const { leadgen_id, form_id, page_id } = change.value;
          if (!leadgen_id || !req.db) continue;

          // Duplicate guard
          const dup = await req.db.query(
            'SELECT id FROM crm_lead WHERE facebook_lead_id=$1 LIMIT 1',
            [String(leadgen_id)]
          );
          if (dup.rows.length) {
            console.log(`↩️  FB lead ${leadgen_id} allaqachon mavjud`);
            continue;
          }

          // Load integration config: access_token + field_mapping + company_id
          const cfgRes = await req.db.query(
            `SELECT access_token, field_mapping, company_id
             FROM crm_integration_config
             WHERE platform IN ('facebook','instagram')
               AND (form_id=$1 OR page_id=$2 OR form_id IS NULL)
             ORDER BY (CASE WHEN form_id=$1 THEN 0 WHEN page_id=$2 THEN 1 ELSE 2 END) ASC
             LIMIT 1`,
            [String(form_id), String(page_id)]
          );
          const cfg         = cfgRes.rows[0] || {};
          const accessToken = cfg.access_token || process.env.META_PAGE_ACCESS_TOKEN;
          const mapping     = parseJson(cfg.field_mapping, {});
          const companyId   = cfg.company_id || null;

          // Fetch full lead data from Graph API
          let fields = {}, adName = null, formName = null;
          if (accessToken) {
            try {
              const detail = await fetchMetaLeadData(String(leadgen_id), accessToken);
              adName   = detail.ad_name   || null;
              formName = detail.form_name || null;
              fields   = normalizeMetaFields(detail.field_data, mapping);
            } catch (e) { console.error('Graph API fetch error:', e.message); }
          }

          // Fallback: use raw field_data from webhook payload if Graph API failed
          if (!fields.name && change.value.field_data) {
            fields = normalizeMetaFields(change.value.field_data, mapping);
          }

          const leadName = fields.name || `Facebook Lead #${leadgen_id}`;

          // Get first stage for this company
          const stageRes = await req.db.query(
            companyId
              ? 'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence ASC LIMIT 1'
              : 'SELECT id FROM crm_stage ORDER BY sequence ASC LIMIT 1',
            companyId ? [companyId] : []
          );
          const stageId = stageRes.rows[0]?.id || 1;

          // Build task description from extra fields
          const extraParts = [
            fields.company && `Kompaniya: ${fields.company}`,
            fields.job     && `Lavozim: ${fields.job}`,
            fields.note    && `Izoh: ${fields.note}`,
            fields.address && `Manzil: ${fields.address}`,
          ].filter(Boolean);

          await req.db.query(
            `INSERT INTO crm_lead
               (name, contact_name, phone, email, region, taskdescription,
                mizon_source, lead_score, stage_id,
                facebook_lead_id, ad_name, form_name, company_id, chatlogs)
             VALUES ($1,$2,$3,$4,$5,$6,'facebook',35,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (facebook_lead_id) DO NOTHING`,
            [
              leadName, leadName,
              fields.phone  || null,
              fields.email  || null,
              fields.region || null,
              extraParts.join(' | ') || null,
              stageId,
              String(leadgen_id), adName, formName, companyId,
              JSON.stringify([{
                type: 'sys', date: new Date().toISOString(),
                text: `📘 Facebook Lead Ads | Reklama: ${adName||'-'} | Form: ${formName||form_id} | Page: ${page_id}`,
              }]),
            ]
          );
          console.log(`📌 FB lead saved: "${leadName}" (form=${form_id}, ad="${adName||'-'}")`);
        }
      }
    }

    // ── INSTAGRAM DMs (object: 'instagram') ──────────────────────────────────
    // Instagram sends messaging events (DMs) with object='instagram'
    if (body.object === 'instagram') {
      for (const entry of body.entry || []) {
        for (const msg of entry.messaging || []) {
          // Skip echo messages (bot's own messages)
          if (msg.message?.is_echo) continue;
          const senderId = msg.sender?.id;
          if (!senderId || !req.db) continue;

          const text    = msg.message?.text || '';
          const igKey   = 'ig_' + senderId; // unique key for IG leads

          // Load IG integration config
          const cfgRes = await req.db.query(
            "SELECT access_token, company_id FROM crm_integration_config WHERE platform='instagram' ORDER BY id DESC LIMIT 1"
          );
          const cfg       = cfgRes.rows[0] || {};
          const token     = cfg.access_token || process.env.META_PAGE_ACCESS_TOKEN;
          const companyId = cfg.company_id || null;

          // Check for existing lead by IG sender ID (stored in telegram_chat_id column)
          const existing = await req.db.query(
            'SELECT id, chatlogs FROM crm_lead WHERE telegram_chat_id=$1 LIMIT 1',
            [igKey]
          );

          if (existing.rows.length === 0) {
            // New IG lead — try to fetch sender profile
            let profileName = `Instagram User`;
            if (token) {
              try {
                const profile = await fetchIgProfile(senderId, token);
                profileName = profile.name || (profile.username ? `@${profile.username}` : profileName);
              } catch {}
            }

            const phone   = extractPhone(text);
            const email   = extractEmail(text);
            const stageRes = await req.db.query(
              companyId
                ? 'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence ASC LIMIT 1'
                : 'SELECT id FROM crm_stage ORDER BY sequence ASC LIMIT 1',
              companyId ? [companyId] : []
            );
            const stageId = stageRes.rows[0]?.id || 1;

            const newIgLead = await req.db.query(
              `INSERT INTO crm_lead
                 (name, contact_name, phone, email, mizon_source,
                  telegram_chat_id, lead_score, stage_id, company_id, chatlogs)
               VALUES ($1,$2,$3,$4,'instagram',$5,25,$6,$7,$8) RETURNING *`,
              [
                profileName, profileName, phone, email,
                igKey, stageId, companyId,
                JSON.stringify([
                  { type: 'sys',       date: new Date().toISOString(), text: `📸 Instagram DM orqali keldi (IGSID: ${senderId})` },
                  ...(text ? [{ type: 'instagram', date: new Date().toISOString(), text: `[Instagram] ${profileName}: ${text}` }] : []),
                ]),
              ]
            );
            console.log(`📌 Instagram lead: "${profileName}" (id=${senderId})`);
            // Avtomatizatsiya triggeri — yangi IG DM
            if (newIgLead.rows[0]) {
              runTrigger(req.db, 'ig_dm', newIgLead.rows[0], { senderId });
            }
          } else if (text) {
            // Append to existing lead's chatlogs
            const logs = existing.rows[0].chatlogs || [];
            const phone = extractPhone(text);
            const email = extractEmail(text);
            if (phone) await req.db.query('UPDATE crm_lead SET phone=COALESCE(phone,$1) WHERE id=$2', [phone, existing.rows[0].id]);
            if (email) await req.db.query('UPDATE crm_lead SET email=COALESCE(email,$1) WHERE id=$2', [email, existing.rows[0].id]);
            logs.push({ type: 'instagram', date: new Date().toISOString(), text: `[Instagram] ${text}` });
            await req.db.query('UPDATE crm_lead SET chatlogs=$1 WHERE id=$2', [JSON.stringify(logs), existing.rows[0].id]);
          }
        }
      }
    }
  } catch (err) {
    console.error('Meta Webhook Error:', err.message);
  }
};

// ── POST /api/webhook/telegram ────────────────────────────────────────────────
// Telegram Update object: https://core.telegram.org/bots/api#update
exports.handleTelegramWebhook = async (req, res) => {
  res.sendStatus(200); // ACK immediately

  try {
    const update = req.body;

    // ── Inline keyboard callback_query ───────────────────────────────────────
    if (update.callback_query) {
      const cq      = update.callback_query;
      const token   = await getTelegramToken(req.db);
      await sendTelegramMsg(token, cq.message.chat.id, `✅ ${cq.data}`);
      return;
    }

    const message = update.message;
    if (!message) return;

    const chatId    = message.chat.id;
    const text      = message.text || '';
    const firstName = message.from?.first_name || 'Foydalanuvchi';
    const lastName  = message.from?.last_name  || '';
    const username  = message.from?.username   || '';
    const fullName  = [firstName, lastName].filter(Boolean).join(' ');
    const token     = await getTelegramToken(req.db);

    if (!req.db) return;

    // ── Contact sharing (user taps "Raqamimni ulashish" button) ─────────────
    if (message.contact) {
      const contactPhone = message.contact.phone_number;
      await req.db.query(
        'UPDATE crm_lead SET phone=$1 WHERE telegram_chat_id=$2',
        [contactPhone, String(chatId)]
      );
      await sendTelegramMsg(token, chatId,
        `✅ Telefon raqamingiz saqlandi: ${contactPhone}\n\nMenejerimiz tez orada aloqaga chiqadi! 👍`,
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    // ── Commands ─────────────────────────────────────────────────────────────
    if (text.startsWith('/phone ')) {
      const phone = text.replace('/phone', '').trim();
      await req.db.query('UPDATE crm_lead SET phone=$1 WHERE telegram_chat_id=$2', [phone, String(chatId)]);
      await sendTelegramMsg(token, chatId, `✅ Telefon saqlandi: ${phone}`);
      return;
    }
    if (text.startsWith('/email ')) {
      const email = text.replace('/email', '').trim();
      await req.db.query('UPDATE crm_lead SET email=$1 WHERE telegram_chat_id=$2', [email, String(chatId)]);
      await sendTelegramMsg(token, chatId, `✅ Email saqlandi: ${email}`);
      return;
    }
    if (text.startsWith('/name ')) {
      const name = text.replace('/name', '').trim();
      await req.db.query(
        'UPDATE crm_lead SET name=$1, contact_name=$1 WHERE telegram_chat_id=$2',
        [name, String(chatId)]
      );
      await sendTelegramMsg(token, chatId, `✅ Ismingiz yangilandi: ${name}`);
      return;
    }

    // ── Check existing lead ──────────────────────────────────────────────────
    const existing = await req.db.query(
      'SELECT id, chatlogs FROM crm_lead WHERE telegram_chat_id=$1 LIMIT 1',
      [String(chatId)]
    );

    if (existing.rows.length === 0) {
      // NEW LEAD — any first message creates a lead (not just /start)
      const phone = extractPhone(text);
      const email = extractEmail(text);

      const stageRes = await req.db.query('SELECT id FROM crm_stage ORDER BY sequence ASC LIMIT 1');
      const stageId  = stageRes.rows[0]?.id || 1;

      await req.db.query(
        `INSERT INTO crm_lead
           (name, contact_name, phone, email, mizon_source,
            telegram_chat_id, lead_score, stage_id, chatlogs)
         VALUES ($1,$2,$3,$4,'telegram_bot',$5,20,$6,$7)`,
        [
          fullName, fullName, phone, email, String(chatId), stageId,
          JSON.stringify([
            { type: 'sys',      date: new Date().toISOString(), text: `✈️ Telegram bot orqali keldi (@${username || chatId})` },
            ...(text && text !== '/start'
              ? [{ type: 'telegram', date: new Date().toISOString(), text: `[Telegram] ${fullName}: ${text}` }]
              : []),
          ]),
        ]
      );
      console.log(`📌 Telegram lead: "${fullName}" (@${username}, chatId=${chatId})`);

      // Welcome + contact-share keyboard
      await sendTelegramMsg(token, chatId,
        `Assalomu alaykum, ${firstName}! 👋\n\n` +
        `So'rovingiz qabul qilindi. Menejerimiz tez orada siz bilan bog'lanadi.\n\n` +
        `📞 Telefon raqamingizni ulashing yoki:\n` +
        `/phone +998XXXXXXXXX`,
        {
          reply_markup: {
            keyboard: [[{ text: '📱 Raqamimni ulashish', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
    } else {
      // EXISTING LEAD — append message / update fields
      if (text && text !== '/start') {
        const logs  = existing.rows[0].chatlogs || [];
        const phone = extractPhone(text);
        const email = extractEmail(text);

        // Auto-fill phone/email if not yet saved
        if (phone) await req.db.query('UPDATE crm_lead SET phone=COALESCE(phone,$1) WHERE id=$2', [phone, existing.rows[0].id]);
        if (email) await req.db.query('UPDATE crm_lead SET email=COALESCE(email,$1) WHERE id=$2', [email, existing.rows[0].id]);

        logs.push({ type: 'telegram', date: new Date().toISOString(), text: `[Telegram] ${fullName}: ${text}` });
        await req.db.query('UPDATE crm_lead SET chatlogs=$1 WHERE id=$2', [JSON.stringify(logs), existing.rows[0].id]);
      } else if (text === '/start') {
        await sendTelegramMsg(token, chatId,
          `${firstName}, siz allaqachon ro'yxatdan o'tgansiz! ✅\nMenejerimiz tez orada aloqaga chiqadi.`
        );
      }
    }
  } catch (err) {
    console.error('Telegram Webhook Error:', err.message);
  }
};

// ── Internal helpers ──────────────────────────────────────────────────────────

// Extract phone number from free text
function extractPhone(text) {
  const m = (text || '').match(/(\+?\d[\d\s\-().]{7,14}\d)/);
  return m ? m[1].replace(/[\s\-().]/g, '') : null;
}

// Extract email from free text
function extractEmail(text) {
  const m = (text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

// Parse JSON safely
function parseJson(val, fallback) {
  if (typeof val === 'object' && val !== null) return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// Load Telegram bot token: env var first, then DB
async function getTelegramToken(db) {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken && envToken !== 'YOUR_BOT_TOKEN') return envToken;
  if (!db) return null;
  try {
    const r = await db.query(
      "SELECT access_token FROM crm_integration_config WHERE platform='telegram' ORDER BY id DESC LIMIT 1"
    );
    return r.rows[0]?.access_token || null;
  } catch { return null; }
}

// Send Telegram message with optional extra params (keyboard, etc.)
function sendTelegramMsg(token, chatId, text, extra = {}) {
  if (!token) return Promise.resolve();
  return new Promise((resolve) => {
    const postData = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra });
    const options  = {
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };
    const req = https.request(options, (resp) => {
      let data = ''; resp.on('data', c => data += c); resp.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.write(postData); req.end();
  });
}

// Export for use in other controllers (e.g. index.js telegram/setup)
exports._sendTelegramMsg = sendTelegramMsg;
exports._getTelegramToken = getTelegramToken;
