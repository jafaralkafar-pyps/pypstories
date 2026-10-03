/**
 * Send GET/HEAD on the bare host to the www host.
 * POST /api/webhook and every other non-GET/HEAD request are left alone.
 */

const BARE_HOST = 'pypstories.com';
const CANONICAL_ORIGIN = 'https://www.pypstories.com';

function bareHostRedirect(req, res, next) {
  const method = String((req && req.method) || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return next();

  const original = (req && (req.originalUrl || req.url)) || '/';
  const pathOnly = String(original).split('?')[0];
  if (pathOnly === '/api/webhook') return next();

  // req.hostname follows trust proxy and omits the port.
  const host = String((req && req.hostname) || '').toLowerCase();
  if (host !== BARE_HOST) return next();

  res.redirect(301, CANONICAL_ORIGIN + original);
}

module.exports = {
  BARE_HOST,
  CANONICAL_ORIGIN,
  bareHostRedirect,
};
