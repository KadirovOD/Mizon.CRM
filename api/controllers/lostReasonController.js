// ========== LOST REASON CONTROLLER (muvaffaqiyatsizlik sabablari) ==========
// Ro'yxatni faqat CEO boshqaradi (Sozlamalar bo'limidan). Lid "Yo'qotildi"
// bosqichiga o'tkazilganda shu ro'yxatdan sabab tanlash majburiy qilinadi
// (tekshiruv frontend va leadController.updateLeadFull ikkalasida ham bor).

// GET /api/lost-reasons — ro'yxat (barcha rollarga ochiq, tanlash uchun kerak)
exports.getLostReasons = async (req, res) => {
  if (!req.db) return res.json({ success: true, reasons: [] });
  const cid = req.user?.companyId;
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM crm_lost_reasons WHERE company_id = $1 ORDER BY sequence ASC, created_at ASC`,
      [cid]
    );
    res.json({ success: true, reasons: rows });
  } catch (err) {
    console.error('getLostReasons error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// POST /api/lost-reasons — yangi sabab qo'shish (faqat CEO)
exports.createLostReason = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  if (req.user?.role !== 'CEO') return res.status(403).json({ error: 'Faqat CEO sabab qo\'sha oladi' });
  const cid = req.user?.companyId;
  const { label } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'label majburiy' });

  try {
    const { rows } = await req.db.query(
      `INSERT INTO crm_lost_reasons (company_id, label, sequence) VALUES ($1, $2, $3) RETURNING *`,
      [cid, label.trim(), req.body.sequence || 0]
    );
    res.json({ success: true, reason: rows[0] });
  } catch (err) {
    console.error('createLostReason error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// PUT /api/lost-reasons/:id — sababni tahrirlash (faqat CEO)
exports.updateLostReason = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  if (req.user?.role !== 'CEO') return res.status(403).json({ error: 'Faqat CEO sababni tahrirlay oladi' });
  const cid = req.user?.companyId;
  const { id } = req.params;
  const { label } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'label majburiy' });

  try {
    const { rows } = await req.db.query(
      `UPDATE crm_lost_reasons SET label = $1 WHERE id = $2 AND company_id = $3 RETURNING *`,
      [label.trim(), id, cid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ success: true, reason: rows[0] });
  } catch (err) {
    console.error('updateLostReason error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

// DELETE /api/lost-reasons/:id — sababni o'chirish (faqat CEO)
exports.deleteLostReason = async (req, res) => {
  if (!req.db) return res.status(503).json({ error: 'Database not configured' });
  if (req.user?.role !== 'CEO') return res.status(403).json({ error: 'Faqat CEO sababni o\'chira oladi' });
  const cid = req.user?.companyId;
  const { id } = req.params;

  try {
    const { rowCount } = await req.db.query(
      `DELETE FROM crm_lost_reasons WHERE id = $1 AND company_id = $2`,
      [id, cid]
    );
    if (!rowCount) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteLostReason error:', err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};
