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

async function testAccess() {
  const off = baseDb();
  const people = seedStory(off, { allow: 0, purchased: true });
  const refusedOff = await offline.renderOfflineDownload(off, { user: people.buyer, comicId: 5, uploadsRoot: null });
  assert.strictEqual(refusedOff.ok, false);
  assert.strictEqual(refusedOff.status, 403);
  assert.match(refusedOff.error, /not enabled/);

  const locked = baseDb();
  const lockedPeople = seedStory(locked, { allow: 1, purchased: false });
  const refusedPurchase = await offline.renderOfflineDownload(locked, { user: lockedPeople.buyer, comicId: 5, uploadsRoot: null });
  assert.strictEqual(refusedPurchase.ok, false);
  assert.strictEqual(refusedPurchase.status, 403);
  assert.match(refusedPurchase.error, /Purchase this story/);

  const open = baseDb();
  const openPeople = seedStory(open, { allow: 1, purchased: true });
  const allowed = await offline.renderOfflineDownload(open, { user: openPeople.buyer, comicId: 5, uploadsRoot: null });
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

  const creatorOnly = await offline.renderOfflineDownload(open, { user: openPeople.creator, comicId: 5, uploadsRoot: null });
  assert.strictEqual(creatorOnly.ok, true);

  const adminDb = baseDb();
  const adminPeople = seedStory(adminDb, { allow: 1, purchased: false, role: 'admin' });
  const adminOk = await offline.renderOfflineDownload(adminDb, { user: adminPeople.buyer, comicId: 5, uploadsRoot: null });
  assert.strictEqual(adminOk.ok, true);

  assert.throws(
    () => offline.applyAllowDownloadChange(0, 1, false),
    /permanently/
  );
  assert.deepStrictEqual(offline.applyAllowDownloadChange(0, 1, true), { changed: true, value: 1 });
  assert.deepStrictEqual(offline.applyAllowDownloadChange(1, 0, false), { changed: true, value: 0 });
  console.log('PASS download refused when disabled or unpurchased, allowed when purchased');
}

async function testEscapingAndImages() {
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
    const result = await offline.renderOfflineDownload(db, {
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

async function testUniqueImagesAndByteCap() {
  const db = baseDb();
  const people = seedStory(db, { allow: 1, purchased: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyp-offline-cap-'));
  fs.mkdirSync(path.join(root, '5'), { recursive: true });
  fs.writeFileSync(path.join(root, '5', 'dot.png'), PNG);
  const b64 = PNG.toString('base64');
  try {
    assert.strictEqual(offline.OFFLINE_IMAGE_BYTE_LIMIT, 40 * 1024 * 1024);
    assert.strictEqual(
      offline.offlineImageTooLargeMessage(offline.OFFLINE_IMAGE_BYTE_LIMIT),
      "This story's images are too large for an offline copy. The limit is 40 MB."
    );

    const once = await offline.renderOfflineDownload(db, {
      user: people.buyer,
      comicId: 5,
      uploadsRoot: root,
      maxImageBytes: PNG.length,
    });
    assert.strictEqual(once.ok, true);
    assert.strictEqual(once.body.split(b64).length - 1, 1);

    db.prepare(`UPDATE choices SET choice_image = ? WHERE from_page_id = 10`).run('/uploads/comics/5/missing.png');
    const missing = await offline.renderOfflineDownload(db, {
      user: people.buyer,
      comicId: 5,
      uploadsRoot: root,
      maxImageBytes: PNG.length,
    });
    assert.strictEqual(missing.ok, true);
    assert.strictEqual(missing.body.split(b64).length - 1, 1);

    const two = Buffer.concat([PNG, PNG]);
    fs.writeFileSync(path.join(root, '5', 'two.png'), two);
    db.prepare(`UPDATE pages SET image_path = ? WHERE id = 11`).run('/uploads/comics/5/two.png');
    const over = await offline.renderOfflineDownload(db, {
      user: people.buyer,
      comicId: 5,
      uploadsRoot: root,
      maxImageBytes: PNG.length,
    });
    assert.strictEqual(over.ok, false);
    assert.strictEqual(over.status, 413);
    assert.strictEqual(over.error, offline.offlineImageTooLargeMessage(PNG.length));
    assert.match(over.error, /too large/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('PASS each image is embedded once and oversized stories return 413');
}

function tryFileSymlink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, 'file');
    return true;
  } catch (err) {
    if (!err || (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'ENOTSUP')) throw err;
    return false;
  }
}

function removeReparse(linkPath) {
  try { fs.unlinkSync(linkPath); } catch (err) {
    try { fs.rmdirSync(linkPath); } catch (err2) { /* already gone */ }
  }
}

async function testSymlinkEscape() {
  const db = baseDb();
  offline.ensureAllowDownloadColumn(db);
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (1, 'AuthorName', 'author@secret.test', 'user')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (2, 'BuyerName', 'buyer@secret.test', 'user')`).run();
  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, allow_download)
    VALUES (5, 1, 'Linked', 'blurb', 1)
  `).run();
  db.prepare(`INSERT INTO purchases (user_id, comic_id, amount_paid_cents) VALUES (2, 5, 599)`).run();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyp-offline-jail-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pyp-offline-out-'));
  const secret = Buffer.from('SECRET_FILE_BYTES');
  const comicDir = path.join(root, '5');
  fs.mkdirSync(comicDir, { recursive: true });
  const secretFile = path.join(outside, 'secret.png');
  fs.writeFileSync(secretFile, secret);
  fs.writeFileSync(path.join(comicDir, 'dot.png'), PNG);

  const reparse = [];
  let outsideUrl;
  if (tryFileSymlink(secretFile, path.join(comicDir, 'link.png'))) {
    outsideUrl = '/uploads/comics/5/link.png';
    reparse.push(path.join(comicDir, 'link.png'));
  } else {
    // File symlinks need extra Windows privilege. A directory junction is still
    // a reparse point that fs.realpath follows, and it can be created unprivileged.
    const junction = path.join(comicDir, 'escape');
    fs.symlinkSync(outside, junction, 'junction');
    reparse.push(junction);
    outsideUrl = '/uploads/comics/5/escape/secret.png';
  }

  let insideUrl;
  if (tryFileSymlink(path.join(comicDir, 'dot.png'), path.join(comicDir, 'inside.png'))) {
    insideUrl = '/uploads/comics/5/inside.png';
    reparse.push(path.join(comicDir, 'inside.png'));
  } else {
    const kept = path.join(comicDir, 'kept');
    fs.mkdirSync(kept);
    fs.copyFileSync(path.join(comicDir, 'dot.png'), path.join(kept, 'dot.png'));
    const alias = path.join(comicDir, 'alias');
    fs.symlinkSync(kept, alias, 'junction');
    reparse.push(alias);
    insideUrl = '/uploads/comics/5/alias/dot.png';
  }

  db.prepare(`
    INSERT INTO pages (id, comic_id, title, text_content, image_path, is_start)
    VALUES (10, 5, 'Start', 'Hello', ?, 1)
  `).run(insideUrl);
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, text_content, is_start)
    VALUES (11, 5, 'End', 'Bye', 0)
  `).run();
  db.prepare(`
    INSERT INTO choices (from_page_id, choice_text, to_page_id, choice_image)
    VALUES (10, 'Go', 11, ?)
  `).run(outsideUrl);

  try {
    const lexical = offline.localComicImagePath(outsideUrl, root);
    assert.ok(lexical);
    assert.ok(!lexical.startsWith('..'));
    const result = await offline.renderOfflineDownload(db, {
      user: { id: 2, username: 'BuyerName', role: 'user' },
      comicId: 5,
      uploadsRoot: root,
      maxImageBytes: PNG.length,
    });
    assert.strictEqual(result.ok, true, result.error);
    assert.ok(!result.body.includes('SECRET_FILE_BYTES'));
    assert.ok(!result.body.includes(secret.toString('base64')));
    assert.strictEqual(result.body.split(PNG.toString('base64')).length - 1, 1);
  } finally {
    reparse.forEach(removeReparse);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
  console.log('PASS symlinks that leave the uploads directory are not embedded');
}

async function main() {
  testMigrationRerunnable();
  await testAccess();
  await testEscapingAndImages();
  await testUniqueImagesAndByteCap();
  await testSymlinkEscape();
  console.log('ALL PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
