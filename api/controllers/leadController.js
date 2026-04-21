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
  const { name, contact_name, phone, source = 'manual', budget_range } = req.body;
  try {
    let score = source === 'manual' ? 10 : 30;
    if (phone) score += 20;

    const newLead = await req.db.query(
      `INSERT INTO crm_lead (name, contact_name, phone, mizon_source, lead_score, budget_range, stage_id) 
       VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING *`,
      [name, contact_name, phone, source, score, budget_range]
    );
    res.status(201).json({ success: true, lead: newLead.rows[0] });
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
