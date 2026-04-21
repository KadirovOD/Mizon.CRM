exports.verifyMetaWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'mizon_verification_token_123';

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
};

exports.handleMetaWebhook = async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'leadgen') {
            const leadData = change.value;
            await req.db.query(
              `INSERT INTO crm_lead (name, contact_name, mizon_source, lead_score, stage_id) 
               VALUES ($1, $2, $3, $4, 1)`,
              [`Meta Lead: ${leadData.form_id || 'Unknown'}`, 'Facebook User', 'meta_fb_ads', 30]
            );
          }
        }
      }
      res.status(200).send('EVENT_RECEIVED');
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    console.error('Meta Webhook Error:', err);
    res.sendStatus(500);
  }
};

exports.handleTelegramWebhook = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    if (text === '/start') {
      const existing = await req.db.query('SELECT id FROM crm_lead WHERE telegram_chat_id = $1', [String(chatId)]);
      if (existing.rows.length === 0) {
        await req.db.query(
          `INSERT INTO crm_lead (name, contact_name, mizon_source, telegram_chat_id, lead_score, stage_id) 
           VALUES ($1, $2, $3, $4, $5, 1)`,
          [`Telegram Lead: ${message.from.first_name || 'User'}`, message.from.first_name, 'telegram_bot', String(chatId), 20]
        );
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Telegram Webhook Error:', err);
    res.sendStatus(500);
  }
};
