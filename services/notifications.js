/**
 * In-site notices. This module never sends email.
 */

const TITLE_MAX = 120;
const BODY_MAX = 1000;

function ensureNotificationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, read_at);
  `);
}

function canSendNotification(user) {
  return !!(user && user.role === 'admin');
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseUserId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function requireText(value, field, max) {
  if (typeof value !== 'string') throw fail(400, field + ' is required');
  const text = value.trim();
  if (!text) throw fail(400, field + ' is required');
  if (text.length > max) throw fail(400, field + ' must be at most ' + max + ' characters');
  return text;
}

function normalizeLink(linkUrl) {
  if (linkUrl == null) return null;
  if (typeof linkUrl !== 'string') throw fail(400, 'link_url must start with https://');
  const trimmed = linkUrl.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('https://') || /\s/.test(trimmed)) {
    throw fail(400, 'link_url must start with https://');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw fail(400, 'link_url must start with https://');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw fail(400, 'link_url must start with https://');
  }
  if (!parsed.href.startsWith('https://')) throw fail(400, 'link_url must start with https://');
  return parsed.href;
}

function validateNotificationInput(db, input) {
  const payload = input || {};
  const userId = parseUserId(payload.user_id);
  if (!userId) throw fail(400, 'user_id must be an existing user');
  const title = requireText(payload.title, 'title', TITLE_MAX);
  const body = requireText(payload.body, 'body', BODY_MAX);
  const linkUrl = normalizeLink(payload.link_url);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw fail(400, 'user_id must be an existing user');
  return { userId, title, body, linkUrl };
}

function publicNotice(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    body: row.body,
    link_url: row.link_url || null,
    created_at: row.created_at,
    read_at: row.read_at || null,
    unread: !row.read_at,
  };
}

function createNotification(db, actor, input) {
  if (!canSendNotification(actor)) throw fail(403, 'Admin access required');
  const notice = validateNotificationInput(db, input);
  const result = db.prepare(`
    INSERT INTO notifications (user_id, title, body, link_url)
    VALUES (?, ?, ?, ?)
  `).run(notice.userId, notice.title, notice.body, notice.linkUrl);
  const row = db.prepare(`
    SELECT id, user_id, title, body, link_url, created_at, read_at
    FROM notifications WHERE id = ?
  `).get(result.lastInsertRowid);
  return publicNotice(row);
}

function listForUser(db, userId) {
  const id = parseUserId(userId);
  if (!id) return { unread_count: 0, notifications: [] };
  const rows = db.prepare(`
    SELECT id, user_id, title, body, link_url, created_at, read_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
  `).all(id);
  return {
    unread_count: rows.filter((row) => !row.read_at).length,
    notifications: rows.map(publicNotice),
  };
}

function markRead(db, userId, notificationId) {
  const ownerId = parseUserId(userId);
  const id = parseUserId(notificationId);
  if (!ownerId || !id) throw fail(404, 'Notification not found');
  const row = db.prepare('SELECT id, user_id, read_at FROM notifications WHERE id = ?').get(id);
  if (!row || Number(row.user_id) !== ownerId) throw fail(404, 'Notification not found');
  if (!row.read_at) {
    db.prepare(`
      UPDATE notifications SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND read_at IS NULL
    `).run(id, ownerId);
  }
  const updated = db.prepare(`
    SELECT id, user_id, title, body, link_url, created_at, read_at
    FROM notifications WHERE id = ?
  `).get(id);
  return publicNotice(updated);
}

function markAllRead(db, userId) {
  const ownerId = parseUserId(userId);
  if (!ownerId) return { updated: 0 };
  const result = db.prepare(`
    UPDATE notifications SET read_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND read_at IS NULL
  `).run(ownerId);
  return { updated: result.changes };
}

function searchUsers(db, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (q.length > 80) throw fail(400, 'Search is too long');
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  return db.prepare(`
    SELECT id, username, email
    FROM users
    WHERE username LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE
    ORDER BY username COLLATE NOCASE, id ASC
    LIMIT 20
  `).all(like, like);
}

module.exports = {
  TITLE_MAX,
  BODY_MAX,
  ensureNotificationsTable,
  canSendNotification,
  validateNotificationInput,
  createNotification,
  listForUser,
  markRead,
  markAllRead,
  searchUsers,
};
