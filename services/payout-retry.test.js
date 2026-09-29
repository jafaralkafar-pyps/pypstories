/**
 * Creator payout retry behavior. Run: node services/payout-retry.test.js
 * Stripe is mocked. No network and no .env.
 */

const assert = require('assert');
const Database = require('better-sqlite3');
const credits = require('./credits');

function stripeError(type, code, message) {
  const err = new Error(message || type);
  err.type = type;
  if (code) err.code = code;
  return err;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function newestFirst(a, b) {
  return (b.created || 0) - (a.created || 0) || String(b.id).localeCompare(String(a.id));
}

// Mirrors stripe.transfers.list: the promise itself is async-iterable and has
// autoPagingEach. .data is only the first page. There is no transfers.search.
function asStripeList(rows, params) {
  const limit = Math.min(Math.max(Number(params && params.limit) || 10, 1), 100);
  const sorted = rows.slice().sort(newestFirst);
  function slicePage(startingAfter) {
    let start = 0;
    if (startingAfter) {
      const idx = sorted.findIndex((row) => row.id === startingAfter);
      start = idx === -1 ? sorted.length : idx + 1;
    }
    const data = sorted.slice(start, start + limit);
    return { data, has_more: start + limit < sorted.length };
  }
  const first = slicePage(params && params.starting_after);
  const promise = Promise.resolve({ object: 'list', data: first.data, has_more: first.has_more });
  promise[Symbol.asyncIterator] = async function* () {
    let cursor = params && params.starting_after;
    for (;;) {
      const page = slicePage(cursor);
      for (const item of page.data) yield item;
      if (!page.has_more || !page.data.length) return;
      cursor = page.data[page.data.length - 1].id;
    }
  };
  promise.autoPagingEach = async (onItem) => {
    for await (const item of promise) {
      const keepGoing = await onItem(item);
      if (keepGoing === false) return;
    }
  };
  return promise;
}

function rowsForList(ledger, params) {
  const destination = params && params.destination;
  const gte = params && params.created && params.created.gte;
  const filtered = destination && gte != null;
  const matched = ledger.filter((row) => {
    if (!filtered) return true;
    if (row.destination !== destination) return false;
    if (Number(row.created) < Number(gte)) return false;
    return true;
  });
  if (!filtered) {
    // An unfiltered list exposes only its first page, which is what
    // list({ limit: 100 }) used to see. Older rows stay unreachable.
    const limit = Math.min(Math.max(Number(params && params.limit) || 10, 1), 100);
    return matched.slice().sort(newestFirst).slice(0, limit);
  }
  return matched;
}

function createMockStripe() {
  const state = {
    creates: [],
    transfers: [],
    ledger: [],
    listCalls: [],
    failNext: null,
    listError: null,
    gate: null,
  };
  const inflight = new Map();

  const stripe = {
    transfers: {
      list(params) {
        if (state.listError) throw state.listError;
        state.listCalls.push(clone(params || {}));
        return asStripeList(rowsForList(state.ledger, params), params);
      },
      async create(params, opts) {
        const key = opts.idempotencyKey;
        const snap = clone(params);
        state.creates.push({ params: snap, idempotencyKey: key });
        if (inflight.has(key)) {
          const prev = inflight.get(key);
          if (JSON.stringify(prev.params) !== JSON.stringify(snap)) {
            throw stripeError('StripeIdempotencyError', 'idempotency_error', 'idempotency key reused with different parameters');
          }
          return prev.result;
        }
        const job = (async () => {
          if (state.gate) await state.gate;
          if (state.failNext) {
            const err = state.failNext;
            state.failNext = null;
            throw err;
          }
          const transfer = {
            id: 'tr_' + (state.transfers.length + 1),
            amount: params.amount,
            destination: params.destination,
            created: Math.floor(Date.now() / 1000),
            metadata: { ...params.metadata },
          };
          state.transfers.push(transfer);
          state.ledger.push(transfer);
          return transfer;
        })();
        inflight.set(key, { params: snap, result: job });
        try {
          return await job;
        } catch (err) {
          const cached = Promise.reject(err);
          cached.catch(() => {});
          inflight.set(key, { params: snap, result: cached });
          throw err;
        }
      },
    },
  };
  return { stripe, state };
}

function payoutUnix(createdAt) {
  const text = String(createdAt);
  const iso = text.includes('T') ? text : text.replace(' ', 'T') + 'Z';
  return Math.floor(Date.parse(iso) / 1000);
}

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      stripe_account_id TEXT,
      credit_balance_cents INTEGER DEFAULT 0
    );
  `);
  credits.initCreditSchema(db);
  return db;
}

let userSeq = 0;
function freshCreator() {
  userSeq += 1;
  const db = makeDb();
  const row = db.prepare(
    'INSERT INTO users (username, stripe_account_id) VALUES (?, ?)'
  ).run('creator' + userSeq, 'acct_test_' + userSeq);
  const creatorId = Number(row.lastInsertRowid);
  const insert = db.prepare(`
    INSERT INTO creator_earnings (
      creator_id, gross_cents, platform_fee_cents, creator_cents, source, status, available_at
    ) VALUES (?, ?, 0, ?, 'stripe_full', 'available', datetime('now', '-40 days'))
  `);
  insert.run(creatorId, 3000, 3000);
  insert.run(creatorId, 2500, 2500);
  return { db, creatorId };
}

function earnings(db, creatorId) {
  return db.prepare(
    'SELECT id, status, payout_id, creator_cents FROM creator_earnings WHERE creator_id = ? ORDER BY id'
  ).all(creatorId);
}

function payouts(db, creatorId) {
  return db.prepare(
    'SELECT id, status, stripe_transfer_id, amount_cents, created_at FROM creator_payouts WHERE creator_id = ? ORDER BY id'
  ).all(creatorId);
}

function withConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = orig;
    })
    .then((result) => ({ result, lines }));
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function testBalanceInsufficientThenRetryPaysOnce() {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  state.failNext = stripeError('StripeInvalidRequestError', 'balance_insufficient', 'Insufficient funds in Stripe account');

  await assert.rejects(
    () => credits.requestPayout(db, stripe, creatorId),
    (err) => err.code === 'balance_insufficient'
  );

  const released = earnings(db, creatorId);
  assert.deepStrictEqual(released.map((row) => row.status), ['available', 'available']);
  assert.deepStrictEqual(released.map((row) => row.payout_id), [null, null]);
  const failed = payouts(db, creatorId);
  assert.strictEqual(failed.length, 1);
  assert.strictEqual(failed[0].status, 'failed');
  assert.strictEqual(failed[0].stripe_transfer_id, null);
  assert.strictEqual(state.transfers.length, 0);

  const paid = await credits.requestPayout(db, stripe, creatorId);
  assert.strictEqual(state.transfers.length, 1);
  assert.strictEqual(state.creates.length, 2);
  assert.notStrictEqual(state.creates[0].idempotencyKey, state.creates[1].idempotencyKey);
  assert.notStrictEqual(state.creates[0].params.metadata.payout_id, state.creates[1].params.metadata.payout_id);
  assert.strictEqual(state.creates[1].params.amount, 5500);
  assert.strictEqual(state.creates[1].params.metadata.payout_id, String(paid.payout_id));
  assert.strictEqual(paid.transfer_id, state.transfers[0].id);
  assert.strictEqual(paid.amount_cents, 5500);
  const clientError = credits.payoutClientError(state.failNext || stripeError('StripeInvalidRequestError', 'balance_insufficient', 'Insufficient funds in Stripe account'));
  assert.strictEqual(clientError.httpStatus, 400);
  assert.strictEqual(clientError.body.error, credits.PAYOUT_DEFINITE_FAILURE_MESSAGE);
  assert.ok(!JSON.stringify(clientError.body).includes('Insufficient'));
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['paid', 'paid']);
  const rows = payouts(db, creatorId);
  assert.strictEqual(rows.filter((row) => row.status === 'completed').length, 1);
  assert.strictEqual(rows.filter((row) => row.status === 'failed').length, 1);
  assert.strictEqual(rows.find((row) => row.status === 'completed').stripe_transfer_id, paid.transfer_id);
  console.log('PASS balance_insufficient releases, retry pays once');
}

async function testDefiniteErrorsRelease() {
  const cases = [
    stripeError('StripeIdempotencyError', 'idempotency_error', 'idempotency mismatch'),
    stripeError('StripeCardError', 'card_declined', 'card declined'),
    stripeError('StripePermissionError', 'permission', 'permission'),
    stripeError('StripeAuthenticationError', 'auth', 'auth'),
  ];
  for (const fail of cases) {
    const { db, creatorId } = freshCreator();
    const { stripe, state } = createMockStripe();
    state.failNext = fail;
    await assert.rejects(() => credits.requestPayout(db, stripe, creatorId), (err) => err.type === fail.type);
    assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['available', 'available']);
    assert.strictEqual(payouts(db, creatorId)[0].status, 'failed');
    assert.strictEqual(state.transfers.length, 0);
    console.log('PASS release on ' + fail.type);
  }
}

async function testIdempotencyErrorKeepsPaidTransfer() {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  state.failNext = stripeError('StripeIdempotencyError', 'idempotency_error', 'idempotency mismatch');
  const account = db.prepare('SELECT stripe_account_id FROM users WHERE id = ?').get(creatorId);
  stripe.transfers.list = (params) => {
    state.listCalls.push(clone(params || {}));
    const payout = db.prepare('SELECT id, created_at FROM creator_payouts WHERE creator_id = ?').get(creatorId);
    return asStripeList([{
      id: 'tr_existing',
      destination: account.stripe_account_id,
      created: payoutUnix(payout.created_at),
      metadata: { payout_id: String(payout.id), creator_id: String(creatorId) },
    }], params);
  };

  const result = await credits.requestPayout(db, stripe, creatorId);
  assert.strictEqual(result.already, true);
  assert.strictEqual(result.transfer_id, 'tr_existing');
  assert.strictEqual(state.transfers.length, 0);
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['paid', 'paid']);
  assert.strictEqual(payouts(db, creatorId)[0].status, 'completed');
  assert.strictEqual(payouts(db, creatorId)[0].stripe_transfer_id, 'tr_existing');
  console.log('PASS idempotency error with an existing transfer marks paid');
}

async function testIdempotencyLookupFailureStaysProcessing() {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  state.failNext = stripeError('StripeIdempotencyError', 'idempotency_error', 'idempotency mismatch');
  state.listError = new Error('list unavailable');
  const { lines } = await withConsoleError(async () => {
    await assert.rejects(
      () => credits.requestPayout(db, stripe, creatorId),
      (err) => err.type === 'StripeIdempotencyError'
    );
  });
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['processing', 'processing']);
  assert.strictEqual(payouts(db, creatorId)[0].status, 'pending');
  assert.ok(lines.some((line) => line.includes('Manual reconcile is needed')));
  console.log('PASS idempotency lookup failure stays processing');
}

async function testDoubleClickOneTransfer() {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  let release;
  state.gate = new Promise((resolve) => {
    release = resolve;
  });

  const first = credits.requestPayout(db, stripe, creatorId);
  assert.strictEqual(state.creates.length, 1);
  const second = credits.requestPayout(db, stripe, creatorId);
  for (let i = 0; i < 10 && state.creates.length < 2; i += 1) await flush();
  assert.strictEqual(state.creates.length, 2);
  assert.strictEqual(state.creates[0].idempotencyKey, state.creates[1].idempotencyKey);
  assert.deepStrictEqual(state.creates[0].params, state.creates[1].params);

  release();
  const [a, b] = await Promise.all([first, second]);
  assert.strictEqual(state.transfers.length, 1);
  assert.strictEqual(a.transfer_id, b.transfer_id);
  assert.strictEqual(a.transfer_id, 'tr_1');
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['paid', 'paid']);
  assert.strictEqual(payouts(db, creatorId).length, 1);
  assert.strictEqual(payouts(db, creatorId)[0].status, 'completed');
  console.log('PASS double click sends one transfer');
}

async function testUnknownLeavesProcessing(label, err) {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  state.failNext = err;
  const { lines } = await withConsoleError(async () => {
    await assert.rejects(() => credits.requestPayout(db, stripe, creatorId), (e) => e === err || e.type === err.type);
  });
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['processing', 'processing']);
  const payout = payouts(db, creatorId)[0];
  assert.strictEqual(payout.status, 'pending');
  assert.strictEqual(payout.stripe_transfer_id, null);
  assert.strictEqual(state.transfers.length, 0);
  assert.ok(lines.some((line) => line.includes('Manual reconcile is needed')));
  assert.ok(lines.some((line) => line.includes(String(err.type))));
  const mapped = credits.payoutClientError(err);
  assert.strictEqual(mapped.httpStatus, 202);
  assert.strictEqual(mapped.body.status, 'processing');
  assert.strictEqual(mapped.body.message, credits.PAYOUT_PROCESSING_MESSAGE);
  assert.ok(!JSON.stringify(mapped.body).includes(err.message));

  // Same claim retries with the same body and the same key.
  await withConsoleError(async () => {
    await assert.rejects(() => credits.requestPayout(db, stripe, creatorId));
  });
  assert.strictEqual(state.creates.length, 2);
  assert.strictEqual(state.creates[0].idempotencyKey, state.creates[1].idempotencyKey);
  assert.deepStrictEqual(state.creates[0].params, state.creates[1].params);
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['processing', 'processing']);
  console.log('PASS ' + label + ' leaves processing and logs reconcile');
}

async function testReconcile() {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  state.failNext = stripeError('StripeConnectionError', 'ECONNRESET', 'socket hang up');
  await withConsoleError(() => assert.rejects(() => credits.requestPayout(db, stripe, creatorId)));
  const youngId = payouts(db, creatorId)[0].id;

  await assert.rejects(
    () => credits.reconcileStuckPayout(db, stripe, youngId),
    /newer than 24 hours/
  );
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['processing', 'processing']);
  assert.strictEqual(state.creates.length, 1, 'reconcile must not create a transfer');

  db.prepare(`UPDATE creator_payouts SET created_at = datetime('now', '-25 hours') WHERE id = ?`).run(youngId);
  await assert.rejects(
    () => credits.requestPayout(db, stripe, creatorId),
    /Reconcile it before retrying/
  );
  assert.strictEqual(state.creates.length, 1);

  const listed = credits.listStuckPayouts(db);
  assert.ok(listed.payouts.some((row) => row.id === youngId));
  assert.strictEqual(listed.earnings.length, 2);

  const account = db.prepare('SELECT stripe_account_id FROM users WHERE id = ?').get(creatorId);
  const young = payouts(db, creatorId)[0];
  state.ledger.push({
    id: 'tr_reconciled',
    destination: account.stripe_account_id,
    created: payoutUnix(young.created_at),
    metadata: { payout_id: String(youngId), creator_id: String(creatorId) },
  });
  const paid = await credits.reconcileStuckPayout(db, stripe, youngId);
  assert.strictEqual(paid.action, 'paid');
  assert.strictEqual(paid.transfer_id, 'tr_reconciled');
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['paid', 'paid']);
  assert.strictEqual(state.creates.length, 1);

  const other = freshCreator();
  const mock2 = createMockStripe();
  mock2.state.failNext = stripeError('StripeAPIError', 'api_error', 'upstream');
  mock2.state.failNext.statusCode = 500;
  await withConsoleError(() => assert.rejects(() => credits.requestPayout(other.db, mock2.stripe, other.creatorId)));
  const oldId = payouts(other.db, other.creatorId)[0].id;
  other.db.prepare(`UPDATE creator_payouts SET created_at = datetime('now', '-25 hours') WHERE id = ?`).run(oldId);
  const released = await credits.reconcileStuckPayout(other.db, mock2.stripe, oldId);
  assert.strictEqual(released.action, 'released');
  assert.deepStrictEqual(earnings(other.db, other.creatorId).map((row) => row.status), ['available', 'available']);
  assert.strictEqual(payouts(other.db, other.creatorId)[0].status, 'failed');
  assert.strictEqual(mock2.state.creates.length, 1);
  const stuckAfter = credits.listStuckPayouts(other.db);
  assert.strictEqual(stuckAfter.payouts.length, 0);
  assert.strictEqual(stuckAfter.earnings.length, 0);
  console.log('PASS reconcile pays if Stripe has the transfer, otherwise releases');
}

async function testListFindsTransferPastFirstPage() {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  state.failNext = stripeError('StripeConnectionError', 'ECONNRESET', 'socket hang up');
  await withConsoleError(() => assert.rejects(() => credits.requestPayout(db, stripe, creatorId)));
  const payout = payouts(db, creatorId)[0];
  const account = db.prepare('SELECT stripe_account_id FROM users WHERE id = ?').get(creatorId);
  const created = payoutUnix(payout.created_at);
  state.ledger.push({
    id: 'tr_target',
    destination: account.stripe_account_id,
    created,
    metadata: { payout_id: String(payout.id), creator_id: String(creatorId) },
  });
  for (let i = 0; i < 120; i += 1) {
    state.ledger.push({
      id: 'tr_noise_' + i,
      destination: account.stripe_account_id,
      created: created + 10 + i,
      metadata: { payout_id: 'other', creator_id: '999' },
    });
  }
  for (let i = 0; i < 5; i += 1) {
    state.ledger.push({
      id: 'tr_other_dest_' + i,
      destination: 'acct_someone_else',
      created: created + 500 + i,
      metadata: { payout_id: String(payout.id), creator_id: String(creatorId) },
    });
  }

  const result = await credits.requestPayout(db, stripe, creatorId);
  assert.strictEqual(result.already, true);
  assert.strictEqual(result.transfer_id, 'tr_target');
  assert.strictEqual(state.creates.length, 1);
  assert.ok(state.listCalls.length >= 1);
  const call = state.listCalls[state.listCalls.length - 1];
  assert.strictEqual(call.destination, account.stripe_account_id);
  assert.ok(call.created && call.created.gte <= created);
  assert.ok(created - call.created.gte <= 3600);
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['paid', 'paid']);
  const firstPage = await stripe.transfers.list(call);
  assert.ok(firstPage.data.length <= 100);
  assert.ok(!firstPage.data.some((row) => row.id === 'tr_target'));
  console.log('PASS lookup pages past 100 newer transfers and finds the payout');
}

async function testReconcileLookupFailureLeavesState() {
  const { db, creatorId } = freshCreator();
  const { stripe, state } = createMockStripe();
  state.failNext = stripeError('StripeConnectionError', 'ECONNRESET', 'socket hang up');
  await withConsoleError(() => assert.rejects(() => credits.requestPayout(db, stripe, creatorId)));
  const id = payouts(db, creatorId)[0].id;
  db.prepare(`UPDATE creator_payouts SET created_at = datetime('now', '-25 hours') WHERE id = ?`).run(id);
  state.listError = new Error('list down');
  const { lines } = await withConsoleError(async () => {
    await assert.rejects(
      () => credits.reconcileStuckPayout(db, stripe, id),
      /left unchanged/
    );
  });
  assert.deepStrictEqual(earnings(db, creatorId).map((row) => row.status), ['processing', 'processing']);
  assert.strictEqual(payouts(db, creatorId)[0].status, 'pending');
  assert.strictEqual(payouts(db, creatorId)[0].stripe_transfer_id, null);
  assert.ok(lines.some((line) => line.includes('Manual reconcile is needed')));
  assert.strictEqual(state.creates.length, 1);
  console.log('PASS reconcile lookup failure leaves the payout unchanged');
}

async function testStuckListIncludesNullPayoutId() {
  const { db, creatorId } = freshCreator();
  db.prepare(`
    INSERT INTO creator_earnings (
      creator_id, gross_cents, platform_fee_cents, creator_cents, source, status, payout_id
    ) VALUES (?, 100, 0, 100, 'stripe_full', 'processing', NULL)
  `).run(creatorId);
  const stuck = credits.listStuckPayouts(db);
  assert.ok(stuck.earnings.some((row) => row.payout_id == null && row.creator_id === creatorId));
  console.log('PASS stuck list includes processing earnings with no payout id');
}

async function testClientMessagesHideStripeDetails() {
  const definite = stripeError('StripeCardError', 'card_declined', 'Your card was declined');
  const definiteMapped = credits.payoutClientError(definite);
  assert.strictEqual(definiteMapped.httpStatus, 400);
  assert.strictEqual(definiteMapped.body.error, credits.PAYOUT_DEFINITE_FAILURE_MESSAGE);
  assert.ok(!JSON.stringify(definiteMapped.body).includes('declined'));

  const rate = stripeError('StripeRateLimitError', 'rate_limit', 'Too many requests');
  rate.statusCode = 429;
  const rateMapped = credits.payoutClientError(rate);
  assert.strictEqual(rateMapped.httpStatus, 202);
  assert.strictEqual(rateMapped.body.message, credits.PAYOUT_PROCESSING_MESSAGE);

  const conflict = stripeError('StripeIdempotencyError', 'idempotency_key_in_use', 'key in use');
  conflict.statusCode = 409;
  assert.strictEqual(credits.isDefiniteStripeFailure(conflict), false);
  assert.strictEqual(credits.payoutClientError(conflict).httpStatus, 202);

  assert.strictEqual(credits.payoutClientError(new Error('Connect your Stripe account for payouts first')), null);
  console.log('PASS client messages hide raw Stripe errors');
}

async function main() {
  await testBalanceInsufficientThenRetryPaysOnce();
  await testDefiniteErrorsRelease();
  await testIdempotencyErrorKeepsPaidTransfer();
  await testIdempotencyLookupFailureStaysProcessing();
  await testDoubleClickOneTransfer();
  await testUnknownLeavesProcessing(
    'network error',
    stripeError('StripeConnectionError', 'ECONNRESET', 'socket hang up')
  );
  const apiErr = stripeError('StripeAPIError', 'api_error', 'upstream 500');
  apiErr.statusCode = 500;
  await testUnknownLeavesProcessing('http 500', apiErr);
  const rateErr = stripeError('StripeRateLimitError', 'rate_limit', 'Too many requests');
  rateErr.statusCode = 429;
  await testUnknownLeavesProcessing('http 429', rateErr);
  const conflictErr = stripeError('StripeAPIError', 'idempotency_key_in_use', 'key in use');
  conflictErr.statusCode = 409;
  await testUnknownLeavesProcessing('http 409', conflictErr);
  await testReconcile();
  await testListFindsTransferPastFirstPage();
  await testReconcileLookupFailureLeavesState();
  await testStuckListIncludesNullPayoutId();
  await testClientMessagesHideStripeDetails();
  console.log('ALL PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
