/* ══════════════════════════════════════════════════════════════
   HISAAB POS – SaaS API
   Mounts subscription, billing, usage and admin endpoints.

   Routes (all under /api):
     GET  /saas/plans
     POST /auth/device | /auth/signup | /auth/login | /auth/logout
     POST /auth/claim
     GET  /auth/me
     GET  /billing/subscription | /billing/payments
     POST /billing/order | /billing/mock/pay | /billing/verify
     POST /billing/cancel | /billing/resume
     POST /billing/webhook
     POST /usage/consume | /usage/products
     GET  /usage/summary | /usage/ledger
     GET  /admin/stats | /admin/accounts | /admin/payments | /admin/usage
     POST /admin/accounts/:id/plan | /admin/accounts/:id/status
   ══════════════════════════════════════════════════════════════ */

'use strict';

const express = require('express');
const path = require('path');
const store = require('./store');
const helpTutorials = require('./help-tutorials/help-tutorials.service');
const auth = require('./auth');
const payments = require('./payments');
const { getPlan, publicPlans, limitFor } = require('./plans');

const STARTED_AT = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const rateLimitAuth = auth.rateLimit({ name: 'auth', windowMs: 60 * 1000, max: 30 });
const rateLimitPay = auth.rateLimit({ name: 'pay', windowMs: 60 * 1000, max: 60 });

/* ─── small helpers ────────────────────────────────────────── */

function str(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 200);
}

function asyncRoute(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function publicPlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    badge: plan.badge,
    price: plan.price,
    limits: plan.limits,
    features: plan.features,
    highlights: plan.highlights,
    flags: plan.flags || {}
  };
}

function inPeriod(ts, start, end) {
  if (!ts) return false;
  if (start && ts < start) return false;
  if (end && ts >= end) return false;
  return true;
}

function usagePeriod(account) {
  const sub = store.effectiveSubscription(account) || {};
  if (sub.currentPeriodStart && sub.currentPeriodEnd) {
    return {
      start: sub.currentPeriodStart,
      end: sub.currentPeriodEnd,
      key: 'sub:' + (sub.planVersionId || sub.planId || 'free') + ':' + sub.currentPeriodStart
    };
  }
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end, key: store.periodKey(d) };
}

function countUsageInPeriod(accountId, kind, win) {
  const db = store.load();
  const rows = (db.usage || []).filter(u => u.accountId === accountId && u.kind === kind);
  const inWindow = rows.filter(u => {
    if (win.key && String(win.key).indexOf('sub:') === 0) {
      return inPeriod(u.createdAt || 0, win.start, win.end);
    }
    return (u.period === win.key) || inPeriod(u.createdAt || 0, win.start, win.end);
  });
  return inWindow.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
}

function hasBillUsage(accountId, win, meta) {
  const invNo = meta && str(meta.invNo, 80);
  if (!invNo) return false;
  const db = store.load();
  const rows = (db.usage || []).filter(u => u.accountId === accountId && u.kind === 'bill');
  return rows.some(u => {
    const sameInv = u.meta && str(u.meta.invNo, 80) === invNo;
    if (!sameInv) return false;
    if (win.key && String(win.key).indexOf('sub:') === 0) {
      return inPeriod(u.createdAt || 0, win.start, win.end);
    }
    return (u.period === win.key) || inPeriod(u.createdAt || 0, win.start, win.end);
  });
}

function referralBoostTotals(account) {
  const list = Array.isArray(account && account.referralBoosts) ? account.referralBoosts : [];
  return list.reduce((acc, b) => {
    if (!b) return acc;
    acc.products += Math.max(0, Number(b.inventoryBoost) || 0);
    acc.bills += Math.max(0, Number(b.usageBoost) || 0);
    return acc;
  }, { products: 0, bills: 0 });
}

// Referral grants are one-time additions on top of the plan limit. An
// unlimited plan stays unlimited, and grants never reset monthly.
function effectiveLimit(account, plan, kind) {
  const base = limitFor(plan, kind);
  if (base == null) return null;
  const boost = referralBoostTotals(account);
  if (kind === 'products') return base + boost.products;
  if (kind === 'billsPerMonth') return base + boost.bills;
  return base;
}

function usageSummary(account) {
  const plan = store.effectivePlan(account);
  const win = usagePeriod(account);
  const billLimit = effectiveLimit(account, plan, 'billsPerMonth');
  const billsUsed = countUsageInPeriod(account.id, 'bill', win);
  const productLimit = effectiveLimit(account, plan, 'products');
  const productCount = Number(account.productCount) || 0;
  return {
    period: win.key,
    periodStart: win.start,
    periodEnd: win.end,
    bills: {
      used: billsUsed,
      limit: billLimit,
      remaining: billLimit == null ? null : Math.max(0, billLimit - billsUsed),
      percent: billLimit == null ? 0 : Math.min(100, Math.round((billsUsed / (billLimit || 1)) * 100))
    },
    products: {
      used: productCount,
      limit: productLimit,
      remaining: productLimit == null ? null : Math.max(0, productLimit - productCount),
      percent: productLimit == null ? 0 : Math.min(100, Math.round((productCount / (productLimit || 1)) * 100))
    },
    counters: {
      returns: countUsageInPeriod(account.id, 'return', win),
      whatsapp: countUsageInPeriod(account.id, 'whatsapp', win),
      exports: countUsageInPeriod(account.id, 'export', win)
    }
  };
}

function subscriptionPayload(account) {
  const sub = store.effectiveSubscription(account);
  const plan = store.effectivePlan(account);
  return {
    plan: publicPlan(plan),
    subscription: {
      planId: sub.planId || 'free',
      effectivePlanId: plan.id,
      status: sub.status || 'active',
      cycle: sub.cycle || 'monthly',
      currentPeriodStart: sub.currentPeriodStart || null,
      currentPeriodEnd: sub.currentPeriodEnd || null,
      cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
      source: sub.source || 'default',
      daysLeft: store.daysLeft(sub),
      isPaid: plan.id !== 'free',
      pendingPlanId: sub.planId !== plan.id ? sub.planId : null
    }
  };
}

function billingState(account) {
  const base = subscriptionPayload(account);
  return {
    ok: true,
    account: store.publicAccount(account),
    plan: base.plan,
    subscription: base.subscription,
    usage: usageSummary(account),
    features: base.plan.features,
    limits: base.plan.limits,
    plans: publicPlans(),
    payment: payments.publicConfig(),
    serverTime: Date.now()
  };
}

function cleanMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  Object.keys(meta).slice(0, 12).forEach(key => {
    const k = str(key, 40);
    const v = meta[key];
    if (!k) return;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  });
  return out;
}

function startSessionFor(req, res, account) {
  const { token } = store.createSession(account.id);
  auth.setSessionCookie(req, res, token);
  return token;
}

function isValidDeviceId(value) {
  const d = str(value, 128);
  return /^[A-Za-z0-9_-]{8,128}$/.test(d);
}

function isProductionRuntime() {
  try {
    return !!require('../server/runtime-config').isProduction;
  } catch (e) {
    return String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase() === 'production';
  }
}

function monthStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let billsMonth = 0;
  let billsToday = 0;
  store.load().usage.forEach(row => {
    if (row.kind !== 'bill') return;
    if (row.createdAt >= monthStart) billsMonth += row.quantity || 1;
    if (row.createdAt >= dayStart) billsToday += row.quantity || 1;
  });
  return { billsMonth, billsToday, monthStart, dayStart };
}

/* ─── Router ───────────────────────────────────────────────── */

module.exports = function mountSaas(app) {
  // Seed the admin account once, before any request is served.
  store.seedAdmin();

  const router = express.Router();

  // Public: custom help-tutorial thumbnails (uploaded via Super Admin)
  try { helpTutorials.ensureDir(); } catch (e) {}
  app.use('/api/help-tutorial-thumbnails', express.static(helpTutorials.THUMB_DIR, { fallthrough: false, maxAge: '7d' }));

  /* Raw-body webhook must be registered before the JSON parser. */
  router.post('/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const signature = req.headers['x-razorpay-signature'] || '';
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!payments.verifyWebhook(raw, signature)) {
      return res.status(400).json({ ok: false, error: 'Invalid webhook signature.' });
    }
    let event = {};
    try {
      event = JSON.parse(raw.toString('utf8') || '{}');
    } catch (err) {
      return res.status(400).json({ ok: false, error: 'Invalid webhook payload.' });
    }
    const eventId = req.headers['x-razorpay-event-id'] || event.id || null;
    if (eventId && store.hasWebhookEvent(eventId)) {
      return res.json({ ok: true, duplicate: true });
    }

    try {
      // Only captured/paid payment events may activate a subscription.
      if (event.event === 'payment.captured' || event.event === 'order.paid') {
        const pay = (event.payload && event.payload.payment && event.payload.payment.entity) || {};
        const providerOrderId = pay.order_id ||
          (event.payload && event.payload.order && event.payload.order.entity && event.payload.order.entity.id);
        const providerPaymentId = String(pay.id || '').trim();
        const order = providerOrderId ? store.findOrderByProviderId(providerOrderId) : null;

        if (order) {
          // Idempotency: if this provider payment was already processed, do not
          // activate again (prevents duplicate subscription extension/records).
          if (providerPaymentId && store.findPaymentByProviderId(providerPaymentId)) {
            if (order.status !== 'paid') {
              store.updateOrder(order, { status: 'paid', paidAt: order.paidAt || Date.now(), paymentId: providerPaymentId });
            }
            if (eventId) store.recordWebhookEvent(eventId, event.event);
            return res.json({ ok: true, duplicate: true });
          }
          if (order.status === 'paid') {
            if (eventId) store.recordWebhookEvent(eventId, event.event);
            return res.json({ ok: true, duplicate: true });
          }

          // Never activate mock-provider orders in production.
          if (isProductionRuntime() && (order.provider === 'mock' || payments.isMock())) {
            if (eventId) store.recordWebhookEvent(eventId, event.event);
            return res.status(403).json({ ok: false, error: 'Mock payment activation is disabled in production.', code: 'mock_disabled' });
          }

          // Require a genuine captured payment identifier for activation.
          if (!providerPaymentId) {
            if (eventId) store.recordWebhookEvent(eventId, event.event);
            return res.json({ ok: true, ignored: true });
          }

          const account = store.findAccountById(order.accountId);
          if (account) {
            store.updateOrder(order, { status: 'paid', paidAt: Date.now(), paymentId: providerPaymentId });
            store.createPayment({
              orderId: order.id,
              accountId: account.id,
              amount: order.amount,
              currency: order.currency,
              provider: order.provider,
              providerPaymentId
            });
            store.activateSubscription(account, {
              planId: order.planId,
              cycle: order.cycle,
              source: 'webhook',
              paymentId: providerPaymentId
            });
            store.appendUsage(account, {
              kind: 'payment',
              quantity: 1,
              meta: { orderId: order.id, planId: order.planId, amount: order.amount, via: 'webhook' }
            });
            store.save();
          }
        }
      }
    } catch (err) {
      console.error('[SAAS] Webhook processing failed:', err.message);
      // Do not record the event id on processing failure so a safe retry is possible.
      return res.json({ ok: true });
    }

    if (eventId) store.recordWebhookEvent(eventId, event.event);
    res.json({ ok: true });
  });

  // Super Admin APIs are mounted separately with a higher JSON limit (e.g. thumbnail uploads).
  // Skip the SaaS 256kb parser for /super-admin/* so those requests are handled by that router.
  router.use((req, res, next) => {
    if (req.path && req.path.indexOf('/super-admin/') === 0) return next();
    return express.json({ limit: '256kb' })(req, res, next);
  });

  /* ── Plans (public) ── */
  router.get('/saas/plans', (req, res) => {
    res.json({ ok: true, plans: publicPlans(), payment: payments.publicConfig() });
  });

  /* ── Help & Tutorials (public, published only) ── */
  router.get('/help-tutorials', (req, res) => {
    try {
      const tutorials = helpTutorials.listPublished();
      res.json({ ok: true, tutorials, total: tutorials.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Could not load tutorials.', tutorials: [] });
    }
  });

  router.get('/saas/health', (req, res) => {
    res.json({
      ok: true,
      provider: payments.provider(),
      uptimeMs: Date.now() - STARTED_AT,
      storage: store.statsSnapshot()
    });
  });

  /* ── Auth ── */

  // Zero-friction device account. Every installation starts on Free.
  router.post('/auth/device', rateLimitAuth, (req, res) => {
    const deviceId = str(req.body.deviceId, 128);
    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ ok: false, error: 'A valid deviceId is required.', code: 'bad_device' });
    }
    let account = store.findAccountByDevice(deviceId);
    if (!account) {
      account = store.createAccount({
        contactEmail: store.normalizeEmail(req.body.email) || null,
        name: str(req.body.name, 80) || 'Shop Owner',
        storeName: str(req.body.storeName, 120) || 'Hisaab Store'
      });
    } else {
      const email = store.normalizeEmail(req.body.email);
      if (email && !account.contactEmail) account.contactEmail = email;
      if (!account.name && req.body.name) account.name = str(req.body.name, 80);
      if (!account.storeName && req.body.storeName) account.storeName = str(req.body.storeName, 120);
      account.lastSeenAt = Date.now();
      if (account.status === 'suspended' || account.status === 'blocked') {
        return res.status(403).json({
          ok: false,
          error: account.status === 'blocked' ? 'This account has been blocked.' : 'This account is suspended.',
          code: account.status
        });
      }
    }
    store.addDevice(account, deviceId);
    store.save();
    const token = startSessionFor(req, res, account);
    res.json(Object.assign({ token }, billingState(account)));
  });

  router.post('/auth/signup', rateLimitAuth, (req, res) => {
    const email = store.normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email) return res.status(400).json({ ok: false, error: 'Enter a valid email address.', code: 'invalid_email' });
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.', code: 'weak_password' });
    }
    const deleted = store.findRecoverableDeletedAccountByEmail(email);
    if (deleted && deleted.passwordHash && auth.verifyPassword(password, deleted.passwordHash)) {
      const recoveryToken = store.createRecoveryTicket(deleted);
      return res.status(409).json({
        ok: false,
        error: 'This account was previously deleted. Choose recovery or start fresh.',
        code: 'account_deleted_recovery',
        recovery: {
          email: deleted.deletedEmail || email,
          deletedAt: deleted.deletedAt || null,
          retentionUntil: deleted.retentionUntil || null,
          recoveryToken
        }
      });
    }
    if (store.findAccountByEmail(email)) {
      return res.status(409).json({ ok: false, error: 'An account with this email already exists.', code: 'email_taken' });
    }

    const deviceId = isValidDeviceId(req.body.deviceId) ? str(req.body.deviceId, 128) : null;
    const previous = deviceId ? store.findAccountByDevice(deviceId) : null;
    let carriedUsage = {};
    let carriedProducts = 0;
    if (previous && !previous.email && !previous.passwordHash) {
      carriedUsage = previous.usage || {};
      carriedProducts = previous.productCount || 0;
      store.removeAccount(previous);
    }

    const account = store.createAccount({
      email,
      contactEmail: email,
      name: str(req.body.name, 80) || 'Shop Owner',
      storeName: str(req.body.storeName, 120) || 'Hisaab Store',
      passwordHash: auth.hashPassword(password),
      usage: carriedUsage,
      productCount: carriedProducts,
      deviceIds: deviceId ? [deviceId] : []
    });
    const token = startSessionFor(req, res, account);
    res.status(201).json(Object.assign({ token }, billingState(account)));
  });

  router.post('/auth/claim', auth.requireAuth, rateLimitAuth, (req, res) => {
    const account = req.account;
    if (account.email) {
      return res.status(409).json({ ok: false, error: 'This account already has an email and password.', code: 'already_claimed' });
    }
    const email = store.normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email) return res.status(400).json({ ok: false, error: 'Enter a valid email address.', code: 'invalid_email' });
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.', code: 'weak_password' });
    }
    const deleted = store.findRecoverableDeletedAccountByEmail(email);
    if (deleted && deleted.passwordHash && auth.verifyPassword(password, deleted.passwordHash)) {
      const recoveryToken = store.createRecoveryTicket(deleted);
      return res.status(409).json({
        ok: false,
        error: 'This account was previously deleted. Choose recovery or start fresh.',
        code: 'account_deleted_recovery',
        recovery: {
          email: deleted.deletedEmail || email,
          deletedAt: deleted.deletedAt || null,
          retentionUntil: deleted.retentionUntil || null,
          recoveryToken
        }
      });
    }
    if (store.findAccountByEmail(email)) {
      return res.status(409).json({ ok: false, error: 'An account with this email already exists.', code: 'email_taken' });
    }
    account.email = email;
    account.contactEmail = email;
    account.passwordHash = auth.hashPassword(password);
    account.updatedAt = Date.now();
    store.save();
    res.json(billingState(account));
  });

  router.post('/auth/login', rateLimitAuth, (req, res) => {
    const email = store.normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const account = store.findAccountByEmail(email);
    if (!account || !account.passwordHash || !auth.verifyPassword(password, account.passwordHash)) {
      // A deleted (recoverable) account keeps its credentials for identity
      // verification. If no active account matched, offer recovery.
      const deleted = store.findRecoverableDeletedAccountByEmail(email);
      if (deleted && deleted.passwordHash && auth.verifyPassword(password, deleted.passwordHash)) {
        const recoveryToken = store.createRecoveryTicket(deleted);
        return res.status(403).json({
          ok: false,
          error: 'This account was previously deleted. Choose recovery or start fresh.',
          code: 'account_deleted_recovery',
          recovery: {
            email: deleted.deletedEmail || deleted.recoveryEmail || email,
            deletedAt: deleted.deletedAt || null,
            retentionUntil: deleted.retentionUntil || null,
            recoveryToken
          }
        });
      }
      return res.status(401).json({ ok: false, error: 'Invalid email or password.', code: 'invalid_credentials' });
    }
    if (account.status === 'suspended') {
      return res.status(403).json({ ok: false, error: 'This account is suspended.', code: 'suspended' });
    }
    if (account.status === 'blocked') {
      return res.status(403).json({ ok: false, error: 'This account has been blocked.', code: 'blocked' });
    }
    // Deliberately do NOT attach the current device to the signed-in account:
    // signing out should return this browser to its own (Free) account.
    account.lastSeenAt = Date.now();
    store.save();
    const token = startSessionFor(req, res, account);
    res.json(Object.assign({ token }, billingState(account)));
  });

  router.post('/auth/logout', auth.requireAuth, (req, res) => {
    store.deleteSession(req.sessionToken);
    auth.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/auth/me', auth.requireAuth, (req, res) => {
    res.json(billingState(req.account));
  });

  /* ── Self-service account deletion & recovery ── */

  // Soft-delete (deactivate) the signed-in account. Preserves SaaS data for
  // recovery within the retention window. Requires identity confirmation.
  router.post('/auth/account/delete', auth.requireAuth, rateLimitAuth, (req, res) => {
    const account = req.account;
    if (account.role === 'admin') {
      return res.status(403).json({ ok: false, error: 'Administrator accounts cannot be deleted from Settings.', code: 'forbidden' });
    }
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '').trim();
    if (account.passwordHash) {
      if (!password) return res.status(400).json({ ok: false, error: 'Enter your password to confirm account deletion.', code: 'password_required' });
      if (!auth.verifyPassword(password, account.passwordHash)) {
        return res.status(401).json({ ok: false, error: 'Incorrect password.', code: 'invalid_credentials' });
      }
    } else {
      // Device-only accounts: require explicit confirmation text.
      const expected = [account.email, account.contactEmail, account.storeName, account.id, 'DELETE'].filter(Boolean).map(v => String(v).toLowerCase());
      if (!confirm || expected.indexOf(confirm.toLowerCase()) === -1) {
        return res.status(400).json({ ok: false, error: 'Type your store name or DELETE to confirm account deletion.', code: 'confirm_required' });
      }
    }
    const snapshotEmail = account.email || account.contactEmail || null;
    store.softDeleteAccount(account, { reason: 'self_service_settings' });
    store.deleteSession(req.sessionToken);
    auth.clearSessionCookie(req, res);
    return res.json({
      ok: true,
      deleted: true,
      softDeleted: true,
      retentionDays: store.DELETED_RETENTION_DAYS,
      retentionUntil: account.retentionUntil || null,
      email: snapshotEmail,
      recovery: {
        available: true,
        message: 'Your account has been deactivated and your data is retained securely for recovery within the retention period.'
      }
    });
  });

  function resolveRecoveryAccount(req, res) {
    const email = store.normalizeEmail(req.body.email);
    const token = str(req.body.recoveryToken, 200);
    const password = String(req.body.password || '');
    if (!email) { res.status(400).json({ ok: false, error: 'A valid email address is required.', code: 'invalid_email' }); return null; }
    const deleted = store.findRecoverableDeletedAccountByEmail(email);
    if (!deleted) { res.status(404).json({ ok: false, error: 'No recoverable deleted account was found for this email.', code: 'recovery_not_found' }); return null; }
    let verified = false;
    if (token && store.consumeRecoveryTicket(deleted, token)) verified = true;
    if (!verified && password && deleted.passwordHash && auth.verifyPassword(password, deleted.passwordHash)) verified = true;
    if (!verified) {
      res.status(401).json({ ok: false, error: 'Identity verification failed. Please sign in again to continue recovery.', code: 'recovery_verification_failed' });
      return null;
    }
    return deleted;
  }

  // Restore a previously deleted account (after identity verification).
  router.post('/auth/account/recover', rateLimitAuth, (req, res) => {
    const deleted = resolveRecoveryAccount(req, res);
    if (!deleted) return;
    if (deleted.replacedByAccountId) {
      return res.status(409).json({ ok: false, error: 'A fresh account was already created for this email. The old account data remains archived separately.', code: 'recovery_replaced' });
    }
    // Ensure email not taken by some other active account.
    const email = store.normalizeEmail(deleted.deletedEmail || deleted.recoveryEmail || req.body.email);
    const active = email ? store.findAccountByEmail(email) : null;
    if (active && active.id !== deleted.id) {
      return res.status(409).json({ ok: false, error: 'This email is already in use by another active account.', code: 'email_taken' });
    }
    store.recoverDeletedAccount(deleted);
    const deviceId = isValidDeviceId(req.body.deviceId) ? str(req.body.deviceId, 128) : null;
    if (deviceId) store.addDevice(deleted, deviceId);
    deleted.lastSeenAt = Date.now();
    store.save();
    const token = startSessionFor(req, res, deleted);
    return res.json(Object.assign({ token, recovered: true, mode: 'recover', clearLocalData: false }, billingState(deleted)));
  });

  // Create a completely fresh account for the same verified identity.
  // Old deleted account and its SaaS data remain preserved/archived.
  router.post('/auth/account/start-fresh', rateLimitAuth, (req, res) => {
    const deleted = resolveRecoveryAccount(req, res);
    if (!deleted) return;
    const deviceId = isValidDeviceId(req.body.deviceId) ? str(req.body.deviceId, 128) : null;
    let fresh;
    try {
      fresh = store.startFreshFromDeleted(deleted, { deviceId });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Could not create a fresh account.', code: 'fresh_start_failed' });
    }
    fresh.lastSeenAt = Date.now();
    store.save();
    const token = startSessionFor(req, res, fresh);
    return res.json(Object.assign({ token, freshStart: true, mode: 'fresh', clearLocalData: true }, billingState(fresh)));
  });

  /* ── Billing ── */

  router.get('/billing/subscription', auth.requireAuth, (req, res) => {
    res.json(billingState(req.account));
  });

  router.get('/billing/payments', auth.requireAuth, (req, res) => {
    const rows = store.listPayments(req.account.id, 50).map(p => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      status: p.status,
      createdAt: p.createdAt
    }));
    res.json({ ok: true, payments: rows });
  });

  router.post('/billing/order', auth.requireAuth, asyncRoute(async (req, res) => {
    const plan = getPlan(req.body.planId);
    const cycle = req.body.cycle === 'yearly' ? 'yearly' : 'monthly';
    if (!plan) return res.status(400).json({ ok: false, error: 'Unknown plan.', code: 'bad_plan' });
    if (plan.id === 'free') {
      return res.status(400).json({ ok: false, error: 'The Free plan does not require payment.', code: 'free_plan' });
    }
    const amount = Number(plan.price[cycle]) || 0;
    if (amount <= 0) {
      return res.status(400).json({ ok: false, error: 'This plan has no payable amount.', code: 'bad_amount' });
    }

    // Disable mock payment/activation flows in production (test-mode preserved in dev/test).
    if (isProductionRuntime() && payments.isMock()) {
      return res.status(403).json({ ok: false, error: 'Mock payments are disabled in production.', code: 'mock_disabled' });
    }

    let providerOrder;
    try {
      providerOrder = await payments.createProviderOrder({
        amount,
        receipt: 'hisaab_' + plan.id + '_' + Date.now(),
        notes: { accountId: req.account.id, planId: plan.id, cycle }
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        error: 'Could not reach the payment gateway: ' + err.message,
        code: 'gateway_error'
      });
    }

    const order = store.createOrder(req.account, {
      planId: plan.id,
      cycle,
      amount,
      currency: payments.currency(),
      provider: payments.provider(),
      providerOrderId: providerOrder.providerOrderId,
      providerPayload: providerOrder.providerPayload
    });

    res.status(201).json({
      ok: true,
      order: {
        id: order.id,
        planId: order.planId,
        cycle: order.cycle,
        amount: order.amount,
        currency: order.currency,
        provider: order.provider,
        providerOrderId: order.providerOrderId,
        expiresAt: order.expiresAt
      },
      payment: payments.publicConfig()
    });
  }));

  // Development/test helper: the server produces the payment id + signature,
  // exactly like a gateway callback would. The verification endpoint below
  // still performs a real HMAC check. Mock payment activation is disabled in production.
  router.post('/billing/mock/pay', auth.requireAuth, rateLimitPay, (req, res) => {
    if (isProductionRuntime()) {
      return res.status(403).json({ ok: false, error: 'Mock payments are disabled in production.', code: 'mock_disabled' });
    }
    if (!payments.isMock()) {
      return res.status(400).json({ ok: false, error: 'Mock payments are disabled.', code: 'mock_disabled' });
    }
    const order = store.findOrder(str(req.body.orderId, 80));
    if (!order || order.accountId !== req.account.id) {
      return res.status(404).json({ ok: false, error: 'Order not found.', code: 'order_not_found' });
    }
    if (order.provider !== 'mock') {
      return res.status(400).json({ ok: false, error: 'Mock payments are not available for this order.', code: 'mock_disabled' });
    }
    if (order.status === 'paid') {
      return res.status(409).json({ ok: false, error: 'Order is already paid.', code: 'already_paid' });
    }
    if (order.expiresAt && order.expiresAt < Date.now()) {
      return res.status(400).json({ ok: false, error: 'Order expired. Start a new checkout.', code: 'order_expired' });
    }
    try {
      const result = payments.mockPayment(order.providerOrderId);
      res.json({
        ok: true,
        orderId: order.id,
        providerOrderId: order.providerOrderId,
        paymentId: result.paymentId,
        signature: result.signature
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message, code: 'mock_failed' });
    }
  });

  router.post('/billing/verify', auth.requireAuth, rateLimitPay, (req, res) => {
    const body = req.body || {};
    const orderId = str(body.orderId, 80) || str(body.razorpay_order_id, 120);
    const providerPaymentId = str(body.paymentId, 120) || str(body.razorpay_payment_id, 120);
    const signature = str(body.signature, 256) || str(body.razorpay_signature, 256);

    let order = orderId ? store.findOrder(orderId) : null;
    if (!order && orderId) order = store.findOrderByProviderId(orderId);
    if (!order || order.accountId !== req.account.id) {
      return res.status(404).json({ ok: false, error: 'Order not found.', code: 'order_not_found' });
    }

    // Idempotency / duplicate protection: never re-activate for an already
    // processed order or payment. Existing subscription/payment records are preserved.
    if (order.status === 'paid') {
      return res.json(Object.assign({ alreadyProcessed: true }, billingState(req.account)));
    }
    if (order.expiresAt && order.expiresAt < Date.now()) {
      return res.status(400).json({ ok: false, error: 'Order expired. Start a new checkout.', code: 'order_expired' });
    }
    // Failed/cancelled/expired orders must never activate a paid plan.
    // 'pending' orders are eligible once a genuine, server-verified payment is confirmed.
    if (order.status && ['failed', 'cancelled', 'canceled', 'expired'].includes(String(order.status).toLowerCase())) {
      return res.status(400).json({ ok: false, error: 'This payment order cannot be activated.', code: 'invalid_order_state' });
    }

    // Mock payment activation is disabled in production. Client-side confirmation
    // alone is never sufficient: activation requires server-side signature verification.
    if (isProductionRuntime() && (order.provider === 'mock' || payments.isMock())) {
      return res.status(403).json({ ok: false, error: 'Mock payment activation is disabled in production.', code: 'mock_disabled' });
    }

    if (!providerPaymentId || !signature) {
      return res.status(400).json({ ok: false, error: 'Payment id and signature are required.', code: 'missing_signature' });
    }

    // Server-side verification of the genuine payment transaction signature.
    if (!payments.verifySignature(order.providerOrderId, providerPaymentId, signature, order.provider)) {
      return res.status(400).json({ ok: false, error: 'Payment verification failed.', code: 'invalid_signature' });
    }

    if (store.findPaymentByProviderId(providerPaymentId)) {
      if (order.status !== 'paid') {
        store.updateOrder(order, { status: 'paid', paidAt: order.paidAt || Date.now(), paymentId: providerPaymentId });
      }
      return res.json(Object.assign({ alreadyProcessed: true }, billingState(req.account)));
    }

    const now = Date.now();
    store.updateOrder(order, { status: 'paid', paidAt: now, paymentId: providerPaymentId });
    const payment = store.createPayment({
      orderId: order.id,
      accountId: req.account.id,
      amount: order.amount,
      currency: order.currency,
      provider: order.provider,
      providerPaymentId
    });
    store.activateSubscription(req.account, {
      planId: order.planId,
      cycle: order.cycle,
      source: 'payment',
      paymentId: providerPaymentId
    });
    store.appendUsage(req.account, {
      kind: 'payment',
      quantity: 1,
      meta: {
        planId: order.planId,
        cycle: order.cycle,
        amount: order.amount,
        paymentId: providerPaymentId
      }
    });

    res.json(Object.assign({
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status
      }
    }, billingState(req.account)));
  });

  router.post('/billing/cancel', auth.requireAuth, (req, res) => {
    const sub = store.effectiveSubscription(req.account);
    if (sub.planId === 'free' || req.account.role === 'admin') {
      return res.status(400).json({ ok: false, error: 'There is no paid subscription to cancel.', code: 'no_paid_plan' });
    }
    if (sub.status !== 'active') {
      return res.status(400).json({ ok: false, error: 'The subscription is not active.', code: 'not_active' });
    }
    req.account.subscription.cancelAtPeriodEnd = true;
    req.account.updatedAt = Date.now();
    store.save();
    res.json(billingState(req.account));
  });

  router.post('/billing/resume', auth.requireAuth, (req, res) => {
    const sub = store.effectiveSubscription(req.account);
    if (sub.planId === 'free') {
      return res.status(400).json({ ok: false, error: 'There is no paid subscription to resume.', code: 'no_paid_plan' });
    }
    req.account.subscription.cancelAtPeriodEnd = false;
    req.account.updatedAt = Date.now();
    store.save();
    res.json(billingState(req.account));
  });

  /* ── Usage ── */

  router.post('/usage/consume', auth.requireAuth, (req, res) => {
    const kind = str(req.body.kind, 40).toLowerCase();
    const allowed = ['bill', 'return', 'whatsapp', 'export', 'barcode_print'];
    if (!allowed.includes(kind)) {
      return res.status(400).json({ ok: false, error: 'Unknown usage kind.', code: 'bad_kind' });
    }
    const plan = store.effectivePlan(req.account);
    const meta = cleanMeta(req.body.meta);

    // Barcode label printing is a plan entitlement. Validate it server-side on
    // every print request so hiding/locking the UI is never the only guard.
    if (kind === 'barcode_print' && !plan.features.includes('barcode_printing')) {
      return res.status(402).json({
        ok: false,
        allowed: false,
        error: 'Barcode printing is not included in the ' + plan.name + ' plan.',
        code: 'feature_locked',
        feature: 'barcode_printing',
        plan: publicPlan(plan),
        plans: publicPlans()
      });
    }

    if (kind === 'bill') {
      const win = usagePeriod(req.account);
      const limit = effectiveLimit(req.account, plan, 'billsPerMonth');
      const used = countUsageInPeriod(req.account.id, 'bill', win);

      // Idempotent consume: if this invoice was already counted in the current
      // billing period, do not double-count (retry / double-submit safety).
      if (hasBillUsage(req.account.id, win, meta)) {
        return res.json({ ok: true, allowed: true, duplicate: true, usage: usageSummary(req.account) });
      }

      if (limit != null && used >= limit) {
        const state = billingState(req.account);
        return res.status(402).json({
          ok: false,
          allowed: false,
          error: 'Monthly bill limit reached on the ' + plan.name + ' plan.',
          code: 'plan_limit',
          limit,
          used,
          plan: state.plan,
          subscription: state.subscription,
          plans: state.plans,
          payment: state.payment,
          usage: state.usage
        });
      }
      store.appendUsage(req.account, { kind, quantity: 1, meta });
      return res.json({ ok: true, allowed: true, usage: usageSummary(req.account) });
    }

    if (kind === 'return' && !plan.features.includes('returns')) {
      return res.status(402).json({
        ok: false,
        allowed: false,
        error: 'Sales returns are available on Starter and Pro.',
        code: 'feature_locked',
        feature: 'returns',
        plans: publicPlans()
      });
    }
    if (kind === 'export' && !plan.features.includes('csv_export')) {
      return res.status(402).json({
        ok: false,
        allowed: false,
        error: 'CSV export is available on Starter and Pro.',
        code: 'feature_locked',
        feature: 'csv_export',
        plans: publicPlans()
      });
    }

    store.appendUsage(req.account, { kind, quantity: 1, meta });
    res.json({ ok: true, allowed: true, usage: usageSummary(req.account) });
  });

  router.post('/usage/products', auth.requireAuth, (req, res) => {
    const count = Math.max(0, Math.min(1000000, Math.floor(Number(req.body.count) || 0)));
    const plan = store.effectivePlan(req.account);
    const limit = effectiveLimit(req.account, plan, 'products');
    if (limit != null && count > limit) {
      return res.status(402).json({
        ok: false,
        error: 'Product limit reached on the ' + plan.name + ' plan.',
        code: 'plan_limit',
        limit,
        used: count,
        plans: publicPlans()
      });
    }
    req.account.productCount = count;
    req.account.updatedAt = Date.now();
    // Only write a ledger entry for meaningful changes.
    const last = (req.account.__lastProductCount === undefined) ? null : req.account.__lastProductCount;
    if (last !== count) {
      store.appendUsage(req.account, { kind: 'products', quantity: 0, meta: { count } });
      req.account.__lastProductCount = count;
    } else {
      store.save();
    }
    res.json({ ok: true, usage: usageSummary(req.account) });
  });

  router.get('/usage/summary', auth.requireAuth, (req, res) => {
    res.json({ ok: true, usage: usageSummary(req.account) });
  });

  // One-time referral limit grant. Idempotent on grantKey so a retried client
  // call can never add the same boost twice, and grants are never recurring.
  router.post('/usage/boost', auth.requireAuth, (req, res) => {
    const key = str(req.body.grantKey, 120);
    if (!key) return res.status(400).json({ ok: false, error: 'Missing grant key.', code: 'bad_grant' });
    const inventoryBoost = Math.max(0, Math.min(1000000, Math.floor(Number(req.body.inventoryBoost) || 0)));
    const usageBoost = Math.max(0, Math.min(1000000, Math.floor(Number(req.body.usageBoost) || 0)));
    if (!(inventoryBoost > 0) && !(usageBoost > 0)) {
      return res.status(400).json({ ok: false, error: 'Grant has no limit increase.', code: 'bad_grant' });
    }
    const plan = store.effectivePlan(req.account);
    if (!plan.features.includes('rewards_share_earn')) {
      return res.status(402).json({ ok: false, error: 'Referral rewards are not included in the ' + plan.name + ' plan.', code: 'feature_locked', feature: 'rewards_share_earn', plans: publicPlans() });
    }
    if (inventoryBoost > 0 && !plan.features.includes('rewards_referral_inventory_boost')) {
      return res.status(402).json({ ok: false, error: 'Referral inventory limit increase is not included in the ' + plan.name + ' plan.', code: 'feature_locked', feature: 'rewards_referral_inventory_boost', plans: publicPlans() });
    }
    if (usageBoost > 0 && !plan.features.includes('rewards_referral_usage_boost')) {
      return res.status(402).json({ ok: false, error: 'Referral usage limit increase is not included in the ' + plan.name + ' plan.', code: 'feature_locked', feature: 'rewards_referral_usage_boost', plans: publicPlans() });
    }
    if (!Array.isArray(req.account.referralBoosts)) req.account.referralBoosts = [];
    if (req.account.referralBoosts.some(b => b && b.grantKey === key)) {
      return res.json({ ok: true, duplicate: true, usage: usageSummary(req.account), boosts: referralBoostTotals(req.account) });
    }
    req.account.referralBoosts.push({ grantKey: key, inventoryBoost, usageBoost, createdAt: Date.now() });
    req.account.updatedAt = Date.now();
    store.save();
    res.json({ ok: true, usage: usageSummary(req.account), boosts: referralBoostTotals(req.account) });
  });

  router.get('/usage/ledger', auth.requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const kind = req.query.kind ? str(req.query.kind, 40) : null;
    const rows = store.listUsage(req.account.id, { limit, kind }).map(row => ({
      id: row.id,
      kind: row.kind,
      quantity: row.quantity,
      meta: row.meta,
      createdAt: row.createdAt
    }));
    res.json({ ok: true, entries: rows });
  });

  /* ── Admin ── */

  router.get('/admin/stats', auth.requireAuth, auth.requireAdmin, (req, res) => {
    const all = store.load().accounts;
    const now = Date.now();
    const month = monthStats();
    let paidActive = 0;
    let freeActive = 0;
    let suspended = 0;
    let mrr = 0;
    const distribution = { free: 0, starter: 0, pro: 0 };
    all.forEach(acc => {
      if (acc.status === 'suspended') suspended++;
      const plan = store.effectivePlan(acc);
      distribution[plan.id] = (distribution[plan.id] || 0) + 1;
      if (plan.id === 'free') freeActive++;
      else {
        paidActive++;
        const price = plan.price.monthly;
        const sub = acc.subscription || {};
        mrr += sub.cycle === 'yearly' ? Math.round(price / 12) : price;
      }
    });
    const paymentsAll = store.listPayments(null, 100000);
    const revenueTotal = paymentsAll.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const revenue30d = paymentsAll
      .filter(p => p.createdAt >= now - 30 * DAY_MS)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const newAccounts7d = all.filter(a => a.createdAt >= now - 7 * DAY_MS).length;

    const recentPayments = paymentsAll.slice(0, 10).map(p => {
      const acc = store.findAccountById(p.accountId);
      return {
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt,
        accountId: p.accountId,
        email: acc ? (acc.email || acc.contactEmail || acc.id) : p.accountId
      };
    });
    const recentAccounts = all.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map(acc => {
      const plan = store.effectivePlan(acc);
      return {
        id: acc.id,
        email: acc.email || acc.contactEmail || null,
        name: acc.name,
        storeName: acc.storeName,
        planId: plan.id,
        createdAt: acc.createdAt,
        status: acc.status
      };
    });

    res.json({
      ok: true,
      stats: {
        accounts: all.length,
        paidActive,
        freeActive,
        suspended,
        mrr,
        revenueTotal,
        revenue30d,
        billsThisMonth: month.billsMonth,
        billsToday: month.billsToday,
        newAccounts7d,
        distribution,
        recentPayments,
        recentAccounts
      }
    });
  });

  router.get('/admin/accounts', auth.requireAuth, auth.requireAdmin, (req, res) => {
    const q = str(req.query.q, 80).toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
    let rows = store.load().accounts.slice();
    if (q) {
      rows = rows.filter(a => {
        const hay = [a.id, a.email, a.contactEmail, a.name, a.storeName].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    rows = rows.slice(0, limit).map(acc => {
      const plan = store.effectivePlan(acc);
      const sub = acc.subscription || {};
      const period = store.periodKey();
      const counters = (acc.usage && acc.usage[period]) || {};
      return {
        id: acc.id,
        email: acc.email || null,
        contactEmail: acc.contactEmail || null,
        name: acc.name,
        storeName: acc.storeName,
        role: acc.role,
        status: acc.status,
        hasPassword: !!acc.passwordHash,
        planId: plan.id,
        planName: plan.name,
        subscriptionStatus: sub.status || 'active',
        cycle: sub.cycle || 'monthly',
        currentPeriodEnd: sub.currentPeriodEnd || null,
        cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
        daysLeft: store.daysLeft(sub),
        billsThisMonth: Number(counters.bill) || 0,
        productCount: acc.productCount || 0,
        createdAt: acc.createdAt,
        lastSeenAt: acc.lastSeenAt
      };
    });
    res.json({ ok: true, accounts: rows });
  });

  router.post('/admin/accounts/:id/plan', auth.requireAuth, auth.requireAdmin, (req, res) => {
    const account = store.findAccountById(str(req.params.id, 80));
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found.', code: 'account_not_found' });
    const plan = getPlan(req.body.planId);
    if (!plan) return res.status(400).json({ ok: false, error: 'Unknown plan.', code: 'bad_plan' });
    const days = Math.max(1, Math.min(3650, Math.floor(Number(req.body.days) || (plan.id === 'free' ? 30 : 30))));
    if (plan.id === 'free') {
      store.setFreePlan(account, 'admin');
    } else {
      store.activateSubscription(account, {
        planId: plan.id,
        cycle: days > 180 ? 'yearly' : 'monthly',
        days,
        source: 'admin'
      });
    }
    store.appendUsage(account, {
      kind: 'admin_grant',
      quantity: 1,
      meta: { planId: plan.id, days, note: str(req.body.note, 200), by: req.account.id }
    });
    res.json({ ok: true, account: store.publicAccount(account), plan: publicPlan(plan) });
  });

  router.post('/admin/accounts/:id/status', auth.requireAuth, auth.requireAdmin, (req, res) => {
    const account = store.findAccountById(str(req.params.id, 80));
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found.', code: 'account_not_found' });
    if (account.id === req.account.id) {
      return res.status(400).json({ ok: false, error: 'You cannot suspend your own account.', code: 'self_suspend' });
    }
    const status = req.body.status === 'suspended' ? 'suspended' : 'active';
    account.status = status;
    account.updatedAt = Date.now();
    store.save();
    res.json({ ok: true, account: store.publicAccount(account) });
  });

  router.get('/admin/payments', auth.requireAuth, auth.requireAdmin, (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const rows = store.listPayments(null, limit).map(p => {
      const acc = store.findAccountById(p.accountId);
      return {
        id: p.id,
        accountId: p.accountId,
        email: acc ? (acc.email || acc.contactEmail || null) : null,
        storeName: acc ? acc.storeName : null,
        amount: p.amount,
        currency: p.currency,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt
      };
    });
    res.json({ ok: true, payments: rows });
  });

  router.get('/admin/usage', auth.requireAuth, auth.requireAdmin, (req, res) => {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 200));
    const rows = store.allUsage().slice(-limit).reverse().map(row => {
      const acc = store.findAccountById(row.accountId);
      return {
        id: row.id,
        accountId: row.accountId,
        email: acc ? (acc.email || acc.contactEmail || null) : null,
        storeName: acc ? acc.storeName : null,
        kind: row.kind,
        quantity: row.quantity,
        meta: row.meta,
        createdAt: row.createdAt
      };
    });
    res.json({ ok: true, entries: rows });
  });

  /* ── Errors ── */
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('[SAAS] API error:', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: 'Server error. Please try again.', code: 'server_error' });
  });

  app.use('/api', router);

  // Keep subscriptions honest even if nobody is making requests.
  const sweeper = setInterval(() => {
    try { store.sweepExpiredSubscriptions(); } catch (err) { /* ignore */ }
    try { store.pruneSessions(); } catch (err) { /* ignore */ }
  }, 60 * 1000);
  sweeper.unref();

  console.log('[SAAS] Subscription API ready (provider: ' + payments.provider() + ')');
  return router;
};
