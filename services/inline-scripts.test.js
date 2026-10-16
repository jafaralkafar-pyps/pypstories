/**
 * Run: node services/inline-scripts.test.js
 * Does not load server.js or open data/cyoa.db.
 * Served HTML may use <script src> and JSON-LD. An inline script with
 * executable content fails.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const publicPages = require('./public-pages');

const publicDir = path.join(__dirname, '..', 'public');
const indexPath = path.join(publicDir, 'index.html');

function executableInlineScripts(html) {
  const found = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    if (!body.trim()) continue;
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*(['"])application\/ld\+json\1/i.test(attrs)) continue;
    found.push(body.trim().slice(0, 120));
  }
  return found;
}

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
    CREATE TABLE comics (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      title TEXT,
      description TEXT,
      genre TEXT,
      cover_image TEXT,
      status TEXT,
      submitted_at TEXT,
      created_at TEXT
    );
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY,
      comic_id INTEGER,
      image_path TEXT,
      is_start INTEGER
    );
  `);
  db.prepare('INSERT INTO users (id, username) VALUES (1, ?)').run('ada');
  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, genre, cover_image, status, submitted_at, created_at)
    VALUES (1, 1, 'Forest Path', 'A short branching story.', 'Fantasy', '', 'published', '2026-10-01', '2026-09-01')
  `).run();
  return db;
}

function buildApp(db) {
  const app = express();
  publicPages.mountEarlyRoutes(app, { db, indexPath });
  app.use(express.static(publicDir));
  app.use((req, res) => publicPages.handleFallback(req, res, { db, publicDir, indexPath }));
  return app;
}

function request(server, urlPath) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method: 'GET',
      path: urlPath,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          type: res.headers['content-type'] || '',
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  assert.deepStrictEqual(executableInlineScripts('<script>alert(1)</script>'), ['alert(1)']);
  assert.deepStrictEqual(executableInlineScripts('<script src="/js/contact.js"></script>'), []);
  assert.deepStrictEqual(executableInlineScripts('<script src="/js/app.js" defer></script>'), []);
  assert.deepStrictEqual(
    executableInlineScripts('<script type="application/ld+json">{"@type":"WebSite"}</script>'),
    []
  );
  assert.deepStrictEqual(executableInlineScripts('<script type="text/javascript">var x = 1;</script>'), ['var x = 1;']);

  const db = buildDb();
  const app = buildApp(db);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const paths = [
      '/',
      '/browse',
      '/verify',
      '/reset-password',
      '/search/ada',
      '/privacy.html',
      '/terms.html',
      '/content-policy.html',
      '/how-it-works.html',
      '/contact.html',
      '/story/1/forest-path',
      '/not-a-real-page',
    ];
    for (const urlPath of paths) {
      const res = await request(server, urlPath);
      assert.ok(res.status === 200 || res.status === 404, urlPath + ' status ' + res.status);
      assert.ok(res.type.includes('html'), urlPath + ' type ' + res.type);
      const inline = executableInlineScripts(res.body);
      assert.deepStrictEqual(inline, [], urlPath + ' inline script: ' + inline.join(' | '));
    }

    const home = await request(server, '/');
    assert.ok(home.body.includes('application/ld+json'), 'home JSON-LD should stay inline');
    assert.ok(home.body.includes('src="/js/footer-year.js"'), 'home footer year script');
    assert.ok(!home.body.includes('onclick='), 'home served HTML still has an inline handler');

    const contact = await request(server, '/contact.html');
    assert.ok(contact.body.includes('src="/js/contact.js"'));
    assert.ok(contact.body.includes('method="post"'));
    assert.ok(contact.body.includes('action="/api/contact"'));

    const story = await request(server, '/story/1/forest-path');
    assert.strictEqual(story.status, 200);
    assert.ok(!/<script\b/i.test(story.body), 'story page should not need a script');

    const missing = await request(server, '/not-a-real-page');
    assert.strictEqual(missing.status, 404);
    assert.ok(!/<script\b/i.test(missing.body), '404 should not need a script');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  console.log('PASS inline scripts');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
