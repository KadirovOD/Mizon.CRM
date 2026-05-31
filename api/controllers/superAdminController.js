const bcrypt = require('bcryptjs');

const ok = (req, res) => {
  if (!req.user || req.user.role !== 'SUPERADMIN')
    { res.status(403).json({ error: 'Super-admin ruxsati kerak' }); return false; }
  return true;
};

// ── GET /api/superadmin/companies ──────────────
exports.listCompanies = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.json([]);
  try {
    const r = await req.db.query(`
      SELECT c.*,
        COUNT(DISTINCT u.id)  AS user_count,
        COUNT(DISTINCT l.id)  AS lead_count
      FROM companies c
      LEFT JOIN crm_users u ON u.company_id = c.id
      LEFT JOIN crm_lead  l ON l.company_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── POST /api/superadmin/companies ─────────────
// body: { name, slug, plan?, call_limit?, admin_username, admin_password }
exports.createCompany = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });

  const { name, slug, plan, call_limit, admin_username, admin_password } = req.body || {};
  if (!name || !slug || !admin_username || !admin_password)
    return res.status(400).json({ error: 'name, slug, admin_username, admin_password majburiy' });

  try {
    // 1. Company
    const cr = await req.db.query(
      'INSERT INTO companies (name, slug, plan, call_limit) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, slug.toLowerCase().trim(), plan || 'basic', call_limit || 5]
    );
    const company = cr.rows[0];

    // 2. CEO user
    const hash = await bcrypt.hash(admin_password, 10);
    await req.db.query(
      'INSERT INTO crm_users (company_id, username, password_hash, role, full_name) VALUES ($1,$2,$3,$4,$5)',
      [company.id, admin_username, hash, 'CEO', admin_username]
    );

    // 3. Default stages for this company
    await req.db.query(`
      INSERT INTO crm_stage (name, sequence, company_id) VALUES
      ('Yangi Lead',1,$1),('Aloqaga chiqildi',2,$1),('Ehtiyoj aniqlandi',3,$1),
      ('Taklif yuborildi',4,$1),('Muzokaralar',5,$1),('Yutildi',6,$1),('Muvaffaqiyatsiz',7,$1)
    `, [company.id]);

    res.json({
      success: true, company,
      login_url: `?company=${company.slug}`,
      message: `Muvaffaqiyatli yaratildi! Mijozga URL bering: ?company=${company.slug}`
    });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: "Bu slug allaqachon ishlatilgan" });
    res.status(500).json({ error: e.message });
  }
};

// ── PUT /api/superadmin/companies/:id ──────────
exports.updateCompany = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });
  const { is_active, plan, call_limit, name } = req.body || {};
  try {
    await req.db.query(
      `UPDATE companies SET
        is_active  = COALESCE($1, is_active),
        plan       = COALESCE($2, plan),
        call_limit = COALESCE($3, call_limit),
        name       = COALESCE($4, name)
      WHERE id = $5`,
      [is_active, plan, call_limit, name, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── GET /api/superadmin/companies/:id ─────────
exports.getCompany = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.json({});
  try {
    const cr = await req.db.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (!cr.rows.length) return res.status(404).json({ error: 'Topilmadi' });
    const ur = await req.db.query(
      'SELECT id, username, role, full_name, is_active, created_at FROM crm_users WHERE company_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json({ ...cr.rows[0], users: ur.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── DELETE /api/superadmin/companies/:id ───────
exports.deleteCompany = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });
  try {
    await req.db.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── GET /api/superadmin/companies/:id/users ────
exports.listUsers = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.json([]);
  try {
    const r = await req.db.query(
      'SELECT id, username, role, full_name, is_active, created_at FROM crm_users WHERE company_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── POST /api/superadmin/companies/:id/users ───
exports.addUser = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });
  const { username, password, role, full_name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username va password majburiy' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await req.db.query(
      'INSERT INTO crm_users (company_id, username, password_hash, role, full_name) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, role, full_name, created_at',
      [req.params.id, username, hash, role || 'MANAGER', full_name || username]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: "Bu username allaqachon mavjud" });
    res.status(500).json({ error: e.message });
  }
};

// ── DELETE /api/superadmin/users/:userId ───────
exports.deleteUser = async (req, res) => {
  if (!ok(req, res)) return;
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });
  try {
    await req.db.query('DELETE FROM crm_users WHERE id = $1', [req.params.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
