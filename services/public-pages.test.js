/**
 * Run: node services/public-pages.test.js
 * Does not load server.js or open data/cyoa.db.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const publicPages = require('./public-pages');

const publicDir = path.join(__dirname, '..', 'public');
const indexPath = path.join(publicDir, 'index.html');
const ADSENSE = '<meta name="google-adsense-account" content="ca-pub-9811413201474824">';
const FOOTER_LINKS = [
  ['href="/"', '>Home<'],
  ['href="/how-it-works.html"', '>How It Works<'],
  ['href="/privacy.html"', '>Privacy<'],
  ['href="/terms.html"', '>Terms<'],
  ['href="/content-policy.html"', '>Content Policy<'],
  ['href="/contact.html"', '>Contact<'],
];

function assertFooter(body, label) {
  FOOTER_LINKS.forEach((pair) => {
    assert.ok(body.includes(pair[0]), label + ' missing ' + pair[0]);
    assert.ok(body.includes(pair[1]), label + ' missing ' + pair[1]);
  });
}

function assertNoTrademark(body, label) {
  assert.ok(!/choose your own adventure/i.test(body), label + ' uses trademark wording');
  assert.ok(!body.includes('CYOA'), label + ' uses CYOA');
}

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT
    );
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
      title TEXT,
      image_path TEXT,
      text_content TEXT,
      is_start INTEGER
    );
    CREATE TABLE choices (
      id INTEGER PRIMARY KEY,
      from_page_id INTEGER,
      choice_text TEXT,
      to_page_id INTEGER
    );
  `);
  db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(1, 'ada');
  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, genre, cover_image, status, submitted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1, 1, "Reader's Forest",
    'A branching walk where the path you pick changes the ending.',
    'Fantasy', '/uploads/comics/forest.png', 'published',
    '2026-10-01 12:00:00', '2026-09-01 12:00:00'
  );
  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, genre, cover_image, status, submitted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    2, 1, 'Hidden Draft',
    'This unpublished draft must not appear.',
    'Mystery', '/uploads/comics/hidden.png', 'draft',
    '2026-10-02 12:00:00', '2026-09-02 12:00:00'
  );
  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, genre, cover_image, status, submitted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    3, 1, 'Page Cover',
    'Cover comes from the first page.',
    'Adventure', '', 'published',
    '2026-08-01 12:00:00', '2026-08-01 12:00:00'
  );
  db.prepare('INSERT INTO pages (id, comic_id, image_path, is_start) VALUES (?, ?, ?, ?)')
    .run(9, 3, '/uploads/comics/page-cover.png', 1);

  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, genre, cover_image, status, submitted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    4, 1, 'Paid Trail',
    'A paid branching story about a trail.',
    'Fantasy', '/uploads/comics/4/cover-paid.png', 'published',
    '2026-10-03 12:00:00', '2026-09-03 12:00:00'
  );
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(10, 4, 'Trailhead', '/uploads/comics/4/start.png', 'Moss & <script>alert(1)</script>\nYou stand at the trailhead.', 1);
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(11, 4, 'Left fork', '/uploads/comics/4/left.png', 'The left fork is mossy and quiet.', 0);
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(12, 4, 'Right fork', '/uploads/comics/4/right-secret.png', 'RIGHT_SECRET_TEXT should not appear', 0);
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(13, 4, 'Deep woods', '/uploads/comics/4/deep-secret.png', 'DEEP_SECRET_TEXT should not appear', 0);
  db.prepare('INSERT INTO choices (id, from_page_id, choice_text, to_page_id) VALUES (?, ?, ?, ?)')
    .run(1, 10, 'Walk the left fork', 11);
  db.prepare('INSERT INTO choices (id, from_page_id, choice_text, to_page_id) VALUES (?, ?, ?, ?)')
    .run(2, 10, 'Walk the <right> fork', 12);
  db.prepare('INSERT INTO choices (id, from_page_id, choice_text, to_page_id) VALUES (?, ?, ?, ?)')
    .run(3, 11, 'Continue into the deep woods', 13);

  db.prepare(`
    INSERT INTO comics (id, user_id, title, description, genre, cover_image, status, submitted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    5, 1, 'Open Meadow',
    'A free branching story.',
    'Adventure', '', 'published',
    '2026-10-04 12:00:00', '2026-09-04 12:00:00'
  );
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(20, 5, 'Gate', '', 'FREE_START_TEXT', 1);
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(21, 5, 'Meadow', '', 'FREE_NEXT_TEXT', 0);
  db.prepare(`
    INSERT INTO pages (id, comic_id, title, image_path, text_content, is_start)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(22, 5, 'Far ridge', '', 'FREE_SECRET_TEXT', 0);
  db.prepare('INSERT INTO choices (id, from_page_id, choice_text, to_page_id) VALUES (?, ?, ?, ?)')
    .run(4, 20, 'Step into the meadow', 21);
  db.prepare('INSERT INTO choices (id, from_page_id, choice_text, to_page_id) VALUES (?, ?, ?, ?)')
    .run(5, 21, 'Climb the far ridge', 22);
  return db;
}

function buildApp(db) {
  const app = express();
  publicPages.mountEarlyRoutes(app, { db, indexPath });
  app.use(express.static(publicDir));
  app.use((req, res) => publicPages.handleFallback(req, res, { db, publicDir, indexPath }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
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
          location: res.headers.location || '',
          type: res.headers['content-type'] || '',
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function assertAds(body, label) {
  assert.ok(body.includes(ADSENSE), label + ' missing AdSense meta');
}

async function main() {
  assert.strictEqual(publicPages.storySlug("Reader's Forest"), 'readers-forest');
  assert.strictEqual(publicPages.storySlug('Reader’s Forest'), 'readers-forest');
  assert.strictEqual(publicPages.storySlug('!!!'), 'story');
  assert.strictEqual(publicPages.CANONICAL_ORIGIN, 'https://www.pypstories.com');

  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const trustAt = serverSrc.indexOf("app.set('trust proxy', 1)");
  const redirectAt = serverSrc.indexOf('app.use(bareHostRedirect)');
  const sessionAt = serverSrc.indexOf('app.use(session(');
  const mountAt = serverSrc.indexOf('publicPages.mountEarlyRoutes');
  const staticAt = serverSrc.indexOf('app.use(express.static');
  const fallbackAt = serverSrc.indexOf('publicPages.handleFallback');
  assert.ok(trustAt >= 0 && redirectAt > trustAt && sessionAt > redirectAt);
  assert.ok(mountAt > sessionAt && staticAt > mountAt && fallbackAt > staticAt);
  assert.ok(!serverSrc.includes("res.sendFile(path.join(__dirname, 'public', 'index.html'))"));
  assert.ok(!fs.existsSync(path.join(publicDir, 'sitemap.xml')), 'static sitemap would shadow the dynamic one');

  const db = buildDb();
  const server = await listen(buildApp(db));
  try {
    const missing = await request(server, '/nonexistent-xyz');
    assert.strictEqual(missing.status, 404);
    assert.ok(missing.body.includes('Page not found'));
    assert.ok(!missing.body.includes('id="comics-grid"'));
    assert.ok(missing.body.includes('noindex'));
    assertAds(missing.body, '404');
    assertFooter(missing.body, '404');
    assertNoTrademark(missing.body, '404');

    const home = await request(server, '/');
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('href="/story/1/readers-forest"'));
    assert.ok(home.body.includes('href="/story/3/page-cover"'));
    assert.ok(home.body.includes('alt="Reader&#39;s Forest"') || home.body.includes('alt="Reader&amp;#39;s Forest"') || home.body.includes('alt="Reader\'s Forest"'));
    assert.ok(!home.body.includes('Hidden Draft'));
    assert.ok(!home.body.includes('id="auth-modal"'));
    assert.ok(!home.body.includes('id="view-account"'));
    assert.ok(!home.body.includes('id="credits-modal"'));
    assert.ok(!home.body.includes('id="login-form"'));
    assert.ok(home.body.includes('rel="canonical" href="https://www.pypstories.com/"'));
    assertAds(home.body, 'home');
    assertFooter(home.body, 'home');
    assertNoTrademark(home.body, 'home');

    const browse = await request(server, '/browse');
    assert.strictEqual(browse.status, 200);
    assert.ok(browse.body.includes('id="comics-grid"'));

    const reset = await request(server, '/reset-password?token=abc');
    assert.strictEqual(reset.status, 200);
    assert.ok(reset.body.includes('id="comics-grid"'));

    const privacy = await request(server, '/privacy.html');
    assert.strictEqual(privacy.status, 200);
    assert.ok(privacy.body.includes('https://www.pypstories.com/privacy.html'));
    assert.ok(privacy.body.includes('https://adssettings.google.com'));
    assert.ok(privacy.body.includes('https://www.aboutads.info'));
    assert.ok(privacy.body.includes('Stripe'));
    assert.ok(/cookies to serve ads based on/i.test(privacy.body));
    assertAds(privacy.body, 'privacy');
    assertFooter(privacy.body, 'privacy');
    assertNoTrademark(privacy.body, 'privacy');

    const contact = await request(server, '/contact.html');
    assert.strictEqual(contact.status, 200);
    assert.ok(contact.body.includes('We read every message. If you have a PYPStories account, we\'ll reply with an in-site notice. Log in first so we can match your message to your account.'));
    assert.ok(!contact.body.includes('contact@'));
    assert.ok(!/mailto:/i.test(contact.body));
    assert.ok(contact.body.includes('/api/contact'));
    assert.ok(contact.body.includes('id="contact-form"'));
    assertAds(contact.body, 'contact');
    assertFooter(contact.body, 'contact');

    const how = await request(server, '/how-it-works.html');
    assert.strictEqual(how.status, 200);
    assert.ok(how.body.includes('id="about"'));
    assert.ok(how.body.includes('About PYPStories'));
    assert.ok(how.body.includes('branching stories'));
    assert.ok(/sell their own stories/i.test(how.body));
    assertAds(how.body, 'how');
    assertFooter(how.body, 'how');
    assertNoTrademark(how.body, 'how');

    const terms = await request(server, '/terms.html');
    assert.strictEqual(terms.status, 200);
    assertAds(terms.body, 'terms');
    assertFooter(terms.body, 'terms');
    assert.ok(terms.body.includes('href="/contact.html"'));
    assert.ok(!terms.body.includes('https://pypstories.com/'));

    const policy = await request(server, '/content-policy.html');
    assert.strictEqual(policy.status, 200);
    assertAds(policy.body, 'policy');
    assertFooter(policy.body, 'policy');

    const about = await request(server, '/about');
    assert.strictEqual(about.status, 301);
    assert.ok(about.location.endsWith('/how-it-works.html#about'), about.location);

    const indexRedirect = await request(server, '/index.html');
    assert.strictEqual(indexRedirect.status, 301);
    assert.ok(indexRedirect.location.endsWith('/'), indexRedirect.location);

    const story = await request(server, '/story/1/readers-forest');
    assert.strictEqual(story.status, 200);
    assert.ok(story.body.includes("Reader's Forest") || story.body.includes('Reader&#39;s Forest'));
    assert.ok(story.body.includes('by ada'));
    assert.ok(story.body.includes('Fantasy'));
    assert.ok(story.body.includes('A branching walk'));
    assert.ok(story.body.includes('alt="Reader&#39;s Forest"') || story.body.includes("alt=\"Reader's Forest\""));
    assert.ok(story.body.includes('src="/uploads/comics/forest.png"'));
    assert.ok(story.body.includes('href="/?comic=1&amp;start=1"'));
    assert.ok(story.body.includes('Start reading'));
    assert.ok(story.body.includes('https://www.pypstories.com/story/1/readers-forest'));
    assert.ok(story.body.includes('content="A branching walk where the path you pick changes the ending."'));
    assertAds(story.body, 'story');
    assertFooter(story.body, 'story');
    assertNoTrademark(story.body, 'story');

    const wrongSlug = await request(server, '/story/1/wrong');
    assert.strictEqual(wrongSlug.status, 301);
    assert.ok(wrongSlug.location.endsWith('/story/1/readers-forest'), wrongSlug.location);

    const bareStory = await request(server, '/story/1');
    assert.strictEqual(bareStory.status, 301);
    assert.ok(bareStory.location.endsWith('/story/1/readers-forest'), bareStory.location);

    const unpublished = await request(server, '/story/2/hidden-draft');
    assert.strictEqual(unpublished.status, 404);
    assert.ok(!unpublished.body.includes('Hidden Draft'));
    assert.ok(unpublished.body.includes('Page not found'));

    const absent = await request(server, '/story/99/missing');
    assert.strictEqual(absent.status, 404);

    const paid = await request(server, '/story/4/paid-trail');
    assert.strictEqual(paid.status, 200);
    assert.ok(paid.body.includes('content="A paid branching story about a trail."'));
    assert.ok(paid.body.includes('ca-pub-9811413201474824'));
    assert.ok(paid.body.includes('https://www.pypstories.com/story/4/paid-trail'));
    assert.ok(paid.body.includes('You stand at the trailhead.'));
    assert.ok(paid.body.includes('The left fork is mossy and quiet.'));
    assert.ok(paid.body.includes('Moss &amp; &lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!paid.body.includes('<script>alert(1)</script>'));
    assert.ok(!paid.body.includes('RIGHT_SECRET_TEXT'));
    assert.ok(!paid.body.includes('DEEP_SECRET_TEXT'));
    assert.ok(!paid.body.includes('/uploads/comics/4/right-secret.png'));
    assert.ok(!paid.body.includes('/uploads/comics/4/deep-secret.png'));
    assert.ok(!paid.body.includes('Right fork'));
    assert.ok(!paid.body.includes('Deep woods'));
    assert.ok(paid.body.includes('class="teaser-image"'));
    assert.ok(paid.body.includes('alt="Paid Trail — Trailhead"'));
    assert.ok(paid.body.includes('alt="Paid Trail — Left fork"'));
    assert.ok(paid.body.includes('content: "PYPStories.com"'));
    assert.ok(paid.body.includes('<li>Walk the left fork</li>'));
    assert.ok(paid.body.includes('<li>Walk the &lt;right&gt; fork</li>'));
    assert.ok(paid.body.includes('<li>Continue into the deep woods</li>'));
    const choiceLists = paid.body.match(/<ul class="teaser-choices">[\s\S]*?<\/ul>/g) || [];
    assert.ok(choiceLists.length >= 1);
    choiceLists.forEach((list) => assert.ok(!/<a\b/i.test(list), list));
    assert.ok(!paid.body.includes('/api/'));
    assert.ok(paid.body.includes('href="/?comic=4&amp;start=1"'));
    assert.ok(paid.body.includes('>Start reading</a>'));
    assert.ok(paid.body.includes('>Keep reading in the app</a>'));
    assert.ok(paid.body.includes('branching story'));
    assert.ok(!/choose your own adventure/i.test(paid.body));
    assert.ok(!paid.body.includes('CYOA'));

    const freeStory = await request(server, '/story/5/open-meadow');
    assert.strictEqual(freeStory.status, 200);
    assert.ok(freeStory.body.includes('FREE_START_TEXT'));
    assert.ok(freeStory.body.includes('FREE_NEXT_TEXT'));
    assert.ok(!freeStory.body.includes('FREE_SECRET_TEXT'));
    assert.ok(!freeStory.body.includes('Far ridge'));

    const pageCover = await request(server, '/story/3/page-cover');
    assert.strictEqual(pageCover.status, 200);
    assert.ok(pageCover.body.includes('src="/uploads/comics/page-cover.png"'));
    assert.ok(pageCover.body.includes('alt="Page Cover"'));

    const sitemap = await request(server, '/sitemap.xml');
    assert.strictEqual(sitemap.status, 200);
    assert.ok(sitemap.type.includes('xml'));
    assert.ok(sitemap.body.includes('https://www.pypstories.com/story/1/readers-forest'));
    assert.ok(sitemap.body.includes('https://www.pypstories.com/story/3/page-cover'));
    assert.ok(sitemap.body.includes('https://www.pypstories.com/privacy.html'));
    assert.ok(sitemap.body.includes('https://www.pypstories.com/contact.html'));
    assert.ok(!sitemap.body.includes('hidden-draft'));
    assert.ok(!sitemap.body.includes('https://pypstories.com/'));

    const robots = await request(server, '/robots.txt');
    assert.strictEqual(robots.status, 200);
    assert.ok(robots.body.includes('Allow: /uploads/comics/'));
    assert.ok(robots.body.includes('Disallow: /api/'));
    assert.ok(robots.body.includes('Sitemap: https://www.pypstories.com/sitemap.xml'));

    const api = await request(server, '/api/nope');
    assert.strictEqual(api.status, 404);
    assert.ok(api.body.includes('Not found'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  console.log('PASS public pages');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
