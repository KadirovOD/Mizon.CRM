const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const ec      = require('./edgeStore');

const JWT_SECRET = process.env.JWT_SECRET       || 'mizon-dev-secret-2024-change-in-prod';
const SA_USER    = process.env.SUPER_ADMIN_USER  || 'superadmin';
const SA_PASS    = process.env.SUPER_ADMIN_PASS  || 'mizon@super2025!';

// ── POST /api/auth/login ──────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { username, password, company_slug } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username va password majburiy' });

  // ── 1. Super admin ──────────────────────────────────────────────────────────
  if (username === SA_USER && password === SA_PASS) {
    const token = jwt.sign(
      { userId: 0, companyId: null, username: 'superadmin', role: 'SUPERADMIN' },
      JWT_SECRET, { expiresIn: '12h' }
    );
    return res.json({ token, user: { username: 'superadmin', role: 'SUPERADMIN', companyId: null } });
  }

  // ── 2. Try Edge Config ──────────────────────────────────────────────────────
  if (ec.isAvailable()) {
    try {
      const [companies, users] = await Promise.all([ec.getCompanies(), ec.getUsers()]);

      let company = null;
      if (company_slug) {
        company = companies.find(c => c.slug === company_slug);
        if (!company) return res.status(404).json({ error: 'Kompaniya topilmadi' });
        if (!company.is_active) return res.status(403).json({ error: 'Kompaniya vaqtincha bloklangan' });
      }

      const user = company_slug
        ? users.find(u => u.username === username && u.company_id === company?.id && u.is_active !== false)
        : users.find(u => u.username === username && u.is_active !== false);

      if (!user) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });

      if (!company) company = companies.find(c => c.id === user.company_id);

      const token = jwt.sign(
        { userId: user.id, companyId: user.company_id, username: user.username, role: user.role, companyName: company?.name || '' },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: {
          username:    user.username,
          role:        user.role,
          fullName:    user.full_name || user.username,
          companyId:   user.company_id,
          companyName: company?.name || '',
          companySlug: company?.slug || '',
          callLimit:   company?.call_limit || 5,
        }
      });
    } catch (e) {
      console.error('EC login error:', e.message);
      // fallthrough to DB / demo
    }
  }

  // ── 3. PostgreSQL DB (if connected) ────────────────────────────────────────
  if (req.db) {
    try {
      let companyId = null, companyInfo = null;
      if (company_slug) {
        const cr = await req.db.query('SELECT * FROM companies WHERE slug=$1', [company_slug]);
        if (!cr.rows.length) return res.status(404).json({ error: 'Kompaniya topilmadi' });
        if (!cr.rows[0].is_active) return res.status(403).json({ error: 'Kompaniya bloklangan' });
        companyId = cr.rows[0].id; companyInfo = cr.rows[0];
      }
      const q = companyId
        ? 'SELECT * FROM crm_users WHERE username=$1 AND company_id=$2 AND is_active=true'
        : 'SELECT * FROM crm_users WHERE username=$1 AND is_active=true LIMIT 1';
      const ur = await req.db.query(q, companyId ? [username, companyId] : [username]);
      if (!ur.rows.length) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
      const u = ur.rows[0];
      if (!await bcrypt.compare(password, u.password_hash))
        return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
      if (!companyInfo && u.company_id) {
        const ci = await req.db.query('SELECT * FROM companies WHERE id=$1', [u.company_id]);
        if (ci.rows.length) companyInfo = ci.rows[0];
      }
      const token = jwt.sign(
        { userId: u.id, companyId: u.company_id, username: u.username, role: u.role, companyName: companyInfo?.name || '' },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({ token, user: { username: u.username, role: u.role, companyId: u.company_id, companyName: companyInfo?.name || '', companySlug: companyInfo?.slug || '', callLimit: companyInfo?.call_limit || 5 } });
    } catch (e) {
      console.error('DB login error:', e.message);
    }
  }

  // ── 4. Demo fallback ────────────────────────────────────────────────────────
  const DEMO = [
    { username: 'ceo',       password: '123', role: 'CEO',     companyId: 1 },
    { username: 'menejer_1', password: '123', role: 'MANAGER', companyId: 1 },
  ];
  const u = DEMO.find(d => d.username === username && d.password === password);
  if (!u) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
  const token = jwt.sign({ userId: u.username, companyId: u.companyId, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user: { username: u.username, role: u.role, companyId: u.companyId } });
};

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
exports.me = (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Tizimga kiring' });
  res.json({ user: req.user });
};

// ── GET /api/company/info?slug=... ─────────────────────────────────────────────
exports.companyInfo = async (req, res) => {
  const { slug } = req.query;
  if (!slug) return res.json({ found: false });
  try {
    if (ec.isAvailable()) {
      const companies = await ec.getCompanies();
      const c = companies.find(co => co.slug === slug);
      if (c) return res.json({ found: true, name: c.name, slug: c.slug, is_active: c.is_active });
    }
    if (req.db) {
      const r = await req.db.query('SELECT name, slug, is_active FROM companies WHERE slug=$1', [slug]);
      if (r.rows.length) return res.json({ found: true, ...r.rows[0] });
    }
    return res.json({ found: false });
  } catch { return res.json({ found: false }); }
};
