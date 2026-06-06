const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const ec      = require('./edgeStore');

const JWT_SECRET = process.env.JWT_SECRET       || 'mizon-dev-secret-2024-change-in-prod';
const SA_USER    = process.env.SUPER_ADMIN_USER  || 'superadmin';
const SA_PASS    = process.env.SUPER_ADMIN_PASS  || 'mizon@super2025!';

// SA parolini tekshirish — DB'da saqlangan hash yoki env var
const checkSaPassword = async (inputPassword) => {
  const saCtrl = require('./superAdminController');
  const hash = saCtrl.getSaPasswordHash();
  if (hash) return bcrypt.compare(inputPassword || '', hash);
  return inputPassword === SA_PASS;
};

// ── Rate Limiting (in-memory) ─────────────────────────────────────────────────
// Key: "username:ip"  →  { count, lockUntil, blocks }
const _locks = new Map();
const RL_MAX = 3;          // urinishlar soni
const RL_BASE_MIN = 10;    // birinchi blok (daqiqa)

function _rlKey(req, username) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  return `${username.toLowerCase()}:${ip}`;
}
function _rlCheck(key) {
  const now = Date.now();
  const e = _locks.get(key) || { count: 0, lockUntil: 0, blocks: 0 };
  if (e.lockUntil > now) {
    return { locked: true, secsLeft: Math.ceil((e.lockUntil - now) / 1000), blocks: e.blocks };
  }
  if (e.lockUntil > 0 && e.lockUntil <= now) {
    // Blok vaqti tugadi — hisoblagichni qayta boshlash
    e.count = 0; e.lockUntil = 0;
    _locks.set(key, e);
  }
  return { locked: false, count: e.count, attemptsLeft: RL_MAX - e.count };
}
function _rlFail(key) {
  const now = Date.now();
  const e = _locks.get(key) || { count: 0, lockUntil: 0, blocks: 0 };
  e.count += 1;
  if (e.count >= RL_MAX) {
    e.blocks += 1;
    // 10 min → 30 min → 90 min → 270 min …  (×3 har safar)
    const lockMs = RL_BASE_MIN * Math.pow(3, e.blocks - 1) * 60000;
    e.lockUntil  = now + lockMs;
    e.count      = 0;
    _locks.set(key, e);
    return { justLocked: true, secsLeft: Math.ceil(lockMs / 1000), blocks: e.blocks };
  }
  _locks.set(key, e);
  return { justLocked: false, attemptsLeft: RL_MAX - e.count };
}
function _rlClear(key) { _locks.delete(key); }
// Memory leak oldini olish: lock'i tugagan yozuvlarni har soatda tozalash
setInterval(() => {
  const now = Date.now();
  _locks.forEach((v, k) => { if (v.lockUntil <= now && v.count === 0) _locks.delete(k); });
}, 3_600_000);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { username, password, company_slug } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username va password majburiy' });

  // Rate-limit key (superadmin uchun qo'llanilmaydi)
  const isSA   = (username === SA_USER);
  const rlKey  = isSA ? null : _rlKey(req, username);

  if (!isSA) {
    const rlStatus = _rlCheck(rlKey);
    if (rlStatus.locked) {
      const mins = Math.ceil(rlStatus.secsLeft / 60);
      return res.status(429).json({
        error:    `Kirish vaqtincha bloklangan. ${mins} daqiqadan so\'ng urinib ko\'ring.`,
        locked:   true,
        secsLeft: rlStatus.secsLeft,
      });
    }
  }

  // helper: xato parol — hisoblagich oshirish va javob qaytarish
  const failReply = (res) => {
    if (!isSA) {
      const rl = _rlFail(rlKey);
      if (rl.justLocked) {
        const mins = Math.ceil(rl.secsLeft / 60);
        return res.status(401).json({
          error:    `Login yoki parol noto\'g\'ri. ${mins} daqiqa bloklandi.`,
          locked:   true,
          secsLeft: rl.secsLeft,
        });
      }
      return res.status(401).json({
        error:       `Login yoki parol noto\'g\'ri. ${rl.attemptsLeft} ta urinish qoldi.`,
        attemptsLeft: rl.attemptsLeft,
      });
    }
    return res.status(401).json({ error: "Login yoki parol noto\'g\'ri" });
  };

  // ── 1. Super admin ──────────────────────────────────────────────────────────
  if (isSA) {
    const saOk = await checkSaPassword(password);
    if (!saOk) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
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

      const isEmailEC = username.includes('@');
      const user = isEmailEC
        ? users.find(u => u.email && u.email.toLowerCase() === username.toLowerCase() && u.is_active !== false)
        : company_slug
          ? users.find(u => u.username === username && u.company_id === company?.id && u.is_active !== false)
          : users.find(u => u.username === username && u.is_active !== false);

      if (!user) return failReply(res);

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return failReply(res);

      if (!company) company = companies.find(c => c.id === user.company_id);
      _rlClear(rlKey); // muvaffaqiyatli kirish — hisoblagichni tozalash

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

      // Email orqali kirish: '@' belgisi bo'lsa — email qidirish (hamma kompaniyada noyob)
      const isEmail = username.includes('@');
      let ur;
      if (isEmail) {
        ur = await req.db.query(
          'SELECT * FROM crm_users WHERE LOWER(email)=LOWER($1) AND is_active=true LIMIT 1',
          [username.trim()]
        );
      } else {
        const q = companyId
          ? 'SELECT * FROM crm_users WHERE username=$1 AND company_id=$2 AND is_active=true'
          : 'SELECT * FROM crm_users WHERE username=$1 AND is_active=true LIMIT 1';
        ur = await req.db.query(q, companyId ? [username, companyId] : [username]);
      }
      if (!ur.rows.length) return failReply(res);

      const u = ur.rows[0];
      if (!await bcrypt.compare(password, u.password_hash)) return failReply(res);

      if (!companyInfo && u.company_id) {
        const ci = await req.db.query('SELECT * FROM companies WHERE id=$1', [u.company_id]);
        if (ci.rows.length) companyInfo = ci.rows[0];
      }
      _rlClear(rlKey); // muvaffaqiyatli kirish

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
  const demoUser = DEMO.find(d => d.username === username && d.password === password);
  if (!demoUser) return failReply(res);
  _rlClear(rlKey);
  const token = jwt.sign({ userId: demoUser.username, companyId: demoUser.companyId, username: demoUser.username, role: demoUser.role }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user: { username: demoUser.username, role: demoUser.role, companyId: demoUser.companyId } });
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
      const r = await req.db.query(
        'SELECT name, slug, is_active, form_title, form_subtitle FROM companies WHERE slug=$1',
        [slug]
      );
      if (r.rows.length) return res.json({ found: true, ...r.rows[0] });
    }
    return res.json({ found: false });
  } catch { return res.json({ found: false }); }
};
