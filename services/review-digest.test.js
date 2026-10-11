/**
 * Daily review digest. Run: node services/review-digest.test.js
 */

const assert = require('assert');
const Database = require('better-sqlite3');
const digest = require('./review-digest');

function baseDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'user'
    );
    CREATE TABLE comics (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      submitted_at TEXT,
      created_at TEXT
    );
  `);
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (1, 'Ada', 'ada@example.com', 'admin')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (2, 'Bea', 'bea@example.com', 'admin')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (3, 'Ed', 'ed@example.com', 'editor')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (4, 'Pat', 'pat@example.com', 'user')`).run();
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (5, 'Cy', 'cy@example.com', 'admin')`).run();
  return db;
}

function addComic(db, fields) {
  db.prepare(`
    INSERT INTO comics (id, user_id, title, status, submitted_at, created_at)
    VALUES (@id, @user_id, @title, @status, @submitted_at, @created_at)
  `).run({
    id: fields.id,
    user_id: fields.user_id,
    title: fields.title,
    status: fields.status,
    submitted_at: fields.submitted_at || null,
    created_at: fields.created_at || '2026-10-01 12:00:00',
  });
}

function recorder() {
  const calls = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
    },
  };
}

const nineAm = new Date('2026-10-02T14:00:00.000Z');

async function testEmptyQueueSendsNothing() {
  const db = baseDb();
  addComic(db, { id: 1, user_id: 4, title: 'Draft only', status: 'draft' });
  const mail = recorder();
  const result = await digest.runReviewDigest({ db, send: mail.send, now: nineAm, hour: 9 });
  assert.strictEqual(result.status, 'skipped');
  assert.strictEqual(result.reason, 'empty');
  assert.strictEqual(mail.calls.length, 0);
  const sends = db.prepare('SELECT COUNT(*) AS n FROM review_digest_sends').get().n;
  assert.strictEqual(sends, 0);
}

async function testOnePendingEmailsEachAdmin() {
  const db = baseDb();
  db.prepare(`UPDATE users SET email = '   ' WHERE id = 5`).run();
  addComic(db, {
    id: 7,
    user_id: 4,
    title: 'The Long Road',
    status: 'submitted',
    submitted_at: '2026-10-02 14:30:00',
  });
  addComic(db, {
    id: 8,
    user_id: 3,
    title: 'Already live',
    status: 'published',
    submitted_at: '2026-10-02 15:00:00',
  });
  const mail = recorder();
  const result = await digest.runReviewDigest({ db, send: mail.send, now: nineAm, hour: 9 });
  assert.strictEqual(result.status, 'sent');
  assert.strictEqual(result.recipientCount, 2);
  assert.strictEqual(result.comicCount, 1);
  assert.strictEqual(mail.calls.length, 2);
  const recipients = mail.calls.map((message) => message.to).sort();
  assert.deepStrictEqual(recipients, ['ada@example.com', 'bea@example.com']);
  mail.calls.forEach((message) => {
    assert.strictEqual(message.subject, 'PYPStories: 1 story waiting for review');
    assert.ok(message.text.includes('The Long Road'));
    assert.ok(message.text.includes('Author: Pat'));
    assert.ok(message.text.includes('https://www.pypstories.com'));
    assert.ok(!message.text.includes('Already live'));
    assert.ok(!message.text.includes('ed@example.com'));
    assert.ok(!message.html);
  });
  assert.ok(mail.calls[0].text.includes('CT'));
  const sent = db.prepare('SELECT user_id FROM review_digest_sends ORDER BY user_id').all();
  assert.deepStrictEqual(sent.map((row) => row.user_id), [1, 2]);
}

async function testRecentAndOverlappingRunsAreSkipped() {
  const db = baseDb();
  addComic(db, {
    id: 3,
    user_id: 4,
    title: 'Waiting',
    status: 'in_review',
    submitted_at: '2026-10-02 13:00:00',
  });
  const mail = recorder();
  const first = await digest.runReviewDigest({ db, send: mail.send, now: nineAm, hour: 9 });
  assert.strictEqual(first.status, 'sent');
  assert.strictEqual(mail.calls.length, 3);

  const again = await digest.runReviewDigest({
    db,
    send: mail.send,
    now: new Date('2026-10-02T14:05:00.000Z'),
    hour: 9,
  });
  assert.strictEqual(again.status, 'skipped');
  assert.strictEqual(again.reason, 'recent');
  assert.strictEqual(mail.calls.length, 3);

  db.prepare('UPDATE review_digest_runs SET last_finished_at = NULL WHERE id = 1').run();
  db.prepare(`UPDATE review_digest_runs SET last_started_at = ? WHERE id = 1`).run(nineAm.toISOString());
  const overlap = await digest.runReviewDigest({
    db,
    send: mail.send,
    now: new Date('2026-10-02T14:10:00.000Z'),
    hour: 9,
  });
  assert.strictEqual(overlap.status, 'skipped');
  assert.strictEqual(overlap.reason, 'in-progress');
  assert.strictEqual(mail.calls.length, 3);
}

async function testFailedSendRetriesWithoutRepeatingAdmins() {
  const db = baseDb();
  addComic(db, {
    id: 9,
    user_id: 4,
    title: 'Needs a look',
    status: 'quarantined',
    submitted_at: '2026-10-02 12:00:00',
  });
  const calls = [];
  async function send(message) {
    calls.push(message.to);
    if (message.to === 'bea@example.com' && calls.filter((to) => to === 'bea@example.com').length === 1) {
      const err = new Error('mailbox unavailable');
      err.code = 'ECONNECTION';
      throw err;
    }
  }
  const first = await digest.runReviewDigest({ db, send, now: nineAm, hour: 9 });
  assert.strictEqual(first.status, 'error');
  assert.strictEqual(first.failures.length, 1);
  assert.strictEqual(first.failures[0].code, 'ECONNECTION');

  const soon = await digest.runReviewDigest({
    db,
    send,
    now: new Date('2026-10-02T14:05:00.000Z'),
    hour: 9,
  });
  assert.strictEqual(soon.status, 'skipped');
  assert.strictEqual(soon.reason, 'in-progress');

  const later = await digest.runReviewDigest({
    db,
    send,
    now: new Date('2026-10-02T15:20:00.000Z'),
    hour: 9,
  });
  assert.strictEqual(later.status, 'sent');
  assert.strictEqual(later.recipientCount, 1);
  const beaSends = calls.filter((to) => to === 'bea@example.com');
  const adaSends = calls.filter((to) => to === 'ada@example.com');
  assert.strictEqual(beaSends.length, 2);
  assert.strictEqual(adaSends.length, 1);
  assert.ok(!calls.includes('ed@example.com'));
  assert.ok(!calls.includes('pat@example.com'));
}

async function testOutsideHourSendsNothing() {
  const db = baseDb();
  addComic(db, {
    id: 4,
    user_id: 4,
    title: 'Morning queue',
    status: 'submitted',
    submitted_at: '2026-10-02 13:15:00',
  });
  const mail = recorder();
  const eightAm = new Date('2026-10-02T13:00:00.000Z');
  const result = await digest.runReviewDigest({ db, send: mail.send, now: eightAm, hour: 9 });
  assert.strictEqual(result.status, 'skipped');
  assert.strictEqual(result.reason, 'hour');
  assert.strictEqual(mail.calls.length, 0);
  const parts = digest.chicagoParts(eightAm);
  assert.strictEqual(parts.hour, 8);
  assert.strictEqual(digest.chicagoParts(nineAm).hour, 9);
}

async function testNewestFirstAndDryRun() {
  const db = baseDb();
  addComic(db, {
    id: 1,
    user_id: 4,
    title: 'Older',
    status: 'submitted',
    submitted_at: '2026-10-01 12:00:00',
  });
  addComic(db, {
    id: 2,
    user_id: 3,
    title: 'Newer',
    status: 'submitted',
    submitted_at: '2026-10-02 12:00:00',
  });
  const mail = recorder();
  const preview = await digest.runReviewDigest({
    db,
    send: mail.send,
    now: new Date('2026-10-02T13:00:00.000Z'),
    hour: 9,
    dryRun: true,
  });
  assert.strictEqual(preview.status, 'dry-run');
  assert.strictEqual(mail.calls.length, 0);
  assert.ok(preview.text.indexOf('Newer') < preview.text.indexOf('Older'));
  assert.strictEqual(preview.subject, 'PYPStories: 2 stories waiting for review');
  assert.strictEqual(preview.recipientCount, 3);
  const sends = db.prepare('SELECT COUNT(*) AS n FROM review_digest_sends').get().n;
  assert.strictEqual(sends, 0);

  const real = await digest.runReviewDigest({ db, send: mail.send, now: nineAm, hour: 9 });
  assert.strictEqual(real.status, 'sent');
  assert.strictEqual(mail.calls.length, 3);
}

async function main() {
  await testEmptyQueueSendsNothing();
  console.log('PASS empty queue sends nothing');
  await testOnePendingEmailsEachAdmin();
  console.log('PASS one pending comic emails each admin');
  await testRecentAndOverlappingRunsAreSkipped();
  console.log('PASS a recent or overlapping run is skipped');
  await testFailedSendRetriesWithoutRepeatingAdmins();
  console.log('PASS a failed send retries without repeating admins');
  await testOutsideHourSendsNothing();
  console.log('PASS outside the configured hour sends nothing');
  await testNewestFirstAndDryRun();
  console.log('PASS dry-run lists newest first and does not send');
  console.log('ALL PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
