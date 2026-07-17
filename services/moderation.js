/**
 * Username + public text moderation for PYPStories.
 * Custom blocklist: brand/reserved names + common abuse terms.
 * Edit BRAND_RESERVED and PROFANITY arrays to extend — no third-party list required.
 */

// --- Brand / impersonation / system (always block in usernames; also blocked as whole words in comments) ---
const BRAND_RESERVED = [
  // Platform
  'pyp', 'pyps', 'pypstories', 'pypstory', 'pickyourpath', 'pickyourpathstories',
  'pick-your-path', 'pick_your_path',
  // Staff / trust
  'admin', 'administrator', 'mod', 'moderator', 'mods', 'staff', 'support',
  'help', 'helper', 'official', 'system', 'root', 'owner', 'founder',
  'security', 'safety', 'team', 'editor', 'reviewer', 'null', 'undefined',
  // Payments / big brands often impersonated
  'stripe', 'paypal', 'venmo', 'cashapp', 'google', 'youtube', 'apple',
  'microsoft', 'amazon', 'facebook', 'instagram', 'twitter', 'tiktok',
];

// --- Common abuse / sexual / slurs (substring after normalize — keep this list deliberate) ---
// Add terms your community needs; avoid tiny stems that overblock (e.g. "ass" alone).
const PROFANITY = [
  'fuck', 'fuk', 'fck', 'shit', 'sh1t', 'bitch', 'btch', 'cunt', 'cock',
  'dick', 'd1ck', 'pussy', 'faggot', 'fagg', 'nigger', 'nigga', 'retard',
  'whore', 'slut', 'bastard', 'asshole', 'a55hole', 'dumbass', 'jackass',
  'motherfucker', 'mfucker', 'porn', 'porno', 'onlyfans', 'sexcam',
  'rape', 'rapist', 'pedophile', 'paedophile', 'pedo', 'molest',
  'killmyself', 'kys', 'suicidal', // crude self-harm bait usernames
  'nazi', 'hitler',
];

// Usernames that are only these (or equal after normalize) — empty / generic
const USERNAME_BANNED_EXACT = [
  'user', 'username', 'name', 'test', 'testing', 'guest', 'anonymous',
  'anon', 'me', 'you', 'player', 'creator', 'author', 'writer',
];

const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
  '@': 'a', '$': 's', '!': 'i', '+': 't',
};

function normalizeForMatch(text) {
  let s = String(text || '').toLowerCase();
  // strip zero-width / weird spaces
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  // leetspeak → letters
  s = s.replace(/[013457@$!+]/g, (ch) => LEET[ch] || ch);
  // keep only a-z0-9 for dense matching (removes separators: a_d_m_i_n → admin)
  s = s.replace(/[^a-z0-9]/g, '');
  // collapse long repeats: fuuuuck → fuuck (still catches fuck with further trim)
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  return s;
}

function buildMatcher(terms) {
  // Longer terms first so multi-word brands win
  return [...terms]
    .map((t) => normalizeForMatch(t))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

const BRAND_NORM = buildMatcher(BRAND_RESERVED);
const PROFANITY_NORM = buildMatcher(PROFANITY);
const EXACT_NORM = new Set(buildMatcher(USERNAME_BANNED_EXACT));

function findBlockedInNormalized(norm, lists) {
  if (!norm) return null;
  for (const list of lists) {
    for (const term of list) {
      if (term.length >= 3 && norm.includes(term)) return term;
    }
  }
  return null;
}

/**
 * Strict username rules + blocklist.
 * @returns {{ ok: true, username: string } | { ok: false, error: string }}
 */
function validateUsername(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { ok: true, username: null }; // optional field
  }

  const username = String(raw).trim();

  if (username.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters' };
  }
  if (username.length > 24) {
    return { ok: false, error: 'Username must be 24 characters or fewer' };
  }

  // Letters, numbers, underscore, hyphen only
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return {
      ok: false,
      error: 'Username can only use letters, numbers, underscores, and hyphens',
    };
  }
  if (/^[_-]+$/.test(username) || /^[0-9]+$/.test(username)) {
    return { ok: false, error: 'Username must include letters' };
  }
  if (/^[_-]|[_-]$/.test(username)) {
    return { ok: false, error: 'Username cannot start or end with _ or -' };
  }

  const norm = normalizeForMatch(username);

  if (EXACT_NORM.has(norm)) {
    return { ok: false, error: 'That username is not allowed' };
  }

  // Exact brand match or brand contained (e.g. OfficialPYP)
  const brandHit = findBlockedInNormalized(norm, [BRAND_NORM]);
  if (brandHit) {
    return {
      ok: false,
      error: 'That username is reserved or looks like an official/brand name',
    };
  }

  const badHit = findBlockedInNormalized(norm, [PROFANITY_NORM]);
  if (badHit) {
    return { ok: false, error: 'That username contains language that is not allowed' };
  }

  return { ok: true, username };
}

/**
 * Comments / other public free text.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validatePublicText(raw, { field = 'text', minLen = 2, maxLen = 2000 } = {}) {
  const body = String(raw || '').trim();
  if (body.length < minLen) {
    return { ok: false, error: `${field} is too short` };
  }
  if (body.length > maxLen) {
    return { ok: false, error: `${field} must be under ${maxLen} characters` };
  }

  const norm = normalizeForMatch(body);
  if (findBlockedInNormalized(norm, [PROFANITY_NORM])) {
    return { ok: false, error: 'Please remove inappropriate language from your comment' };
  }
  // Brand hits in free-form comments are soft — only block dense impersonation style
  // (e.g. "pypstories_support"). Normal sentences rarely normalize into a brand token alone.
  if (findBlockedInNormalized(norm, [BRAND_NORM])) {
    return {
      ok: false,
      error: 'Please avoid reserved or official-looking brand names in comments',
    };
  }

  return { ok: true };
}

module.exports = {
  validateUsername,
  validatePublicText,
  normalizeForMatch,
  // exported for tests / admin tuning later
  BRAND_RESERVED,
  PROFANITY,
};
