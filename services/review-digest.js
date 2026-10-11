/**
 * Daily plain-text digest of the Review Queue for admin accounts only.
 * Statuses match GET /api/admin/pending-stories: submitted, in_review, quarantined.
 * The script decides when to run; this module does not start a timer.
 */
const DIGEST_TZ = 'America/Chicago';
const SITE_URL = 'https://www.pypstories.com';
const QUEUE_STATUSES = ['submitted', 'in_review', 'quarantined'];
const RECENT_MS = 20 * 60 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

function digestHourFromEnv(value) {
  if (value == null || String(value).trim() === '') return 9;
  const hour = Number(String(value).trim());
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    const err = new Error('REVIEW_DIGEST_HOUR must be an integer from 0 to 23');
    err.code = 'BAD_HOUR';
    throw err;
  }
  return hour;
}

function parseUtc(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function chicagoParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
    minute: '2-digit',
  });
  const parts = {};
  fmt.formatToParts(date).forEach((part) => {
    parts[part.type] = part.value;
  });
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    hour,
  };
}

function formatChicago(value) {
  const date = parseUtc(value);
  if (!date) return 'unknown time';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return formatted + ' CT';
}

function oneLine(value, fallback) {
  const text = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  return text || fallback;
}

function ensureReviewDigestTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_digest_runs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_started_at TEXT,
      last_finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS review_digest_sends (
      user_id INTEGER NOT NULL,
      sent_on TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (user_id, sent_on)
    );
  `);
  db.prepare(`
    INSERT OR IGNORE INTO review_digest_runs (id, last_started_at, last_finished_at)
    VALUES (1, NULL, NULL)
  `).run();
}

function listWaiting(db) {
  const placeholders = QUEUE_STATUSES.map(() => '?').join(', ');
  return db.prepare(`
    SELECT c.id, c.title, c.status, c.submitted_at, c.created_at, u.username AS author
    FROM comics c
    JOIN users u ON u.id = c.user_id
    WHERE c.status IN (${placeholders})
    ORDER BY datetime(COALESCE(c.submitted_at, c.created_at)) DESC, c.id DESC
  `).all(...QUEUE_STATUSES);
}

function listAdmins(db) {
  return db.prepare(`
    SELECT id, email, username
    FROM users
    WHERE role = 'admin'
      AND email IS NOT NULL
      AND trim(email) != ''
    ORDER BY id ASC
  `).all();
}

function subjectFor(count) {
  const noun = count === 1 ? 'story' : 'stories';
  return 'PYPStories: ' + count + ' ' + noun + ' waiting for review';
}

function buildBody(comics) {
  const lead = comics.length === 1
    ? '1 story is waiting for review.'
    : comics.length + ' stories are waiting for review.';
  const blocks = comics.map((comic) => {
    return [
      oneLine(comic.title, 'Untitled'),
      'Author: ' + oneLine(comic.author, 'unknown'),
      'Submitted: ' + formatChicago(comic.submitted_at || comic.created_at),
    ].join('\n');
  });
  return [
    lead,
    '',
    blocks.join('\n\n'),
    '',
    'Open the Review Queue:',
    SITE_URL,
    '',
  ].join('\n');
}

function readRun(db) {
  return db.prepare(`
    SELECT last_started_at, last_finished_at
    FROM review_digest_runs
    WHERE id = 1
  `).get();
}

function runIsOpen(started, finished) {
  if (!started) return false;
  if (!finished) return true;
  return finished.getTime() < started.getTime();
}

function unfinishedToday(db, now) {
  const row = readRun(db);
  const started = parseUtc(row && row.last_started_at);
  const finished = parseUtc(row && row.last_finished_at);
  if (!runIsOpen(started, finished)) return false;
  if (chicagoParts(started).date !== chicagoParts(now).date) return false;
  if (now.getTime() - started.getTime() < LOCK_MS) return false;
  return true;
}

function prepareSend(db, now, admins) {
  const sentOn = chicagoParts(now).date;
  const already = db.prepare(`
    SELECT 1 FROM review_digest_sends WHERE user_id = ? AND sent_on = ?
  `);
  const claim = db.transaction(() => {
    const row = readRun(db);
    const started = parseUtc(row && row.last_started_at);
    const finished = parseUtc(row && row.last_finished_at);
    if (finished && now.getTime() - finished.getTime() < RECENT_MS) {
      return { ok: false, reason: 'recent' };
    }
    if (finished && chicagoParts(finished).date === sentOn) {
      return { ok: false, reason: 'already-today' };
    }
    if (runIsOpen(started, finished) && now.getTime() - started.getTime() < LOCK_MS) {
      return { ok: false, reason: 'in-progress' };
    }
    const due = admins.filter((admin) => !already.get(admin.id, sentOn));
    if (due.length === 0) return { ok: false, reason: 'already-today' };
    db.prepare('UPDATE review_digest_runs SET last_started_at = ? WHERE id = 1')
      .run(now.toISOString());
    return { ok: true, due, sentOn };
  });
  return claim.immediate();
}

function recordSend(db, userId, sentOn, sentAt) {
  db.prepare(`
    INSERT OR IGNORE INTO review_digest_sends (user_id, sent_on, sent_at)
    VALUES (?, ?, ?)
  `).run(userId, sentOn, sentAt);
}

function finishRun(db, sentAt) {
  db.prepare('UPDATE review_digest_runs SET last_finished_at = ? WHERE id = 1').run(sentAt);
}

async function runReviewDigest(options) {
  const db = options.db;
  const send = options.send;
  const now = options.now instanceof Date ? options.now : new Date();
  const dryRun = !!options.dryRun;
  const hour = options.hour == null ? digestHourFromEnv(process.env.REVIEW_DIGEST_HOUR) : options.hour;
  ensureReviewDigestTables(db);

  const here = chicagoParts(now);
  const retry = !dryRun && unfinishedToday(db, now);
  if (!dryRun && here.hour !== hour && !retry) {
    return { status: 'skipped', reason: 'hour', comicCount: 0, recipientCount: 0 };
  }

  const comics = listWaiting(db);
  if (comics.length === 0) {
    return { status: 'skipped', reason: 'empty', comicCount: 0, recipientCount: 0 };
  }

  const admins = listAdmins(db);
  const subject = subjectFor(comics.length);
  const text = buildBody(comics);
  if (dryRun) {
    return {
      status: 'dry-run',
      subject,
      text,
      comicCount: comics.length,
      recipientCount: admins.length,
      recipients: admins.map((admin) => ({ id: admin.id, email: admin.email })),
    };
  }
  if (admins.length === 0) {
    return { status: 'skipped', reason: 'no-admins', comicCount: comics.length, recipientCount: 0 };
  }

  const prepared = prepareSend(db, now, admins);
  if (!prepared.ok) {
    return { status: 'skipped', reason: prepared.reason, comicCount: comics.length, recipientCount: 0 };
  }

  const failures = [];
  let recipientCount = 0;
  for (const admin of prepared.due) {
    try {
      await send({ to: admin.email, subject, text });
      recordSend(db, admin.id, prepared.sentOn, now.toISOString());
      recipientCount += 1;
    } catch (err) {
      failures.push({
        userId: admin.id,
        code: (err && (err.code || err.name)) || 'mail failed',
      });
    }
  }

  if (failures.length === 0) {
    finishRun(db, now.toISOString());
    return { status: 'sent', comicCount: comics.length, recipientCount };
  }
  return { status: 'error', comicCount: comics.length, recipientCount, failures };
}

module.exports = {
  DIGEST_TZ,
  SITE_URL,
  QUEUE_STATUSES,
  digestHourFromEnv,
  chicagoParts,
  formatChicago,
  ensureReviewDigestTables,
  runReviewDigest,
};
