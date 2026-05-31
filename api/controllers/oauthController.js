/**
 * OAuth controller — Facebook va Instagram integratsiyasi uchun
 * Env vars kerak:  FB_APP_ID | META_APP_ID
 *                  FB_APP_SECRET | META_APP_SECRET
 *                  APP_URL  (masalan: https://mizoncrm.up.railway.app)
 */
const https = require('https');

const FB_APP_ID     = process.env.FB_APP_ID     || process.env.META_APP_ID     || '';
const FB_APP_SECRET = process.env.FB_APP_SECRET || process.env.META_APP_SECRET || '';

// ── Helper: GET json from Facebook Graph API ──────────────────────────────────
function fbGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, resp => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message || JSON.stringify(json.error)));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Helper: render popup close page with postMessage ─────────────────────────
function popupReply(res, data) {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
<script>
try {
  if (window.opener) {
    window.opener.postMessage(${payload}, '*');
  } else {
    // If opened as full page (not popup), store in localStorage and redirect
    localStorage.setItem('oauth_result', ${payload});
    window.location.href = '/';
  }
} catch(e) {}
setTimeout(() => window.close(), 500);
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#555">
  Ma'lumotlar uzatilmoqda, oyna yopilmoqda...
</p>
</body></html>`);
}

// ── GET /api/oauth/facebook/init ──────────────────────────────────────────────
exports.fbInit = (req, res) => {
  if (!FB_APP_ID) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:30px">
        <h3>⚠️ Facebook ilovasi sozlanmagan</h3>
        <p>Railway sozlamalarida quyidagilarni qo'shing:</p>
        <pre style="background:#f5f5f5;padding:14px;border-radius:8px">
FB_APP_ID     = &lt;Facebook App ID&gt;
FB_APP_SECRET = &lt;Facebook App Secret&gt;
APP_URL       = https://sizning-domen.uz</pre>
        <p><a href="https://developers.facebook.com/apps/">Meta Developer Console</a>da App ID olishingiz mumkin.</p>
        <button onclick="window.close()" style="margin-top:14px;padding:10px 20px;background:#1877F2;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Yopish</button>
      </body></html>
    `);
  }
  const appUrl      = process.env.APP_URL || `https://${req.headers.host}`;
  const callbackUrl = `${appUrl}/api/oauth/facebook/callback`;
  const state       = req.query.state || 'fb_' + Date.now();
  const scope       = 'pages_show_list,leads_retrieval,pages_read_engagement,ads_management';
  const fbUrl       = `https://www.facebook.com/dialog/oauth?client_id=${encodeURIComponent(FB_APP_ID)}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scope}&state=${state}&response_type=code`;
  res.redirect(fbUrl);
};

// ── GET /api/oauth/facebook/callback ─────────────────────────────────────────
exports.fbCallback = async (req, res) => {
  const { code, error, error_description } = req.query;
  const appUrl      = process.env.APP_URL || `https://${req.headers.host}`;
  const callbackUrl = `${appUrl}/api/oauth/facebook/callback`;

  if (error) {
    return popupReply(res, { type: 'fb_oauth_error', error: error_description || error });
  }
  if (!code) {
    return popupReply(res, { type: 'fb_oauth_error', error: 'code parametri kelmadi' });
  }

  try {
    // 1. Code → short-lived token
    const tokResp  = await fbGet(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(FB_APP_ID)}&redirect_uri=${encodeURIComponent(callbackUrl)}&client_secret=${encodeURIComponent(FB_APP_SECRET)}&code=${code}`
    );
    // 2. Short-lived → long-lived (60 kunlik)
    const longResp = await fbGet(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(FB_APP_ID)}&client_secret=${encodeURIComponent(FB_APP_SECRET)}&fb_exchange_token=${tokResp.access_token}`
    );
    const longToken = longResp.access_token || tokResp.access_token;

    // 3. Foydalanuvchiga tegishli Sahifalar ro'yxati
    const pagesResp = await fbGet(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}&fields=id,name,access_token,instagram_business_account&limit=50`
    );
    const pages = (pagesResp.data || []).map(p => ({
      id:           p.id,
      name:         p.name,
      access_token: p.access_token,
      ig_account:   p.instagram_business_account || null,
    }));

    popupReply(res, { type: 'fb_oauth_success', token: longToken, pages });
  } catch (e) {
    popupReply(res, { type: 'fb_oauth_error', error: e.message });
  }
};

// ── GET /api/oauth/facebook/forms?page_id=...&page_token=... ──────────────────
exports.fbForms = async (req, res) => {
  const { page_id, page_token } = req.query;
  if (!page_id || !page_token)
    return res.status(400).json({ error: 'page_id va page_token kerak' });
  try {
    const resp = await fbGet(
      `https://graph.facebook.com/v19.0/${page_id}/leadgen_forms?access_token=${page_token}&fields=id,name,status&limit=100`
    );
    res.json(resp.data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── GET /api/oauth/instagram/init ─────────────────────────────────────────────
exports.igInit = (req, res) => {
  if (!FB_APP_ID) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:30px">
        <h3>⚠️ Meta ilovasi sozlanmagan</h3>
        <p>FB_APP_ID va FB_APP_SECRET env o'zgaruvchilarini to'ldiring.</p>
        <button onclick="window.close()" style="margin-top:14px;padding:10px 20px;background:#E4405F;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Yopish</button>
      </body></html>
    `);
  }
  const appUrl      = process.env.APP_URL || `https://${req.headers.host}`;
  const callbackUrl = `${appUrl}/api/oauth/instagram/callback`;
  const state       = req.query.state || 'ig_' + Date.now();
  const scope       = 'instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list,pages_read_engagement';
  const fbUrl       = `https://www.facebook.com/dialog/oauth?client_id=${encodeURIComponent(FB_APP_ID)}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scope}&state=${state}&response_type=code`;
  res.redirect(fbUrl);
};

// ── GET /api/oauth/instagram/callback ────────────────────────────────────────
exports.igCallback = async (req, res) => {
  const { code, error, error_description } = req.query;
  const appUrl      = process.env.APP_URL || `https://${req.headers.host}`;
  const callbackUrl = `${appUrl}/api/oauth/instagram/callback`;

  if (error) {
    return popupReply(res, { type: 'ig_oauth_error', error: error_description || error });
  }
  if (!code) {
    return popupReply(res, { type: 'ig_oauth_error', error: 'code parametri kelmadi' });
  }

  try {
    const tokResp  = await fbGet(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(FB_APP_ID)}&redirect_uri=${encodeURIComponent(callbackUrl)}&client_secret=${encodeURIComponent(FB_APP_SECRET)}&code=${code}`
    );
    const longResp = await fbGet(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(FB_APP_ID)}&client_secret=${encodeURIComponent(FB_APP_SECRET)}&fb_exchange_token=${tokResp.access_token}`
    );
    const longToken = longResp.access_token || tokResp.access_token;

    // Sahifalar + ulangan Instagram Business hisoblari
    const pagesResp = await fbGet(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}&fields=id,name,access_token,instagram_business_account{id,name,username}&limit=50`
    );
    const accounts = (pagesResp.data || [])
      .filter(p => p.instagram_business_account)
      .map(p => ({
        page_id:       p.id,
        page_name:     p.name,
        access_token:  p.access_token,
        ig_id:         p.instagram_business_account.id,
        ig_name:       p.instagram_business_account.name,
        ig_username:   p.instagram_business_account.username,
      }));

    popupReply(res, { type: 'ig_oauth_success', token: longToken, accounts });
  } catch (e) {
    popupReply(res, { type: 'ig_oauth_error', error: e.message });
  }
};
