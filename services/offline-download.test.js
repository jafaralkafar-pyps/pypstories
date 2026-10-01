/**
 * Offline story download. Run: node services/offline-download.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const offline = require('./offline-download');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function baseDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'user',
      stripe_account_id TEXT
    );
    CREATE TABLE comics (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      review_notes TEXT
    );
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY,
      comic_id INTEGER NOT NULL,
      title TEXT DEFAULT '',
      image_path TEXT,
      text_content TEXT DEFAULT '',
      is_start INTEGER DEFAULT 0
    );
    CREATE TABLE choices (
      id INTEGER PRIMARY KEY,
      from_page_id INTEGER NOT NULL,
      choice_text TEXT NOT NULL,
      to_page_id INTEGER NOT NULL,
      choice_image TEXT
    );
    CREATE TABLE purchases (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      comic_id INTEGER NOT NULL,
      amount_paid_cents INTEGER NOT NULL
    );
  `);
  return db;
}

function columnCount(db, name) {
  return db.prepare('PRAGMA table_info(comics)').all().filter((col) => col.name === name).length;
}

function seedStory(db, { allow = 0, purchased = false, role = 'user' } = {}) {
  offline.ensureAllowDownloadColumn(db);
  db.prepare(`INSERT INTO users (id, username, email, role, stripe_account_id) VALUES (1, 'AuthorName', 'author@secret.test', 'user', 'acct_author')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role, stripe_account_id) VALUES (2, ?, 'buyer@secret.test', ?, 'acct_buyer')`).run(
    role === 'admin' ? 'AdminUser' : 'BuyerName',
    role
  );
  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, status, review_notes, allow_download)
    VALUES (5, 1, 'A walk', 'A public blurb', 'published', 'ADMIN_NOTE_SECRET', ?)
  `).run(allow ? 1 : 0);
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, text_content, image_path, is_start)
    VALUES (10, 5, 'Start', 'Hello path', '/uploads/comics/5/dot.png', 1)
  `).run();
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, text_content, is_start)
    VALUES (11, 5, 'End', 'Goodbye', 0)
  `).run();
  db.prepare(`
    INSERT INTO choices (from_page_id, choice_text, to_page_id, choice_image)
    VALUES (10, 'Go on', 11, '/uploads/comics/5/dot.png')
  `).run();
  if (purchased) {
    db.prepare(`INSERT INTO purchases (user_id, comic_id, amount_paid_cents) VALUES (2, 5, 599)`).run();
  }
  return {
    buyer: { id: 2, username: role === 'admin' ? 'AdminUser' : 'BuyerName', role, email: 'buyer@secret.test', stripe_account_id: 'acct_buyer' },
    creator: { id: 1, username: 'AuthorName', role: 'user' },
  };
}

function testMigrationRerunnable() {
  const db = baseDb();
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'AuthorName')`).run();
  db.prepare(`INSERT INTO comics (id, user_id, title) VALUES (1, 1, 'Old story')`).run();

  assert.strictEqual(columnCount(db, 'allow_download'), 0);
  assert.strictEqual(offline.ensureAllowDownloadColumn(db), true);
  assert.strictEqual(columnCount(db, 'allow_download'), 1);
  const after = db.prepare('SELECT allow_download FROM comics WHERE id = 1').get();
  assert.strictEqual(after.allow_download, 0);

  db.prepare('UPDATE comics SET allow_download = 1 WHERE id = 1').run();
  assert.strictEqual(offline.ensureAllowDownloadColumn(db), false);
  assert.strictEqual(columnCount(db, 'allow_download'), 1);
  assert.strictEqual(db.prepare('SELECT allow_download FROM comics WHERE id = 1').get().allow_download, 1);
  console.log('PASS migration is re-runnable and leaves existing values alone');
}

function testAccess() {
  const off = baseDb();
  const people = seedStory(off, { allow: 0, purchased: true });
  const refusedOff = offline.renderOfflineDownload(off, { user: people.buyer, comicId: 5, uploadsRoot: null });
  assert.strictEqual(refusedOff.ok, false);
  assert.strictEqual(refusedOff.status, 403);
  assert.match(refusedOff.error, /not enabled/);

  const locked = baseDb();
  const lockedPeople = seedStory(locked, { allow: 1, purchased: false });
  const refusedPurchase = offline.renderOfflineDownload(locked, { user: lockedPeople.buyer, comicId: 5, uploadsRoot: null });
  assert.strictEqual(refusedPurchase.ok, false);
  assert.strictEqual(refusedPurchase.status, 403);
  assert.match(refusedPurchase.error, /Purchase this story/);

  const open = baseDb();
  const openPeople = seedStory(open, { allow: 1, purchased: true });
  const allowed = offline.renderOfflineDownload(open, { user: openPeople.buyer, comicId: 5, uploadsRoot: null });
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.status, 200);
  assert.match(allowed.headers['Content-Type'], /text\/html/);
  assert.match(allowed.body, /Copy for BuyerName/);
  assert.ok(!allowed.body.includes('buyer@secret.test'));
  assert.ok(!allowed.body.includes('acct_buyer'));
  assert.ok(!allowed.body.includes('acct_author'));
  assert.ok(!allowed.body.includes('ADMIN_NOTE_SECRET'));
  assert.ok(allowed.body.includes('localStorage'));
  assert.ok(!allowed.body.includes('fetch('));

  const creatorOnly = offline.renderOfflineDownload(open, { user: openPeople.creator, comicId: 5, uploadsRoot: null });
  assert.strictEqual(creatorOnly.ok, true);

  const adminDb = baseDb();
  const adminPeople = seedStory(adminDb, { allow: 1, purchased: false, role: 'admin' });
  const adminOk = offline.renderOfflineDownload(adminDb, { user: adminPeople.buyer, comicId: 5, uploadsRoot: null });
  assert.strictEqual(adminOk.ok, true);

  assert.throws(
    () => offline.applyAllowDownloadChange(0, 1, false),
    /permanently/
  );
  assert.deepStrictEqual(offline.applyAllowDownloadChange(0, 1, true), { changed: true, value: 1 });
  assert.deepStrictEqual(offline.applyAllowDownloadChange(1, 0, false), { changed: true, value: 0 });
  console.log('PASS download refused when disabled or unpurchased, allowed when purchased');
}

function testEscapingAndImages() {
  const db = baseDb();
  offline.ensureAllowDownloadColumn(db);
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (1, 'AuthorName', 'author@secret.test', 'user')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (2, ?, 'buyer@secret.test', 'user')`).run('<img src=x onerror=alert(1)>');
  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, allow_download, review_notes)
    VALUES (5, 1, ?, 'blurb', 1, 'ADMIN_NOTE_SECRET')
  `).run('</title><script>alert(1)</script>');
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, text_content, image_path, is_start)
    VALUES (10, 5, ?, ?, ?, 1)
  `).run('<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '/uploads/comics/5/dot.png');
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, text_content, is_start) VALUES (11, 5, 'End', '</script><script>alert(1)</script>', 0)
  `).run();
  db.prepare(`
    INSERT INTO choices (from_page_id, choice_text, to_page_id, choice_image)
    VALUES (10, ?, 11, ?)
  `).run('"><script>alert(1)</script>', '/uploads/comics/../secret.txt');
  db.prepare(`INSERT INTO purchases (user_id, comic_id, amount_paid_cents) VALUES (2, 5, 599)`).run();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyp-offline-'));
  fs.mkdirSync(path.join(root, '5'), { recursive: true });
  fs.writeFileSync(path.join(root, '5', 'dot.png'), PNG);
  fs.writeFileSync(path.join(root, 'secret.txt'), 'SECRET_FILE_BYTES');

  try {
    const outside = offline.localComicImagePath('/uploads/comics/../secret.txt', root);
    assert.strictEqual(outside, null);
    const result = offline.renderOfflineDownload(db, {
      user: { id: 2, username: '<img src=x onerror=alert(1)>', role: 'user' },
      comicId: 5,
      uploadsRoot: root,
    });
    assert.strictEqual(result.ok, true);
    const html = result.body;
    assert.strictEqual((html.match(/<script/gi) || []).length, 2);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('SECRET_FILE_BYTES'));
    assert.ok(!html.includes('ADMIN_NOTE_SECRET'));
    assert.ok(!html.includes('buyer@secret.test'));
    assert.ok(html.includes('data:image/png;base64,'));
    assert.ok(html.includes('Copy for &lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('\\u003cscript'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('PASS story text is escaped and images stay inside the uploads folder');
}

function main() {
  testMigrationRerunnable();
  testAccess();
  testEscapingAndImages();
  console.log('ALL PASS');
}

main();
