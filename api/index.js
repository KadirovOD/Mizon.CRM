const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');
const { Pool } = require('pg');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'mizon-dev-secret-2024-change-in-prod';

const app = express();

// ========== DATABASE ==========
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const pool = DB_URL
  ? new Pool({
      connectionString: DB_URL,
      ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },   // Railway / Supabase / Neon SSL
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

app.use((req, res, next) => { req.db = pool; next(); });

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Raw body — webhook endpoint uchun HMAC imzoni to'g'ri tekshirish
app.use('/api/webhook/meta', express.raw({ type: 'application/json' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body.toString('utf8');
    try { req.body = JSON.parse(req.rawBody); } catch { req.body = {}; }
  }
  next();
});
app.use(express.json());

// ========== SERVE FRONTEND (local dev only) ==========
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ========== JWT MIDDLEWARE ==========
const parseToken = (req, res, next) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch { req.user = null; }
  } else { req.user = null; }
  next();
};
app.use(parseToken);

// ========== DB INIT ==========
async function initDb() {
  if (!pool) { console.log('⚠️  Database URL not configured — running in demo mode.'); return; }
  const client = await pool.connect();
  try {
    // ── Core tables ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        slug       VARCHAR(100) UNIQUE NOT NULL,
        logo_url   TEXT,
        plan       VARCHAR(20)  DEFAULT 'basic',
        is_active  BOOLEAN      DEFAULT true,
        call_limit INT          DEFAULT 5,
        created_at TIMESTAMP    DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS crm_users (
        id            SERIAL PRIMARY KEY,
        company_id    INT REFERENCES companies(id) ON DELETE CASCADE,
        username      VARCHAR(100) NOT NULL,
        password_hash TEXT NOT NULL,
        role          VARCHAR(20)  DEFAULT 'MANAGER',
        full_name     VARCHAR(255),
        is_active     BOOLEAN      DEFAULT true,
        created_at    TIMESTAMP    DEFAULT NOW(),
        UNIQUE(company_id, username)
      );

      CREATE TABLE IF NOT EXISTS crm_stage (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        sequence   INTEGER      DEFAULT 0,
        company_id INT REFERENCES companies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS crm_lead (
        id                SERIAL PRIMARY KEY,
        name              VARCHAR(255) NOT NULL,
        contact_name      VARCHAR(255),
        phone             VARCHAR(50),
        email             VARCHAR(100),
        stage_id          INTEGER REFERENCES crm_stage(id) ON DELETE SET NULL,
        mizon_source      VARCHAR(100) DEFAULT 'manual',
        telegram_chat_id  VARCHAR(100),
        lead_score        INTEGER DEFAULT 0,
        budget_range      VARCHAR(50),
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        chatlogs          JSONB DEFAULT '[]'::jsonb,
        deadline          TIMESTAMP,
        actualcallattempts INTEGER DEFAULT 0,
        taskdescription   TEXT,
        owner             VARCHAR(50) DEFAULT 'ceo',
        region            VARCHAR(255),
        pipelineid        VARCHAR(50) DEFAULT 'p1',
        company_id        INT REFERENCES companies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS crm_integration_config (
        id           SERIAL PRIMARY KEY,
        platform     VARCHAR(50)  NOT NULL,
        page_id      VARCHAR(100),
        form_id      VARCHAR(100),
        access_token TEXT,
        field_mapping JSONB DEFAULT '{}'::jsonb,
        company_id   INT REFERENCES companies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS crm_api_keys (
        id         SERIAL PRIMARY KEY,
        service    VARCHAR(100) NOT NULL,
        label      VARCHAR(255) NOT NULL,
        key_value  TEXT NOT NULL,
        company_id INT REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS crm_voip_config (
        id         SERIAL PRIMARY KEY,
        account_id VARCHAR(100) NOT NULL,
        api_token  TEXT NOT NULL,
        caller_id  VARCHAR(50) DEFAULT '',
        domain     VARCHAR(100) DEFAULT 'app.moizvonki.ru',
        company_id INT REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ── Migrations for existing tables ───────────────────────────────────────
    await client.query(`
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS chatlogs          JSONB    DEFAULT '[]'::jsonb;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS deadline          TIMESTAMP;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS actualcallattempts INTEGER  DEFAULT 0;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS taskdescription   TEXT;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS owner             VARCHAR(50) DEFAULT 'ceo';
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS region            VARCHAR(255);
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS pipelineid        VARCHAR(50) DEFAULT 'p1';
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS facebook_lead_id  VARCHAR(100) UNIQUE;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS ad_name           VARCHAR(255);
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS form_name         VARCHAR(255);
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS company_id        INT;
      ALTER TABLE crm_stage ADD COLUMN IF NOT EXISTS company_id       INT;
      ALTER TABLE crm_integration_config ADD COLUMN IF NOT EXISTS is_active   BOOLEAN   DEFAULT true;
      ALTER TABLE crm_integration_config ADD COLUMN IF NOT EXISTS extra_config JSONB    DEFAULT '{}';
      ALTER TABLE crm_integration_config ADD COLUMN IF NOT EXISTS created_at  TIMESTAMP DEFAULT NOW();
      ALTER TABLE crm_voip_config        ADD COLUMN IF NOT EXISTS company_id  INT;
    `);

    // ── Seed default company (first run / backward compat) ───────────────────
    const compCount = await client.query('SELECT COUNT(*) FROM companies');
    if (parseInt(compCount.rows[0].count) === 0) {
      console.log('🌱 Seeding default company...');
      const dc = await client.query(
        "INSERT INTO companies (name, slug, call_limit) VALUES ('Mizon Demo', 'demo', 5) RETURNING id"
      );
      const defaultCompId = dc.rows[0].id;

      // Migrate orphan leads/stages to default company
      await client.query('UPDATE crm_lead  SET company_id = $1 WHERE company_id IS NULL', [defaultCompId]);
      await client.query('UPDATE crm_stage SET company_id = $1 WHERE company_id IS NULL', [defaultCompId]);

      // Create default users
      const ceoHash = await bcrypt.hash('123', 10);
      const mgHash  = await bcrypt.hash('123', 10);
      await client.query(`
        INSERT INTO crm_users (company_id, username, password_hash, role, full_name)
        VALUES ($1,'ceo',$2,'CEO','CEO'), ($1,'menejer_1',$3,'MANAGER','Menejer 1')
        ON CONFLICT DO NOTHING
      `, [defaultCompId, ceoHash, mgHash]);

      // Seed stages if empty
      const sc = await client.query("SELECT COUNT(*) FROM crm_stage WHERE company_id = $1", [defaultCompId]);
      if (parseInt(sc.rows[0].count) === 0) {
        await client.query(`
          INSERT INTO crm_stage (name, sequence, company_id) VALUES
          ('Yangi Lead',1,$1),('Aloqaga chiqildi',2,$1),('Ehtiyoj aniqlandi',3,$1),
          ('Taklif yuborildi',4,$1),('Muzokaralar',5,$1),('Yutildi',6,$1),('Muvaffaqiyatsiz',7,$1)
        `, [defaultCompId]);
      }

      console.log(`✅ Default company created (slug=demo, CEO login: ceo/123)`);
    }

    console.log('✅ Database initialized successfully.');
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
  } finally {
    client.release();
  }
}
initDb();

// ========== CONTROLLERS ==========
const leadController       = require('./controllers/leadController');
const webhookController    = require('./controllers/webhookController');
const voipController       = require('./controllers/voipController');
const authController       = require('./controllers/authController');
const superAdminController = require('./controllers/superAdminController');
const companyController    = require('./controllers/companyController');

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status:'ok', dbConnected:!!pool, version:'V8', timestamp:new Date().toISOString() });
});

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login',  authController.login);
app.get ('/api/auth/me',     authController.me);
app.get ('/api/company/info', authController.companyInfo);

// ── Super Admin ───────────────────────────────────────────────────────────────
app.get   ('/api/superadmin/companies',              superAdminController.listCompanies);
app.post  ('/api/superadmin/companies',              superAdminController.createCompany);
app.get   ('/api/superadmin/companies/:id',          superAdminController.getCompany);
app.put   ('/api/superadmin/companies/:id',          superAdminController.updateCompany);
app.delete('/api/superadmin/companies/:id',          superAdminController.deleteCompany);
app.get   ('/api/superadmin/companies/:id/users',    superAdminController.listUsers);
app.post  ('/api/superadmin/companies/:id/users',    superAdminController.addUser);
app.delete('/api/superadmin/users/:userId',          superAdminController.deleteUser);

// ── Company user management (CEO) ────────────────────────────────────────────
app.get   ('/api/company/users',      companyController.listUsers);
app.post  ('/api/company/users',      companyController.addUser);
app.put   ('/api/company/users/:id',  companyController.updateUser);
app.delete('/api/company/users/:id',  companyController.deleteUser);

// ── Leads CRUD ───────────────────────────────────────────────────────────────
app.get   ('/api/leads',              leadController.getLeads);
app.post  ('/api/leads',              leadController.createLead);
app.put   ('/api/leads/:id',          leadController.updateLeadFull);
app.delete('/api/leads/:id',          leadController.deleteLead);
app.get   ('/api/leads/:id/chatlogs', leadController.getLeadChatlogs);
app.get   ('/api/stages',             leadController.getStages);
app.get   ('/api/stats',              leadController.getStats);

// ── Webhooks ─────────────────────────────────────────────────────────────────
app.get ('/api/webhook/meta',      webhookController.verifyMetaWebhook);
app.post('/api/webhook/meta',      webhookController.handleMetaWebhook);
app.post('/api/webhook/telegram',  webhookController.handleTelegramWebhook);
app.post('/api/webhook/moizvonki', voipController.handleWebhook);

// ── VoIP ─────────────────────────────────────────────────────────────────────
app.get ('/api/voip/config', voipController.getConfig);
app.post('/api/voip/config', voipController.saveConfig);
app.post('/api/call',        voipController.initiateCall);

// ── Integrations ─────────────────────────────────────────────────────────────

// GET /api/integrations — list integrations for this company
app.get('/api/integrations', async (req, res) => {
  if (!req.db) return res.json([]);
  const cid = req.user?.companyId || null;
  try {
    const r = await req.db.query(
      `SELECT id, platform, page_id, form_id, field_mapping, extra_config, created_at
       FROM crm_integration_config
       WHERE company_id=$1 OR company_id IS NULL
       ORDER BY id DESC`,
      [cid]
    );
    // Never return access_token to frontend
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/integrations — upsert facebook/instagram/webhook config
app.post('/api/integrations', async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const { platform, page_id, form_id, access_token, field_mapping, extra_config } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform majburiy' });
  const cid = req.user?.companyId || null;
  try {
    // Upsert: delete old then insert (keeps it clean per company per platform)
    await req.db.query(
      'DELETE FROM crm_integration_config WHERE platform=$1 AND (company_id=$2 OR company_id IS NULL)',
      [platform, cid]
    );
    await req.db.query(
      `INSERT INTO crm_integration_config
         (platform, page_id, form_id, access_token, field_mapping, extra_config, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        platform,
        page_id    || null,
        form_id    || null,
        access_token || null,
        JSON.stringify(field_mapping  || {}),
        JSON.stringify(extra_config   || {}),
        cid,
      ]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/integrations/:platform — disconnect an integration
app.delete('/api/integrations/:platform', async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId || null;
  try {
    await req.db.query(
      'DELETE FROM crm_integration_config WHERE platform=$1 AND (company_id=$2 OR company_id IS NULL)',
      [req.params.platform, cid]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/integrations/telegram/setup — save bot token + register webhook with Telegram
app.post('/api/integrations/telegram/setup', async (req, res) => {
  const { bot_token, chat_id } = req.body || {};
  if (!bot_token) return res.status(400).json({ error: 'bot_token majburiy' });
  const cid = req.user?.companyId || null;

  // Register webhook URL with Telegram Bot API
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const webhookUrl = `${appUrl}/api/webhook/telegram`;

  try {
    const tgResult = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
      const options = {
        hostname: 'api.telegram.org',
        path:     `/bot${bot_token}/setWebhook`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      };
      const request = https.request(options, (resp) => {
        let data = ''; resp.on('data', c => data += c);
        resp.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false }); } });
      });
      request.on('error', reject);
      request.write(postData); request.end();
    });

    if (!tgResult.ok) {
      return res.status(400).json({
        error: `Telegram webhook ro'yxatdan o'tmadi: ${tgResult.description || JSON.stringify(tgResult)}`,
      });
    }

    // Save to DB
    if (req.db) {
      await req.db.query(
        'DELETE FROM crm_integration_config WHERE platform=$1 AND (company_id=$2 OR company_id IS NULL)',
        ['telegram', cid]
      );
      await req.db.query(
        `INSERT INTO crm_integration_config
           (platform, access_token, extra_config, company_id)
         VALUES ('telegram', $1, $2, $3)`,
        [bot_token, JSON.stringify({ chat_id: chat_id || '', webhook_url: webhookUrl }), cid]
      );
    }

    // Update env for current runtime session
    process.env.TELEGRAM_BOT_TOKEN = bot_token;

    res.json({ success: true, webhook_url: webhookUrl, telegram: tgResult });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API Keys ─────────────────────────────────────────────────────────────────
app.get('/api/api-keys', async (req, res) => {
  if (!req.db) return res.json([]);
  const cid = req.user?.companyId;
  try {
    const r = await req.db.query(
      'SELECT id,service,label,created_at FROM crm_api_keys WHERE company_id=$1 OR company_id IS NULL ORDER BY created_at DESC',
      [cid]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/api-keys', async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const { service, label, key_value } = req.body;
  if (!service || !label || !key_value) return res.status(400).json({ error: 'service, label, key_value majburiy' });
  const cid = req.user?.companyId || null;
  try {
    const r = await req.db.query(
      'INSERT INTO crm_api_keys (service,label,key_value,company_id) VALUES ($1,$2,$3,$4) RETURNING id,service,label,created_at',
      [service, label, key_value, cid]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/api-keys/:id', async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  try {
    await req.db.query('DELETE FROM crm_api_keys WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// (company/info is handled by authController above)

// ── Frontend SPA fallback ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api'))
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ========== START SERVER ==========
// Always listen — works on Railway (production) and local dev both
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Mizon CRM — port ${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/api/health`);
  console.log(`🗄️  DB: ${DB_URL ? 'PostgreSQL ulandi' : 'Demo rejim (DB yo\'q)'}`);
});

module.exports = app; // keep for testing / serverless compatibility
