'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.HISAAB_DATA_DIR
  ? path.resolve(process.env.HISAAB_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'plans-catalog.json');
const MAX_HISTORY = 2000;

let state = null;

function now() { return Date.now(); }
function rid(prefix) { return (prefix || '') + crypto.randomBytes(8).toString('hex'); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function safeStr(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }
function toInt(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
function ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }

function defaultFeatures() {
  // Registry of known/implementable feature keys. `implemented` gates entitlement even if enabled on plan.
  const defs = [
    ['pos_billing', 'POS Billing', true],
    ['inventory_management', 'Inventory Management', true],
    ['customer_management', 'Customer Management', true],
    ['pdf_invoice', 'PDF Invoice', true],
    ['remove_pdf_watermark', 'Remove PDF Watermark', true],
    ['report_export', 'Report Export', true],
    ['csv_export', 'CSV Export', true],
    ['sales_history', 'Sales History', true],
    ['receipts', 'Thermal / A4 Receipts', true],
    ['whatsapp_share', 'WhatsApp Bill Sharing (text)', true],
    ['expiry_alerts', 'Expiry & Low-stock Alerts', true],
    ['returns', 'Sales Returns & Refunds', true],
    ['stock_timeline', 'Stock Movement Timeline', true],
    ['damage_tracking', 'Damaged Stock Tracking', true],
    ['barcode_printing', 'Barcode Printing', true],
    ['whatsapp_pdf', 'WhatsApp PDF Bill Sharing', false],
    ['advanced_analytics', 'Advanced Analytics', false],
    ['multiple_stores', 'Multiple Stores', false],
    ['staff_management', 'Staff Management', false],
    ['whatsapp_integration', 'WhatsApp Integration', false],
    ['advanced_reports', 'Advanced Sales Reports', false],
    ['priority_support', 'Priority Support', false],
    ['api_access', 'API Access', false],
    ['rewards', 'Points & Rewards', true],
    ['rewards_shopping_points', 'Shopping Points Rewards', true],
    ['rewards_free_product', 'Free Product Rewards', true],
    ['rewards_offer_product', 'Offer Product Rewards', true],
    ['rewards_share_earn', 'Referral (Share & Earn) Rewards', true],
    ['rewards_referral_monetary', 'Monetary Referral Rewards', true],
    ['rewards_referral_inventory_boost', 'Referral Inventory Limit Increase', true],
    ['rewards_referral_usage_boost', 'Referral Monthly Usage Limit Increase', true]
  ];
  return defs.map(([key, name, implemented]) => ({
    key, name, description: '', implemented: !!implemented, status: 'active', updatedAt: now()
  }));
}

function normalizeLimitValue(v) {
  if (v === null || v === undefined || v === '' || v === 'unlimited' || v === 'Unlimited') return null; // unlimited
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function defaultLimits(partial) {
  const p = partial || {};
  return {
    maxProducts: normalizeLimitValue(p.maxProducts),
    maxCustomers: normalizeLimitValue(p.maxCustomers),
    maxBillsPerCycle: normalizeLimitValue(p.maxBillsPerCycle),
    maxStores: normalizeLimitValue(p.maxStores),
    maxStaff: normalizeLimitValue(p.maxStaff),
    storageLimitMb: normalizeLimitValue(p.storageLimitMb)
  };
}

function defaultFlags(partial) {
  const p = partial || {};
  return {
    pdfWatermark: p.pdfWatermark === undefined ? false : !!p.pdfWatermark,
    reportExport: p.reportExport === undefined ? false : !!p.reportExport
  };
}

function makeVersion({ planId, versionNo, monthlyPricePaise, annualPricePaise, currency, billingCycle, features, limits, flags, label, status, notes, grandfatheredFrom, effectiveFrom, createdBy }) {
  const t = now();
  return {
    id: rid('pv_'),
    planId,
    versionNo: Number(versionNo) || 1,
    label: safeStr(label || ('v' + (Number(versionNo) || 1)), 40),
    status: status || 'active', // draft|active|retired|scheduled
    monthlyPricePaise: Math.max(0, toInt(monthlyPricePaise, 0)),
    annualPricePaise: Math.max(0, toInt(annualPricePaise, 0)),
    currency: safeStr(currency || 'INR', 8).toUpperCase(),
    billingCycle: safeStr(billingCycle || 'monthly', 20),
    features: Array.isArray(features) ? Array.from(new Set(features.map(f => safeStr(f, 80)).filter(Boolean))) : [],
    limits: defaultLimits(limits),
    flags: defaultFlags(flags),
    notes: safeStr(notes || '', 500),
    grandfatheredFrom: grandfatheredFrom || null,
    effectiveFrom: effectiveFrom || t,
    effectiveTo: null,
    createdAt: t,
    createdBy: createdBy || null
  };
}

function seed() {
  const t = now();
  const features = defaultFeatures();
  const freeVer = makeVersion({
    planId: 'free', versionNo: 1, label: 'v1', status: 'active',
    monthlyPricePaise: 0, annualPricePaise: 0, currency: 'INR',
    features: [
      'pos_billing','inventory_management','customer_management','pdf_invoice',
      'sales_history','receipts','whatsapp_share','expiry_alerts','barcode_printing'
    ],
    limits: { maxProducts: 20, maxCustomers: 20, maxBillsPerCycle: 200, maxStores: 1, maxStaff: 1, storageLimitMb: null },
    flags: { pdfWatermark: true, reportExport: false },
    notes: 'Initial Free plan'
  });
  const proVer = makeVersion({
    planId: 'pro', versionNo: 1, label: 'v1', status: 'active',
    monthlyPricePaise: 19900, annualPricePaise: 19900 * 10, currency: 'INR',
    features: [
      'pos_billing','inventory_management','customer_management','pdf_invoice','remove_pdf_watermark',
      'report_export','csv_export','sales_history','receipts','whatsapp_share','expiry_alerts',
      'returns','stock_timeline','damage_tracking','barcode_printing'
    ],
    limits: { maxProducts: null, maxCustomers: null, maxBillsPerCycle: null, maxStores: null, maxStaff: null, storageLimitMb: null },
    flags: { pdfWatermark: false, reportExport: true },
    notes: 'Initial Pro plan (unlimited subject to fair use)'
  });
  // Preserve a legacy-compatible Starter plan (retired for new subs, available for grandfathering/mapping)
  const starterVer = makeVersion({
    planId: 'starter', versionNo: 1, label: 'v1', status: 'active',
    monthlyPricePaise: 29900, annualPricePaise: 299900, currency: 'INR',
    features: [
      'pos_billing','inventory_management','customer_management','pdf_invoice','remove_pdf_watermark',
      'report_export','csv_export','sales_history','receipts','whatsapp_share','expiry_alerts',
      'returns','stock_timeline','damage_tracking','whatsapp_pdf','barcode_printing'
    ],
    limits: { maxProducts: 2000, maxCustomers: null, maxBillsPerCycle: 1000, maxStores: 1, maxStaff: 3, storageLimitMb: null },
    flags: { pdfWatermark: false, reportExport: true },
    notes: 'Legacy Starter plan (grandfathered compatibility)'
  });
  return {
    version: 1,
    plans: [
      { id: 'free', identifier: 'free', name: 'Free', description: 'Get started with essential POS billing.', currency: 'INR', billingCycle: 'monthly', status: 'active', availableForNew: true, displayOrder: 1, currentVersionId: freeVer.id, createdAt: t, updatedAt: t, archivedAt: null },
      { id: 'pro', identifier: 'pro', name: 'Pro', description: 'Full-featured plan for growing businesses.', currency: 'INR', billingCycle: 'monthly', status: 'active', availableForNew: true, displayOrder: 2, currentVersionId: proVer.id, createdAt: t, updatedAt: t, archivedAt: null },
      { id: 'starter', identifier: 'starter', name: 'Starter', description: 'Legacy plan (grandfathered).', currency: 'INR', billingCycle: 'monthly', status: 'inactive', availableForNew: false, displayOrder: 3, currentVersionId: starterVer.id, createdAt: t, updatedAt: t, archivedAt: null }
    ],
    versions: [freeVer, proVer, starterVer],
    featureRegistry: features,
    history: [],
    schedules: [], // future pricing changes (metadata/scheduling records)
    createdAt: t,
    updatedAt: t
  };
}

function load() {
  if (state) return state;
  ensureDir();
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state = Object.assign(seed(), raw || {});
      if (!Array.isArray(state.plans)) state.plans = [];
      if (!Array.isArray(state.versions)) state.versions = [];
      if (!Array.isArray(state.featureRegistry)) state.featureRegistry = defaultFeatures();
      if (!Array.isArray(state.history)) state.history = [];
      if (!Array.isArray(state.schedules)) state.schedules = [];
      if (ensureFeatureRollouts()) save();
    } else {
      state = seed();
      save();
    }
  } catch (e) {
    console.error('[PLANS] catalog load failed, seeding fresh:', e.message);
    state = seed();
  }
  return state;
}

/* ─── New-feature rollout ────────────────────────────────────────
   Features introduced after plans already existed (e.g. Barcode Printing)
   must not silently disappear from live plans: that would remove a capability
   customers already use. On first load after an upgrade we add the new key to
   the versions that existed at rollout time (behaviour preserved) and record
   their ids, so a Super Admin can still disable it per plan afterwards without
   the key being re-added on the next load. Versions created after the rollout
   start without the key until an admin enables it.
   ───────────────────────────────────────────────────────────────── */
const ROLLOUT_FEATURES = {
  barcode_printing: {
    name: 'Barcode Printing',
    description: 'Print product barcode labels from the Inventory action menu.'
  },
  // Registered for the Super Admin plan editor. `grant: false` means existing
  // plan versions are NOT auto-enabled — an admin chooses which plans include
  // each reward capability.
  rewards: { name: 'Points & Rewards', description: 'Loyalty points and customer rewards module.', grant: false },
  rewards_shopping_points: { name: 'Shopping Points Rewards', description: 'Earn/redeem points on purchases.', grant: false },
  rewards_free_product: { name: 'Free Product Rewards', description: 'Redeem points for free products.', grant: false },
  rewards_offer_product: { name: 'Offer Product Rewards', description: 'Buy X get Y or minimum-spend offers.', grant: false },
  rewards_share_earn: { name: 'Referral (Share & Earn) Rewards', description: 'Customer referral codes and tracking.', grant: false },
  rewards_referral_monetary: { name: 'Monetary Referral Rewards', description: 'Fixed currency referral reward.', grant: false },
  rewards_referral_inventory_boost: { name: 'Referral Inventory Limit Increase', description: 'One-time product limit increase per referral.', grant: false },
  rewards_referral_usage_boost: { name: 'Referral Monthly Usage Limit Increase', description: 'One-time monthly bill limit increase per referral.', grant: false }
};

function ensureFeatureRollouts() {
  if (!state) return false;
  if (!Array.isArray(state.featureRegistry)) state.featureRegistry = defaultFeatures();
  if (!state.featureRollouts || typeof state.featureRollouts !== 'object') state.featureRollouts = {};
  let changed = false;
  Object.keys(ROLLOUT_FEATURES).forEach(key => {
    const meta = ROLLOUT_FEATURES[key];
    if (!state.featureRegistry.find(f => f.key === key)) {
      state.featureRegistry.push({
        key,
        name: meta.name,
        description: meta.description,
        implemented: true,
        status: 'active',
        updatedAt: now()
      });
      changed = true;
    }
    let roll = state.featureRollouts[key];
    if (!roll || typeof roll !== 'object') {
      roll = state.featureRollouts[key] = { at: now(), appliedVersionIds: [] };
      changed = true;
    }
    if (!Array.isArray(roll.appliedVersionIds)) {
      roll.appliedVersionIds = [];
      changed = true;
    }
    // Registration-only features stay opt-in per plan version.
    if (meta.grant === false) return;
    const applied = new Set(roll.appliedVersionIds);
    (state.versions || []).forEach(ver => {
      if (!ver || !Array.isArray(ver.features)) return;
      if (applied.has(ver.id)) return;
      if ((ver.createdAt || 0) > roll.at) return; // newer version: admin decision
      if (ver.features.indexOf(key) === -1) {
        ver.features.push(key);
        changed = true;
      }
      roll.appliedVersionIds.push(ver.id);
      applied.add(ver.id);
      changed = true;
    });
  });
  return changed;
}

function save() {
  if (!state) return;
  ensureDir();
  state.updatedAt = now();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
  try { fs.renameSync(tmp, FILE); } catch (e) { fs.rmSync(FILE, { force: true }); fs.renameSync(tmp, FILE); }
}

function recordHistory(entry) {
  load();
  state.history.push(Object.assign({ id: rid('ph_'), at: now() }, entry || {}));
  if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
}

function getPlan(planId) {
  load();
  const id = safeStr(planId, 80).toLowerCase();
  return state.plans.find(p => p.id === id || p.identifier === id) || null;
}
function getVersion(versionId) {
  load();
  return state.versions.find(v => v.id === versionId) || null;
}
function getCurrentVersion(planId) {
  const p = getPlan(planId);
  if (!p) return null;
  return getVersion(p.currentVersionId) || state.versions.filter(v => v.planId === p.id).sort((a,b)=>(b.versionNo||0)-(a.versionNo||0))[0] || null;
}
function listPlans() { load(); return state.plans.slice().sort((a,b)=>(a.displayOrder||0)-(b.displayOrder||0)); }
function listVersions(planId) {
  load();
  const pid = safeStr(planId, 80).toLowerCase();
  return state.versions.filter(v => !pid || v.planId === pid).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
function listFeatureRegistry() { load(); return state.featureRegistry.slice(); }
function getFeature(key) { load(); const k = safeStr(key,80); return state.featureRegistry.find(f=>f.key===k)||null; }

function upsertFeatureRegistry(patch, actorEmail) {
  load();
  const key = safeStr(patch && patch.key, 80);
  if (!key) throw new Error('feature key required');
  let f = state.featureRegistry.find(x => x.key === key);
  const before = f ? clone(f) : null;
  if (!f) {
    f = { key, name: safeStr(patch.name || key, 120), description: safeStr(patch.description||'',300), implemented: !!patch.implemented, status: patch.status || 'active', updatedAt: now() };
    state.featureRegistry.push(f);
  } else {
    if (patch.name !== undefined) f.name = safeStr(patch.name, 120) || f.name;
    if (patch.description !== undefined) f.description = safeStr(patch.description, 300);
    if (patch.implemented !== undefined) f.implemented = !!patch.implemented;
    if (patch.status !== undefined) f.status = safeStr(patch.status, 30) || f.status;
    f.updatedAt = now();
  }
  recordHistory({ action: before ? 'feature.update' : 'feature.create', entityType: 'feature', entityId: key, before, after: clone(f), actor: actorEmail || null });
  save();
  return f;
}

function nextPlanId(identifier, name) {
  load();
  const base = safeStr(identifier || name || 'plan', 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || ('plan_' + Date.now());
  let id = base, i = 1;
  while (state.plans.find(p => p.id === id)) { i++; id = base + '_' + i; }
  return id;
}

function createPlan(input, actorEmail) {
  load();
  const id = nextPlanId(input.identifier || input.id, input.name);
  const t = now();
  const ver = makeVersion({
    planId: id, versionNo: 1, label: 'v1', status: 'active',
    monthlyPricePaise: input.monthlyPricePaise != null ? input.monthlyPricePaise : (Math.round(Number(input.monthlyPrice||0)*100)),
    annualPricePaise: input.annualPricePaise != null ? input.annualPricePaise : (Math.round(Number(input.annualPrice||0)*100)),
    currency: input.currency || 'INR',
    features: input.features || [],
    limits: input.limits || {},
    flags: input.flags || {},
    notes: input.notes || 'Initial version',
    createdBy: actorEmail || null
  });
  const plan = {
    id,
    identifier: id,
    name: safeStr(input.name || id, 80),
    description: safeStr(input.description || '', 500),
    currency: safeStr(input.currency || 'INR', 8).toUpperCase(),
    billingCycle: safeStr(input.billingCycle || 'monthly', 20),
    status: input.status || 'draft',
    availableForNew: input.availableForNew !== false,
    displayOrder: toInt(input.displayOrder, state.plans.length + 1),
    currentVersionId: ver.id,
    createdAt: t,
    updatedAt: t,
    archivedAt: null
  };
  state.plans.push(plan);
  state.versions.push(ver);
  recordHistory({ action: 'plan.create', entityType: 'plan', entityId: id, before: null, after: { plan: clone(plan), version: clone(ver) }, actor: actorEmail || null });
  save();
  return { plan, version: ver };
}

function retireCurrentVersion(plan, actorEmail) {
  if (!plan || !plan.currentVersionId) return null;
  const cur = getVersion(plan.currentVersionId);
  if (cur && cur.status === 'active') {
    const before = clone(cur);
    cur.status = 'retired';
    cur.effectiveTo = now();
    recordHistory({ action: 'plan.version.retire', entityType: 'plan_version', entityId: cur.id, before, after: clone(cur), actor: actorEmail || null });
  }
  return cur;
}

function updatePlan(planId, input, actorEmail) {
  load();
  const plan = getPlan(planId);
  if (!plan) throw new Error('Plan not found');
  const beforePlan = clone(plan);
  const pricingOrEntitlementChanged = ['monthlyPricePaise','annualPricePaise','monthlyPrice','annualPrice','features','limits','flags','currency'].some(k => input && Object.prototype.hasOwnProperty.call(input, k));
  let newVersion = null;

  if (input.name !== undefined) plan.name = safeStr(input.name, 80) || plan.name;
  if (input.description !== undefined) plan.description = safeStr(input.description, 500);
  if (input.billingCycle !== undefined) plan.billingCycle = safeStr(input.billingCycle, 20) || plan.billingCycle;
  if (input.displayOrder !== undefined) plan.displayOrder = toInt(input.displayOrder, plan.displayOrder || 0);
  if (input.availableForNew !== undefined) plan.availableForNew = !!input.availableForNew;
  if (input.status !== undefined) {
    const st = safeStr(input.status, 20).toLowerCase();
    if (['draft','active','inactive','archived'].includes(st)) plan.status = st;
    if (st === 'archived') plan.archivedAt = plan.archivedAt || now();
  }
  if (input.currency !== undefined) plan.currency = safeStr(input.currency, 8).toUpperCase() || plan.currency;
  plan.updatedAt = now();

  if (pricingOrEntitlementChanged) {
    const cur = getCurrentVersion(plan.id);
    const nextNo = (cur ? (Number(cur.versionNo)||1) : 0) + 1;
    const monthlyPricePaise = input.monthlyPricePaise != null ? toInt(input.monthlyPricePaise, 0) : (input.monthlyPrice != null ? Math.round(Number(input.monthlyPrice||0)*100) : (cur ? cur.monthlyPricePaise : 0));
    const annualPricePaise = input.annualPricePaise != null ? toInt(input.annualPricePaise, 0) : (input.annualPrice != null ? Math.round(Number(input.annualPrice||0)*100) : (cur ? cur.annualPricePaise : 0));
    retireCurrentVersion(plan, actorEmail);
    newVersion = makeVersion({
      planId: plan.id,
      versionNo: nextNo,
      label: safeStr(input.versionLabel || ('v' + nextNo), 40),
      status: 'active',
      monthlyPricePaise,
      annualPricePaise,
      currency: input.currency || plan.currency || (cur && cur.currency) || 'INR',
      features: input.features != null ? input.features : (cur ? cur.features : []),
      limits: input.limits != null ? Object.assign({}, cur ? cur.limits : {}, input.limits) : (cur ? cur.limits : {}),
      flags: input.flags != null ? Object.assign({}, cur ? cur.flags : {}, input.flags) : (cur ? cur.flags : {}),
      notes: input.notes || input.changeSummary || ('Update by ' + (actorEmail || 'admin')),
      createdBy: actorEmail || null
    });
    plan.currentVersionId = newVersion.id;
    plan.currency = newVersion.currency;
    state.versions.push(newVersion);
  }

  recordHistory({ action: pricingOrEntitlementChanged ? 'plan.update.versioned' : 'plan.update', entityType: 'plan', entityId: plan.id, before: beforePlan, after: { plan: clone(plan), version: newVersion ? clone(newVersion) : null }, actor: actorEmail || null });
  save();
  return { plan, version: newVersion || getCurrentVersion(plan.id) };
}

function duplicatePlan(planId, actorEmail, overrides) {
  load();
  const src = getPlan(planId);
  if (!src) throw new Error('Plan not found');
  const cur = getCurrentVersion(src.id);
  const ov = overrides || {};
  return createPlan({
    name: safeStr(ov.name || (src.name + ' Copy'), 80),
    description: ov.description != null ? ov.description : src.description,
    currency: ov.currency || src.currency || 'INR',
    billingCycle: ov.billingCycle || src.billingCycle || 'monthly',
    status: ov.status || 'draft',
    availableForNew: ov.availableForNew != null ? ov.availableForNew : false,
    displayOrder: state.plans.length + 1,
    monthlyPricePaise: cur ? cur.monthlyPricePaise : 0,
    annualPricePaise: cur ? cur.annualPricePaise : 0,
    features: cur ? clone(cur.features) : [],
    limits: cur ? clone(cur.limits) : {},
    flags: cur ? clone(cur.flags) : {},
    notes: 'Duplicated from ' + src.id + (cur ? (' ' + cur.label) : '')
  }, actorEmail);
}

function archivePlan(planId, actorEmail) {
  load();
  const plan = getPlan(planId);
  if (!plan) throw new Error('Plan not found');
  const before = clone(plan);
  plan.status = 'archived';
  plan.availableForNew = false;
  plan.archivedAt = now();
  plan.updatedAt = now();
  recordHistory({ action: 'plan.archive', entityType: 'plan', entityId: plan.id, before, after: clone(plan), actor: actorEmail || null });
  save();
  return plan;
}

function setPlanStatus(planId, status, actorEmail) {
  load();
  const plan = getPlan(planId);
  if (!plan) throw new Error('Plan not found');
  const st = safeStr(status, 20).toLowerCase();
  if (!['draft','active','inactive','archived'].includes(st)) throw new Error('Invalid status');
  const before = clone(plan);
  plan.status = st;
  if (st === 'archived') { plan.archivedAt = now(); plan.availableForNew = false; }
  if (st === 'active') { plan.archivedAt = null; }
  plan.updatedAt = now();
  recordHistory({ action: st === 'active' ? 'plan.activate' : (st === 'inactive' ? 'plan.deactivate' : 'plan.status'), entityType: 'plan', entityId: plan.id, before, after: clone(plan), actor: actorEmail || null });
  save();
  return plan;
}

function schedulePricing(planId, payload, actorEmail) {
  load();
  const plan = getPlan(planId);
  if (!plan) throw new Error('Plan not found');
  const rec = {
    id: rid('ps_'),
    planId: plan.id,
    status: 'scheduled',
    effectiveAt: payload.effectiveAt || null,
    monthlyPricePaise: payload.monthlyPricePaise != null ? toInt(payload.monthlyPricePaise,0) : null,
    annualPricePaise: payload.annualPricePaise != null ? toInt(payload.annualPricePaise,0) : null,
    note: safeStr(payload.note || payload.changeSummary || '', 500),
    payload: clone(payload || {}),
    createdAt: now(),
    createdBy: actorEmail || null
  };
  state.schedules.push(rec);
  recordHistory({ action: 'plan.pricing.schedule', entityType: 'plan', entityId: plan.id, before: null, after: clone(rec), actor: actorEmail || null });
  save();
  return rec;
}

function getHistory(planId, limit) {
  load();
  const pid = safeStr(planId, 80).toLowerCase();
  let rows = state.history.slice().reverse();
  if (pid) rows = rows.filter(h => h.entityId === pid || (h.after && h.after.plan && h.after.plan.id === pid) || (h.before && h.before.id === pid));
  return rows.slice(0, Math.max(1, Math.min(500, Number(limit)||100)));
}

function publicPlanView(planId) {
  const plan = getPlan(planId);
  if (!plan) return null;
  const ver = getCurrentVersion(plan.id);
  if (!ver) return null;
  return toPublicPlan(plan, ver);
}

function toPublicPlan(plan, ver) {
  const lim = (ver && ver.limits) || {};
  const flags = (ver && ver.flags) || {};
  return {
    id: plan.id,
    identifier: plan.identifier || plan.id,
    name: plan.name,
    description: plan.description || '',
    tagline: plan.description || '',
    badge: plan.status === 'active' ? (plan.id === 'pro' ? 'Best value' : (plan.id === 'free' ? 'Free forever' : '')) : plan.status,
    status: plan.status,
    availableForNew: plan.availableForNew !== false && plan.status === 'active',
    displayOrder: plan.displayOrder || 0,
    currency: ver.currency || plan.currency || 'INR',
    planVersionId: ver.id,
    planVersionLabel: ver.label,
    price: { monthly: ver.monthlyPricePaise || 0, yearly: ver.annualPricePaise || 0 },
    limits: {
      billsPerMonth: lim.maxBillsPerCycle == null ? null : lim.maxBillsPerCycle,
      products: lim.maxProducts == null ? null : lim.maxProducts,
      customers: lim.maxCustomers == null ? null : lim.maxCustomers,
      stores: lim.maxStores == null ? null : lim.maxStores,
      staff: lim.maxStaff == null ? null : lim.maxStaff,
      devices: lim.maxStaff == null ? null : lim.maxStaff,
      storageMb: lim.storageLimitMb == null ? null : lim.storageLimitMb
    },
    flags: {
      pdfWatermark: !!flags.pdfWatermark,
      reportExport: !!flags.reportExport
    },
    features: Array.isArray(ver.features) ? ver.features.slice() : [],
    highlights: buildHighlights(ver),
    updatedAt: plan.updatedAt || ver.createdAt
  };
}

function buildHighlights(ver) {
  const lim = (ver && ver.limits) || {};
  const flags = (ver && ver.flags) || {};
  const h = [];
  h.push(lim.maxBillsPerCycle == null ? 'Unlimited bills (fair use)' : (lim.maxBillsPerCycle + ' finalized bills / cycle'));
  h.push(lim.maxProducts == null ? 'Unlimited products (fair use)' : (lim.maxProducts + ' products'));
  h.push(lim.maxCustomers == null ? 'Unlimited customers (fair use)' : (lim.maxCustomers + ' customers'));
  if (flags.pdfWatermark) h.push('PDF invoice watermark enabled'); else h.push('PDF invoices without watermark');
  if (flags.reportExport) h.push('Report export enabled');
  return h;
}

function publicPlans() {
  load();
  return listPlans()
    .filter(p => p.status !== 'archived')
    .map(p => { const ver = getCurrentVersion(p.id); return ver ? toPublicPlan(p, ver) : null; })
    .filter(Boolean);
}

function availablePlansForNew() {
  return publicPlans().filter(p => p.availableForNew);
}

function planDefinition(planId) {
  const plan = getPlan(planId);
  if (!plan) return null;
  const ver = getCurrentVersion(plan.id);
  return ver ? { plan, version: ver, public: toPublicPlan(plan, ver) } : null;
}

function applyScheduledPricing(dueBeforeTs) {
  load();
  const due = Number(dueBeforeTs || now());
  let applied = 0;
  (state.schedules || []).forEach(s => {
    if (s.status !== 'scheduled') return;
    const at = s.effectiveAt ? Date.parse(s.effectiveAt) : null;
    if (at && at > due) return;
    try {
      updatePlan(s.planId, {
        monthlyPricePaise: s.monthlyPricePaise != null ? s.monthlyPricePaise : undefined,
        annualPricePaise: s.annualPricePaise != null ? s.annualPricePaise : undefined,
        notes: s.note || 'Scheduled pricing change applied'
      }, s.createdBy || 'system');
      s.status = 'applied';
      s.appliedAt = now();
      applied++;
    } catch (e) {
      s.status = 'failed';
      s.error = e.message;
    }
  });
  if (applied) save();
  return applied;
}

function ensureLegacyCompatibilityVersions() {
  // Ensure there is a version snapshot for legacy plan ids if present (idempotent).
  load();
  const need = [
    { id: 'free', priceM: 0, priceY: 0, limits: { maxProducts: 20, maxCustomers: 20, maxBillsPerCycle: 200, maxStores: 1, maxStaff: 1 }, flags: { pdfWatermark: true, reportExport: false } },
    { id: 'pro', priceM: 19900, priceY: 199000, limits: { maxProducts: null, maxCustomers: null, maxBillsPerCycle: null, maxStores: null, maxStaff: null }, flags: { pdfWatermark: false, reportExport: true } },
    { id: 'starter', priceM: 29900, priceY: 299900, limits: { maxProducts: 2000, maxCustomers: null, maxBillsPerCycle: 1000, maxStores: 1, maxStaff: 3 }, flags: { pdfWatermark: false, reportExport: true } }
  ];
  let changed = false;
  need.forEach(n => {
    const p = getPlan(n.id);
    if (!p) return;
    if (!p.currentVersionId || !getVersion(p.currentVersionId)) {
      const v = makeVersion({ planId: p.id, versionNo: 1, monthlyPricePaise: n.priceM, annualPricePaise: n.priceY, limits: n.limits, flags: n.flags, features: (getCurrentVersion(p.id)||{}).features || [] });
      state.versions.push(v); p.currentVersionId = v.id; changed = true;
    }
  });
  if (changed) save();
}

module.exports = {
  FILE,
  load,
  save,
  listPlans,
  listVersions,
  getPlan,
  getVersion,
  getCurrentVersion,
  publicPlanView,
  publicPlans,
  availablePlansForNew,
  planDefinition,
  createPlan,
  updatePlan,
  duplicatePlan,
  archivePlan,
  setPlanStatus,
  schedulePricing,
  applyScheduledPricing,
  getHistory,
  listFeatureRegistry,
  getFeature,
  upsertFeatureRegistry,
  ensureLegacyCompatibilityVersions
};
