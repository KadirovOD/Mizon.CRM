const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const path        = require('path');
const https       = require('https');
const { Pool }    = require('pg');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'mizon-dev-secret-2024-change-in-prod';

// ── Muhim: default kalitlar haqida ogohlantirish ─────────────────────────────
if (!process.env.JWT_SECRET)
  console.warn('⚠️  JWT_SECRET env o\'zgaruvchisi o\'rnatilmagan — standart kalit ishlatilmoqda! Production uchun XAVFLI!');
if (!process.env.SUPER_ADMIN_PASS)
  console.warn('⚠️  SUPER_ADMIN_PASS env o\'zgaruvchisi o\'rnatilmagan — standart parol ishlatilmoqda!');

const app = express();

// ========== DATABASE ==========
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const pool = DB_URL
  ? new Pool({
      connectionString: DB_URL,
      ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },   // Railway / Supabase / Neon SSL
      max: 20,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 10000,
    })
  : null;

app.use((req, res, next) => { req.db = pool; next(); });

// Gzip kompressiya — JSON response hajmini 60-70% kamaytiradi
app.use(compression());

app.use(cors({
  origin: (origin, cb) => {
    // Allow: no origin (curl, mobile), localhost, mizon-crm.uz + all subdomains
    if (
      !origin ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin === 'https://mizon-crm.uz' ||
      origin === 'https://www.mizon-crm.uz' ||
      /^https:\/\/[a-z0-9-]+\.mizon-crm\.uz$/.test(origin)
    ) return cb(null, true);
    cb(null, false); // reject unknown origins (not 403 — CORS just won't attach header)
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
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
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders: (res, filePath) => {
    if (/react(-dom)?\.production\.min\.js$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/(app\.js|index\.html)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ========== JWT MIDDLEWARE ==========
const parseToken = (req, res, next) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch { req.user = null; }
  } else { req.user = null; }
  next();
};
app.use(parseToken);

// ── Auth enforcement: barcha /api/* marshrutlar (ochiq yo'llardan tashqari) JWT talab qiladi ──
const _PUBLIC_PATHS    = new Set(['/api/health', '/api/auth/login', '/api/auth/me', '/api/company/info']);
const _PUBLIC_PREFIXES = ['/api/webhook/', '/api/oauth/', '/api/public/'];
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (_PUBLIC_PATHS.has(req.path)) return next();
  if (_PUBLIC_PREFIXES.some(p => req.path.startsWith(p))) return next();
  if (!req.user) return res.status(401).json({ error: 'Tizimga kiring' });
  next();
});

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
        taskassignee      VARCHAR(100),
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

      CREATE TABLE IF NOT EXISTS automation_sms_settings (
        id              SERIAL PRIMARY KEY,
        company_id      INT UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
        eskiz_email     VARCHAR(255),
        eskiz_password  TEXT,
        updated_at      TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS automation_templates (
        id         SERIAL PRIMARY KEY,
        company_id INT REFERENCES companies(id) ON DELETE CASCADE,
        name       VARCHAR(255) NOT NULL,
        message    TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS automation_rules (
        id           SERIAL PRIMARY KEY,
        company_id   INT REFERENCES companies(id) ON DELETE CASCADE,
        name         VARCHAR(255) NOT NULL,
        trigger_type VARCHAR(50) NOT NULL,
        template_id  INT REFERENCES automation_templates(id) ON DELETE SET NULL,
        stage_filter INT,
        is_active    BOOLEAN DEFAULT true,
        created_at   TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS automation_logs (
        id         SERIAL PRIMARY KEY,
        company_id INT REFERENCES companies(id) ON DELETE CASCADE,
        rule_id    INT REFERENCES automation_rules(id) ON DELETE SET NULL,
        lead_id    INT,
        lead_name  VARCHAR(255),
        phone      VARCHAR(50),
        message    TEXT,
        status     VARCHAR(20) DEFAULT 'sent',
        error_msg  TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Migrations for existing tables ───────────────────────────────────────
    await client.query(`
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS chatlogs          JSONB    DEFAULT '[]'::jsonb;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS deadline          TIMESTAMP;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS actualcallattempts INTEGER  DEFAULT 0;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS taskdescription   TEXT;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS taskassignee      VARCHAR(100);
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
      ALTER TABLE automation_rules       ADD COLUMN IF NOT EXISTS action_type VARCHAR(20) DEFAULT 'sms';
      ALTER TABLE crm_users              ADD COLUMN IF NOT EXISTS email       VARCHAR(255);
      ALTER TABLE crm_stage              ADD COLUMN IF NOT EXISTS is_won       BOOLEAN DEFAULT false;
      ALTER TABLE crm_stage              ADD COLUMN IF NOT EXISTS is_lost      BOOLEAN DEFAULT false;
      ALTER TABLE crm_lead               ADD COLUMN IF NOT EXISTS custom_data  JSONB   DEFAULT '{}'::jsonb;
      ALTER TABLE companies              ADD COLUMN IF NOT EXISTS form_title   TEXT;
      ALTER TABLE companies              ADD COLUMN IF NOT EXISTS form_subtitle TEXT;
      ALTER TABLE companies              ADD COLUMN IF NOT EXISTS extra_settings JSONB  DEFAULT '{}'::jsonb;
      ALTER TABLE companies              ADD COLUMN IF NOT EXISTS email        VARCHAR(255);
    `);

    // ── system_config jadvali (super admin paroli va boshqa konfiguratsiyalar) ─
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Billing: tariflar, obunalar, hisob-fakturalar ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_plans (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100)  NOT NULL,
        price      NUMERIC(14,2) NOT NULL DEFAULT 0,
        period     VARCHAR(10)   DEFAULT 'month',
        call_limit INT,
        user_limit INT,
        lead_limit INT,
        features   JSONB    DEFAULT '{}'::jsonb,
        is_active  BOOLEAN  DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        id         SERIAL PRIMARY KEY,
        company_id INT UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
        plan_id    INT REFERENCES billing_plans(id) ON DELETE SET NULL,
        status     VARCHAR(20) DEFAULT 'pending',
        started_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP,
        auto_renew BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS billing_invoices (
        id              SERIAL PRIMARY KEY,
        company_id      INT REFERENCES companies(id) ON DELETE CASCADE,
        subscription_id INT REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
        amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
        currency        VARCHAR(8) DEFAULT 'UZS',
        status          VARCHAR(20) DEFAULT 'pending',
        period_start    TIMESTAMP,
        period_end      TIMESTAMP,
        paid_at         TIMESTAMP,
        payment_method  VARCHAR(50),
        note            TEXT,
        created_at      TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Mavjud bosqichlarda is_won / is_lost ni yangilash ───────────────────────
    await client.query("UPDATE crm_stage SET is_won=true  WHERE name='Yutildi'         AND (is_won  IS NULL OR is_won=false)");
    await client.query("UPDATE crm_stage SET is_lost=true WHERE name='Muvaffaqiyatsiz' AND (is_lost IS NULL OR is_lost=false)");

    // ── Kompaniyasiz (NULL) integratsiya va API kalitlarini birinchi kompaniyaga bog'lash ──
    const _firstComp = await client.query('SELECT id FROM companies ORDER BY id ASC LIMIT 1');
    if (_firstComp.rows.length > 0) {
      const _fid = _firstComp.rows[0].id;
      await client.query('UPDATE crm_integration_config SET company_id=$1 WHERE company_id IS NULL', [_fid]);
      await client.query('UPDATE crm_api_keys           SET company_id=$1 WHERE company_id IS NULL', [_fid]);
    }

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
          INSERT INTO crm_stage (name, sequence, company_id, is_won, is_lost) VALUES
          ('Yangi Lead',1,$1,false,false),('Aloqaga chiqildi',2,$1,false,false),
          ('Ehtiyoj aniqlandi',3,$1,false,false),('Taklif yuborildi',4,$1,false,false),
          ('Muzokaralar',5,$1,false,false),('Yutildi',6,$1,true,false),
          ('Muvaffaqiyatsiz',7,$1,false,true)
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
initDb().then(() => {
  // DB tayyor bo'lgandan keyin SA parolini yuklash
  if (pool) {
    const saCtrl = require('./controllers/superAdminController');
    saCtrl.loadSaPassword(pool).catch(() => {});

    // Billing: muddati tugagan obunalarni tekshirish (start'da + har soatda)
    const billingCtrl = require('./controllers/billingController');
    billingCtrl.runExpiryCheck(pool);
    setInterval(() => billingCtrl.runExpiryCheck(pool), 60 * 60 * 1000);
  }
});

// ========== CONTROLLERS ==========
const leadController       = require('./controllers/leadController');
const webhookController    = require('./controllers/webhookController');
const voipController       = require('./controllers/voipController');
const authController       = require('./controllers/authController');
const superAdminController = require('./controllers/superAdminController');
const companyController    = require('./controllers/companyController');
const oauthController      = require('./controllers/oauthController');
const automationCtrl       = require('./controllers/automationController');
const billingController    = require('./controllers/billingController');

// leadController va webhookController ga runTrigger uzatish
leadController._setAutomation(automationCtrl.runTrigger);
webhookController._setAutomation(automationCtrl.runTrigger);

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status:'ok', dbConnected:!!pool, version:'V20', timestamp:new Date().toISOString() });
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
app.put   ('/api/superadmin/users/:userId',          superAdminController.updateUser);
app.delete('/api/superadmin/users/:userId',          superAdminController.deleteUser);
// Task 4: Super admin parol o'zgartirish
app.put   ('/api/superadmin/password',               superAdminController.changePassword);

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
app.put   ('/api/stages/sync',        leadController.syncStages);
app.get   ('/api/stats',              leadController.getStats);

// ── Company settings (CEO) ────────────────────────────────────────────────────
app.get('/api/company/settings', companyController.getSettings);
app.put('/api/company/settings', companyController.updateSettings);

// ── Webhooks ─────────────────────────────────────────────────────────────────
app.get ('/api/webhook/meta',      webhookController.verifyMetaWebhook);
app.post('/api/webhook/meta',      webhookController.handleMetaWebhook);
app.post('/api/webhook/telegram',  webhookController.handleTelegramWebhook);
app.post('/api/webhook/moizvonki', voipController.handleWebhook);

// POST /api/webhook/sheets — Google Sheets Apps Script dan keluvchi leadlar
// JWT talab qilinmaydi (Apps Script serveri to'g'ridan-to'g'ri chaqiradi)
app.post('/api/webhook/sheets', async (req, res) => {
  try {
    const body        = req.body || {};
    const slug        = (body.company_slug || req.query.company || req.query.slug || '').trim();
    const name        = (body.name  || '').trim();
    const phone       = (body.phone || '').trim();
    const email       = (body.email || '').trim();
    const region      = (body.region || body.city || '').trim();
    const note        = (body.note  || body.comment || '').trim();
    const rowIndex    = body.row_index || null; // Takrorlanishni aniqlash uchun

    if (!req.db)  return res.status(503).json({ error: 'DB disabled' });
    if (!slug)    return res.status(400).json({ error: 'company_slug majburiy' });
    if (!name && !phone) return res.status(400).json({ error: 'name yoki phone majburiy' });

    // Kompaniyani topish
    const cR = await req.db.query(
      'SELECT id FROM companies WHERE slug=$1 AND is_active=true LIMIT 1', [slug]
    );
    if (!cR.rows.length) return res.status(404).json({ error: 'Kompaniya topilmadi' });
    const companyId = cR.rows[0].id;

    // Telefon bo'yicha takrorlanishni tekshirish
    if (phone) {
      const clean = phone.replace(/\D/g, '');
      if (clean.length >= 7) {
        const dup = await req.db.query(
          "SELECT id FROM crm_lead WHERE REGEXP_REPLACE(phone, '\\D', '', 'g')=$1 AND company_id=$2 LIMIT 1",
          [clean, companyId]
        );
        if (dup.rows.length) {
          return res.json({ success: true, duplicate: true, id: dup.rows[0].id });
        }
      }
    }

    // Birinchi bosqichni olish
    const stageR = await req.db.query(
      'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence ASC LIMIT 1', [companyId]
    );
    const stageId = stageR.rows[0]?.id || 1;

    // taskdescription — qo'shimcha maydonlar
    const extraParts = [
      note   && `Izoh: ${note}`,
    ].filter(Boolean);

    const inserted = await req.db.query(
      `INSERT INTO crm_lead
         (name, phone, email, region, taskdescription,
          mizon_source, lead_score, stage_id, company_id, chatlogs)
       VALUES ($1,$2,$3,$4,$5,'google_sheets',30,$6,$7,$8) RETURNING id`,
      [
        name || `+${phone}`,
        phone || null,
        email || null,
        region || null,
        extraParts.join(' | ') || null,
        stageId, companyId,
        JSON.stringify([{
          type: 'sys',
          date: new Date().toISOString(),
          text: `📊 Google Sheets orqali keldi${rowIndex ? ` (qator ${rowIndex})` : ''}`,
        }]),
      ]
    );

    console.log(`📊 Google Sheets lead: "${name || phone}" → company=${slug} id=${inserted.rows[0].id}`);
    res.json({ success: true, id: inserted.rows[0].id });
  } catch (err) {
    console.error('Sheets webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── VoIP ─────────────────────────────────────────────────────────────────────
app.get ('/api/voip/config',    voipController.getConfig);
app.post('/api/voip/config',    voipController.saveConfig);
app.post('/api/call',           voipController.initiateCall);
app.get ('/api/calls/recent',   voipController.getRecentEvents); // frontend polling uchun

// ── Automation ───────────────────────────────────────────────────────────────
app.get   ('/api/automation/sms-settings',       automationCtrl.getSmsSettings);
app.post  ('/api/automation/sms-settings',       automationCtrl.saveSmsSettings);
app.post  ('/api/automation/sms-settings/test',  automationCtrl.testSmsSettings);
app.get   ('/api/automation/templates',          automationCtrl.getTemplates);
app.post  ('/api/automation/templates',          automationCtrl.createTemplate);
app.put   ('/api/automation/templates/:id',      automationCtrl.updateTemplate);
app.delete('/api/automation/templates/:id',      automationCtrl.deleteTemplate);
app.get   ('/api/automation/rules',              automationCtrl.getRules);
app.post  ('/api/automation/rules',              automationCtrl.createRule);
app.put   ('/api/automation/rules/:id',          automationCtrl.updateRule);
app.delete('/api/automation/rules/:id',          automationCtrl.deleteRule);
app.get   ('/api/automation/logs',               automationCtrl.getLogs);

// ── OAuth ─────────────────────────────────────────────────────────────────────
app.get('/api/oauth/facebook/init',      oauthController.fbInit);
app.get('/api/oauth/facebook/callback',  oauthController.fbCallback);
app.get('/api/oauth/facebook/forms',     oauthController.fbForms);
app.get('/api/oauth/instagram/init',     oauthController.igInit);
app.get('/api/oauth/instagram/callback', oauthController.igCallback);

// ── Integrations ─────────────────────────────────────────────────────────────
// Facebook va Instagram bir kompaniyada bir nechta sahifa/hisobni qo'llab-quvvatlaydi
const MULTI_PLATFORMS = ['facebook', 'instagram'];

// GET /api/integrations — list integrations for this company
app.get('/api/integrations', async (req, res) => {
  if (!req.db) return res.json([]);
  const cid = req.user?.companyId || null;
  try {
    const r = await req.db.query(
      `SELECT id, platform, page_id, form_id, field_mapping, extra_config, created_at
       FROM crm_integration_config
       WHERE company_id=$1
       ORDER BY id DESC`,
      [cid]
    );
    // Never return access_token to frontend
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/integrations — upsert (single) or append (multi) integration
app.post('/api/integrations', async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const { platform, page_id, form_id, access_token, field_mapping, extra_config } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform majburiy' });
  const cid = req.user?.companyId || null;
  try {
    // Bir nechta ulash: facebook/instagram uchun eskisini o'chirmaymiz
    if (!MULTI_PLATFORMS.includes(platform)) {
      await req.db.query(
        'DELETE FROM crm_integration_config WHERE platform=$1 AND company_id=$2',
        [platform, cid]
      );
    }
    const r = await req.db.query(
      `INSERT INTO crm_integration_config
         (platform, page_id, form_id, access_token, field_mapping, extra_config, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        platform,
        page_id       || null,
        form_id       || null,
        access_token  || null,
        JSON.stringify(field_mapping || {}),
        JSON.stringify(extra_config  || {}),
        cid,
      ]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/integrations/id/:id — specific row (facebook/instagram multi-entry)
app.delete('/api/integrations/id/:id', async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId || null;
  try {
    await req.db.query(
      'DELETE FROM crm_integration_config WHERE id=$1 AND company_id=$2',
      [req.params.id, cid]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/integrations/:platform — disconnect ALL of a platform
app.delete('/api/integrations/:platform', async (req, res) => {
  if (!req.db) return res.status(500).json({ error: 'DB disabled' });
  const cid = req.user?.companyId || null;
  try {
    await req.db.query(
      'DELETE FROM crm_integration_config WHERE platform=$1 AND company_id=$2',
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
        'DELETE FROM crm_integration_config WHERE platform=$1 AND company_id=$2',
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
      'SELECT id,service,label,created_at FROM crm_api_keys WHERE company_id=$1 ORDER BY created_at DESC',
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
  const cid = req.user?.companyId || null;
  try {
    await req.db.query(
      'DELETE FROM crm_api_keys WHERE id=$1 AND company_id=$2',
      [req.params.id, cid]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// (company/info is handled by authController above)

// ── Billing (obuna / to'lov) ──────────────────────────────────────────────────
app.get   ('/api/billing/plans',            billingController.listPlans);
app.post  ('/api/billing/plans',            billingController.createPlan);
app.put   ('/api/billing/plans/:id',        billingController.updatePlan);
app.delete('/api/billing/plans/:id',        billingController.deletePlan);
app.get   ('/api/billing/subscriptions',    billingController.listSubscriptions);
app.post  ('/api/billing/subscriptions',    billingController.assignPlan);
app.get   ('/api/billing/invoices',         billingController.listInvoices);
app.post  ('/api/billing/invoices',         billingController.createInvoice);
app.put   ('/api/billing/invoices/:id/pay', billingController.markInvoicePaid);
app.get   ('/api/billing/me',               billingController.myBilling);

// ── Tashqi veb-forma: JWT talab qilinmaydi ────────────────────────────────────
// POST /api/public/leads — mijoz veb-forma orqali lead yuboradi (company_slug bilan)
app.post('/api/public/leads', async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  const {
    company_slug,
    name,
    phone  = null,
    email  = null,
    region = 'Veb-Sayt',
    source = 'website',
    pipelineId = 'p1',
    extra  = '',
  } = req.body || {};

  if (!company_slug || !company_slug.trim())
    return res.status(400).json({ error: 'company_slug majburiy' });
  if (!name || !name.trim())
    return res.status(400).json({ error: 'Ism majburiy' });

  try {
    // 1. Kompaniyani slug bo'yicha topish
    const compRow = await req.db.query(
      'SELECT id FROM companies WHERE slug=$1 AND is_active=true LIMIT 1',
      [company_slug.trim()]
    );
    if (!compRow.rows.length)
      return res.status(404).json({ error: 'Kompaniya topilmadi yoki faol emas' });
    const cid = compRow.rows[0].id;

    // 2. Kompaniyaning birinchi bosqichini olish
    const firstStage = await req.db.query(
      'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence ASC LIMIT 1',
      [cid]
    );
    const stageId = firstStage.rows[0]?.id || null;

    // 3. Lead ballini hisoblash
    let score = 30; // website manbaasi
    if (phone) score += 20;
    if (email) score += 10;

    const sysNote = extra
      ? `Tashqi veb-forma: ${extra}`
      : "Tashqi veb-forma orqali yuborildi";

    // 4. Leadni yaratish
    const newLead = await req.db.query(
      `INSERT INTO crm_lead
         (name, contact_name, phone, email, mizon_source, lead_score,
          stage_id, region, owner, pipelineid, chatlogs, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        name.trim(), name.trim(),
        phone || null, email || null,
        source, score,
        stageId,
        region || 'Veb-Sayt',
        'Navbatda',
        pipelineId || 'p1',
        JSON.stringify([{ type:'sys', date: new Date().toISOString(), text: sysNote }]),
        cid,
      ]
    );

    console.log(`🌐 Tashqi forma lead: "${name}" → company=${company_slug} id=${newLead.rows[0].id}`);
    res.status(201).json({ success: true, id: newLead.rows[0].id });
  } catch (err) {
    console.error('Public lead error:', err.message);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

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
