exports.getLeads = async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createLead = async (req, res) => {
  const { name, phone = null, source = 'manual', region = 'Noma\\'lum', owner = 'CEO', status = '1', pipelineId = 'p1' } = req.body;
  try {
    let score = source === 'manual' ? 10 : 30;
    if (phone) score += 20;

    const newLead = await req.db.query(
      `INSERT INTO crm_lead (name, contact_name, phone, mizon_source, lead_score, stage_id, region, owner, pipelineid, chatlogs) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, name, phone, source, score, isNaN(parseInt(status)) ? null : parseInt(status), region, owner, pipelineId, JSON.stringify([{type:'sys', date: new Date().toISOString(), text: `Sistemaga qo'shildi (${source})`}])]
    );
    res.status(201).json({ success: true, lead: newLead.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateLeadFull = async (req, res) => {
  const { id } = req.params;
  const { status, actualCallAttempts, deadline, taskDescription, chatLogs, owner } = req.body;
  try {
    const updated = await req.db.query(
      `UPDATE crm_lead 
       SET stage_id = COALESCE($1, stage_id),
           actualcallattempts = COALESCE($2, actualcallattempts),
           deadline = $3,
           taskdescription = $4,
           chatlogs = COALESCE($5, chatlogs),
           owner = COALESCE($6, owner)
       WHERE id = $7 RETURNING *`,
      [isNaN(parseInt(status)) ? null : parseInt(status), actualCallAttempts, deadline || null, taskDescription || null, chatLogs ? JSON.stringify(chatLogs) : null, owner, id]
    );
    if (!updated.rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, lead: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateLeadStage = async (req, res) => {
  const { id } = req.params;
  const { stage_id } = req.body;
  try {
    const updated = await req.db.query(
      'UPDATE crm_lead SET stage_id = $1 WHERE id = $2 RETURNING *',
      [stage_id, id]
    );
    if (!updated.rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, lead: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
