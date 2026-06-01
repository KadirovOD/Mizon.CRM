/**
 * edgeStore.js
 *
 * Vercel Edge Config — kompaniyalar va foydalanuvchilarni saqlash uchun.
 * PostgreSQL o'rniga ishlatiladi (bepul, setup talab etmaydi).
 *
 * READ  → Edge Config HTTP API (tez, CDN-cached)
 * WRITE → Vercel API (https://api.vercel.com/v1/edge-config/:id/items)
 */

const https = require('https');

const EC_URL      = process.env.EDGE_CONFIG;      // e.g. https://edge-config.vercel.com/ecfg_...?token=...
const EC_ID       = process.env.EC_ID;             // ecfg_...
const V_TOKEN     = process.env.VERCEL_TOKEN;      // Vercel API token
const TEAM_ID     = process.env.TEAM_ID;           // team_...

// ── Internal helpers ─────────────────────────────────────────────────────────

const fetchJson = (url, opts = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const options = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  };
  const req = https.request(options, res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({ raw: body }); }
    });
  });
  req.on('error', reject);
  if (opts.body) req.write(opts.body);
  req.end();
});

// READ: get a key from Edge Config
const ecGet = async (key) => {
  if (!EC_URL) return null;
  try {
    // EC_URL: https://edge-config.vercel.com/ecfg_ID?token=TOKEN
    // Correct item URL: https://edge-config.vercel.com/ecfg_ID/item/KEY?token=TOKEN
    const u = new URL(EC_URL);
    const itemUrl = `https://${u.hostname}${u.pathname.replace(/\/$/, '')}/item/${encodeURIComponent(key)}${u.search}`;
    const d = await fetchJson(itemUrl);
    return d;
  } catch { return null; }
};

// WRITE: update items in Edge Config via Vercel API
const ecSet = async (items) => {
  // items: [{ operation: 'upsert', key: string, value: any }]
  if (!EC_ID || !V_TOKEN) return false;
  try {
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/items${TEAM_ID ? '?teamId=' + TEAM_ID : ''}`;
    const r = await fetchJson(url, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + V_TOKEN },
      body: JSON.stringify({ items }),
    });
    return r.status === 'ok' || !!r.items;
  } catch { return false; }
};

// ── Public API ────────────────────────────────────────────────────────────────

// Get all companies
exports.getCompanies = async () => {
  const d = await ecGet('companies');
  return Array.isArray(d) ? d : [];
};

// Get all users
exports.getUsers = async () => {
  const d = await ecGet('users');
  return Array.isArray(d) ? d : [];
};

// Save all companies
exports.saveCompanies = async (companies) => {
  return ecSet([{ operation: 'upsert', key: 'companies', value: companies }]);
};

// Save all users
exports.saveUsers = async (users) => {
  return ecSet([{ operation: 'upsert', key: 'users', value: users }]);
};

// Check if Edge Config is available
// PostgreSQL (Railway/Supabase) ulangan bo'lsa — Edge Config'ni chetlab o'tish
exports.isAvailable = () => {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return false;
  return !!(EC_URL && EC_ID && V_TOKEN);
};
