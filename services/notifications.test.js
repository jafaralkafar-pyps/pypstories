/**
 * In-site notices. Run: node services/notifications.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const notices = require('./notifications');

function baseDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'user'
    );
  `);
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (1, 'Admin', 'admin@example.com', 'admin')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (2, 'Reader', 'reader@example.com', 'user')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (3, 'Editor', 'editor@example.com', 'editor')`).run();
  notices.ensureNotificationsTable(db);
  return db;
}

function send(db, actor, extra) {
  return notices.createNotification(db, actor, Object.assign({
    user_id: 2,
    title: 'Hello',
    body: 'A notice',
  }, extra || {}));
}

function testSchema() {
  const db = baseDb();
  const cols = db.prepare('PRAGMA table_info(notifications)').all().map((col) => col.name);
  ['id', 'user_id', 'title', 'body', 'link_url', 'created_at', 'read_at'].forEach((name) => {
    assert.ok(cols.includes(name), name);
  });
  const index = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_notifications_user_read'
  `).get();
  assert.ok(index);
  send(db, { id: 1, role: 'admin' });
  notices.ensureNotificationsTable(db);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 1);
  console.log('PASS notifications table is created with a user/read index');
}

function testAdminOnlyAndValidation() {
  const db = baseDb();
  const admin = { id: 1, role: 'admin' };
  assert.strictEqual(notices.canSendNotification(admin), true);
  assert.strictEqual(notices.canSendNotification({ id: 2, role: 'user' }), false);
  assert.strictEqual(notices.canSendNotification({ id: 3, role: 'editor' }), false);
  assert.strictEqual(notices.canSendNotification(null), false);

  assert.throws(() => send(db, { id: 2, role: 'user' }), (err) => err.status === 403);
  assert.throws(() => send(db, { id: 3, role: 'editor' }), (err) => err.status === 403);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0);

  assert.throws(() => send(db, admin, { user_id: 99 }), (err) => err.status === 400);
  assert.throws(() => send(db, admin, { title: '' }), (err) => err.status === 400);
  assert.throws(() => send(db, admin, { title: 'x'.repeat(notices.TITLE_MAX + 1) }), (err) => err.status === 400 && /120/.test(err.message));
  assert.throws(() => send(db, admin, { body: 'y'.repeat(notices.BODY_MAX + 1) }), (err) => err.status === 400 && /1000/.test(err.message));
  assert.throws(() => send(db, admin, { link_url: 'http://example.com/a' }), (err) => err.status === 400);
  assert.throws(() => send(db, admin, { link_url: 'javascript:alert(1)' }), (err) => err.status === 400);
  assert.throws(() => send(db, admin, { link_url: 'https://user:pass@example.com/a' }), (err) => err.status === 400);

  const exact = send(db, admin, {
    title: 't'.repeat(notices.TITLE_MAX),
    body: 'b'.repeat(notices.BODY_MAX),
    link_url: ' https://example.com/path ',
  });
  assert.strictEqual(exact.title.length, 120);
  assert.strictEqual(exact.body.length, 1000);
  assert.strictEqual(exact.link_url, 'https://example.com/path');
  assert.strictEqual(exact.unread, true);

  const noLink = send(db, admin, { link_url: '   ' });
  assert.strictEqual(noLink.link_url, null);

  const found = notices.searchUsers(db, 'read');
  assert.deepStrictEqual(found.map((user) => user.id), [2]);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(found[0], 'password_hash'), false);
  console.log('PASS only an admin can send, and title, body, and https links are checked');
}

function testOwnRowsOnly() {
  const db = baseDb();
  const admin = { id: 1, role: 'admin' };
  const mine = send(db, admin, { user_id: 2, title: 'For reader' });
  const other = send(db, admin, { user_id: 3, title: 'For editor' });

  const readerList = notices.listForUser(db, 2);
  assert.strictEqual(readerList.unread_count, 1);
  assert.deepStrictEqual(readerList.notifications.map((row) => row.id), [mine.id]);
  assert.strictEqual(readerList.notifications[0].unread, true);

  assert.throws(() => notices.markRead(db, 2, other.id), (err) => err.status === 404);
  assert.strictEqual(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(other.id).read_at, null);

  const marked = notices.markRead(db, 2, mine.id);
  assert.strictEqual(marked.unread, false);
  assert.ok(marked.read_at);
  assert.strictEqual(notices.listForUser(db, 2).unread_count, 0);

  send(db, admin, { user_id: 2, title: 'Second' });
  send(db, admin, { user_id: 3, title: 'Stay unread' });
  const updated = notices.markAllRead(db, 2);
  assert.strictEqual(updated.updated, 1);
  assert.strictEqual(notices.listForUser(db, 2).unread_count, 0);
  assert.strictEqual(notices.listForUser(db, 3).unread_count, 2);
  assert.throws(() => notices.markRead(db, 2, 'nope'), (err) => err.status === 404);
  console.log('PASS a user can only list and mark their own notices');
}

function testNoEmail() {
  const src = fs.readFileSync(path.join(__dirname, 'notifications.js'), 'utf8');
  assert.ok(!/nodemailer|sendMail|mailto:/i.test(src));
  console.log('PASS notice service does not send email');
}

function main() {
  testSchema();
  testAdminOnlyAndValidation();
  testOwnRowsOnly();
  testNoEmail();
  console.log('ALL PASS');
}

main();
