const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();

// ========== DATABASE ==========
const pool = process.env.POSTGRES_URL || process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

// Attach db to every request (null if no DB configured)
app.use((req, res, next) => {
  req.db = pool;
  next();
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ========== SERVE FRONTEND (local dev only) ==========
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ========== DB INIT ==========
async function initDb() {
  if (!pool) { console.log('⚠️  Database URL not configured — running in demo mode.'); return; }
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_stage (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        sequence INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS crm_lead (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(100),
        stage_id INTEGER REFERENCES crm_stage(id) ON DELETE SET NULL,
        mizon_source VARCHAR(100) DEFAULT 'manual',
        telegram_chat_id VARCHAR(100),
        lead_score INTEGER DEFAULT 0,
        budget_range VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        chatlogs JSONB DEFAULT '[]'::jsonb,
        deadline TIMESTAMP,
        actualcallattempts INTEGER DEFAULT 0,
        taskdescription TEXT,
        owner VARCHAR(50) DEFAULT 'ceo',
        region VARCHAR(255),
        pipelineid VARCHAR(50) DEFAULT 'p1'
      );
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS chatlogs JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS deadline TIMESTAMP;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS actualcallattempts INTEGER DEFAULT 0;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS taskdescription TEXT;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS owner VARCHAR(50) DEFAULT 'ceo';
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS region VARCHAR(255);
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS pipelineid VARCHAR(50) DEFAULT 'p1';
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS facebook_lead_id VARCHAR(100) UNIQUE;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS ad_name VARCHAR(255);
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS form_name VARCHAR(255);
    `);
    const stages = await client.query('SELECT COUNT(*) FROM crm_stage');
    if (parseInt(stages.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO crm_stage (name, sequence) VALUES 
        ('Yangi Lead', 1), ('Aloqaga chiqildi', 2), ('Ehtiyoj aniqlandi', 3),
        ('Taklif yuborildi', 4), ('Muzokaralar', 5), ('Yutildi', 6), ('Muvaffaqiyatsiz', 7)
      `);
    }

    // Odoo-style integration configuration table
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_integration_config (
        id SERIAL PRIMARY KEY,
        platform VARCHAR(50) NOT NULL,
        page_id VARCHAR(100),
        form_id VARCHAR(100),
        access_token TEXT,
        field_mapping JSONB DEFAULT '{}'::jsonb
      );
    `);

    // External API keys storage
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_api_keys (
        id SERIAL PRIMARY KEY,
        service VARCHAR(100) NOT NULL,
        label VARCHAR(255) NOT NULL,
        key_value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Moi Zvonki VoIP config
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_voip_config (
        id SERIAL PRIMARY KEY,
        account_id VARCHAR(100) NOT NULL,
        api_token TEXT NOT NULL,
        caller_id VARCHAR(50) DEFAULT '',
        domain VARCHAR(100) DEFAULT 'app.moizvonki.ru',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database initialized successfully.');
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
  } finally {
    client.release();
  }
}
initDb();

// ========== ROUTES ==========
const leadController = require('./controllers/leadController');
const webhookController = require('./controllers/webhookController');
const voipController = require('./controllers/voipController');

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    dbConnected: !!pool, 
    version: 'V7',
    timestamp: new Date().toISOString() 
  });
});

// Leads CRUD
app.get('/api/leads', leadController.getLeads);
app.post('/api/leads', leadController.createLead);
app.put('/api/leads/:id', leadController.updateLeadFull);
app.delete('/api/leads/:id', leadController.deleteLead);
app.get('/api/leads/:id/chatlogs', leadController.getLeadChatlogs);

// Stages
app.get('/api/stages', leadController.getStages);

// Webhooks
app.get('/api/webhook/meta', webhookController.verifyMetaWebhook);
app.post('/api/webhook/meta', webhookController.handleMetaWebhook);
app.post('/api/webhook/telegram', webhookController.handleTelegramWebhook);
app.post('/api/webhook/moizvonki', voipController.handleWebhook);

// VoIP (Moi Zvonki)
app.get('/api/voip/config', voipController.getConfig);
app.post('/api/voip/config', voipController.saveConfig);
app.post('/api/call', voipController.initiateCall);

// Integrations Config
app.post('/api/integrations', async (req, res) => {
  if (!req.db) return res.status(500).json({error: 'DB disabled'});
  const { platform, page_id, form_id, access_token, field_mapping } = req.body;
  try {
    await req.db.query(
      `INSERT INTO crm_integration_config (platform, page_id, form_id, access_token, field_mapping)
       VALUES ($1, $2, $3, $4, $5)`,
      [platform, page_id, form_id, access_token, JSON.stringify(field_mapping)]
    );
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// Stats (Dashboard API)
app.get('/api/stats', leadController.getStats);

// External API Keys CRUD
app.get('/api/api-keys', async (req, res) => {
  if (!req.db) return res.json([]);
  try {
    const result = await req.db.query(
      'SELECT id, service, label, created_at FROM crm_api_keys ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/api-keys', async (req, res) => {
  if (!req.db) return res.status(500).json({error: 'DB disabled'});
  const { service, label, key_value } = req.body;
  if (!service || !label || !key_value) return res.status(400).json({error: 'service, label, key_value majburiy'});
  try {
    const result = await req.db.query(
      'INSERT INTO crm_api_keys (service, label, key_value) VALUES ($1, $2, $3) RETURNING id, service, label, created_at',
      [service, label, key_value]
    );
    res.json(result.rows[0]);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.delete('/api/api-keys/:id', async (req, res) => {
  if (!req.db) return res.status(500).json({error: 'DB disabled'});
  try {
    await req.db.query('DELETE FROM crm_api_keys WHERE id = $1', [req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// Frontend SPA fallback (for local dev)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  }
});

// ========== START SERVER (local dev) ==========
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Mizon CRM Server running at http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Webhooks: /api/webhook/meta | /api/webhook/telegram\n`);
  });
}

// Export for Vercel Serverless
module.exports = app;
