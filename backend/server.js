const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' }); // load from parent dir if needed, or environment

const app = express();
const port = process.env.PORT || 3000;

// Database Connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'mizon_user',
  password: process.env.DB_PASSWORD || 'mizon_super_secret_pw!123',
  database: process.env.DB_NAME || 'mizon_crm_db',
});

// Pass db connection to express req to access it in routes
app.use((req, res, next) => {
  req.db = pool;
  next();
});

app.use(cors());
// We need raw body for Meta webhook verification sometimes, but json is fine for most.
app.use(express.json());

// Init DB Tables
async function initDb() {
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default stages if empty
    const stages = await client.query('SELECT COUNT(*) FROM crm_stage');
    if (parseInt(stages.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO crm_stage (name, sequence) VALUES 
        ('Yangi Lead', 1),
        ('Aloqaga chiqildi', 2),
        ('Ehtiyoj aniqlandi', 3),
        ('Taklif yuborildi', 4),
        ('Muzokaralar', 5),
        ('Yutildi', 6)
      `);
    }
    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    client.release();
  }
}

initDb();

// Routes
const leadController = require('./controllers/leadController');
const webhookController = require('./controllers/webhookController');

// API Routes
app.get('/api/leads', leadController.getLeads);
app.post('/api/leads', leadController.createLead);
app.put('/api/leads/:id/stage', leadController.updateLeadStage);

// Webhook Routes
app.get('/api/webhook/meta', webhookController.verifyMetaWebhook);
app.post('/api/webhook/meta', webhookController.handleMetaWebhook);
app.post('/api/webhook/telegram', webhookController.handleTelegramWebhook);

// Serve Frontend Static Files
app.use(express.static(path.join(__dirname, 'frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(port, () => {
  console.log(`Mizon CRM API running at http://localhost:${port}`);
});
