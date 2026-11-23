'use strict';

const store = require('../store');
const plans = require('../plans/catalog.service');
const { getPlan: legacyGetPlan, featureLabel } = require('../plans');

function normalizeLimit(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function inPeriod(ts, start, end) {
  if (!ts) return false;
  if (start && ts < start) return false;
  if (end && ts >= end) return false;
  return true;
}

function periodWindow(account, sub) {
  const now = Date.now();
  // Prefer subscription period for paid/active subs; fallback to calendar month.
  if (sub && sub.currentPeriodStart && sub.currentPeriodEnd) {
    return { start: sub.currentPeriodStart, end: sub.currentPeriodEnd, key: 'sub:' + (sub.planVersionId || sub.planId || 'free') + ':' + sub.currentPeriodStart };
  }
  // fallback calendar month
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  return { start, end, key };
}

function countUsageInWindow(db, accountId, kind, win) {
  let rows = (db.usage || []).filter(u => u.accountId === accountId && u.kind === kind);
  // if subscription-period window, count by timestamp range; else match period key where present
  if (win.key && String(win.key).indexOf('sub:') === 0) {
    rows = rows.filter(u => inPeriod(u.createdAt || 0, win.start, win.end));
  } else {
    rows = rows.filter(u => (u.period === win.key) || inPeriod(u.createdAt || 0, win.start, win.end));
  }
  return rows.reduce((s, r) => s + (Number(r.quantity) || (r.kind === 'products' ? 0 : 1)), 0);
}

function registry() {
  try { return plans.listFeatureRegistry() || []; } catch (e) { return []; }
}
function isFeatureImplemented(key) {
  const r = registry();
  const f = r.find(x => x.key === key);
  if (f) return !!f.implemented;
  // legacy keys treated implemented
  return ['pos_billing','inventory_management','customer_management','pdf_invoice','sales_history','receipts','whatsapp_share','expiry_alerts','returns','stock_timeline','damage_tracking','csv_export','remove_pdf_watermark','report_export'].includes(key);
}

function normalizeFeatureKeys(keys) {
  const arr = Array.isArray(keys) ? keys : [];
  // expand aliases so legacy and new keys both work
  const set = new Set(arr);
  if (set.has('billing')) set.add('pos_billing');
  if (set.has('pos_billing')) set.add('billing');
  if (set.has('inventory')) set.add('inventory_management');
  if (set.has('inventory_management')) set.add('inventory');
  if (set.has('customers')) set.add('customer_management');
  if (set.has('customer_management')) set.add('customers');
  if (set.has('csv_export')) set.add('report_export');
  // remove_pdf_watermark implies pdf_invoice customization; report_export implies csv_export
  return Array.from(set);
}

function buildEntitlementFromVersion(plan, ver, account, sub, opts) {
  const db = store.load();
  const win = periodWindow(account, sub);
  const lim = (ver && ver.limits) || {};
  const flags = (ver && ver.flags) || {};
  const rawFeatures = normalizeFeatureKeys((ver && ver.features) || []);
  const effectiveFeatures = rawFeatures.filter(k => isFeatureImplemented(k));
  const limits = {
    billsPerMonth: normalizeLimit(lim.maxBillsPerCycle),
    products: normalizeLimit(lim.maxProducts),
    customers: normalizeLimit(lim.maxCustomers),
    stores: normalizeLimit(lim.maxStores),
    staff: normalizeLimit(lim.maxStaff),
    devices: normalizeLimit(lim.maxStaff),
    storageMb: normalizeLimit(lim.storageLimitMb)
  };
  // usage counts: bills in current cycle window; products/customers from account counters (active counts)
  const billsUsed = countUsageInWindow(db, account.id, 'bill', win);
  const productsUsed = Number(account.productCount || 0);
  const customersUsed = Number(account.customerCount || 0);
  const storesUsed = Number(account.storeCount || 1) || 1;
  const staffUsed = Number(account.staffCount || 0);

  const planPublic = plans.toPublicPlan ? plans.toPublicPlan(plan, ver) : (plans.planDefinition(plan.id)||{}).public;
  const publicPlan = planPublic || {
    id: plan.id, name: plan.name, description: plan.description || '', tagline: plan.description || '',
    badge: plan.status === 'active' ? '' : plan.status, status: plan.status,
    availableForNew: plan.availableForNew !== false,
    currency: ver.currency || plan.currency || 'INR',
    planVersionId: ver.id, planVersionLabel: ver.label,
    price: { monthly: ver.monthlyPricePaise || 0, yearly: ver.annualPricePaise || 0 },
    limits: { billsPerMonth: limits.billsPerMonth, products: limits.products, customers: limits.customers, stores: limits.stores, staff: limits.staff, devices: limits.devices, storageMb: limits.storageMb },
    flags: { pdfWatermark: !!flags.pdfWatermark, reportExport: !!flags.reportExport },
    features: effectiveFeatures, highlights: []
  };

  return {
    plan: publicPlan,
    planId: plan.id,
    planVersionId: ver.id,
    planVersionLabel: ver.label,
    subscription: sub,
    features: effectiveFeatures,
    limits: { billsPerMonth: limits.billsPerMonth, products: limits.products, customers: limits.customers, stores: limits.stores, staff: limits.staff, devices: limits.devices, storageMb: limits.storageMb },
    flags: { pdfWatermark: !!flags.pdfWatermark, reportExport: !!flags.reportExport },
    usage: {
      period: win.key,
      periodStart: win.start,
      periodEnd: win.end,
      bills: usageBucket(billsUsed, limits.billsPerMonth),
      products: usageBucket(productsUsed, limits.products),
      customers: usageBucket(customersUsed, limits.customers),
      stores: usageBucket(storesUsed, limits.stores),
      staff: usageBucket(staffUsed, limits.staff),
      counters: { returns: countUsageInWindow(db, account.id, 'return', win), whatsapp: countUsageInWindow(db, account.id, 'whatsapp', win), exports: countUsageInWindow(db, account.id, 'export', win) }
    },
    version: { id: ver.id, label: ver.label, versionNo: ver.versionNo, planId: plan.id },
    serverTime: Date.now()
  };
}

function usageBucket(used, limit) {
  const u = Number(used) || 0;
  if (limit == null) return { used: u, limit: null, remaining: null, percent: 0, unlimited: true };
  const l = Number(limit) || 0;
  const remaining = Math.max(0, l - u);
  const percent = l > 0 ? Math.min(100, Math.round((u / l) * 100)) : 100;
  return { used: u, limit: l, remaining, percent, unlimited: false };
}

function ensureAccountVersionLink(account) {
  if (!account) return null;
  const sub = store.effectiveSubscription(account) || account.subscription || {};
  if (sub.planVersionId) {
    const ver = plans.getVersion(sub.planVersionId);
    if (ver) return { planId: ver.planId, versionId: ver.id, sub };
  }
  // Lazy backfill/map: assign current version of effective plan id, but mark grandfathered mapping
  const planId = (sub && sub.planId) || 'free';
  let ver = plans.getCurrentVersion(planId);
  if (!ver) {
    // try seed/legacy
    plans.ensureLegacyCompatibilityVersions();
    ver = plans.getCurrentVersion(planId) || plans.getCurrentVersion('free');
  }
  if (ver) {
    if (!account.subscription) account.subscription = store.defaultFreeSubscription();
    account.subscription.planVersionId = ver.id;
    account.subscription.planVersionLabel = ver.label || ('v' + (ver.versionNo||1));
    account.subscription.grandfatheredAt = account.subscription.grandfatheredAt || Date.now();
    account.subscription.entitlementsSource = 'versioned_lazy_backfill';
    try { store.save(); } catch (e) {}
    return { planId: ver.planId, versionId: ver.id, sub: account.subscription };
  }
  return null;
}

function resolveForAccount(account) {
  if (!account) {
    const defPlan = plans.getPlan('free') || { id: 'free', name: 'Free', status: 'active' };
    const ver = plans.getCurrentVersion('free');
    if (ver) return buildEntitlementFromVersion(defPlan, ver, { id: 'anon', usage: {}, productCount: 0, customerCount: 0 }, { planId: 'free', status: 'active' });
    const lp = legacyGetPlan('free');
    return { plan: lp, features: lp.features || [], limits: lp.limits || {}, flags: { pdfWatermark: false, reportExport: false }, usage: { bills:{used:0,limit:50,remaining:50,percent:0}, products:{used:0,limit:100,remaining:100,percent:0}, customers:{used:0,limit:null,remaining:null,percent:0} }, planVersionId: null };
  }

  // Admin override: full access (pro-equivalent, unrestricted)
  if (account.role === 'admin') {
    const plan = plans.getPlan('pro') || { id: 'pro', name: 'Pro', status: 'active', currency: 'INR' };
    let ver = plans.getCurrentVersion('pro') || (plans.planDefinition('pro')||{}).version;
    if (!ver) ver = { id: 'admin_virtual', planId: 'pro', versionNo: 0, label: 'admin', currency: 'INR', monthlyPricePaise:0, annualPricePaise:0, features: Array.from(new Set((registry().filter(f=>f.implemented).map(f=>f.key)).concat(['pos_billing','inventory_management','customer_management','pdf_invoice','remove_pdf_watermark','report_export','csv_export','returns','stock_timeline','damage_tracking']))), limits: { maxBillsPerCycle: null, maxProducts: null, maxCustomers: null, maxStores: null, maxStaff: null, storageLimitMb: null }, flags: { pdfWatermark: false, reportExport: true } };
    const sub = store.effectiveSubscription(account);
    const ent = buildEntitlementFromVersion(plan, ver, account, Object.assign({}, sub, { planId: 'pro', status: 'active' }));
    ent.subscription = Object.assign({}, ent.subscription, { planId: 'pro', effectivePlanId: 'pro', status: 'active', isPaid: true, daysLeft: null });
    // ensure all implemented features for admin
    const allImpl = registry().filter(f=>f.implemented).map(f=>f.key);
    ent.features = normalizeFeatureKeys(Array.from(new Set((ent.features||[]).concat(allImpl))));
    ent.flags = { pdfWatermark: false, reportExport: true };
    return ent;
  }

  const subEff = store.effectiveSubscription(account);
  const link = ensureAccountVersionLink(account);
  let plan = null, ver = null;
  if (link && link.versionId) {
    ver = plans.getVersion(link.versionId);
    if (ver) plan = plans.getPlan(ver.planId) || plans.getPlan(link.planId);
  }
  if (!ver || !plan) {
    const pid = (subEff && subEff.planId) || 'free';
    plan = plans.getPlan(pid) || plans.getPlan('free');
    ver = plans.getCurrentVersion(plan ? plan.id : 'free');
  }
  // If paid subscription expired -> effective free (store.effectiveSubscription/effectivePlan already handle, but ensure versioned free)
  if (!ver) {
    const lp = legacyGetPlan((subEff && subEff.planId) || 'free') || legacyGetPlan('free');
    return { plan: lp, planId: lp.id, planVersionId: null, features: normalizeFeatureKeys(lp.features||[]), limits: Object.assign({customers:null,stores:null,staff:null,devices:lp.limits&&lp.limits.devices,storageMb:null}, lp.limits||{}), flags: { pdfWatermark: lp.id === 'free', reportExport: lp.id !== 'free' }, usage: { bills:{used:0,limit:lp.limits&&lp.limits.billsPerMonth,remaining:null,percent:0}, products:{used:Number(account.productCount||0),limit:lp.limits&&lp.limits.products,remaining:null,percent:0}, customers:{used:0,limit:null,remaining:null,percent:0} }, subscription: subEff, serverTime: Date.now() };
  }

  // Respect effective access: if store downgraded to free due to expiry, serve free version entitlements
  let effectivePlanId = plan.id;
  let effectiveVer = ver;
  let effectiveSub = Object.assign({}, subEff);
  if (subEff && subEff.status && subEff.status !== 'active' && subEff.planId !== 'free') {
    const freePlan = plans.getPlan('free');
    const freeVer = plans.getCurrentVersion('free');
    if (freePlan && freeVer) {
      effectivePlanId = 'free'; effectiveVer = freeVer; plan = freePlan; ver = freeVer;
      effectiveSub = Object.assign({}, subEff, { effectivePlanId: 'free', isPaid: false });
    }
  } else if (subEff && subEff.planId === 'free') {
    // ensure free version
    const freePlan = plans.getPlan('free') || plan;
    const freeVer = plans.getCurrentVersion('free') || ver;
    plan = freePlan; ver = freeVer; effectivePlanId = 'free';
  }

  const ent = buildEntitlementFromVersion(plan, ver, account, effectiveSub);
  ent.subscription = Object.assign({}, ent.subscription || subEff, {
    planId: subEff ? subEff.planId : plan.id,
    effectivePlanId: effectivePlanId,
    status: subEff ? subEff.status : 'active',
    cycle: subEff ? subEff.cycle : 'monthly',
    currentPeriodStart: subEff ? subEff.currentPeriodStart : null,
    currentPeriodEnd: subEff ? subEff.currentPeriodEnd : null,
    cancelAtPeriodEnd: !!(subEff && subEff.cancelAtPeriodEnd),
    source: subEff ? subEff.source : 'default',
    daysLeft: store.daysLeft(subEff || {}),
    isPaid: effectivePlanId !== 'free',
    pendingPlanId: (subEff && subEff.planId !== effectivePlanId) ? subEff.planId : null,
    planVersionId: (account.subscription && account.subscription.planVersionId) || ver.id,
    planVersionLabel: (account.subscription && account.subscription.planVersionLabel) || ver.label
  });
  return ent;
}

function hasFeature(ent, featureKey) {
  if (!ent || !featureKey) return false;
  const keys = normalizeFeatureKeys(ent.features || []);
  // support legacy aliases
  const want = featureKey;
  return keys.includes(want) || (want === 'csv_export' && keys.includes('report_export')) || (want === 'report_export' && keys.includes('csv_export')) || (want === 'billing' && keys.includes('pos_billing'));
}

function limitOf(ent, key) {
  if (!ent || !ent.limits) return null;
  const map = { billsPerMonth: 'billsPerMonth', maxBillsPerCycle: 'billsPerMonth', products: 'products', maxProducts: 'products', customers: 'customers', maxCustomers: 'customers', stores: 'stores', maxStores: 'stores', staff: 'staff', maxStaff: 'staff', devices: 'devices', storageMb: 'storageMb' };
  const k = map[key] || key;
  const v = ent.limits[k];
  return v == null ? null : Number(v);
}

function usedOf(ent, key) {
  if (!ent || !ent.usage) return 0;
  const map = { billsPerMonth: 'bills', products: 'products', customers: 'customers', stores: 'stores', staff: 'staff' };
  const k = map[key] || key;
  const u = ent.usage[k];
  if (!u) return 0;
  return Number(u.used) || 0;
}

function withinLimit(ent, key, nextValue) {
  const lim = limitOf(ent, key);
  if (lim == null) return { ok: true, limit: null, used: usedOf(ent, key) };
  const used = nextValue != null ? Number(nextValue) : usedOf(ent, key);
  return { ok: used <= lim, limit: lim, used, remaining: Math.max(0, lim - used) };
}

function canConsumeBill(ent) {
  const lim = limitOf(ent, 'billsPerMonth');
  if (lim == null) return { ok: true, limit: null, used: usedOf(ent,'billsPerMonth') };
  const used = usedOf(ent, 'billsPerMonth');
  return { ok: used < lim, limit: lim, used, remaining: Math.max(0, lim - used) };
}

module.exports = {
  resolveForAccount,
  ensureAccountVersionLink,
  hasFeature,
  limitOf,
  withinLimit,
  canConsumeBill,
  normalizeFeatureKeys,
  isFeatureImplemented
};
