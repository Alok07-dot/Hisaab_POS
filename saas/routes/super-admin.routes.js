'use strict';

const store = require('../store');
const legacyAuth = require('../auth');
const payments = require('../payments');
const audit = require('../audit/audit.service');
const helpTutorials = require('../help-tutorials/help-tutorials.service');
const maintenance = require('../maintenance/maintenance.service');
const announcements = require('../announcements/announcements.service');
const identity = require('../integration/identity-map.service');
const userAdmin = require('../users/user-admin.service');
const adminUsers = require('../super-admin-auth/store');
const saAuth = require('../super-admin-auth/auth');
const { hasPermission, permissionsForRole, normalizeRole } = require('../rbac/permissions');

function actor(req) {
  const u = req.superAdmin || req.account || {};
  return { actorAdminId: u.id || null, actorEmail: u.email || u.contactEmail || null, actorRole: req.adminRole || u.role || null, ip: (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress, userAgent: req.headers['user-agent'] || '' };
}

function ok(res, data, meta) { return res.json(Object.assign({ ok: true }, data || {}, meta ? { meta } : {})); }
function fail(res, status, message, code, extra) { return res.status(status).json(Object.assign({ ok: false, error: message, code: code || 'error' }, extra || {})); }
function sendUserAdminError(res, err) {
  if (err && (err.name === 'UserAdminError' || err instanceof userAdmin.UserAdminError)) {
    return fail(res, err.status || 400, err.message || 'Request could not be completed.', err.code || 'validation_error', err.details ? { details: err.details } : {});
  }
  console.error('[SUPER-ADMIN] user action failed:', err && err.stack ? err.stack : err);
  return fail(res, 500, 'Could not complete the operation.', 'server_error');
}
function asyncRoute(fn) { return function (req, res, next) { Promise.resolve(fn(req, res, next)).catch(next); }; }

// Accept separate super-admin session; fallback to legacy admin session for compatibility.
function requireAuthCompat(req, res, next) {
  const token = saAuth.getToken(req);
  if (token) {
    const found = adminUsers.getSession(token);
    if (found && found.user && found.user.status === 'active') {
      req.superAdmin = found.user;
      req.superAdminToken = token;
      req.adminRole = found.user.role;
      req.adminPermissions = permissionsForRole(found.user.role);
      return next();
    }
  }
  // legacy fallback
  return legacyAuth.requireAuth(req, res, () => {
    if (!req.account || req.account.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin access required.', code: 'forbidden' });
    }
    const role = normalizeRole(req.account) || 'admin';
    req.adminRole = role;
    req.adminPermissions = permissionsForRole(role);
    return next();
  });
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

module.exports = function mountSuperAdminRoutes(router) {
  const base = '/super-admin/v1';
  adminUsers.seedOwner();

  // Separate Super Admin auth
  router.post(base + '/auth/login', saAuth.loginLimiter, saAuth.handleLogin);
  router.post(base + '/auth/logout', requireAuthCompat, saAuth.handleLogout);
  router.get(base + '/auth/me', requireAuthCompat, (req, res) => {
    if (req.superAdmin) return saAuth.handleMe(req, res);
    const role = req.adminRole || 'admin';
    ok(res, { user: { id: req.account.id, email: req.account.email || req.account.contactEmail || null, name: req.account.name, role, status: req.account.status }, role, permissions: permissionsForRole(role), legacy: true }, { source: 'saas_json' });
  });

  const guard = [requireAuthCompat];

  router.get(base + '/overview/kpis', ...guard, requirePermission('overview.view'), (req, res) => {
    const db = store.load();
    const accounts = db.accounts || [];
    const paymentsList = db.payments || [];
    const orders = db.orders || [];
    const now = Date.now();
    const d30 = 30 * 24 * 60 * 60 * 1000;
    const activeSubs = accounts.filter(a => { const s = store.effectiveSubscription(a); return s && s.status === 'active' && s.planId !== 'free'; }).length;
    const freeUsers = accounts.filter(a => { const s = store.effectiveSubscription(a); return !s || s.planId === 'free'; }).length;
    const captured = paymentsList.filter(p => p.status === 'captured');
    const totalRevenue = captured.reduce((s,p)=>s + (Number(p.amount)||0), 0);
    const revenue30 = captured.filter(p => (p.createdAt||0) >= now - d30).reduce((s,p)=>s + (Number(p.amount)||0), 0);
    const newRegs30 = accounts.filter(a => (a.createdAt||0) >= now - d30).length;
    ok(res, { kpis: { totalUsers: accounts.length, totalBusinesses: accounts.length, activeSubscriptions: activeSubs, freeUsers, paidUsers: activeSubs, mrr: null, arr: null, totalRevenuePaise: totalRevenue, revenue30dPaise: revenue30, newRegistrations30d: newRegs30, cancellations: null, trialConversions: null, failedPayments: orders.filter(o=>o.status==='failed').length, totalPayments: paymentsList.length, orders: orders.length } }, { source: 'saas_json', partial: true, note: 'Live KPIs from SaaS store. MRR/ARR/charts require full subscription-period aggregation in follow-up.' });
  });
  router.get(base + '/overview/charts', ...guard, requirePermission('overview.view'), (req, res) => ok(res, { charts: {} }, { source: 'saas_json', partial: true, note: 'Chart series aggregation pending deeper event rollups.' }));
  router.get(base + '/overview/activity', ...guard, requirePermission('overview.view'), (req, res) => {
    const db = store.load();
    const payActs = (db.payments || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,8).map(p => ({ type: 'payment', title: 'Payment ' + (p.status||'event'), meta: (p.provider||'gateway') + ' • ' + (p.id||''), time: p.createdAt ? new Date(p.createdAt).toISOString() : null, status: p.status === 'captured' ? 'success' : (p.status === 'failed' ? 'danger' : 'info') }));
    const accActs = (db.accounts || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,5).map(a => ({ type: 'registration', title: 'New account', meta: (a.storeName || a.name || a.email || a.id), time: a.createdAt ? new Date(a.createdAt).toISOString() : null, status: 'info' }));
    const activity = payActs.concat(accActs).sort((a,b)=>new Date(b.time||0)-new Date(a.time||0)).slice(0,12);
    ok(res, { activity }, { source: 'saas_json', partial: true });
  });

  router.get(base + '/users', ...guard, requirePermission('users.view'), (req, res) => {
    try {
      const result = userAdmin.listAccounts(req.query || {});
      ok(res, result, result.meta);
    } catch (e) { return sendUserAdminError(res, e); }
  });
  router.get(base + '/users/:id', ...guard, requirePermission('users.view'), (req, res) => {
    try {
      const result = userAdmin.detail(req.params.id);
      audit.append(Object.assign(actor(req), { action: 'users.view_detail', entityType: 'account', entityId: req.params.id, entityLabel: result.account.email || result.account.id }));
      ok(res, result, { source: 'saas_json', supabaseConfigured: identity.supabaseConfigured() });
    } catch (e) { return sendUserAdminError(res, e); }
  });
  router.patch(base + '/users/:id', ...guard, requirePermission('users.edit'), (req, res) => {
    try {
      ok(res, userAdmin.updateAccount(req.params.id, req.body || {}, actor(req)));
    } catch (e) { return sendUserAdminError(res, e); }
  });
  router.post(base + '/users/:id/status', ...guard, (req, res) => {
    const next = String((req.body || {}).status || '').toLowerCase();
    const permission = next === 'blocked' ? 'users.block' : (next === 'suspended' ? 'users.suspend' : 'users.reactivate');
    if (!hasPermission(req.adminRole, permission)) {
      return fail(res, 403, 'Insufficient permissions.', 'forbidden', { permission });
    }
    try {
      ok(res, userAdmin.setAccountStatus(req.params.id, next, req.body || {}, actor(req)));
    } catch (e) { return sendUserAdminError(res, e); }
  });
  router.get(base + '/users/:id/history', ...guard, requirePermission('users.view'), (req, res) => {
    try { ok(res, userAdmin.history(req.params.id)); } catch (e) { return sendUserAdminError(res, e); }
  });
  router.get(base + '/users/:id/data', ...guard, requirePermission('users.view'), (req, res) => {
    try { ok(res, { data: userAdmin.dataSummary(req.params.id) }); } catch (e) { return sendUserAdminError(res, e); }
  });
  router.post(base + '/users/:id/data/purge', ...guard, requirePermission('users.purge_data'), (req, res) => {
    try { ok(res, userAdmin.purgeData(req.params.id, req.body || {}, actor(req))); } catch (e) { return sendUserAdminError(res, e); }
  });
  router.post(base + '/users/:id/subscription/plan', ...guard, requirePermission('subscriptions.modify'), (req, res) => {
    try { ok(res, userAdmin.changePlan(req.params.id, req.body || {}, actor(req))); } catch (e) { return sendUserAdminError(res, e); }
  });
  router.post(base + '/users/:id/subscription/extend', ...guard, requirePermission('subscriptions.modify'), (req, res) => {
    try { ok(res, userAdmin.extendSubscriptionExpiry(req.params.id, req.body || {}, actor(req))); } catch (e) { return sendUserAdminError(res, e); }
  });
  router.post(base + '/users/:id/subscription/status', ...guard, requirePermission('subscriptions.modify'), (req, res) => {
    try { ok(res, userAdmin.changeSubscriptionStatus(req.params.id, req.body || {}, actor(req))); } catch (e) { return sendUserAdminError(res, e); }
  });
  router.post(base + '/users/:id/delete', ...guard, requirePermission('users.delete'), (req, res) => {
    try { ok(res, userAdmin.deleteAccount(req.params.id, req.body || {}, actor(req))); } catch (e) { return sendUserAdminError(res, e); }
  });

  router.get(base + '/businesses', ...guard, requirePermission('businesses.view'), asyncRoute(async (req, res) => {
    const result = await identity.listBusinesses(req.query || {});
    ok(res, result, result.meta);
  }));
  router.get(base + '/subscriptions', ...guard, requirePermission('subscriptions.view'), (req, res) => {
    const db = store.load();
    const items = (db.accounts || []).map(a => ({ id: a.id, accountId: a.id, storeName: a.storeName, email: a.email || a.contactEmail || null, subscription: store.effectiveSubscription(a), effectivePlan: store.effectivePlan(a).id }));
    ok(res, { items, total: items.length }, { source: 'saas_json' });
  });
  // ── Plan & Pricing Management (dynamic, versioned) ──
  const planCatalog = require('../plans/catalog.service');
  function subscriberCountsByPlan() {
    const db = store.load();
    const counts = {};
    const byVersion = {};
    (db.accounts || []).forEach(a => {
      const sub = store.effectiveSubscription(a) || {};
      // resolve linked/effective plan id
      let pid = sub.planId || 'free';
      let vid = sub.planVersionId || null;
      try {
        if (vid) {
          const v = planCatalog.getVersion(vid);
          if (v) pid = v.planId;
        } else if (a.role !== 'admin') {
          const ent = require('../entitlements/entitlement.service').resolveForAccount(a);
          pid = (ent && ent.planId) || pid;
          vid = (ent && ent.planVersionId) || vid;
        }
      } catch (e) {}
      counts[pid] = (counts[pid] || 0) + 1;
      if (vid) byVersion[vid] = (byVersion[vid] || 0) + 1;
    });
    return { counts, byVersion };
  }
  function planAdminView(plan) {
    const ver = planCatalog.getCurrentVersion(plan.id);
    const versions = planCatalog.listVersions(plan.id);
    const sc = subscriberCountsByPlan();
    return Object.assign({}, plan, {
      currentVersion: ver || null,
      versions: versions,
      versionHistory: versions,
      subscriberCount: sc.counts[plan.id] || 0,
      subscribersByVersion: versions.map(v => ({ versionId: v.id, label: v.label, versionNo: v.versionNo, count: sc.byVersion[v.id] || 0, monthlyPricePaise: v.monthlyPricePaise, annualPricePaise: v.annualPricePaise, status: v.status }))
    });
  }

  router.get(base + '/plans', ...guard, requirePermission('plans.view'), (req, res) => {
    try { planCatalog.applyScheduledPricing(Date.now()); } catch (e) {}
    const plans = planCatalog.listPlans().map(planAdminView);
    const features = planCatalog.listFeatureRegistry();
    const sc = subscriberCountsByPlan();
    ok(res, { plans, features, subscriberCounts: sc.counts, subscribersByVersion: sc.byVersion }, { source: 'plans_catalog', versioned: true });
  });
  router.get(base + '/plans/features', ...guard, requirePermission('plans.view'), (req, res) => {
    ok(res, { features: planCatalog.listFeatureRegistry() }, { source: 'plans_catalog' });
  });
  router.post(base + '/plans/features', ...guard, requirePermission('plans.manage_features'), (req, res) => {
    try {
      const before = req.body && req.body.key ? planCatalog.getFeature(req.body.key) : null;
      const feature = planCatalog.upsertFeatureRegistry(req.body || {}, actor(req).actorEmail);
      audit.append(Object.assign(actor(req), { action: before ? 'plans.feature.update' : 'plans.feature.create', entityType: 'feature', entityId: feature.key, before, after: feature }));
      ok(res, { feature });
    } catch (e) { return fail(res, 400, e.message || 'Could not save feature', 'validation_error'); }
  });
  router.get(base + '/plans/:id', ...guard, requirePermission('plans.view'), (req, res) => {
    const plan = planCatalog.getPlan(req.params.id);
    if (!plan) return fail(res, 404, 'Plan not found.', 'not_found');
    ok(res, { plan: planAdminView(plan) }, { source: 'plans_catalog' });
  });
  router.post(base + '/plans', ...guard, requirePermission('plans.create'), (req, res) => {
    try {
      const result = planCatalog.createPlan(req.body || {}, actor(req).actorEmail);
      audit.append(Object.assign(actor(req), { action: 'plans.create', entityType: 'plan', entityId: result.plan.id, before: null, after: result }));
      ok(res, { plan: planAdminView(result.plan), created: result }, {}, 201);
    } catch (e) { return fail(res, 400, e.message || 'Could not create plan', 'validation_error'); }
  });
  router.put(base + '/plans/:id', ...guard, requirePermission('plans.edit'), (req, res) => {
    try {
      const beforePlan = planCatalog.getPlan(req.params.id);
      if (!beforePlan) return fail(res, 404, 'Plan not found.', 'not_found');
      const before = planAdminView(beforePlan);
      const result = planCatalog.updatePlan(req.params.id, req.body || {}, actor(req).actorEmail);
      const after = planAdminView(result.plan);
      const action = (req.body && (req.body.features || req.body.flags)) ? 'plans.manage_features_limits' : ((req.body && (req.body.monthlyPricePaise!=null || req.body.annualPricePaise!=null || req.body.monthlyPrice!=null || req.body.annualPrice!=null)) ? 'plans.change_pricing' : 'plans.edit');
      audit.append(Object.assign(actor(req), { action, entityType: 'plan', entityId: result.plan.id, before, after, metadata: { summary: req.body && (req.body.changeSummary || req.body.notes) } }));
      ok(res, { plan: after, result });
    } catch (e) { return fail(res, 400, e.message || 'Could not update plan', 'validation_error'); }
  });
  router.patch(base + '/plans/:id', ...guard, requirePermission('plans.edit'), (req, res) => {
    try {
      const beforePlan = planCatalog.getPlan(req.params.id);
      if (!beforePlan) return fail(res, 404, 'Plan not found.', 'not_found');
      const before = planAdminView(beforePlan);
      const result = planCatalog.updatePlan(req.params.id, req.body || {}, actor(req).actorEmail);
      const after = planAdminView(result.plan);
      audit.append(Object.assign(actor(req), { action: 'plans.edit', entityType: 'plan', entityId: result.plan.id, before, after }));
      ok(res, { plan: after, result });
    } catch (e) { return fail(res, 400, e.message || 'Could not update plan', 'validation_error'); }
  });
  router.post(base + '/plans/:id/duplicate', ...guard, requirePermission('plans.create'), (req, res) => {
    try {
      const result = planCatalog.duplicatePlan(req.params.id, actor(req).actorEmail, req.body || {});
      audit.append(Object.assign(actor(req), { action: 'plans.duplicate', entityType: 'plan', entityId: result.plan.id, before: { sourcePlanId: req.params.id }, after: result }));
      ok(res, { plan: planAdminView(result.plan), created: result });
    } catch (e) { return fail(res, 400, e.message || 'Could not duplicate plan', 'validation_error'); }
  });
  router.post(base + '/plans/:id/activate', ...guard, requirePermission('plans.activate'), (req, res) => {
    try {
      const beforePlan = planCatalog.getPlan(req.params.id);
      if (!beforePlan) return fail(res, 404, 'Plan not found.', 'not_found');
      const before = planAdminView(beforePlan);
      const plan = planCatalog.setPlanStatus(req.params.id, 'active', actor(req).actorEmail);
      const after = planAdminView(plan);
      audit.append(Object.assign(actor(req), { action: 'plans.activate', entityType: 'plan', entityId: plan.id, before, after }));
      ok(res, { plan: after });
    } catch (e) { return fail(res, 400, e.message || 'Could not activate plan', 'validation_error'); }
  });
  router.post(base + '/plans/:id/deactivate', ...guard, requirePermission('plans.activate'), (req, res) => {
    try {
      const beforePlan = planCatalog.getPlan(req.params.id);
      if (!beforePlan) return fail(res, 404, 'Plan not found.', 'not_found');
      const before = planAdminView(beforePlan);
      const plan = planCatalog.setPlanStatus(req.params.id, 'inactive', actor(req).actorEmail);
      const after = planAdminView(plan);
      audit.append(Object.assign(actor(req), { action: 'plans.deactivate', entityType: 'plan', entityId: plan.id, before, after }));
      ok(res, { plan: after });
    } catch (e) { return fail(res, 400, e.message || 'Could not deactivate plan', 'validation_error'); }
  });
  router.post(base + '/plans/:id/archive', ...guard, requirePermission('plans.archive'), (req, res) => {
    try {
      const beforePlan = planCatalog.getPlan(req.params.id);
      if (!beforePlan) return fail(res, 404, 'Plan not found.', 'not_found');
      const sc = subscriberCountsByPlan();
      const before = planAdminView(beforePlan);
      const plan = planCatalog.archivePlan(req.params.id, actor(req).actorEmail);
      const after = planAdminView(plan);
      audit.append(Object.assign(actor(req), { action: 'plans.archive', entityType: 'plan', entityId: plan.id, before, after, metadata: { subscriberCount: sc.counts[plan.id] || 0, note: 'Archived (soft). Existing subscribers/history preserved.' } }));
      ok(res, { plan: after, warning: (sc.counts[plan.id] || 0) > 0 ? 'Plan archived with existing subscribers/history; records preserved.' : null });
    } catch (e) { return fail(res, 400, e.message || 'Could not archive plan', 'validation_error'); }
  });
  router.post(base + '/plans/:id/schedule-pricing', ...guard, requirePermission('plans.change_pricing'), (req, res) => {
    try {
      const rec = planCatalog.schedulePricing(req.params.id, req.body || {}, actor(req).actorEmail);
      audit.append(Object.assign(actor(req), { action: 'plans.pricing.schedule', entityType: 'plan', entityId: req.params.id, before: null, after: rec }));
      ok(res, { schedule: rec });
    } catch (e) { return fail(res, 400, e.message || 'Could not schedule pricing', 'validation_error'); }
  });
  router.get(base + '/plans/:id/history', ...guard, requirePermission('plans.view_history'), (req, res) => {
    ok(res, { items: planCatalog.getHistory(req.params.id, req.query.limit), total: planCatalog.getHistory(req.params.id, 1000).length }, { source: 'plans_catalog' });
  });
  router.get(base + '/plans/:id/subscribers', ...guard, requirePermission('plans.view'), (req, res) => {
    const planId = String(req.params.id || '').toLowerCase();
    const db = store.load();
    const entSvc = require('../entitlements/entitlement.service');
    const items = (db.accounts || []).filter(a => {
      try { const ent = entSvc.resolveForAccount(a); return (ent && ent.planId) === planId || ((store.effectiveSubscription(a)||{}).planId === planId); } catch(e){ return ((store.effectiveSubscription(a)||{}).planId === planId); }
    }).map(a => {
      let ent = null; try { ent = entSvc.resolveForAccount(a); } catch(e){}
      const sub = store.effectiveSubscription(a) || {};
      return { accountId: a.id, name: a.name, email: a.email || a.contactEmail || null, storeName: a.storeName, planId: (ent&&ent.planId)||sub.planId, planVersionId: (ent&&ent.planVersionId)||sub.planVersionId||null, planVersionLabel: (ent&&ent.planVersionLabel)||sub.planVersionLabel||null, status: sub.status, cycle: sub.cycle, currentPeriodEnd: sub.currentPeriodEnd };
    });
    ok(res, { items, total: items.length, planId });
  });
  router.get(base + '/payments', ...guard, requirePermission('payments.view'), (req, res) => ok(res, { items: store.listPayments(null, Math.min(500, Number(req.query.limit)||100)), total: (store.load().payments||[]).length }, { source: 'saas_json' }));
  router.get(base + '/payments/summary', ...guard, requirePermission('payments.view'), (req, res) => {
    const list = store.load().payments || []; const captured = list.filter(p=>p.status==='captured');
    ok(res, { summary: { count: list.length, captured: captured.length, totalPaise: captured.reduce((s,p)=>s+(Number(p.amount)||0),0), currency: 'INR' } }, { source: 'saas_json' });
  });

  router.get(base + '/announcements', ...guard, requirePermission('communication.view'), (req, res) => ok(res, { items: announcements.list(), total: announcements.list().length }));
  router.post(base + '/announcements', ...guard, requirePermission('communication.manage'), (req, res) => { const row = announcements.create(req.body||{}, actor(req).actorEmail); audit.append(Object.assign(actor(req), { action: 'announcement.create', entityType: 'announcement', entityId: row.id, after: row })); ok(res, { announcement: row }); });
  router.patch(base + '/announcements/:id', ...guard, requirePermission('communication.manage'), (req, res) => { const before = announcements.get(req.params.id); const row = announcements.update(req.params.id, req.body||{}); if(!row) return fail(res,404,'Not found','not_found'); audit.append(Object.assign(actor(req), { action: 'announcement.update', entityType: 'announcement', entityId: row.id, before, after: row })); ok(res,{announcement:row}); });
  router.post(base + '/announcements/:id/publish', ...guard, requirePermission('communication.publish'), (req, res) => { const before = announcements.get(req.params.id); const row = announcements.publish(req.params.id); if(!row) return fail(res,404,'Not found','not_found'); audit.append(Object.assign(actor(req), { action: 'announcement.publish', entityType: 'announcement', entityId: row.id, before, after: row })); ok(res,{announcement:row}); });

  // Help & Tutorials (central tutorial library for POS users)
  router.get(base + '/help-tutorials', ...guard, requirePermission('communication.view'), (req, res) => {
    const items = helpTutorials.list();
    ok(res, { items, total: items.length, categories: helpTutorials.CATEGORIES, languages: helpTutorials.LANGUAGES }, { source: 'help_tutorials_store' });
  });
  router.get(base + '/help-tutorials/:id', ...guard, requirePermission('communication.view'), (req, res) => {
    const item = helpTutorials.get(req.params.id);
    if (!item) return fail(res, 404, 'Not found', 'not_found');
    ok(res, { tutorial: item }, { source: 'help_tutorials_store' });
  });
  router.post(base + '/help-tutorials', ...guard, requirePermission('communication.manage'), (req, res) => {
    try {
      const row = helpTutorials.create(req.body || {}, actor(req).actorEmail);
      audit.append(Object.assign(actor(req), { action: 'help_tutorial.create', entityType: 'help_tutorial', entityId: row.id, after: row }));
      ok(res, { tutorial: row });
    } catch (e) { return fail(res, 400, e.message || 'Could not create tutorial', e.code || 'validation_error', e.details ? { details: e.details } : {}); }
  });
  router.patch(base + '/help-tutorials/:id', ...guard, requirePermission('communication.manage'), (req, res) => {
    const before = helpTutorials.get(req.params.id);
    if (!before) return fail(res, 404, 'Not found', 'not_found');
    try {
      const row = helpTutorials.update(req.params.id, req.body || {});
      audit.append(Object.assign(actor(req), { action: 'help_tutorial.update', entityType: 'help_tutorial', entityId: row.id, before, after: row }));
      ok(res, { tutorial: row });
    } catch (e) { return fail(res, 400, e.message || 'Could not update tutorial', e.code || 'validation_error', e.details ? { details: e.details } : {}); }
  });
  router.post(base + '/help-tutorials/:id/publish', ...guard, requirePermission('communication.publish'), (req, res) => {
    const before = helpTutorials.get(req.params.id);
    if (!before) return fail(res, 404, 'Not found', 'not_found');
    try {
      const row = helpTutorials.publish(req.params.id);
      audit.append(Object.assign(actor(req), { action: 'help_tutorial.publish', entityType: 'help_tutorial', entityId: row.id, before, after: row }));
      ok(res, { tutorial: row });
    } catch (e) { return fail(res, 400, e.message || 'Could not publish tutorial', e.code || 'validation_error'); }
  });
  router.post(base + '/help-tutorials/:id/unpublish', ...guard, requirePermission('communication.publish'), (req, res) => {
    const before = helpTutorials.get(req.params.id);
    if (!before) return fail(res, 404, 'Not found', 'not_found');
    const row = helpTutorials.unpublish(req.params.id);
    audit.append(Object.assign(actor(req), { action: 'help_tutorial.unpublish', entityType: 'help_tutorial', entityId: row.id, before, after: row }));
    ok(res, { tutorial: row });
  });
  router.delete(base + '/help-tutorials/:id', ...guard, requirePermission('communication.manage'), (req, res) => {
    const before = helpTutorials.get(req.params.id);
    if (!before) return fail(res, 404, 'Not found', 'not_found');
    const row = helpTutorials.remove(req.params.id);
    audit.append(Object.assign(actor(req), { action: 'help_tutorial.delete', entityType: 'help_tutorial', entityId: before.id, before, after: null }));
    ok(res, { deleted: true, tutorial: row });
  });

  router.get(base + '/maintenance', ...guard, requirePermission('maintenance.view'), (req, res) => ok(res, { state: maintenance.getState() }));
  router.post(base + '/maintenance', ...guard, requirePermission('maintenance.control'), (req, res) => { const before = maintenance.getState(); const state = maintenance.setState(req.body||{}, actor(req).actorEmail); audit.append(Object.assign(actor(req), { action: 'maintenance.update', entityType: 'maintenance', entityId: 'current', before, after: state })); ok(res,{state}); });
  router.post(base + '/maintenance/schedule', ...guard, requirePermission('maintenance.schedule'), (req, res) => { const before = maintenance.getState(); const state = maintenance.schedule(req.body||{}, actor(req).actorEmail); audit.append(Object.assign(actor(req), { action: 'maintenance.schedule', entityType: 'maintenance', entityId: state.schedule && state.schedule.id, before, after: state })); ok(res,{state}); });
  router.get(base + '/maintenance/status', (req, res) => res.json(maintenance.publicStatus()));

  router.get(base + '/system/health', ...guard, requirePermission('system.view'), (req, res) => ok(res, { health: { api: 'ok', db: 'connected', payments: payments.provider(), timestamp: new Date().toISOString() } }, { source: 'runtime' }));
  router.get(base + '/system/metrics', ...guard, requirePermission('system.view'), (req, res) => ok(res, { metrics: Object.assign({}, store.statsSnapshot(), { uptimeSec: Math.floor(process.uptime()) }) }, { source: 'runtime' }));
  router.get(base + '/audit-logs', ...guard, requirePermission('audit.view'), (req, res) => ok(res, audit.query(req.query||{})));

  // Team management (separate super-admin staff store)
  router.get(base + '/team', ...guard, requirePermission('team.view'), (req, res) => {
    ok(res, { items: adminUsers.listUsers(), total: adminUsers.listUsers().length }, { source: 'super_admin_store' });
  });
  router.post(base + '/team/invite', ...guard, requirePermission('team.invite'), (req, res) => {
    try {
      const { email, name, role, password } = req.body || {};
      const allowed = ['owner','admin','developer','support','finance','operations'];
      const r = allowed.includes(role) ? role : 'admin';
      if (r === 'owner' && req.adminRole !== 'owner') return fail(res, 403, 'Only owner can assign owner role.', 'forbidden');
      const pwd = String(password == null ? '' : password);
      if (pwd.length < 8) return fail(res, 400, 'A password of at least 8 characters is required to invite a team member. Do not use default or shared passwords.', 'validation_error');
      const user = adminUsers.createUser({ email, name, role: r, password: pwd, status: 'active', invitedBy: actor(req).actorEmail });
      audit.append(Object.assign(actor(req), { action: 'team.invite', entityType: 'admin_user', entityId: user.id, after: adminUsers.publicUser(user) }));
      ok(res, { user: adminUsers.publicUser(user) });
    } catch (e) { return fail(res, 400, e.message || 'Could not create user', 'validation_error'); }
  });
  router.patch(base + '/team/:id', ...guard, requirePermission('team.manage_roles'), (req, res) => {
    const before = adminUsers.findById(req.params.id);
    if (!before) return fail(res, 404, 'Not found', 'not_found');
    if (before.role === 'owner' && req.adminRole !== 'owner') return fail(res, 403, 'Cannot modify owner.', 'forbidden');
    const { role, status, name } = req.body || {};
    if (role === 'owner' && req.adminRole !== 'owner') return fail(res, 403, 'Only owner can assign owner role.', 'forbidden');
    const updated = adminUsers.updateUser(req.params.id, { role, status, name });
    audit.append(Object.assign(actor(req), { action: 'team.update', entityType: 'admin_user', entityId: req.params.id, before: adminUsers.publicUser(before), after: adminUsers.publicUser(updated) }));
    ok(res, { user: adminUsers.publicUser(updated) });
  });

  router.get(base + '/notifications', ...guard, requirePermission('notifications.view'), (req, res) => ok(res, { items: [], total: 0 }, { source: 'live_empty', note: 'Notification store not yet provisioned; add admin_notifications persistence as additive follow-up.' }));
  router.get(base + '/support/tickets', ...guard, requirePermission('support.view'), (req, res) => ok(res, { items: [], total: 0 }, { source: 'live_empty', note: 'Support ticket store not yet provisioned; add admin_tickets persistence as additive follow-up.' }));
  router.get(base + '/reports/:type', ...guard, requirePermission('reports.view'), (req, res) => {
    const db = store.load();
    const accounts = db.accounts || [];
    const paymentsList = db.payments || [];
    const type = req.params.type || 'summary';
    const captured = paymentsList.filter(p => p.status === 'captured');
    const totalRevenue = captured.reduce((s,p)=>s + (Number(p.amount)||0), 0);
    const byPlan = {};
    accounts.forEach(a => { const p = (store.effectivePlan(a)||{}).id || (store.effectiveSubscription(a)||{}).planId || 'free'; byPlan[p] = (byPlan[p]||0) + 1; });
    const summary = { accounts: accounts.length, payments: paymentsList.length, capturedPayments: captured.length, totalRevenuePaise: totalRevenue, byPlan };
    const rows = type === 'payments' ? paymentsList.slice(-100).reverse() : type === 'users' ? accounts.slice(-100).reverse().map(a => ({ id: a.id, email: a.email||a.contactEmail||null, storeName: a.storeName, createdAt: a.createdAt, plan: (store.effectivePlan(a)||{}).id })) : [];
    ok(res, { type, rows, summary }, { source: 'saas_json', partial: true, note: 'Live summary from existing SaaS store. Advanced/export reports can be added incrementally.' });
  });
  router.get(base + '/settings', ...guard, requirePermission('settings.view'), (req, res) => ok(res, { settings: { platform: { currency: 'INR', timezone: process.env.TZ || 'system' }, payments: { provider: payments.provider(), keyConfigured: payments.provider() !== 'mock' }, maintenance: maintenance.publicStatus().maintenance, supabase: { configured: identity.supabaseConfigured() }, stores: { saas: true, audit: true, maintenance: true, announcements: true, adminUsers: true } } }, { secrets: 'masked', source: 'runtime' }));
};