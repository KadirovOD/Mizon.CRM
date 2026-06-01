const bcrypt = require('bcryptjs');
const ec     = require('./edgeStore');

const isSA = (req, res) => {
  if (!req.user || req.user.role !== 'SUPERADMIN')
    { res.status(403).json({ error: 'Super-admin ruxsati kerak' }); return false; }
  return true;
};

// ── GET /api/superadmin/companies ─────────────────────────────────────────────
exports.listCompanies = async (req, res) => {
  if (!isSA(req, res)) return;
  try {
    if (ec.isAvailable()) {
      const [companies, users] = await Promise.all([ec.getCompanies(), ec.getUsers()]);
      const enriched = companies.map(c => ({
        ...c,
        user_count: users.filter(u => u.company_id === c.id).length,
        lead_count: 0,
      }));
      return res.json(enriched);
    }
    if (req.db) {
      const r = await req.db.query(`
        SELECT c.*, COUNT(DISTINCT u.id) AS user_count, COUNT(DISTINCT l.id) AS lead_count
        FROM companies c
        LEFT JOIN crm_users u ON u.company_id=c.id
        LEFT JOIN crm_lead  l ON l.company_id=c.id
        GROUP BY c.id ORDER BY c.created_at DESC
      `);
      return res.json(r.rows);
    }
    return res.json([]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── POST /api/superadmin/companies ────────────────────────────────────────────
exports.createCompany = async (req, res) => {
  if (!isSA(req, res)) return;
  const { name, slug, plan, call_limit, admin_username, admin_password, admin_email } = req.body || {};
  if (!name || !slug || !admin_username || !admin_password)
    return res.status(400).json({ error: 'name, slug, admin_username, admin_password majburiy' });

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    // ── Edge Config path ──────────────────────────────────────────────────────
    if (ec.isAvailable()) {
      const [companies, users] = await Promise.all([ec.getCompanies(), ec.getUsers()]);

      if (companies.find(c => c.slug === cleanSlug))
        return res.status(400).json({ error: 'Bu slug allaqachon ishlatilgan' });

      const compId = 'comp_' + Date.now();
      const company = {
        id: compId, name, slug: cleanSlug,
        plan: plan || 'basic', call_limit: call_limit || 5,
        is_active: true, created_at: new Date().toISOString(),
      };

      const hash = await bcrypt.hash(admin_password, 10);
      const ceoUser = {
        id: 'user_' + Date.now(), company_id: compId,
        username: admin_username, password_hash: hash,
        role: 'CEO', full_name: admin_username, is_active: true,
        email: admin_email || null,
        created_at: new Date().toISOString(),
      };

      const ok1 = await ec.saveCompanies([...companies, company]);
      const ok2 = await ec.saveUsers([...users, ceoUser]);

      if (!ok1 || !ok2)
        return res.status(500).json({ error: "Edge Config yozishda xato. VERCEL_TOKEN/EC_ID tekshiring." });

      return res.json({
        success: true, company,
        login_url: `?company=${cleanSlug}`,
        message: `✅ "${name}" yaratildi! Mijozga URL bering: ?company=${cleanSlug}`,
      });
    }

    // ── PostgreSQL path ───────────────────────────────────────────────────────
    if (req.db) {
      const cr = await req.db.query(
        'INSERT INTO companies (name,slug,plan,call_limit) VALUES ($1,$2,$3,$4) RETURNING *',
        [name, cleanSlug, plan||'basic', call_limit||5]
      );
      const company = cr.rows[0];
      const hash = await bcrypt.hash(admin_password, 10);
      await req.db.query(
        'INSERT INTO crm_users (company_id,username,password_hash,role,full_name,email) VALUES ($1,$2,$3,$4,$5,$6)',
        [company.id, admin_username, hash, 'CEO', admin_username, admin_email ? admin_email.toLowerCase().trim() : null]
      );
      await req.db.query(`
        INSERT INTO crm_stage (name,sequence,company_id) VALUES
        ('Yangi Lead',1,$1),('Aloqaga chiqildi',2,$1),('Ehtiyoj aniqlandi',3,$1),
        ('Taklif yuborildi',4,$1),('Muzokaralar',5,$1),('Yutildi',6,$1),('Muvaffaqiyatsiz',7,$1)
      `, [company.id]);
      return res.json({ success: true, company, login_url: `?company=${cleanSlug}`, message: `Muvaffaqiyatli yaratildi! URL: ?company=${cleanSlug}` });
    }

    return res.status(500).json({ error: 'Na Edge Config, na DB ulangan.' });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu slug allaqachon ishlatilgan' });
    res.status(500).json({ error: e.message });
  }
};

// ── PUT /api/superadmin/companies/:id ─────────────────────────────────────────
exports.updateCompany = async (req, res) => {
  if (!isSA(req, res)) return;
  const { is_active, plan, call_limit, name } = req.body || {};
  try {
    if (ec.isAvailable()) {
      const companies = await ec.getCompanies();
      const updated = companies.map(c => c.id === req.params.id
        ? { ...c, ...(is_active !== undefined && { is_active }), ...(plan && { plan }), ...(call_limit && { call_limit }), ...(name && { name }) }
        : c
      );
      await ec.saveCompanies(updated);
      return res.json({ success: true });
    }
    if (req.db) {
      await req.db.query(
        'UPDATE companies SET is_active=COALESCE($1,is_active),plan=COALESCE($2,plan),call_limit=COALESCE($3,call_limit),name=COALESCE($4,name) WHERE id=$5',
        [is_active, plan, call_limit, name, req.params.id]
      );
      return res.json({ success: true });
    }
    return res.status(500).json({ error: 'Storage ulangan emas' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── GET /api/superadmin/companies/:id ────────────────────────────────────────
exports.getCompany = async (req, res) => {
  if (!isSA(req, res)) return;
  try {
    if (ec.isAvailable()) {
      const [companies, users] = await Promise.all([ec.getCompanies(), ec.getUsers()]);
      const c = companies.find(co => co.id === req.params.id);
      if (!c) return res.status(404).json({ error: 'Topilmadi' });
      return res.json({ ...c, users: users.filter(u => u.company_id === c.id).map(u => ({ ...u, password_hash: undefined })) });
    }
    if (req.db) {
      const cr = await req.db.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
      if (!cr.rows.length) return res.status(404).json({ error: 'Topilmadi' });
      const ur = await req.db.query('SELECT id,username,email,role,full_name,is_active,created_at FROM crm_users WHERE company_id=$1', [req.params.id]);
      return res.json({ ...cr.rows[0], users: ur.rows });
    }
    return res.json({});
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── DELETE /api/superadmin/companies/:id ──────────────────────────────────────
exports.deleteCompany = async (req, res) => {
  if (!isSA(req, res)) return;
  try {
    if (ec.isAvailable()) {
      const [companies, users] = await Promise.all([ec.getCompanies(), ec.getUsers()]);
      await Promise.all([
        ec.saveCompanies(companies.filter(c => c.id !== req.params.id)),
        ec.saveUsers(users.filter(u => u.company_id !== req.params.id)),
      ]);
      return res.json({ success: true });
    }
    if (req.db) {
      await req.db.query('DELETE FROM companies WHERE id=$1', [req.params.id]);
      return res.json({ success: true });
    }
    return res.status(500).json({ error: 'Storage ulangan emas' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── GET /api/superadmin/companies/:id/users ───────────────────────────────────
exports.listUsers = async (req, res) => {
  if (!isSA(req, res)) return;
  try {
    if (ec.isAvailable()) {
      const users = await ec.getUsers();
      return res.json(users.filter(u => u.company_id === req.params.id).map(u => ({ ...u, password_hash: undefined })));
    }
    if (req.db) {
      const r = await req.db.query('SELECT id,username,email,role,full_name,is_active,created_at FROM crm_users WHERE company_id=$1', [req.params.id]);
      return res.json(r.rows);
    }
    return res.json([]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── POST /api/superadmin/companies/:id/users ──────────────────────────────────
exports.addUser = async (req, res) => {
  if (!isSA(req, res)) return;
  const { username, password, role, full_name, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username va password majburiy' });
  try {
    if (ec.isAvailable()) {
      const users = await ec.getUsers();
      if (users.find(u => u.company_id === req.params.id && u.username === username))
        return res.status(400).json({ error: 'Bu username allaqachon mavjud' });
      const hash = await bcrypt.hash(password, 10);
      const newUser = {
        id: 'user_' + Date.now(), company_id: req.params.id,
        username, password_hash: hash, role: role||'MANAGER',
        full_name: full_name||username, email: email||null,
        is_active: true, created_at: new Date().toISOString(),
      };
      await ec.saveUsers([...users, newUser]);
      return res.json({ ...newUser, password_hash: undefined });
    }
    if (req.db) {
      const hash = await bcrypt.hash(password, 10);
      const r = await req.db.query(
        'INSERT INTO crm_users (company_id,username,password_hash,role,full_name,email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,username,email,role,full_name,created_at',
        [req.params.id, username, hash, role||'MANAGER', full_name||username, email||null]
      );
      return res.json(r.rows[0]);
    }
    return res.status(500).json({ error: 'Storage ulangan emas' });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu username allaqachon mavjud' });
    res.status(500).json({ error: e.message });
  }
};

// ── PUT /api/superadmin/users/:userId ─────────────────────────────────────────
exports.updateUser = async (req, res) => {
  if (!isSA(req, res)) return;
  const { username, password, role, full_name } = req.body || {};
  try {
    if (ec.isAvailable()) {
      const users = await ec.getUsers();
      const idx   = users.findIndex(u => u.id === req.params.userId);
      if (idx === -1) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

      // Unique username check within company
      if (username && users.some((u, i) => i !== idx && u.company_id === users[idx].company_id && u.username === username))
        return res.status(400).json({ error: 'Bu username allaqachon mavjud' });

      const updated = { ...users[idx] };
      if (username)   updated.username   = username;
      if (role)       updated.role       = role;
      if (full_name)  updated.full_name  = full_name;
      if (password)   updated.password_hash = await bcrypt.hash(password, 10);

      users[idx] = updated;
      await ec.saveUsers(users);
      return res.json({ success: true });
    }
    if (req.db) {
      if (password) {
        const hash = await bcrypt.hash(password, 10);
        await req.db.query(
          `UPDATE crm_users
             SET username   = COALESCE($1, username),
                 password_hash = $2,
                 role       = COALESCE($3, role),
                 full_name  = COALESCE($4, full_name)
           WHERE id = $5`,
          [username || null, hash, role || null, full_name || null, req.params.userId]
        );
      } else {
        await req.db.query(
          `UPDATE crm_users
             SET username  = COALESCE($1, username),
                 role      = COALESCE($2, role),
                 full_name = COALESCE($3, full_name)
           WHERE id = $4`,
          [username || null, role || null, full_name || null, req.params.userId]
        );
      }
      return res.json({ success: true });
    }
    return res.status(500).json({ error: 'Storage ulangan emas' });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu username allaqachon mavjud' });
    res.status(500).json({ error: e.message });
  }
};

// ── DELETE /api/superadmin/users/:userId ──────────────────────────────────────
exports.deleteUser = async (req, res) => {
  if (!isSA(req, res)) return;
  try {
    if (ec.isAvailable()) {
      const users = await ec.getUsers();
      await ec.saveUsers(users.filter(u => u.id !== req.params.userId));
      return res.json({ success: true });
    }
    if (req.db) {
      await req.db.query('DELETE FROM crm_users WHERE id=$1', [req.params.userId]);
      return res.json({ success: true });
    }
    return res.status(500).json({ error: 'Storage ulangan emas' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
