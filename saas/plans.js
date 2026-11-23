/* ═════════════════════════════════════════════════════════════════════
   HISAAB POS – SaaS plan catalogue
   Backed by the shared Super Admin plan catalog (saas/plans/catalog.service.js)
   so plans created or edited in Super Admin are reflected in the POS automatically.
   All prices are stored in paise (₹1 = 100 paise).
   Limits set to null mean "unlimited".
   ═════════════════════════════════════════════════════════════════════ */

'use strict';

const catalogService = require('./plans/catalog.service');

const PLAN_ORDER = ['free', 'starter', 'pro'];

const FEATURES = {
  billing:            'Fast POS billing',
  inventory:          'Inventory & stock control',
  receipts:           'Thermal / A4 receipts',
  sales_history:      'Sales history',
  customers:          'Customer records & dues',
  whatsapp_share:     'WhatsApp bill sharing (text)',
  expiry_alerts:      'Expiry & low-stock alerts',
  returns:            'Sales returns & refunds',
  stock_timeline:     'Stock movement timeline',
  damage_tracking:    'Damaged stock tracking',
  barcode_printing:   'Barcode printing',
  csv_export:         'CSV export',
  whatsapp_pdf:       'WhatsApp PDF bill sharing',
  advanced_reports:   'Advanced sales reports',
  multi_store:        'Multiple stores',
  priority_support:   'Priority support',
  api_access:         'API access',
  rewards:            'Points & Rewards',
  rewards_shopping_points: 'Shopping Points rewards',
  rewards_free_product: 'Free Product rewards',
  rewards_offer_product: 'Offer Product rewards',
  rewards_share_earn: 'Referral (Share & Earn) rewards',
  rewards_referral_monetary: 'Monetary referral rewards',
  rewards_referral_inventory_boost: 'Referral inventory limit increase',
  rewards_referral_usage_boost: 'Referral usage limit increase'
};

// Map catalog feature keys to legacy POS feature keys
const CATALOG_TO_POS_FEATURES = {
  pos_billing:        'billing',
  inventory_management: 'inventory',
  pdf_invoice:        'receipts',
  sales_history:      'sales_history',
  customer_management: 'customers',
  whatsapp_share:     'whatsapp_share',
  expiry_alerts:      'expiry_alerts',
  returns:            'returns',
  stock_timeline:     'stock_timeline',
  damage_tracking:    'damage_tracking',
  csv_export:         'csv_export',
  whatsapp_pdf:       'whatsapp_pdf',
  advanced_analytics: 'advanced_reports',
  multiple_stores:    'multi_store',
  staff_management:   'priority_support',
  whatsapp_integration: 'whatsapp_share',
  advanced_reports:   'advanced_reports',
  priority_support:   'priority_support',
  api_access:         'api_access'
};

// PLANS kept for backward compatibility (derived from catalog on demand)
let PLANS = {};

function toPosPlan(plan, ver) {
  const lim = (ver && ver.limits) || {};
  const flags = (ver && ver.flags) || {};
  const features = (ver && ver.features) || [];
  const posFeatures = features.map(f => CATALOG_TO_POS_FEATURES[f] || f).filter(Boolean);

  return {
    id: plan.id,
    name: plan.name,
    tagline: plan.description || '',
    badge: plan.status === 'active'
      ? (plan.id === 'pro' ? 'Best value' : (plan.id === 'free' ? 'Free forever' : ''))
      : plan.status,
    price: { monthly: ver.monthlyPricePaise || 0, yearly: ver.annualPricePaise || 0 },
    limits: {
      billsPerMonth: lim.maxBillsPerCycle == null ? null : lim.maxBillsPerCycle,
      products: lim.maxProducts == null ? null : lim.maxProducts,
      devices: lim.maxStaff == null ? null : lim.maxStaff
    },
    features: posFeatures,
    highlights: buildHighlights(ver)
  };
}

function buildHighlights(ver) {
  const lim = (ver && ver.limits) || {};
  const flags = (ver && ver.flags) || {};
  const h = [];
  h.push(lim.maxBillsPerCycle == null ? 'Unlimited bills (fair use)' : (lim.maxBillsPerCycle + ' finalized bills / cycle'));
  h.push(lim.maxProducts == null ? 'Unlimited products (fair use)' : (lim.maxProducts + ' products'));
  if (flags.pdfWatermark) h.push('PDF invoice watermark enabled'); else h.push('PDF invoices without watermark');
  if (flags.reportExport) h.push('Report export enabled');
  return h;
}

function getPlan(id) {
  const key = String(id || '').toLowerCase();
  const plan = catalogService.getPlan(key);
  if (!plan) return null;
  const ver = catalogService.getCurrentVersion(plan.id);
  if (!ver) return null;
  return toPosPlan(plan, ver);
}

function planList() {
  return catalogService.listPlans()
    .filter(p => p.status !== 'archived')
    .map(p => {
      const ver = catalogService.getCurrentVersion(p.id);
      return ver ? toPosPlan(p, ver) : null;
    })
    .filter(Boolean);
}

function publicPlans() {
  return planList();
}

function featureLabel(key) {
  return FEATURES[key] || key;
}

function limitFor(plan, key) {
  if (!plan || !plan.limits) return null;
  const v = plan.limits[key];
  return v === null || v === undefined ? null : Number(v);
}

module.exports = {
  PLAN_ORDER,
  PLANS,
  FEATURES,
  getPlan,
  planList,
  publicPlans,
  featureLabel,
  limitFor
};
