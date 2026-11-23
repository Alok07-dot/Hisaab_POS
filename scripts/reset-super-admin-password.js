'use strict';

/**
 * Safe Super Admin password reset / migration helper (no UI changes).
 *
 * Preserves the existing Super Admin account (id, email, role, status, history)
 * and only rotates its password hash. Never prints passwords or secrets.
 *
 * Usage (PowerShell example):
 *   $env:APP_ENV='production'                  # optional but recommended
 *   $env:HISAAB_DATA_DIR='C:\path\to\data'     # must point to the target installation's data dir
 *   $env:SUPER_ADMIN_EMAIL='owner@example.com' # optional; defaults to existing owner or configured email
 *   $env:SUPER_ADMIN_PASSWORD='NewStrongSecret!234'
 *   node scripts/reset-super-admin-password.js
 *
 * Alternatively, run the server once with:
 *   RESET_SUPER_ADMIN_PASSWORD=true SUPER_ADMIN_PASSWORD=<strong-secret>
 * (env-provided only; do not commit secrets) to rotate the existing owner on startup.
 */

const fs = require('fs');
const path = require('path');
const runtimeConfig = require('../server/runtime-config');
const adminUsers = require('../saas/super-admin-auth/store');
const { hashPassword, verifyPassword } = require('../saas/auth');

function fail(msg) {
  console.error('[RESET] ' + msg);
  process.exit(1);
}

const adminCfg = runtimeConfig.adminConfig();
const newPassword = String(adminCfg.superAdminPassword || '');
if (!newPassword) {
  fail('SUPER_ADMIN_PASSWORD (or ADMIN_PASSWORD) must be provided via environment variable. Passwords are never accepted from source code or logs.');
}
if (runtimeConfig.isProduction && !runtimeConfig.isStrongSecret(newPassword)) {
  fail('In production, SUPER_ADMIN_PASSWORD must be a strong secret (minimum 12 characters with mixed character types).');
}
if (!runtimeConfig.isProduction && !runtimeConfig.isStrongSecret(newPassword) && newPassword.length < 8) {
  fail('Provide a stronger password (at least 8 characters).');
}

const state = runtimeConfig.superAdminStoreState();
if (!state.exists || !state.hasOwner) {
  fail('No existing Super Admin owner account was found in ' + state.file + '. For initial provisioning, start the server in production with SUPER_ADMIN_PASSWORD set to a strong secret (no default credentials).');
}

const db = adminUsers.load();
const targetEmail = String(adminCfg.superAdminEmail || adminCfg.adminEmail || '').trim().toLowerCase();
let target = null;
if (targetEmail) target = db.users.find(u => String(u.email || '').toLowerCase() === targetEmail) || null;
if (!target) target = db.users.find(u => u && u.role === 'owner' && u.status !== 'disabled') || null;
if (!target) fail('Could not locate a Super Admin owner account to reset.');

target.passwordHash = hashPassword(newPassword);
target.updatedAt = new Date().toISOString();
adminUsers.save(db);

// Sanity check without printing the password.
if (!target.passwordHash || !verifyPassword(newPassword, target.passwordHash)) {
  fail('Password reset verification failed; no changes were confirmed.');
}

console.log('[RESET] Super Admin password rotated successfully.');
console.log('[RESET] Account preserved: ' + (target.email || target.id) + ' (id: ' + target.id + ')');
console.log('[RESET] No passwords or secrets were logged. Ensure the new secret is stored securely (env/secret manager).');
