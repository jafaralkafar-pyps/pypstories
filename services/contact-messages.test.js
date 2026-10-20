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

  const messages = contactMessages.listContactMessages(db, { id: 4, role: 'admin' });
  assert.strictEqual(messages.length, 3);
  assert.strictEqual(messages[0].user_id, null);
  assert.strictEqual(messages[2].user_id, 2);
  assert.strictEqual(messages[2].username, 'ada');
  assert.strictEqual(messages[2].account_email, 'ada@example.com');
  assert.strictEqual(messages[2].name, 'Ada');
  assert.ok(messages[2].message.includes('delete'));
  assert.ok(messages[2].created_at);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(messages[2], 'ip'), false);

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
    assert.strictEqual(admin.json.messages.length, 3);
    assert.strictEqual(admin.json.messages[2].username, 'ada');

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

  const serviceSrc = fs.readFileSync(path.join(__dirname, 'contact-messages.js'), 'utf8');
  assert.ok(!/sendEmail|nodemailer|sendMail/i.test(serviceSrc));

  const appSrc = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');
  assert.ok(appSrc.includes("button.textContent = 'Send notice'"));
  assert.ok(appSrc.includes('body.textContent = item.message'));
  assert.ok(appSrc.includes("fetch('/api/admin/contact-messages')"));

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
