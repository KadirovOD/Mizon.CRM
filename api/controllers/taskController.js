// ========== TASK CONTROLLER (kunlik vazifalar) ==========
// Lid tizimidan mustaqil — xodim uchun bir necha kunlik vazifa (hisobot,
// uchrashuv, qo'ng'iroq rejasi va h.k.) yaratish va kuzatish imkonini beradi.
// crm_lead.taskdescription/deadline (bitta lidga bitta vazifa) bilan
// aralashmaydi — ular o'z holicha ishlashda davom etadi.

// GET /api/tasks — ro'yxat (CEO/WATCHER hammasini, MANAGER faqat o'ziniki)
exports.getTasks = async (req, res) => {
  if (!req.db) return res.json({ success: true, tasks: [] });
  const cid = req.user?.companyId;
  const { assignee, status, from, to } = req.query;
  try {
    const conds = ['t.company_id = $1'];
    const params = [cid];

    // MANAGER faqat o'z vazifalarini ko'radi; CEO/WATCHER hammasini yoki filtr bo'yicha
    if (req.user?.role === 'MANAGER') {
      params.push(req.user.username);
      conds.push(`t.assignee = $${params.length}`);
    } else if (assignee) {
      params.push(assignee);
      conds.push(`t.assignee = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conds.push(`t.status = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conds.push(`t.due_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conds.push(`t.due_date <= $${params.length}`);
    }

    const { rows } = await req.db.query(
      `SELECT t.*, l.name as lead_name
         FROM crm_tasks t
         LEFT JOIN crm_lead l ON t.lead_id = l.id
        WHERE ${conds.join(' AND ')}
        ORDER BY (t.status = 'open') DESC, t.due_date ASC NULLS LAST, t.created_at DESC`,
      params
    );
    res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error('getTasks error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// POST /api/tasks — yangi vazifa yaratish
exports.createTask = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  const cid = req.user?.companyId;
  const { title, description = null, assignee, dueDate = null, leadId = null } = req.body;

  if (!title || !assignee) {
    return res.status(400).json({ error: "title va assignee majburiy" });
  }

  try {
    const { rows } = await req.db.query(
      `INSERT INTO crm_tasks (company_id, lead_id, title, description, assignee, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [cid, leadId || null, title, description, assignee, dueDate || null, req.user?.username || null]
    );
    res.status(201).json({ success: true, task: rows[0] });
  } catch (err) {
    console.error('createTask error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// PUT /api/tasks/:id — yangilash (holat, matn, muddat)
exports.updateTask = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  const cid = req.user?.companyId;
  const { id } = req.params;
  const { title, description, assignee, dueDate, status, leadId } = req.body;

  try {
    // MANAGER faqat o'z vazifasini o'zgartira oladi
    if (req.user?.role === 'MANAGER') {
      const check = await req.db.query('SELECT assignee FROM crm_tasks WHERE id=$1 AND company_id=$2', [id, cid]);
      if (!check.rows.length) return res.status(404).json({ error: 'Vazifa topilmadi' });
      if (check.rows[0].assignee !== req.user.username) {
        return res.status(403).json({ error: "Faqat o'z vazifangizni o'zgartira olasiz" });
      }
    }

    const completedAtSql = status === 'done' ? 'NOW()' : (status ? 'NULL' : 'completed_at');

    const { rows } = await req.db.query(
      `UPDATE crm_tasks
          SET title       = COALESCE($1, title),
              description = COALESCE($2, description),
              assignee    = COALESCE($3, assignee),
              due_date    = COALESCE($4, due_date),
              status      = COALESCE($5, status),
              lead_id     = COALESCE($6, lead_id),
              completed_at = ${completedAtSql}
        WHERE id = $7 AND company_id = $8
        RETURNING *`,
      [title || null, description || null, assignee || null, dueDate || null, status || null, leadId || null, id, cid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vazifa topilmadi' });
    res.json({ success: true, task: rows[0] });
  } catch (err) {
    console.error('updateTask error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// DELETE /api/tasks/:id
exports.deleteTask = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  const cid = req.user?.companyId;
  const { id } = req.params;
  try {
    if (req.user?.role === 'MANAGER') {
      const check = await req.db.query('SELECT assignee FROM crm_tasks WHERE id=$1 AND company_id=$2', [id, cid]);
      if (!check.rows.length) return res.status(404).json({ error: 'Vazifa topilmadi' });
      if (check.rows[0].assignee !== req.user.username) {
        return res.status(403).json({ error: "Faqat o'z vazifangizni o'chira olasiz" });
      }
    }
    const { rows } = await req.db.query('DELETE FROM crm_tasks WHERE id=$1 AND company_id=$2 RETURNING id', [id, cid]);
    if (!rows.length) return res.status(404).json({ error: 'Vazifa topilmadi' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteTask error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// GET /api/tasks/stats?from=&to= — xodim bo'yicha kunlik bajarilish ko'rsatkichlari
// (CEO/WATCHER uchun — barcha xodimlar; MANAGER — faqat o'zi). from/to — created_at
// oralig'i bo'yicha filtr (davr bo'yicha samaradorlikni baholash uchun, masalan "shu oy").
exports.getTaskStats = async (req, res) => {
  if (!req.db) return res.json({ success: true, stats: [] });
  const cid = req.user?.companyId;
  const { from, to } = req.query;
  try {
    const conds = ['company_id = $1'];
    const params = [cid];
    if (req.user?.role === 'MANAGER') {
      params.push(req.user.username);
      conds.push(`assignee = $${params.length}`);
    }
    if (from) { params.push(from); conds.push(`created_at >= $${params.length}`); }
    if (to)   { params.push(to);   conds.push(`created_at <= $${params.length}`); }

    const { rows } = await req.db.query(
      `SELECT
         assignee,
         COUNT(*)                                                          AS total,
         COUNT(*) FILTER (WHERE status = 'done')                           AS done,
         COUNT(*) FILTER (WHERE status = 'open' AND due_date < NOW())      AS overdue,
         COUNT(*) FILTER (WHERE status = 'open' AND due_date >= NOW())     AS pending
       FROM crm_tasks
       WHERE ${conds.join(' AND ')}
       GROUP BY assignee
       ORDER BY assignee ASC`,
      params
    );
    res.json({ success: true, stats: rows });
  } catch (err) {
    console.error('getTaskStats error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};
