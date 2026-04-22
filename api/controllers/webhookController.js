// ========== WEBHOOK CONTROLLER ==========
const https = require('https');

// ---------- META (FACEBOOK/INSTAGRAM) ----------

// GET /api/webhook/meta — Verification endpoint (Facebook requires this)
exports.verifyMetaWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'mizon_verification_token_123';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Meta webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ Meta webhook verification failed');
    res.sendStatus(403);
  }
};

// POST /api/webhook/meta — Handle incoming Meta Lead Ads data
exports.handleMetaWebhook = async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);
    
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'leadgen') {
          const leadData = change.value;
          const leadgenId = leadData.leadgen_id;
          const formId = leadData.form_id;
          const pageId = leadData.page_id;
          
          // Fetch actual lead data from Meta Graph API
          let leadName = `Meta Lead #${leadgenId}`;
          let leadPhone = null;
          let leadEmail = null;
          
          if (process.env.META_PAGE_ACCESS_TOKEN && leadgenId) {
            try {
              const leadDetails = await fetchMetaLeadData(leadgenId, process.env.META_PAGE_ACCESS_TOKEN);
              if (leadDetails) {
                for (const field of leadDetails.field_data || []) {
                  if (field.name === 'full_name') leadName = field.values[0];
                  if (field.name === 'phone_number') leadPhone = field.values[0];
                  if (field.name === 'email') leadEmail = field.values[0];
                }
              }
            } catch (fetchErr) {
              console.error('Meta Lead fetch error:', fetchErr.message);
            }
          }
          
          if (req.db) {
            await req.db.query(
              `INSERT INTO crm_lead (name, contact_name, phone, email, mizon_source, lead_score, stage_id, chatlogs) 
               VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
              [
                leadName, leadName, leadPhone, leadEmail, 'meta_fb_ads', 30,
                JSON.stringify([{
                  type: 'sys', 
                  date: new Date().toISOString(), 
                  text: `Meta Lead Ads orqali keldi. Form: ${formId}, Page: ${pageId}`
                }])
              ]
            );
            console.log(`📌 New Meta Lead: ${leadName}`);
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('Meta Webhook Error:', err);
    res.sendStatus(500);
  }
};

// Helper: Fetch lead details from Meta Graph API
function fetchMetaLeadData(leadgenId, accessToken) {
  return new Promise((resolve, reject) => {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${accessToken}`;
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); } 
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ---------- TELEGRAM ----------

// POST /api/webhook/telegram — Handle incoming Telegram messages
exports.handleTelegramWebhook = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text || '';
    const firstName = message.from?.first_name || 'User';
    const lastName = message.from?.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim();

    // /start command — register new lead
    if (text === '/start') {
      if (req.db) {
        const existing = await req.db.query(
          'SELECT id FROM crm_lead WHERE telegram_chat_id = $1', [String(chatId)]
        );
        if (existing.rows.length === 0) {
          await req.db.query(
            `INSERT INTO crm_lead (name, contact_name, mizon_source, telegram_chat_id, lead_score, stage_id, chatlogs) 
             VALUES ($1, $2, $3, $4, $5, 1, $6)`,
            [
              fullName, fullName, 'telegram_bot', String(chatId), 20,
              JSON.stringify([{
                type: 'sys', 
                date: new Date().toISOString(), 
                text: `Telegram orqali ro'yxatdan o'tdi (@${message.from?.username || '-'})`
              }])
            ]
          );
          console.log(`📌 New Telegram Lead: ${fullName} (${chatId})`);
          
          // Send welcome message
          await sendTelegramMessage(chatId, 
            `Assalomu alaykum, ${firstName}! 👋\n\nMizon CRM tizimiga xush kelibsiz. Sizning so'rovingiz qabul qilindi. Tez orada menejerimiz siz bilan bog'lanadi.\n\nRahmat! 🙏`
          );
        } else {
          await sendTelegramMessage(chatId, 
            `${firstName}, siz allaqachon ro'yxatdan o'tgansiz. Menejerimiz tez orada aloqaga chiqadi!`
          );
        }
      }
    }
    
    // /phone XXXXX — save phone number
    else if (text.startsWith('/phone')) {
      const phone = text.replace('/phone', '').trim();
      if (phone && req.db) {
        await req.db.query(
          'UPDATE crm_lead SET phone = $1 WHERE telegram_chat_id = $2',
          [phone, String(chatId)]
        );
        await sendTelegramMessage(chatId, `✅ Telefon raqamingiz saqlandi: ${phone}`);
      }
    }
    
    // /name XXXXX — update name
    else if (text.startsWith('/name')) {
      const name = text.replace('/name', '').trim();
      if (name && req.db) {
        await req.db.query(
          'UPDATE crm_lead SET name = $1, contact_name = $1 WHERE telegram_chat_id = $2',
          [name, String(chatId)]
        );
        await sendTelegramMessage(chatId, `✅ Ismingiz yangilandi: ${name}`);
      }
    }
    
    // Any other message — log it as chat
    else if (text && req.db) {
      const lead = await req.db.query(
        'SELECT id, chatlogs FROM crm_lead WHERE telegram_chat_id = $1', [String(chatId)]
      );
      if (lead.rows.length > 0) {
        const existingLogs = lead.rows[0].chatlogs || [];
        const newLog = { type: 'telegram', date: new Date().toISOString(), text: `[Telegram] ${fullName}: ${text}` };
        existingLogs.push(newLog);
        await req.db.query(
          'UPDATE crm_lead SET chatlogs = $1 WHERE id = $2',
          [JSON.stringify(existingLogs), lead.rows[0].id]
        );
      }
    }
    
    res.sendStatus(200);
  } catch (err) {
    console.error('Telegram Webhook Error:', err);
    res.sendStatus(500);
  }
};

// Helper: Send message via Telegram Bot API
function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_BOT_TOKEN') return Promise.resolve();
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
