/**
 * Crawlable public pages: story URLs, sitemap, homepage catalog, and 404s.
 * Does not load server.js or open data/cyoa.db by itself.
 */
const fs = require('fs');
const path = require('path');

const CANONICAL_ORIGIN = 'https://www.pypstories.com';
const ADSENSE_ACCOUNT = 'ca-pub-9811413201474824';
const CATALOG_MARKER = '<!--CATALOG-->';

const STATIC_SITEMAP_PATHS = [
  '/',
  '/how-it-works.html',
  '/privacy.html',
  '/terms.html',
  '/content-policy.html',
  '/contact.html',
];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function storySlug(title) {
  const slug = String(title || 'story')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'story';
}

function storyPath(id, title) {
  return '/story/' + Number(id) + '/' + storySlug(title);
}

function absoluteUrl(urlPath) {
  return CANONICAL_ORIGIN + urlPath;
}

function safeImageSrc(src) {
  const value = String(src || '').trim();
  if (value.startsWith('/uploads/comics/') && !value.includes('..')) return value;
  if (/^https:\/\//i.test(value)) return value;
  return '';
}

function plainText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!max || text.length <= max) return text;
  return text.slice(0, max - 1).trim() + '…';
}

function isSpaPath(pathname) {
  if (pathname === '/' || pathname === '/browse' || pathname === '/verify' || pathname === '/reset-password') {
    return true;
  }
  if (!pathname.startsWith('/search/')) return false;
  const rest = pathname.slice('/search/'.length);
  if (!rest || rest.includes('/')) return false;
  let name = rest;
  try {
    name = decodeURIComponent(rest);
  } catch (err) {
    return false;
  }
  return /^[A-Za-z0-9_-]{1,32}$/.test(name);
}

function listPublishedStories(db) {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.description, c.genre, c.cover_image,
           c.submitted_at, c.created_at, u.username AS author
    FROM comics c
    JOIN users u ON u.id = c.user_id
    WHERE c.status = 'published'
    ORDER BY datetime(COALESCE(c.submitted_at, c.created_at)) DESC, c.id DESC
  `).all();
  rows.forEach((row) => {
    if (!row.cover_image) {
      const first = db.prepare(`
        SELECT image_path FROM pages
        WHERE comic_id = ? AND image_path IS NOT NULL AND image_path != ''
        ORDER BY is_start DESC, id ASC
        LIMIT 1
      `).get(row.id);
      if (first && first.image_path) row.cover_image = first.image_path;
    }
  });
  return rows;
}

function getPublishedStory(db, id) {
  const story = db.prepare(`
    SELECT c.id, c.title, c.description, c.genre, c.cover_image, u.username AS author
    FROM comics c
    JOIN users u ON u.id = c.user_id
    WHERE c.id = ? AND c.status = 'published'
  `).get(id);
  if (!story) return null;
  if (!story.cover_image) {
    const first = db.prepare(`
      SELECT image_path FROM pages
      WHERE comic_id = ? AND image_path IS NOT NULL AND image_path != ''
      ORDER BY is_start DESC, id ASC
      LIMIT 1
    `).get(story.id);
    if (first && first.image_path) story.cover_image = first.image_path;
  }
  return story;
}

function siteFooter() {
  return `
  <footer class="border-t border-slate-800 mt-8 py-8 text-center text-xs sm:text-sm text-slate-500">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 space-y-2">
      <p class="text-slate-400 font-medium">Pick Your Path Stories · PYPStories.com</p>
      <p>Branching stories · Interactive comics · Webtoon-style paths · Digital books</p>
      <p class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <a href="/" class="text-slate-400 hover:text-blue-300 underline underline-offset-2">Home</a>
        <a href="/how-it-works.html" class="text-slate-400 hover:text-blue-300 underline underline-offset-2">How It Works</a>
        <a href="/privacy.html" class="text-slate-400 hover:text-blue-300 underline underline-offset-2">Privacy</a>
        <a href="/terms.html" class="text-slate-400 hover:text-blue-300 underline underline-offset-2">Terms</a>
        <a href="/content-policy.html" class="text-slate-400 hover:text-blue-300 underline underline-offset-2">Content Policy</a>
        <a href="/contact.html" class="text-slate-400 hover:text-blue-300 underline underline-offset-2">Contact</a>
      </p>
      <p class="text-slate-600">© ${new Date().getFullYear()} PYPStories. Read a path or create your own. Family-friendly interactive stories.</p>
    </div>
  </footer>`;
}

function siteNav() {
  return `
  <nav class="border-b border-slate-800 bg-slate-950">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
      <a href="/" class="font-semibold tracking-tight hover:text-white">← PYPStories</a>
      <div class="text-xs text-slate-500 flex gap-3">
        <a href="/how-it-works.html" class="hover:text-slate-300">How It Works</a>
        <a href="/contact.html" class="hover:text-slate-300">Contact</a>
      </div>
    </div>
  </nav>`;
}

function pageDocument(options) {
  const title = options.title;
  const description = options.description || '';
  const canonicalPath = options.canonicalPath || '/';
  const robots = options.robots || 'index, follow';
  const body = options.body || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(absoluteUrl(canonicalPath))}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/tailwind.css">
  <meta name="google-adsense-account" content="${ADSENSE_ACCOUNT}">
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .prose h2 { margin-top: 1.75rem; margin-bottom: 0.5rem; font-size: 1.125rem; font-weight: 600; color: #f1f5f9; }
    .prose p, .prose li { color: #94a3b8; font-size: 0.9375rem; line-height: 1.65; }
    .prose a { color: #60a5fa; text-decoration: underline; }
    .prose a.button-link { color: #0f172a; text-decoration: none; }
    .teaser-text { white-space: pre-line; }
    .teaser-image { position: relative; display: block; margin: 1rem 0; }
    .teaser-image img { display: block; width: 100%; height: auto; border-radius: 1rem; }
    .teaser-image::after {
      content: "PYPStories.com";
      position: absolute;
      right: 0.75rem;
      bottom: 0.6rem;
      font-size: 0.75rem;
      line-height: 1;
      color: rgba(255, 255, 255, 0.55);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
      pointer-events: none;
    }
    .teaser-choices { list-style: disc; padding-left: 1.25rem; }
  </style>
</head>
<body class="bg-slate-950 text-slate-200 min-h-screen">
  ${siteNav()}
  <main class="max-w-3xl mx-auto px-4 sm:px-6 py-10 prose">
    ${body}
  </main>
  ${siteFooter()}
</body>
</html>`;
}

function renderNotFound() {
  return pageDocument({
    title: 'Page not found · Pick Your Path Stories',
    description: 'That page is not on Pick Your Path Stories.',
    canonicalPath: '/',
    robots: 'noindex',
    body: `
    <h1 class="text-3xl font-semibold tracking-tighter text-slate-100 mb-3">Page not found</h1>
    <p>That address does not match a page on PYPStories. Browse the published branching stories on the home page, or use the links below.</p>
    <p><a href="/">Back to the home page</a></p>`,
  });
}

function renderCatalogCard(story) {
  const href = storyPath(story.id, story.title);
  const title = escapeHtml(story.title || 'Untitled');
  const author = escapeHtml(story.author || 'unknown');
  const genre = escapeHtml(story.genre || 'Story');
  const cover = safeImageSrc(story.cover_image);
  const image = cover
    ? `<img src="${escapeHtml(cover)}" alt="${title}" class="w-full h-full object-contain bg-slate-950">`
    : '<div class="h-full w-full flex items-center justify-center text-slate-500 text-sm">No cover</div>';
  return `<a class="comic-card bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden flex flex-col" href="${href}" data-comic-id="${Number(story.id)}">
    <div class="relative bg-slate-950" style="height:7rem;">${image}
      <div class="absolute top-3 right-3 text-[10px] px-2 py-0.5 bg-black/60 rounded-full">${genre}</div>
    </div>
    <div class="p-4 flex-1 flex flex-col">
      <div class="font-semibold text-lg leading-tight">${title}</div>
      <div class="text-xs text-slate-400 mt-1">by ${author}</div>
    </div>
  </a>`;
}

function renderCatalogHtml(stories) {
  if (!stories || !stories.length) {
    return '<p class="text-slate-400 col-span-full">No published stories yet.</p>';
  }
  return stories.map(renderCatalogCard).join('\n');
}

function renderHomeHtml(template, stories) {
  const cards = renderCatalogHtml(stories);
  if (!String(template).includes(CATALOG_MARKER)) return template;
  return template.replace(CATALOG_MARKER, cards);
}

function renderHomeFromFile(indexPath, stories) {
  const template = fs.readFileSync(indexPath, 'utf8');
  return renderHomeHtml(template, stories);
}

// Reader FREE_CHOICES is 1: the start page, then one chosen page. The landing
// page uses that same cap for paid and free stories.
const SAMPLE_CHOICE_LIMIT = 1;

function formatPageText(value) {
  return escapeHtml(value).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

function selectSamplePages(pages, choices) {
  const pageList = (Array.isArray(pages) ? pages : []).slice()
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (!pageList.length) return [];
  const start = pageList.find((page) => Number(page.is_start)) || pageList[0];
  const choiceRows = Array.isArray(choices) ? choices : [];
  const fromStart = choiceRows
    .filter((choice) => Number(choice.from_page_id) === Number(start.id))
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id));
  const selected = [start];
  if (SAMPLE_CHOICE_LIMIT > 0 && fromStart.length) {
    const next = pageList.find((page) => Number(page.id) === Number(fromStart[0].to_page_id));
    if (next && Number(next.id) !== Number(start.id)) selected.push(next);
  }
  return selected.map((page) => ({
    id: page.id,
    title: page.title || '',
    image_path: page.image_path || '',
    text_content: page.text_content || '',
    is_start: page.is_start,
    choices: choiceRows
      .filter((choice) => Number(choice.from_page_id) === Number(page.id))
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((choice) => ({
        text: choice.choice_text != null ? choice.choice_text : (choice.text || ''),
      })),
  }));
}

function loadSamplePages(db, comicId) {
  const pages = db.prepare(`
    SELECT id, title, image_path, text_content, is_start
    FROM pages
    WHERE comic_id = ?
    ORDER BY id ASC
  `).all(comicId);
  const choices = db.prepare(`
    SELECT ch.id, ch.from_page_id, ch.choice_text, ch.to_page_id
    FROM choices ch
    JOIN pages p ON p.id = ch.from_page_id
    WHERE p.comic_id = ?
    ORDER BY ch.id ASC
  `).all(comicId);
  return selectSamplePages(pages, choices);
}

function readerLink(comicId, label) {
  return `<a href="/?comic=${Number(comicId)}&amp;start=1" class="button-link inline-block px-5 py-2.5 bg-white text-slate-900 rounded-2xl font-medium no-underline">${escapeHtml(label)}</a>`;
}

function renderTeaserHtml(story, samplePages) {
  if (!samplePages || !samplePages.length) return '';
  const title = story.title || 'Untitled';
  const articles = samplePages.map((page) => {
    const pageTitle = String(page.title || '').trim();
    const alt = pageTitle ? (title + ' — ' + pageTitle) : title;
    const src = safeImageSrc(page.image_path);
    const image = src
      ? `<div class="teaser-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></div>`
      : '';
    const heading = pageTitle ? `<h3>${escapeHtml(pageTitle)}</h3>` : '';
    const text = String(page.text_content || '').trim()
      ? `<p class="teaser-text">${formatPageText(page.text_content)}</p>`
      : '';
    const items = (page.choices || [])
      .map((choice) => String(choice.text || '').trim())
      .filter(Boolean)
      .map((label) => `<li>${escapeHtml(label)}</li>`)
      .join('');
    const choices = items
      ? `<p class="teaser-prompt">What would you do?</p><ul class="teaser-choices">${items}</ul>`
      : '';
    return `<article class="teaser-page">${heading}${image}${text}${choices}</article>`;
  }).join('\n');
  return `<section class="story-teaser" aria-label="Story sample">
    <h2>Sample</h2>
    <p>The opening of this branching story.</p>
    ${articles}
  </section>`;
}

function renderStoryPage(story, samplePages) {
  const pathName = storyPath(story.id, story.title);
  const title = story.title || 'Untitled';
  const author = story.author || 'unknown';
  const genre = story.genre || 'Story';
  const description = plainText(story.description, 160) || (title + ' — a branching story on Pick Your Path Stories.');
  const cover = safeImageSrc(story.cover_image);
  const image = cover
    ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" class="w-full rounded-2xl border border-slate-800 bg-slate-950 mb-6">`
    : '';
  const bodyText = plainText(story.description, 4000);
  const teaser = renderTeaserHtml(story, samplePages || []);
  const afterTeaser = teaser
    ? `<p class="mt-6">${readerLink(story.id, 'Start reading')}</p>
    <p class="mt-3">${readerLink(story.id, 'Keep reading in the app')}</p>`
    : '';
  return pageDocument({
    title: title + ' · Pick Your Path Stories',
    description,
    canonicalPath: pathName,
    body: `
    <p class="text-xs text-slate-500 mb-2">${escapeHtml(genre)}</p>
    <h1 class="text-3xl sm:text-4xl font-semibold tracking-tighter text-slate-100 mb-2">${escapeHtml(title)}</h1>
    <p class="text-sm text-slate-400 mb-6">by ${escapeHtml(author)}</p>
    ${image}
    <p>${escapeHtml(bodyText || 'A branching story on Pick Your Path Stories.')}</p>
    <p class="mt-6">${readerLink(story.id, 'Start reading')}</p>
    ${teaser}
    ${afterTeaser}`,
  });
}

function renderSitemap(stories) {
  const urls = STATIC_SITEMAP_PATHS.map((urlPath) => '  <url><loc>' + absoluteUrl(urlPath) + '</loc></url>');
  (stories || []).forEach((story) => {
    urls.push('  <url><loc>' + absoluteUrl(storyPath(story.id, story.title)) + '</loc></url>');
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

function sendHtml(res, status, html) {
  res.status(status);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

function mountEarlyRoutes(app, options) {
  const db = options.db;
  const indexPath = options.indexPath;

  app.get('/', (req, res, next) => {
    try {
      const stories = listPublishedStories(db);
      sendHtml(res, 200, renderHomeFromFile(indexPath, stories));
    } catch (err) {
      console.error('Home render failed', (err && (err.code || err.name)) || 'error');
      next(err);
    }
  });

  app.get('/about', (req, res) => {
    res.redirect(301, '/how-it-works.html#about');
  });

  app.get('/index.html', (req, res) => {
    res.redirect(301, '/');
  });

  app.get('/sitemap.xml', (req, res) => {
    try {
      const stories = listPublishedStories(db);
      res.status(200);
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.send(renderSitemap(stories));
    } catch (err) {
      console.error('Sitemap failed', (err && (err.code || err.name)) || 'error');
      res.status(500).type('text/plain').send('Could not build sitemap');
    }
  });

  function sendStoryPage(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendHtml(res, 404, renderNotFound());
    }
    let story;
    let samplePages = [];
    try {
      story = getPublishedStory(db, id);
      if (story) samplePages = loadSamplePages(db, story.id);
    } catch (err) {
      console.error('Story page failed', (err && (err.code || err.name)) || 'error');
      return res.status(500).type('text/plain').send('Could not load that story');
    }
    if (!story) return sendHtml(res, 404, renderNotFound());
    if (req.params.slug !== storySlug(story.title)) {
      return res.redirect(301, storyPath(story.id, story.title));
    }
    sendHtml(res, 200, renderStoryPage(story, samplePages));
  }

  app.get('/story/:id', sendStoryPage);
  app.get('/story/:id/:slug', sendStoryPage);
}

function sendAppShell(res, db, indexPath) {
  try {
    const stories = listPublishedStories(db);
    sendHtml(res, 200, renderHomeFromFile(indexPath, stories));
  } catch (err) {
    console.error('App shell failed', (err && (err.code || err.name)) || 'error');
    res.sendFile(indexPath);
  }
}

function handleFallback(req, res, options) {
  const reqPath = req.path || '/';
  const publicDir = options.publicDir;

  if (reqPath.startsWith('/api') || reqPath.startsWith('/uploads')) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (/\.(css|js|map|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i.test(reqPath)) {
    const filePath = path.join(publicDir, reqPath);
    return res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).type('text/plain').send('Asset not found');
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendHtml(res, 404, renderNotFound());
  }

  if (isSpaPath(reqPath)) {
    return sendAppShell(res, options.db, options.indexPath);
  }

  return sendHtml(res, 404, renderNotFound());
}

module.exports = {
  CANONICAL_ORIGIN,
  ADSENSE_ACCOUNT,
  CATALOG_MARKER,
  STATIC_SITEMAP_PATHS,
  escapeHtml,
  storySlug,
  storyPath,
  absoluteUrl,
  isSpaPath,
  listPublishedStories,
  getPublishedStory,
  renderNotFound,
  renderCatalogHtml,
  renderHomeHtml,
  renderHomeFromFile,
  SAMPLE_CHOICE_LIMIT,
  selectSamplePages,
  loadSamplePages,
  renderStoryPage,
  renderSitemap,
  mountEarlyRoutes,
  handleFallback,
};
