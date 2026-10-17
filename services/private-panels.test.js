/**
 * Run: node services/private-panels.test.js
 * Does not load server.js or open data/cyoa.db.
 * Executes private-panels.js against a small document stand-in (no jsdom).
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const panelsPath = path.join(root, 'public', 'js', 'private-panels.js');
const appPath = path.join(root, 'public', 'js', 'app.js');

function idsFrom(html) {
  const set = new Set();
  const re = /id="([^"]+)"/g;
  let match;
  while ((match = re.exec(html))) set.add(match[1]);
  return set;
}

function loadPanels(indexHtml) {
  const panelsSrc = fs.readFileSync(panelsPath, 'utf8');
  let insertedHtml = '';
  const document = {
    body: { appendChild() {} },
    getElementById() { return null; },
    querySelector(selector) {
      if (selector === '.pt-14' && indexHtml.includes('class="pt-14')) {
        return { appendChild() {} };
      }
      return null;
    },
    createElement() {
      const el = { firstChild: null };
      Object.defineProperty(el, 'innerHTML', {
        set(value) { insertedHtml = String(value); },
        get() { return insertedHtml; },
      });
      el.querySelector = (selector) => {
        const id = String(selector || '').replace(/^#/, '');
        return idsFrom(insertedHtml).has(id) ? { id } : null;
      };
      return el;
    },
  };
  const window = { document };
  const context = { window, document, console };
  vm.createContext(context);
  vm.runInContext(panelsSrc, context, { filename: panelsPath });
  assert.strictEqual(typeof window.ensurePrivatePanels, 'function');
  if (!insertedHtml) window.ensurePrivatePanels();
  assert.ok(insertedHtml.length > 0, 'ensurePrivatePanels did not build panel HTML');
  return insertedHtml;
}

function lookedUpIds(appSrc) {
  const ids = new Set();
  for (const match of appSrc.matchAll(/getElementById\(\s*'([^']+)'/g)) ids.add(match[1]);
  for (const match of appSrc.matchAll(/\[([^\]]+)\]\.forEach\(\s*(?:id|\(id\))/g)) {
    for (const id of match[1].matchAll(/'([A-Za-z0-9_-]+)'/g)) ids.add(id[1]);
  }
  for (const match of appSrc.matchAll(/(?:const|let)\s+\w+\s*=\s*\[([\s\S]*?)\]\s*;/g)) {
    const after = appSrc.slice(match.index, match.index + 600);
    if (!after.includes('getElementById')) continue;
    for (const id of match[1].matchAll(/'([A-Za-z0-9_-]+)'/g)) ids.add(id[1]);
  }
  return ids;
}

function isGuarded(appSrc, index) {
  const lineEnd = appSrc.indexOf('\n', index);
  const line = appSrc.slice(appSrc.lastIndexOf('\n', index) + 1, lineEnd === -1 ? appSrc.length : lineEnd);
  if (line.includes('?.') || line.includes(' ? ')) return true;
  const rest = appSrc.slice((lineEnd === -1 ? appSrc.length : lineEnd) + 1, (lineEnd === -1 ? appSrc.length : lineEnd) + 220);
  const next = rest.split('\n').map((lineText) => lineText.trim()).filter(Boolean)[0] || '';
  return /^if\s*\(/.test(next);
}

function mainIndexBlock() {
  const mainHtml = execFileSync('git', ['show', '2174e1d:public/index.html'], {
    cwd: root,
    encoding: 'utf8',
  });
  const lines = mainHtml.split(/\n/);
  const start = lines.findIndex((line) => line.includes('CREATE / EDIT COMIC MODAL'));
  const block = lines.slice(start, start + 114).join('\n');
  assert.ok(block.includes('id="create-modal"'));
  assert.ok(!block.includes('id="auth-modal"'));
  return block;
}

function main() {
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const appSrc = fs.readFileSync(appPath, 'utf8');
  const panelsSrc = fs.readFileSync(panelsPath, 'utf8');
  const insertedHtml = loadPanels(indexHtml);
  const present = new Set([
    ...idsFrom(indexHtml),
    ...idsFrom(insertedHtml),
  ]);
  fs.readdirSync(path.join(root, 'public')).forEach((name) => {
    if (name.endsWith('.html')) {
      idsFrom(fs.readFileSync(path.join(root, 'public', name), 'utf8')).forEach((id) => present.add(id));
    }
  });

  const required = [
    'create-modal',
    'create-form',
    'create-form-actions',
    'editor-section',
    'reader-modal',
    'auth-modal',
    'credits-modal',
    'view-account',
  ];
  required.forEach((id) => {
    assert.ok(present.has(id), 'missing #' + id + ' after ensurePrivatePanels');
  });

  ['auth-modal', 'credits-modal', 'view-account', 'create-modal', 'login-form'].forEach((id) => {
    assert.ok(!idsFrom(indexHtml).has(id), 'logged-out index.html still contains #' + id);
  });

  assert.ok(panelsSrc.replace(/\r\n/g, '\n').includes(mainIndexBlock()), 'create-modal HTML differs from main');
  assert.ok(panelsSrc.includes('if (root.document && root.document.body) ensurePrivatePanels();'));

  const createdByApp = new Set();
  for (const match of appSrc.matchAll(/id="([^"]+)"/g)) createdByApp.add(match[1]);
  for (const match of appSrc.matchAll(/\.id\s*=\s*'([^']+)'/g)) createdByApp.add(match[1]);

  const missing = [];
  const re = /getElementById\(\s*'([^']+)'/g;
  let match;
  while ((match = re.exec(appSrc))) {
    const id = match[1];
    if (present.has(id) || createdByApp.has(id)) continue;
    if (isGuarded(appSrc, match.index)) continue;
    missing.push(id);
  }
  for (const id of lookedUpIds(appSrc)) {
    if (present.has(id) || createdByApp.has(id)) continue;
    if (![...appSrc.matchAll(new RegExp("getElementById\\(\\s*'" + id + "'", 'g'))].some((hit) => !isGuarded(appSrc, hit.index))) {
      continue;
    }
    if (!missing.includes(id)) missing.push(id);
  }
  assert.deepStrictEqual(missing, []);

  console.log('PASS private panels');
}

main();
