/**
 * Credits wallet: 1 credit = $0.01 (1 cent).
 * Stripe is used only for top-ups; chapter/story spends are internal ledger moves.
 */

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
  `);
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
  if (next < 0) throw new Error('Insufficient credits');

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

  // Idempotent: same payment intent only once
  if (paymentIntent) {
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

  const balance = applyCreditDelta(db, userId, info.credits_granted, 'topup', {
    stripe_payment_intent: paymentIntent || null,
    note,
  });

  return { already: false, balance, ...info };
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

  const summary = { pending: 0, available: 0, paid: 0 };
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
  if (chapter.comic_status !== 'published' && Number(chapter.creator_id) !== Number(userId)) {
    throw new Error('Chapter not available');
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

async function requestPayout(db, stripe, creatorId) {
  if (!stripe) throw new Error('Payments not configured');

  refreshEarningAvailability(db, creatorId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(creatorId);
  if (!user?.stripe_account_id) {
    throw new Error('Connect your Stripe account for payouts first');
  }

  const available = db.prepare(`
    SELECT id, creator_cents FROM creator_earnings
    WHERE creator_id = ? AND status = 'available'
  `).all(creatorId);

  const total = available.reduce((s, r) => s + r.creator_cents, 0);
  if (total < PAYOUT_MIN_CENTS) {
    throw new Error(`Payout requires at least $${(PAYOUT_MIN_CENTS / 100).toFixed(2)} available after the ${DISPUTE_WINDOW_DAYS}-day waiting period`);
  }

  const transfer = await stripe.transfers.create({
    amount: total,
    currency: 'usd',
    destination: user.stripe_account_id,
    metadata: { creator_id: String(creatorId) },
  });

  const run = db.transaction(() => {
    const payout = db.prepare(`
      INSERT INTO creator_payouts (creator_id, amount_cents, stripe_transfer_id, status)
      VALUES (?, ?, ?, 'completed')
    `).run(creatorId, total, transfer.id);

    const payoutId = payout.lastInsertRowid;
    const ids = available.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE creator_earnings
      SET status = 'paid', paid_at = datetime('now'), payout_id = ?
      WHERE id IN (${placeholders})
    `).run(payoutId, ...ids);

    return { payout_id: payoutId, amount_cents: total, transfer_id: transfer.id };
  });

  return run();
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
  userHasChapterAccess,
  requestPayout,
  availableAtIso,
};
