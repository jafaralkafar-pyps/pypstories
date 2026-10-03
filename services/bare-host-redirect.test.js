/**
 * Run: node services/bare-host-redirect.test.js
 * Does not load server.js.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { bareHostRedirect } = require('./bare-host-redirect');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(bareHostRedirect);
  app.use((req, res) => {
    res.status(200).type('text/plain').send(req.method + ' ' + req.originalUrl);
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, options) {
  const method = options.method || 'GET';
  const urlPath = options.path || '/';
  const headers = options.headers || {};
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: urlPath,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          location: res.headers.location || '',
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end(options.body || '');
  });
}

async function testRedirects() {
  const app = buildApp();
  const server = await listen(app);
  try {
    const bare = await request(server, {
      path: '/browse?tab=new&q=a%20b',
      headers: { host: 'pypstories.com' },
    });
    assert.strictEqual(bare.status, 301);
    assert.strictEqual(bare.location, 'https://www.pypstories.com/browse?tab=new&q=a%20b');

    const cased = await request(server, {
      path: '/stories/9',
      headers: { host: 'PYPSTORIES.COM:443' },
    });
    assert.strictEqual(cased.status, 301);
    assert.strictEqual(cased.location, 'https://www.pypstories.com/stories/9');

    const head = await request(server, {
      method: 'HEAD',
      path: '/?ref=home',
      headers: { host: 'pypstories.com' },
    });
    assert.strictEqual(head.status, 301);
    assert.strictEqual(head.location, 'https://www.pypstories.com/?ref=home');

    const www = await request(server, {
      path: '/browse?tab=new',
      headers: { host: 'www.pypstories.com' },
    });
    assert.strictEqual(www.status, 200);
    assert.strictEqual(www.location, '');
    assert.strictEqual(www.body, 'GET /browse?tab=new');

    const local = await request(server, {
      path: '/',
      headers: { host: 'localhost:3000' },
    });
    assert.strictEqual(local.status, 200);
    assert.strictEqual(local.location, '');

    const loopback = await request(server, {
      path: '/',
      headers: { host: '127.0.0.1:3977' },
    });
    assert.strictEqual(loopback.status, 200);
    assert.strictEqual(loopback.location, '');

    const other = await request(server, {
      path: '/',
      headers: { host: 'example.com' },
    });
    assert.strictEqual(other.status, 200);

    const forwarded = await request(server, {
      path: '/library?page=2',
      headers: { host: '127.0.0.1', 'x-forwarded-host': 'pypstories.com' },
    });
    assert.strictEqual(forwarded.status, 301);
    assert.strictEqual(forwarded.location, 'https://www.pypstories.com/library?page=2');

    const webhook = await request(server, {
      method: 'POST',
      path: '/api/webhook',
      headers: { host: 'pypstories.com', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.strictEqual(webhook.status, 200);
    assert.strictEqual(webhook.location, '');
    assert.strictEqual(webhook.body, 'POST /api/webhook');

    const webhookGet = await request(server, {
      path: '/api/webhook?probe=1',
      headers: { host: 'pypstories.com' },
    });
    assert.strictEqual(webhookGet.status, 200);
    assert.strictEqual(webhookGet.location, '');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
  console.log('PASS bare host redirects to www and leaves local and webhook requests alone');
}

function testWiredBeforeSessions() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const trustAt = src.indexOf("app.set('trust proxy', 1)");
  const redirectAt = src.indexOf('app.use(bareHostRedirect)');
  const sessionAt = src.indexOf('app.use(session(');
  assert.ok(trustAt >= 0 && redirectAt > trustAt && sessionAt > redirectAt);
  console.log('PASS bare-host redirect is registered before sessions');
}

async function main() {
  await testRedirects();
  testWiredBeforeSessions();
  console.log('ALL PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
