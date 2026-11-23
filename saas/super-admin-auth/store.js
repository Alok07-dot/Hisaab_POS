'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('../auth');

const DATA_DIR = process.env.HISAAB_DATA_DIR
  ? path.resolve(process.env.HISAAB_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'super-admin-users.json');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function empty() { return { users: [], sessions: [], invitations: [], updatedAt: null }; }
function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return Object.assign(empty(), parsed, {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        invitations: Array.isArray(parsed.invitations) ? parsed.invitations : []
      });
    }
  } catch (e) {}
  return empty();
}
function save(db) {
  ensureDir();
  db.updatedAt = new Date().toISOString();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  try { fs.renameSync(tmp, FILE); } catch (e) { fs.rmSync(FILE, { force: true }); fs.renameSync(tmp, FILE); }
}
function id(prefix) { return (prefix || '') + crypto.randomBytes(10).toString('hex'); }
function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt, updatedAt: u.updatedAt, lastLoginAt: u.lastLoginAt || null, invitedBy: u.invitedBy || null };
}

function seedOwner() {
  const db = load();
  const runtimeConfig = require('../../server/runtime-config');
  const { verifyPassword } = require('../auth');
  const adminCfg = runtimeConfig.adminConfig();
  const email = normEmail(adminCfg.superAdminEmail || adminCfg.adminEmail || 'owner@hisaab.local');
  const existingByEmail = db.users.find(u => normEmail(u.email) === email) || null;
  const existingOwner = existingByEmail || db.users.find(u => u.role === 'owner' && u.status !== 'disabled') || null;

  // Safe migration/password-reset for existing installations:
  // If an owner account already exists and a secure reset is explicitly requested,
  // rotate its password (preserving identity/role/history) without creating defaults.
  if (existingOwner && adminCfg.resetSuperAdminPassword && adminCfg.superAdminPasswordProvided) {
    if (!runtimeConfig.isProduction || runtimeConfig.isStrongSecret(adminCfg.superAdminPassword)) {
      existingOwner.passwordHash = hashPassword(adminCfg.superAdminPassword);
      existingOwner.updatedAt = new Date().toISOString();
      // Keep account accessible; do not alter role/status/id/email.
      save(db);
      console.log('[SUPER-ADMIN] Owner password reset applied for existing account → ' + (existingOwner.email || existingOwner.id) + ' (password provided via environment variable; value not logged)');
      return;
    }
  }

  if (existingOwner) {
    // Preserve existing legitimate Super Admin accounts (no lockout, no mutation).
    // Warn in production if the account still appears to use a known insecure default.
    if (runtimeConfig.isProduction && existingOwner.passwordHash) {
      const insecureDefaults = ['Admin@12345', 'admin@12345', 'ChangeMe@12345', 'changeme', 'password', '12345678'];
      const looksInsecure = insecureDefaults.some(pw => {
        try { return verifyPassword(pw, existingOwner.passwordHash); } catch (e) { return false; }
      });
      if (looksInsecure) {
        console.warn('[SUPER-ADMIN] Security warning: the existing Super Admin account may be using an insecure/default password. Rotate it using the secure password-reset procedure (set SUPER_ADMIN_PASSWORD to a strong secret and RESET_SUPER_ADMIN_PASSWORD=true for a controlled restart).');
      }
    }
    return;
  }

  // Initial provisioning: no owner exists.
  const usingProvided = !!adminCfg.superAdminPasswordProvided;
  const password = usingProvided ? adminCfg.superAdminPassword : adminCfg.devAdminPassword;
  if (runtimeConfig.isProduction && !usingProvided) {
    throw new Error('SUPER_ADMIN_PASSWORD (or ADMIN_PASSWORD) must be configured in production for initial Super Admin provisioning. No default credentials are created.');
  }
  if (runtimeConfig.isProduction && !runtimeConfig.isStrongSecret(password)) {
    throw new Error('A strong SUPER_ADMIN_PASSWORD (or ADMIN_PASSWORD) is required in production for initial Super Admin provisioning.');
  }

  const now = new Date().toISOString();
  db.users.push({
    id: id('adm_'), email, name: adminCfg.superAdminName || 'Platform Owner',
    role: 'owner', status: 'active', passwordHash: hashPassword(password),
    createdAt: now, updatedAt: now, lastLoginAt: null
  });
  save(db);

  if (runtimeConfig.isProduction) {
    console.log('[SUPER-ADMIN] Owner account provisioned → ' + email + ' (password provided via environment variable; value not logged)');
  } else {
    console.log('[SUPER-ADMIN] Owner account ready → ' + email + (usingProvided ? ' (password from environment variable)' : ' (development default password)'));
  }
}

function findByEmail(email) {
  const db = load();
  return db.users.find(u => normEmail(u.email) === normEmail(email)) || null;
}
function findById(uid) {
  const db = load();
  return db.users.find(u => u.id === uid) || null;
}
function listUsers() {
  const db = load();
  return db.users.map(publicUser);
}
function createUser({ email, name, role, password, status, invitedBy }) {
  const db = load();
  const e = normEmail(email);
  if (!e || db.users.find(u => normEmail(u.email) === e)) throw new Error('Email already exists');
  const now = new Date().toISOString();
  const user = {
    id: id('adm_'), email: e, name: name || e, role: role || 'admin', status: status || 'active',
    passwordHash: password ? hashPassword(password) : null,
    createdAt: now, updatedAt: now, lastLoginAt: null, invitedBy: invitedBy || null
  };
  db.users.push(user); save(db); return user;
}
function updateUser(uid, patch) {
  const db = load();
  const u = db.users.find(x => x.id === uid);
  if (!u) return null;
  if (patch.name != null) u.name = patch.name;
  if (patch.role != null) u.role = patch.role;
  if (patch.status != null) u.status = patch.status;
  if (patch.password) u.passwordHash = hashPassword(patch.password);
  u.updatedAt = new Date().toISOString();
  save(db); return u;
}
function createSession(userId) {
  const db = load();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const sess = { id: id('sas_'), userId, tokenHash: sha256(token), createdAt: now, expiresAt: now + SESSION_TTL_MS, lastSeenAt: now };
  db.sessions = (db.sessions || []).filter(s => s.expiresAt > now);
  db.sessions.push(sess);
  const u = db.users.find(x => x.id === userId); if (u) u.lastLoginAt = new Date(now).toISOString();
  save(db);
  return { token, session: sess };
}
function getSession(token) {
  if (!token) return null;
  const db = load();
  const hash = sha256(token);
  const sess = (db.sessions || []).find(s => s.tokenHash === hash);
  if (!sess) return null;
  if (sess.expiresAt <= Date.now()) { db.sessions = db.sessions.filter(s => s.id !== sess.id); save(db); return null; }
  const user = db.users.find(u => u.id === sess.userId);
  if (!user) return null;
  sess.lastSeenAt = Date.now(); save(db);
  return { session: sess, user };
}
function deleteSession(token) {
  if (!token) return;
  const db = load();
  const hash = sha256(token);
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.tokenHash !== hash);
  if (db.sessions.length !== before) save(db);
}

module.exports = { FILE, seedOwner, findByEmail, findById, listUsers, createUser, updateUser, createSession, getSession, deleteSession, publicUser, load, save };
