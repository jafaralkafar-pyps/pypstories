/**
 * Credits wallet: 1 credit = $0.01 (1 cent).
 * Stripe is used only for top-ups; chapter/story spends are internal ledger moves.
 */

const crypto = require('crypto');

const CREDIT_MIN_TOPUP_CENTS = 500; // $5
const CREDIT_BONUS_THRESHOLD_CENTS = 2000; // larger than $20 → 10% bonus
const CREDIT_BONUS_RATE = 0.10;
const FULL_STORY_MIN_CENTS = 599; // $5.99 outright full story / bundle
const PAYOUT_MIN_CENTS = 5000; // $50
const DISPUTE_WINDOW_DAYS = 30;
const PLATFORM_RATE_DEFAULT = 0.15;
const PLATFORM_RATE_VOLUME = 0.10;
const PLATFORM_VOLUME_THRESHOLD_CENTS = 200000; // $2,000 lifetime creator sales

const CREDIT_PACKAGES = [
  { cents: 500, label: '$5' },
  { cents: 1000, label: '$10' },
  { cents: 2000, label: '$20' },
  { cents: 2500, label: '$25' },
  { cents: 5000, label: '$50' },
];

function creditsGrantedForTopup(paidCents) {
  const paid = Math.round(Number(paidCents) || 0);
  if (paid < CREDIT_MIN_TOPUP_CENTS) return 0;
  if (paid > CREDIT_BONUS_THRESHOLD_CENTS) {
    return Math.floor(paid * (1 + CREDIT_BONUS_RATE));
  }
  return paid;
}

function packageInfo(paidCents) {
  const paid = Math.round(Number(paidCents) || 0);
  const credits = creditsGrantedForTopup(paid);
  const bonus = credits - paid;
  return {
    paid_cents: paid,
    credits_granted: credits,
    bonus_credits: Math.max(0, bonus),
    bonus_rate: paid > CREDIT_BONUS_THRESHOLD_CENTS ? CREDIT_BONUS_RATE : 0,
  };
}

function initCreditSchema(db) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN credit_balance_cents INTEGER DEFAULT 0`);
  } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta_cents INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      kind TEXT NOT NULL,
      stripe_payment_intent TEXT,
      comic_id INTEGER,
      chapter_id INTEGER,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comic_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      price_cents INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (comic_id) REFERENCES comics(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapter_unlocks (
      user_id INTEGER NOT NULL,
      comic_id INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, comic_id, chapter_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (comic_id) REFERENCES comics(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS creator_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      buyer_id INTEGER,
      comic_id INTEGER,
      chapter_id INTEGER,
      gross_cents INTEGER NOT NULL,
      platform_fee_cents INTEGER NOT NULL,
      creator_cents INTEGER NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      available_at TEXT,
      paid_at TEXT,
      payout_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS creator_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      stripe_transfer_id TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_reversals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_payment_intent TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // One top-up grant per PaymentIntent, so a webhook retry cannot credit twice.
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_topup_pi
      ON credit_ledger(stripe_payment_intent)
      WHERE kind = 'topup' AND stripe_payment_intent IS NOT NULL
    `);
  } catch (e) {
    console.error('Could not create top-up idempotency index:', e.message);
  }
}

function getBalance(db, userId) {
  const row = db.prepare('SELECT credit_balance_cents FROM users WHERE id = ?').get(userId);
  return row ? (row.credit_balance_cents || 0) : 0;
}

function creatorLifetimeGross(db, creatorId) {
  const fromPurchases = db.prepare(`
    SELECT COALESCE(SUM(p.amount_paid_cents), 0) as total
    FROM purchases p
    JOIN comics c ON c.id = p.comic_id
    WHERE c.user_id = ?
  `).get(creatorId).total || 0;

  const fromEarnings = db.prepare(`
    SELECT COALESCE(SUM(gross_cents), 0) as total
    FROM creator_earnings
    WHERE creator_id = ?
  `).get(creatorId).total || 0;

  // purchases + credit earnings can double-count full-story credit buys if both recorded.
  // Prefer max of purchase gross and earnings gross for rate tier (conservative).
  return Math.max(fromPurchases, fromEarnings);
}

function getPlatformRate(db, creatorId) {
  const sales = creatorLifetimeGross(db, creatorId);
  return sales >= PLATFORM_VOLUME_THRESHOLD_CENTS ? PLATFORM_RATE_VOLUME : PLATFORM_RATE_DEFAULT;
}

function splitSale(db, creatorId, grossCents) {
  const gross = Math.round(Number(grossCents) || 0);
  const rate = getPlatformRate(db, creatorId);
  const platformFee = Math.round(gross * rate);
  const creatorShare = gross - platformFee;
  return { gross, platformFee, creatorShare, rate };
}

/** Apply a balance change and write ledger in the caller's transaction if wrapped. */
function applyCreditDelta(db, userId, deltaCents, kind, meta = {}) {
  const delta = Math.round(Number(deltaCents) || 0);
  if (!delta) throw new Error('delta_cents required');

  const row = db.prepare('SELECT credit_balance_cents FROM users WHERE id = ?').get(userId);
  if (!row) throw new Error('User not found');

  const current = row.credit_balance_cents || 0;
  const next = current + delta;
  if (next < 0 && !meta.allowNegative) throw new Error('Insufficient credits');

  db.prepare('UPDATE users SET credit_balance_cents = ? WHERE id = ?').run(next, userId);
  db.prepare(`
    INSERT INTO credit_ledger (
      user_id, delta_cents, balance_after, kind,
      stripe_payment_intent, comic_id, chapter_id, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    delta,
    next,
    kind,
    meta.stripe_payment_intent || null,
    meta.comic_id || null,
    meta.chapter_id || null,
    meta.note || null
  );

  return next;
}

function grantTopup(db, userId, paidCents, paymentIntent) {
  const info = packageInfo(paidCents);
  if (info.credits_granted < CREDIT_MIN_TOPUP_CENTS) {
    throw new Error('Top-up below minimum');
  }

  // Idempotent: same payment intent only once. A reversal wins over a late retry.
  if (paymentIntent) {
    const reversed = db.prepare(`
      SELECT 1 FROM payment_reversals WHERE stripe_payment_intent = ?
    `).get(paymentIntent);
    if (reversed) {
      return { already: true, reversed: true, balance: getBalance(db, userId), ...info };
    }
    const existing = db.prepare(`
      SELECT id FROM credit_ledger
      WHERE stripe_payment_intent = ? AND kind = 'topup'
    `).get(paymentIntent);
    if (existing) {
      return { already: true, balance: getBalance(db, userId), ...info };
    }
  }

  const note = info.bonus_credits > 0
    ? `Top-up $${(info.paid_cents / 100).toFixed(2)} + ${info.bonus_credits} bonus credits (10%)`
    : `Top-up $${(info.paid_cents / 100).toFixed(2)}`;

  let balance;
  try {
    balance = applyCreditDelta(db, userId, info.credits_granted, 'topup', {
      stripe_payment_intent: paymentIntent || null,
      note,
    });
  } catch (e) {
    if (paymentIntent && /UNIQUE/i.test(String(e.message || e))) {
      return { already: true, balance: getBalance(db, userId), ...info };
    }
    throw e;
  }

  return { already: false, balance, ...info };
}

/**
 * Record a paid full-story Checkout. Idempotent via UNIQUE(user_id, comic_id)
 * and one stripe_full earning per buyer+story. Uses the amount Stripe charged.
 */
function fulfillFullStoryPurchase(db, { buyerId, comicId, amountCents, paymentIntent }) {
  const buyer = parseInt(buyerId, 10);
  const comicIdNum = parseInt(comicId, 10);
  const amount = Math.round(Number(amountCents));
  if (!buyer || !comicIdNum) throw new Error('Missing buyer or story');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Missing amount_total');

  const pi = paymentIntent || null;
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicIdNum);
  if (!comic) throw new Error('Story not found');

  return db.transaction(() => {
    if (pi) {
      const reversed = db.prepare(`
        SELECT 1 FROM payment_reversals WHERE stripe_payment_intent = ?
      `).get(pi);
      if (reversed) return { reversed: true };
    }

    db.prepare(`
      INSERT OR IGNORE INTO purchases (user_id, comic_id, amount_paid_cents, stripe_payment_intent)
      VALUES (?, ?, ?, ?)
    `).run(buyer, comicIdNum, amount, pi);

    const existingEarn = db.prepare(`
      SELECT id FROM creator_earnings
      WHERE buyer_id = ? AND comic_id = ? AND source = 'stripe_full' LIMIT 1
    `).get(buyer, comicIdNum);
    if (!existingEarn) {
      recordCreatorEarning(db, {
        creatorId: comic.user_id,
        buyerId: buyer,
        comicId: comicIdNum,
        grossCents: amount,
        source: 'stripe_full',
      });
    }
    // Connect already moved the creator share on this charge. A retry finishes
    // this update if the first attempt recorded the earning and then failed.
    db.prepare(`
      UPDATE creator_earnings
      SET status = 'paid', paid_at = COALESCE(paid_at, datetime('now'))
      WHERE buyer_id = ? AND comic_id = ? AND source = 'stripe_full' AND status = 'pending'
    `).run(buyer, comicIdNum);

    return { ok: true, amount_cents: amount };
  })();
}

/**
 * Undo a Stripe charge in the local database.
 * Full refunds and new disputes both call this. Partial refunds do not.
 * Does not move money at Stripe: Connect destination charges are reversed by
 * Stripe when the charge is refunded, and this function only fixes our rows.
 * A later fulfill for the same PaymentIntent is ignored.
 */
function reverseStripePayment(db, paymentIntentId, reason) {
  const pi = String(paymentIntentId || '').trim();
  if (!pi) return { matched: false, reason: 'missing payment_intent' };

  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT id FROM payment_reversals WHERE stripe_payment_intent = ?
    `).get(pi);
    if (existing) return { matched: true, already: true, payment_intent: pi };

    const details = {
      matched: false,
      already: false,
      payment_intent: pi,
      topup: null,
      purchase: null,
      earnings_reversed: 0,
      earnings_already_paid_or_processing: 0,
      shortfall_cents: 0,
    };

    const topup = db.prepare(`
      SELECT user_id, delta_cents FROM credit_ledger
      WHERE stripe_payment_intent = ? AND kind = 'topup'
      ORDER BY id ASC LIMIT 1
    `).get(pi);
    if (topup) {
      details.matched = true;
      applyCreditDelta(db, topup.user_id, -topup.delta_cents, 'topup_reversal', {
        stripe_payment_intent: pi,
        note: String(reason || 'Payment reversed').slice(0, 500),
        allowNegative: true,
      });
      const after = getBalance(db, topup.user_id);
      details.topup = {
        user_id: topup.user_id,
        clawed_cents: topup.delta_cents,
        balance_after: after,
      };
      if (after < 0) details.shortfall_cents = -after;
    }

    const purchase = db.prepare(`
      SELECT id, user_id, comic_id, amount_paid_cents
      FROM purchases WHERE stripe_payment_intent = ?
    `).get(pi);
    if (purchase) {
      details.matched = true;
      db.prepare('DELETE FROM purchases WHERE id = ?').run(purchase.id);
      const earnings = db.prepare(`
        SELECT id, status FROM creator_earnings
        WHERE buyer_id = ? AND comic_id = ? AND source = 'stripe_full' AND status != 'reversed'
      `).all(purchase.user_id, purchase.comic_id);
      for (const earning of earnings) {
        if (earning.status === 'paid' || earning.status === 'processing') {
          details.earnings_already_paid_or_processing += 1;
        }
        db.prepare(`UPDATE creator_earnings SET status = 'reversed' WHERE id = ?`).run(earning.id);
        details.earnings_reversed += 1;
      }
      details.purchase = {
        user_id: purchase.user_id,
        comic_id: purchase.comic_id,
        amount_paid_cents: purchase.amount_paid_cents,
      };
    }

    db.prepare(`
      INSERT INTO payment_reversals (stripe_payment_intent, reason) VALUES (?, ?)
    `).run(pi, String(reason || '').slice(0, 500));
    return details;
  })();
}

function availableAtIso(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + DISPUTE_WINDOW_DAYS);
  return d.toISOString();
}

function recordCreatorEarning(db, {
  creatorId,
  buyerId,
  comicId,
  chapterId = null,
  grossCents,
  source,
}) {
  const { platformFee, creatorShare } = splitSale(db, creatorId, grossCents);
  const availableAt = availableAtIso();

  const result = db.prepare(`
    INSERT INTO creator_earnings (
      creator_id, buyer_id, comic_id, chapter_id,
      gross_cents, platform_fee_cents, creator_cents,
      source, status, available_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    creatorId,
    buyerId || null,
    comicId || null,
    chapterId || null,
    grossCents,
    platformFee,
    creatorShare,
    source,
    availableAt
  );

  return {
    id: result.lastInsertRowid,
    platformFee,
    creatorShare,
    availableAt,
  };
}

/** Promote pending → available when dispute window passed. */
function refreshEarningAvailability(db, creatorId = null) {
  if (creatorId) {
    db.prepare(`
      UPDATE creator_earnings
      SET status = 'available'
      WHERE creator_id = ? AND status = 'pending'
        AND available_at IS NOT NULL
        AND available_at <= datetime('now')
    `).run(creatorId);
  } else {
    db.prepare(`
      UPDATE creator_earnings
      SET status = 'available'
      WHERE status = 'pending'
        AND available_at IS NOT NULL
        AND available_at <= datetime('now')
    `).run();
  }
}

function getEarningsSummary(db, creatorId) {
  refreshEarningAvailability(db, creatorId);
  const rows = db.prepare(`
    SELECT status, COALESCE(SUM(creator_cents), 0) as total
    FROM creator_earnings
    WHERE creator_id = ?
    GROUP BY status
  `).all(creatorId);

  const summary = { pending: 0, available: 0, paid: 0, processing: 0 };
  for (const r of rows) {
    if (summary[r.status] !== undefined) summary[r.status] = r.total;
  }
  summary.payout_minimum_cents = PAYOUT_MIN_CENTS;
  summary.dispute_window_days = DISPUTE_WINDOW_DAYS;
  summary.can_payout = summary.available >= PAYOUT_MIN_CENTS;
  return summary;
}

function unlockChapterWithCredits(db, userId, chapterId) {
  const chapter = db.prepare(`
    SELECT ch.*, c.user_id as creator_id, c.status as comic_status, c.title as comic_title
    FROM chapters ch
    JOIN comics c ON c.id = ch.comic_id
    WHERE ch.id = ?
  `).get(chapterId);

  if (!chapter) throw new Error('Chapter not found');
  // New purchases only while published; owners can always test
  if (chapter.comic_status !== 'published' && Number(chapter.creator_id) !== Number(userId)) {
    throw new Error('Chapter not available for purchase');
  }
  if (Number(chapter.creator_id) === Number(userId)) {
    return { free: true, message: 'You own this story' };
  }

  const price = chapter.price_cents || 0;
  if (price <= 0) {
    return { free: true, message: 'Chapter is free' };
  }

  const already = db.prepare(`
    SELECT 1 FROM chapter_unlocks WHERE user_id = ? AND chapter_id = ?
  `).get(userId, chapterId);
  if (already) return { already: true };

  const full = db.prepare(`
    SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
  `).get(userId, chapter.comic_id);
  if (full) return { already: true, via_full_purchase: true };

  const run = db.transaction(() => {
    applyCreditDelta(db, userId, -price, 'unlock', {
      comic_id: chapter.comic_id,
      chapter_id: chapterId,
      note: `Unlock chapter: ${chapter.title}`,
    });

    db.prepare(`
      INSERT INTO chapter_unlocks (user_id, comic_id, chapter_id, price_cents)
      VALUES (?, ?, ?, ?)
    `).run(userId, chapter.comic_id, chapterId, price);

    const earning = recordCreatorEarning(db, {
      creatorId: chapter.creator_id,
      buyerId: userId,
      comicId: chapter.comic_id,
      chapterId,
      grossCents: price,
      source: 'credits_chapter',
    });

    return {
      balance: getBalance(db, userId),
      price_cents: price,
      earning,
    };
  });

  return run();
}

function purchaseFullStoryWithCredits(db, userId, comicId) {
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic) throw new Error('Story not found');
  if (Number(comic.user_id) === Number(userId)) {
    return { free: true, message: 'You own this story' };
  }

  const price = comic.price_cents || 0;
  if (price <= 0) return { free: true, message: 'Story is free' };
  if (price < FULL_STORY_MIN_CENTS) {
    throw new Error(`Full story / bundle price must be at least $${(FULL_STORY_MIN_CENTS / 100).toFixed(2)}`);
  }

  const already = db.prepare(`
    SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
  `).get(userId, comicId);
  if (already) return { already: true };

  const run = db.transaction(() => {
    applyCreditDelta(db, userId, -price, 'unlock', {
      comic_id: comicId,
      note: `Full story unlock: ${comic.title}`,
    });

    db.prepare(`
      INSERT INTO purchases (user_id, comic_id, amount_paid_cents, stripe_payment_intent)
      VALUES (?, ?, ?, NULL)
    `).run(userId, comicId, price);

    // Unlock all chapters for convenience
    const chapters = db.prepare('SELECT id, price_cents FROM chapters WHERE comic_id = ?').all(comicId);
    for (const ch of chapters) {
      db.prepare(`
        INSERT OR IGNORE INTO chapter_unlocks (user_id, comic_id, chapter_id, price_cents)
        VALUES (?, ?, ?, ?)
      `).run(userId, comicId, ch.id, ch.price_cents || 0);
    }

    const earning = recordCreatorEarning(db, {
      creatorId: comic.user_id,
      buyerId: userId,
      comicId,
      grossCents: price,
      source: 'credits_full',
    });

    return {
      balance: getBalance(db, userId),
      price_cents: price,
      earning,
    };
  });

  return run();
}

function userHasChapterAccess(db, userId, chapterId) {
  if (!userId) return false;
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter) return false;
  if ((chapter.price_cents || 0) <= 0) return true;

  const comic = db.prepare('SELECT user_id, reviewed_by FROM comics WHERE id = ?').get(chapter.comic_id);
  if (!comic) return false;
  if (Number(comic.user_id) === Number(userId)) return true;
  if (comic.reviewed_by && Number(comic.reviewed_by) === Number(userId)) return true;

  const full = db.prepare(`
    SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
  `).get(userId, chapter.comic_id);
  if (full) return true;

  const unlock = db.prepare(`
    SELECT 1 FROM chapter_unlocks WHERE user_id = ? AND chapter_id = ?
  `).get(userId, chapterId);
  return !!unlock;
}

const PAYOUT_RETRY_LIMIT_MS = 24 * 60 * 60 * 1000;

const DEFINITE_STRIPE_FAILURES = new Set([
  'StripeInvalidRequestError',
  'StripeIdempotencyError',
  'StripeCardError',
  'StripePermissionError',
  'StripeAuthenticationError',
]);

function isDefiniteStripeFailure(err) {
  return !!(err && DEFINITE_STRIPE_FAILURES.has(err.type));
}

function payoutIdempotencyKey(creatorId, payoutId, earningIds) {
  // payoutId is part of the key so a new claim after a definite failure does not
  // reuse the key Stripe already answered. A retry of the same claim passes the
  // same payoutId, so the key and the request body stay the same.
  const raw = `${creatorId}:${payoutId}:${earningIds.join(',')}`;
  return 'payout-' + crypto.createHash('sha256').update(raw).digest('hex');
}

function payoutAgeMs(createdAt) {
  if (!createdAt) return 0;
  const text = String(createdAt);
  const iso = text.includes('T') ? text : text.replace(' ', 'T') + 'Z';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 0;
  return Date.now() - parsed;
}

function sortedEarningIds(rows) {
  return rows.map((row) => row.id).sort((a, b) => a - b);
}

function markEarningsPaid(db, earningIds, payoutId, transferId) {
  const placeholders = earningIds.map(() => '?').join(',');
  db.transaction(() => {
    if (transferId) {
      db.prepare(`
        UPDATE creator_payouts
        SET stripe_transfer_id = ?, status = 'completed'
        WHERE id = ?
      `).run(transferId, payoutId);
    } else {
      db.prepare(`UPDATE creator_payouts SET status = 'completed' WHERE id = ?`).run(payoutId);
    }
    db.prepare(`
      UPDATE creator_earnings
      SET status = 'paid', paid_at = datetime('now'), payout_id = ?
      WHERE id IN (${placeholders}) AND status = 'processing'
    `).run(payoutId, ...earningIds);
  })();
}

function releasePayoutClaim(db, payoutId, earningIds) {
  const placeholders = earningIds.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare(`
      UPDATE creator_earnings
      SET status = 'available', payout_id = NULL
      WHERE status = 'processing' AND payout_id = ? AND id IN (${placeholders})
    `).run(payoutId, ...earningIds);
    db.prepare(`
      UPDATE creator_payouts SET status = 'failed'
      WHERE id = ? AND stripe_transfer_id IS NULL
    `).run(payoutId);
  })();
}

function logPayoutNeedsReconcile(payoutId, creatorId, err) {
  const kind = (err && (err.type || err.code)) || 'error';
  console.error(
    `Payout ${payoutId} for creator ${creatorId} left in processing. Stripe result is unknown (${kind}). Manual reconcile is needed.`
  );
}

async function findTransferForPayout(stripe, creatorId, payoutId) {
  const payoutIdStr = String(payoutId);
  const creatorStr = String(creatorId);
  const matches = (transfer) => transfer
    && transfer.metadata
    && String(transfer.metadata.payout_id) === payoutIdStr
    && String(transfer.metadata.creator_id) === creatorStr;

  if (stripe.transfers && typeof stripe.transfers.search === 'function') {
    const result = await stripe.transfers.search({
      query: `metadata['payout_id']:'${payoutIdStr}' AND metadata['creator_id']:'${creatorStr}'`,
      limit: 5,
    });
    return (result.data || []).find(matches) || null;
  }
  if (stripe.transfers && typeof stripe.transfers.list === 'function') {
    const result = await stripe.transfers.list({ limit: 100 });
    return (result.data || []).find(matches) || null;
  }
  throw new Error('Stripe client cannot list transfers');
}

function listStuckPayouts(db) {
  const payouts = db.prepare(`
    SELECT id, creator_id, amount_cents, stripe_transfer_id, status, created_at
    FROM creator_payouts
    WHERE status = 'pending'
      AND stripe_transfer_id IS NULL
      AND created_at <= datetime('now', '-24 hours')
    ORDER BY id ASC
  `).all();
  const earnings = db.prepare(`
    SELECT e.id, e.creator_id, e.creator_cents, e.payout_id, e.status, e.created_at
    FROM creator_earnings e
    LEFT JOIN creator_payouts p ON p.id = e.payout_id
    WHERE e.status = 'processing'
      AND (
        e.payout_id IS NULL
        OR (
          p.status = 'pending'
          AND p.stripe_transfer_id IS NULL
          AND p.created_at <= datetime('now', '-24 hours')
        )
      )
    ORDER BY e.id ASC
  `).all();
  return { payouts, earnings };
}

async function reconcileStuckPayout(db, stripe, payoutId) {
  if (!stripe) throw new Error('Payments not configured');
  const payout = db.prepare('SELECT * FROM creator_payouts WHERE id = ?').get(payoutId);
  if (!payout) throw new Error('Payout not found');
  if (payout.status !== 'pending' || payout.stripe_transfer_id) {
    throw new Error('Payout is not a pending unpaid claim');
  }
  if (payoutAgeMs(payout.created_at) < PAYOUT_RETRY_LIMIT_MS) {
    throw new Error('Payout is newer than 24 hours. Leave it in processing until the Stripe result is known.');
  }

  const earnings = db.prepare(`
    SELECT id FROM creator_earnings
    WHERE payout_id = ? AND status = 'processing'
    ORDER BY id ASC
  `).all(payoutId);
  const earningIds = sortedEarningIds(earnings);
  const existing = await findTransferForPayout(stripe, payout.creator_id, payout.id);
  if (existing) {
    if (earningIds.length) markEarningsPaid(db, earningIds, payout.id, existing.id);
    else {
      db.prepare(`
        UPDATE creator_payouts
        SET stripe_transfer_id = ?, status = 'completed'
        WHERE id = ? AND stripe_transfer_id IS NULL
      `).run(existing.id, payout.id);
    }
    return { action: 'paid', payout_id: payout.id, transfer_id: existing.id, earnings: earningIds.length };
  }

  if (earningIds.length) releasePayoutClaim(db, payout.id, earningIds);
  else {
    db.prepare(`
      UPDATE creator_payouts SET status = 'failed'
      WHERE id = ? AND stripe_transfer_id IS NULL
    `).run(payout.id);
  }
  return { action: 'released', payout_id: payout.id, earnings: earningIds.length };
}

async function requestPayout(db, stripe, creatorId) {
  if (!stripe) throw new Error('Payments not configured');

  refreshEarningAvailability(db, creatorId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(creatorId);
  if (!user?.stripe_account_id) {
    throw new Error('Connect your Stripe account for payouts first');
  }

  const processing = db.prepare(`
    SELECT id, creator_cents, payout_id FROM creator_earnings
    WHERE creator_id = ? AND status = 'processing'
    ORDER BY id ASC
  `).all(creatorId);

  let earningIds;
  let total;
  let payoutId;
  let claimedNow = false;

  if (processing.length) {
    earningIds = sortedEarningIds(processing);
    total = processing.reduce((sum, row) => sum + row.creator_cents, 0);
    const payoutIds = [...new Set(processing.map((row) => row.payout_id).filter((id) => id != null))];
    if (payoutIds.length !== 1) {
      throw new Error('A payout is already in progress but its record is inconsistent. Check Stripe before retrying.');
    }
    payoutId = payoutIds[0];
    const payout = db.prepare('SELECT * FROM creator_payouts WHERE id = ?').get(payoutId);
    if (!payout) {
      throw new Error('A payout is already in progress but its record is missing. Check Stripe before retrying.');
    }
    if (payout.stripe_transfer_id) {
      markEarningsPaid(db, earningIds, payoutId);
      return {
        already: true,
        payout_id: payoutId,
        amount_cents: payout.amount_cents,
        transfer_id: payout.stripe_transfer_id,
      };
    }
    if (payoutAgeMs(payout.created_at) >= PAYOUT_RETRY_LIMIT_MS) {
      throw new Error('A payout has been processing for more than 24 hours. Reconcile it before retrying so it is not paid twice.');
    }
  } else {
    const available = db.prepare(`
      SELECT id, creator_cents FROM creator_earnings
      WHERE creator_id = ? AND status = 'available'
      ORDER BY id ASC
    `).all(creatorId);

    total = available.reduce((sum, row) => sum + row.creator_cents, 0);
    if (total < PAYOUT_MIN_CENTS) {
      throw new Error(`Payout requires at least $${(PAYOUT_MIN_CENTS / 100).toFixed(2)} available after the ${DISPUTE_WINDOW_DAYS}-day waiting period`);
    }
    earningIds = sortedEarningIds(available);
    payoutId = db.transaction(() => {
      const payout = db.prepare(`
        INSERT INTO creator_payouts (creator_id, amount_cents, stripe_transfer_id, status)
        VALUES (?, ?, NULL, 'pending')
      `).run(creatorId, total);
      const newPayoutId = Number(payout.lastInsertRowid);
      const placeholders = earningIds.map(() => '?').join(',');
      const updated = db.prepare(`
        UPDATE creator_earnings
        SET status = 'processing', payout_id = ?
        WHERE creator_id = ? AND status = 'available' AND id IN (${placeholders})
      `).run(newPayoutId, creatorId, ...earningIds);
      if (updated.changes !== earningIds.length) {
        throw new Error('Payout rows changed; try again');
      }
      return newPayoutId;
    })();
    claimedNow = true;
  }

  // Same claim, same payout row: look up a transfer already stored under this
  // payout id before creating another one. Read only.
  if (!claimedNow) {
    try {
      const existing = await findTransferForPayout(stripe, creatorId, payoutId);
      if (existing) {
        markEarningsPaid(db, earningIds, payoutId, existing.id);
        return {
          already: true,
          payout_id: payoutId,
          amount_cents: total,
          transfer_id: existing.id,
        };
      }
    } catch (err) {
      logPayoutNeedsReconcile(payoutId, creatorId, err);
      throw err;
    }
  }

  const idempotencyKey = payoutIdempotencyKey(creatorId, payoutId, earningIds);
  const transferParams = {
    amount: total,
    currency: 'usd',
    destination: user.stripe_account_id,
    metadata: {
      creator_id: String(creatorId),
      payout_id: String(payoutId),
    },
  };
  let transfer;
  try {
    transfer = await stripe.transfers.create(transferParams, { idempotencyKey });
  } catch (err) {
    if (isDefiniteStripeFailure(err)) {
      // This request did not create a transfer. Idempotency mismatches can still
      // mean an earlier request with this payout id did, so check before releasing.
      if (err.type === 'StripeIdempotencyError') {
        try {
          const existing = await findTransferForPayout(stripe, creatorId, payoutId);
          if (existing) {
            markEarningsPaid(db, earningIds, payoutId, existing.id);
            return {
              already: true,
              payout_id: payoutId,
              amount_cents: total,
              transfer_id: existing.id,
            };
          }
        } catch (lookupErr) {
          logPayoutNeedsReconcile(payoutId, creatorId, lookupErr);
          throw err;
        }
      }
      releasePayoutClaim(db, payoutId, earningIds);
    } else {
      logPayoutNeedsReconcile(payoutId, creatorId, err);
    }
    throw err;
  }

  markEarningsPaid(db, earningIds, payoutId, transfer.id);
  return { payout_id: payoutId, amount_cents: total, transfer_id: transfer.id };
}

module.exports = {
  CREDIT_MIN_TOPUP_CENTS,
  CREDIT_BONUS_THRESHOLD_CENTS,
  CREDIT_BONUS_RATE,
  FULL_STORY_MIN_CENTS,
  PAYOUT_MIN_CENTS,
  DISPUTE_WINDOW_DAYS,
  CREDIT_PACKAGES,
  creditsGrantedForTopup,
  packageInfo,
  initCreditSchema,
  getBalance,
  getPlatformRate,
  splitSale,
  applyCreditDelta,
  grantTopup,
  recordCreatorEarning,
  refreshEarningAvailability,
  getEarningsSummary,
  unlockChapterWithCredits,
  purchaseFullStoryWithCredits,
  fulfillFullStoryPurchase,
  reverseStripePayment,
  userHasChapterAccess,
  requestPayout,
  listStuckPayouts,
  reconcileStuckPayout,
  availableAtIso,
};
