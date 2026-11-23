'use strict';

/**
 * Super Admin — User administration service.
 *
 * Operates strictly on the existing SaaS store (accounts, sessions, orders,
 * payments, usage) and the shared plan catalogue. Business data (products,
 * customers, sales, settings) lives inside each POS device's local storage and
 * is intentionally NOT touched here; see dataSummary() for the exact split.
 *
 * Every mutating method is called only after the route layer has enforced
 * authentication + permission, and every method returns a sanitized view:
 * password hashes, session token hashes and provider payloads never leave this
 * module.
 */

const store = require('../store');
const planCatalog = require('../plans/catalog.service');
const { getPlan } = require('../plans');
const audit = require('../audit/audit.service');

const ACCOUNT_STATUSES = ['active', 'blocked', 'suspended'];
const SUBSCRIPTION_STATUSES = ['active', 'trialing', 'expired', 'cancelled'];
const PURGE_SCOPES = ['usage_history', 'sessions', 'devices', 'pending_orders'];
const DAY_MS = 24 * 60 * 60 * 1000;

class UserAdminError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.name = 'UserAdminError';
    this.status = status;
    this.code = code || 'error';
    this.details = details || null;
  }
}

function iso(ts) {
  if (!ts) return null;
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function clampInt(value, fallback, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function shortText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 200);
}

function normalizePhone(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+\-()\s]/g, '');
  if (!cleaned || cleaned.replace(/\D/g, '').length < 5) {
    throw new UserAdminError(400, 'Enter a valid contact number.', 'invalid_phone');
  }
  return cleaned.slice(0, 24);
}

function planName(planId) {
  const def = planCatalog.getPlan(planId);
  return def ? def.name : String(planId || 'free');
}

function subSnapshot(sub) {
  const s = sub || {};
  return {
    planId: s.planId || 'free',
    status: s.status || 'active',
    cycle: s.cycle || 'monthly',
    currentPeriodStart: s.currentPeriodStart || null,
    currentPeriodEnd: s.currentPeriodEnd || null,
    cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
    source: s.source || 'default',
    planVersionId: s.planVersionId || null,
    planVersionLabel: s.planVersionLabel || null
  };
}

/** Safe audit/API snapshot — no password hashes, tokens or device identifiers. */
function safeSnapshot(account) {
  if (!account) return null;
  return {
    id: account.id,
    name: account.name || null,
    email: account.email || null,
    contactEmail: account.contactEmail || null,
    phone: account.phone || null,
    storeName: account.storeName || null,
    role: account.role || 'owner',
    status: account.status || 'active',
    createdAt: account.createdAt || null,
    lastLoginAt: account.lastLoginAt || null,
    lastSeenAt: account.lastSeenAt || null,
    productCount: Number(account.productCount) || 0,
    deviceCount: (account.deviceIds || []).length,
    subscription: subSnapshot(account.subscription)
  };
}

function accountView(account) {
  const snap = safeSnapshot(account);
  if (!snap) return null;
  return Object.assign(snap, {
    createdAt: iso(snap.createdAt),
    lastLoginAt: iso(snap.lastLoginAt),
    lastSeenAt: iso(snap.lastSeenAt),
    hasPassword: !!account.passwordHash,
    isProtected: account.role === 'admin'
  });
}

function requireAccount(id) {
  const account = store.findAccountById(shortText(id, 120));
  if (!account) throw new UserAdminError(404, 'User not found.', 'not_found');
  return account;
}

function actorId(actor) {
  return actor && (actor.accountId || actor.actorAdminId) ? (actor.accountId || actor.actorAdminId) : null;
}

function assertMutable(account, actor) {
  const who = actorId(actor);
  if (who && account.id === who) {
    throw new UserAdminError(400, 'You cannot perform this action on your own account.', 'self_action');
  }
  if (account.role === 'admin') {
    throw new UserAdminError(403, 'Platform administrator accounts are protected from user-management actions.', 'protected_account');
  }
}

function assertConfirm(account, confirm) {
  const value = String(confirm == null ? '' : confirm).trim().toLowerCase();
  if (!value) throw new UserAdminError(400, 'A confirmation value is required.', 'confirm_required');
  const accepted = [account.id, account.email, account.contactEmail]
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase());
  if (accepted.indexOf(value) === -1) {
    throw new UserAdminError(400, 'Confirmation does not match the selected user id or email.', 'confirm_mismatch');
  }
}

function appendHistory(account, entry) {
  store.appendSubscriptionHistory(account, entry);
}

/* ─── Listing ──────────────────────────────────────────────── */

function deriveRow(account) {
  const now = Date.now();
  const sub = store.effectiveSubscription(account) || {};
  const effective = store.effectivePlan(account) || getPlan('free');
  const sessions = store.sessionsForAccount(account.id).filter(s => (s.expiresAt || 0) > now);
  return {
    id: account.id,
    name: account.name || 'Shop Owner',
    email: account.email || account.contactEmail || null,
    contactEmail: account.contactEmail || null,
    phone: account.phone || null,
    business: account.storeName || null,
    role: account.role || 'owner',
    status: account.status || 'active',
    accountStatus: account.status || 'active',
    plan: sub.planId || 'free',
    planName: planName(sub.planId || 'free'),
    effectivePlan: effective.id,
    subscriptionStatus: sub.status || 'active',
    cycle: sub.cycle || 'monthly',
    currentPeriodStart: iso(sub.currentPeriodStart),
    currentPeriodEnd: iso(sub.currentPeriodEnd),
    daysLeft: store.daysLeft(sub),
    cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
    subscriptionSource: sub.source || 'default',
    registeredAt: iso(account.createdAt),
    lastLoginAt: iso(account.lastLoginAt),
    lastSeenAt: iso(account.lastSeenAt),
    productCount: Number(account.productCount) || 0,
    hasPassword: !!account.passwordHash,
    deviceCount: (account.deviceIds || []).length,
    activeSessions: sessions.length,
    isProtected: account.role === 'admin'
  };
}

function listAccounts(query) {
  const q = shortText(query && query.q, 120).toLowerCase();
  const statusFilter = shortText(query && (query.status || query.accountStatus), 24).toLowerCase();
  const planFilter = shortText(query && query.plan, 80).toLowerCase();
  const subscriptionFilter = shortText(query && (query.subscriptionStatus || query.subscription), 24).toLowerCase();
  const sort = shortText(query && query.sort, 40) || 'createdAt';
  const dir = shortText(query && query.dir, 4).toLowerCase() === 'asc' ? 'asc' : 'desc';
  const page = clampInt(query && query.page, 1, 1, 1000000);
  const pageSize = clampInt(query && query.pageSize, 10, 1, 100);

  const all = (store.load().accounts || []).slice();
  const stats = { total: all.length, active: 0, blocked: 0, suspended: 0, trial: 0, expired: 0, cancelled: 0, paid: 0, free: 0 };
  all.forEach(acc => {
    const sub = store.effectiveSubscription(acc) || {};
    const st = acc.status || 'active';
    if (stats[st] != null) stats[st]++;
    if (sub.status === 'trialing') stats.trial++;
    if (sub.status === 'expired') stats.expired++;
    if (sub.status === 'cancelled') stats.cancelled++;
    if ((sub.planId || 'free') === 'free') stats.free++; else stats.paid++;
  });

  let rows = all.filter(account => {
    if (q) {
      const hay = [account.id, account.name, account.email, account.contactEmail, account.phone, account.storeName]
        .map(v => String(v || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    if (statusFilter && statusFilter !== 'all' && String(account.status || 'active') !== statusFilter) return false;
    if (planFilter && planFilter !== 'all') {
      const sub = store.effectiveSubscription(account) || {};
      if (String(sub.planId || 'free') !== planFilter) return false;
    }
    if (subscriptionFilter && subscriptionFilter !== 'all') {
      const sub = store.effectiveSubscription(account) || {};
      const current = sub.status || 'active';
      if (subscriptionFilter === 'trial') { if (current !== 'trialing') return false; }
      else if (current !== subscriptionFilter) return false;
    }
    return true;
  }).map(deriveRow);

  const sorters = {
    name: r => String(r.name || '').toLowerCase(),
    email: r => String(r.email || '').toLowerCase(),
    business: r => String(r.business || '').toLowerCase(),
    plan: r => String(r.plan || ''),
    subscriptionStatus: r => String(r.subscriptionStatus || ''),
    status: r => String(r.status || ''),
    createdAt: r => Date.parse(r.registeredAt || 0) || 0,
    registeredAt: r => Date.parse(r.registeredAt || 0) || 0,
    lastLoginAt: r => Date.parse(r.lastLoginAt || 0) || 0,
    lastSeenAt: r => Date.parse(r.lastSeenAt || 0) || 0,
    products: r => Number(r.productCount) || 0,
    productCount: r => Number(r.productCount) || 0
  };
  const get = sorters[sort] || sorters.createdAt;
  rows.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  const total = rows.length;
  const items = rows.slice((page - 1) * pageSize, page * pageSize);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), stats, meta: { source: 'saas_json' } };
}

/* ─── Detail / history ─────────────────────────────────────── */

function ledgerFor(accountId, limit) {
  return store.listUsage(accountId, { limit: limit || 50 }).map(row => ({
    id: row.id,
    kind: row.kind,
    quantity: row.quantity,
    meta: row.meta || {},
    period: row.period,
    createdAt: iso(row.createdAt)
  }));
}

function paymentsFor(accountId) {
  return store.listPayments(accountId, 100).map(p => ({
    id: p.id,
    orderId: p.orderId,
    amount: p.amount,
    currency: p.currency,
    provider: p.provider,
    providerPaymentId: p.providerPaymentId,
    status: p.status,
    signatureVerified: !!p.signatureVerified,
    createdAt: iso(p.createdAt)
  }));
}

function ordersFor(accountId) {
  return (store.load().orders || [])
    .filter(o => o.accountId === accountId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 100)
    .map(o => ({
      id: o.id,
      planId: o.planId,
      cycle: o.cycle,
      amount: o.amount,
      currency: o.currency,
      provider: o.provider,
      status: o.status,
      createdAt: iso(o.createdAt),
      paidAt: iso(o.paidAt)
    }));
}

function dataSummary(accountId) {
  const account = requireAccount(accountId);
  const db = store.load();
  const usageRows = (db.usage || []).filter(u => u.accountId === account.id);
  const paymentRows = (db.payments || []).filter(p => p.accountId === account.id);
  const orderRows = (db.orders || []).filter(o => o.accountId === account.id);
  const pendingOrders = orderRows.filter(o => o.status === 'pending');
  const sessions = store.sessionsForAccount(account.id);
  const byKind = {};
  usageRows.forEach(row => { byKind[row.kind] = (byKind[row.kind] || 0) + (Number(row.quantity) || 0); });
  const items = [
    {
      key: 'products_inventory',
      label: 'Products & inventory',
      count: Number(account.productCount) || 0,
      supported: false,
      location: 'POS device (localStorage)',
      note: 'Product catalogue and stock live on the user’s device. The server only keeps the product-count mirror used for plan limits.'
    },
    {
      key: 'customers_suppliers',
      label: 'Customers & suppliers',
      count: Number(account.customerCount) || 0,
      supported: false,
      location: 'POS device (localStorage)',
      note: 'Customer/supplier records are device-local and are not stored on this server.'
    },
    {
      key: 'sales_purchases_invoices',
      label: 'Sales, purchases, invoices & transactions',
      count: Number(byKind.bill) || 0,
      supported: false,
      location: 'POS device (localStorage)',
      note: 'Business transactions are device-local. Only metering counters (bills/returns/exports) exist server-side.'
    },
    {
      key: 'accounting_financial',
      label: 'Accounting & subscription financial records',
      count: paymentRows.length + orderRows.length,
      supported: false,
      location: 'SaaS store',
      note: 'Captured payments and paid orders are retained for financial/compliance history and cannot be purged here.'
    },
    {
      key: 'files_images',
      label: 'Uploaded files & images',
      count: 0,
      supported: false,
      location: 'POS device / invoice links',
      note: 'Store logos and bill images are device-local. Public invoice PDF links are not linked to an account, so they cannot be scoped safely.'
    },
    {
      key: 'settings_preferences',
      label: 'Settings & preferences',
      count: 0,
      supported: false,
      location: 'POS device (localStorage)',
      note: 'POS settings are device-local and untouched by account actions.'
    },
    {
      key: 'usage_history',
      label: 'Subscription usage ledger',
      count: usageRows.length,
      supported: true,
      location: 'SaaS store',
      note: 'Server-side metering entries and monthly counters for this account.'
    },
    {
      key: 'sessions',
      label: 'Active sign-in sessions',
      count: sessions.length,
      supported: true,
      location: 'SaaS store',
      note: 'Revoking sessions signs the user out of existing devices immediately.'
    },
    {
      key: 'devices',
      label: 'Registered devices',
      count: (account.deviceIds || []).length,
      supported: true,
      location: 'SaaS store',
      note: 'Device ids linked to the billing account.'
    },
    {
      key: 'pending_orders',
      label: 'Pending billing orders',
      count: pendingOrders.length,
      supported: true,
      location: 'SaaS store',
      note: 'Unpaid/pending orders only. Captured payments are preserved.'
    }
  ];
  return {
    accountId: account.id,
    totals: {
      usageEntries: usageRows.length,
      payments: paymentRows.length,
      paidOrders: orderRows.filter(o => o.status !== 'pending').length,
      pendingOrders: pendingOrders.length,
      sessions: sessions.length,
      devices: (account.deviceIds || []).length,
      products: Number(account.productCount) || 0,
      usageByKind: byKind
    },
    purgeScopes: PURGE_SCOPES.slice(),
    items
  };
}

function detail(accountId) {
  const account = requireAccount(accountId);
  const sub = store.effectiveSubscription(account) || store.defaultFreeSubscription();
  const effective = store.effectivePlan(account) || getPlan('free');
  const def = planCatalog.getPlan(sub.planId || 'free');
  const ver = sub.planVersionId ? planCatalog.getVersion(sub.planVersionId) : planCatalog.getCurrentVersion(sub.planId || 'free');
  let entitlements = null;
  try {
    const ent = require('../entitlements/entitlement.service').resolveForAccount(account);
    entitlements = {
      features: ent.features || [],
      limits: ent.limits || {},
      usage: ent.usage || {},
      planId: ent.planId || null,
      planVersionId: ent.planVersionId || null
    };
  } catch (e) { entitlements = null; }
  return {
    account: accountView(account),
    subscription: Object.assign(subSnapshot(sub), {
      effectivePlanId: effective.id,
      daysLeft: store.daysLeft(sub),
      hasAccess: store.subscriptionHasAccess(sub)
    }),
    plan: def ? {
      id: def.id,
      name: def.name,
      description: def.description || '',
      status: def.status,
      availableForNew: def.availableForNew !== false,
      versionId: ver ? ver.id : null,
      versionLabel: ver ? ver.label : null,
      features: ver ? (ver.features || []) : [],
      limits: ver ? (ver.limits || {}) : {},
      flags: ver ? (ver.flags || {}) : {}
    } : null,
    entitlements,
    planOptions: planCatalog.listPlans()
      .filter(p => p.status !== 'archived')
      .map(p => ({ id: p.id, name: p.name, status: p.status, availableForNew: p.availableForNew !== false })),
    payments: paymentsFor(account.id),
    orders: ordersFor(account.id),
    subscriptionHistory: store.subscriptionHistoryOf(account),
    usageLedger: ledgerFor(account.id, 50),
    sessions: store.sessionsForAccount(account.id),
    data: dataSummary(account.id)
  };
}

function history(accountId) {
  const account = requireAccount(accountId);
  const audits = audit.query({ entityType: 'account', entityId: account.id, limit: 100 });
  return {
    accountId: account.id,
    subscriptionHistory: store.subscriptionHistoryOf(account),
    payments: paymentsFor(account.id),
    orders: ordersFor(account.id),
    audit: audits.items.map(e => ({
      id: e.id,
      occurredAt: e.occurredAt,
      action: e.action,
      actorEmail: e.actorEmail,
      actorRole: e.actorRole,
      entityType: e.entityType,
      entityId: e.entityId,
      before: e.before,
      after: e.after,
      metadata: e.metadata
    })),
    totalAudit: audits.total
  };
}

/* ─── Account mutations ────────────────────────────────────── */

function updateAccount(accountId, patch, actor) {
  const account = requireAccount(accountId);
  assertMutable(account, actor);
  const before = safeSnapshot(account);
  const input = patch || {};
  const changes = [];

  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    const next = shortText(input.name, 120);
    if (!next) throw new UserAdminError(400, 'Name cannot be empty.', 'invalid_name');
    if (next !== account.name) { account.name = next; changes.push('name'); }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'storeName')) {
    const next = shortText(input.storeName, 160);
    if (!next) throw new UserAdminError(400, 'Business name cannot be empty.', 'invalid_store_name');
    if (next !== account.storeName) { account.storeName = next; changes.push('storeName'); }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'phone')) {
    const next = normalizePhone(input.phone);
    if (next !== (account.phone || null)) { account.phone = next; changes.push('phone'); }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'email')) {
    const raw = shortText(input.email, 254);
    const next = raw ? store.normalizeEmail(raw) : null;
    if (raw && !next) throw new UserAdminError(400, 'Enter a valid email address.', 'invalid_email');
    if (next) {
      const db = store.load();
      const dup = (db.accounts || []).find(a =>
        a.id !== account.id &&
        [a.email, a.contactEmail].filter(Boolean).some(v => String(v).toLowerCase() === next)
      );
      if (dup) throw new UserAdminError(409, 'Another user already uses this email.', 'email_taken');
    }
    if (next !== (account.email || null)) { account.email = next; changes.push('email'); }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'contactEmail')) {
    const raw = shortText(input.contactEmail, 254);
    const next = raw ? store.normalizeEmail(raw) : null;
    if (raw && !next) throw new UserAdminError(400, 'Enter a valid contact email address.', 'invalid_email');
    if (next) {
      const db = store.load();
      const dup = (db.accounts || []).find(a =>
        a.id !== account.id &&
        [a.email, a.contactEmail].filter(Boolean).some(v => String(v).toLowerCase() === next)
      );
      if (dup) throw new UserAdminError(409, 'Another user already uses this email.', 'email_taken');
    }
    if (next !== (account.contactEmail || null)) { account.contactEmail = next; changes.push('contactEmail'); }
  }

  if (!changes.length) {
    throw new UserAdminError(400, 'No permitted changes were supplied.', 'no_changes', { permitted: ['name', 'storeName', 'phone', 'email', 'contactEmail'] });
  }
  account.updatedAt = Date.now();
  store.save();
  const after = safeSnapshot(account);
  audit.append(Object.assign({}, actor || {}, {
    action: 'users.edit',
    entityType: 'account',
    entityId: account.id,
    entityLabel: account.email || account.contactEmail || account.id,
    before,
    after,
    metadata: { changed: changes }
  }));
  return { account: accountView(account), changed: changes, audit: { before, after } };
}

function setAccountStatus(accountId, status, options, actor) {
  const account = requireAccount(accountId);
  assertMutable(account, actor);
  const next = String(status || '').toLowerCase();
  if (ACCOUNT_STATUSES.indexOf(next) === -1) {
    throw new UserAdminError(400, 'Invalid account status.', 'invalid_status', { allowed: ACCOUNT_STATUSES });
  }
  const before = safeSnapshot(account);
  account.status = next;
  account.updatedAt = Date.now();
  let revoked = 0;
  if (next === 'blocked' || next === 'suspended') revoked = store.revokeAccountSessions(account.id);
  store.save();
  const after = safeSnapshot(account);
  const action = next === 'blocked' ? 'users.block'
    : next === 'suspended' ? 'users.suspend'
      : (before.status === 'blocked' ? 'users.unblock' : 'users.reactivate');
  audit.append(Object.assign({}, actor || {}, {
    action,
    entityType: 'account',
    entityId: account.id,
    entityLabel: account.email || account.contactEmail || account.id,
    before,
    after,
    metadata: {
      reason: shortText(options && options.reason, 300) || null,
      revokedSessions: revoked,
      dataPreserved: true
    }
  }));
  return { account: accountView(account), status: next, revokedSessions: revoked, dataPreserved: true };
}

/* ─── Subscription mutations ───────────────────────────────── */

function changePlan(accountId, payload, actor) {
  const account = requireAccount(accountId);
  assertMutable(account, actor);
  const input = payload || {};
  const planId = shortText(input.planId, 80).toLowerCase();
  const def = planCatalog.getPlan(planId);
  if (!def || def.status === 'archived') {
    throw new UserAdminError(400, 'Choose an available plan.', 'bad_plan');
  }
  const days = clampInt(input.days, 30, 1, 3650);
  const cycle = String(input.cycle || '').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const before = safeSnapshot(account);
  const previous = subSnapshot(account.subscription);

  if (planId === 'free') {
    store.setFreePlan(account, 'admin');
  } else {
    const version = planCatalog.getCurrentVersion(planId);
    store.activateSubscription(account, {
      planId,
      cycle,
      days,
      source: 'admin',
      status: input.status === 'trialing' ? 'trialing' : 'active',
      planVersionId: version ? version.id : null
    });
  }
  account.updatedAt = Date.now();
  const afterSub = subSnapshot(account.subscription);
  appendHistory(account, {
    action: 'plan_change',
    by: (actor && (actor.actorEmail || actor.actorAdminId)) || null,
    note: shortText(input.note, 300) || null,
    before: previous,
    after: afterSub
  });
  store.appendUsage(account, {
    kind: 'admin_grant',
    quantity: 1,
    meta: {
      planId,
      days,
      cycle,
      source: 'super_admin',
      by: (actor && (actor.actorAdminId || actor.actorEmail)) || 'unknown'
    }
  });
  store.save();
  const after = safeSnapshot(account);
  audit.append(Object.assign({}, actor || {}, {
    action: 'users.subscription.plan_change',
    entityType: 'account',
    entityId: account.id,
    entityLabel: account.email || account.contactEmail || account.id,
    before,
    after,
    metadata: { fromPlan: previous.planId, toPlan: planId, cycle, days, note: shortText(input.note, 300) || null }
  }));
  return { account: accountView(account), subscription: subSnapshot(account.subscription), previous, audit: { before, after } };
}

function extendSubscriptionExpiry(accountId, payload, actor) {
  const account = requireAccount(accountId);
  assertMutable(account, actor);
  const input = payload || {};
  const sub = account.subscription || store.defaultFreeSubscription();
  if ((sub.planId || 'free') === 'free') {
    throw new UserAdminError(400, 'The Free plan has no expiry date to extend. Assign a paid plan first.', 'free_plan');
  }
  const days = input.days != null ? clampInt(input.days, 0, 0, 3650) : null;
  let until = input.until ? Date.parse(input.until) : NaN;
  if (input.until && (!until || Number.isNaN(until))) {
    throw new UserAdminError(400, 'Enter a valid expiry date.', 'invalid_until');
  }
  if (until && until <= Date.now()) {
    throw new UserAdminError(400, 'The new expiry date must be in the future.', 'invalid_until');
  }
  if (!days && !until) {
    throw new UserAdminError(400, 'Provide a number of days or a new expiry date.', 'missing_expiry');
  }
  const before = safeSnapshot(account);
  const previous = subSnapshot(sub);
  store.extendSubscription(account, { days: days || undefined, until: until || undefined });
  account.updatedAt = Date.now();
  appendHistory(account, {
    action: 'expiry_extend',
    by: (actor && (actor.actorEmail || actor.actorAdminId)) || null,
    note: shortText(input.note, 300) || null,
    before: previous,
    after: subSnapshot(account.subscription)
  });
  store.save();
  const after = safeSnapshot(account);
  audit.append(Object.assign({}, actor || {}, {
    action: 'users.subscription.extend',
    entityType: 'account',
    entityId: account.id,
    entityLabel: account.email || account.contactEmail || account.id,
    before,
    after,
    metadata: { days: days || null, until: until ? iso(until) : null, note: shortText(input.note, 300) || null }
  }));
  return { account: accountView(account), subscription: subSnapshot(account.subscription), previous };
}

function changeSubscriptionStatus(accountId, payload, actor) {
  const account = requireAccount(accountId);
  assertMutable(account, actor);
  const input = payload || {};
  const status = String(input.status || '').toLowerCase();
  if (SUBSCRIPTION_STATUSES.indexOf(status) === -1) {
    throw new UserAdminError(400, 'Invalid subscription status.', 'invalid_status', { allowed: SUBSCRIPTION_STATUSES });
  }
  const days = clampInt(input.days, 30, 1, 3650);
  const before = safeSnapshot(account);
  const previous = subSnapshot(account.subscription);
  try {
    store.setSubscriptionStatus(account, status, { days });
  } catch (e) {
    throw new UserAdminError(400, e.message || 'Could not change subscription status.', 'invalid_status');
  }
  account.updatedAt = Date.now();
  appendHistory(account, {
    action: 'status_change',
    by: (actor && (actor.actorEmail || actor.actorAdminId)) || null,
    note: shortText(input.note || input.reason, 300) || null,
    before: previous,
    after: subSnapshot(account.subscription)
  });
  store.save();
  const after = safeSnapshot(account);
  audit.append(Object.assign({}, actor || {}, {
    action: 'users.subscription.status',
    entityType: 'account',
    entityId: account.id,
    entityLabel: account.email || account.contactEmail || account.id,
    before,
    after,
    metadata: { fromStatus: previous.status, toStatus: status, note: shortText(input.note || input.reason, 300) || null }
  }));
  return { account: accountView(account), subscription: subSnapshot(account.subscription), previous };
}

/* ─── Data purge & permanent deletion ──────────────────────── */

function purgeData(accountId, payload, actor) {
  const account = requireAccount(accountId);
  assertMutable(account, actor);
  const input = payload || {};
  assertConfirm(account, input.confirm);
  const scopes = Array.isArray(input.scopes) ? Array.from(new Set(input.scopes.map(s => String(s)))) : [];
  if (!scopes.length) throw new UserAdminError(400, 'Select at least one data category to delete.', 'no_scopes');
  const unsupported = scopes.filter(s => PURGE_SCOPES.indexOf(s) === -1);
  if (unsupported.length) {
    throw new UserAdminError(400, 'Some selected data categories cannot be deleted from the server.', 'unsupported_scope', { unsupported, allowed: PURGE_SCOPES });
  }
  const before = safeSnapshot(account);
  const db = store.load();
  const removed = { usage_history: 0, sessions: 0, devices: 0, pending_orders: 0 };

  if (scopes.indexOf('usage_history') !== -1) {
    const beforeCount = (db.usage || []).length;
    db.usage = (db.usage || []).filter(u => u.accountId !== account.id);
    removed.usage_history = beforeCount - db.usage.length;
    account.usage = {};
    account.productCount = 0;
    account.customerCount = 0;
  }
  if (scopes.indexOf('sessions') !== -1) {
    removed.sessions = store.revokeAccountSessions(account.id);
  }
  if (scopes.indexOf('devices') !== -1) {
    removed.devices = (account.deviceIds || []).length;
    account.deviceIds = [];
  }
  if (scopes.indexOf('pending_orders') !== -1) {
    const beforeCount = (db.orders || []).length;
    db.orders = (db.orders || []).filter(o => !(o.accountId === account.id && o.status === 'pending'));
    removed.pending_orders = beforeCount - db.orders.length;
  }
  account.updatedAt = Date.now();
  store.save();
  const after = safeSnapshot(account);
  audit.append(Object.assign({}, actor || {}, {
    action: 'users.data.purge',
    entityType: 'account',
    entityId: account.id,
    entityLabel: account.email || account.contactEmail || account.id,
    before,
    after,
    metadata: { scopes, removed }
  }));
  return { accountId: account.id, scopes, removed, data: dataSummary(account.id), audit: { before, after } };
}

function deleteAccount(accountId, payload, actor) {
  const account = requireAccount(accountId);
  assertMutable(account, actor);
  const input = payload || {};
  assertConfirm(account, input.confirm);
  const db = store.load();
  const before = safeSnapshot(account);
  const summary = {
    accountId: account.id,
    email: account.email || account.contactEmail || null,
    name: account.name || null,
    storeName: account.storeName || null,
    removed: {
      accounts: 1,
      sessions: (db.sessions || []).filter(s => s.accountId === account.id).length,
      orders: (db.orders || []).filter(o => o.accountId === account.id).length,
      payments: (db.payments || []).filter(p => p.accountId === account.id).length,
      usage: (db.usage || []).filter(u => u.accountId === account.id).length,
      subscriptionHistory: Array.isArray(account.subscriptionHistory) ? account.subscriptionHistory.length : 0,
      devices: (account.deviceIds || []).length
    }
  };
  store.removeAccount(account);
  const after = store.load();
  const orphans = {
    accounts: (after.accounts || []).filter(a => a.id === account.id).length,
    sessions: (after.sessions || []).filter(s => s.accountId === account.id).length,
    orders: (after.orders || []).filter(o => o.accountId === account.id).length,
    payments: (after.payments || []).filter(p => p.accountId === account.id).length,
    usage: (after.usage || []).filter(u => u.accountId === account.id).length
  };
  const orphanCount = Object.keys(orphans).reduce((s, k) => s + orphans[k], 0);
  audit.append(Object.assign({}, actor || {}, {
    action: 'users.delete',
    entityType: 'account',
    entityId: account.id,
    entityLabel: account.email || account.contactEmail || account.id,
    before,
    after: null,
    severity: 'critical',
    metadata: {
      removed: summary.removed,
      orphanCheck: orphans,
      scope: 'saas_store',
      note: 'Device-local POS business data and Supabase tenant rows are outside this store; see the module report.'
    }
  }));
  return {
    deleted: true,
    summary,
    orphanCheck: { orphans, count: orphanCount },
    storageNote: 'SaaS store records removed. Device-local POS data is not stored on this server; Supabase tenant cleanup requires a configured service-role server integration.'
  };
}

module.exports = {
  UserAdminError,
  ACCOUNT_STATUSES,
  SUBSCRIPTION_STATUSES,
  PURGE_SCOPES,
  safeSnapshot,
  listAccounts,
  detail,
  history,
  updateAccount,
  setAccountStatus,
  changePlan,
  extendSubscriptionExpiry,
  changeSubscriptionStatus,
  dataSummary,
  purgeData,
  deleteAccount
};
