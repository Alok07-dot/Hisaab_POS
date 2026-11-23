/* ══════════════════════════════════════════════════════════════
   HISAAB POS – SaaS auth helpers
   Password hashing (scrypt), bearer/cookie sessions, role checks
   and a tiny in-memory rate limiter for sensitive endpoints.
   ══════════════════════════════════════════════════════════════ */

'use strict';

const crypto = require('crypto');
const store = require('./store');

const COOKIE_NAME = 'hisaab_saas_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyPassword(password, stored) {
  try {
    if (!stored || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = parts[1];
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), salt, 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch (err) {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] || '';
}

function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    COOKIE_NAME + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + SESSION_MAX_AGE_SEC
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  res.append('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Authentication required.', code: 'unauthenticated' });
  }
  const found = store.getSessionAccount(token);
  if (!found) {
    return res.status(401).json({ ok: false, error: 'Session expired. Please sign in again.', code: 'unauthenticated' });
  }
  if (found.account.status === 'suspended') {
    return res.status(403).json({ ok: false, error: 'This account is suspended. Contact support.', code: 'suspended' });
  }
  if (found.account.status === 'blocked') {
    return res.status(403).json({ ok: false, error: 'This account has been blocked. Contact support.', code: 'blocked' });
  }
  if (found.account.status === 'deleted' || found.account.deletedAt) {
    return res.status(403).json({ ok: false, error: 'This account has been deleted.', code: 'account_deleted' });
  }
  req.account = found.account;
  req.sessionToken = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.account || req.account.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access required.', code: 'forbidden' });
  }
  next();
}

/* Tiny in-memory limiter. Keyed by IP + bucket. */
const buckets = new Map();

function rateLimit({ windowMs = 60 * 1000, max = 20, name = 'default' } = {}) {
  return function limiter(req, res, next) {
    const now = Date.now();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress || 'unknown';
    const key = name + '|' + ip;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({
        ok: false,
        error: 'Too many attempts. Please try again shortly.',
        code: 'rate_limited'
      });
    }
    next();
  };
}

// periodic cleanup so the map does not grow forever
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  getToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  rateLimit
};
