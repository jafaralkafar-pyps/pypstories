/**
 * Run: node services/read-access.test.js
 * Does not load server.js or open data/cyoa.db.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const readAccess = require('./read-access');
const publicPages = require('./public-pages');

const DEEP = 'DEEP_SECRET_TEXT';
const RIGHT = 'RIGHT_BRANCH_TEXT';
const DRAFT = 'DRAFT_SECRET_TEXT';
const FREE_FAR = 'FREE_FAR_TEXT';
const THUMB = '/uploads/comics/secret-thumb.png';

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      role TEXT
    );
    CREATE TABLE comics (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      title TEXT,
      status TEXT,
      price_cents INTEGER,
      reviewed_by INTEGER
    );
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY,
      comic_id INTEGER,
      title TEXT,
      image_path TEXT,
      text_content TEXT,
      is_start INTEGER
    );
    CREATE TABLE choices (
      id INTEGER PRIMARY KEY,
      from_page_id INTEGER,
      choice_text TEXT,
      to_page_id INTEGER,
      choice_image TEXT
    );
    CREATE TABLE purchases (
      user_id INTEGER,
      comic_id INTEGER
    );
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY,
      comic_id INTEGER,
      price_cents INTEGER
    );
    CREATE TABLE chapter_unlocks (
      user_id INTEGER,
      comic_id INTEGER,
      chapter_id INTEGER
    );
  `);

  const addUser = db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)');
  addUser.run(1, 'creator', 'user');
  addUser.run(2, 'buyer', 'user');
  addUser.run(3, 'stranger', 'user');
  addUser.run(4, 'admin', 'admin');
  addUser.run(5, 'editor', 'editor');
  addUser.run(6, 'claimed', 'user');
  addUser.run(7, 'partial', 'user');
  addUser.run(8, 'allch', 'user');
  addUser.run(9, 'draftbuyer', 'user');

  const addComic = db.prepare(`
    INSERT INTO comics (id, user_id, title, status, price_cents, reviewed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  addComic.run(1, 1, 'Paid Trail', 'published', 250, 6);
  addComic.run(2, 1, 'Open Meadow', 'published', 0, null);
  addComic.run(3, 1, 'Hidden Draft', 'draft', 0, null);
  addComic.run(4, 1, 'Chapter Story', 'published', 500, null);

  const addPage = db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  addPage.run(10, 1, 'Trailhead', '/uploads/comics/1/start.png', 'START_TEXT', 1);
  addPage.run(11, 1, 'Left fork', '/uploads/comics/1/left.png', 'LEFT_TEXT', 0);
  addPage.run(12, 1, 'Right fork', '/uploads/comics/1/right.png', RIGHT, 0);
  addPage.run(13, 1, 'Deep woods', '/uploads/comics/1/deep.png', DEEP, 0);
  addPage.run(20, 2, 'Gate', '', 'FREE_START', 1);
  addPage.run(21, 2, 'Meadow', '', 'FREE_NEXT', 0);
  addPage.run(22, 2, 'Far ridge', '', FREE_FAR, 0);
  addPage.run(30, 3, 'Draft start', '/uploads/comics/3/draft.png', DRAFT, 1);
  addPage.run(31, 3, 'Draft later', '', 'DRAFT_LATER', 0);
  addPage.run(40, 4, 'Ch start', '', 'CH_START', 1);
  addPage.run(41, 4, 'Ch next', '', 'CH_NEXT', 0);
  addPage.run(42, 4, 'Ch deep', '', 'CH_DEEP', 0);

  const addChoice = db.prepare(`
    INSERT INTO choices (id, from_page_id, choice_text, to_page_id, choice_image)
    VALUES (?, ?, ?, ?, ?)
  `);
  addChoice.run(1, 10, 'Walk left', 11, null);
  addChoice.run(2, 10, 'Walk right', 12, null);
  addChoice.run(3, 11, 'Go deeper', 13, THUMB);
  addChoice.run(4, 20, 'Step in', 21, null);
  addChoice.run(5, 21, 'Climb', 22, null);
  addChoice.run(6, 30, 'Draft choice', 31, null);
  addChoice.run(7, 40, 'Chapter next', 41, null);
  addChoice.run(8, 41, 'Chapter deep', 42, null);

  db.prepare('INSERT INTO purchases (user_id, comic_id) VALUES (?, ?)').run(2, 1);
  db.prepare('INSERT INTO purchases (user_id, comic_id) VALUES (?, ?)').run(9, 3);
  db.prepare('INSERT INTO chapters (id, comic_id, price_cents) VALUES (?, ?, ?)').run(100, 4, 100);
  db.prepare('INSERT INTO chapters (id, comic_id, price_cents) VALUES (?, ?, ?)').run(101, 4, 100);
  db.prepare('INSERT INTO chapter_unlocks (user_id, comic_id, chapter_id) VALUES (?, ?, ?)').run(7, 4, 100);
  db.prepare('INSERT INTO chapter_unlocks (user_id, comic_id, chapter_id) VALUES (?, ?, ?)').run(8, 4, 100);
  db.prepare('INSERT INTO chapter_unlocks (user_id, comic_id, chapter_id) VALUES (?, ?, ?)').run(8, 4, 101);
  return db;
}

const USERS = {
  1: { id: 1, role: 'user' },
  2: { id: 2, role: 'user' },
  3: { id: 3, role: 'user' },
  4: { id: 4, role: 'admin' },
  5: { id: 5, role: 'editor' },
  6: { id: 6, role: 'user' },
  7: { id: 7, role: 'user' },
  8: { id: 8, role: 'user' },
  9: { id: 9, role: 'user' },
};

function buildApp(db) {
  const app = express();
  app.use((req, res, next) => {
    const raw = req.headers['x-test-user'];
    req.testUser = raw ? USERS[String(raw)] || null : null;
    next();
  });
  const ctx = (req) => ({ db, user: req.testUser });
  app.get('/api/comics/:id/pages', (req, res) => readAccess.handleComicPages(req, res, ctx(req)));
  app.get('/api/comics/:id/start', (req, res) => readAccess.handleStartPage(req, res, ctx(req)));
  app.get('/api/pages/:id', (req, res) => readAccess.handlePageById(req, res, ctx(req)));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, urlPath, userId) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const headers = {};
    if (userId != null) headers['x-test-user'] = String(userId);
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
          cache: res.headers['cache-control'] || '',
          body,
          json,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function pageIds(payload) {
  return (payload.pages || []).map((page) => page.id).sort((a, b) => a - b);
}

function textsOf(payload) {
  return (payload.pages || []).map((page) => page.text_content).join('\n');
}

function assertSampleOnly(payload, label) {
  assert.deepStrictEqual(pageIds(payload), [10, 11, 12], label + ' page ids');
  const blob = JSON.stringify(payload);
  assert.ok(blob.includes('START_TEXT'), label + ' start');
  assert.ok(blob.includes('LEFT_TEXT'), label + ' left');
  assert.ok(blob.includes(RIGHT), label + ' right branch is one hop');
  assert.ok(!blob.includes(DEEP), label + ' deep text leaked');
  assert.ok(!blob.includes(THUMB), label + ' deep choice image leaked');
  assert.ok(!blob.includes('/uploads/comics/1/deep.png'), label + ' deep image leaked');
  const left = payload.pages.find((page) => page.id === 11);
  assert.strictEqual(left.choices.length, 1, label + ' left choices');
  assert.strictEqual(left.choices[0].locked, true);
  assert.strictEqual(left.choices[0].text, 'Go deeper');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(left.choices[0], 'to_page_id'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(left.choices[0], 'image'), false);
  const start = payload.pages.find((page) => page.id === 10);
  const targets = start.choices.map((choice) => choice.to_page_id).sort((a, b) => a - b);
  assert.deepStrictEqual(targets, [11, 12], label + ' start targets');
  start.choices.forEach((choice) => {
    assert.ok(!choice.locked, label + ' start choice should stay open');
  });
}

async function main() {
  const pages = [
    { id: 3, is_start: 0 },
    { id: 8, is_start: 1 },
    { id: 4, is_start: 1 },
  ];
  assert.strictEqual(readAccess.findStartPage(pages).id, 4);
  assert.strictEqual(readAccess.findStartPage([{ id: 9, is_start: 0 }]).id, 9);

  const db = buildDb();
  const loaded = readAccess.loadPagesAndChoices(db, 1);
  const sampleIds = Array.from(readAccess.samplePageIdSet(loaded.pages, loaded.choices)).sort((a, b) => a - b);
  assert.deepStrictEqual(sampleIds, [10, 11, 12]);

  const teaser = publicPages.selectSamplePages(loaded.pages, loaded.choices);
  assert.deepStrictEqual(teaser.map((page) => page.id), [10, 11]);
  assert.ok(!JSON.stringify(teaser).includes(RIGHT));
  assert.ok(!JSON.stringify(teaser).includes(DEEP));

  const anonFlags = readAccess.loadPurchaseFlags(db, null, 1);
  assert.strictEqual(readAccess.canReadFull(null, { id: 1, user_id: 1, status: 'published', price_cents: 250 }, anonFlags), false);
  assert.strictEqual(readAccess.canReadFull(null, { id: 2, user_id: 1, status: 'published', price_cents: 0 }, anonFlags), true);
  assert.strictEqual(readAccess.canReadFull(null, { id: 3, user_id: 1, status: 'draft', price_cents: 0 }, anonFlags), false);
  assert.strictEqual(readAccess.canReadFull(USERS[2], { id: 1, user_id: 1, status: 'published', price_cents: 250 }, readAccess.loadPurchaseFlags(db, 2, 1)), true);
  assert.strictEqual(readAccess.canReadFull(USERS[7], { id: 4, user_id: 1, status: 'published', price_cents: 500 }, readAccess.loadPurchaseFlags(db, 7, 4)), false);
  assert.strictEqual(readAccess.canReadFull(USERS[8], { id: 4, user_id: 1, status: 'published', price_cents: 500 }, readAccess.loadPurchaseFlags(db, 8, 4)), true);

  const server = await listen(buildApp(db));
  try {
    const anon = await request(server, '/api/comics/1/pages');
    assert.strictEqual(anon.status, 200);
    assert.ok(anon.type.includes('application/json'));
    assert.ok(anon.cache.includes('no-store'));
    assertSampleOnly(anon.json, 'anonymous');

    const stranger = await request(server, '/api/comics/1/pages', 3);
    assert.strictEqual(stranger.status, 200);
    assertSampleOnly(stranger.json, 'non-buyer');

    const deepPage = await request(server, '/api/pages/13');
    assert.strictEqual(deepPage.status, 403);
    assert.ok(deepPage.type.includes('application/json'));
    assert.ok(deepPage.json && deepPage.json.error);
    assert.ok(!deepPage.body.includes(DEEP));

    const strangerDeep = await request(server, '/api/pages/13', 3);
    assert.strictEqual(strangerDeep.status, 403);
    assert.ok(!strangerDeep.body.includes(DEEP));

    const samplePage = await request(server, '/api/pages/12');
    assert.strictEqual(samplePage.status, 200);
    assert.strictEqual(samplePage.json.text_content, RIGHT);

    const missing = await request(server, '/api/pages/999');
    assert.strictEqual(missing.status, 404);

    for (const userId of [2, 1, 4]) {
      const full = await request(server, '/api/comics/1/pages', userId);
      assert.strictEqual(full.status, 200, 'user ' + userId);
      assert.deepStrictEqual(pageIds(full.json), [10, 11, 12, 13], 'user ' + userId);
      assert.ok(textsOf(full.json).includes(DEEP), 'user ' + userId);
      const deep = await request(server, '/api/pages/13', userId);
      assert.strictEqual(deep.status, 200, 'page user ' + userId);
      assert.strictEqual(deep.json.text_content, DEEP);
      assert.strictEqual(deep.json.choices.length >= 0, true);
    }

    const editor = await request(server, '/api/comics/1/pages', 5);
    assert.deepStrictEqual(pageIds(editor.json), [10, 11, 12, 13]);
    const claimed = await request(server, '/api/pages/13', 6);
    assert.strictEqual(claimed.status, 200);
    assert.strictEqual(claimed.json.text_content, DEEP);

    const free = await request(server, '/api/comics/2/pages');
    assert.strictEqual(free.status, 200);
    assert.deepStrictEqual(pageIds(free.json), [20, 21, 22]);
    assert.ok(textsOf(free.json).includes(FREE_FAR));
    const far = await request(server, '/api/pages/22');
    assert.strictEqual(far.status, 200);
    assert.strictEqual(far.json.text_content, FREE_FAR);
    const farChoice = free.json.pages.find((page) => page.id === 21).choices[0];
    assert.strictEqual(farChoice.to_page_id, 22);
    assert.ok(!farChoice.locked);

    const draftAnon = await request(server, '/api/comics/3/pages');
    assert.strictEqual(draftAnon.status, 403);
    assert.ok(!draftAnon.body.includes(DRAFT));
    const draftStranger = await request(server, '/api/comics/3/pages', 3);
    assert.strictEqual(draftStranger.status, 403);
    const draftPage = await request(server, '/api/pages/30', 3);
    assert.strictEqual(draftPage.status, 403);
    assert.ok(!draftPage.body.includes(DRAFT));
    const draftCreator = await request(server, '/api/comics/3/pages', 1);
    assert.strictEqual(draftCreator.status, 200);
    assert.ok(textsOf(draftCreator.json).includes(DRAFT));
    const draftAdmin = await request(server, '/api/pages/30', 4);
    assert.strictEqual(draftAdmin.status, 200);
    assert.strictEqual(draftAdmin.json.text_content, DRAFT);
    const draftBuyer = await request(server, '/api/comics/3/pages', 9);
    assert.strictEqual(draftBuyer.status, 200);
    assert.ok(textsOf(draftBuyer.json).includes(DRAFT));

    const partial = await request(server, '/api/comics/4/pages', 7);
    assert.deepStrictEqual(pageIds(partial.json), [40, 41]);
    assert.ok(!textsOf(partial.json).includes('CH_DEEP'));
    const partialDeep = await request(server, '/api/pages/42', 7);
    assert.strictEqual(partialDeep.status, 403);
    const allCh = await request(server, '/api/comics/4/pages', 8);
    assert.deepStrictEqual(pageIds(allCh.json), [40, 41, 42]);

    const start = await request(server, '/api/comics/1/start');
    assert.strictEqual(start.status, 200);
    assert.strictEqual(start.json.id, 10);
    assert.ok(!start.body.includes(DEEP));
    const startTargets = start.json.choices.map((choice) => choice.to_page_id).sort((a, b) => a - b);
    assert.deepStrictEqual(startTargets, [11, 12]);
    const draftStart = await request(server, '/api/comics/3/start', 3);
    assert.strictEqual(draftStart.status, 403);

    const gone = await request(server, '/api/comics/99/pages');
    assert.strictEqual(gone.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes('readAccess.handleComicPages'));
  assert.ok(serverSrc.includes('readAccess.handlePageById'));
  assert.ok(serverSrc.includes('readAccess.handleStartPage'));
  assert.ok(serverSrc.includes('offlineDownload.renderOfflineDownload'));
  const pendingAt = serverSrc.indexOf("app.get('/api/admin/pending-stories'");
  const pendingSlice = serverSrc.slice(pendingAt, pendingAt + 700);
  assert.ok(!pendingSlice.includes('text_content'), 'review queue must not select page text');
  const searchAt = serverSrc.indexOf("app.get('/api/comics',");
  const searchSlice = serverSrc.slice(searchAt, searchAt + 1200);
  assert.ok(!searchSlice.includes('text_content'), 'search must not select page text');

  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.ok(appSrc.includes('const FREE_CHOICES = 1'));
  assert.ok(appSrc.includes('Sample Ended'));
  assert.ok(appSrc.includes('function showSampleEndedPaywall'));
  assert.ok(appSrc.includes('function refetchOpenReaderPages'));
  assert.ok(appSrc.includes('if (!pagesRes.ok)'));
  assert.ok(appSrc.includes('if (!r.ok)'));
  assert.ok(appSrc.includes('refetchOpenReaderPages(comicId)'));

  console.log('ALL PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
