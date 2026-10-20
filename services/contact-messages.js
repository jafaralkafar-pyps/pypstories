/**
 * Contact-form storage and the admin list.
 * Replies to visitors are in-site notices. This module does not send email.
 */

const RECENT_LIMIT = 50;

const CONTACT_SUCCESS = 'Thanks! Your message was sent. If you were logged in, we\'ll reply with an in-site notice.';

function ensureContactMessagesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ip TEXT,
      user_id INTEGER
    );
  `);
  try {
    db.exec('ALTER TABLE contact_messages ADD COLUMN user_id INTEGER');
  } catch (err) {}
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeUserId(userId) {
  if (userId == null || userId === '') return null;
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function saveContactMessage(db, input) {
  ensureContactMessagesTable(db);
  const payload = input || {};
  const name = String(payload.name || '').trim().slice(0, 80);
  const email = String(payload.email || '').trim().toLowerCase().slice(0, 120);
  const message = String(payload.message || '').trim().slice(0, 2000);
  const ip = payload.ip == null ? null : String(payload.ip).slice(0, 80);
  const userId = normalizeUserId(payload.userId);
  const result = db.prepare(`
    INSERT INTO contact_messages (name, email, message, ip, user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, email, message, ip || null, userId);
  return db.prepare(`
    SELECT id, name, email, message, created_at, user_id
    FROM contact_messages WHERE id = ?
  `).get(result.lastInsertRowid);
}

function listContactMessages(db, actor) {
  if (!actor || actor.role !== 'admin') throw fail(403, 'Admin access required');
  ensureContactMessagesTable(db);
  const rows = db.prepare(`
    SELECT
      m.id,
      m.name,
      m.email,
      m.message,
      m.created_at,
      m.user_id,
      u.username AS username,
      u.email AS account_email
    FROM contact_messages m
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.id DESC
    LIMIT ?
  `).all(RECENT_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    message: row.message,
    created_at: row.created_at,
    user_id: row.user_id == null ? null : row.user_id,
    username: row.username || null,
    account_email: row.account_email || null,
  }));
}

function handleList(req, res, ctx) {
  const user = ctx && ctx.user;
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    res.json({ messages: listContactMessages(ctx.db, user) });
  } catch (err) {
    const status = err && err.status;
    if (status === 400 || status === 403) return res.status(status).json({ error: err.message });
    res.status(500).json({ error: 'Could not load contact messages' });
  }
}

module.exports = {
  RECENT_LIMIT,
  CONTACT_SUCCESS,
  ensureContactMessagesTable,
  saveContactMessage,
  listContactMessages,
  handleList,
};
