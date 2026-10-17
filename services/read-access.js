/**
 * Server-side story reading access.
 * Free published stories, buyers, creators, admins, and reviewers can read
 * every page. Everyone else on a published paid story gets the sample only:
 * the start page plus the pages its choices point at. Unpublished page
 * bodies stay off the public sample.
 */

function isFreeComic(comic) {
  if (!comic) return false;
  const cents = Number(comic.price_cents);
  if (!Number.isFinite(cents)) return true;
  return cents <= 0;
}

function findStartPage(pages) {
  const pageList = (Array.isArray(pages) ? pages : []).slice()
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (!pageList.length) return null;
  return pageList.find((page) => Number(page.is_start)) || pageList[0];
}

function samplePageIdSet(pages, choices) {
  const list = Array.isArray(pages) ? pages : [];
  const start = findStartPage(list);
  if (!start) return new Set();
  const known = new Set(list.map((page) => Number(page.id)));
  const sample = new Set([Number(start.id)]);
  (Array.isArray(choices) ? choices : []).forEach((choice) => {
    if (Number(choice.from_page_id) !== Number(start.id)) return;
    const target = Number(choice.to_page_id);
    if (!Number.isFinite(target) || target === Number(start.id)) return;
    if (!known.has(target)) return;
    sample.add(target);
  });
  return sample;
}

function choicePayload(choice, allowTarget) {
  const text = choice.choice_text != null
    ? choice.choice_text
    : (choice.text != null ? choice.text : '');
  if (!allowTarget) {
    return { id: choice.id, text: text, locked: true };
  }
  return {
    id: choice.id,
    text: text,
    to_page_id: choice.to_page_id,
    image: choice.choice_image || choice.image || null,
  };
}

function filterPages(pages, choices, options) {
  const full = !!(options && options.full);
  const list = Array.isArray(pages) ? pages : [];
  const rows = Array.isArray(choices) ? choices : [];
  const sample = samplePageIdSet(list, rows);
  const visible = full ? list.slice() : list.filter((page) => sample.has(Number(page.id)));
  const byPage = new Map();
  visible.forEach((page) => byPage.set(Number(page.id), []));
  rows.forEach((choice) => {
    const from = Number(choice.from_page_id);
    if (!byPage.has(from)) return;
    const target = Number(choice.to_page_id);
    const allowTarget = full || sample.has(target);
    byPage.get(from).push(choicePayload(choice, allowTarget));
  });
  return visible.map((page) => Object.assign({}, page, {
    choices: byPage.get(Number(page.id)) || [],
  }));
}

/**
 * user: { id, role } or null.
 * access: { purchased, allPaidChaptersUnlocked } from purchases and chapter_unlocks.
 * A single chapter unlock is not enough. A free price does not publish a draft.
 */
function canReadFull(user, comic, access) {
  if (!comic) return false;
  const flags = access || {};
  if (user && Number(user.id) === Number(comic.user_id)) return true;
  if (user && (user.role === 'admin' || user.role === 'editor')) return true;
  if (user && comic.reviewed_by != null && Number(user.id) === Number(comic.reviewed_by)) return true;
  if (flags.purchased) return true;
  if (flags.allPaidChaptersUnlocked) return true;
  if (comic.status === 'published' && isFreeComic(comic)) return true;
  return false;
}

function loadComic(db, comicId) {
  const id = Number(comicId);
  if (!Number.isInteger(id)) return null;
  return db.prepare(`
    SELECT id, user_id, reviewed_by, status, price_cents
    FROM comics WHERE id = ?
  `).get(id) || null;
}

function loadPurchaseFlags(db, userId, comicId) {
  const flags = { purchased: false, allPaidChaptersUnlocked: false };
  if (userId == null || comicId == null) return flags;
  try {
    flags.purchased = !!db.prepare(`
      SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
    `).get(userId, comicId);
  } catch (err) {
    flags.purchased = false;
  }
  try {
    const paid = db.prepare(`
      SELECT id FROM chapters WHERE comic_id = ? AND price_cents > 0
    `).all(comicId);
    if (paid.length > 0) {
      const unlocked = db.prepare(`
        SELECT COUNT(*) as c FROM chapter_unlocks
        WHERE user_id = ? AND comic_id = ? AND chapter_id IN (
          SELECT id FROM chapters WHERE comic_id = ? AND price_cents > 0
        )
      `).get(userId, comicId, comicId);
      flags.allPaidChaptersUnlocked = !!(unlocked && unlocked.c >= paid.length);
    }
  } catch (err) {
    flags.allPaidChaptersUnlocked = false;
  }
  return flags;
}

function loadPagesAndChoices(db, comicId) {
  const pages = db.prepare(`
    SELECT * FROM pages WHERE comic_id = ? ORDER BY id ASC
  `).all(comicId);
  const choices = db.prepare(`
    SELECT ch.*
    FROM choices ch
    JOIN pages p ON p.id = ch.from_page_id
    WHERE p.comic_id = ?
    ORDER BY ch.id ASC
  `).all(comicId);
  return { pages, choices };
}

function readDecision(db, user, comic) {
  const flags = loadPurchaseFlags(db, user && user.id, comic.id);
  return {
    flags,
    full: canReadFull(user, comic, flags),
  };
}

function denyUnlessPublishedOrFull(res, comic, full) {
  if (full || comic.status === 'published') return false;
  res.status(403).json({ error: 'Not available' });
  return true;
}

function handleComicPages(req, res, ctx) {
  const comic = loadComic(ctx.db, req.params.id);
  if (!comic) return res.status(404).json({ error: 'Story not found' });
  const decision = readDecision(ctx.db, ctx.user, comic);
  if (denyUnlessPublishedOrFull(res, comic, decision.full)) return;
  const loaded = loadPagesAndChoices(ctx.db, comic.id);
  res.set('Cache-Control', 'private, no-store');
  res.json({ pages: filterPages(loaded.pages, loaded.choices, { full: decision.full }) });
}

function handleStartPage(req, res, ctx) {
  const comic = loadComic(ctx.db, req.params.id);
  if (!comic) return res.status(404).json({ error: 'Story not found' });
  const decision = readDecision(ctx.db, ctx.user, comic);
  if (denyUnlessPublishedOrFull(res, comic, decision.full)) return;
  const loaded = loadPagesAndChoices(ctx.db, comic.id);
  const visible = filterPages(loaded.pages, loaded.choices, { full: decision.full });
  const start = findStartPage(visible);
  if (!start) return res.status(404).json({ error: 'No pages yet' });
  res.set('Cache-Control', 'private, no-store');
  res.json(start);
}

function handlePageById(req, res, ctx) {
  const pageId = Number(req.params.id);
  if (!Number.isInteger(pageId)) return res.status(404).json({ error: 'Page not found' });
  const page = ctx.db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const comic = loadComic(ctx.db, page.comic_id);
  if (!comic) return res.status(404).json({ error: 'Page not found' });
  const decision = readDecision(ctx.db, ctx.user, comic);
  if (denyUnlessPublishedOrFull(res, comic, decision.full)) return;
  const loaded = loadPagesAndChoices(ctx.db, comic.id);
  const visible = filterPages(loaded.pages, loaded.choices, { full: decision.full })
    .find((row) => Number(row.id) === pageId);
  if (!visible) {
    return res.status(403).json({ error: 'Unlock this story to read this page.' });
  }
  res.set('Cache-Control', 'private, no-store');
  res.json(visible);
}

module.exports = {
  isFreeComic,
  findStartPage,
  samplePageIdSet,
  filterPages,
  canReadFull,
  loadComic,
  loadPurchaseFlags,
  loadPagesAndChoices,
  handleComicPages,
  handleStartPage,
  handlePageById,
};
