'use strict';

const adminStore = require('./store');
const { verifyPassword, rateLimit } = require('../auth');
const { hasPermission, permissionsForRole } = require('../rbac/permissions');

const COOKIE_NAME = 'hisaab_super_admin_session';
const SESSION_MAX_AGE_SEC = 12 * 60 * 60;

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
  const parts = [COOKIE_NAME + '=' + encodeURIComponent(token), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + SESSION_MAX_AGE_SEC];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(req, res) {
  res.append('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireSuperAdminAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ ok: false, error: 'Authentication required.', code: 'unauthenticated' });
  const found = adminStore.getSession(token);
  if (!found) return res.status(401).json({ ok: false, error: 'Session expired. Please sign in again.', code: 'unauthenticated' });
  if (found.user.status !== 'active') return res.status(403).json({ ok: false, error: 'This account is not active.', code: 'forbidden' });
  req.superAdmin = found.user;
  req.superAdminToken = token;
  req.adminRole = found.user.role;
  req.adminPermissions = permissionsForRole(found.user.role);
  next();
}

function requirePermission(permission) {
  return function (req, res, next) {
    const role = req.adminRole || (req.superAdmin && req.superAdmin.role);
    if (!hasPermission(role, permission)) {
      return res.status(403).json({ ok: false, error: 'Insufficient permissions.', code: 'forbidden', permission });
    }
    next();
  };
}

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: 'super_admin_login' });

async function handleLogin(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required.', code: 'validation_error' });
  const user = adminStore.findByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: 'Invalid email or password.', code: 'invalid_credentials' });
  }
  if (user.status !== 'active') return res.status(403).json({ ok: false, error: 'This account is not active.', code: 'forbidden' });
  const { token } = adminStore.createSession(user.id);
  setSessionCookie(req, res, token);
  return res.json({ ok: true, token, user: adminStore.publicUser(user), role: user.role, permissions: permissionsForRole(user.role) });
}

function handleLogout(req, res) {
  const token = req.superAdminToken || getToken(req);
  if (token) adminStore.deleteSession(token);
  clearSessionCookie(req, res);
  res.json({ ok: true });
}

function handleMe(req, res) {
  res.json({ ok: true, user: adminStore.publicUser(req.superAdmin), role: req.adminRole, permissions: req.adminPermissions || permissionsForRole(req.adminRole) });
}

module.exports = { COOKIE_NAME, getToken, setSessionCookie, clearSessionCookie, requireSuperAdminAuth, requirePermission, loginLimiter, handleLogin, handleLogout, handleMe };
