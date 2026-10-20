/**
 * Run: node services/contact-messages.test.js
 * Does not load server.js or open data/cyoa.db.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const contactMessages = require('./contact-messages');

const publicDir = path.join(__dirname, '..', 'public');
const REPLY = 'We read every message. If you have a PYPStories account, we\'ll reply with an in-site notice. Log in first so we can match your message to your account.';

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      email TEXT,
      role TEXT
    );
    CREATE TABLE contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ip TEXT
    );
  `);
  db.prepare('INSERT INTO users (id, username, email, role) VALUES (?, ?, ?, ?)').run(2, 'ada', 'ada@example.com', 'user');
  db.prepare('INSERT INTO users (id, username, email, role) VALUES (?, ?, ?, ?)').run(4, 'admin', 'admin@example.com', 'admin');
  db.prepare('INSERT INTO users (id, username, email, role) VALUES (?, ?, ?, ?)').run(5, 'ed', 'ed@example.com', 'editor');
  return db;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, urlPath, user) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const headers = {};
    if (user) headers['x-test-user'] = String(user.id);
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method: 'GET',
      path: urlPath,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch (err) { json = null; }
        resolve({
          status: res.statusCode,
          type: res.headers['content-type'] || '',
          body,
          json,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const fresh = new Database(':memory:');
  contactMessages.ensureContactMessagesTable(fresh);
  contactMessages.ensureContactMessagesTable(fresh);
  const cols = fresh.prepare('PRAGMA table_info(contact_messages)').all().map((col) => col.name);
  assert.ok(cols.includes('user_id'));
  assert.strictEqual(cols.filter((name) => name === 'user_id').length, 1);
  fresh.close();

  const db = buildDb();
  contactMessages.ensureContactMessagesTable(db);
  const loggedIn = contactMessages.saveContactMessage(db, {
    name: 'Ada',
    email: 'ada@example.com',
    message: 'Please delete my account data.',
    ip: '127.0.0.1',
    userId: 2,
  });
  assert.strictEqual(loggedIn.user_id, 2);

  const loggedOut = contactMessages.saveContactMessage(db, {
    name: 'Guest',
    email: 'guest@example.com',
    message: 'I am not logged in today.',
    ip: '10.0.0.8',
    userId: null,
  });
  assert.strictEqual(loggedOut.user_id, null);

  const ignoredBodyId = contactMessages.saveContactMessage(db, {
    name: 'Guest',
    email: 'guest2@example.com',
    message: 'Still logged out, ignore a forged id.',
    userId: undefined,
  });
  assert.strictEqual(ignoredBodyId.user_id, null);

  assert.throws(() => contactMessages.listContactMessages(db, null), (err) => err.status === 403);
  assert.throws(() => contactMessages.listContactMessages(db, { id: 2, role: 'user' }), (err) => err.status === 403);
  assert.throws(() => contactMessages.listContactMessages(db, { id: 5, role: 'editor' }), (err) => err.status === 403);
  assert.throws(
    () => contactMessages.listContactMessages(db, { id: 5, role: 'editor' }, { before: 2 }),
    (err) => err.status === 403
  );

  const originalExec = db.exec.bind(db);
  let schemaCalls = 0;
  db.exec = (...args) => {
    schemaCalls += 1;
    return originalExec(...args);
  };
  contactMessages.saveContactMessage(db, {
    name: 'Later',
    email: 'later@example.com',
    message: 'Saved without touching the schema.',
    userId: null,
  });
  const duringList = contactMessages.listContactMessages(db, { id: 4, role: 'admin' });
  assert.strictEqual(schemaCalls, 0);
  assert.strictEqual(duringList.messages.length, 4);
  db.exec = originalExec;

  const listed = contactMessages.listContactMessages(db, { id: 4, role: 'admin' });
  const messages = listed.messages;
  assert.strictEqual(listed.has_more, false);
  assert.strictEqual(messages.length, 4);
  assert.strictEqual(messages[1].user_id, null);
  assert.strictEqual(messages[3].user_id, 2);
  assert.strictEqual(messages[3].username, 'ada');
  assert.strictEqual(messages[3].account_email, 'ada@example.com');
  assert.strictEqual(messages[3].name, 'Ada');
  assert.ok(messages[3].message.includes('delete'));
  assert.ok(messages[3].created_at);
  assert.ok(messages[3].created_label.endsWith(' CT'));
  assert.ok(!messages[3].created_at.includes('CT'));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(messages[3], 'ip'), false);

  const pageDb = new Database(':memory:');
  pageDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      email TEXT,
      role TEXT
    );
  `);
  contactMessages.ensureContactMessagesTable(pageDb);
  const insert = pageDb.prepare(`
    INSERT INTO contact_messages (name, email, message, created_at, user_id)
    VALUES (?, ?, ?, ?, NULL)
  `);
  for (let i = 1; i <= 120; i++) {
    let stamp = '2026-03-01 12:00:00';
    if (i === 120) stamp = '2026-01-15 18:30:00';
    if (i === 70) stamp = '2026-07-15 18:30:00';
    insert.run('Person ' + i, 'p' + i + '@example.com', 'Hello from message ' + i + ' today.', stamp);
  }
  const adminActor = { id: 4, role: 'admin' };
  const first = contactMessages.listContactMessages(pageDb, adminActor, {});
  assert.strictEqual(first.messages.length, 50);
  assert.strictEqual(first.has_more, true);
  assert.strictEqual(first.messages[0].id, 120);
  assert.strictEqual(first.messages[49].id, 71);
  assert.strictEqual(first.messages[0].created_at, '2026-01-15 18:30:00');
  assert.strictEqual(first.messages[0].created_label, 'Jan 15, 2026, 12:30 PM CT');
  const second = contactMessages.listContactMessages(pageDb, adminActor, { before: first.messages[49].id });
  assert.strictEqual(second.messages.length, 50);
  assert.strictEqual(second.has_more, true);
  assert.strictEqual(second.messages[0].id, 70);
  assert.strictEqual(second.messages[49].id, 21);
  assert.strictEqual(second.messages[0].created_at, '2026-07-15 18:30:00');
  assert.strictEqual(second.messages[0].created_label, 'Jul 15, 2026, 1:30 PM CT');
  const third = contactMessages.listContactMessages(pageDb, adminActor, { before: second.messages[49].id });
  assert.strictEqual(third.messages.length, 20);
  assert.strictEqual(third.has_more, false);
  assert.strictEqual(third.messages[0].id, 20);
  assert.strictEqual(third.messages[19].id, 1);
  const seen = new Set();
  [first, second, third].forEach((page) => {
    page.messages.forEach((row) => {
      assert.strictEqual(seen.has(row.id), false);
      seen.add(row.id);
    });
  });
  assert.strictEqual(seen.size, 120);
  assert.throws(
    () => contactMessages.listContactMessages(pageDb, adminActor, { before: 'nope' }),
    (err) => err.status === 400
  );
  assert.throws(
    () => contactMessages.listContactMessages(pageDb, adminActor, { before: '0' }),
    (err) => err.status === 400
  );
  pageDb.close();

  const users = {
    2: { id: 2, role: 'user' },
    4: { id: 4, role: 'admin' },
    5: { id: 5, role: 'editor' },
  };
  const app = express();
  app.use((req, res, next) => {
    const id = req.headers['x-test-user'];
    req.testUser = id ? users[String(id)] : null;
    next();
  });
  app.get('/api/admin/contact-messages', (req, res) => {
    contactMessages.handleList(req, res, { db, user: req.testUser });
  });
  app.use(express.static(publicDir));
  const server = await listen(app);
  try {
    const anon = await request(server, '/api/admin/contact-messages');
    assert.strictEqual(anon.status, 401);
    const reader = await request(server, '/api/admin/contact-messages', users[2]);
    assert.strictEqual(reader.status, 403);
    const editor = await request(server, '/api/admin/contact-messages', users[5]);
    assert.strictEqual(editor.status, 403);
    assert.ok(!editor.body.includes('delete my account'));
    const admin = await request(server, '/api/admin/contact-messages', users[4]);
    assert.strictEqual(admin.status, 200);
    assert.ok(admin.type.includes('application/json'));
    assert.strictEqual(admin.json.messages.length, 4);
    assert.strictEqual(admin.json.has_more, false);
    assert.strictEqual(admin.json.messages[3].username, 'ada');
    assert.ok(String(admin.json.messages[3].created_label).endsWith(' CT'));
    const newestId = admin.json.messages[0].id;
    const older = await request(server, '/api/admin/contact-messages?before=' + newestId, users[4]);
    assert.strictEqual(older.status, 200);
    assert.strictEqual(older.json.messages.length, 3);
    assert.ok(older.json.messages.every((row) => row.id < newestId));
    const editorPaged = await request(server, '/api/admin/contact-messages?before=' + newestId, users[5]);
    assert.strictEqual(editorPaged.status, 403);
    assert.ok(!editorPaged.body.includes('delete my account'));
    const badBefore = await request(server, '/api/admin/contact-messages?before=nope', users[4]);
    assert.strictEqual(badBefore.status, 400);

    const pages = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html'));
    assert.ok(pages.includes('contact.html'));
    for (const name of pages) {
      const res = await request(server, '/' + name);
      assert.strictEqual(res.status, 200, name);
      assert.ok(!res.body.includes('contact@'), name + ' still has contact@');
      assert.ok(!/mailto:/i.test(res.body), name + ' still has a mailto link');
      const inline = res.body.match(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi) || [];
      inline.forEach((tag) => {
        assert.ok(/\bsrc\s*=/i.test(tag) || /application\/ld\+json/i.test(tag), name + ' has an inline script');
      });
    }

    const contact = await request(server, '/contact.html');
    assert.ok(contact.body.includes(REPLY));
    assert.ok(contact.body.includes('action="/api/contact"'));
    assert.ok(contact.body.includes('src="/js/contact.js"'));
    assert.ok(!/we reply by email/i.test(contact.body));

    const privacy = await request(server, '/privacy.html');
    assert.ok(privacy.body.includes('href="/contact.html">contact form</a>'));
    assert.ok(!/data deletion/i.test(privacy.body) || privacy.body.includes('contact form'));

    const terms = await request(server, '/terms.html');
    assert.ok(terms.body.includes('href="/contact.html">contact page</a>'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  assert.ok(contactMessages.CONTACT_SUCCESS.includes('in-site notice'));
  assert.ok(!/email/i.test(contactMessages.CONTACT_SUCCESS));

  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeAt = serverSrc.indexOf("app.get('/api/admin/contact-messages'");
  assert.ok(routeAt > 0);
  const route = serverSrc.slice(routeAt, routeAt + 180);
  assert.ok(route.includes('requireAdmin'));
  assert.ok(route.includes('contactMessages.handleList'));
  assert.ok(serverSrc.includes('userId: sender ? sender.id : null'));
  assert.ok(!serverSrc.includes('req.body.user_id'));
  assert.ok(serverSrc.includes('contactMessages.CONTACT_SUCCESS'));
  assert.ok(!/get back to you by email/i.test(serverSrc));
  assert.strictEqual(serverSrc.match(/ensureContactMessagesTable/g).length, 1);

  const serviceSrc = fs.readFileSync(path.join(__dirname, 'contact-messages.js'), 'utf8');
  assert.ok(!/sendEmail|nodemailer|sendMail/i.test(serviceSrc));
  const saveSrc = serviceSrc.slice(
    serviceSrc.indexOf('function saveContactMessage'),
    serviceSrc.indexOf('function listContactMessages')
  );
  const listSrc = serviceSrc.slice(
    serviceSrc.indexOf('function listContactMessages'),
    serviceSrc.indexOf('function handleList')
  );
  assert.ok(!saveSrc.includes('ensureContactMessagesTable'));
  assert.ok(!listSrc.includes('ensureContactMessagesTable'));
  assert.ok(listSrc.includes('WHERE m.id < ?'));
  assert.ok(serviceSrc.includes("timeZone: 'America/Chicago'"));

  const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const notifyAt = indexHtml.indexOf('id="admin-notify-panel"');
  const gridAt = indexHtml.indexOf('id="admin-reviews-grid"');
  const contactAt = indexHtml.indexOf('id="admin-contact-panel"');
  assert.ok(notifyAt > 0 && notifyAt < gridAt && gridAt < contactAt);
  assert.ok(indexHtml.includes('id="admin-contact-older"'));
  assert.ok(indexHtml.includes('Show older'));
  assert.ok(!indexHtml.includes('onclick='));

  const appSrc = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');
  assert.ok(appSrc.includes("button.textContent = 'Send notice'"));
  assert.ok(appSrc.includes('body.textContent = item.message'));
  assert.ok(appSrc.includes("'/api/admin/contact-messages'"));
  assert.ok(appSrc.includes('?before='));
  assert.ok(appSrc.includes('item.created_label'));

  const contactJs = fs.readFileSync(path.join(publicDir, 'js', 'contact.js'), 'utf8');
  assert.ok(contactJs.includes("fetch('/api/me'"));
  assert.ok(contactJs.includes('contact-name'));
  assert.ok(contactJs.includes('contact-email'));
  assert.ok(contactJs.includes('applyAccountPrefill'));

  console.log('ALL PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
