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

// ── V58: Sanitize/Validate yordamchi funksiyalari (Custom Webhook xavfsizligi uchun) ─
// HTML/script teglarni va boshqaruv belgilarini olib tashlash, max uzunlikni cheklash.
// Tashqi formaning name/extra/region kabi matn maydonlari uchun XSS himoyasi.
function sanitizeText(s, maxLen = 500) {
  if (s == null) return s;
  return String(s)
    .replace(/<\s*(script|iframe|style|object|embed|link|meta|svg)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|style|object|embed|link|meta|svg)[^>]*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')                                          // qolgan barcha HTML teglar
    .replace(/javascript\s*:/gi, '')                                  // javascript: URI scheme
    .replace(/on\w+\s*=/gi, '')                                       // onclick=, onerror= va h.k.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')                 // control belgilar
    .trim()
    .slice(0, maxLen);
}

// RFC 5322 ga yaqinroq email tekshiruvi (oddiy, lekin yetarli)
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email.trim());
}

// Telefon raqam validatsiyasi — faqat raqamlar 7-15 oralig'ida bo'lishi kerak (E.164)
function isValidPhone(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

// Telefonni faqat raqamga tushirish (deduplication uchun)
function phoneDigitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ── V59: Webhook Faollik Jurnal (in-memory ring buffer) ─────────────────────
// /api/public/leads har bir so'rovi (success, duplicate, error) shu yerga yoziladi.
// Front-end CRM panel ichidan GET /api/webhook-log/recent va /stats orqali ko'rsatadi.
// LIMIT: 500 ta yozuv (eskilari avtomatik chiqib ketadi); RAM da, restart bilan tozalanadi.
// Production uchun keyinchalik (V60+) DB jadvaliga ko'chirish mumkin.
const WEBHOOK_LOG_MAX = 500;
const webhookLogs     = [];

function logWebhookRequest(entry) {
  const safe = {
    id:          Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    ts:          new Date().toISOString(),
    company_id:  entry.company_id    || null,
    company_slug:entry.company_slug  || null,
    status:      entry.status        || 'unknown',       // success | duplicate | error
    http_status: entry.http_status   || 0,
    lead_id:     entry.lead_id       || null,
    source_ip:   entry.source_ip     || null,
    ua:          (entry.ua || '').slice(0, 200),
    name:        (entry.name || '').slice(0, 100),
    // Telefonni qisman maskalash: +998xx****yy (privacy uchun)
    phone_mask:  maskPhone(entry.phone || ''),
    email_mask:  maskEmail(entry.email || ''),
    auth_method: entry.auth_method   || 'slug',          // slug | bearer
    error_msg:   (entry.error_msg || '').slice(0, 250),
    duration_ms: entry.duration_ms   || 0,
  };
  webhookLogs.push(safe);
  if (webhookLogs.length > WEBHOOK_LOG_MAX) {
    webhookLogs.splice(0, webhookLogs.length - WEBHOOK_LOG_MAX);
  }
}

function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 5) return p || '';
  if (d.length <= 7) return d.slice(0, 2) + '*'.repeat(d.length - 4) + d.slice(-2);
  return d.slice(0, 4) + '*'.repeat(Math.max(d.length - 6, 2)) + d.slice(-2);
}
function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 2) return s ? s[0] + '***' : '';
  return s[0] + '***' + s.slice(at - 1);
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection?.remoteAddress || '')
    .toString().split(',')[0].trim().slice(0, 64);
}

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

// V58: Permissive CORS for /api/public/* — mijoz saytlari (har qanday origin) uchun
//   Bu ROUTE-SPECIFIC middleware app.use(cors(...)) dan OLDIN turishi shart, chunki:
//   strict cors() OPTIONS requestlarni darhol yopadi (preflightContinue:false default)
//   shuning uchun /api/public/* uchun avval permissive cors ishlaydi va OPTIONS ni handle qiladi
app.use('/api/public/', cors({
  origin: true,                                       // har qanday origin'ga ruxsat
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,                                 // cookie/auth header'larsiz public endpoint
  maxAge: 86400,                                      // 24 soat preflight cache
}));

// Asosiy (strict) CORS — boshqa barcha endpointlar uchun
app.use(cors({
  origin: (origin, cb) => {
    // Allow: no origin (curl, mobile), localhost, mizon-crm.uz + all subdomains
    if (
      !origin ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin === 'https://mizon-crm.uz' ||
      origin === 'https://www.mizon-crm.uz' ||
      /^https:\/\/[a-z0-9-]+\.mizon-crm\.uz$/.test(origin) ||
      /^https:\/\/yd-school-qabul[a-z0-9-]*\.vercel\.app$/.test(origin)
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
        user_name  VARCHAR(100) NOT NULL,
        api_key    TEXT NOT NULL,
        subdomain  VARCHAR(100) NOT NULL DEFAULT 'app',
        caller_id  VARCHAR(50)  DEFAULT '',
        company_id INT REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS crm_call_events (
        call_id    VARCHAR(120),
        event_type VARCHAR(40),
        company_id INT,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (call_id, event_type)
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

      -- V60: Doimiy audit jurnal (lid o'chsa ham yozuv saqlanib qoladi).
      -- chatlogs JSONB lid bilan birga o'chib ketadi → kim, qachon, qaysi lidni
      -- o'chirgani aniqlanmas edi. Bu jadval shu kamchilikni yopadi.
      -- Kelajakda boshqa "doimiy" hodisalar (massa import, massa o'chirish,
      -- bosqich o'zgarishi snapshot) ham shu yerga yozilishi mumkin (action field
      -- enum sifatida ishlatiladi).
      CREATE TABLE IF NOT EXISTS crm_audit_log (
        id          BIGSERIAL PRIMARY KEY,
        company_id  INT REFERENCES companies(id) ON DELETE CASCADE,
        lead_id     INTEGER,                            -- nullable: lid o'chgandan keyin ham yozuv qoladi
        lead_name   VARCHAR(255),                       -- snapshot — o'chgan lid nomi
        lead_phone  VARCHAR(50),                        -- snapshot
        action      VARCHAR(40) NOT NULL,               -- 'delete' | (kelajakda: 'edit', 'bulk_delete', ...)
        actor_user  VARCHAR(100),                       -- kim bajardi (req.user.username)
        actor_role  VARCHAR(40),
        details     JSONB DEFAULT '{}'::jsonb,          -- qo'shimcha (stage_title, owner, chatlogs_count, va h.k.)
        created_at  TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_company_created ON crm_audit_log(company_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_lead             ON crm_audit_log(lead_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_action           ON crm_audit_log(action);
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
      ALTER TABLE crm_voip_config        ADD COLUMN IF NOT EXISTS subdomain   VARCHAR(100);
      ALTER TABLE crm_users              ADD COLUMN IF NOT EXISTS moizvonki_email VARCHAR(255);
      DO $do$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_voip_config' AND column_name='account_id') THEN
          ALTER TABLE crm_voip_config RENAME COLUMN account_id TO user_name;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_voip_config' AND column_name='api_token') THEN
          ALTER TABLE crm_voip_config RENAME COLUMN api_token TO api_key;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_voip_config' AND column_name='domain') THEN
          UPDATE crm_voip_config SET subdomain = COALESCE(NULLIF(REPLACE(REPLACE(domain, '.moizvonki.ru', ''), 'https://', ''), ''), 'app') WHERE subdomain IS NULL;
          ALTER TABLE crm_voip_config DROP COLUMN domain;
        END IF;
      END $do$;
      ALTER TABLE automation_rules       ADD COLUMN IF NOT EXISTS action_type VARCHAR(20) DEFAULT 'sms';
      -- SMS Master (smsmaster.uz / RBSoft Gateway) provider — Eskiz bilan yonma-yon
      ALTER TABLE automation_sms_settings ADD COLUMN IF NOT EXISTS provider           VARCHAR(20) DEFAULT 'eskiz';
      ALTER TABLE automation_sms_settings ADD COLUMN IF NOT EXISTS smsmaster_api_key  TEXT;
      ALTER TABLE automation_sms_settings ADD COLUMN IF NOT EXISTS smsmaster_devices  TEXT;
      ALTER TABLE automation_sms_settings ADD COLUMN IF NOT EXISTS smsmaster_use_random BOOLEAN DEFAULT true;
      -- Kiruvchi SMS Master xabarlari uchun idempotency (webhook qayta-qayta kelishi mumkin)
      CREATE TABLE IF NOT EXISTS sms_master_events (
        sms_id     VARCHAR(120) PRIMARY KEY,
        company_id INT,
        received_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE crm_users              ADD COLUMN IF NOT EXISTS email       VARCHAR(255);
      ALTER TABLE crm_stage              ADD COLUMN IF NOT EXISTS is_won       BOOLEAN DEFAULT false;
      ALTER TABLE crm_stage              ADD COLUMN IF NOT EXISTS is_lost      BOOLEAN DEFAULT false;
      ALTER TABLE crm_lead               ADD COLUMN IF NOT EXISTS custom_data  JSONB   DEFAULT '{}'::jsonb;
      ALTER TABLE crm_lead               ADD COLUMN IF NOT EXISTS claimed_at   TIMESTAMP;
      ALTER TABLE crm_lead               ADD COLUMN IF NOT EXISTS claimed_by   VARCHAR(50);
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

    // ── NORMALIZATSIYA: kompaniya bo'yicha bir nechta is_won/is_lost bo'lsa, faqat eng oxirgisini saqlash ──
    // (Yandi-davr kabi hodisalardan keyin avtomatik tozalash: 'Uchrashuvga keldi' va 'Shartnoma' ikkalasi
    // ham WON belgilangan bo'lsa, faqat eng yuqori sequence bo'lganini WON qoldiramiz.)
    try {
      const _wonFix = await client.query(`
        UPDATE crm_stage SET is_won=false
        WHERE is_won=true AND id NOT IN (
          SELECT DISTINCT ON (company_id) id FROM crm_stage
          WHERE is_won=true ORDER BY company_id, sequence DESC, id DESC
        )
      `);
      const _lostFix = await client.query(`
        UPDATE crm_stage SET is_lost=false
        WHERE is_lost=true AND id NOT IN (
          SELECT DISTINCT ON (company_id) id FROM crm_stage
          WHERE is_lost=true ORDER BY company_id, sequence DESC, id DESC
        )
      `);
      // Bir bosqich ham WON ham LOST bo'lmasligi kerak
      await client.query("UPDATE crm_stage SET is_lost=false WHERE is_won=true AND is_lost=true");
      if ((_wonFix.rowCount || 0) > 0 || (_lostFix.rowCount || 0) > 0) {
        console.log(`🔧 Stage normalization: ${_wonFix.rowCount || 0} ortiqcha is_won va ${_lostFix.rowCount || 0} ortiqcha is_lost belgilari olib tashlandi`);
      }
    } catch (e) {
      console.warn('Stage normalization skip:', e.message);
    }

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
const smsMasterCtrl        = require('./controllers/smsMasterController');
const billingController    = require('./controllers/billingController');
const metaCapiController   = require('./controllers/metaCapiController');

// leadController va webhookController ga runTrigger uzatish
leadController._setAutomation(automationCtrl.runTrigger);
webhookController._setAutomation(automationCtrl.runTrigger);

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status:'ok', dbConnected:!!pool, version:'V39', timestamp:new Date().toISOString() });
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
app.post  ('/api/leads/:id/claim',    leadController.claimLead);
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
    let   name        = (body.name  || '').trim();
    let   phone       = (body.phone || '').trim().replace(/^p\s*:/i, '').trim();
    let   email       = (body.email || '').trim();
    let   region      = (body.region || body.city || '').trim();
    let   note        = (body.note  || body.comment || '').trim();
    const rowIndex    = body.row_index || null; // Takrorlanishni aniqlash uchun

    // ── Defensive: eski/noto'g'ri Apps Script yuborgan "axlat" qiymatlarni tozalash
    //   Misol: name=`l:2615049168914961` (Meta lead_id), phone=`2026-06-19T03:26:16-05:00`
    const looksLikeMetaId = (s) => /^[a-z]+\s*:\s*\d{6,}$/i.test(s);
    const looksLikeIsoTs  = (s) => /^\d{4}-\d{2}-\d{2}[T ]/.test(s);
    const phoneDigits     = (s) => (s||'').replace(/\D/g,'');

    const badJunk = [];
    if (name && (looksLikeMetaId(name) || looksLikeIsoTs(name))) {
      badJunk.push(`ism="${name}"`);
      name = '';
    }
    if (phone && (looksLikeIsoTs(phone) || phoneDigits(phone).length < 7 || phoneDigits(phone).length > 15)) {
      badJunk.push(`tel="${phone}"`);
      phone = '';
    }
    // Agar region ham timestamp/id bo'lsa — tozalaymiz
    if (region && (looksLikeMetaId(region) || looksLikeIsoTs(region))) { badJunk.push(`region="${region}"`); region=''; }
    if (badJunk.length) {
      console.warn(`⚠️ Sheets webhook tozalash (slug=${slug} row=${rowIndex}):`, badJunk.join(', '));
      note = (note ? note + ' | ' : '') + 'Apps Script eski versiya - ustunlar aralash keldi: ' + badJunk.join(', ');
    }

    if (!req.db)  return res.status(503).json({ error: 'DB disabled' });
    if (!slug)    return res.status(400).json({ error: 'company_slug majburiy' });
    if (!name && !phone) {
      console.warn(`⚠️ Sheets webhook: name va phone ikkalasi ham yo'q (slug=${slug} row=${rowIndex})`);
      return res.status(400).json({ error: 'name yoki phone majburiy', hint: 'Apps Script ustunlarini tekshiring' });
    }

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

    // ── V51: BARCHA qo'shimcha formdan kelgan maydonlarni custom_data ga saqlaymiz
    //   (cardFields ushbu kalitlar bo'yicha lid kartasida ko'rsatadi)
    const SHEETS_STANDARD = new Set([
      'name','phone','email','region','city','note','comment',
      'company_slug','slug','company','source','row_index','rowindex',
    ]);
    const customDataSheets = {};
    for (const [k, v] of Object.entries(body || {})) {
      const lk = String(k || '').toLowerCase();
      if (SHEETS_STANDARD.has(lk)) continue;
      if (v == null || v === '' || (typeof v === 'object' && Array.isArray(v) && !v.length)) continue;
      customDataSheets[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }

    const inserted = await req.db.query(
      `INSERT INTO crm_lead
         (name, phone, email, region, taskdescription,
          mizon_source, lead_score, stage_id, company_id, chatlogs, custom_data)
       VALUES ($1,$2,$3,$4,$5,'google_sheets',30,$6,$7,$8,$9) RETURNING id`,
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
        JSON.stringify(customDataSheets),
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
app.get   ('/api/voip/config',           voipController.getConfig);
app.post  ('/api/voip/config',           voipController.saveConfig);
app.delete('/api/voip/config',           voipController.deleteConfig);
app.post  ('/api/voip/test',                  voipController.testConnection);          // diagnostika
app.get   ('/api/voip/webhook-activity',      voipController.getWebhookActivity);      // kelgan POST'lar log'i
app.get   ('/api/voip/webhook-subscriptions', voipController.getWebhookSubscriptions); // Moizvonki'da ro'yxatdan o'tgan callback URL'lar
app.post  ('/api/voip/subscribe-webhooks',    voipController.subscribeWebhooks);       // qo'lda webhook re-sync
app.post  ('/api/call',                       voipController.initiateCall);
app.get   ('/api/calls/recent',               voipController.getRecentEvents);

// ── Automation ───────────────────────────────────────────────────────────────
app.get   ('/api/automation/sms-settings',       automationCtrl.getSmsSettings);
app.post  ('/api/automation/sms-settings',       automationCtrl.saveSmsSettings);
app.post  ('/api/automation/sms-settings/test',  automationCtrl.testSmsSettings);

// ── SMS Master (smsmaster.uz) ────────────────────────────────────────────────
app.get ('/api/sms-master/balance',  smsMasterCtrl.getBalance);
app.get ('/api/sms-master/devices',  smsMasterCtrl.getDevices);
app.post('/api/sms-master/test',     smsMasterCtrl.testSend);
// Kiruvchi SMS webhook — SMS Master form-urlencoded jo'natadi (JSON emas).
// Auth: HMAC-SHA256 X-SG-Signature header ichida verify qilinadi.
app.post('/api/webhook/smsmaster',
  express.urlencoded({ extended: true, limit: '2mb' }),
  smsMasterCtrl.handleWebhook
);
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

// ── Meta CAPI (Conversions API) ─────────────────────────────────────────────
app.get   ('/api/integrations/meta-capi',       metaCapiController.getConfig);
app.put   ('/api/integrations/meta-capi',       metaCapiController.saveConfig);
app.delete('/api/integrations/meta-capi',       metaCapiController.deleteConfig);
app.post  ('/api/integrations/meta-capi/test',  metaCapiController.testEvent);
app.post  ('/api/integrations/meta-capi/send',  metaCapiController.sendEvent);

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

// ── V60: Doimiy Audit Jurnal — lid o'chirish va boshqa "lid o'chsa ham qoladigan" hodisalar ──
// GET /api/audit-log/recent?limit=200&action=delete — joriy kompaniya audit yozuvlari
//   chatlogs JSONB lid bilan o'chib ketsa ham, bu yerdagi yozuvlar saqlanib qoladi.
app.get('/api/audit-log/recent', async (req, res) => {
  if (!req.db) return res.json({ items: [] });
  const cid = req.user?.companyId;
  if (!cid) return res.status(401).json({ error: 'Tizimga kiring' });
  const limit  = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const action = (req.query.action || '').trim();   // ixtiyoriy filter: 'delete'
  try {
    const params = [cid];
    let where = 'company_id = $1';
    if (action) { params.push(action); where += ` AND action = $${params.length}`; }
    params.push(limit);
    const r = await req.db.query(
      `SELECT id, company_id, lead_id, lead_name, lead_phone, action,
              actor_user, actor_role, details, created_at
         FROM crm_audit_log
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ items: r.rows, count: r.rows.length });
  } catch (e) {
    console.error('audit-log/recent error:', e.message);
    res.status(500).json({ error: e.message });
  }
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
  // V59: Har bir return nuqtasida webhookLogs ga yozish uchun helper
  const _startedAt = Date.now();
  const _ctx = {
    company_slug: null, company_id: null, name: '', phone: '', email: '',
    auth_method: 'slug', source_ip: clientIp(req), ua: req.headers['user-agent'] || '',
  };
  const _LOG = (status, http_status, extra = {}) => {
    logWebhookRequest({
      ..._ctx, status, http_status,
      duration_ms: Date.now() - _startedAt,
      ...extra,
    });
  };

  if (!req.db) {
    _LOG('error', 503, { error_msg: 'Database not configured' });
    return res.status(503).json({ error: 'Database not configured' });
  }
  let {
    company_slug,
    name,
    phone  = null,
    email  = null,
    region = 'Veb-Sayt',
    source = 'website',
    pipelineId,                       // V57: hardcoded 'p1' default olib tashlandi — pastda kompaniyaning haqiqiy 1-pipeline'i topiladi
    extra  = '',
    custom_data: bodyCustomData,
  } = req.body || {};

  // V58: SANITIZATSIYA — XSS himoyasi (HTML/script teglar, javascript: URI, on* eventlar)
  if (name)         name         = sanitizeText(name,         200);
  if (extra)        extra        = sanitizeText(extra,        1000);
  if (region)       region       = sanitizeText(region,       100);
  if (source)       source       = sanitizeText(source,       50);
  if (company_slug) company_slug = String(company_slug).trim().slice(0, 100);
  if (email)        email        = String(email).trim().slice(0, 254);
  if (phone)        phone        = String(phone).trim().slice(0, 50);

  // V59: kontekstga yozib qo'yamiz — keyingi log entry larida ishlatish uchun
  _ctx.company_slug = company_slug || null;
  _ctx.name         = name  || '';
  _ctx.phone        = phone || '';
  _ctx.email        = email || '';

  if (!company_slug) {
    _LOG('error', 400, { error_msg: 'company_slug majburiy' });
    return res.status(400).json({ error: 'company_slug majburiy' });
  }
  if (!name || !name.trim()) {
    _LOG('error', 400, { error_msg: 'Ism majburiy' });
    return res.status(400).json({ error: 'Ism majburiy' });
  }

  // V58: VALIDATSIYA — email va telefon format tekshiruvi (agar yuborilgan bo'lsa)
  if (email && !isValidEmail(email)) {
    _LOG('error', 400, { error_msg: "Email format noto'g'ri: " + email });
    return res.status(400).json({ error: "Email format noto'g'ri", field: 'email', value: email });
  }
  if (phone && !isValidPhone(phone)) {
    _LOG('error', 400, { error_msg: "Telefon noto'g'ri: " + phone });
    return res.status(400).json({ error: "Telefon raqam noto'g'ri (7-15 raqam bo'lishi kerak)", field: 'phone', value: phone });
  }

  try {
    // V58: API KEY BEARER AUTH (ixtiyoriy) — agar Authorization header yuborilsa, tekshiriladi
    //   crm_api_keys jadvalidan key_value bo'yicha topiladi va company_id mosligini tekshiramiz
    //   Header yuborilmasa — slug-based auth (backward compatible)
    let apiKeyCompanyId = null;
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        _ctx.auth_method = 'bearer';
        try {
          const keyRow = await req.db.query(
            'SELECT company_id FROM crm_api_keys WHERE key_value=$1 LIMIT 1',
            [token]
          );
          if (!keyRow.rows.length) {
            console.warn(`🔐 Yaroqsiz API kalit urinishi: slug=${company_slug} ip=${req.ip}`);
            _LOG('error', 401, { error_msg: 'Yaroqsiz API kalit' });
            return res.status(401).json({ error: "Yaroqsiz API kalit" });
          }
          apiKeyCompanyId = keyRow.rows[0].company_id;
        } catch (e) {
          console.error('🔐 API kalit tekshirib bo\'lmadi:', e.message);
          _LOG('error', 500, { error_msg: 'Auth tekshirib bo\'lmadi: ' + e.message });
          return res.status(500).json({ error: "Auth tekshirib bo'lmadi" });
        }
      }
    }

    // 1. Kompaniyani slug bo'yicha topish
    const compRow = await req.db.query(
      'SELECT id FROM companies WHERE slug=$1 AND is_active=true LIMIT 1',
      [company_slug]
    );
    if (!compRow.rows.length) {
      _LOG('error', 404, { error_msg: 'Kompaniya topilmadi (slug=' + company_slug + ')' });
      return res.status(404).json({ error: 'Kompaniya topilmadi yoki faol emas' });
    }
    const cid = compRow.rows[0].id;
    _ctx.company_id = cid;

    // V58: Agar API kalit yuborilgan bo'lsa — uning company_id si slugdagi kompaniyaga mos kelishini tekshiramiz
    //   (boshqa kompaniyaning kaliti bilan boshqa kompaniyaga lead yuborishni bloklash)
    if (apiKeyCompanyId !== null && apiKeyCompanyId !== cid) {
      console.warn(`🔐 API kalit boshqa kompaniyaga tegishli: key_company=${apiKeyCompanyId} slug_company=${cid} slug=${company_slug}`);
      _LOG('error', 403, { error_msg: `API kalit boshqa kompaniyaga (key_cid=${apiKeyCompanyId})` });
      return res.status(403).json({ error: "API kalit boshqa kompaniyaga tegishli" });
    }

    // V58: DEDUPLICATION — telefon raqam bo'yicha takrorlangan lidlarni bloklash
    //   Spam botlar bir xil formaga 100 marta yuborganda 100 ta dublikat bo'lib qolmaydi
    //   (Sheets endpointida allaqachon bor edi — endi /api/public/leads ham qoshildi)
    if (phone) {
      const digits = phoneDigitsOnly(phone);
      if (digits.length >= 7) {
        const dup = await req.db.query(
          "SELECT id, name FROM crm_lead WHERE REGEXP_REPLACE(phone, '\\D', '', 'g')=$1 AND company_id=$2 LIMIT 1",
          [digits, cid]
        );
        if (dup.rows.length) {
          console.log(`🌐 Dublikat skip: phone=${phone} → existing_id=${dup.rows[0].id} ("${dup.rows[0].name}") company=${company_slug}`);
          _LOG('duplicate', 200, { lead_id: dup.rows[0].id });
          return res.json({
            success:   true,
            duplicate: true,
            id:        dup.rows[0].id,
            message:   `Bu telefon raqam allaqachon bazada bor (#${dup.rows[0].id})`,
          });
        }
      }
    }

    // 2. Kompaniyaning birinchi bosqichini olish
    const firstStage = await req.db.query(
      'SELECT id FROM crm_stage WHERE company_id=$1 ORDER BY sequence ASC LIMIT 1',
      [cid]
    );
    const stageId = firstStage.rows[0]?.id || null;

    // V57: Agar pipelineId yuborilmagan bo'lsa — kompaniyaning haqiqiy birinchi pipeline'ini topamiz
    //   (avval crm_lead jadvalida shu kompaniya uchun mavjud distinct pipelineid lardan eng eski yaratilgani)
    //   Agar hech qanday lead bo'lmasa — 'p1' default sifatida qoladi
    if (!pipelineId || !String(pipelineId).trim()) {
      try {
        const pipR = await req.db.query(
          `SELECT pipelineid FROM crm_lead
             WHERE company_id=$1 AND pipelineid IS NOT NULL AND pipelineid<>''
             GROUP BY pipelineid
             ORDER BY MIN(id) ASC
             LIMIT 1`,
          [cid]
        );
        pipelineId = pipR.rows[0]?.pipelineid || 'p1';
      } catch { pipelineId = 'p1'; }
    } else {
      pipelineId = String(pipelineId).trim();
    }

    // 3. Lead ballini hisoblash
    let score = 30; // website manbaasi
    if (phone) score += 20;
    if (email) score += 10;

    const sysNote = extra
      ? `Tashqi veb-forma: ${extra}`
      : "Tashqi veb-forma orqali yuborildi";

    // ── V51: BARCHA qo'shimcha formdan kelgan maydonlarni custom_data ga saqlaymiz
    //   Frontend cardFields ushbu kalitlar bo'yicha lid kartasida ko'rsatadi
    const PUBLIC_STANDARD = new Set([
      'company_slug','name','phone','email','region','source','pipelineid','pipeline_id','extra','custom_data',
    ]);
    const customData = {};
    // V58: kalitlarni ham sanitize qilamiz (XSS himoyasi), qiymat ham max 500 belgi
    const cleanKey = (k) => sanitizeText(String(k || ''), 60).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const cleanVal = (v) => typeof v === 'object'
      ? JSON.stringify(v).slice(0, 2000)
      : sanitizeText(String(v), 500);

    // Avval bevosita yuborilgan custom_data ni qabul qilamiz
    if (bodyCustomData && typeof bodyCustomData === 'object') {
      for (const [k, v] of Object.entries(bodyCustomData)) {
        if (v == null || v === '') continue;
        const ck = cleanKey(k);
        if (!ck) continue;
        customData[ck] = cleanVal(v);
      }
    }
    // So'ngra body ning qolgan qismidagi qo'shimcha maydonlarni qo'shamiz
    for (const [k, v] of Object.entries(req.body || {})) {
      const lk = String(k || '').toLowerCase();
      if (PUBLIC_STANDARD.has(lk)) continue;
      if (v == null || v === '') continue;
      const ck = cleanKey(k);
      if (!ck || customData[ck] !== undefined) continue;
      customData[ck] = cleanVal(v);
    }

    // 4. Leadni yaratish
    const newLead = await req.db.query(
      `INSERT INTO crm_lead
         (name, contact_name, phone, email, mizon_source, lead_score,
          stage_id, region, owner, pipelineid, chatlogs, company_id, custom_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        name.trim(), name.trim(),
        phone || null, email || null,
        source, score,
        stageId,
        region || 'Veb-Sayt',
        'Navbatda',
        pipelineId,                            // V57: yuqorida default/validate qilingan
        JSON.stringify([{ type:'sys', date: new Date().toISOString(), text: sysNote }]),
        cid,
        JSON.stringify(customData),
      ]
    );

    const newId = newLead.rows[0].id;
    console.log(`🌐 Tashqi forma lead: "${name}" → company=${company_slug} id=${newId}`);

    // Meta CAPI — Tashqi forma orqali kelgan lead. Eng muhim CAPI nuqtasi:
    // Facebook Ads ROI shu yerdan hisoblanadi (server-side, ad-blockerlardan o'tib).
    metaCapiController._send(req.db, cid, 'Lead', {
      id: newId,
      name: name.trim(),
      email,
      phone,
    }, {
      event_id: `form_lead_${newId}`,
      value: 0,
      currency: 'UZS',
    }).catch(e => console.error('[CAPI] Public form Lead event failed:', e.message));

    _LOG('success', 201, { lead_id: newId });
    res.status(201).json({ success: true, id: newId });
  } catch (err) {
    console.error('Public lead error:', err.message);
    _LOG('error', 500, { error_msg: err.message });
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ── V59: Webhook Faollik Jurnal endpointlari (JWT himoyalangan, CRM panel ichidan o'qiladi) ──

// GET /api/webhook-log/recent?limit=50 — eng so'nggi so'rovlar (joriy kompaniya uchun)
app.get('/api/webhook-log/recent', (req, res) => {
  const cid = req.user?.companyId;
  if (!cid) return res.status(401).json({ error: 'Tizimga kiring' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const filtered = webhookLogs
    .filter(l => l.company_id === cid || (l.company_id == null && l.company_slug && req.user?.companySlug === l.company_slug))
    .slice(-limit)
    .reverse();
  res.json({
    total_in_buffer: webhookLogs.length,
    max_buffer:      WEBHOOK_LOG_MAX,
    returned:        filtered.length,
    items:           filtered,
  });
});

// GET /api/webhook-log/stats — joriy kompaniya uchun statistika (24 soat, 7 kun, hammasi)
app.get('/api/webhook-log/stats', (req, res) => {
  const cid = req.user?.companyId;
  if (!cid) return res.status(401).json({ error: 'Tizimga kiring' });
  const now = Date.now();
  const d1  = now -      24 * 3600 * 1000;
  const d7  = now -  7 * 24 * 3600 * 1000;
  const mine = webhookLogs.filter(l =>
    l.company_id === cid ||
    (l.company_id == null && l.company_slug && req.user?.companySlug === l.company_slug)
  );
  const slot = (since) => {
    const arr = mine.filter(l => Date.parse(l.ts) >= since);
    return {
      total:     arr.length,
      success:   arr.filter(l => l.status === 'success').length,
      duplicate: arr.filter(l => l.status === 'duplicate').length,
      error:     arr.filter(l => l.status === 'error').length,
    };
  };
  // Eng ko'p uchragan xato xabarlari (top 5)
  const errMap = {};
  mine.filter(l => l.status === 'error').forEach(l => {
    const key = (l.error_msg || 'Noma\'lum').slice(0, 80);
    errMap[key] = (errMap[key] || 0) + 1;
  });
  const top_errors = Object.entries(errMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, cnt]) => ({ msg, cnt }));
  res.json({
    day:   slot(d1),
    week:  slot(d7),
    total: slot(0),
    top_errors,
    last_at: mine.length ? mine[mine.length - 1].ts : null,
  });
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
