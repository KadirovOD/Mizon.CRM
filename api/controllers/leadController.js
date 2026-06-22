// ========== LEAD CONTROLLER ==========

let _runTrigger = null;
exports._setAutomation = (fn) => { _runTrigger = fn; };
const runTrigger = (...args) => { if (_runTrigger) _runTrigger(...args); };

// GET /api/leads — fetch all leads with stage data (company_id filtered)
exports.getLeads = async (req, res) => {
  if (!req.db) return res.json({ success: true, leads: [], stages: [], mode: 'demo' });
  const cid = req.user?.companyId;
  try {
    const { rows } = await req.db.query(`
      SELECT l.*, s.name as stage_name,
             COALESCE(l.custom_data, '{}'::jsonb) as custom_data
      FROM crm_lead l
      LEFT JOIN crm_stage s ON l.stage_id = s.id
      WHERE l.company_id = $1
      ORDER BY l.created_at DESC
    `, [cid]);
    const stagesQuery = await req.db.query(
      'SELECT * FROM crm_stage WHERE company_id = $1 ORDER BY sequence ASC',
      [cid]
    );
    res.json({ success: true, stages: stagesQuery.rows, leads: rows });
  } catch (err) {
    console.error('getLeads error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// GET /api/leads/:id/chatlogs — fetch only chatlogs for polling
exports.getLeadChatlogs = async (req, res) => {
  if (!req.db) return res.json({ chatlogs: [] });
  const cid = req.user?.companyId;
  try {
    const { rows } = await req.db.query(
      'SELECT id, chatlogs, actualcallattempts FROM crm_lead WHERE id = $1 AND company_id = $2',
      [req.params.id, cid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const logs = typeof rows[0].chatlogs === 'string' ? JSON.parse(rows[0].chatlogs) : (rows[0].chatlogs || []);
    res.json({ chatlogs: logs, actualCallAttempts: rows[0].actualcallattempts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/stages — fetch stages for current company
exports.getStages = async (req, res) => {
  if (!req.db) return res.json({ success: true, stages: [] });
  const cid = req.user?.companyId;
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM crm_stage WHERE company_id = $1 ORDER BY sequence ASC',
      [cid]
    );
    res.json({ success: true, stages: rows });
  } catch (err) {
    console.error('getStages error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/leads — create a new lead
exports.createLead = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  const cid = req.user?.companyId;

  const {
    name,
    phone = null,
    email = null,
    source = 'manual',
    region = "Noma'lum",
    owner = 'ceo',
    status = null,
    pipelineId = 'p1'
  } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    let score = source === 'manual' ? 10 : 30;
    if (phone) score += 20;
    if (email) score += 10;

    // Kompaniyaning birinchi bosqichini olish (agar status ko'rsatilmasa)
    let stageId = isNaN(parseInt(status)) ? null : parseInt(status);
    if (!stageId && cid) {
      const firstStage = await req.db.query(
        'SELECT id FROM crm_stage WHERE company_id = $1 ORDER BY sequence ASC LIMIT 1',
        [cid]
      );
      stageId = firstStage.rows[0]?.id || null;
    }

    const newLead = await req.db.query(
      `INSERT INTO crm_lead (name, contact_name, phone, email, mizon_source, lead_score, stage_id, region, owner, pipelineid, chatlogs, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        name, name, phone, email, source, score,
        stageId,
        region, owner, pipelineId,
        JSON.stringify([{type:'sys', date: new Date().toISOString(), text: `Sistemaga qo'shildi (${source})`}]),
        cid
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
  const cid = req.user?.companyId;
  const { id } = req.params;
  const {
    name, phone, email, region, source,
    status, actualCallAttempts, deadline,
    taskDescription, chatLogs, owner, customData
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
           owner = COALESCE($11, owner),
           custom_data = COALESCE($12, custom_data)
       WHERE id = $13 AND company_id = $14 RETURNING *`,
      [
        name || null, phone || null, email || null, region || null, source || null,
        isNaN(parseInt(status)) ? null : parseInt(status),
        actualCallAttempts,
        deadline || null,
        taskDescription || null,
        chatLogs ? JSON.stringify(chatLogs) : null,
        owner,
        customData != null ? JSON.stringify(customData) : null,
        id,
        cid
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

// POST /api/leads/:id/claim — lead birinchi marta ochilganda mas'ulni avtomatik biriktirish.
// Qoidalar:
//   - claimed_at NULL bo'lsa (lead hech kim tomonidan hali ochilmagan) — joriy foydalanuvchini owner qiladi
//   - claimed_at to'ldirilgan bo'lsa — qaytarib o'zgartirilmaydi (idempotent), faqat lead qaytariladi
//   - Tarix uchun chatlogs ga sys yozuv qo'shiladi
exports.claimLead = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  const cid  = req.user?.companyId;
  const uname = req.user?.username;
  if (!uname) return res.status(401).json({ error: 'Auth required' });
  const { id } = req.params;
  try {
    const r = await req.db.query(
      'SELECT id, owner, claimed_at, claimed_by, chatlogs FROM crm_lead WHERE id=$1 AND company_id=$2',
      [id, cid]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = r.rows[0];

    // Allaqachon claim qilingan — hech narsa o'zgartirmaymiz
    if (lead.claimed_at) {
      const full = await req.db.query('SELECT * FROM crm_lead WHERE id=$1', [id]);
      return res.json({ success: true, claimed: false, lead: full.rows[0] });
    }

    // chatlogs ga sys yozuv qo'shamiz
    const logs = typeof lead.chatlogs === 'string' ? JSON.parse(lead.chatlogs) : (Array.isArray(lead.chatlogs) ? lead.chatlogs : []);
    logs.push({
      type: 'sys',
      date: new Date().toISOString(),
      text: `Lead ${uname} tomonidan qabul qilindi (avtomatik biriktirish)`,
    });

    const upd = await req.db.query(
      `UPDATE crm_lead
         SET owner=$1, claimed_at=NOW(), claimed_by=$1, chatlogs=$2
       WHERE id=$3 AND company_id=$4 AND claimed_at IS NULL
       RETURNING *`,
      [uname, JSON.stringify(logs), id, cid]
    );

    // Race condition — boshqa foydalanuvchi parallel ochib biriktirib ulgurgan bo'lsa
    if (!upd.rows.length) {
      const full = await req.db.query('SELECT * FROM crm_lead WHERE id=$1', [id]);
      return res.json({ success: true, claimed: false, lead: full.rows[0] });
    }

    res.json({ success: true, claimed: true, lead: upd.rows[0] });
  } catch (err) {
    console.error('claimLead error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// DELETE /api/leads/:id — delete a lead
exports.deleteLead = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  // Task 1: Faqat CEO va SUPERADMIN o'chira oladi
  if (!req.user || !['CEO', 'SUPERADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: "Faqat CEO lidlarni o'chira oladi" });
  }
  const cid = req.user?.companyId;
  const { id } = req.params;
  try {
    const result = await req.db.query(
      'DELETE FROM crm_lead WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, cid]
    );
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
  const cid = req.user?.companyId;
  try {
    const total    = await req.db.query('SELECT COUNT(*) as count FROM crm_lead WHERE company_id=$1', [cid]);
    const won      = await req.db.query("SELECT COUNT(*) as count FROM crm_lead WHERE company_id=$1 AND stage_id IN (SELECT id FROM crm_stage WHERE company_id=$1 AND is_won=true)", [cid]);
    const lost     = await req.db.query("SELECT COUNT(*) as count FROM crm_lead WHERE company_id=$1 AND stage_id IN (SELECT id FROM crm_stage WHERE company_id=$1 AND is_lost=true)", [cid]);
    const overdue  = await req.db.query('SELECT COUNT(*) as count FROM crm_lead WHERE company_id=$1 AND deadline < NOW() AND deadline IS NOT NULL', [cid]);
    const activeTasks = await req.db.query('SELECT COUNT(*) as count FROM crm_lead WHERE company_id=$1 AND taskdescription IS NOT NULL AND deadline > NOW()', [cid]);

    const sourceBreakdown = await req.db.query(
      'SELECT mizon_source, COUNT(*) as count FROM crm_lead WHERE company_id=$1 GROUP BY mizon_source ORDER BY count DESC',
      [cid]
    );
    const stageBreakdown = await req.db.query(`
      SELECT s.name, COUNT(l.id) as count
      FROM crm_stage s
      LEFT JOIN crm_lead l ON l.stage_id = s.id AND l.company_id = $1
      WHERE s.company_id = $1
      GROUP BY s.id, s.name
      ORDER BY s.sequence
    `, [cid]);

    res.json({
      success: true,
      stats: {
        totalLeads:    parseInt(total.rows[0].count),
        wonDeals:      parseInt(won.rows[0].count),
        lostDeals:     parseInt(lost.rows[0].count),
        overdueLeads:  parseInt(overdue.rows[0].count),
        activeTasks:   parseInt(activeTasks.rows[0].count),
        sourceBreakdown: sourceBreakdown.rows,
        stageBreakdown:  stageBreakdown.rows
      }
    });
  } catch (err) {
    console.error('getStats error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// PUT /api/stages/sync — CEO tomonidan bosqichlarni DB ga saqlash (batch)
exports.syncStages = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  const cid = req.user?.companyId;
  if (!req.user || !['CEO', 'SUPERADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Faqat CEO bosqichlarni o\'zgartira oladi' });
  const { stages } = req.body || {};
  if (!Array.isArray(stages) || stages.length === 0)
    return res.status(400).json({ error: 'stages array (kamida 1 ta) kerak' });

  try {
    // Mavjud bosqichlar
    const existing = await req.db.query('SELECT id FROM crm_stage WHERE company_id=$1', [cid]);
    const existingIds = new Set(existing.rows.map(r => r.id));

    // Saqlanadigan ID'lar
    const keepIds = new Set(
      stages.filter(s => s.id != null).map(s => Number(s.id))
    );

    // O'chiriladigan bosqichlar — ulardagi leadlarni null ga o'tkazib
    for (const id of existingIds) {
      if (!keepIds.has(id)) {
        await req.db.query('UPDATE crm_lead SET stage_id=NULL WHERE stage_id=$1 AND company_id=$2', [id, cid]);
        await req.db.query('DELETE FROM crm_stage WHERE id=$1 AND company_id=$2', [id, cid]);
      }
    }

    // Yangilash yoki yaratish
    const result = [];
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const dbId = s.id != null ? Number(s.id) : null;
      if (dbId && existingIds.has(dbId)) {
        const r = await req.db.query(
          `UPDATE crm_stage SET name=$1, sequence=$2, is_won=$3, is_lost=$4
           WHERE id=$5 AND company_id=$6 RETURNING *`,
          [s.name, i + 1, !!s.is_won, !!s.is_lost, dbId, cid]
        );
        if (r.rows.length) result.push(r.rows[0]);
      } else {
        const r = await req.db.query(
          `INSERT INTO crm_stage (name, sequence, company_id, is_won, is_lost)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [s.name, i + 1, cid, !!s.is_won, !!s.is_lost]
        );
        result.push(r.rows[0]);
      }
    }

    res.json({ success: true, stages: result });
  } catch (err) {
    console.error('syncStages error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
