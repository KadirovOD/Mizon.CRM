const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Vercel Postgres provides POSTGRES_URL environment variable by default
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use((req, res, next) => {
  req.db = pool;
  next();
});

app.use(cors());
app.use(express.json());

// Init DB Tables automatically on first boot
async function initDb() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) return; // skip if no db yet
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
        owner VARCHAR(50) DEFAULT 'CEO',
        region VARCHAR(255),
        pipelineid VARCHAR(50) DEFAULT 'p1'
      );
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS chatlogs JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS deadline TIMESTAMP;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS actualcallattempts INTEGER DEFAULT 0;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS taskdescription TEXT;
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS owner VARCHAR(50) DEFAULT 'CEO';
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS region VARCHAR(255);
      ALTER TABLE crm_lead ADD COLUMN IF NOT EXISTS pipelineid VARCHAR(50) DEFAULT 'p1';
    `);
    const stages = await client.query('SELECT COUNT(*) FROM crm_stage');
    if (parseInt(stages.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO crm_stage (name, sequence) VALUES 
        ('Yangi Lead', 1), ('Aloqaga chiqildi', 2), ('Ehtiyoj aniqlandi', 3),
        ('Taklif yuborildi', 4), ('Muzokaralar', 5), ('Yutildi', 6)
      `);
    }
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    client.release();
  }
}
initDb();

const leadController = require('./controllers/leadController');
const webhookController = require('./controllers/webhookController');

app.get('/api/leads', leadController.getLeads);
app.post('/api/leads', leadController.createLead);
app.put('/api/leads/:id', leadController.updateLeadFull);
app.put('/api/leads/:id/stage', leadController.updateLeadStage);

app.get('/api/webhook/meta', webhookController.verifyMetaWebhook);
app.post('/api/webhook/meta', webhookController.handleMetaWebhook);
app.post('/api/webhook/telegram', webhookController.handleTelegramWebhook);

// Export for Vercel Serverless
module.exports = app;
