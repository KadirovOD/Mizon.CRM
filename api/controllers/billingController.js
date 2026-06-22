// ========== BILLING CONTROLLER ==========
// Platforma (SUPERADMIN) ijarachi kompaniyalardan CRM obunasi uchun QO'LDA to'lov undiradi.
// Oqim: tarif biriktirish → pending hisob-faktura → SUPERADMIN "to'landi" deb belgilaydi →
//       obuna uzaytiriladi. Muddat tugagach GRACE_DAYS kun muhlat, keyin kompaniya bloklanadi.

const GRACE_DAYS = 3;

const isSA = (req, res) => {
  if (!req.user || req.user.role !== 'SUPERADMIN')
    { res.status(403).json({ error: 'Super-admin ruxsati kerak' }); return false; }
  return true;
};

// Davr oxirini hisoblash (oylik yoki yillik)
function periodEnd(start, period) {
  const d = new Date(start);
  if (period === 'year') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // standart — oylik
  return d;
}

// Hisob-faktura davrining boshi: agar obuna hali amal qilsa — tugash sanasidan, aks holda hozirdan
function nextPeriodStart(sub) {
  return sub.expires_at && new Date(sub.expires_at) > new Date()
    ? new Date(sub.expires_at) : new Date();
}

// ── TARIFLAR (plans) — SUPERADMIN CRUD ───────────────────────────────────────

// GET /api/billing/plans — SUPERADMIN hammasini, CEO faqat aktivlarni ko'radi
exports.listPlans = async (req, res) => {
  if (!req.db) return res.json([]);
  const onlyActive = req.user?.role !== 'SUPERADMIN';
  try {
    const r = await req.db.query(
      `SELECT * FROM billing_plans ${onlyActive ? 'WHERE is_active=true' : ''} ORDER BY price ASC`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/billing/plans
exports.createPlan = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  const { name, price, period, call_limit, user_limit, lead_limit, features } = req.body || {};
  if (!name || price == null) return res.status(400).json({ error: 'name va price majburiy' });
  try {
    const r = await req.db.query(
      `INSERT INTO billing_plans (name, price, period, call_limit, user_limit, lead_limit, features)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, price, period === 'year' ? 'year' : 'month',
       call_limit != null ? parseInt(call_limit) : null,
       user_limit != null ? parseInt(user_limit) : null,
       lead_limit != null ? parseInt(lead_limit) : null,
       JSON.stringify(features || {})]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// PUT /api/billing/plans/:id
exports.updatePlan = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  const { name, price, period, call_limit, user_limit, lead_limit, features, is_active } = req.body || {};
  try {
    const r = await req.db.query(
      `UPDATE billing_plans SET
         name=COALESCE($1,name), price=COALESCE($2,price), period=COALESCE($3,period),
         call_limit=COALESCE($4,call_limit), user_limit=COALESCE($5,user_limit),
         lead_limit=COALESCE($6,lead_limit), features=COALESCE($7::jsonb,features),
         is_active=COALESCE($8,is_active)
       WHERE id=$9 RETURNING *`,
      [name ?? null, price ?? null,
       period ? (period === 'year' ? 'year' : 'month') : null,
       call_limit != null ? parseInt(call_limit) : null,
       user_limit != null ? parseInt(user_limit) : null,
       lead_limit != null ? parseInt(lead_limit) : null,
       features != null ? JSON.stringify(features) : null,
       is_active != null ? is_active : null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Tarif topilmadi' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// DELETE /api/billing/plans/:id — ishlatilayotgan bo'lsa o'chirilmaydi, deaktiv qilinadi
exports.deletePlan = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  try {
    const used = await req.db.query('SELECT 1 FROM billing_subscriptions WHERE plan_id=$1 LIMIT 1', [req.params.id]);
    if (used.rows.length) {
      await req.db.query('UPDATE billing_plans SET is_active=false WHERE id=$1', [req.params.id]);
      return res.json({ success: true, deactivated: true });
    }
    await req.db.query('DELETE FROM billing_plans WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── OBUNALAR (subscriptions) ──────────────────────────────────────────────────

// GET /api/billing/subscriptions — SUPERADMIN, barcha kompaniyalar
exports.listSubscriptions = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.json([]);
  try {
    const r = await req.db.query(`
      SELECT s.*, c.name AS company_name, c.slug AS company_slug, c.is_active AS company_active,
             p.name AS plan_name, p.price AS plan_price, p.period AS plan_period,
             (s.expires_at IS NOT NULL AND s.expires_at < NOW()) AS is_overdue,
             (s.expires_at + INTERVAL '${GRACE_DAYS} days') AS grace_until
      FROM billing_subscriptions s
      JOIN companies c ON c.id = s.company_id
      LEFT JOIN billing_plans p ON p.id = s.plan_id
      ORDER BY s.expires_at ASC NULLS LAST
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// Internal helper — kompaniyaga tarif biriktirish (upsert) + pending hisob-faktura yaratish.
// HTTP qatlami emas, boshqa kontrollerlardan ham chaqirsa bo'ladi (masalan, superAdminController).
// Qaytaradi: { subscription, invoice, plan } yoki xato bo'lsa Error tashlaydi.
exports._attachPlanToCompany = async (db, company_id, plan_id) => {
  if (!db) throw new Error('DB ulangan emas');
  if (!company_id || !plan_id) throw new Error('company_id va plan_id majburiy');

  const planR = await db.query('SELECT * FROM billing_plans WHERE id=$1', [plan_id]);
  if (!planR.rows.length) throw new Error('Tarif topilmadi');
  const plan = planR.rows[0];

  // Har kompaniyaga bitta obuna (company_id UNIQUE) — upsert
  const existing = await db.query('SELECT * FROM billing_subscriptions WHERE company_id=$1', [company_id]);
  let sub;
  if (existing.rows.length) {
    const r = await db.query(
      `UPDATE billing_subscriptions SET plan_id=$1 WHERE company_id=$2 RETURNING *`,
      [plan_id, company_id]
    );
    sub = r.rows[0];
  } else {
    const r = await db.query(
      `INSERT INTO billing_subscriptions (company_id, plan_id, status, started_at)
       VALUES ($1,$2,'pending',NOW()) RETURNING *`,
      [company_id, plan_id]
    );
    sub = r.rows[0];
  }

  // Birinchi davr uchun pending hisob-faktura
  const start = nextPeriodStart(sub);
  const end = periodEnd(start, plan.period);
  const inv = await db.query(
    `INSERT INTO billing_invoices (company_id, subscription_id, amount, currency, status, period_start, period_end)
     VALUES ($1,$2,$3,'UZS','pending',$4,$5) RETURNING *`,
    [company_id, sub.id, plan.price, start, end]
  );

  // Companies.plan ni tarif nomiga sinxronlash (badge va legacy display uchun)
  await db.query('UPDATE companies SET plan=$1 WHERE id=$2', [plan.name, company_id]);

  return { subscription: sub, invoice: inv.rows[0], plan };
};

// POST /api/billing/subscriptions — kompaniyaga tarif biriktirish (+ pending hisob-faktura)
exports.assignPlan = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  const { company_id, plan_id } = req.body || {};
  if (!company_id || !plan_id) return res.status(400).json({ error: 'company_id va plan_id majburiy' });
  try {
    const out = await exports._attachPlanToCompany(req.db, company_id, plan_id);
    res.status(201).json({ success: true, subscription: out.subscription, invoice: out.invoice });
  } catch (e) {
    const code = /majburiy|topilmadi/i.test(e.message) ? 400 : 500;
    res.status(code).json({ error: e.message });
  }
};

// ── HISOB-FAKTURALAR (invoices) ───────────────────────────────────────────────

// GET /api/billing/invoices — SUPERADMIN; ixtiyoriy ?company_id filtri
exports.listInvoices = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.json([]);
  const { company_id } = req.query;
  try {
    const r = await req.db.query(
      `SELECT i.*, c.name AS company_name
       FROM billing_invoices i JOIN companies c ON c.id=i.company_id
       ${company_id ? 'WHERE i.company_id=$1' : ''}
       ORDER BY i.created_at DESC`,
      company_id ? [company_id] : []
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /api/billing/invoices — keyingi davr uchun hisob-faktura (uzaytirish)
exports.createInvoice = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  const { company_id } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id majburiy' });
  try {
    const subR = await req.db.query(
      `SELECT s.*, p.price, p.period FROM billing_subscriptions s
       JOIN billing_plans p ON p.id=s.plan_id WHERE s.company_id=$1`, [company_id]
    );
    if (!subR.rows.length) return res.status(400).json({ error: 'Avval tarif biriktiring' });
    const sub = subR.rows[0];
    const start = nextPeriodStart(sub);
    const end = periodEnd(start, sub.period);
    const inv = await req.db.query(
      `INSERT INTO billing_invoices (company_id, subscription_id, amount, currency, status, period_start, period_end)
       VALUES ($1,$2,$3,'UZS','pending',$4,$5) RETURNING *`,
      [company_id, sub.id, sub.price, start, end]
    );
    res.status(201).json(inv.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// PUT /api/billing/invoices/:id/pay — qo'lda "to'landi" deb belgilash
exports.markInvoicePaid = async (req, res) => {
  if (!isSA(req, res)) return;
  if (!req.db) return res.status(503).json({ error: 'DB ulangan emas' });
  const { payment_method, note } = req.body || {};
  try {
    const invR = await req.db.query('SELECT * FROM billing_invoices WHERE id=$1', [req.params.id]);
    if (!invR.rows.length) return res.status(404).json({ error: 'Hisob-faktura topilmadi' });
    const inv = invR.rows[0];
    if (inv.status === 'paid') return res.status(400).json({ error: "Allaqachon to'langan" });

    await req.db.query(
      `UPDATE billing_invoices SET status='paid', paid_at=NOW(),
         payment_method=COALESCE($1,payment_method), note=COALESCE($2,note) WHERE id=$3`,
      [payment_method || 'manual', note || null, inv.id]
    );
    // Obunani hisob-faktura davriga uzaytirish + kompaniyani faollashtirish
    if (inv.subscription_id) {
      await req.db.query(
        `UPDATE billing_subscriptions SET status='active', expires_at=$1 WHERE id=$2`,
        [inv.period_end, inv.subscription_id]
      );
    }
    await req.db.query('UPDATE companies SET is_active=true WHERE id=$1', [inv.company_id]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── CEO: o'z kompaniyasining obunasi va hisob-fakturalari (faqat o'qish) ────────

// GET /api/billing/me
exports.myBilling = async (req, res) => {
  if (!req.db) return res.json({ subscription: null, invoices: [] });
  const cid = req.user?.companyId;
  if (!cid) return res.json({ subscription: null, invoices: [] });
  try {
    const subR = await req.db.query(`
      SELECT s.*, p.name AS plan_name, p.price AS plan_price, p.period AS plan_period,
             p.call_limit, p.user_limit, p.lead_limit, p.features,
             (s.expires_at + INTERVAL '${GRACE_DAYS} days') AS grace_until
      FROM billing_subscriptions s
      LEFT JOIN billing_plans p ON p.id=s.plan_id
      WHERE s.company_id=$1`, [cid]);
    const invR = await req.db.query(
      'SELECT * FROM billing_invoices WHERE company_id=$1 ORDER BY created_at DESC', [cid]
    );
    res.json({ subscription: subR.rows[0] || null, invoices: invR.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── Muddati tugagan obunalarni tekshirish (GRACE_DAYS muhlatdan keyin bloklash) ──
// Davriy (setInterval) va server start'da chaqiriladi. GRACE_DAYS — kod ichidagi konstanta.
exports.runExpiryCheck = async (pool) => {
  if (!pool) return;
  try {
    await pool.query(`
      UPDATE companies SET is_active=false
      WHERE is_active=true AND id IN (
        SELECT company_id FROM billing_subscriptions
        WHERE expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL '${GRACE_DAYS} days'
      )`);
    await pool.query(`
      UPDATE billing_subscriptions SET status='expired'
      WHERE status='active' AND expires_at IS NOT NULL
        AND expires_at < NOW() - INTERVAL '${GRACE_DAYS} days'`);
  } catch (e) {
    console.error('billing runExpiryCheck error:', e.message);
  }
};
