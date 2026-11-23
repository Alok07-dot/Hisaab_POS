/* ══════════════════════════════════════════════════════════════
   HISAAB POS – SaaS data store
   A small, dependency-free JSON store. Designed so the app can
   run fully offline in development and be swapped for Postgres
   later without changing the route layer.

   Data lives in <project>/data/saas.json (override with
   HISAAB_DATA_DIR). Writes are synchronous and atomic-ish:
   write a temp file, then rename it over the target.
   ══════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPlan } = require('./plans');
const planCatalog = require('./plans/catalog.service');

const DATA_DIR = process.env.HISAAB_DATA_DIR
  ? path.resolve(process.env.HISAAB_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'saas.json');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_USAGE_ENTRIES = 20000;
const DELETED_RETENTION_DAYS = Math.max(7, Math.min(365, Number(process.env.HISAAB_DELETED_RETENTION_DAYS) || 30));

let db = null;
let dirty = false;

function randomId(prefix) {
  return (prefix || '') + crypto.randomBytes(10).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function emptyDb() {
  return {
    version: 1,
    accounts: [],
    sessions: [],
    orders: [],
    payments: [],
    usage: [],
    webhookEvents: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function load() {
  if (db) return db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db = Object.assign(emptyDb(), parsed);
      ['accounts', 'sessions', 'orders', 'payments', 'usage', 'webhookEvents'].forEach(k => {
        if (!Array.isArray(db[k])) db[k] = [];
      });
    } else {
      db = emptyDb();
      save();
    }
  } catch (err) {
    console.error('[SAAS] Could not load data store, starting fresh:', err.message);
    db = emptyDb();
  }
  return db;
}

function save() {
  if (!db) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db.updatedAt = Date.now();
    const json = JSON.stringify(db);
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, json, 'utf8');
    try {
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      // Windows can refuse to replace an existing file in rare cases.
      fs.rmSync(DB_FILE, { force: true });
      fs.renameSync(tmp, DB_FILE);
    }
  } catch (err) {
    console.error('[SAAS] Could not save data store:', err.message);
  }
}

/* ─── Accounts ─────────────────────────────────────────────── */

function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || e.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return '';
  return e;
}

function createAccount(fields) {
  load();
  const now = Date.now();
  const account = {
    id: randomId('acc_'),
    email: fields.email || null,
    contactEmail: fields.contactEmail || null,
    pendingEmail: fields.pendingEmail || null,
    name: fields.name || 'Shop Owner',
    storeName: fields.storeName || 'Hisaab Store',
    phone: fields.phone || null,
    role: fields.role === 'admin' ? 'admin' : 'owner',
    passwordHash: fields.passwordHash || null,
    status: 'active',
    deviceIds: Array.isArray(fields.deviceIds) ? fields.deviceIds.slice(0, 25) : [],
    subscription: fields.subscription || defaultFreeSubscription(),
    subscriptionHistory: Array.isArray(fields.subscriptionHistory) ? fields.subscriptionHistory.slice(-100) : [],
    productCount: Number(fields.productCount) || 0,
    usage: fields.usage || {},
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    lastLoginAt: null
  };
  db.accounts.push(account);
  save();
  return account;
}

function defaultFreeSubscription() {
  return {
    planId: 'free',
    status: 'active',
    cycle: 'monthly',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    source: 'default',
    updatedAt: Date.now()
  };
}

function findAccountById(id) {
  load();
  return db.accounts.find(a => a.id === id) || null;
}

function isDeletedAccount(account) {
  return !!(account && (account.status === 'deleted' || account.deletedAt));
}

function isRecoverableDeletedAccount(account) {
  if (!isDeletedAccount(account)) return false;
  const until = Number(account.retentionUntil || 0);
  // If no retention recorded, treat as recoverable (legacy-safe).
  return !until || until > Date.now();
}

/** Active/loginable account by login email (excludes deleted accounts). */
function findAccountByEmail(email) {
  load();
  const e = normalizeEmail(email);
  if (!e) return null;
  return db.accounts.find(a =>
    !isDeletedAccount(a) &&
    ((a.email && a.email.toLowerCase() === e) || (a.contactEmail && String(a.contactEmail).toLowerCase() === e))
  ) || null;
}

/** Any account (including deleted) whose current login email matches. */
function findAnyAccountByEmail(email) {
  load();
  const e = normalizeEmail(email);
  if (!e) return null;
  return db.accounts.find(a =>
    (a.email && a.email.toLowerCase() === e) || (a.contactEmail && String(a.contactEmail).toLowerCase() === e)
  ) || null;
}

/** Deleted account recoverable by its original/deleted email identity. */
function findRecoverableDeletedAccountByEmail(email) {
  load();
  const e = normalizeEmail(email);
  if (!e) return null;
  return db.accounts.find(a => {
    if (!isRecoverableDeletedAccount(a)) return false;
    const candidates = [a.deletedEmail, a.recoveryEmail, a.archivedEmail, a.email, a.contactEmail]
      .filter(Boolean).map(v => String(v).toLowerCase());
    return candidates.indexOf(e) !== -1;
  }) || null;
}

function createRecoveryTicket(account) {
  const raw = randomId('rec_') + crypto.randomBytes(12).toString('hex');
  account.recoveryTicketHash = sha256(raw);
  account.recoveryTicketExpiresAt = Date.now() + 15 * 60 * 1000;
  account.updatedAt = Date.now();
  save();
  return raw;
}

function consumeRecoveryTicket(account, ticket) {
  if (!account || !ticket) return false;
  const hash = sha256(String(ticket));
  const ok = account.recoveryTicketHash && account.recoveryTicketHash === hash &&
    Number(account.recoveryTicketExpiresAt || 0) > Date.now();
  if (ok) {
    account.recoveryTicketHash = null;
    account.recoveryTicketExpiresAt = null;
    save();
  }
  return ok;
}

function findAccountByDevice(deviceId) {
  load();
  const d = String(deviceId || '');
  if (!d) return null;
  return db.accounts.find(a => !isDeletedAccount(a) && Array.isArray(a.deviceIds) && a.deviceIds.includes(d)) || null;
}

function addDevice(account, deviceId) {
  if (!account || !deviceId) return;
  const d = String(deviceId).slice(0, 128);
  if (!Array.isArray(account.deviceIds)) account.deviceIds = [];
  if (!account.deviceIds.includes(d)) {
    account.deviceIds.push(d);
    if (account.deviceIds.length > 25) account.deviceIds = account.deviceIds.slice(-25);
  }
  account.updatedAt = Date.now();
}

function removeAccount(account) {
  load();
  db.accounts = db.accounts.filter(a => a.id !== account.id);
  db.sessions = db.sessions.filter(s => s.accountId !== account.id);
  db.orders = db.orders.filter(o => o.accountId !== account.id);
  db.payments = db.payments.filter(p => p.accountId !== account.id);
  db.usage = db.usage.filter(u => u.accountId !== account.id);
  save();
}

/**
 * Soft-delete (deactivate) an account for possible recovery.
 * Preserves account/profile, subscription, payments, orders, usage and
 * history. Revokes all sessions immediately. No permanent data deletion.
 */
function softDeleteAccount(account, { reason } = {}) {
  if (!account) throw new Error('Unknown account');
  load();
  const now = Date.now();
  const email = account.email || account.contactEmail || account.deletedEmail || account.recoveryEmail || null;
  account.deletedAt = now;
  account.deletedEmail = email ? String(email).toLowerCase() : (account.deletedEmail || null);
  account.recoveryEmail = account.deletedEmail;
  account.deletedReason = reason ? String(reason).slice(0, 300) : null;
  account.status = 'deleted';
  account.retentionUntil = now + DELETED_RETENTION_DAYS * DAY_MS;
  account.recoveryTicketHash = null;
  account.recoveryTicketExpiresAt = null;
  account.updatedAt = now;
  // Revoke all sessions so the old account cannot be accessed normally.
  db.sessions = db.sessions.filter(s => s.accountId !== account.id);
  save();
  return account;
}

/**
 * Restore a previously soft-deleted account in place.
 * Subscription and stored SaaS data remain intact; effective access is
 * resolved by existing subscription/plan logic.
 */
function recoverDeletedAccount(account) {
  if (!account) throw new Error('Unknown account');
  load();
  const email = account.deletedEmail || account.recoveryEmail || account.archivedEmail || account.email || account.contactEmail || null;
  if (email) {
    account.email = normalizeEmail(email) || account.email || null;
    if (!account.contactEmail) account.contactEmail = account.email;
  }
  // If this record was archived to free the email for a fresh account, it
  // cannot be reactivated in place (would duplicate active email).
  if (account.replacedByAccountId) {
    throw new Error('This deleted account was replaced by a new account and cannot be restored in place.');
  }
  account.status = 'active';
  account.deletedAt = null;
  account.deletedReason = null;
  account.retentionUntil = null;
  account.recoveryTicketHash = null;
  account.recoveryTicketExpiresAt = null;
  // Invalidate remembered device auto-login links to avoid confusion;
  // the recovering device/session will be attached explicitly.
  account.deviceIds = [];
  account.updatedAt = Date.now();
  save();
  return account;
}

/**
 * Keep old deleted account/data preserved but free the email for a brand new
 * account. Returns the newly created fresh account.
 */
function startFreshFromDeleted(deletedAccount, { deviceId } = {}) {
  if (!deletedAccount) throw new Error('Unknown account');
  load();
  const email = normalizeEmail(deletedAccount.deletedEmail || deletedAccount.recoveryEmail || deletedAccount.archivedEmail || deletedAccount.email || deletedAccount.contactEmail);
  if (!email) throw new Error('Deleted account has no recoverable email.');

  // Archive old record: preserve all SaaS data, remove active login ownership.
  deletedAccount.archivedEmail = email;
  deletedAccount.email = null;
  deletedAccount.contactEmail = null;
  deletedAccount.passwordHash = null; // cannot be used to sign into archived record
  deletedAccount.deviceIds = [];
  deletedAccount.recoveryTicketHash = null;
  deletedAccount.recoveryTicketExpiresAt = null;
  deletedAccount.updatedAt = Date.now();

  const fresh = createAccount({
    email,
    contactEmail: email,
    name: deletedAccount.name || 'Shop Owner',
    storeName: 'Hisaab Store',
    role: 'owner',
    deviceIds: deviceId && isValidDeviceIdValue(deviceId) ? [String(deviceId)] : [],
    subscription: defaultFreeSubscription(),
    usage: {},
    productCount: 0
  });
  fresh.startedFreshAt = Date.now();
  fresh.recoveredFromAccountId = deletedAccount.id;
  deletedAccount.replacedByAccountId = fresh.id;
  save();
  return fresh;
}

function isValidDeviceIdValue(value) {
  const d = String(value == null ? '' : value).slice(0, 128);
  return /^[A-Za-z0-9_-]{8,128}$/.test(d);
}

function publicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    email: account.email || null,
    contactEmail: account.contactEmail || null,
    name: account.name,
    storeName: account.storeName,
    phone: account.phone || null,
    role: account.role,
    status: account.status,
    createdAt: account.createdAt,
    lastSeenAt: account.lastSeenAt,
    lastLoginAt: account.lastLoginAt || null,
    productCount: account.productCount || 0,
    hasPassword: !!account.passwordHash,
    deviceCount: (account.deviceIds || []).length
  };
}

/* ─── Sessions ─────────────────────────────────────────────── */

function createSession(accountId) {
  load();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    id: randomId('sess_'),
    tokenHash: sha256(token),
    accountId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now
  };
  db.sessions.push(session);
  // keep the session table tidy
  db.sessions = db.sessions.filter(s => s.expiresAt > now);
  const account = db.accounts.find(a => a.id === accountId);
  if (account) account.lastLoginAt = now;
  save();
  return { token, session };
}

function getSessionAccount(token) {
  load();
  if (!token) return null;
  const hash = sha256(token);
  const session = db.sessions.find(s => s.tokenHash === hash);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    db.sessions = db.sessions.filter(s => s.id !== session.id);
    save();
    return null;
  }
  const account = findAccountById(session.accountId);
  if (!account) return null;
  session.lastSeenAt = Date.now();
  account.lastSeenAt = Date.now();
  return { account, session };
}

function deleteSession(token) {
  load();
  const hash = sha256(token);
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.tokenHash !== hash);
  if (db.sessions.length !== before) save();
}

/** Revoke every active session for an account (used on block/suspend/delete). */
function revokeAccountSessions(accountId) {
  load();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.accountId !== accountId);
  const removed = before - db.sessions.length;
  if (removed) save();
  return removed;
}

/** Session metadata without the token hash (safe to show in Super Admin). */
function sessionsForAccount(accountId) {
  load();
  return db.sessions
    .filter(s => s.accountId === accountId)
    .map(s => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt }));
}

function pruneSessions() {
  load();
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.expiresAt > now);
  if (db.sessions.length !== before) save();
}

/* ─── Subscription ─────────────────────────────────────────── */

const SUB_ACCESS_STATUSES = ['active', 'trialing'];

function subscriptionHasAccess(sub) {
  if (!sub) return false;
  if (sub.planId === 'free') return true;
  if (SUB_ACCESS_STATUSES.indexOf(sub.status) !== -1) {
    return !sub.currentPeriodEnd || sub.currentPeriodEnd > Date.now();
  }
  // Cancelled subscriptions keep access until the paid period actually ends.
  if (sub.status === 'cancelled') return !!sub.currentPeriodEnd && sub.currentPeriodEnd > Date.now();
  return false;
}

/**
 * Returns the effective subscription. Handles expiry lazily so a
 * subscription that lapsed while the server was stopped is still
 * downgraded on the next request. `trialing` is admin-assigned and is
 * treated as paid access; `cancelled` keeps access until period end.
 */
function effectiveSubscription(account) {
  if (!account) return { planId: 'free', status: 'active', cycle: 'monthly' };
  if (!account.subscription) {
    account.subscription = defaultFreeSubscription();
    return account.subscription;
  }
  const sub = account.subscription;
  const now = Date.now();

  if (account.role === 'admin') {
    // Admins always have full access, without a paid subscription.
    return Object.assign({}, sub, { planId: 'pro', status: 'active', currentPeriodEnd: null });
  }

  if (sub.planId !== 'free' && sub.currentPeriodEnd) {
    if (SUB_ACCESS_STATUSES.indexOf(sub.status) !== -1 && sub.currentPeriodEnd <= now) {
      if (sub.cancelAtPeriodEnd) {
        account.subscription = defaultFreeSubscription();
        account.subscription.source = 'cancelled';
        account.subscription.updatedAt = now;
        account.updatedAt = now;
        save();
        return account.subscription;
      }
      account.subscription.status = 'expired';
      account.subscription.updatedAt = now;
      account.updatedAt = now;
      save();
    } else if (sub.status === 'cancelled' && sub.currentPeriodEnd <= now) {
      account.subscription = defaultFreeSubscription();
      account.subscription.source = 'cancelled';
      account.subscription.updatedAt = now;
      account.updatedAt = now;
      save();
      return account.subscription;
    }
  }

  return account.subscription;
}

/**
 * Plan object that should be used for limits/features right now.
 * An expired paid subscription falls back to Free.
 */
function effectivePlan(account) {
  if (!account) return getPlan('free');
  if (account.role === 'admin') return getPlan('pro');
  const sub = effectiveSubscription(account);
  if (sub.planId === 'free') return getPlan('free');
  if (subscriptionHasAccess(sub)) return getPlan(sub.planId) || getPlan('free');
  return getPlan('free');
}

function currentPlanVersion(planId) {
  try { return planCatalog.getCurrentVersion(planId); } catch (e) { return null; }
}

function activateSubscription(account, { planId, cycle, days, source, paymentId, status, planVersionId }) {
  const plan = getPlan(planId);
  if (!account || !plan) throw new Error('Unknown plan');
  const now = Date.now();
  const cur = account.subscription || {};
  const canStack = cur.planId === planId &&
    SUB_ACCESS_STATUSES.indexOf(cur.status) !== -1 &&
    cur.currentPeriodEnd &&
    cur.currentPeriodEnd > now;
  const base = canStack ? cur.currentPeriodEnd : now;
  const periodDays = Number(days) || (cycle === 'yearly' ? 365 : 30);
  const version = (planVersionId && planCatalog.getVersion(planVersionId)) || currentPlanVersion(planId);
  account.subscription = {
    planId,
    status: status === 'trialing' ? 'trialing' : 'active',
    cycle: cycle === 'yearly' ? 'yearly' : 'monthly',
    currentPeriodStart: now,
    currentPeriodEnd: base + periodDays * DAY_MS,
    cancelAtPeriodEnd: false,
    source: source || 'payment',
    lastPaymentId: paymentId || null,
    planVersionId: version ? version.id : null,
    planVersionLabel: version ? version.label : null,
    updatedAt: now
  };
  account.updatedAt = now;
  return account.subscription;
}

function setFreePlan(account, source) {
  const version = currentPlanVersion('free');
  account.subscription = defaultFreeSubscription();
  account.subscription.source = source || 'admin';
  account.subscription.planVersionId = version ? version.id : null;
  account.subscription.planVersionLabel = version ? version.label : null;
  account.updatedAt = Date.now();
  return account.subscription;
}

/**
 * Change the current subscription period without creating a second
 * subscription record. Used by the Super Admin "extend expiry" action.
 */
function extendSubscription(account, { days, until } = {}) {
  if (!account) throw new Error('Unknown account');
  const now = Date.now();
  const cur = account.subscription || defaultFreeSubscription();
  const base = Math.max(now, Number(cur.currentPeriodEnd) || 0);
  const explicit = until ? Number(until) : 0;
  const end = explicit > 0 ? explicit : base + Math.max(1, Math.min(3650, Number(days) || 30)) * DAY_MS;
  account.subscription = Object.assign({}, cur, {
    status: (cur.status === 'expired' || cur.status === 'cancelled') ? 'active' : (cur.status || 'active'),
    currentPeriodStart: cur.currentPeriodStart || now,
    currentPeriodEnd: Math.max(end, now + DAY_MS),
    cancelAtPeriodEnd: false,
    updatedAt: now
  });
  account.updatedAt = now;
  return account.subscription;
}

/**
 * Set a subscription status allowed by the admin module:
 * active | trialing | expired | cancelled.
 * Re-activating a paid plan with no future period gives a fresh period.
 */
function setSubscriptionStatus(account, status, { days } = {}) {
  if (!account) throw new Error('Unknown account');
  const allowed = ['active', 'trialing', 'expired', 'cancelled'];
  const next = String(status || '').toLowerCase();
  if (allowed.indexOf(next) === -1) throw new Error('Invalid subscription status');
  const now = Date.now();
  const cur = account.subscription || defaultFreeSubscription();
  if (cur.planId === 'free' && next !== 'active') {
    throw new Error('Free plan subscriptions can only be Active.');
  }
  cur.status = next;
  if (next === 'cancelled') {
    cur.cancelAtPeriodEnd = true;
  }
  if (next === 'active' || next === 'trialing') {
    cur.cancelAtPeriodEnd = false;
    if (cur.planId !== 'free' && (!cur.currentPeriodEnd || cur.currentPeriodEnd <= now)) {
      cur.currentPeriodStart = now;
      cur.currentPeriodEnd = now + Math.max(1, Math.min(3650, Number(days) || 30)) * DAY_MS;
    }
  }
  cur.updatedAt = now;
  account.subscription = cur;
  account.updatedAt = now;
  return cur;
}

/** Append an audit-friendly subscription history entry (max 100). */
function appendSubscriptionHistory(account, entry) {
  if (!account) return null;
  if (!Array.isArray(account.subscriptionHistory)) account.subscriptionHistory = [];
  const row = Object.assign({ id: randomId('subh_'), at: Date.now() }, entry || {});
  account.subscriptionHistory.push(row);
  if (account.subscriptionHistory.length > 100) {
    account.subscriptionHistory = account.subscriptionHistory.slice(-100);
  }
  return row;
}

function subscriptionHistoryOf(account) {
  if (!account || !Array.isArray(account.subscriptionHistory)) return [];
  return account.subscriptionHistory.slice().reverse();
}

function daysLeft(sub) {
  if (!sub || !sub.currentPeriodEnd) return null;
  return Math.max(0, Math.ceil((sub.currentPeriodEnd - Date.now()) / DAY_MS));
}

/* ─── Usage ────────────────────────────────────────────────── */

function periodKey(date) {
  const d = date ? new Date(date) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthBounds(date) {
  const d = date ? new Date(date) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end };
}

function usageCounter(account, key) {
  if (!account.usage || typeof account.usage !== 'object') account.usage = {};
  const pk = periodKey();
  if (!account.usage[pk]) account.usage[pk] = {};
  if (!account.usage[pk][key]) account.usage[pk][key] = 0;
  return account.usage[pk][key];
}

function incrementUsage(account, key, amount) {
  if (!account.usage || typeof account.usage !== 'object') account.usage = {};
  const pk = periodKey();
  if (!account.usage[pk]) account.usage[pk] = {};
  account.usage[pk][key] = (account.usage[pk][key] || 0) + (Number(amount) || 0);
  return account.usage[pk][key];
}

function appendUsage(account, entry) {
  load();
  const row = {
    id: randomId('use_'),
    accountId: account.id,
    kind: entry.kind,
    quantity: entry.quantity == null ? 1 : Number(entry.quantity) || 0,
    meta: entry.meta || {},
    period: periodKey(),
    createdAt: Date.now()
  };
  db.usage.push(row);
  if (db.usage.length > MAX_USAGE_ENTRIES) {
    db.usage = db.usage.slice(db.usage.length - MAX_USAGE_ENTRIES);
  }
  incrementUsage(account, entry.kind === 'products' ? 'products' : entry.kind, row.quantity);
  account.updatedAt = Date.now();
  save();
  return row;
}

function listUsage(accountId, { limit = 100, kind = null } = {}) {
  load();
  let rows = db.usage.filter(u => !accountId || u.accountId === accountId);
  if (kind) rows = rows.filter(u => u.kind === kind);
  return rows.slice(-Math.max(1, Math.min(1000, Number(limit) || 100))).reverse();
}

function allUsage() {
  load();
  return db.usage;
}

/* ─── Orders & payments ────────────────────────────────────── */

function createOrder(account, { planId, cycle, amount, currency, provider, providerOrderId, providerPayload }) {
  load();
  const now = Date.now();
  const order = {
    id: randomId('ord_'),
    accountId: account.id,
    planId,
    cycle,
    amount,
    currency: currency || 'INR',
    provider,
    providerOrderId,
    providerPayload: providerPayload || null,
    status: 'pending',
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
    paidAt: null,
    paymentId: null
  };
  db.orders.push(order);
  save();
  return order;
}

function findOrder(id) {
  load();
  return db.orders.find(o => o.id === id) || null;
}

function findOrderByProviderId(providerOrderId) {
  load();
  return db.orders.find(o => o.providerOrderId === providerOrderId) || null;
}

function updateOrder(order, patch) {
  Object.assign(order, patch);
  save();
  return order;
}

function createPayment(fields) {
  load();
  const payment = {
    id: randomId('pay_'),
    orderId: fields.orderId,
    accountId: fields.accountId,
    amount: fields.amount,
    currency: fields.currency || 'INR',
    provider: fields.provider,
    providerPaymentId: fields.providerPaymentId,
    signatureVerified: true,
    status: 'captured',
    createdAt: Date.now()
  };
  db.payments.push(payment);
  save();
  return payment;
}

function findPaymentByProviderId(providerPaymentId) {
  load();
  return db.payments.find(p => p.providerPaymentId === providerPaymentId) || null;
}

function listPayments(accountId, limit) {
  load();
  const rows = accountId ? db.payments.filter(p => p.accountId === accountId) : db.payments.slice();
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit || 50);
}

function hasWebhookEvent(id) {
  load();
  if (!id) return false;
  return db.webhookEvents.some(e => e.id === id);
}

function recordWebhookEvent(id, type) {
  load();
  db.webhookEvents.push({ id, type: type || '', createdAt: Date.now() });
  if (db.webhookEvents.length > 5000) db.webhookEvents = db.webhookEvents.slice(-5000);
  save();
}

/* ─── Admin seed ───────────────────────────────────────────── */

function seedAdmin() {
  load();
  const runtimeConfig = require('../server/runtime-config');
  const adminCfg = runtimeConfig.adminConfig();
  const email = normalizeEmail(adminCfg.adminEmail || 'admin@hisaab.local') || 'admin@hisaab.local';
  const existing = findAccountByEmail(email);
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      save();
    }
    return existing;
  }

  const usingProvided = !!adminCfg.adminPasswordProvided;
  const password = usingProvided ? adminCfg.adminPassword : adminCfg.devAdminPassword;
  if (runtimeConfig.isProduction && !usingProvided) {
    throw new Error('ADMIN_PASSWORD must be configured in production before seeding the admin account.');
  }

  const { hashPassword } = require('./auth');
  const admin = createAccount({
    email,
    name: adminCfg.adminName || 'Hisaab Admin',
    storeName: 'Hisaab HQ',
    role: 'admin',
    passwordHash: hashPassword(password),
    subscription: {
      planId: 'pro',
      status: 'active',
      cycle: 'yearly',
      currentPeriodStart: Date.now(),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      source: 'admin',
      updatedAt: Date.now()
    }
  });

  if (runtimeConfig.isProduction) {
    console.log('[SAAS] Admin account created → ' + email + ' (password provided via environment variable)');
  } else {
    console.log('[SAAS] Admin account created → ' + email +
      (usingProvided ? ' (password from ADMIN_PASSWORD)' : ' (development default password)'));
  }
  return admin;
}

/* ─── Maintenance ──────────────────────────────────────────── */

function sweepExpiredSubscriptions() {
  load();
  let changed = 0;
  const now = Date.now();
  db.accounts.forEach(acc => {
    if (!acc.subscription) return;
    const sub = acc.subscription;
    if (sub.planId === 'free' || acc.role === 'admin') return;
    if (SUB_ACCESS_STATUSES.indexOf(sub.status) === -1 || !sub.currentPeriodEnd || sub.currentPeriodEnd > now) return;
    if (sub.cancelAtPeriodEnd) {
      acc.subscription = defaultFreeSubscription();
      acc.subscription.source = 'cancelled';
    } else {
      sub.status = 'expired';
    }
    acc.subscription.updatedAt = now;
    acc.updatedAt = now;
    changed++;
  });
  if (changed) save();
  return changed;
}

function statsSnapshot() {
  load();
  return {
    accounts: db.accounts.length,
    sessions: db.sessions.length,
    orders: db.orders.length,
    payments: db.payments.length,
    usage: db.usage.length
  };
}

module.exports = {
  DATA_DIR,
  DB_FILE,
  DAY_MS,
  DELETED_RETENTION_DAYS,
  load,
  save,
  randomId,
  sha256,
  normalizeEmail,
  isDeletedAccount,
  isRecoverableDeletedAccount,
  createAccount,
  findAccountById,
  findAccountByEmail,
  findAnyAccountByEmail,
  findRecoverableDeletedAccountByEmail,
  findAccountByDevice,
  addDevice,
  removeAccount,
  softDeleteAccount,
  recoverDeletedAccount,
  startFreshFromDeleted,
  createRecoveryTicket,
  consumeRecoveryTicket,
  publicAccount,
  createSession,
  getSessionAccount,
  deleteSession,
  revokeAccountSessions,
  sessionsForAccount,
  pruneSessions,
  defaultFreeSubscription,
  effectiveSubscription,
  effectivePlan,
  subscriptionHasAccess,
  activateSubscription,
  setFreePlan,
  extendSubscription,
  setSubscriptionStatus,
  appendSubscriptionHistory,
  subscriptionHistoryOf,
  daysLeft,
  periodKey,
  monthBounds,
  usageCounter,
  incrementUsage,
  appendUsage,
  listUsage,
  allUsage,
  createOrder,
  findOrder,
  findOrderByProviderId,
  updateOrder,
  createPayment,
  findPaymentByProviderId,
  listPayments,
  hasWebhookEvent,
  recordWebhookEvent,
  seedAdmin,
  sweepExpiredSubscriptions,
  statsSnapshot
};
