/**
 * Optional offline copy of a purchased story.
 * The generated file is self-contained and must not include site secrets,
 * other buyers, or admin notes.
 */

const fs = require('fs');
const path = require('path');
const credits = require('./credits');

const OFFLINE_DOWNLOAD_ACK = 'Buyers keep this copy permanently, even after refunds or if you remove the story. Turning this off later does not remove copies already downloaded.';

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const OFFLINE_IMAGE_BYTE_LIMIT = 40 * 1024 * 1024;

function offlineImageTooLargeMessage(limitBytes) {
  const bytes = Number.isFinite(Number(limitBytes)) && Number(limitBytes) >= 0
    ? Number(limitBytes)
    : OFFLINE_IMAGE_BYTE_LIMIT;
  const mb = bytes / (1024 * 1024);
  const label = mb >= 1 && mb === Math.round(mb)
    ? Math.round(mb) + ' MB'
    : bytes + ' bytes';
  return "This story's images are too large for an offline copy. The limit is " + label + '.';
}

function imageTooLargeError(limitBytes) {
  const err = new Error(offlineImageTooLargeMessage(limitBytes));
  err.status = 413;
  return err;
}

function ensureAllowDownloadColumn(db) {
  const cols = db.prepare('PRAGMA table_info(comics)').all();
  if (cols.some((col) => col.name === 'allow_download')) return false;
  db.exec('ALTER TABLE comics ADD COLUMN allow_download INTEGER NOT NULL DEFAULT 0');
  return true;
}

function parseAllowDownloadFlag(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
}

function applyAllowDownloadChange(currentValue, requested, acknowledged) {
  const next = parseAllowDownloadFlag(requested);
  if (next === null) return { changed: false };
  const current = currentValue ? 1 : 0;
  if (next === 1 && current === 0 && acknowledged !== true) {
    const err = new Error('Acknowledge that buyers keep offline copies permanently before enabling downloads.');
    err.status = 400;
    throw err;
  }
  return { changed: true, value: next };
}

function offlineCopyIncluded(comic) {
  if (!comic || !comic.allow_download) return false;
  const cents = Number(comic.price_cents);
  return Number.isFinite(cents) && cents >= credits.FULL_STORY_MIN_CENTS;
}

function decideOfflineAccess({ comic, user, hasFullPurchase }) {
  if (!user) return { ok: false, status: 401, error: 'Sign in required' };
  if (!comic) return { ok: false, status: 404, error: 'Story not found' };
  if (!comic.allow_download) {
    return { ok: false, status: 403, error: 'Offline download is not enabled for this story' };
  }
  const isCreator = Number(user.id) === Number(comic.user_id);
  const isAdmin = user.role === 'admin';
  if (!isCreator && !isAdmin && !hasFullPurchase) {
    return { ok: false, status: 403, error: 'Purchase this story to download an offline copy' };
  }
  return { ok: true };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function safeFilename(title, id) {
  const slug = String(title || 'story')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const numericId = Number(id);
  return (slug || 'story') + '-' + (Number.isFinite(numericId) ? numericId : 'story') + '.html';
}

function localComicImagePath(imagePath, uploadsRoot) {
  if (!imagePath || typeof imagePath !== 'string' || !uploadsRoot) return null;
  let pathname = imagePath;
  if (/^https?:\/\//i.test(imagePath)) {
    try {
      pathname = new URL(imagePath).pathname;
    } catch (err) {
      return null;
    }
  }
  pathname = pathname.split('?')[0].split('#')[0];
  const marker = '/uploads/comics/';
  const idx = pathname.indexOf(marker);
  if (idx === -1) return null;
  const rel = pathname.slice(idx + marker.length);
  if (!rel || rel.includes('\0')) return null;
  const root = path.resolve(uploadsRoot);
  const full = path.resolve(root, rel);
  const fromRoot = path.relative(root, full);
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return null;
  return full;
}

function realPathStaysInside(rootReal, fileReal) {
  if (!rootReal || !fileReal) return false;
  const rel = path.relative(rootReal, fileReal);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (process.platform === 'win32') {
    const root = String(rootReal).toLowerCase();
    const file = String(fileReal).toLowerCase();
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (file !== root && !file.startsWith(prefix)) return false;
  }
  return true;
}

async function locateComicImage(imagePath, uploadsRoot) {
  const full = localComicImagePath(imagePath, uploadsRoot);
  if (!full) return null;
  const mime = IMAGE_MIME[path.extname(full).toLowerCase()];
  if (!mime) return null;
  let rootReal;
  let fileReal;
  try {
    rootReal = await fs.promises.realpath(path.resolve(uploadsRoot));
    fileReal = await fs.promises.realpath(full);
  } catch (err) {
    return null;
  }
  if (!realPathStaysInside(rootReal, fileReal)) return null;
  return { full: fileReal, mime, key: fileReal };
}

function createImageEmbedder(uploadsRoot, maxBytes) {
  const limit = Number.isFinite(Number(maxBytes)) && Number(maxBytes) >= 0
    ? Number(maxBytes)
    : OFFLINE_IMAGE_BYTE_LIMIT;
  const byKey = new Map();
  const images = {};
  let total = 0;
  let nextId = 0;

  async function embed(imagePath) {
    const located = await locateComicImage(imagePath, uploadsRoot);
    if (!located) return null;
    if (byKey.has(located.key)) return byKey.get(located.key);
    let buf;
    try {
      const stat = await fs.promises.stat(located.full);
      if (!stat.isFile() || stat.size <= 0) return null;
      if (total + stat.size > limit) throw imageTooLargeError(limit);
      buf = await fs.promises.readFile(located.full);
    } catch (err) {
      if (err && err.status === 413) throw err;
      return null;
    }
    if (!buf || !buf.length) return null;
    if (total + buf.length > limit) throw imageTooLargeError(limit);
    total += buf.length;
    const id = String(nextId);
    nextId += 1;
    images[id] = 'data:' + located.mime + ';base64,' + buf.toString('base64');
    byKey.set(located.key, id);
    return id;
  }

  return { embed, images };
}

// Path depth, not the panel's upload order. Opening panel is 1; back and restart follow history.
function readerPathLabel(visitedCount) {
  var n = Number(visitedCount);
  if (!(n >= 1)) n = 1;
  return 'Panel ' + Math.floor(n);
}

function buyerLabel(user) {
  const name = String((user && user.username) || '').trim();
  return (name || 'reader').slice(0, 80);
}

async function loadOfflinePayload(db, comic, uploadsRoot, maxImageBytes) {
  const authorRow = db.prepare('SELECT username FROM users WHERE id = ?').get(comic.user_id);
  const pages = db.prepare(`
    SELECT id, title, text_content, image_path, is_start
    FROM pages WHERE comic_id = ? ORDER BY id ASC
  `).all(comic.id);
  const choices = db.prepare(`
    SELECT ch.from_page_id, ch.choice_text, ch.to_page_id, ch.choice_image
    FROM choices ch
    JOIN pages p ON p.id = ch.from_page_id
    WHERE p.comic_id = ?
    ORDER BY ch.id ASC
  `).all(comic.id);
  const embedder = createImageEmbedder(uploadsRoot, maxImageBytes);
  const byPage = new Map();
  pages.forEach((page) => byPage.set(page.id, []));
  for (const choice of choices) {
    const list = byPage.get(choice.from_page_id);
    if (!list) continue;
    list.push({
      text: choice.choice_text || '',
      to: choice.to_page_id,
      image: await embedder.embed(choice.choice_image),
    });
  }
  const outPages = [];
  for (const page of pages) {
    outPages.push({
      id: page.id,
      title: page.title || '',
      text: page.text_content || '',
      image: await embedder.embed(page.image_path),
      is_start: page.is_start ? 1 : 0,
      choices: byPage.get(page.id) || [],
    });
  }
  return {
    id: comic.id,
    title: comic.title || 'Untitled',
    author: (authorRow && authorRow.username) || '',
    images: embedder.images,
    pages: outPages,
  };
}

const READER_JS = [
  '(function () {',
  readerPathLabel.toString(),
  '  var raw = document.getElementById("pyp-story").textContent;',
  '  var data = JSON.parse(raw);',
  '  var pages = data.pages || [];',
  '  var byId = {};',
  '  for (var i = 0; i < pages.length; i++) byId[String(pages[i].id)] = pages[i];',
  '  var key = "pyp-offline-" + String(data.id);',
  '  var history = [];',
  '  var current = null;',
  '  function startPage() {',
  '    for (var i = 0; i < pages.length; i++) if (pages[i].is_start) return pages[i];',
  '    return pages[0] || null;',
  '  }',
  '  function loadSaved() {',
  '    try {',
  '      var saved = JSON.parse(localStorage.getItem(key) || "null");',
  '      if (!saved || saved.pageId == null) return null;',
  '      var page = byId[String(saved.pageId)];',
  '      if (!page) return null;',
  '      var hist = [];',
  '      var list = saved.history || [];',
  '      for (var i = 0; i < list.length; i++) if (byId[String(list[i])]) hist.push(String(list[i]));',
  '      history = hist;',
  '      return page;',
  '    } catch (e) { return null; }',
  '  }',
  '  function persist() {',
  '    try {',
  '      localStorage.setItem(key, JSON.stringify({ pageId: current ? current.id : null, history: history }));',
  '    } catch (e) {}',
  '  }',
  '  function lookupImage(ref) {',
  '    if (ref == null || ref === "") return "";',
  '    var src = String(ref);',
  '    if (data.images && Object.prototype.hasOwnProperty.call(data.images, src)) {',
  '      src = String(data.images[src] || "");',
  '    }',
  '    return src.indexOf("data:image/") === 0 ? src : "";',
  '  }',
  '  function showImage(ref) {',
  '    var img = document.getElementById("pic");',
  '    var src = lookupImage(ref);',
  '    if (src) { img.src = src; img.hidden = false; }',
  '    else { img.removeAttribute("src"); img.hidden = true; }',
  '  }',
  '  function render(page) {',
  '    current = page;',
  '    document.getElementById("title").textContent = data.title || "Story";',
  '    document.getElementById("by").textContent = data.author ? ("by " + data.author) : "";',
  '    document.getElementById("progress").textContent = page ? readerPathLabel(history.length + 1) : "";',
  '    document.getElementById("page-title").textContent = page && page.title ? page.title : "";',
  '    document.getElementById("text").textContent = page ? (page.text || "") : "This story has no pages.";',
  '    showImage(page && page.image);',
  '    var box = document.getElementById("choices");',
  '    while (box.firstChild) box.removeChild(box.firstChild);',
  '    var nav = document.createElement("div");',
  '    if (history.length) {',
  '      var back = document.createElement("button");',
  '      back.type = "button"; back.className = "minor"; back.textContent = "Back";',
  '      back.onclick = function () {',
  '        var prev = byId[String(history.pop())];',
  '        if (prev) render(prev);',
  '      };',
  '      nav.appendChild(back);',
  '    }',
  '    var restart = document.createElement("button");',
  '    restart.type = "button"; restart.className = "minor"; restart.textContent = "Start over";',
  '    restart.onclick = function () { history = []; var s = startPage(); if (s) render(s); };',
  '    nav.appendChild(restart);',
  '    box.appendChild(nav);',
  '    var choices = (page && page.choices) || [];',
  '    if (page && !choices.length) {',
  '      var end = document.createElement("p"); end.textContent = "— The End —"; box.appendChild(end);',
  '    }',
  '    for (var c = 0; c < choices.length; c++) {',
  '      (function (choice) {',
  '        var btn = document.createElement("button"); btn.type = "button";',
  '        var choiceSrc = lookupImage(choice.image);',
  '        if (choiceSrc) {',
  '          var im = document.createElement("img"); im.alt = ""; im.src = choiceSrc; im.className = "choice-img"; btn.appendChild(im);',
  '        }',
  '        var span = document.createElement("span"); span.textContent = choice.text || "\\u2192"; btn.appendChild(span);',
  '        btn.onclick = function () {',
  '          var next = byId[String(choice.to)];',
  '          if (!next || !current) return;',
  '          history.push(String(current.id));',
  '          render(next);',
  '        };',
  '        box.appendChild(btn);',
  '      })(choices[c]);',
  '    }',
  '    persist();',
  '  }',
  '  var initial = loadSaved() || startPage();',
  '  render(initial);',
  '})();',
].join('\n');

const CSS = [
  'body{margin:0;background:#020617;color:#e2e8f0;font-family:system-ui,sans-serif}',
  'main{max-width:40rem;margin:0 auto;padding:1.25rem}',
  'h1{font-size:1.4rem;margin:0}',
  '#by,#progress,#page-title{color:#94a3b8;font-size:.9rem}',
  '#pic{max-width:100%;height:auto;margin:1rem 0;border-radius:12px}',
  '#text{white-space:pre-wrap;line-height:1.55}',
  'button{display:block;width:100%;text-align:left;margin:.5rem 0;padding:.7rem .9rem;border-radius:12px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font:inherit;cursor:pointer}',
  'button.minor{width:auto;display:inline-block;margin-right:.5rem}',
  '.choice-img{height:3rem;width:4.5rem;object-fit:cover;border-radius:8px;margin-right:.6rem;vertical-align:middle}',
  'footer.stamp{margin-top:2.5rem;text-align:center;font-size:11px;color:#94a3b8;opacity:.4}',
].join('');

function buildOfflineHtml(payload, buyerName) {
  const title = escapeHtml(payload.title || 'Story');
  const buyer = escapeHtml(buyerName || 'reader');
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + title + '</title><style>' + CSS + '</style></head><body><main>'
    + '<h1 id="title"></h1><p id="by"></p><p id="page-title"></p><p id="progress"></p>'
    + '<img id="pic" alt="" hidden>'
    + '<p id="text"></p><div id="choices"></div>'
    + '<footer class="stamp">Copy for ' + buyer + '</footer>'
    + '</main><script type="application/json" id="pyp-story">' + safeJson(payload) + '</script>'
    + '<script>' + READER_JS + '</script></body></html>';
}

async function renderOfflineDownload(db, options) {
  const user = options && options.user;
  const comicId = options && options.comicId;
  const uploadsRoot = options && options.uploadsRoot;
  const maxImageBytes = options && options.maxImageBytes;
  const id = Number(comicId);
  const comic = Number.isInteger(id)
    ? db.prepare(`
        SELECT id, user_id, title, description, allow_download
        FROM comics WHERE id = ?
      `).get(id)
    : null;
  const hasFullPurchase = !!(user && comic && db.prepare(`
    SELECT 1 FROM purchases WHERE user_id = ? AND comic_id = ?
  `).get(user.id, comic.id));
  const decision = decideOfflineAccess({ comic, user, hasFullPurchase });
  if (!decision.ok) return decision;
  let payload;
  try {
    payload = await loadOfflinePayload(db, comic, uploadsRoot, maxImageBytes);
  } catch (err) {
    if (err && err.status === 413) return { ok: false, status: 413, error: err.message };
    throw err;
  }
  const name = buyerLabel(user);
  return {
    ok: true,
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + safeFilename(comic.title, comic.id) + '"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: buildOfflineHtml(payload, name),
  };
}

module.exports = {
  OFFLINE_DOWNLOAD_ACK,
  OFFLINE_IMAGE_BYTE_LIMIT,
  offlineImageTooLargeMessage,
  ensureAllowDownloadColumn,
  parseAllowDownloadFlag,
  applyAllowDownloadChange,
  decideOfflineAccess,
  offlineCopyIncluded,
  escapeHtml,
  safeJson,
  buildOfflineHtml,
  readerPathLabel,
  renderOfflineDownload,
  localComicImagePath,
};
