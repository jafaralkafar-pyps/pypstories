/**
 * Email admins the Review Queue, once a day. Sends nothing when the queue is empty.
 *
 *   node scripts/review-digest.js
 *   node scripts/review-digest.js --dry-run
 *
 * Droplet cron runs this every hour. The script sends only when the
 * America/Chicago hour equals REVIEW_DIGEST_HOUR (default 9), and it retries
 * a failed attempt later the same day. Put this in the app user's crontab,
 * from the directory that contains server.js:
 *
 *   0 * * * * cd /path/to/website && /usr/bin/node scripts/review-digest.js >> /var/log/pypstories-review-digest.log 2>&1
 *
 * REVIEW_DIGEST_HOUR may be set in the environment or in .env. A failed send
 * exits non-zero. This process is separate from the website.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Database = require('better-sqlite3');
const { sendEmail } = require('../services/mail');
const digest = require('../services/review-digest');

const dbPath = path.join(__dirname, '..', 'data', 'cyoa.db');

function openDb() {
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found.');
    process.exit(1);
  }
  return new Database(dbPath);
}

async function sendPlain(message) {
  await sendEmail(message.to, message.subject, null, message.text);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  let hour;
  try {
    hour = digest.digestHourFromEnv(process.env.REVIEW_DIGEST_HOUR);
  } catch (err) {
    console.error(err && err.message ? err.message : 'REVIEW_DIGEST_HOUR is invalid');
    process.exit(1);
  }

  const db = openDb();
  try {
    const result = await digest.runReviewDigest({
      db,
      send: sendPlain,
      hour,
      dryRun,
    });
    if (result.status === 'sent') {
      console.log('Review digest sent', {
        recipients: result.recipientCount,
        comics: result.comicCount,
      });
      return;
    }
    if (result.status === 'dry-run') {
      console.log(result.subject);
      console.log(result.text);
      console.log('Review digest dry-run', {
        recipients: result.recipientCount,
        comics: result.comicCount,
      });
      return;
    }
    if (result.status === 'error') {
      console.error('Review digest failed', {
        recipients: result.recipientCount,
        comics: result.comicCount,
        failures: result.failures,
      });
      process.exitCode = 1;
      return;
    }
    if (result.reason === 'empty' || result.reason === 'recent' || result.reason === 'in-progress' || result.reason === 'already-today' || result.reason === 'no-admins') {
      console.log('Review digest skipped', { reason: result.reason, comics: result.comicCount });
    }
  } catch (err) {
    console.error('Review digest failed', {
      code: (err && (err.code || err.name)) || 'mail failed',
    });
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().then(() => {
  process.exit(process.exitCode || 0);
}).catch((err) => {
  console.error('Review digest failed', {
    code: (err && (err.code || err.name)) || 'mail failed',
  });
  process.exit(1);
});
