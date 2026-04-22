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
    `);
    const stages = await client.query('SELECT COUNT(*) FROM crm_stage');
    if (parseInt(stages.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO crm_stage (name, sequence) VALUES 
        ('Yangi Lead', 1), ('Aloqaga chiqildi', 2), ('Ehtiyoj aniqlandi', 3),
        ('Taklif yuborildi', 4), ('Muzokaralar', 5), ('Yutildi', 6), ('Muvaffaqiyatsiz', 7)
      `);
    }
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

// Stages
app.get('/api/stages', leadController.getStages);

// Webhooks
app.get('/api/webhook/meta', webhookController.verifyMetaWebhook);
app.post('/api/webhook/meta', webhookController.handleMetaWebhook);
app.post('/api/webhook/telegram', webhookController.handleTelegramWebhook);

// Stats (Dashboard API)
app.get('/api/stats', leadController.getStats);

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
