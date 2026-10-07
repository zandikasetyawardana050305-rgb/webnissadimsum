// Vercel Function: simpan & baca pesanan di Turso (libSQL).
// Env: ADMIN_PASSWORD, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
const { createClient } = require("@libsql/client/web");

const findEnv = s => { const k = Object.keys(process.env).find(k => k.endsWith(s)); return k ? process.env[k] : undefined; };
const DB_URL = process.env.TURSO_DATABASE_URL || findEnv("TURSO_DATABASE_URL");
const DB_TOKEN = process.env.TURSO_AUTH_TOKEN || findEnv("TURSO_AUTH_TOKEN");

let db, ready;
function init() {
  if (!ready) {
    db = createClient({ url: DB_URL, authToken: DB_TOKEN });
    ready = db.execute(`CREATE TABLE IF NOT EXISTS orders (
      no INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL, pay TEXT NOT NULL, status TEXT NOT NULL,
      waktu TEXT NOT NULL, items TEXT NOT NULL, total INTEGER NOT NULL)`);
  }
  return ready;
}
const toOrder = r => ({ no: Number(r.no), nama: r.nama, pay: r.pay, status: r.status, waktu: r.waktu, items: JSON.parse(r.items), total: Number(r.total) });
const isAdmin = req => !!process.env.ADMIN_PASSWORD && req.headers["x-admin-password"] === process.env.ADMIN_PASSWORD;
const clean = s => String(s || "").slice(0, 80);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!DB_URL || !DB_TOKEN) return res.status(500).json({ error: "Database Turso belum dihubungkan (lihat panduan)." });
  try {
    await init();
    if (req.method === "POST") {
      const b = req.body || {};
      const items = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
      if (!clean(b.nama) || !items.length) return res.status(400).json({ error: "Data pesanan tidak lengkap." });
      const clItems = items.map(i => ({ nama: clean(i.nama), harga: Math.max(0, +i.harga || 0), q: Math.min(99, Math.max(1, +i.q || 1)) }));
      const total = clItems.reduce((s, i) => s + i.harga * i.q, 0);
      const pay = b.pay === "QRIS" ? "QRIS" : "Cash";
      const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const r = await db.execute({
        sql: "INSERT INTO orders (nama, pay, status, waktu, items, total) VALUES (?, ?, 'Baru', ?, ?, ?)",
        args: [clean(b.nama), pay, waktu, JSON.stringify(clItems), total]
      });
      return res.status(201).json({ no: Number(r.lastInsertRowid), nama: clean(b.nama), pay, status: "Baru", waktu, items: clItems, total });
    }
    if (!isAdmin(req)) return res.status(401).json({ error: "Password admin salah." });
    if (req.method === "GET") {
      const r = await db.execute("SELECT * FROM orders ORDER BY no DESC");
      return res.status(200).json(r.rows.map(toOrder));
    }
    if (req.method === "PATCH") {
      const no = Number((req.body || {}).no);
      const r = await db.execute({ sql: "UPDATE orders SET status = 'Selesai' WHERE no = ?", args: [no] });
      if (!r.rowsAffected) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
      await db.execute("DELETE FROM orders");
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method tidak didukung." });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
