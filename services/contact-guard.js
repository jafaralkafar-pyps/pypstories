/**
 * Contact-form spam checks. This module does not send mail by itself.
 * The route passes sendEmail. Honeypot hits are dropped. Fast submits and
 * link-heavy messages are saved with flagged set and are not emailed.
 * The rate limiter uses req.ip, which follows app.set('trust proxy', 1).
 */

const rateLimit = require('express-rate-limit');
const contactMessages = require('./contact-messages');
const { validatePublicText } = require('./moderation');

const MIN_FILL_MS = 3000;
const MAX_LINKS = 2;
const CONTACT_RATE_MAX = 5;
const CONTACT_RATE_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_RATE_MESSAGE = 'Too many messages. Please try again in an hour.';

const FLAG_FAST = 'Submitted too quickly';
const FLAG_MISSING = 'Missing timestamp';
const FLAG_INVALID = 'Invalid timestamp';
const FLAG_LINKS = 'Too many links';

function honeypotTripped(value) {
  if (Array.isArray(value)) return value.some((item) => honeypotTripped(item));
  if (value == null) return false;
  return String(value).trim() !== '';
}

function countContactLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/|(?:^|[^A-Za-z0-9])www\.)\S*/gi);
  return matches ? matches.length : 0;
}

function inspectContactSubmission(input, nowMs) {
  const payload = input || {};
  if (honeypotTripped(payload.website)) {
    return { drop: true, flagged: false, flagReason: null };
  }
  const reasons = [];
  const raw = payload.loadedAt == null ? '' : String(payload.loadedAt).trim();
  const now = Number(nowMs);
  if (!raw) {
    reasons.push(FLAG_MISSING);
  } else if (!/^\d+$/.test(raw) || !Number.isFinite(now)) {
    reasons.push(FLAG_INVALID);
  } else {
    const loaded = Number(raw);
    if (!Number.isFinite(loaded) || loaded <= 0 || loaded > now) {
      reasons.push(FLAG_INVALID);
    } else if (now - loaded < MIN_FILL_MS) {
      reasons.push(FLAG_FAST);
    }
  }
  const links = countContactLinks(payload.name) + countContactLinks(payload.message);
  if (links > MAX_LINKS) reasons.push(FLAG_LINKS);
  if (!reasons.length) return { drop: false, flagged: false, flagReason: null };
  return { drop: false, flagged: true, flagReason: reasons.join('; ') };
}

function contactRecipient() {
  return (
    (process.env.CONTACT_EMAIL || '').trim() ||
    (process.env.EMAIL_FROM || '').match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ||
    ''
  );
}

function createContactLimiter() {
  return rateLimit({
    windowMs: CONTACT_RATE_WINDOW_MS,
    max: CONTACT_RATE_MAX,
    message: { error: CONTACT_RATE_MESSAGE },
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
  });
}

async function handleContactPost(req, res, ctx) {
  const body = (req && req.body) || {};
  const deps = ctx || {};
  const now = deps.now == null ? Date.now() : Number(deps.now);

  if (honeypotTripped(body.website)) {
    return res.json({ success: true, message: contactMessages.CONTACT_SUCCESS });
  }

  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const message = String(body.message || '').trim().slice(0, 2000);

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Please enter your name' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }
  const textCheck = validatePublicText(message, {
    field: 'Message',
    minLen: 10,
    maxLen: 2000,
  });
  if (!textCheck.ok) {
    return res.status(400).json({ error: textCheck.error });
  }

  const verdict = inspectContactSubmission({
    loadedAt: body.loaded_at,
    name,
    message,
  }, now);

  const ip = deps.ip != null
    ? String(deps.ip).slice(0, 80)
    : String((req && (req.ip || (req.headers && req.headers['x-forwarded-for']))) || '').slice(0, 80);

  try {
    contactMessages.saveContactMessage(deps.db, {
      name,
      email,
      message,
      ip,
      userId: deps.userId,
      flagged: verdict.flagged ? 1 : 0,
      flagReason: verdict.flagReason,
    });
  } catch (err) {
    console.error('Contact save failed:', err);
    return res.status(500).json({ error: 'Could not save your message. Please try again.' });
  }

  const to = deps.to != null ? deps.to : contactRecipient();
  if (!verdict.flagged) {
    if (to && typeof deps.sendEmail === 'function') {
      try {
        const safeName = name.replace(/[<>&]/g, '');
        const safeEmail = email.replace(/[<>&]/g, '');
        const safeMsg = message
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        await deps.sendEmail(
          to,
          `[PYPStories contact] from ${safeName}`,
          `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px;">
          <h2>New contact message</h2>
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
          <p><strong>Message:</strong></p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">${safeMsg}</div>
        </div>
        `
        );
      } catch (err) {
        console.error('Contact email failed (message still saved):', err.message || err);
      }
    } else if (!to) {
      console.warn('CONTACT_EMAIL / EMAIL_FROM not set — contact message saved to DB only');
    }
  }

  return res.json({
    success: true,
    message: contactMessages.CONTACT_SUCCESS,
  });
}

module.exports = {
  MIN_FILL_MS,
  MAX_LINKS,
  CONTACT_RATE_MAX,
  CONTACT_RATE_WINDOW_MS,
  CONTACT_RATE_MESSAGE,
  FLAG_FAST,
  FLAG_MISSING,
  FLAG_INVALID,
  FLAG_LINKS,
  honeypotTripped,
  countContactLinks,
  inspectContactSubmission,
  createContactLimiter,
  handleContactPost,
};
