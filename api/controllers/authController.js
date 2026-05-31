const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET   = process.env.JWT_SECRET        || 'mizon-dev-secret-2024-change-in-prod';
const SA_USER      = process.env.SUPER_ADMIN_USER   || 'superadmin';
const SA_PASS      = process.env.SUPER_ADMIN_PASS   || 'mizon-super-2024';

// ──────────────────────────────────────────────
// POST /api/auth/login
// body: { username, password, company_slug? }
// ──────────────────────────────────────────────
exports.login = async (req, res) => {
  const { username, password, company_slug } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "username va password majburiy" });

  // ── 1. Super-admin shortcut ──────────────────
  if (username === SA_USER && password === SA_PASS) {
    const token = jwt.sign(
      { userId: 0, companyId: null, username: 'superadmin', role: 'SUPERADMIN' },
      JWT_SECRET, { expiresIn: '12h' }
    );
    return res.json({ token, user: { username: 'superadmin', role: 'SUPERADMIN', companyId: null } });
  }

  // ── 2. Demo mode (no DB) ─────────────────────
  if (!req.db) {
    const DEMO = [
      { username: 'ceo',       password: '123', role: 'CEO',     companyId: 1 },
      { username: 'menejer_1', password: '123', role: 'MANAGER', companyId: 1 },
    ];
    const u = DEMO.find(d => d.username === username && d.password === password);
    if (!u) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
    const token = jwt.sign(
      { userId: u.username, companyId: u.companyId, username: u.username, role: u.role },
      JWT_SECRET, { expiresIn: '7d' }
    );
    return res.json({ token, user: { username: u.username, role: u.role, companyId: u.companyId } });
  }

  // ── 3. DB mode ───────────────────────────────
  try {
    let companyId = null;
    let companyInfo = null;

    if (company_slug) {
      const cr = await req.db.query(
        'SELECT id, name, slug, logo_url, call_limit, is_active FROM companies WHERE slug = $1',
        [company_slug]
      );
      if (!cr.rows.length) return res.status(404).json({ error: "Kompaniya topilmadi" });
      if (!cr.rows[0].is_active) return res.status(403).json({ error: "Kompaniya vaqtincha bloklangan" });
      companyId    = cr.rows[0].id;
      companyInfo  = cr.rows[0];
    }

    const q = companyId
      ? 'SELECT * FROM crm_users WHERE username = $1 AND company_id = $2 AND is_active = true'
      : 'SELECT * FROM crm_users WHERE username = $1 AND is_active = true LIMIT 1';
    const params = companyId ? [username, companyId] : [username];
    const ur = await req.db.query(q, params);
    if (!ur.rows.length) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });

    const user = ur.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });

    // fetch company info if not already loaded
    if (!companyInfo && user.company_id) {
      const cr2 = await req.db.query(
        'SELECT name, slug, logo_url, call_limit FROM companies WHERE id = $1', [user.company_id]
      );
      if (cr2.rows.length) companyInfo = cr2.rows[0];
    }

    const token = jwt.sign(
      {
        userId:      user.id,
        companyId:   user.company_id,
        username:    user.username,
        role:        user.role,
        companyName: companyInfo?.name || '',
      },
      JWT_SECRET, { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        username:    user.username,
        role:        user.role,
        fullName:    user.full_name || user.username,
        companyId:   user.company_id,
        companyName: companyInfo?.name || '',
        companySlug: companyInfo?.slug || '',
        callLimit:   companyInfo?.call_limit || 5,
      }
    });
  } catch (e) {
    console.error('login error:', e.message);
    res.status(500).json({ error: e.message });
  }
};

// GET /api/auth/me
exports.me = (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Tizimga kiring' });
  res.json({ user: req.user });
};
