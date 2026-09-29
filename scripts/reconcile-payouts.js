/**
 * Explicit recovery for creator payouts stuck in processing.
 * Does nothing unless you run it.
 *
 *   node scripts/reconcile-payouts.js list
 *   node scripts/reconcile-payouts.js reconcile <payoutId>
 *
 * list prints pending payouts with no transfer id older than 24 hours, and
 * processing earnings, including rows whose payout_id is NULL. It does not
 * call Stripe. reconcile reads Stripe and either marks that payout paid or
 * releases its earnings. It does not create a transfer.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Database = require('better-sqlite3');
const Stripe = require('stripe');
const credits = require('../services/credits');

const dbPath = path.join(__dirname, '..', 'data', 'cyoa.db');

function usage() {
  console.error('Usage: node scripts/reconcile-payouts.js list');
  console.error('       node scripts/reconcile-payouts.js reconcile <payoutId>');
}

function openDb() {
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found.');
    process.exit(1);
  }
  const db = new Database(dbPath);
  credits.initCreditSchema(db);
  return db;
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key.startsWith('sk_')) return null;
  return new Stripe(key, { apiVersion: '2026-06-24.dahlia' });
}

async function main() {
  const command = process.argv[2];
  if (command !== 'list' && command !== 'reconcile') {
    usage();
    process.exit(1);
  }

  const db = openDb();
  try {
    if (command === 'list') {
      const stuck = credits.listStuckPayouts(db);
      console.log('Stuck payouts and processing earnings. No Stripe request was made.');
      console.log(JSON.stringify(stuck, null, 2));
      return;
    }

    const arg = process.argv[3];
    if (!/^\d+$/.test(String(arg || ''))) {
      usage();
      process.exit(1);
    }
    const stripe = stripeClient();
    const result = await credits.reconcileStuckPayout(db, stripe, Number(arg));
    console.log(JSON.stringify(result));
  } catch (err) {
    const safe = (err && err.message) || 'Reconcile failed';
    console.error(safe);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().then(() => {
  process.exit(process.exitCode || 0);
}).catch((err) => {
  console.error((err && err.message) || 'Reconcile failed');
  process.exit(1);
});
