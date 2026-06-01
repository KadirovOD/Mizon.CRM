// ========== LEAD CONTROLLER ==========

let _runTrigger = null;
exports._setAutomation = (fn) => { _runTrigger = fn; };
const runTrigger = (...args) => { if (_runTrigger) _runTrigger(...args); };

// GET /api/leads — fetch all leads with stage data
exports.getLeads = async (req, res) => {
  if (!req.db) return res.json({ success: true, leads: [], stages: [], mode: 'demo' });
  try {
    const { rows } = await req.db.query(`
      SELECT l.*, s.name as stage_name 
      FROM crm_lead l 
      LEFT JOIN crm_stage s ON l.stage_id = s.id 
      ORDER BY l.created_at DESC
    `);
    const stagesQuery = await req.db.query('SELECT * FROM crm_stage ORDER BY sequence ASC');
    res.json({ success: true, stages: stagesQuery.rows, leads: rows });
  } catch (err) {
    console.error('getLeads error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// GET /api/leads/:id/chatlogs — fetch only chatlogs for polling
exports.getLeadChatlogs = async (req, res) => {
  if (!req.db) return res.json({ chatlogs: [] });
  try {
    const { rows } = await req.db.query(
      'SELECT id, chatlogs, actualcallattempts FROM crm_lead WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const logs = typeof rows[0].chatlogs === 'string' ? JSON.parse(rows[0].chatlogs) : (rows[0].chatlogs || []);
    res.json({ chatlogs: logs, actualCallAttempts: rows[0].actualcallattempts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/stages — fetch all stages
exports.getStages = async (req, res) => {
  if (!req.db) return res.json({ success: true, stages: [] });
  try {
    const { rows } = await req.db.query('SELECT * FROM crm_stage ORDER BY sequence ASC');
    res.json({ success: true, stages: rows });
  } catch (err) {
    console.error('getStages error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/leads — create a new lead  
exports.createLead = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  
  const { 
    name, 
    phone = null, 
    email = null,
    source = 'manual', 
    region = "Noma'lum", 
    owner = 'ceo', 
    status = '1', 
    pipelineId = 'p1' 
  } = req.body;
  
  if (!name) return res.status(400).json({ error: 'Name is required' });
  
  try {
    let score = source === 'manual' ? 10 : 30;
    if (phone) score += 20;
    if (email) score += 10;

    const newLead = await req.db.query(
      `INSERT INTO crm_lead (name, contact_name, phone, email, mizon_source, lead_score, stage_id, region, owner, pipelineid, chatlogs) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        name, name, phone, email, source, score, 
        isNaN(parseInt(status)) ? 1 : parseInt(status), 
        region, owner, pipelineId, 
        JSON.stringify([{type:'sys', date: new Date().toISOString(), text: `Sistemaga qo'shildi (${source})`}])
      ]
    );
    const lead = newLead.rows[0];
    runTrigger(req.db, 'lead_created', lead, {});
    res.status(201).json({ success: true, lead });
  } catch (err) {
    console.error('createLead error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// PUT /api/leads/:id — full update of a lead
exports.updateLeadFull = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  
  const { id } = req.params;
  const { 
    name, phone, email, region, source,
    status, actualCallAttempts, deadline, 
    taskDescription, chatLogs, owner 
  } = req.body;
  
  try {
    const updated = await req.db.query(
      `UPDATE crm_lead 
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           email = COALESCE($3, email),
           region = COALESCE($4, region),
           mizon_source = COALESCE($5, mizon_source),
           stage_id = COALESCE($6, stage_id),
           actualcallattempts = COALESCE($7, actualcallattempts),
           deadline = $8,
           taskdescription = $9,
           chatlogs = COALESCE($10, chatlogs),
           owner = COALESCE($11, owner)
       WHERE id = $12 RETURNING *`,
      [
        name || null, phone || null, email || null, region || null, source || null,
        isNaN(parseInt(status)) ? null : parseInt(status), 
        actualCallAttempts, 
        deadline || null, 
        taskDescription || null, 
        chatLogs ? JSON.stringify(chatLogs) : null, 
        owner, 
        id
      ]
    );
    if (!updated.rows.length) return res.status(404).json({ error: 'Lead not found' });
    const updLead = updated.rows[0];
    // Bosqich o'zgargan bo'lsa trigger
    if (status && !isNaN(parseInt(status))) {
      const stageRow = await req.db.query('SELECT name FROM crm_stage WHERE id=$1', [parseInt(status)]);
      const stageName = stageRow.rows[0]?.name || '';
      runTrigger(req.db, 'stage_changed', updLead, { stageId: parseInt(status), stageName });
    }
    res.json({ success: true, lead: updLead });
  } catch (err) {
    console.error('updateLead error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// DELETE /api/leads/:id — delete a lead
exports.deleteLead = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  
  const { id } = req.params;
  try {
    const result = await req.db.query('DELETE FROM crm_lead WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, deletedId: id });
  } catch (err) {
    console.error('deleteLead error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/stats — dashboard statistics
exports.getStats = async (req, res) => {
  if (!req.db) return res.json({ success: true, mode: 'demo', stats: {} });
  try {
    const total = await req.db.query('SELECT COUNT(*) as count FROM crm_lead');
    const won = await req.db.query("SELECT COUNT(*) as count FROM crm_lead WHERE stage_id = (SELECT id FROM crm_stage WHERE name = 'Yutildi' LIMIT 1)");
    const lost = await req.db.query("SELECT COUNT(*) as count FROM crm_lead WHERE stage_id = (SELECT id FROM crm_stage WHERE name = 'Muvaffaqiyatsiz' LIMIT 1)");
    const overdue = await req.db.query('SELECT COUNT(*) as count FROM crm_lead WHERE deadline < NOW() AND deadline IS NOT NULL');
    const activeTasks = await req.db.query('SELECT COUNT(*) as count FROM crm_lead WHERE taskdescription IS NOT NULL AND deadline > NOW()');
    
    const sourceBreakdown = await req.db.query('SELECT mizon_source, COUNT(*) as count FROM crm_lead GROUP BY mizon_source ORDER BY count DESC');
    const stageBreakdown = await req.db.query(`
      SELECT s.name, COUNT(l.id) as count 
      FROM crm_stage s 
      LEFT JOIN crm_lead l ON l.stage_id = s.id 
      GROUP BY s.id, s.name 
      ORDER BY s.sequence
    `);

    res.json({ 
      success: true, 
      stats: {
        totalLeads: parseInt(total.rows[0].count),
        wonDeals: parseInt(won.rows[0].count),
        lostDeals: parseInt(lost.rows[0].count),
        overdueLeads: parseInt(overdue.rows[0].count),
        activeTasks: parseInt(activeTasks.rows[0].count),
        sourceBreakdown: sourceBreakdown.rows,
        stageBreakdown: stageBreakdown.rows
      }
    });
  } catch (err) {
    console.error('getStats error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};
