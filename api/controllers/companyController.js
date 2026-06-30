const bcrypt = require('bcryptjs');

// ── GET /api/company/users ─────────────────────
exports.listUsers = async (req, res) => {
  if (!req.user || !req.user.companyId) return res.json([]);
  if (!req.db) return res.json([]);
  try {
    const r = await req.db.query(
      'SELECT id, username, email, role, full_name, is_active, moizvonki_email, created_at FROM crm_users WHERE company_id = $1 ORDER BY created_at',
      [req.user.companyId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── POST /api/company/users ────────────────────
// CEO only
exports.addUser = async (req, res) => {
  if (!req.user || req.user.role !== 'CEO')
    return res.status(403).json({ error: 'Faqat CEO xodim qo\'sha oladi' });
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });

  const { username, password, role, full_name, email, moizvonki_email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username va password majburiy' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await req.db.query(
      'INSERT INTO crm_users (company_id, username, password_hash, role, full_name, email, moizvonki_email) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, username, email, role, full_name, moizvonki_email, created_at',
      [req.user.companyId, username, hash, role || 'MANAGER', full_name || username, email ? email.toLowerCase().trim() : null, moizvonki_email ? moizvonki_email.toLowerCase().trim() : null]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: "Bu username allaqachon mavjud" });
    res.status(500).json({ error: e.message });
  }
};

// ── DELETE /api/company/users/:id ─────────────
exports.deleteUser = async (req, res) => {
  if (!req.user || req.user.role !== 'CEO')
    return res.status(403).json({ error: 'Faqat CEO o\'chira oladi' });
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });
  try {
    // Can't delete yourself
    if (String(req.params.id) === String(req.user.userId))
      return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
    await req.db.query(
      'DELETE FROM crm_users WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── GET /api/company/settings ─────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  if (!req.db) return res.json({});
  const cid = req.user?.companyId;
  try {
    const r = await req.db.query(
      'SELECT form_title, form_subtitle, extra_settings, call_limit FROM companies WHERE id=$1',
      [cid]
    );
    res.json(r.rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── PUT /api/company/settings ─────────────────────────────────────────────
exports.updateSettings = async (req, res) => {
  if (!req.user || req.user.role !== 'CEO')
    return res.status(403).json({ error: 'Faqat CEO o\'zgartira oladi' });
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });
  const { form_title, form_subtitle, extra_settings, call_limit } = req.body || {};
  try {
    await req.db.query(
      `UPDATE companies
         SET form_title     = COALESCE($1, form_title),
             form_subtitle  = COALESCE($2, form_subtitle),
             extra_settings = COALESCE($3::jsonb, extra_settings),
             call_limit     = COALESCE($4, call_limit)
       WHERE id = $5`,
      [
        form_title    !== undefined ? form_title    : null,
        form_subtitle !== undefined ? form_subtitle : null,
        extra_settings != null ? JSON.stringify(extra_settings) : null,
        call_limit    != null  ? parseInt(call_limit) : null,
        req.user.companyId,
      ]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── PUT /api/company/users/:id ─────────────────
exports.updateUser = async (req, res) => {
  if (!req.user || req.user.role !== 'CEO')
    return res.status(403).json({ error: 'Faqat CEO o\'zgartira oladi' });
  if (!req.db) return res.status(500).json({ error: 'DB ulangan emas' });

  const { password, role, full_name, email, moizvonki_email } = req.body || {};
  const cleanEmail = email ? email.toLowerCase().trim() : null;
  const cleanMzEmail = moizvonki_email !== undefined ? (moizvonki_email ? moizvonki_email.toLowerCase().trim() : null) : undefined;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await req.db.query(
        'UPDATE crm_users SET password_hash=$1, role=COALESCE($2,role), full_name=COALESCE($3,full_name), email=COALESCE($4,email), moizvonki_email=COALESCE($5,moizvonki_email) WHERE id=$6 AND company_id=$7',
        [hash, role, full_name, cleanEmail, cleanMzEmail, req.params.id, req.user.companyId]
      );
    } else {
      await req.db.query(
        'UPDATE crm_users SET role=COALESCE($1,role), full_name=COALESCE($2,full_name), email=COALESCE($3,email), moizvonki_email=COALESCE($4,moizvonki_email) WHERE id=$5 AND company_id=$6',
        [role, full_name, cleanEmail, cleanMzEmail, req.params.id, req.user.companyId]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
