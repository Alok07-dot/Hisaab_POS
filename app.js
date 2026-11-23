/* ══════════════════════════════════════════
   HISAAB POS – app.js  (LocalStorage-backed)
══════════════════════════════════════════ */

// ─── DATA STORE (local cache) + cloud sync hooks ────────────
const DB = {
  _onSet: null,   // set by CloudSync
  _onRemove: null,
  get: k => { try { return JSON.parse(localStorage.getItem('hisaab_' + k)) || null; } catch { return null; } },
  set: (k, v) => {
    try { localStorage.setItem('hisaab_' + k, JSON.stringify(v)); } catch (e) { console.warn('localStorage set failed', k, e); }
    if (k === 'products') {
      if (typeof renderNotifications === 'function') {
        try { renderNotifications(); } catch (e) { }
      }
      try {
        if (window.HisaabSaaS && typeof window.HisaabSaaS.syncProducts === 'function') {
          window.HisaabSaaS.syncProducts(Array.isArray(v) ? v.length : 0);
        }
      } catch (e) { }
    }
    if (DB._onSet) DB._onSet(k, v);
  },
  remove: k => {
    try { localStorage.removeItem('hisaab_' + k); } catch (e) { }
    if (DB._onRemove) DB._onRemove(k);
  },
  init: (k, def) => { if (!DB.get(k)) DB.set(k, def); return DB.get(k); }
};

// ─── DEMO DATA CLEANUP ───────────────────────────────────────
// Older builds shipped sample products/customers. Remove them once so a
// fresh shop starts with a clean database. Real records use generated IDs.
const LEGACY_DEMO_IDS = {
  products: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'],
  customers: ['c1', 'c2', 'c3', 'c4'],
  damages: ['d1', 'd2'],
  returns: ['r1']
};

function purgeLegacyDemoData() {
  if (DB.get('demoDataPurged_v1')) return;

  Object.entries(LEGACY_DEMO_IDS).forEach(([key, ids]) => {
    const rows = DB.get(key);
    if (!Array.isArray(rows)) return;
    const next = rows.filter(row => !ids.includes(row.id));
    if (next.length !== rows.length) DB.set(key, next);
  });

  const drawer = DB.get('cashDrawer');
  const hasDrawerActivity = drawer && (
    (Number(drawer.cashIn) || 0) !== 0 ||
    (Number(drawer.cashOut) || 0) !== 0 ||
    (Array.isArray(drawer.log) && drawer.log.length)
  );
  if (drawer && Number(drawer.opening) === 5000 && !hasDrawerActivity) {
    DB.set('cashDrawer', { opening: 0, cashIn: 0, cashOut: 0, log: [] });
  }

  const salesNow = DB.get('sales');
  if (Number(DB.get('invoiceCounter')) === 2 && (!Array.isArray(salesNow) || salesNow.length === 0)) {
    DB.set('invoiceCounter', 1);
  }

  DB.set('demoDataPurged_v1', true);
}
purgeLegacyDemoData();

// ─── STATE ──────────────────────────────────────────────────
let products = DB.init('products', []);
let customers = DB.init('customers', []);
let sales = DB.init('sales', []);
let damages = DB.init('damages', []);
let returns = DB.init('returns', []);
let cashDrawer = DB.init('cashDrawer', { opening: 0, cashIn: 0, cashOut: 0, log: [] });
let stockMovements = DB.init('stockMovements', []);
let categories = DB.init('categories', []);
let subcategories = DB.init('subcategories', []);
let brands = DB.init('brands', []);
let customerSettlements = DB.init('customerSettlements', []);
let loyaltySettings = DB.init('loyaltySettings', null);
let loyaltyTransactions = DB.init('loyaltyTransactions', []);
let rewardConfigs = DB.init('rewardConfigs', []);
let referrals = DB.init('referrals', []);
let referralGrants = DB.init('referralGrants', []);

let cart = [];
let selectedCustomer = null;
let paymentMethod = 'cash';
let invoiceCounter = DB.init('invoiceCounter', 1);
let editingProductId = null;

const CATALOG_CLOUD_KEYS = ['products', 'categories', 'subcategories', 'brands'];
const CLOUD_DATA_KEYS = ['products', 'categories', 'subcategories', 'brands', 'customers', 'sales', 'returns', 'damages', 'stockMovements', 'cashDrawer', 'invoiceCounter', 'waConfig', 'waLog', 'customerSettlements', 'loyaltySettings', 'loyaltyTransactions', 'rewardConfigs', 'referrals', 'referralGrants'];
const __dbSetRaw = DB.set.bind(DB);
DB.set = function (key, value) {
  __dbSetRaw(key, value);
  try {
    if (CLOUD_DATA_KEYS.indexOf(key) !== -1 && window.HisaabCloud && typeof window.HisaabCloud.queueCatalogPush === 'function') {
      window.HisaabCloud.queueCatalogPush(key);
    }
  } catch (e) { /* ignore cloud sync errors */ }
};

window.HisaabApplyCloudCatalog = function (catalog) {
  if (!catalog || typeof catalog !== 'object') return;

  function asArray(v, fallback) { return Array.isArray(v) ? v : (fallback || []); }
  function has(k) { return Object.prototype.hasOwnProperty.call(catalog, k); }

  if (has('products')) { const v = asArray(catalog.products); __dbSetRaw('products', v); products = v; }
  if (has('categories')) { const v = asArray(catalog.categories); __dbSetRaw('categories', v); categories = v; }
  if (has('subcategories')) { const v = asArray(catalog.subcategories); __dbSetRaw('subcategories', v); subcategories = v; }
  if (has('brands')) { const v = asArray(catalog.brands); __dbSetRaw('brands', v); brands = v; }
  if (has('customers')) { const v = asArray(catalog.customers); __dbSetRaw('customers', v); customers = v; }
  if (has('sales')) { const v = asArray(catalog.sales); __dbSetRaw('sales', v); sales = v; }
  if (has('returns')) { const v = asArray(catalog.returns); __dbSetRaw('returns', v); returns = v; }
  if (has('damages')) { const v = asArray(catalog.damages); __dbSetRaw('damages', v); damages = v; }
  if (has('stockMovements')) { const v = asArray(catalog.stockMovements); __dbSetRaw('stockMovements', v); stockMovements = v; }
  if (has('customerSettlements')) { const v = asArray(catalog.customerSettlements); __dbSetRaw('customerSettlements', v); customerSettlements = v; }
  if (has('loyaltySettings')) { const v = (catalog.loyaltySettings && typeof catalog.loyaltySettings === 'object') ? catalog.loyaltySettings : null; __dbSetRaw('loyaltySettings', v); loyaltySettings = v; }
  if (has('loyaltyTransactions')) { const v = asArray(catalog.loyaltyTransactions); __dbSetRaw('loyaltyTransactions', v); loyaltyTransactions = v; }
  if (has('rewardConfigs')) { const v = asArray(catalog.rewardConfigs); __dbSetRaw('rewardConfigs', v); rewardConfigs = v; }
  if (has('referrals')) { const v = asArray(catalog.referrals); __dbSetRaw('referrals', v); referrals = v; }
  if (has('referralGrants')) { const v = asArray(catalog.referralGrants); __dbSetRaw('referralGrants', v); referralGrants = v; }
  if (has('cashDrawer')) { const v = (catalog.cashDrawer && typeof catalog.cashDrawer === 'object') ? catalog.cashDrawer : { opening: 0, cashIn: 0, cashOut: 0, log: [] }; __dbSetRaw('cashDrawer', v); cashDrawer = v; }
  if (has('invoiceCounter')) { const v = Number(catalog.invoiceCounter) || 1; __dbSetRaw('invoiceCounter', v); invoiceCounter = v; }
  if (has('waConfig') || has('waLog')) {
    try {
      if (window.HisaabWhatsApp && typeof window.HisaabWhatsApp._cloudApply === 'function') {
        if (has('waConfig')) window.HisaabWhatsApp._cloudApply('waConfig', catalog.waConfig);
        if (has('waLog')) window.HisaabWhatsApp._cloudApply('waLog', catalog.waLog);
      } else {
        if (has('waConfig')) __dbSetRaw('waConfig', catalog.waConfig || {});
        if (has('waLog')) __dbSetRaw('waLog', asArray(catalog.waLog));
      }
    } catch (e) {}
  }

  try { if (typeof renderProducts === 'function') renderProducts(); } catch (e) {}
  try { if (typeof renderInventory === 'function') renderInventory(); } catch (e) {}
  try { if (typeof renderPosCatalog === 'function') renderPosCatalog(); } catch (e) {}
  try { if (typeof renderPosProductGrid === 'function') renderPosProductGrid(); } catch (e) {}
  try { if (typeof updatePosCategoryChips === 'function') updatePosCategoryChips(); } catch (e) {}
  try { if (typeof renderCategoriesSubcategories === 'function') renderCategoriesSubcategories(); } catch (e) {}
  try { if (typeof renderBrands === 'function') renderBrands(); } catch (e) {}
  try { if (typeof refreshCategoriesDatalist === 'function') refreshCategoriesDatalist(); } catch (e) {}
  try { if (typeof renderCategoryChips === 'function') renderCategoryChips(); } catch (e) {}
  try { if (typeof renderCart === 'function') renderCart(); } catch (e) {}
  try { if (typeof renderCartTotals === 'function') renderCartTotals(); } catch (e) {}
  try { if (typeof renderSales === 'function') renderSales(); } catch (e) {}
  try { if (typeof renderReturns === 'function') renderReturns(); } catch (e) {}
  try { if (typeof renderDamages === 'function') renderDamages(); } catch (e) {}
  try { if (typeof renderCustomers === 'function') renderCustomers(); } catch (e) {}
  try { if (typeof renderCustomerList === 'function') renderCustomerList(); } catch (e) {}
  try { if (typeof renderStockTimeline === 'function') renderStockTimeline(); } catch (e) {}
  try { if (typeof renderStockMovements === 'function') renderStockMovements(); } catch (e) {}
  try { if (typeof updateCashDrawerUI === 'function') updateCashDrawerUI(); } catch (e) {}
  try { if (typeof renderCashDrawer === 'function') renderCashDrawer(); } catch (e) {}
  try { if (typeof renderLoyaltyView === 'function' && document.getElementById('view-loyalty')?.classList.contains('active')) renderLoyaltyView(); } catch (e) {}
  try { if (typeof syncLoyaltyPosUi === 'function') syncLoyaltyPosUi(); } catch (e) {}
  try { if (typeof setDate === 'function') setDate(); } catch (e) {}
};

// Clears cached POS/business data so one account's data never leaks into another
// session (e.g. logout/login or switching orgs). Writes raw localStorage values
// and resets in-memory state without triggering cloud catalog push hooks.
window.HisaabResetCloudBusinessData = function (options) {
  options = options || {};
  const render = options.render !== false;

  const defaults = {
    products: [],
    categories: [],
    subcategories: [],
    brands: [],
    customers: [],
    sales: [],
    returns: [],
    damages: [],
    stockMovements: [],
    customerSettlements: [],
    loyaltySettings: null,
    loyaltyTransactions: [],
    rewardConfigs: [],
    referrals: [],
    referralGrants: [],
    cashDrawer: { opening: 0, cashIn: 0, cashOut: 0, log: [] },
    invoiceCounter: 1,
    waConfig: {},
    waLog: []
  };

  try { if (window.HisaabCloud && typeof window.HisaabCloud._suspendCatalogPush === 'function') window.HisaabCloud._suspendCatalogPush(); } catch (e) {}

  try {
    Object.keys(defaults).forEach(function (k) {
      try { localStorage.setItem('hisaab_' + k, JSON.stringify(defaults[k])); } catch (e) {}
    });
    // Remove transient drafts tied to a session/user context.
    try { localStorage.removeItem('hisaab_customerDraft'); } catch (e) {}
    // Store logo belongs to the business that just signed out.
    try { localStorage.removeItem('hisaab_storeLogo'); } catch (e) {}
  } catch (e) {}

  try { if (window.HisaabCloud && typeof window.HisaabCloud._resumeCatalogPush === 'function') window.HisaabCloud._resumeCatalogPush(); } catch (e) {}

  products = defaults.products;
  categories = defaults.categories;
  subcategories = defaults.subcategories;
  brands = defaults.brands;
  customers = defaults.customers;
  sales = defaults.sales;
  returns = defaults.returns;
  damages = defaults.damages;
  stockMovements = defaults.stockMovements;
  customerSettlements = defaults.customerSettlements;
  loyaltySettings = defaults.loyaltySettings;
  loyaltyTransactions = defaults.loyaltyTransactions;
  rewardConfigs = defaults.rewardConfigs;
  referrals = defaults.referrals;
  referralGrants = defaults.referralGrants;
  cashDrawer = defaults.cashDrawer;
  invoiceCounter = defaults.invoiceCounter;

  cart = [];
  selectedCustomer = null;
  editingProductId = null;
  try {
    if (window.HisaabWhatsApp && typeof window.HisaabWhatsApp._cloudApply === 'function') {
      window.HisaabWhatsApp._cloudApply('waConfig', defaults.waConfig);
      window.HisaabWhatsApp._cloudApply('waLog', defaults.waLog);
    }
  } catch (e) {}

  if (!render) return;

  try { if (typeof renderProducts === 'function') renderProducts(); } catch (e) {}
  try { if (typeof renderInventory === 'function') renderInventory(); } catch (e) {}
  try { if (typeof renderPosCatalog === 'function') renderPosCatalog(); } catch (e) {}
  try { if (typeof renderPosProductGrid === 'function') renderPosProductGrid(); } catch (e) {}
  try { if (typeof updatePosCategoryChips === 'function') updatePosCategoryChips(); } catch (e) {}
  try { if (typeof renderCategoriesSubcategories === 'function') renderCategoriesSubcategories(); } catch (e) {}
  try { if (typeof renderBrands === 'function') renderBrands(); } catch (e) {}
  try { if (typeof refreshCategoriesDatalist === 'function') refreshCategoriesDatalist(); } catch (e) {}
  try { if (typeof renderCategoryChips === 'function') renderCategoryChips(); } catch (e) {}
  try { if (typeof renderCart === 'function') renderCart(); } catch (e) {}
  try { if (typeof renderCartTotals === 'function') renderCartTotals(); } catch (e) {}
  try { if (typeof renderSales === 'function') renderSales(); } catch (e) {}
  try { if (typeof renderReturns === 'function') renderReturns(); } catch (e) {}
  try { if (typeof renderDamages === 'function') renderDamages(); } catch (e) {}
  try { if (typeof renderCustomers === 'function') renderCustomers(); } catch (e) {}
  try { if (typeof renderCustomerList === 'function') renderCustomerList(); } catch (e) {}
  try { if (typeof renderStockTimeline === 'function') renderStockTimeline(); } catch (e) {}
  try { if (typeof renderStockMovements === 'function') renderStockMovements(); } catch (e) {}
  try { if (typeof updateCashDrawerUI === 'function') updateCashDrawerUI(); } catch (e) {}
  try { if (typeof renderCashDrawer === 'function') renderCashDrawer(); } catch (e) {}
  try { if (typeof renderNotifications === 'function') renderNotifications(); } catch (e) {}
  try { if (typeof setDate === 'function') setDate(); } catch (e) {}
};

// ─── SUPABASE CLOUD SYNC ──────────────────────────────────────
// Keeps localStorage as the fast cache and mirrors data to Supabase
// when config.js has real credentials. Safe to leave unconfigured
// (app stays fully offline/local).
const CloudSync = (() => {
  // Collections: array-of-objects with .id  ->  Supabase table
  const COLLECTIONS = {
    products: 'hisaab_products',
    customers: 'hisaab_customers',
    sales: 'hisaab_sales',
    damages: 'hisaab_damages',
    returns: 'hisaab_returns',
    stockMovements: 'hisaab_stock_movements',
  };
  // Single values  ->  hisaab_settings (key/value)
  const SETTINGS = new Set(['invoiceCounter', 'cashDrawer', 'waConfig', 'waLog', 'customerDraft', 'posSettings', 'userProfile']);

  const timers = {};
  const lastIds = {};  // track IDs per collection to detect deletes

  function client() {
    // The legacy flat sync (hisaab_products, hisaab_sales, …) is retired once
    // the app runs on the multi-tenant Supabase schema. Business modules are
    // wired to RLS-scoped tables in a later phase, so this sync stays off in
    // cloud mode instead of writing to tables that no longer exist.
    if (window.HisaabCloud && window.HisaabCloud.isConfigured && window.HisaabCloud.isConfigured()) {
      return null;
    }
    return (window.HisaabSupabase && window.HisaabSupabase.isConfigured)
      ? window.HisaabSupabase.client : null;
  }

  function isOn() { return !!client(); }

  // ── Status indicator (small pill) ──
  let statusNode = null;
  function ensureStatusNode() {
    if (statusNode) return statusNode;
    statusNode = document.createElement('div');
    statusNode.id = 'cloudSyncStatus';
    statusNode.setAttribute('style',
      'position:fixed;bottom:10px;right:10px;z-index:9999;font:600 11px/1.2 system-ui,sans-serif;' +
      'padding:6px 10px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.12);' +
      'background:#fff;color:#374151;border:1px solid #e5e7eb;cursor:default;display:none;');
    document.body.appendChild(statusNode);
    return statusNode;
  }
  function setStatus(text, color) {
    try {
      const n = ensureStatusNode();
      n.style.display = 'inline-flex';
      n.style.alignItems = 'center';
      n.style.gap = '6px';
      n.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';display:inline-block"></span>' + text;
    } catch (e) { }
  }

  // ── Push (debounced per key) ──
  function push(key, value) {
    if (!isOn()) return;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => pushNow(key, value).catch(err => {
      console.warn('[CloudSync] push failed', key, err);
      setStatus('Cloud: retry needed', '#f59e0b');
    }), 350);
  }

  async function pushNow(key, value) {
    const sb = client(); if (!sb) return;
    if (COLLECTIONS[key]) {
      await pushCollection(sb, key, Array.isArray(value) ? value : []);
    } else if (SETTINGS.has(key)) {
      await pushSetting(sb, key, value);
    }
  }

  async function pushCollection(sb, key, arr) {
    const table = COLLECTIONS[key];
    const ids = arr.map(x => x && x.id).filter(Boolean);
    // Upsert current rows
    if (arr.length) {
      const rows = arr.filter(x => x && x.id).map(x => ({ id: String(x.id), data: x }));
      // chunk to stay under request limits
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await sb.from(table).upsert(rows.slice(i, i + 100), { onConflict: 'id' });
        if (error) throw error;
      }
    }
    // Delete rows removed locally (compare against last known IDs)
    const prev = lastIds[key];
    if (prev && prev.size) {
      const removed = [];
      prev.forEach(id => { if (!ids.includes(id)) removed.push(id); });
      if (removed.length) {
        const { error } = await sb.from(table).delete().in('id', removed);
        if (error) console.warn('[CloudSync] delete removed rows failed', key, error);
      }
    }
    // If first push and no prev, also clean up any cloud rows not in local
    // (skipped to avoid accidental wipes on partial state)
    lastIds[key] = new Set(ids.map(String));
    setStatus('Cloud: synced', '#16a34a');
  }

  async function pushSetting(sb, key, value) {
    if (value === undefined) return;
    const { error } = await sb.from('hisaab_settings').upsert(
      { key: String(key), value: value }, { onConflict: 'key' }
    );
    if (error) throw error;
    setStatus('Cloud: synced', '#16a34a');
  }

  async function removeSetting(key) {
    const sb = client(); if (!sb) return;
    if (SETTINGS.has(key)) {
      await sb.from('hisaab_settings').delete().eq('key', String(key));
    }
  }

  // ── Pull from cloud on startup ──
  async function pull() {
    const sb = client();
    if (!sb) {
      // Not configured — stay local
      return;
    }
    setStatus('Cloud: syncing…', '#3b82f6');
    try {
      // Check connectivity first
      const v = await window.HisaabSupabase.verifyConnection();
      if (!v || !v.connected) {
        setStatus('Cloud: offline (local)', '#f59e0b');
        console.warn('[CloudSync] not connected, using local data', v);
        return;
      }

      const colKeys = Object.keys(COLLECTIONS);
      let cloudHasAnything = false;

      // Pull each collection
      for (const key of colKeys) {
        const table = COLLECTIONS[key];
        const { data, error } = await sb.from(table).select('id,data');
        if (error) {
          // Table might not exist yet
          console.warn('[CloudSync] pull error', key, error.message);
          // If table missing, push local up as migration
          if (/relation .* does not exist|404|schema cache/i.test(error.message || '')) {
            await pushNow(key, DB.get(key) || (key === 'products' ? products : key === 'customers' ? customers : key === 'sales' ? sales : key === 'damages' ? damages : returns));
          }
          continue;
        }
        if (data && data.length) {
          cloudHasAnything = true;
          const arr = data.map(r => (r && r.data && typeof r.data === 'object') ? r.data : r).filter(Boolean);
          // Preserve order hint: sales newest-first by ts if present
          if (key === 'sales') arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
          applyCollection(key, arr);
          lastIds[key] = new Set(arr.map(x => String(x.id)).filter(Boolean));
        } else {
          // Cloud empty for this collection — push local data up (first sync / migration)
          const local = DB.get(key);
          if (local && Array.isArray(local) && local.length) {
            await pushNow(key, local);
          }
          lastIds[key] = new Set((local || []).map(x => String(x && x.id)).filter(Boolean));
        }
      }

      // Pull settings
      {
        const { data, error } = await sb.from('hisaab_settings').select('key,value');
        if (!error && data && data.length) {
          cloudHasAnything = true;
          data.forEach(r => { if (r && r.key) applySetting(r.key, r.value); });
        } else if (!error) {
          // Push local settings up
          ['invoiceCounter', 'cashDrawer', 'waConfig', 'waLog'].forEach(k => {
            const v = DB.get(k); if (v !== null && v !== undefined) pushNow(k, v);
          });
        } else if (/relation .* does not exist/i.test(error.message || '')) {
          console.warn('[CloudSync] settings table missing — run supabase-schema.sql');
        }
      }

      setStatus(cloudHasAnything ? 'Cloud: connected' : 'Cloud: connected (migrated local data)', '#16a34a');
      refreshUI();
    } catch (err) {
      console.error('[CloudSync] pull failed', err);
      setStatus('Cloud: error (using local)', '#ef4444');
    }
  }

  function applyCollection(key, arr) {
    // update local cache without re-triggering push loops from our own pull
    try { localStorage.setItem('hisaab_' + key, JSON.stringify(arr)); } catch (e) { }
    if (key === 'products') {
      products = arr;
      try {
        if (window.HisaabSaaS && typeof window.HisaabSaaS.syncProducts === 'function') {
          window.HisaabSaaS.syncProducts(Array.isArray(arr) ? arr.length : 0);
        }
      } catch (e) { }
    }
    if (key === 'customers') customers = arr;
    if (key === 'sales') sales = arr;
    if (key === 'damages') damages = arr;
    if (key === 'returns') returns = arr;
  }

  function applySetting(key, value) {
    try { localStorage.setItem('hisaab_' + key, JSON.stringify(value)); } catch (e) { }
    if (key === 'invoiceCounter') { invoiceCounter = Number(value) || invoiceCounter; if (typeof setDate === 'function') setDate(); }
    if (key === 'cashDrawer' && value && typeof value === 'object') cashDrawer = value;
    if (key === 'posSettings' && value && typeof value === 'object' && typeof applyPosSettings === 'function') applyPosSettings(value, true);
    if (key === 'userProfile' && value && typeof value === 'object' && typeof applyUserProfile === 'function') applyUserProfile(value, true);
    // waConfig/waLog live inside the WhatsApp IIFE — expose via window hook if available
    if ((key === 'waConfig' || key === 'waLog') && window.HisaabWhatsApp && window.HisaabWhatsApp._cloudApply) {
      window.HisaabWhatsApp._cloudApply(key, value);
    }
  }

  function refreshUI() {
    try { if (typeof renderInventory === 'function') renderInventory(); } catch (e) { }
    try { if (typeof renderNotifications === 'function') renderNotifications(); } catch (e) { }
    try { if (typeof renderCustomers === 'function') renderCustomers(); } catch (e) { }
    try { if (typeof renderSales === 'function') renderSales(); } catch (e) { }
    try { if (typeof renderDamages === 'function') renderDamages(); } catch (e) { }
    try { if (typeof renderReturns === 'function') renderReturns(); } catch (e) { }
    try { if (typeof renderCart === 'function') renderCart(); } catch (e) { }
    try { if (typeof renderCategoriesSubcategories === 'function') renderCategoriesSubcategories(); } catch (e) { }
    try { if (typeof renderBrands === 'function') renderBrands(); } catch (e) { }
    try { if (typeof updateDashboard === 'function') updateDashboard(); } catch (e) { }
    try { if (typeof updateReports === 'function') updateReports(); } catch (e) { }
  }

  // Wire DB hooks
  DB._onSet = push;
  DB._onRemove = (k) => { if (isOn() && SETTINGS.has(k)) removeSetting(k).catch(() => { }); };

  return {
    push, pull, pushAll: () => {
      if (!isOn()) return;
      Object.keys(COLLECTIONS).forEach(k => {
        const v = k === 'products' ? products : k === 'customers' ? customers : k === 'sales' ? sales : k === 'damages' ? damages : returns;
        pushNow(k, v);
      });
      pushNow('invoiceCounter', invoiceCounter);
      pushNow('cashDrawer', cashDrawer);
    }, isOn, setStatus
  };
})();
window.CloudSync = CloudSync;

// ─── HELPERS ────────────────────────────────────────────────
const currencySymbol = () => {
  try { const s = (typeof getPosSettings === 'function') ? getPosSettings() : (DB.get('posSettings') || {}); return (s && s.currencySymbol) ? String(s.currencySymbol) : '₹'; } catch { return '₹'; }
};
const fmt = n => {
  const v = Number(n);
  if (!isFinite(v)) return currencySymbol() + '0';
  return currencySymbol() + v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const els = id => document.getElementById(id);
const now = () => new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const uid = () => 'id' + Date.now() + Math.random().toString(36).slice(2, 6);

// ─── GST STATE HELPERS ──────────────────────────────────────
// GST state codes (first 2 digits of a GSTIN). Used to decide whether a sale
// is intra-state (CGST + SGST) or inter-state (IGST).
const GST_STATES = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'],
  ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'],
  ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'],
  ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'],
  ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'],
  ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory']
];

// City / old-name → state aliases so free-text addresses still resolve
const GST_STATE_ALIASES = {
  'new delhi': 'Delhi', 'ncr': 'Delhi', 'gurgaon': 'Haryana', 'gurugram': 'Haryana',
  'noida': 'Uttar Pradesh', 'ghaziabad': 'Uttar Pradesh', 'lucknow': 'Uttar Pradesh',
  'kanpur': 'Uttar Pradesh', 'varanasi': 'Uttar Pradesh', 'agra': 'Uttar Pradesh',
  'mumbai': 'Maharashtra', 'bombay': 'Maharashtra', 'pune': 'Maharashtra',
  'nagpur': 'Maharashtra', 'thane': 'Maharashtra', 'nashik': 'Maharashtra',
  'bengaluru': 'Karnataka', 'bangalore': 'Karnataka', 'mysore': 'Karnataka',
  'mysuru': 'Karnataka', 'hubli': 'Karnataka', 'mangalore': 'Karnataka',
  'chennai': 'Tamil Nadu', 'madras': 'Tamil Nadu', 'coimbatore': 'Tamil Nadu',
  'madurai': 'Tamil Nadu', 'kolkata': 'West Bengal', 'calcutta': 'West Bengal',
  'howrah': 'West Bengal', 'siliguri': 'West Bengal', 'hyderabad': 'Telangana',
  'secunderabad': 'Telangana', 'warangal': 'Telangana', 'visakhapatnam': 'Andhra Pradesh',
  'vizag': 'Andhra Pradesh', 'vijayawada': 'Andhra Pradesh', 'guntur': 'Andhra Pradesh',
  'ahmedabad': 'Gujarat', 'surat': 'Gujarat', 'vadodara': 'Gujarat', 'rajkot': 'Gujarat',
  'jaipur': 'Rajasthan', 'jodhpur': 'Rajasthan', 'udaipur': 'Rajasthan',
  'bhopal': 'Madhya Pradesh', 'indore': 'Madhya Pradesh', 'gwalior': 'Madhya Pradesh',
  'jabalpur': 'Madhya Pradesh', 'raipur': 'Chhattisgarh', 'bilaspur': 'Chhattisgarh',
  'patna': 'Bihar', 'gaya': 'Bihar', 'ranchi': 'Jharkhand', 'jamshedpur': 'Jharkhand',
  'bhubaneswar': 'Odisha', 'bhubaneshwar': 'Odisha', 'cuttack': 'Odisha',
  'orissa': 'Odisha', 'guwahati': 'Assam', 'dispur': 'Assam', 'shillong': 'Meghalaya',
  'imphal': 'Manipur', 'aizawl': 'Mizoram', 'kohima': 'Nagaland', 'agartala': 'Tripura',
  'gangtok': 'Sikkim', 'itanagar': 'Arunachal Pradesh', 'panaji': 'Goa', 'panjim': 'Goa',
  'kochi': 'Kerala', 'cochin': 'Kerala', 'cochin city': 'Kerala', 'trivandrum': 'Kerala',
  'thiruvananthapuram': 'Kerala', 'kozhikode': 'Kerala', 'calicut': 'Kerala',
  'chandigarh': 'Chandigarh', 'dehradun': 'Uttarakhand', 'shimla': 'Himachal Pradesh',
  'srinagar': 'Jammu & Kashmir', 'jammu': 'Jammu & Kashmir', 'leh': 'Ladakh',
  'pondicherry': 'Puducherry', 'puducherry': 'Puducherry'
};

function gstStateFromCode(code) {
  const c = String(code || '').trim().padStart(2, '0').slice(0, 2);
  const hit = GST_STATES.find(s => s[0] === c);
  return hit ? { code: hit[0], name: hit[1] } : null;
}

function gstCodeFromStateName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ');
  if (!n) return '';
  const hit = GST_STATES.find(s => s[1].toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ') === n);
  if (hit) return hit[0];
  const alias = GST_STATE_ALIASES[n];
  if (alias) {
    const byName = GST_STATES.find(s => s[1].toLowerCase() === alias.toLowerCase());
    return byName ? byName[0] : '';
  }
  return '';
}

function gstStateFromName(name) {
  const code = gstCodeFromStateName(name);
  return code ? gstStateFromCode(code) : null;
}

function gstStateFromGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) return null;
  return gstStateFromCode(g.slice(0, 2));
}

// Detect a state from free text like a customer address
function gstStateFromText(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return null;
  for (const s of GST_STATES) {
    const name = s[1].toLowerCase();
    if (raw.includes(name)) return { code: s[0], name: s[1] };
  }
  for (const alias of Object.keys(GST_STATE_ALIASES)) {
    if (raw.includes(alias)) return gstStateFromName(GST_STATE_ALIASES[alias]);
  }
  return null;
}

function businessGstState() {
  let s = {};
  try { s = (typeof getPosSettings === 'function') ? getPosSettings() : (DB.get('posSettings') || {}); } catch (e) { s = {}; }
  return gstStateFromName(s.state) || gstStateFromGstin(s.gstin) || gstStateFromText(s.storeAddress) || null;
}

function customerGstState(c) {
  if (!c) return null;
  return gstStateFromName(c.state) || gstStateFromGstin(c.gstin) || gstStateFromText(c.address) || null;
}

// Place of supply = customer's state when known, otherwise the business state
// (walk-in / counter sale is treated as a local sale).
function currentGstContext() {
  const business = businessGstState();
  const customer = customerGstState(typeof selectedCustomer !== 'undefined' ? selectedCustomer : null);
  const place = customer || business;
  const interState = !!(business && customer && business.code !== customer.code);
  return {
    business, customer, place, interState,
    mode: !business ? 'intra' : (interState ? 'inter' : 'intra'),
    known: !!(business && customer)
  };
}

function gstLabel(base, rate, half) {
  const r = Number(rate) || 0;
  if (!r) return base;
  const v = half ? r / 2 : r;
  const num = Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
  return base + ' ' + num + '%';
}

function toast(msg, type = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  els('toastContainer').appendChild(t);
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 300); }, 3000);
}

function showModal(id) { els(id).classList.remove('hidden'); }
function hideModal(id) { els(id).classList.add('hidden'); }

// ─── AUDIO FEEDBACK FOR SCANNER ─────────────────────────────
let scanAudioCtx = null;
function playScanBeep(success = true) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(success ? 80 : [100, 50, 100]);
    }
  } catch (e) { }
  try {
    if (!scanAudioCtx) scanAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (scanAudioCtx.state === 'suspended') scanAudioCtx.resume();
    const osc = scanAudioCtx.createOscillator();
    const gain = scanAudioCtx.createGain();
    osc.type = 'sine';
    if (success) {
      osc.frequency.setValueAtTime(1400, scanAudioCtx.currentTime);
      osc.frequency.setValueAtTime(2200, scanAudioCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.25, scanAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, scanAudioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(scanAudioCtx.destination);
      osc.start(scanAudioCtx.currentTime);
      osc.stop(scanAudioCtx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(400, scanAudioCtx.currentTime);
      osc.frequency.setValueAtTime(250, scanAudioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, scanAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, scanAudioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(scanAudioCtx.destination);
      osc.start(scanAudioCtx.currentTime);
      osc.stop(scanAudioCtx.currentTime + 0.25);
    }
  } catch (e) {
    // AudioContext might require user gesture on some browsers
  }
}

// ─── CART LOGIC ──────────────────────────────────────────────
function productHasVariants(product) {
  return !!(product && product.hasVariants && Array.isArray(product.variants) && product.variants.length);
}

function getVariantLabel(variant, product) {
  if (!variant) return '';
  if (variant.label) return variant.label;
  if (Array.isArray(variant.options)) return variant.options.filter(o => o && o !== 'Default').join(' / ');
  const parts = [variant.option1 || variant.opt1, (variant.option2 && variant.option2 !== 'Default') ? variant.option2 : (variant.opt2 && variant.opt2 !== 'Default' ? variant.opt2 : '')];
  for (let i = 3; variant['option' + i]; i++) parts.push(variant['option' + i]);
  return parts.filter(Boolean).join(' / ') || 'Variant';
}

function getVariantStock(variant) {
  const s = Number(variant.stock != null ? variant.stock : variant.qty);
  return Number.isFinite(s) ? s : 0;
}

function getCartKey(item) {
  return item.cartKey || item.id;
}

function openVariantSelectModal(product) {
  if (!product) return;
  const modal = els('variantSelectModal');
  const list = els('variantSelectList');
  const title = els('variantSelectTitle');
  const subtitle = els('variantSelectSubtitle');
  if (!modal || !list) {
    // fallback: add first in-stock variant
    const v = (product.variants || []).find(vv => getVariantStock(vv) > 0) || product.variants[0];
    if (v) addVariantToCart(product, v);
    return;
  }
  if (!modal.dataset.wired) {
    els('closeVariantSelectModal')?.addEventListener('click', () => hideModal('variantSelectModal'));
    modal.addEventListener('click', (e) => { if (e.target === modal) hideModal('variantSelectModal'); });
    modal.dataset.wired = '1';
  }
  if (title) title.textContent = 'Select Variant';
  if (subtitle) subtitle.textContent = product.name || '';

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  list.innerHTML = (product.variants || []).map((v, idx) => {
    const stock = getVariantStock(v);
    const out = stock <= 0;
    const label = getVariantLabel(v, product);
    const price = Number(v.price != null ? v.price : product.price) || 0;
    const mrp = Number(v.mrp != null ? v.mrp : (product.mrp || price)) || price;
    const stockCls = out ? 'out' : (stock <= 5 ? 'low' : 'ok');
    const stockText = out ? 'Out of stock' : `${stock} in stock`;
    const variantId = v.id || v.sku || getVariantLabel(v, product);
    const cartKey = product.id + '::' + variantId;
    const inCart = cart.find(i => getCartKey(i) === cartKey);
    const inCartQty = inCart ? (Number(inCart.qty) || 0) : 0;
    const remaining = Math.max(0, stock - inCartQty);
    const defaultQty = remaining > 0 ? 1 : 0;
    return `
      <div class="variant-select-item ${out ? 'oos' : ''}" data-vidx="${idx}">
        <div class="vs-left">
          <div class="vs-name">${esc(label)}</div>
          <div class="vs-meta">
            ${mrp && mrp !== price ? `<span>MRP ${fmt(mrp)}</span>` : ''}
            ${v.sku ? `<span>SKU: ${esc(v.sku)}</span>` : ''}
            ${inCartQty > 0 ? `<span>In cart: ${inCartQty}</span>` : ''}
          </div>
        </div>
        <div class="vs-right">
          <div class="vs-price">${fmt(price)}</div>
          <div class="vs-stock ${stockCls}">${stockText}</div>
        </div>
        <div class="vs-actions">
          <div class="vs-qty">
            <button type="button" class="vs-qty-btn" data-action="dec" ${out || remaining <= 0 ? 'disabled' : ''}>−</button>
            <input type="number" class="vs-qty-input" min="1" max="${remaining}" value="${defaultQty}" ${out || remaining <= 0 ? 'disabled' : ''} />
            <button type="button" class="vs-qty-btn" data-action="inc" ${out || remaining <= 0 ? 'disabled' : ''}>+</button>
          </div>
          <button type="button" class="vs-add-btn" ${out || remaining <= 0 ? 'disabled' : ''}>Add</button>
        </div>
      </div>`;
  }).join('');

  const clampQty = (input, max) => {
    let v = parseInt(input.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (max > 0 && v > max) v = max;
    input.value = v;
    return v;
  };

  list.querySelectorAll('.variant-select-item:not(.oos)').forEach(el => {
    const idx = parseInt(el.dataset.vidx, 10);
    const variant = product.variants[idx];
    if (!variant) return;
    const stock = getVariantStock(variant);
    const variantId = variant.id || variant.sku || getVariantLabel(variant, product);
    const cartKey = product.id + '::' + variantId;
    const inCart = cart.find(i => getCartKey(i) === cartKey);
    const inCartQty = inCart ? (Number(inCart.qty) || 0) : 0;
    const remaining = Math.max(0, stock - inCartQty);
    const qtyInput = el.querySelector('.vs-qty-input');
    const decBtn = el.querySelector('[data-action="dec"]');
    const incBtn = el.querySelector('[data-action="inc"]');
    const addBtn = el.querySelector('.vs-add-btn');

    decBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!qtyInput) return;
      qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
    });
    incBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!qtyInput) return;
      const next = (parseInt(qtyInput.value, 10) || 1) + 1;
      qtyInput.value = remaining > 0 ? Math.min(remaining, next) : next;
    });
    qtyInput?.addEventListener('click', (e) => e.stopPropagation());
    qtyInput?.addEventListener('change', () => clampQty(qtyInput, remaining));

    addBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (remaining <= 0) { toast('Max stock reached for this variant', 'warning'); return; }
      const qty = clampQty(qtyInput, remaining);
      if (addVariantToCart(product, variant, qty)) {
        hideModal('variantSelectModal');
      }
    });
  });

  showModal('variantSelectModal');
}

function addVariantToCart(product, variant, qtyToAdd = 1) {
  if (!product || !variant) return false;
  const variantId = variant.id || variant.sku || getVariantLabel(variant, product);
  const cartKey = product.id + '::' + variantId;
  const stock = getVariantStock(variant);
  const price = Number(variant.price != null ? variant.price : product.price) || 0;
  const mrp = Number(variant.mrp != null ? variant.mrp : (product.mrp || price)) || price;
  const tax = variant.tax != null ? Number(variant.tax) : (product.tax != null ? Number(product.tax) : 0);
  const discount = variant.discount != null ? Number(variant.discount) : (product.discount != null ? Number(product.discount) : 0);
  const variantLabel = getVariantLabel(variant, product);
  const label = variantLabel ? `${product.name} (${variantLabel})` : product.name;
  const addQty = Math.max(1, parseInt(qtyToAdd, 10) || 1);

  const existing = cart.find(i => getCartKey(i) === cartKey);
  if (existing) {
    const canAdd = Math.max(0, stock - existing.qty);
    if (canAdd <= 0) {
      toast(`Insufficient stock for "${label}" (Max: ${stock})`, 'warning');
      return false;
    }
    const actual = Math.min(addQty, canAdd);
    existing.qty += actual;
    renderCart();
    if (actual < addQty) toast(`Only ${actual} more added for "${label}" (Max stock: ${stock})`, 'warning');
    else toast(`${label} added (x${actual})`, 'success');
    return true;
  } else {
    if (stock <= 0) {
      toast(`"${label}" is out of stock!`, 'error');
      return false;
    }
    const actual = Math.min(addQty, stock);
    cart.push({
      ...product,
      id: product.id,
      cartKey,
      variantId,
      variantLabel,
      name: product.name,
      displayName: label,
      price,
      mrp,
      tax,
      stock, // variant stock for cart checks
      itemDiscount: discount || 0,
      qty: actual
    });
    renderCart();
    if (actual < addQty) toast(`Only ${actual} added for "${label}" (Max stock: ${stock})`, 'warning');
    else toast(`${label} added to cart (x${actual})`, 'success');
    return true;
  }
}

function addToCart(product) {
  if (productHasVariants(product)) {
    openVariantSelectModal(product);
    return false; // async/selection flow
  }
  const existing = cart.find(i => getCartKey(i) === product.id);
  const stock = Number(product.stock) || 0;
  if (existing) {
    if (existing.qty >= stock) {
      toast(`Insufficient stock for "${product.name}" (Max: ${stock})`, 'warning');
      return false;
    }
    existing.qty++;
    renderCart();
    toast(`${product.name} quantity increased to ${existing.qty}`, 'success');
    return true;
  } else {
    if (stock <= 0) {
      toast(`"${product.name}" is out of stock!`, 'error');
      return false;
    }
    cart.push({ ...product, cartKey: product.id, qty: 1, itemDiscount: product.discount || 0 });
    renderCart();
    toast(`${product.name} added to cart`, 'success');
    return true;
  }
}

// ─── BARCODE NORMALISATION / MATCHING ───────────────────────
// Cameras often return a UPC-A code as 13 digits (EAN-13 with a leading
// zero) while the same product was saved as a 12-digit UPC-A – or the
// other way round. They may also include hidden control characters or
// spaces. Normalise both sides before comparing so a valid scan always
// finds the product.
function normalizeBarcode(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/[\u0000-\u001F\u007F]/g, '')  // newlines / control chars
    .replace(/\s+/g, '')                     // stray spaces
    .replace(/^'+/, '')                      // Excel/text leading apostrophe
    .trim()
    .toUpperCase();
}

function codesEquivalent(a, b) {
  const A = normalizeBarcode(a);
  const B = normalizeBarcode(b);
  if (!A || !B) return false;
  if (A === B) return true;

  // Numeric barcodes: ignore leading zeros (UPC-A = 12 digits, EAN-13 = 13)
  if (/^\d+$/.test(A) && /^\d+$/.test(B)) {
    if (A.replace(/^0+/, '') === B.replace(/^0+/, '')) return true;
    // 12 vs 13-digit variants of the same UPC/EAN code
    if (A.length >= 12 && B.length >= 12 &&
        Math.abs(A.length - B.length) <= 1 &&
        (A.endsWith(B) || B.endsWith(A))) {
      return true;
    }
  }
  return false;
}

function findProductByCode(rawCode) {
  const code = normalizeBarcode(rawCode);
  if (!code) return null;
  return (products || []).find(p =>
    codesEquivalent(p.barcode, code) ||
    codesEquivalent(p.sku, code) ||
    codesEquivalent(p.hsn, code)
  ) || null;
}

// ─── SCAN PRODUCT TO CART (POS BARCODE SCANNING) ─────────────
function scanProductToCart(rawBarcode) {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) return false;

  const product = findProductByCode(barcode);

  if (!product) {
    playScanBeep(false);
    toast(`Product not found for barcode: "${barcode}"`, 'error');
    return false;
  }

  // Found -> add or increase qty in cart
  const success = addToCart(product);
  if (success) playScanBeep(true);
  return success;
}

function removeFromCart(key) {
  cart = cart.filter(i => getCartKey(i) !== key);
  renderCart();
}

function updateQty(key, delta) {
  const item = cart.find(i => getCartKey(i) === key);
  if (!item) return;
  // Reward quantities are fixed by the reward configuration.
  if (item.rewardFree) { toast('Reward quantity is fixed. Remove the reward instead.', 'warning'); return; }
  const maxStock = Number(item.stock) || 0;
  item.qty = Math.max(1, item.qty + delta);
  if (maxStock > 0 && item.qty > maxStock) { item.qty = maxStock; toast('Max stock reached', 'warning'); }
  renderCart();
}

function setQty(key, val) {
  const item = cart.find(i => getCartKey(i) === key);
  if (!item) return;
  if (item.rewardFree) { renderCart(); return; }
  const maxStock = Number(item.stock) || 0;
  const q = Math.max(1, parseInt(val) || 1);
  item.qty = maxStock > 0 ? Math.min(q, maxStock) : q;
  renderCart();
}

function updateItemDiscount(key, val) {
  const item = cart.find(i => getCartKey(i) === key);
  if (item) {
    if (item.rewardFree) { renderCart(); return; }
    item.itemDiscount = Math.max(0, Math.min(100, parseFloat(val) || 0));
    renderCartTotals();
  }
}

function calcItemTotal(item) {
  const qty = Number(item.qty) || 0;
  const price = Number(item.price) || 0;
  const base = price * qty;
  const discPct = Number(item.itemDiscount) || 0;
  const discAmt = base * (discPct / 100);
  const net = base - discAmt;
  const rate = Number(item.tax) || 0;
  const inclusive = !!item.taxInclusive;

  // Tax-inclusive pricing: the selling price already contains GST, so the
  // taxable value is backed out of it and the tax does not add to the total.
  let taxable, taxAmt, total;
  if (inclusive && rate > 0) {
    taxable = net / (1 + rate / 100);
    taxAmt = net - taxable;
    total = net;
  } else {
    taxable = net;
    taxAmt = net * (rate / 100);
    total = net + taxAmt;
  }

  return { base, discAmt, taxable, taxAmt, total, taxRate: rate, taxInclusive: inclusive };
}

// GST split for the whole cart. Intra-state → CGST + SGST, inter-state → IGST.
function computeCartTotals() {
  const ctx = currentGstContext();
  let subtotal = 0, totalTax = 0, igstSum = 0;
  const rates = new Set();

  cart.forEach(item => {
    const r = calcItemTotal(item);
    subtotal += r.taxable;
    if (r.taxAmt > 0.000001) {
      totalTax += r.taxAmt;
      if (Number(item.tax) > 0) rates.add(Number(item.tax));
      if (ctx.interState) igstSum += r.taxAmt;
    }
  });

  const tax = r2(totalTax);
  let cgst = 0, sgst = 0, igst = 0;
  if (ctx.interState) {
    igst = r2(igstSum);
  } else {
    cgst = r2(tax / 2);
    sgst = r2(tax - cgst); // keeps CGST + SGST exactly equal to total tax
  }

  return Object.assign({}, ctx, {
    subtotal: r2(subtotal),
    totalTax: tax,
    cgst: cgst,
    sgst: sgst,
    igst: igst,
    rates: Array.from(rates).sort((a, b) => a - b)
  });
}

// ─── RENDER CART ────────────────────────────────────────────
function renderCart() {
  const tbody = els('cartBody');
  const empty = els('emptyCart');
  const table = els('cartTable');
  if (table) table.classList.toggle('no-head', cart.length === 0);

  if (cart.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    renderCheckoutCartPanel();
    renderCartTotals();
    if (typeof renderPosCatalog === 'function') renderPosCatalog();
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = cart.map(item => {
    const { base, discAmt, taxAmt, total } = calcItemTotal(item);
    const cartKey = getCartKey(item);
    const escK = String(cartKey).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const displayName = item.displayName || (item.variantLabel ? `${item.name} (${item.variantLabel})` : item.name);
    const meta = `HSN·${item.hsn || '—'} • ${item.sku || ''}${item.variantLabel ? ' • ' + item.variantLabel : ''}`;
    // Reward lines are fixed by the reward configuration: their quantity and
    // discount are not user-editable, and they never carry a price.
    const isReward = !!item.rewardFree;
    const qtyCell = isReward
      ? `<span class="qty-locked" title="Quantity is set by the reward">${item.qty}</span>`
      : `<div class="qty-control">
            <button class="qty-btn" onclick="updateQty('${escK}',-1)">−</button>
            <input class="qty-input" type="number" value="${item.qty}" min="1"
              onchange="setQty('${escK}',this.value)" />
            <button class="qty-btn" onclick="updateQty('${escK}',1)">+</button>
          </div>`;
    const discCell = isReward
      ? '<span class="rw-muted">—</span>'
      : `<div class="editable-disc">
            <input type="number" value="${item.itemDiscount}" min="0" max="100"
              onchange="updateItemDiscount('${escK}',this.value)"
              placeholder="0" title="Discount %" />
            <span style="font-size:11px;color:var(--grey-400)">%</span>
          </div>`;
    return `
      <tr class="cart-row${isReward ? ' cart-row-reward' : ''}">
        <td class="cart-col-prod">
          <div class="product-name-cell">
            <div class="prod-icon">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : (item.emoji || '📦')}</div>
            <div class="prod-details">
              <div class="prod-name">${displayName}${isReward ? ' <span class="badge-pill badge-green">Reward</span>' : ''}</div>
              <div class="prod-meta">${meta}</div>
              <div class="mobile-only-price">${isReward ? 'FREE' : fmt(item.price) + ' / ' + item.unit}</div>
            </div>
          </div>
        </td>
        <td class="cart-col-qty">${qtyCell}</td>
        <td class="cart-col-unit price-cell">${item.unit}</td>
        <td class="cart-col-price price-cell">${isReward ? '<span class="badge-pill badge-green">FREE</span>' : fmt(item.price)}</td>
        <td class="cart-col-disc">${discCell}</td>
        <td class="cart-col-tax tax-cell">${fmt(taxAmt)}</td>
        <td class="cart-col-total total-cell">
          <span class="mobile-total-label">Total: </span>${fmt(total)}
        </td>
        <td class="cart-col-del">
          <button class="del-btn" onclick="removeFromCart('${escK}')" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="m19.5 5.5-.62 10.03c-.16 2.56-.24 3.84-1.06 4.63-.66.63-1.59 1.04-2.68 1.04H8.86c-1.09 0-2.02-.41-2.68-1.04-.82-.79-.9-2.07-1.06-4.63L4.5 5.5" />
              <path d="M3 5.5h18M16.06 5.5l-.68-1.41c-.45-.94-.68-1.4-1.07-1.69a2 2 0 0 0-.27-.17C13.6 2 13.08 2 12.04 2c-1.07 0-1.6 0-2.04.23a2 2 0 0 0-.28.18c-.4.3-.62.79-1.06 1.76l-.61 1.33" />
              <path d="M9.5 16.5v-6M14.5 16.5v-6" />
            </svg>
          </button>
        </td>
      </tr>`;
  }).join('');

  renderCheckoutCartPanel();
  renderCartTotals();
  if (typeof renderPosCatalog === 'function') renderPosCatalog();
}

function renderCheckoutCartPanel() {
  const wrap = els('checkoutCartBody');
  const count = els('checkoutCartCount');
  const totalItemCount = cart.reduce((s, it) => s + (parseInt(it.qty) || 1), 0);
  if (count) count.textContent = `${totalItemCount} item${totalItemCount === 1 ? '' : 's'}`;
  if (!wrap) return;

  if (!cart.length) {
    wrap.innerHTML = '<div class="co-cart-empty">No items in cart yet.</div>';
    return;
  }

  wrap.innerHTML = cart.map(item => {
    const { total } = calcItemTotal(item);
    const cartKey = getCartKey(item);
    const escK = String(cartKey).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const displayName = item.displayName || (item.variantLabel ? `${item.name} (${item.variantLabel})` : item.name);
    const thumb = item.image
      ? `<img src="${item.image}" alt="${item.name}" />`
      : `<span>${item.emoji || '📦'}</span>`;
    const isReward = !!item.rewardFree;
    const controls = isReward
      ? `<div class="co-cart-controls">
            <span class="qty-locked" title="Quantity is set by the reward">×${item.qty}</span>
            <div class="co-cart-line"><span class="badge-pill badge-green">FREE</span></div>
          </div>`
      : `<div class="co-cart-controls">
            <div class="qty-control co-qty">
              <button class="qty-btn" type="button" onclick="updateQty('${escK}',-1)">−</button>
              <input class="qty-input" type="number" value="${item.qty}" min="1"
                onchange="setQty('${escK}',this.value)" />
              <button class="qty-btn" type="button" onclick="updateQty('${escK}',1)">+</button>
            </div>
            <div class="co-cart-line">${fmt(total)}</div>
          </div>`;
    return `
      <div class="co-cart-item${isReward ? ' co-cart-item-reward' : ''}" data-id="${cartKey}">
        <div class="co-cart-thumb">${thumb}</div>
        <div class="co-cart-main">
          <div class="co-cart-name" title="${displayName}">${displayName}${isReward ? ' <span class="badge-pill badge-green">Reward</span>' : ''}</div>
          <div class="co-cart-meta">${isReward ? 'Free reward item' : fmt(item.price) + ' / ' + (item.unit || 'pc')}</div>
          ${controls}
        </div>
        <button class="co-cart-del del-btn" type="button" onclick="removeFromCart('${escK}')" title="Remove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19.5 5.5-.62 10.03c-.16 2.56-.24 3.84-1.06 4.63-.66.63-1.59 1.04-2.68 1.04H8.86c-1.09 0-2.02-.41-2.68-1.04-.82-.79-.9-2.07-1.06-4.63L4.5 5.5" />
            <path d="M3 5.5h18M16.06 5.5l-.68-1.41c-.45-.94-.68-1.4-1.07-1.69a2 2 0 0 0-.27-.17C13.6 2 13.08 2 12.04 2c-1.07 0-1.6 0-2.04.23a2 2 0 0 0-.28.18c-.4.3-.62.79-1.06 1.76l-.61 1.33" />
            <path d="M9.5 16.5v-6M14.5 16.5v-6" />
          </svg>
        </button>
      </div>`;
  }).join('');
}

function paintTaxRow(rowId, labelId, valueId, baseLabel, amount, rates, half) {
  const row = els(rowId);
  if (!row) return;
  if (amount > PAY_EPS) {
    row.classList.remove('hidden');
    const lbl = els(labelId);
    if (lbl) lbl.textContent = rates.length === 1 ? gstLabel(baseLabel, rates[0], half) : baseLabel;
    const val = els(valueId);
    if (val) val.textContent = fmt(amount);
  } else {
    row.classList.add('hidden');
  }
}

function renderCartTotals() {
  const t = computeCartTotals();
  let a;
  try { a = (typeof checkoutAmounts === 'function') ? checkoutAmounts() : null; } catch (e) { a = null; }
  const shipping = a ? a.shipping : (parseFloat(els('shippingInput')?.value) || 0);
  const discount = a ? a.discount : (parseFloat(els('discountInput')?.value) || 0);
  const grand = a ? a.grand : r2(Math.max(0, t.subtotal + t.totalTax + shipping - discount));
  const loyaltyDiscount = a ? (Number(a.loyaltyDiscount) || 0) : 0;

  if (els('subtotalDisplay')) els('subtotalDisplay').textContent = fmt(t.subtotal);
  paintTaxRow('cgstRow', 'cgstLabel', 'cgstDisplay', 'CGST', t.cgst, t.rates, true);
  paintTaxRow('sgstRow', 'sgstLabel', 'sgstDisplay', 'SGST', t.sgst, t.rates, true);
  paintTaxRow('igstRow', 'igstLabel', 'igstDisplay', 'IGST', t.igst, t.rates, false);
  const posLoyRow = els('posLoyaltyDiscountRow');
  if (posLoyRow) posLoyRow.classList.toggle('hidden', !(loyaltyDiscount > PAY_EPS));
  if (els('posLoyaltyDiscountDisplay')) els('posLoyaltyDiscountDisplay').textContent = '-' + fmt(loyaltyDiscount);
  if (els('totalDisplay')) els('totalDisplay').textContent = fmt(Math.max(0, grand));
  try { if (typeof syncLoyaltyPosUi === 'function') syncLoyaltyPosUi(a); } catch (e) {}

  const note = els('gstModeNote');
  if (note) {
    if (t.totalTax > PAY_EPS) {
      note.classList.remove('hidden');
      const place = t.place ? ' (' + t.place.name + ')' : '';
      note.textContent = t.interState
        ? 'IGST — inter-state supply' + place
        : 'CGST + SGST — intra-state supply' + place;
      if (!t.business) note.textContent += ' • Set Business State in Settings for accurate GST';
      note.title = t.rates.length > 1 ? 'GST rates in this bill: ' + t.rates.join('%, ') + '%' : '';
    } else {
      note.classList.add('hidden');
      note.textContent = '';
    }
  }

  // Update mobile summary and badges
  const totalItemCount = cart.reduce((s, it) => s + (parseInt(it.qty) || 1), 0);
  const mobileCartBadge = els('mobileCartBadge');
  if (mobileCartBadge) mobileCartBadge.textContent = totalItemCount;

  const mcsCount = els('mcsCount');
  if (mcsCount) mcsCount.textContent = `${totalItemCount} item${totalItemCount === 1 ? '' : 's'}`;

  const summaryItems = els('summaryItemCount');
  if (summaryItems) summaryItems.textContent = `${totalItemCount} item${totalItemCount === 1 ? '' : 's'}`;

  const mcsTotal = els('mcsTotal');
  if (mcsTotal) mcsTotal.textContent = fmt(Math.max(0, grand));

  const mobileTabTotal = els('mobileTabTotal');
  if (mobileTabTotal) mobileTabTotal.textContent = fmt(Math.max(0, grand));

  const mobileCartSummary = els('mobileCartSummary');
  if (mobileCartSummary) {
    mobileCartSummary.classList.toggle('active', cart.length > 0);
  }

  // Keep the Proceed to Pay buttons in sync with cart validity
  updateCheckoutButtonState();
}

// ─── CHECKOUT VALIDATION ────────────────────────────────────
// A bill can only be paid when: at least one product exists, every qty is a
// positive whole number within stock, and the calculated total is above zero.
function cartValidation() {
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, reason: 'Add at least one product to proceed.' };
  }

  for (const item of cart) {
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty < 1 || Math.floor(qty) !== qty) {
      return { ok: false, reason: `Enter a valid quantity (1 or more) for "${item.name}".` };
    }
  }

  // Stock must be checked against the aggregate quantity per product, because a
  // free-reward line and a paid line can target the same product.
  const qtyByProduct = new Map();
  for (const item of cart) {
    if (!item) continue;
    const key = item.id;
    qtyByProduct.set(key, (qtyByProduct.get(key) || 0) + (Number(item.qty) || 0));
  }
  for (const [productId, qty] of qtyByProduct) {
    const prod = products.find(p => p.id === productId);
    if (prod && qty > Number(prod.stock)) {
      return { ok: false, reason: `Only ${prod.stock} in stock for "${prod.name}".` };
    }
  }

  let grand = 0;
  try { grand = checkoutAmounts().grand; } catch (e) { grand = 0; }
  if (!(grand > PAY_EPS)) {
    return { ok: false, reason: 'Bill total must be greater than zero.' };
  }

  return { ok: true, reason: '' };
}

function updateCheckoutButtonState() {
  const v = cartValidation();
  ['checkoutBtn', 'mobileProceedBtn'].forEach(id => {
    const btn = els(id);
    if (!btn) return;
    btn.disabled = !v.ok;
    btn.setAttribute('aria-disabled', v.ok ? 'false' : 'true');
    if (v.ok) btn.removeAttribute('title');
    else btn.title = v.reason;
  });
}

// ─── SEARCH ──────────────────────────────────────────────────
function setupSearch() {
  const inp = els('productSearch');
  const drop = els('searchDropdown');
  if (!inp || !drop) return;

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { drop.classList.add('hidden'); return; }
    const matches = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.barcode && p.barcode.toLowerCase().includes(q)) ||
      (p.hsn && p.hsn.includes(q)) ||
      (p.sku && p.sku.toLowerCase().includes(q))
    ).slice(0, 8);

    if (!matches.length) {
      drop.innerHTML = '<div class="search-item"><div class="item-details"><div class="item-name text-muted">No products found</div></div></div>';
      drop.classList.remove('hidden');
      return;
    }

    drop.innerHTML = matches.map(p => `
      <div class="search-item" onclick="addToCart(${JSON.stringify(p).replace(/"/g, '&quot;')})">
        <div class="item-icon">${p.image ? `<img src="${p.image}" alt="${p.name}" />` : (p.emoji || '📦')}</div>
        <div class="item-details">
          <div class="item-name">${p.name}</div>
          <div class="item-meta">
            ${p.barcode ? `<span class="barcode-sub-pill">🏷️ ${p.barcode}</span>` : ''}
            SKU: ${p.sku} ${p.hsn ? '| HSN: ' + p.hsn : ''}
          </div>
        </div>
        <div>
          <div class="item-price">${fmt(p.price)}</div>
          <div class="item-stock ${p.stock <= p.minStock ? 'text-red' : 'text-green'}">${p.stock} ${p.unit}</div>
        </div>
      </div>`).join('');
    drop.classList.remove('hidden');
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = inp.value.trim();
      if (!q) return;

      // Exact match check (barcode, SKU, name)
      const exactMatch = products.find(p =>
        (p.barcode && p.barcode.toLowerCase() === q.toLowerCase()) ||
        (p.sku && p.sku.toLowerCase() === q.toLowerCase()) ||
        p.name.toLowerCase() === q.toLowerCase()
      );
      if (exactMatch) {
        scanProductToCart(exactMatch.barcode || exactMatch.sku);
        inp.value = '';
        drop.classList.add('hidden');
      } else {
        const matches = products.filter(p =>
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          (p.barcode && p.barcode.toLowerCase().includes(q.toLowerCase())) ||
          (p.sku && p.sku.toLowerCase().includes(q.toLowerCase()))
        );
        if (matches.length > 0) {
          scanProductToCart(matches[0].barcode || matches[0].sku);
          inp.value = '';
          drop.classList.add('hidden');
        } else {
          playScanBeep(false);
          toast(`Product not found for: "${q}"`, 'error');
        }
      }
    }
  });

  document.addEventListener('click', e => { if (!inp.contains(e.target) && !drop.contains(e.target)) drop.classList.add('hidden'); });
}

// ─── POS DEDICATED PRODUCT SEARCH (above cart table) ─────────
function setupPosProductSearch() {
  const inp = els('posProductSearch');
  const box = els('posSearchResults');
  const scanBtn = els('posSearchScanBtn');
  if (!inp || !box) return;

  let matches = [];
  let activeIndex = -1;

  const escHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const searchProducts = (q) => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return products.filter(p =>
      (p.name && p.name.toLowerCase().includes(query)) ||
      (p.sku && String(p.sku).toLowerCase().includes(query)) ||
      (p.barcode && String(p.barcode).toLowerCase().includes(query)) ||
      (p.category && String(p.category).toLowerCase().includes(query)) ||
      (p.hsn && String(p.hsn).includes(query))
    ).slice(0, 10);
  };

  const paint = () => {
    if (!matches.length) {
      box.innerHTML = '<div class="pos-sr-empty">No products found. Try name, SKU, barcode or category.</div>';
      box.classList.remove('hidden');
      return;
    }
    box.innerHTML = '<div class="pos-sr-hint">Use ↑ ↓ to select • Enter to add</div>' +
      matches.map((p, i) => {
        const low = Number(p.stock) <= Number(p.minStock || 0);
        return `<div class="pos-sr-item${i === activeIndex ? ' active' : ''}" role="option"
            data-idx="${i}" data-id="${escHtml(p.id)}">
          <div class="pos-sr-thumb">${p.image ? `<img src="${escHtml(p.image)}" alt="">` : (p.emoji || '📦')}</div>
          <div class="pos-sr-info">
            <div class="pos-sr-name">${escHtml(p.name)}</div>
            <div class="pos-sr-meta">
              ${p.category ? escHtml(p.category) + ' • ' : ''}SKU: ${escHtml(p.sku)}
              ${p.barcode ? ' • 🏷️ ' + escHtml(p.barcode) : ''}
            </div>
          </div>
          <div class="pos-sr-right">
            <div class="pos-sr-price">${fmt(p.price)}</div>
            <div class="pos-sr-stock ${low ? 'low' : 'ok'}">${p.stock} ${escHtml(p.unit || '')} in stock</div>
          </div>
        </div>`;
      }).join('');
    box.classList.remove('hidden');
    const activeEl = box.querySelector('.pos-sr-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    box.classList.add('hidden');
    activeIndex = -1;
    if (!inp.value.trim() && typeof renderPosCatalog === 'function') renderPosCatalog('');
  };

  const choose = (idx) => {
    const p = matches[idx];
    if (!p) return;
    addToCart(p);
    inp.value = '';
    matches = [];
    close();
    inp.focus();
  };

  const runSearch = () => {
    matches = searchProducts(inp.value);
    activeIndex = matches.length ? 0 : -1;
    paint();
    if (typeof renderPosCatalog === 'function') renderPosCatalog(inp.value);
  };

  inp.addEventListener('input', runSearch);

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!matches.length) { runSearch(); return; }
      activeIndex = Math.min(activeIndex + 1, matches.length - 1);
      paint();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      activeIndex = Math.max(activeIndex - 1, 0);
      paint();
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const raw = inp.value.trim();
      if (!raw) return;

      // Exact barcode / SKU / name match → scan-add directly (works with scanners)
      const exact = products.find(p =>
        (p.barcode && String(p.barcode).toLowerCase() === raw.toLowerCase()) ||
        (p.sku && String(p.sku).toLowerCase() === raw.toLowerCase()) ||
        (p.name && p.name.toLowerCase() === raw.toLowerCase())
      );
      if (exact) {
        addToCart(exact);
        inp.value = '';
        matches = [];
        close();
        return;
      }
      if (activeIndex >= 0 && matches[activeIndex]) {
        choose(activeIndex);
      } else if (matches.length) {
        choose(0);
      } else {
        playScanBeep(false);
        toast(`Product not found for: "${raw}"`, 'error');
      }
    }
  });

  // Mouse / touch selection
  box.addEventListener('mousedown', (e) => {
    // prevent input blur before click registers
    e.preventDefault();
    const item = e.target.closest('.pos-sr-item');
    if (item) choose(Number(item.dataset.idx));
  });

  // Clicking outside closes results
  document.addEventListener('click', (e) => {
    if (!inp.contains(e.target) && !box.contains(e.target) && !scanBtn.contains(e.target)) close();
  });

  // Scan button opens the camera scanner modal if available
  if (scanBtn) {
    scanBtn.addEventListener('click', () => {
      const modal = els('scanBarcodeModal');
      if (modal) { modal.classList.remove('hidden'); }
      else { inp.focus(); toast('Point your scanner at the barcode', 'info'); }
    });
  }

  // Ctrl/Cmd + K focuses the search field
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      const posView = els('view-pos');
      if (posView && posView.classList.contains('active')) {
        e.preventDefault();
        inp.focus();
        inp.select();
      }
    }
    // F2 focuses the product search from anywhere
    if (e.key === 'F2') {
      e.preventDefault();
      const posView = els('view-pos');
      if (posView && !posView.classList.contains('active') && typeof switchToView === 'function') switchToView('pos');
      inp.focus();
      inp.select();
    }
  });

  // Focusing the header search always brings the POS screen forward
  inp.addEventListener('focus', () => {
    const posView = els('view-pos');
    if (posView && !posView.classList.contains('active') && typeof switchToView === 'function') switchToView('pos');
  });
}

// ─── POS PRODUCT CATALOG (chips + cards) ──────────────────────
let posCatalogCategory = 'All';
let posCatalogQuery = '';
let posCatalogMode = 'grid'; // 'grid' = catalog, 'pos' = earlier/cart-table design

function posCatalogCategories() {
  const set = new Set();
  products.forEach(p => { if (p.category) set.add(String(p.category)); });
  return ['All'].concat(Array.from(set).sort((a, b) => a.localeCompare(b)));
}

function renderPosCatalog(query) {
  if (typeof query === 'string') posCatalogQuery = query;
  const chips = els('posCategoryChips');
  const grid = els('posProductGrid');
  if (!chips || !grid) return;

  const cats = posCatalogCategories();
  if (!cats.includes(posCatalogCategory)) posCatalogCategory = 'All';

  chips.innerHTML = cats.map(c => `
    <button class="chip${c === posCatalogCategory ? ' active' : ''}" type="button"
      data-cat="${String(c).replace(/"/g, '&quot;')}">${c === 'All' ? 'All Products' : c}</button>
  `).join('');

  const q = (posCatalogQuery || '').trim().toLowerCase();
  const list = products.filter(p => {
    if (posCatalogCategory !== 'All' && String(p.category || '') !== posCatalogCategory) return false;
    if (!q) return true;
    return (p.name && p.name.toLowerCase().includes(q)) ||
      (p.sku && String(p.sku).toLowerCase().includes(q)) ||
      (p.barcode && String(p.barcode).toLowerCase().includes(q)) ||
      (p.hsn && String(p.hsn).toLowerCase().includes(q));
  });

  // keep grid markup; mode is handled by setupPosCatalog/apply mode

  if (!list.length) {
    grid.innerHTML = products.length
      ? '<div class="pcat-empty">No products match this search.</div>'
      : '<div class="pcat-empty">No products yet.<br><button class="btn btn-primary" style="margin-top:12px" onclick="openAddProductPage()">+ Add your first product</button></div>';
    return;
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  grid.innerHTML = list.map(p => {
    const stock = Number(p.stock) || 0;
    const out = stock <= 0;
    // Low-stock pill matches the reference: anything at/below 10 units
    const lowAt = Math.max(Number(p.minStock) || 0, 10);
    const low = !out && stock <= lowAt;
    const stockCls = out ? ' out' : (low ? ' low' : '');
    const stockText = out ? 'Out of stock' : (low ? `Only ${stock} left` : `${stock} in stock`);
    const meta = [p.category || 'Uncategorised', p.unit].filter(Boolean).join(' · ');

    const hasVar = productHasVariants(p);
    let qty = 0;
    let selected = false;
    if (hasVar) {
      // sum qty of all variant lines for this product in cart
      qty = cart.filter(i => i.id === p.id || String(getCartKey(i)).startsWith(p.id + '::')).reduce((s, i) => s + (Number(i.qty) || 0), 0);
      selected = qty > 0;
    } else {
      const cartItem = cart.find(i => getCartKey(i) === p.id);
      qty = cartItem ? Number(cartItem.qty) || 0 : 0;
      selected = qty > 0;
    }

    const thumb = `
      <span class="pcat-thumb${p.image ? '' : ' no-img'}">
        <span class="pcat-ph">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
            <circle cx="8.75" cy="8.75" r="1.75" />
            <path d="m20.5 15.5-4.5-4.5L4.5 20.5" />
          </svg>
          <span class="pcat-ph-text">No image available</span>
        </span>
        ${p.image ? `<img src="${p.image}" alt="" loading="lazy" onerror="this.parentElement.classList.add('no-img')">` : ''}
      </span>`;

    let control;
    if (hasVar) {
      control = `
        <button class="pcat-add" type="button" data-step="1" aria-label="Select variant for ${esc(p.name)}" title="Select variant">
          ${selected ? `<span class="pcat-qty-badge">${qty}</span>` : ''}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>`;
    } else if (selected) {
      control = `
      <span class="pcat-stepper">
        <button class="pcat-step" type="button" data-step="-1" aria-label="Decrease quantity">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span class="pcat-qty">${qty}</span>
        <button class="pcat-step" type="button" data-step="1" aria-label="Increase quantity">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </span>`;
    } else {
      control = `
      <button class="pcat-add" type="button" data-step="1" aria-label="Add ${esc(p.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>`;
    }

    return `
      <div class="pcat-card${out ? ' oos' : ''}${selected ? ' is-selected' : ''}" data-id="${p.id}"
        role="button" tabindex="${out ? '-1' : '0'}" ${out ? 'aria-disabled="true"' : ''}
        aria-label="${esc(p.name)}">
        ${thumb}
        <span class="pcat-body-col">
          <span class="pcat-name">${esc(p.name)}</span>
          <span class="pcat-meta">${esc(meta)}</span>
          <span class="pcat-stockline${stockCls}"><i class="dot"></i>${stockText}</span>
          <span class="pcat-foot">
            <span class="pcat-price">${fmt(p.price)}</span>
            ${control}
          </span>
        </span>
      </div>`;
  }).join('');
}

function applyPosCatalogMode(mode) {
  posCatalogMode = mode === 'pos' ? 'pos' : 'grid';
  const classic = posCatalogMode === 'pos';
  const cartArea = document.querySelector('#view-pos .cart-area');
  const layout = document.querySelector('#view-pos .pos-layout');
  if (cartArea) cartArea.classList.toggle('pos-mode-classic', classic);
  if (layout) layout.classList.toggle('pos-mode-classic', classic);
  const gridBtn = els('posGridViewBtn');
  const posBtn = els('posClassicViewBtn') || els('posListViewBtn');
  if (gridBtn) gridBtn.classList.toggle('active', posCatalogMode === 'grid');
  if (posBtn) posBtn.classList.toggle('active', classic);
}

function setupPosCatalog() {
  const chips = els('posCategoryChips');
  const grid = els('posProductGrid');
  const gridBtn = els('posGridViewBtn');
  const posBtn = els('posClassicViewBtn') || els('posListViewBtn');
  const scrollBtn = els('catScrollBtn');
  if (!chips || !grid) return;

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    posCatalogCategory = chip.dataset.cat || 'All';
    renderPosCatalog();
  });

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.pcat-card');
    if (!card || card.classList.contains('oos')) return;
    const id = card.dataset.id;
    const p = products.find(x => x.id === id);
    if (!p) return;

    if (productHasVariants(p)) {
      e.preventDefault();
      openVariantSelectModal(p);
      return;
    }

    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) {
      e.preventDefault();
      const step = Number(stepBtn.dataset.step);
      if (step < 0) {
        const item = cart.find(i => getCartKey(i) === id);
        if (item && Number(item.qty) > 1) updateQty(id, -1);
        else removeFromCart(id);
      } else {
        addToCart(p);
      }
      return;
    }

    addToCart(p);
  });

  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('[data-step]')) return;
    const card = e.target.closest('.pcat-card');
    if (!card || card.classList.contains('oos')) return;
    e.preventDefault();
    const p = products.find(x => x.id === card.dataset.id);
    if (p) {
      if (productHasVariants(p)) openVariantSelectModal(p);
      else addToCart(p);
    }
  });

  if (gridBtn) gridBtn.addEventListener('click', () => applyPosCatalogMode('grid'));
  if (posBtn) posBtn.addEventListener('click', () => applyPosCatalogMode('pos'));

  if (scrollBtn) scrollBtn.addEventListener('click', () => {
    const atEnd = chips.scrollLeft + chips.clientWidth >= chips.scrollWidth - 4;
    chips.scrollTo({ left: atEnd ? 0 : chips.scrollLeft + 220, behavior: 'smooth' });
  });

  applyPosCatalogMode(posCatalogMode);
  renderPosCatalog();
}

// ─── MORE MENU (bottom nav) ───────────────────────────────────
// ─── HELP & TUTORIALS (isolated module) ────────────────────────────
// --- HELP & TUTORIALS (isolated module, backend-connected) --------------
let HELP_TUTORIALS_DATA = [];
let htFetchSeq = 0;

const HELP_TUTORIAL_CATEGORIES = [
  'All Tutorials',
  'Getting Started',
  'Products',
  'Inventory',
  'POS & Sales',
  'Purchase',
  'Customers',
  'Suppliers',
  'Accounting',
  'Reports',
  'Settings'
];

const htState = {
  query: '',
  category: 'All Tutorials',
  language: 'all',
  loading: false,
  loaded: false,
  error: ''
};

function htIsValidYouTubeId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id.trim());
}

function htNormalizeTutorial(t) {
  if (!t) return null;
  const vid = htIsValidYouTubeId(t.youtube_video_id) ? String(t.youtube_video_id).trim() : '';
  if (!vid) return null;
  return {
    id: t.id || ('ht_' + vid),
    videoTitle: t.title || t.videoTitle || 'Tutorial',
    youtubeVideoId: vid,
    description: t.description || '',
    category: t.category || 'Getting Started',
    language: t.language || 'English',
    duration: t.duration || '',
    keywords: Array.isArray(t.keywords) ? t.keywords : (typeof t.keywords === 'string' ? t.keywords.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : []),
    displayOrder: Number(t.display_order != null ? t.display_order : t.displayOrder) || 0,
    thumbnailUrl: t.thumbnail_url || '',
    active: true
  };
}

function htGetActiveTutorials() {
  return HELP_TUTORIALS_DATA
    .filter(function (t) { return t && t.active !== false && htIsValidYouTubeId(t.youtubeVideoId); })
    .slice()
    .sort(function (a, b) { return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0); });
}

async function htLoadPublishedTutorials(force) {
  var seq = ++htFetchSeq;
  htState.loading = true;
  htState.error = '';
  try {
    var res = await fetch('/api/help-tutorials', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (seq !== htFetchSeq) return;
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data || data.ok === false) {
      throw new Error((data && data.error) || 'Could not load tutorials.');
    }
    var list = Array.isArray(data.tutorials) ? data.tutorials : (Array.isArray(data.items) ? data.items : []);
    HELP_TUTORIALS_DATA = list.map(htNormalizeTutorial).filter(Boolean);
    htState.loaded = true;
  } catch (e) {
    if (seq !== htFetchSeq) return;
    htState.error = e && e.message ? e.message : 'Could not load tutorials.';
    if (!htState.loaded) HELP_TUTORIALS_DATA = [];
  } finally {
    if (seq === htFetchSeq) htState.loading = false;
  }
}

function htThumbnailUrl(t) {
  if (t && t.thumbnailUrl) return t.thumbnailUrl;
  var id = t && t.youtubeVideoId ? t.youtubeVideoId : t;
  return 'https://i.ytimg.com/vi/' + encodeURIComponent(String(id || '').trim()) + '/hqdefault.jpg';
}

function htTutorialMatches(t, q, cat, lang) {
  var query = (q || '').trim().toLowerCase();
  var inCategory = !cat || cat === 'All Tutorials' || t.category === cat;
  var inLang = !lang || lang === 'all' || t.language === lang;
  if (!inCategory || !inLang) return false;
  if (!query) return true;
  var hay = [
    t.videoTitle,
    t.description,
    t.category,
    t.language,
    Array.isArray(t.keywords) ? t.keywords.join(' ') : ''
  ].join(' ').toLowerCase();
  return hay.indexOf(query) !== -1;
}

function htEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htUpdateChipScrollHint() {
  var wrap = els('htCategoryChips');
  if (!wrap) return;
  var shell = wrap.parentElement;
  if (!shell || !shell.classList.contains('ht-chip-shell')) return;
  var maxScroll = wrap.scrollWidth - wrap.clientWidth;
  var canScroll = maxScroll > 2;
  var atEnd = wrap.scrollLeft >= maxScroll - 2;
  shell.classList.toggle('ht-chip-scrollable', canScroll);
  shell.classList.toggle('ht-chip-at-end', !canScroll || atEnd);
}

function htRenderCategoryChips() {
  var wrap = els('htCategoryChips');
  if (!wrap) return;
  var prevScrollLeft = wrap.scrollLeft || 0;
  wrap.innerHTML = HELP_TUTORIAL_CATEGORIES.map(function (cat) {
    var active = htState.category === cat ? ' active' : '';
    return '<button type="button" class="ht-chip' + active + '" data-ht-cat="' + htEscape(cat) + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '">' + htEscape(cat) + '</button>';
  }).join('');
  wrap.scrollLeft = prevScrollLeft;
  wrap.querySelectorAll('[data-ht-cat]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      htState.category = btn.getAttribute('data-ht-cat') || 'All Tutorials';
      renderHelpTutorialsView();
    });
  });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(htUpdateChipScrollHint);
  else htUpdateChipScrollHint();
}

function htRenderLanguageFilter() {
  var sel = els('htLanguageFilter');
  if (!sel) return;
  var langs = Array.from(new Set(htGetActiveTutorials().map(function (t) { return t.language; }).filter(Boolean))).sort();
  if (!langs.length) {
    sel.classList.add('hidden');
    sel.innerHTML = '<option value="all">All languages</option>';
    htState.language = 'all';
    return;
  }
  sel.classList.remove('hidden');
  var current = langs.indexOf(htState.language) !== -1 ? htState.language : 'all';
  htState.language = current;
  sel.innerHTML = '<option value="all">All languages</option>' + langs.map(function (l) { return '<option value="' + htEscape(l) + '"' + (l === current ? ' selected' : '') + '>' + htEscape(l) + '</option>'; }).join('');
}

function htRenderCards(tutorials, totalActive) {
  var grid = els('htGrid');
  var empty = els('htEmptyState');
  if (!grid || !empty) return;

  if (!tutorials.length) {
    grid.innerHTML = '';
    var isFiltered = (htState.query && htState.query.trim()) || htState.category !== 'All Tutorials' || htState.language !== 'all';
    if (htState.loading && !htState.loaded) {
      empty.innerHTML = '<p class="ht-empty-title">Loading tutorials...</p><p class="ht-empty-sub">Please wait a moment.</p>';
    } else if (totalActive === 0 && !isFiltered) {
      empty.innerHTML = '<p class="ht-empty-title">Tutorials coming soon</p><p class="ht-empty-sub">New video tutorials will appear here once they are added.</p>';
    } else {
      empty.innerHTML = '<p class="ht-empty-title">No tutorials found</p><p class="ht-empty-sub">Try searching with a different keyword.</p>';
    }
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  empty.innerHTML = '';
  grid.innerHTML = tutorials.map(function (t) {
    var vid = String(t.youtubeVideoId || '').trim();
    var thumb = htThumbnailUrl(t);
    var duration = t.duration ? '<span class="ht-duration">' + htEscape(t.duration) + '</span>' : '';
    var langTag = t.language ? '<span class="ht-tag">' + htEscape(t.language) + '</span>' : '';
    return '' +
      '<article class="ht-card" data-ht-id="' + htEscape(t.id) + '" tabindex="0" role="button" aria-label="Play tutorial: ' + htEscape(t.videoTitle) + '">' +
        '<div class="ht-thumb-wrap">' +
          '<img class="ht-thumb" src="' + htEscape(thumb) + '" alt="" loading="lazy" />' +
          '<div class="ht-play-overlay"><span class="ht-play-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg></span></div>' +
          duration +
        '</div>' +
        '<div class="ht-card-body">' +
          '<h3 class="ht-card-title">' + htEscape(t.videoTitle) + '</h3>' +
          '<p class="ht-card-desc">' + htEscape(t.description || '') + '</p>' +
          '<div class="ht-card-meta">' +
            '<span class="ht-tag ht-tag-cat">' + htEscape(t.category || 'Tutorial') + '</span>' +
            langTag +
          '</div>' +
        '</div>' +
      '</article>';
  }).join('');

  grid.querySelectorAll('.ht-card[data-ht-id]').forEach(function (card) {
    var open = function () {
      var id = card.getAttribute('data-ht-id');
      var tut = htGetActiveTutorials().find(function (x) { return String(x.id) === String(id); });
      if (tut) openHelpTutorialVideo(tut);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

async function renderHelpTutorialsView() {
  var view = els('view-help-tutorials');
  if (!view) return;
  // Always refresh from backend so Super Admin publish/unpublish/edit/delete reflect promptly
  await htLoadPublishedTutorials(true);
  if (!view.classList.contains('active')) return;
  htRenderCategoryChips();
  htRenderLanguageFilter();
  var active = htGetActiveTutorials();
  var filtered = active.filter(function (t) { return htTutorialMatches(t, htState.query, htState.category, htState.language); });
  htRenderCards(filtered, active.length);
}

function openHelpTutorialVideo(tutorial) {
  if (!tutorial || !htIsValidYouTubeId(tutorial.youtubeVideoId)) return;
  var vid = String(tutorial.youtubeVideoId).trim();
  var frame = els('htVideoFrame');
  var title = els('htVideoTitle');
  var desc = els('htVideoDesc');
  var meta = els('htVideoMeta');
  var link = els('htVideoYoutubeLink');
  if (title) title.textContent = tutorial.videoTitle || 'Tutorial';
  if (desc) desc.textContent = tutorial.description || '';
  if (meta) {
    var parts = [tutorial.category, tutorial.language, tutorial.duration].filter(Boolean);
    meta.textContent = parts.join(' � ');
  }
  if (link) link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(vid);
  if (frame) frame.src = 'https://www.youtube.com/embed/' + encodeURIComponent(vid) + '?autoplay=1&rel=0';
  showModal('helpVideoModal');
}

function closeHelpTutorialVideo() {
  var frame = els('htVideoFrame');
  if (frame) frame.src = '';
  hideModal('helpVideoModal');
}

function setupHelpTutorials() {
  var search = els('htSearchInput');
  var clearBtn = els('htSearchClearBtn');
  var langSel = els('htLanguageFilter');
  var chipScroll = els('htCategoryChips');
  var chipMoreBtn = els('htChipMoreBtn');

  if (chipScroll) {
    chipScroll.addEventListener('scroll', htUpdateChipScrollHint, { passive: true });
    htUpdateChipScrollHint();
  }
  if (chipMoreBtn) {
    chipMoreBtn.addEventListener('click', function () {
      var wrap = els('htCategoryChips');
      if (!wrap) return;
      var step = Math.max(140, Math.round(wrap.clientWidth * 0.7));
      if (typeof wrap.scrollBy === 'function') wrap.scrollBy({ left: step, behavior: 'smooth' });
      else wrap.scrollLeft += step;
    });
  }
  window.addEventListener('resize', htUpdateChipScrollHint);

  if (search) {
    search.addEventListener('input', function () {
      htState.query = search.value || '';
      if (clearBtn) clearBtn.classList.toggle('hidden', !htState.query.trim());
      htRenderCategoryChips();
      htRenderLanguageFilter();
      var active = htGetActiveTutorials();
      var filtered = active.filter(function (t) { return htTutorialMatches(t, htState.query, htState.category, htState.language); });
      htRenderCards(filtered, active.length);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      htState.query = '';
      if (search) { search.value = ''; search.focus(); }
      clearBtn.classList.add('hidden');
      htRenderCategoryChips();
      htRenderLanguageFilter();
      var active = htGetActiveTutorials();
      var filtered = active.filter(function (t) { return htTutorialMatches(t, htState.query, htState.category, htState.language); });
      htRenderCards(filtered, active.length);
    });
  }
  if (langSel) {
    langSel.addEventListener('change', function () {
      htState.language = langSel.value || 'all';
      htRenderCategoryChips();
      htRenderLanguageFilter();
      var active = htGetActiveTutorials();
      var filtered = active.filter(function (t) { return htTutorialMatches(t, htState.query, htState.category, htState.language); });
      htRenderCards(filtered, active.length);
    });
  }

  var modal = els('helpVideoModal');
  var closeBtn = els('htVideoCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeHelpTutorialVideo);
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeHelpTutorialVideo();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeHelpTutorialVideo();
    }
  });
}
function setupMoreMenu() {
  const btn = els('moreNavBtn');
  const menu = els('moreMenu');
  if (!btn || !menu) return;

  let hideTimer = null;
  const openMenu = () => {
    clearTimeout(hideTimer);
    menu.classList.remove('hidden');
    requestAnimationFrame(() => menu.classList.add('open'));
    btn.setAttribute('aria-expanded', 'true');
  };
  const closeMenu = () => {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    hideTimer = setTimeout(() => {
      if (!menu.classList.contains('open')) menu.classList.add('hidden');
    }, 180);
  };
  const toggleMenu = () => {
    if (menu.classList.contains('open')) closeMenu(); else openMenu();
  };

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  els('moreMenuCloseBtn')?.addEventListener('click', closeMenu);

  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('open')) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  const go = (view, fn) => {
    closeMenu();
    if (typeof fn === 'function') fn();
    else switchToView(view);
  };

  els('moreCustomersBtn')?.addEventListener('click', () => go('customers'));
  els('moreCashDrawerBtn')?.addEventListener('click', () => go(null, () => openCashDrawer()));
  els('moreWhatsappBtn')?.addEventListener('click', () => go('whatsapp'));
  els('moreDamageBtn')?.addEventListener('click', () => go('damage'));
  els('moreStockTimelineBtn')?.addEventListener('click', () => go('stock-timeline'));
  els('moreSettingsBtn')?.addEventListener('click', () => go('settings'));
  els('moreCatSubBtn')?.addEventListener('click', () => go('categories-subcategories'));
  els('moreBrandsBtn')?.addEventListener('click', () => go('brands'));
  els('moreHelpTutorialsBtn')?.addEventListener('click', () => go('help-tutorials'));
  els('moreLoyaltyBtn')?.addEventListener('click', () => go('loyalty'));
  try { if (typeof setupLoyaltyUiHandlers === 'function') setupLoyaltyUiHandlers(); } catch (e) {}
}

function updateMoreNavState(v) {
  const moreBtn = els('moreNavBtn');
  if (!moreBtn) return;
  const on = ['customers', 'whatsapp', 'damage', 'stock-timeline', 'settings', 'categories-subcategories', 'brands', 'help-tutorials', 'loyalty'].includes(v);
  moreBtn.classList.toggle('active', on);
  if (on) document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.remove('active'));
}


// ─── CUSTOMER LOOKUP ──────────────────────────────────────────
function setupCustomer() {
  const phoneInput = els('customerPhone');
  const clearBtn = els('clearCustomerBtn');
  const walkinBtn = els('noCustomer');
  const createBtn = els('createCustomerBtn');

  els('findCustomerBtn').addEventListener('click', lookupCustomer);
  phoneInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookupCustomer(); } });

  // Auto-search as soon as 10 digits are typed
  phoneInput.addEventListener('input', () => {
    const ph = phoneInput.value.replace(/\D/g, '');
    phoneInput.value = ph;
    hideCustomerNotFound();
    if (ph.length === 10) {
      lookupCustomer({ silent: true });
    } else if (ph.length === 0) {
      // No number typed → stay as walk-in
      selectWalkIn();
    }
  });

  // Clear → back to Walk-in
  if (clearBtn) clearBtn.addEventListener('click', () => {
    selectWalkIn();
    toast('Switched to Walk-in Customer', 'info');
  });

  // Walk-in button → clear customer selection
  if (walkinBtn) walkinBtn.addEventListener('click', () => {
    selectWalkIn();
    toast('Walk-in Customer selected', 'info');
  });

  // Create new customer (only valid with a 10-digit number)
  if (createBtn) createBtn.addEventListener('click', () => {
    const ph = phoneInput.value.replace(/\D/g, '');
    if (ph.length !== 10) { toast('Enter a valid 10-digit phone number first', 'warning'); return; }
    openQuickAddCustomer(ph);
  });

  // "Change" link in the panel head → jump to the phone field
  const changeBtn = els('changeCustomerBtn');
  if (changeBtn) changeBtn.addEventListener('click', () => {
    phoneInput.focus();
    phoneInput.select();
  });
}

function hideCustomerNotFound() {
  const nf = els('customerNotFound');
  if (nf) nf.classList.add('hidden');
}

function selectWalkIn() {
  selectedCustomer = null;
  try { if (typeof setLoyaltyRedeemPointsInput === 'function') setLoyaltyRedeemPointsInput(0); } catch (e) {}
  const phone = els('customerPhone');
  if (phone) phone.value = '';
  els('customerCard')?.classList.add('hidden');
  hideCustomerNotFound();
  els('noCustomer')?.classList.remove('hidden');
  const clearBtn = els('clearCustomerBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  try { if (typeof syncLoyaltyPosUi === 'function') syncLoyaltyPosUi(); } catch (e) {}
  if (typeof renderCartTotals === 'function') renderCartTotals();
}

// Fill the POS customer card for a known customer
function renderCustomerCard(c) {
  if (!c) return;
  try { if (typeof ensureCustomerLoyaltyFields === 'function') ensureCustomerLoyaltyFields(c); } catch (e) {}
  selectedCustomer = c;
  try { if (typeof setLoyaltyRedeemPointsInput === 'function') setLoyaltyRedeemPointsInput(0); } catch (e) {}
  if (els('customerName')) els('customerName').textContent = c.name;
  const pts = Math.max(0, Math.floor(Number(c.points) || 0));
  if (els('customerPoints')) els('customerPoints').textContent = pts + ' Points' + (c.pointsExpiry ? (' (Expires in ' + c.pointsExpiry + ')') : '');
  const dueInfo = customerDueLabel(c);
  if (els('customerDue')) { els('customerDue').textContent = dueInfo.text; els('customerDue').className = 'customer-due ' + dueInfo.cls; }
  els('customerCard')?.classList.remove('hidden');
  els('noCustomer')?.classList.add('hidden');
  hideCustomerNotFound();
  const clearBtn = els('clearCustomerBtn');
  if (clearBtn) clearBtn.classList.remove('hidden');
  const phone = els('customerPhone');
  if (phone && c.phone) phone.value = c.phone;
  try { if (typeof syncLoyaltyPosUi === 'function') syncLoyaltyPosUi(); } catch (e) {}
  if (typeof renderCartTotals === 'function') renderCartTotals();
}

function lookupCustomer(opts = {}) {
  const ph = els('customerPhone').value.replace(/\D/g, '');
  if (!ph) {
    // Empty is valid → walk-in
    selectWalkIn();
    if (!opts.silent) toast('No number entered — using Walk-in Customer', 'info');
    return;
  }
  const c = customers.find(x => x.phone === ph);
  if (c) {
    renderCustomerCard(c);
    if (!opts.silent) toast(`Customer found: ${c.name}`, 'success');
  } else {
    selectedCustomer = null;
    els('customerCard').classList.add('hidden');
    els('noCustomer').classList.add('hidden');
    // Show inline "not found → create new customer" prompt
    const nf = els('customerNotFound');
    if (nf) {
      nf.classList.remove('hidden');
      const clearBtn = els('clearCustomerBtn');
      if (clearBtn) clearBtn.classList.remove('hidden');
    }
    if (!opts.silent) toast('No customer with this number yet', 'warning');
  }
}

// ─── QUICK ADD CUSTOMER (matches the Customer design) ──────────
// Opened when a POS phone lookup finds no customer, or via "+ Add Customer".
const QAC_TABS = ['general', 'address', 'bank', 'docs'];
const QAC_DRAFT_KEY = 'customerDraft';

function qacActivateTab(name) {
  const idx = QAC_TABS.indexOf(name);
  if (idx < 0) return;
  document.querySelectorAll('#qacTabs .qac-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('#quickAddCustomerModal .qac-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
}

// Sequential customer code: next after the highest existing C/<n>
function qacNextCode() {
  let max = 0;
  customers.forEach(c => { const m = /^C\/(\d+)$/i.exec(c.code || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  if (max === 0) max = customers.length; // seeds carry no code yet
  return 'C/' + (max + 1);
}

const QAC_FIELDS = ['qacCustomerType', 'qacName', 'qacGstin', 'qacPhone', 'qacEmail', 'qacDueAdvance', 'qacDueType', 'qacCreditLimit',
  'qacAddrLine', 'qacCity', 'qacState', 'qacPincode', 'qacAcctHolder', 'qacBankName', 'qacAcctNo', 'qacIfsc'];

function qacReadForm() {
  const o = {};
  QAC_FIELDS.forEach(id => { o[id] = els(id) ? els(id).value : ''; });
  o.gstDoc = els('qacGstDocName') ? els('qacGstDocName').textContent : 'No file chosen';
  o.idDoc = els('qacIdDocName') ? els('qacIdDocName').textContent : 'No file chosen';
  o.image = els('qacAvatarPreview').querySelector('img') ? els('qacAvatarPreview').querySelector('img').src : null;
  return o;
}

function qacWriteForm(o) {
  QAC_FIELDS.forEach(id => { if (els(id) && o[id] !== undefined) els(id).value = o[id]; });
  if (o.gstDoc && els('qacGstDocName')) els('qacGstDocName').textContent = o.gstDoc;
  if (o.idDoc && els('qacIdDocName')) els('qacIdDocName').textContent = o.idDoc;
  if (o.image) qacSetAvatarImage(o.image);
}

function qacResetForm() {
  QAC_FIELDS.forEach(id => {
    const el = els(id);
    if (!el) return;
    if (id === 'qacDueType') el.value = 'due';
    else el.value = '';
  });
  const gstBtn = els('qacVerifyGstin'); gstBtn.textContent = 'Verify'; gstBtn.className = 'qac-verify-btn';
  const hint = els('qacGstinHint'); hint.textContent = 'Click Verify to validate GSTIN'; hint.className = 'qac-hint';
  els('qacGstDocName').textContent = 'No file chosen';
  els('qacIdDocName').textContent = 'No file chosen';
  qacSetAvatarImage(null);
  els('qacCustomerId').value = qacNextCode();
  qacActivateTab('general');
}

function qacSetAvatarImage(src) {
  const box = els('qacAvatarPreview');
  if (!box) return;
  if (src) {
    box.innerHTML = '<img src="' + src + '" alt="Customer photo" />';
  } else {
    box.innerHTML = '<svg viewBox="0 0 24 24" width="70" height="70" fill="#b6bac5"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2.3c-3.9 0-7 1.8-7 4.2V21h14v-2.5c0-2.4-3.1-4.2-7-4.2z"/></svg>';
  }
}

let editingCustomerId = null;

function openQuickAddCustomer(phonePrefill) {
  editingCustomerId = null;
  qacResetForm();
  // Restore any autosaved draft, phone from the POS lookup wins
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem('hisaab_' + QAC_DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
  if (draft && typeof draft === 'object') qacWriteForm(draft);
  if (phonePrefill) els('qacPhone').value = String(phonePrefill).replace(/\D/g, '').slice(0, 10);
  const title = document.querySelector('#quickAddCustomerModal .qac-title');
  if (title) title.textContent = 'Add New Customer';
  const sub = document.querySelector('#quickAddCustomerModal .qac-sub');
  if (sub) sub.textContent = 'Capture customer details for billing and credit tracking.';
  const saveBtn = els('qacSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Save Customer';
  qacActivateTab('general');
  showModal('quickAddCustomerModal');
  setTimeout(() => { const n = els('qacName'); if (n) n.focus(); }, 80);
}

function editCustomer(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  editingCustomerId = id;
  qacResetForm();
  if (els('qacCustomerId')) els('qacCustomerId').value = c.code || qacNextCode();
  if (els('qacCustomerType')) els('qacCustomerType').value = c.customerType || '';
  if (els('qacName')) els('qacName').value = c.name || '';
  if (els('qacGstin')) els('qacGstin').value = c.gstin || '';
  if (els('qacPhone')) els('qacPhone').value = c.phone || '';
  if (els('qacEmail')) els('qacEmail').value = c.email || '';
  // Keep due/advance read-only in edit mode via settle flow; show current values
  if (els('qacDueAdvance')) els('qacDueAdvance').value = Math.abs(Number(c.due) || 0) || '';
  if (els('qacDueType')) els('qacDueType').value = (Number(c.due) || 0) < 0 ? 'advance' : 'due';
  if (els('qacCreditLimit')) els('qacCreditLimit').value = Number(c.creditLimit) || 0;
  if (els('qacAddrLine')) els('qacAddrLine').value = c.address || '';
  if (els('qacCity')) els('qacCity').value = c.city || '';
  if (els('qacState')) els('qacState').value = c.state || '';
  if (els('qacPincode')) els('qacPincode').value = c.pincode || '';
  if (c.image) qacSetAvatarImage(c.image); else qacSetAvatarImage(null);

  const title = document.querySelector('#quickAddCustomerModal .qac-title');
  if (title) title.textContent = 'Edit Customer';
  const sub = document.querySelector('#quickAddCustomerModal .qac-sub');
  if (sub) sub.textContent = 'Update customer details. Use Settle Outstanding to adjust due/advance balance.';
  const saveBtn = els('qacSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Update Customer';
  qacActivateTab('general');
  showModal('quickAddCustomerModal');
  setTimeout(() => { const n = els('qacName'); if (n) n.focus(); }, 80);
}

function qacValidateAndBuildCustomer() {
  const name = els('qacName').value.trim();
  const phone = els('qacPhone').value.replace(/\D/g, '');
  const email = els('qacEmail').value.trim();
  if (!name) { toast('Customer Name is required', 'error'); qacActivateTab('general'); els('qacName').focus(); return null; }
  if (phone.length !== 10) { toast('Enter a valid 10-digit mobile number', 'error'); qacActivateTab('general'); els('qacPhone').focus(); return null; }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { toast('Enter a valid Email ID', 'error'); els('qacEmail').focus(); return null; }
  const gstin = els('qacGstin').value.trim().toUpperCase();
  if (gstin && !qacGstinValid(gstin)) { toast('GSTIN looks invalid — 15 characters expected', 'error'); els('qacGstin').focus(); return null; }
  const dueAmt = Math.max(0, parseFloat(els('qacDueAdvance').value) || 0);
  const dueType = els('qacDueType').value === 'advance' ? -1 : 1;
  const gstDoc = els('qacGstDocName').textContent;
  const idDoc = els('qacIdDocName').textContent;
  const image = els('qacAvatarPreview').querySelector('img');
  const state = (els('qacState').value || '').trim() || (gstStateFromGstin(gstin)?.name || '');

  return {
    id: uid(),
    code: els('qacCustomerId').value || qacNextCode(),
    name,
    phone,
    email,
    state,
    address: [els('qacAddrLine').value.trim(), els('qacCity').value.trim(), state, els('qacPincode').value.trim()].filter(Boolean).join(', '),
    gstin,
    customerType: els('qacCustomerType').value,
    points: 0,
    pointsExpiry: '',
    due: r2(dueAmt * dueType),
    creditLimit: Math.max(0, parseFloat(els('qacCreditLimit').value) || 0),
    totalPurchases: 0,
    gstDoc, idDoc,
    image: image ? image.src : null
  };
}

function qacGstinValid(g) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(g || '').trim().toUpperCase());
}

function saveQuickCustomer(asDraft) {
  if (asDraft) {
    DB.set(QAC_DRAFT_KEY, qacReadForm());
    toast('Draft saved', 'success');
    return;
  }
  const c = qacValidateAndBuildCustomer();
  if (!c) return;

  if (editingCustomerId) {
    const idx = customers.findIndex(x => x.id === editingCustomerId);
    if (idx === -1) { toast('Customer not found', 'error'); return; }
    if (customers.some(x => x.phone === c.phone && x.id !== editingCustomerId)) {
      toast('A customer with this phone already exists', 'error');
      return;
    }
    const existing = customers[idx];
    // Preserve accounting/balance history fields; balances are managed via checkout/settlements
    const updated = Object.assign({}, existing, c, {
      id: existing.id,
      code: existing.code || c.code,
      points: Number(existing.points) || 0,
      totalPurchases: Number(existing.totalPurchases) || 0,
      due: Number(existing.due) || 0
    });
    customers[idx] = updated;
    DB.set('customers', customers);
    try { DB.remove(QAC_DRAFT_KEY); } catch (e) { }
    if (selectedCustomer && selectedCustomer.id === updated.id) {
      selectedCustomer = updated;
      if (els('customerPhone')) els('customerPhone').value = updated.phone || '';
      renderCustomerCard(updated);
    }
    if (typeof renderCustomers === 'function') renderCustomers();
    hideModal('quickAddCustomerModal');
    editingCustomerId = null;
    toast(`Customer ${updated.name} updated`, 'success');
    return;
  }

  if (customers.some(x => x.phone === c.phone)) {
    toast('A customer with this phone already exists', 'error');
    return;
  }
  customers.unshift(c);
  DB.set('customers', customers);
  try { DB.remove(QAC_DRAFT_KEY); } catch (e) { }
  els('customerPhone').value = c.phone;
  renderCustomerCard(c);
  if (els('customerName')) els('customerName').textContent = c.name;
  if (typeof renderCustomers === 'function') renderCustomers();
  hideModal('quickAddCustomerModal');
  toast(`Customer ${c.name} added`, 'success');
}

function setupQuickAddCustomer() {
  const close = () => { editingCustomerId = null; hideModal('quickAddCustomerModal'); };
  populateStateSelect(els('qacState'), '');
  els('closeQuickAddCustomer').addEventListener('click', close);
  els('qacDraftBtn').addEventListener('click', () => saveQuickCustomer(true));
  els('qacSaveBtn').addEventListener('click', () => saveQuickCustomer(false));
  els('qacNextBtn').addEventListener('click', () => {
    const cur = document.querySelector('#qacTabs .qac-tab.active');
    const i = QAC_TABS.indexOf(cur ? cur.dataset.tab : 'general');
    qacActivateTab(QAC_TABS[Math.min(i + 1, QAC_TABS.length - 1)]);
  });

  // Tabs
  document.querySelectorAll('#qacTabs .qac-tab').forEach(t => t.addEventListener('click', () => qacActivateTab(t.dataset.tab)));

  // Phone / digits-only fields
  [['qacPhone', 10], ['qacPincode', 6]].forEach(([id, max]) => {
    els(id).addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, max); });
  });
  els('qacGstin').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
    const st = gstStateFromGstin(e.target.value);
    if (st && els('qacState')) els('qacState').value = st.name;
  });
  els('qacIfsc').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().slice(0, 11); });
  els('qacAcctNo').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 18); });

  // GSTIN verify
  els('qacVerifyGstin').addEventListener('click', () => {
    const v = els('qacGstin').value.trim().toUpperCase();
    const btn = els('qacVerifyGstin');
    const hint = els('qacGstinHint');
    if (!v) { toast('Enter GSTIN first', 'warning'); return; }
    if (qacGstinValid(v)) {
      btn.textContent = 'Valid ✓'; btn.className = 'qac-verify-btn ok';
      hint.textContent = 'GSTIN format is valid'; hint.className = 'qac-hint ok';
    } else {
      btn.textContent = 'Invalid'; btn.className = 'qac-verify-btn bad';
      hint.textContent = 'Enter a valid 15-digit GSTIN (e.g. 07ABCDE1234F1Z5)'; hint.className = 'qac-hint bad';
    }
  });

  // Profile picture
  const pickImage = () => els('qacImageInput').click();
  els('qacAvatarBtn').addEventListener('click', pickImage);
  els('qacUploadImageBtn').addEventListener('click', pickImage);
  els('qacImageInput').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file', 'error'); return; }
    if (file.size > 1024 * 1024) { toast('Max file size is 1MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => qacSetAvatarImage(ev.target.result);
    reader.readAsDataURL(file);
  });

  // Document rows (stores the file name only)
  [['qacGstDoc', 'qacGstDocName'], ['qacIdDoc', 'qacIdDocName']].forEach(([inputId, labelId]) => {
    els(inputId).addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      els(labelId).textContent = f ? f.name : 'No file chosen';
    });
  });

  // "+ Add Customer" on the customers page uses the same design
  els('addCustomerBtn').addEventListener('click', () => openQuickAddCustomer(null));
}

// ─── PAYMENT METHOD ───────────────────────────────────────────
function setupPaymentMethods() {
  document.querySelectorAll('.pay-method').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pay-method').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      paymentMethod = btn.dataset.method;
    });
  });
}

// ─── CHECKOUT ─────────────────────────────────────────────────
const PAY_EPS = 0.009;

// �"?�"?�"? LOYALTY & REWARDS (additive module) �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
const LOYALTY_SETTINGS_DEFAULTS = {
  enabled: false,
  earning: {
    spendAmount: 100,          // currency units per earnUnit
    earnUnit: 1,               // points per spendAmount
    minPurchaseAmount: 0,      // eligible purchase threshold to earn
    minBillAmount: 0,          // minimum bill amount to earn
    calcBasis: 'after_tax',    // 'after_tax' | 'before_tax'
    includeDiscounted: true,   // include discounted items in eligible amount
    allSales: true,            // earn on all sales (UI); false = selected-only (future/manual flag)
    selectedSalesOnly: false,
    maxPointsPerTxn: 0,        // 0 = no cap
    expiryDays: 0              // 0 = never expires
  },
  redemption: {
    pointValue: 1,             // currency units per point
    minPoints: 1,
    maxPercentOfInvoice: 100,  // % of (invoice/eligible payable basis) allowed via points
    minInvoiceAmount: 0,
    allowPartial: true,
    enabledAtPos: true,
    maxRedeemPointsPerInvoice: 0 // 0 = unlimited
  }
};

function _loyaltyDeepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!patch || typeof patch !== 'object') return out;
  Object.keys(patch).forEach(k => {
    const pv = patch[k];
    const bv = out[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = _loyaltyDeepMerge(bv, pv);
    } else {
      out[k] = pv;
    }
  });
  return out;
}

function getLoyaltySettings() {
  const raw = (typeof loyaltySettings !== 'undefined' && loyaltySettings && typeof loyaltySettings === 'object') ? loyaltySettings : (DB.get('loyaltySettings') || null);
  const merged = _loyaltyDeepMerge(JSON.parse(JSON.stringify(LOYALTY_SETTINGS_DEFAULTS)), raw || {});
  // normalize numbers/booleans
  merged.enabled = !!merged.enabled;
  merged.earning = merged.earning || {};
  merged.redemption = merged.redemption || {};
  merged.earning.spendAmount = Math.max(1, Number(merged.earning.spendAmount) || 100);
  merged.earning.earnUnit = Math.max(1, Number(merged.earning.earnUnit) || 1);
  merged.earning.minPurchaseAmount = Math.max(0, Number(merged.earning.minPurchaseAmount) || 0);
  merged.earning.minBillAmount = Math.max(0, Number(merged.earning.minBillAmount) || 0);
  merged.earning.calcBasis = (merged.earning.calcBasis === 'before_tax') ? 'before_tax' : 'after_tax';
  merged.earning.includeDiscounted = merged.earning.includeDiscounted !== false;
  merged.earning.allSales = merged.earning.allSales !== false;
  merged.earning.selectedSalesOnly = !!merged.earning.selectedSalesOnly;
  if (merged.earning.selectedSalesOnly) merged.earning.allSales = false;
  merged.earning.maxPointsPerTxn = Math.max(0, Math.floor(Number(merged.earning.maxPointsPerTxn) || 0));
  merged.earning.expiryDays = Math.max(0, Math.floor(Number(merged.earning.expiryDays) || 0));
  merged.redemption.pointValue = Math.max(0.01, Number(merged.redemption.pointValue) || 1);
  // The redemption threshold is now a minimum invoice amount; any legacy
  // minimum-points value is ignored so it cannot block redemptions invisibly.
  merged.redemption.minPoints = 0;
  merged.redemption.maxPercentOfInvoice = Math.min(100, Math.max(1, Math.floor(Number(merged.redemption.maxPercentOfInvoice == null || merged.redemption.maxPercentOfInvoice === '' ? 100 : merged.redemption.maxPercentOfInvoice))));
  merged.redemption.minInvoiceAmount = Math.max(0, Number(merged.redemption.minInvoiceAmount) || 0);
  merged.redemption.allowPartial = merged.redemption.allowPartial !== false;
  merged.redemption.enabledAtPos = merged.redemption.enabledAtPos !== false;
  merged.redemption.maxRedeemPointsPerInvoice = Math.max(0, Math.floor(Number(merged.redemption.maxRedeemPointsPerInvoice) || 0));
  return merged;
}

function saveLoyaltySettings(next) {
  loyaltySettings = getLoyaltySettings();
  loyaltySettings = _loyaltyDeepMerge(loyaltySettings, next || {});
  loyaltySettings = getLoyaltySettingsFromRaw(loyaltySettings);
  DB.set('loyaltySettings', loyaltySettings);
  return loyaltySettings;
}

function getLoyaltySettingsFromRaw(raw) {
  const prev = loyaltySettings;
  loyaltySettings = raw;
  const norm = getLoyaltySettings();
  loyaltySettings = prev;
  return norm;
}

function loyaltyProgramEnabled() { return !!getLoyaltySettings().enabled; }
function loyaltyEarnEnabled() { return loyaltyProgramEnabled(); }
function loyaltyRedeemEnabled() {
  const s = getLoyaltySettings();
  return !!(s.enabled && s.redemption && s.redemption.enabledAtPos);
}

function ensureCustomerLoyaltyFields(c) {
  if (!c || typeof c !== 'object') return c;
  if (typeof c.points !== 'number' || !isFinite(c.points)) c.points = Math.max(0, Number(c.points) || 0);
  c.points = Math.max(0, Math.floor(c.points));
  if (typeof c.loyaltyEarnedTotal !== 'number' || !isFinite(c.loyaltyEarnedTotal)) c.loyaltyEarnedTotal = Math.max(0, Number(c.loyaltyEarnedTotal) || 0);
  if (typeof c.loyaltyRedeemedTotal !== 'number' || !isFinite(c.loyaltyRedeemedTotal)) c.loyaltyRedeemedTotal = Math.max(0, Number(c.loyaltyRedeemedTotal) || 0);
  if (typeof c.loyaltyExpiredTotal !== 'number' || !isFinite(c.loyaltyExpiredTotal)) c.loyaltyExpiredTotal = Math.max(0, Number(c.loyaltyExpiredTotal) || 0);
  c.loyaltyEarnedTotal = Math.max(0, Math.floor(c.loyaltyEarnedTotal));
  c.loyaltyRedeemedTotal = Math.max(0, Math.floor(c.loyaltyRedeemedTotal));
  c.loyaltyExpiredTotal = Math.max(0, Math.floor(c.loyaltyExpiredTotal));
  return c;
}

function getCustomerLoyaltySummary(c) {
  ensureCustomerLoyaltyFields(c || {});
  const txns = Array.isArray(loyaltyTransactions) ? loyaltyTransactions : [];
  const cid = c && c.id;
  let earned = 0, redeemed = 0, expired = 0;
  txns.forEach(t => {
    if (!t || t.customerId !== cid) return;
    const pts = Number(t.points) || 0;
    if (t.type === 'earned') earned += Math.abs(pts);
    else if (t.type === 'redeemed') redeemed += Math.abs(pts);
    else if (t.type === 'expired') expired += Math.abs(pts);
    else if (t.type === 'adjusted') {
      if (pts >= 0) earned += pts; else redeemed += Math.abs(pts);
    } else if (t.type === 'reversed') {
      // reversed entries carry signed delta via points (negative to remove earned, positive to restore redeemed)
      // handled in balance derivation; keep totals conservative by not double-counting
    }
  });
  // Prefer explicit totals if present, else derive
  const earnedTotal = Math.max(Number(c && c.loyaltyEarnedTotal) || 0, earned);
  const redeemedTotal = Math.max(Number(c && c.loyaltyRedeemedTotal) || 0, redeemed);
  const expiredTotal = Math.max(Number(c && c.loyaltyExpiredTotal) || 0, expired);
  const available = Math.max(0, Math.floor(Number(c && c.points) || 0));
  return { earnedTotal, available, redeemedTotal, expiredTotal };
}

function loyaltyTxnExists(idempotencyKey) {
  if (!idempotencyKey) return false;
  const txns = Array.isArray(loyaltyTransactions) ? loyaltyTransactions : [];
  return txns.some(t => t && t.idempotencyKey === idempotencyKey);
}

function appendLoyaltyTransaction(entry) {
  if (!entry || !entry.idempotencyKey) return null;
  if (!Array.isArray(loyaltyTransactions)) loyaltyTransactions = [];
  if (loyaltyTxnExists(entry.idempotencyKey)) return null; // idempotent no-op
  const txn = Object.assign({
    id: (typeof uid === 'function') ? uid() : ('lt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    ts: Date.now(),
    date: (typeof now === 'function') ? now() : new Date().toLocaleString('en-IN'),
    createdBy: (typeof getUserProfile === 'function' && getUserProfile() && getUserProfile().name) ? getUserProfile().name : 'System',
    description: '',
    points: 0,
    balanceAfter: null
  }, entry);
  loyaltyTransactions.unshift(txn);
  DB.set('loyaltyTransactions', loyaltyTransactions);
  return txn;
}

function loyaltyEligibleAmountFromCart(basis, includeDiscounted) {
  const items = Array.isArray(cart) ? cart : [];
  let sum = 0;
  items.forEach(item => {
    if (item && (item.rewardFree || item.rewardId)) return; // free reward lines never earn points
    const r = (typeof calcItemTotal === 'function') ? calcItemTotal(item) : null;
    if (!r) return;
    const qty = Number(item.qty) || 0;
    const base = Number(r.base) || 0;
    const disc = Number(r.discAmt) || 0;
    const taxable = Number(r.taxable) || 0;
    const total = Number(r.total) || 0;
    let lineEligible = (basis === 'before_tax') ? taxable : total;
    // "whether discounted products are eligible" - interpret as: if false, exclude line discount amount from eligibility
    if (!includeDiscounted && disc > 0) {
      // remove discount portion proportionally from chosen basis
      if (basis === 'before_tax') {
        // taxable already net of discount; to exclude discounted portion, use pre-discount taxable proportionally
        const preDiscNet = base;
        const preDiscTaxable = (item.taxInclusive && Number(item.tax) > 0) ? (preDiscNet / (1 + (Number(item.tax)||0)/100)) : preDiscNet;
        lineEligible = Math.max(0, lineEligible - Math.max(0, preDiscTaxable - taxable));
      } else {
        const preDiscNet = base;
        const preDiscTotal = (item.taxInclusive && Number(item.tax) > 0) ? preDiscNet : (preDiscNet + (preDiscNet * ((Number(item.tax)||0)/100)));
        // approximate exclusion of discount benefit
        lineEligible = Math.max(0, lineEligible - Math.max(0, preDiscTotal - total));
      }
    }
    if (qty <= 0) lineEligible = 0;
    sum += Math.max(0, lineEligible);
  });
  return (typeof r2 === 'function') ? r2(sum) : Math.round(sum * 100) / 100;
}

function computeLoyaltyEarnPreview(amounts, customer, opts = {}) {
  const s = getLoyaltySettings();
  const result = { eligible: false, points: 0, eligibleAmount: 0, reason: '' };
  if (!s.enabled) { result.reason = 'disabled'; return result; }
  if (s.earning && s.earning.selectedSalesOnly && !s.earning.allSales && !opts.forceSelectedSale) { result.reason = 'not_selected_sale'; return result; }
  const a = amounts || {};
  const eligibleAmount = loyaltyEligibleAmountFromCart(s.earning.calcBasis, s.earning.includeDiscounted !== false);
  result.eligibleAmount = (typeof r2 === 'function') ? r2(eligibleAmount) : eligibleAmount;
  const billAmount = Number(a.grand) || 0;
  if (eligibleAmount < (Number(s.earning.minPurchaseAmount) || 0)) { result.reason = 'min_purchase'; return result; }
  if (billAmount < (Number(s.earning.minBillAmount) || 0)) { result.reason = 'min_bill'; return result; }
  const spend = Math.max(1, Number(s.earning.spendAmount) || 100);
  const unit = Math.max(1, Number(s.earning.earnUnit) || 1);
  let points = Math.floor((eligibleAmount / spend) * unit);
  const cap = Math.max(0, Math.floor(Number(s.earning.maxPointsPerTxn) || 0));
  if (cap > 0) points = Math.min(points, cap);
  if (points <= 0) { result.reason = 'below_threshold'; return result; }
  result.eligible = true;
  result.points = points;
  return result;
}

let __loyaltyRedeemPointsInput = 0;
function setLoyaltyRedeemPointsInput(v) {
  __loyaltyRedeemPointsInput = Math.max(0, Math.floor(Number(v) || 0));
}
function getLoyaltyRedeemPointsInput() { return Math.max(0, Math.floor(Number(__loyaltyRedeemPointsInput) || 0)); }

function computeLoyaltyRedemption(amounts, customer, requestedPoints) {
  const s = getLoyaltySettings();
  const out = { allowed: false, points: 0, discount: 0, reason: '', maxPoints: 0, maxDiscount: 0, maxPerInvoice: 0, maxPercent: 100, eligibleInvoiceAmount: 0 };
  if (!loyaltyRedeemEnabled()) { out.reason = 'disabled'; return out; }
  if (!customer) { out.reason = 'no_customer'; return out; }
  ensureCustomerLoyaltyFields(customer);

  const available = Math.max(0, Math.floor(Number(customer.points) || 0));
  const a = amounts || {};
  // Eligible payable amount before loyalty redemption (points must not reduce beyond invoice/payable value).
  const invoiceAmount = Math.max(0, Number(a.grand) || 0);
  const pointValue = Math.max(0.01, Number(s.redemption.pointValue) || 1);
  const configuredMaxPerInvoice = Math.max(0, Math.floor(Number(s.redemption.maxRedeemPointsPerInvoice) || 0));
  const configuredMaxPercent = Math.min(100, Math.max(1, Math.floor(Number(s.redemption.maxPercentOfInvoice == null ? 100 : s.redemption.maxPercentOfInvoice))));
  out.maxPerInvoice = configuredMaxPerInvoice;
  out.maxPercent = configuredMaxPercent;
  out.eligibleInvoiceAmount = (typeof r2 === 'function') ? r2(invoiceAmount) : invoiceAmount;

  if (invoiceAmount < (Number(s.redemption.minInvoiceAmount) || 0)) { out.reason = 'min_invoice'; out.maxPoints = 0; out.maxDiscount = 0; return out; }

  // Effective maximum redeemable points = lowest of:
  // 1) customer's available points, 2) configured max points per invoice,
  // 3) points equivalent to configured max bill percentage, 4) points equivalent to eligible invoice amount.
  const capByPercent = (configuredMaxPercent / 100) * invoiceAmount;
  const capByInvoice = Math.max(0, invoiceAmount);
  const maxDiscountMoney = Math.max(0, Math.min(capByPercent, capByInvoice));
  let maxPointsByDiscount = Math.floor((maxDiscountMoney + 1e-9) / pointValue);
  let maxPoints = Math.max(0, Math.min(available, maxPointsByDiscount, configuredMaxPerInvoice > 0 ? configuredMaxPerInvoice : Infinity));
  maxPoints = Math.floor(maxPoints);
  const maxDiscount = (typeof r2 === 'function') ? r2(maxPoints * pointValue) : Math.round(maxPoints * pointValue * 100) / 100;
  out.maxPoints = maxPoints;
  out.maxDiscount = maxDiscount;
  // Identify primary binding limit for messaging (lowest applicable cap).
  out.maxPointsByPercent = Math.floor((capByPercent + 1e-9) / pointValue);
  out.maxPointsByInvoice = Math.floor((capByInvoice + 1e-9) / pointValue);
  out.binding = 'none';
  if (maxPoints <= 0) {
    out.binding = (available <= 0) ? 'available' : (configuredMaxPerInvoice > 0 && configuredMaxPerInvoice <= maxPointsByDiscount && configuredMaxPerInvoice <= available ? 'per_invoice' : (out.maxPointsByPercent <= out.maxPointsByInvoice ? 'percent' : 'invoice'));
  } else {
    const candidates = [
      { k: 'available', v: available },
      { k: 'per_invoice', v: configuredMaxPerInvoice > 0 ? configuredMaxPerInvoice : Infinity },
      { k: 'percent', v: out.maxPointsByPercent },
      { k: 'invoice', v: out.maxPointsByInvoice }
    ];
    candidates.sort((a, b) => a.v - b.v);
    out.binding = candidates[0].k;
  }

  // Minimum redemption requirement is evaluated against what the customer can actually redeem now.
  if (available < (Number(s.redemption.minPoints) || 0)) { out.reason = 'insufficient_points'; return out; }
  if (maxPoints < (Number(s.redemption.minPoints) || 0)) {
    // Not enough redeemable points given limits/invoice (even if balance is high, per-invoice/invoice caps can block).
    out.reason = (maxPointsByDiscount < (Number(s.redemption.minPoints) || 0)) ? 'cap_reached' : 'below_min_points';
    return out;
  }

  let req = Math.floor(Number(requestedPoints) || 0);
  if (req <= 0) { out.reason = 'no_points_requested'; out.points = 0; out.discount = 0; out.allowed = false; return out; }

  // Explicit per-invoice configured limit enforcement (backend/core logic, not UI-only).
  if (configuredMaxPerInvoice > 0 && req > configuredMaxPerInvoice) {
    out.reason = 'over_max_per_invoice';
    return out;
  }
  // Cannot redeem more than available balance.
  if (req > available) { out.reason = 'insufficient_points'; return out; }
  // Cannot redeem beyond eligible invoice / percentage / effective caps.
  if (req > maxPoints) { out.reason = 'cap_reached'; return out; }

  if (!s.redemption.allowPartial) {
    // When partial redemption is disallowed, only the maximum allowed amount can be redeemed.
    if (req < maxPoints) { out.reason = 'partial_not_allowed'; return out; }
    req = maxPoints;
  } else {
    req = Math.min(req, maxPoints);
  }

  if (req < (Number(s.redemption.minPoints) || 0)) { out.reason = 'below_min_points'; return out; }

  const discount = (typeof r2 === 'function') ? r2(req * pointValue) : Math.round(req * pointValue * 100) / 100;
  // Redemption value must never exceed eligible payable amount.
  if (discount <= 0 || discount - invoiceAmount > 0.009) { out.reason = 'cap_reached'; return out; }

  out.allowed = true;
  out.points = req;
  out.discount = discount;
  out.reason = '';
  return out;
}

function getLoyaltyRedemptionForCheckout(amounts) {
  const cust = (typeof selectedCustomer !== 'undefined') ? selectedCustomer : null;
  return computeLoyaltyRedemption(amounts, cust, getLoyaltyRedeemPointsInput());
}

function loyaltyCustomerTxns(customerId) {
  const txns = Array.isArray(loyaltyTransactions) ? loyaltyTransactions : [];
  return txns.filter(t => t && t.customerId === customerId);
}

// Human labels for the append-only ledger types.
function loyaltyTxnTypeLabel(type) {
  const map = {
    earned: 'Points Earned',
    redeemed: 'Points Redeemed',
    adjusted: 'Adjustment',
    reversed: 'Reversal',
    expired: 'Points Expired',
    reward_redeemed: 'Reward Redeemed',
    reward_applied: 'Offer Applied',
    referral_reward: 'Referral Reward'
  };
  return map[String(type || '')] || String(type || '');
}

// Count of rewards the customer can redeem right now (free products) plus
// offers currently unlocked by their cart is computed in the POS panel; here we
// surface the customer-level view used by the customer profile.
function getCustomerRewardSummary(customer) {
  const out = { rewards: [], availableCount: 0, referralCode: '', successfulReferrals: 0, referralRewardTotal: 0, pointsValue: 0 };
  if (!customer) return out;
  ensureCustomerLoyaltyFields(customer);
  out.referralCode = ensureReferralCode(customer);
  out.successfulReferrals = successfulReferralCount(customer.id);
  out.referralRewardTotal = r2(Number(customer.referralRewardTotal) || 0);
  const s = getLoyaltySettings();
  out.pointsValue = r2((Math.max(0, Math.floor(Number(customer.points) || 0))) * Math.max(0.01, Number(s.redemption.pointValue) || 1));
  if (s.enabled && rewardsPlanAllows('free_product')) {
    ensureRewardConfigs();
    rewardConfigs.forEach(r => {
      if (r.type !== 'free_product' || !rewardIsValidNow(r)) return;
      const c = r.config;
      const product = rewardProductById(c.productId);
      if (!product) return;
      if (c.customerType && String(customer.customerType || '').toLowerCase() !== String(c.customerType).toLowerCase()) return;
      const remaining = rewardRemainingUsage(r);
      if (remaining != null && remaining <= 0) return;
      const need = Math.max(0, Math.floor(Number(c.pointsRequired) || 0));
      out.rewards.push({ name: r.name, productName: product.name, points: need, eligible: Math.floor(Number(customer.points) || 0) >= need, quantity: Math.max(1, Number(c.quantity) || 1) });
      if (Math.floor(Number(customer.points) || 0) >= need) out.availableCount++;
    });
  }
  return out;
}

function syncLoyaltyPosUi(amounts) {
  const box = els('posLoyaltyRedeemBox');
  const availEl = els('posLoyaltyAvailable');
  const hintEl = els('posLoyaltyHint');
  const input = els('posLoyaltyPointsInput');
  const cust = (typeof selectedCustomer !== 'undefined') ? selectedCustomer : null;
  const s = getLoyaltySettings();
  const enabled = !!(s.enabled && s.redemption && s.redemption.enabledAtPos && cust);
  if (box) box.classList.toggle('hidden', !enabled);
  if (!enabled) {
    if (input) input.value = '0';
    try { renderPosRewardsPanel(); } catch (e) {}
    return;
  }
  ensureCustomerLoyaltyFields(cust);
  const beforeLoyaltyAmt = amounts && amounts.beforeLoyalty != null ? { grand: amounts.beforeLoyalty } : { grand: (amounts && amounts.grand != null ? (Number(amounts.grand) + (Number(amounts.loyaltyDiscount)||0)) : 0) };
  // Better base: compute from current checkoutAmounts logic by temporarily considering current request; use computeLoyaltyRedemption with before-loyalty amount
  let baseGrand = beforeLoyaltyAmt.grand;
  try { if (!amounts) { const t = computeCartTotals(); const ship = parseFloat(els('shippingInput')?.value)||0; const disc = parseFloat(els('discountInput')?.value)||0; baseGrand = r2(Math.max(0,t.subtotal+t.totalTax+ship-disc)); } } catch(e){}
  const requestedNow = getLoyaltyRedeemPointsInput();
  const redemptionReq = computeLoyaltyRedemption({ grand: baseGrand }, cust, requestedNow);
  const overPerInvoice = redemptionReq.maxPerInvoice > 0 && requestedNow > redemptionReq.maxPerInvoice;
  if (availEl) availEl.textContent = 'Available: ' + (Math.max(0, Math.floor(Number(cust.points)||0))) + ' pts';
  if (input) {
    const cur = getLoyaltyRedeemPointsInput();
    let clamped = cur;
    if (cur > 0) clamped = redemptionReq.maxPoints > 0 ? Math.min(cur, redemptionReq.maxPoints) : 0;
    if (overPerInvoice) clamped = Math.min(clamped, redemptionReq.maxPerInvoice);
    if (clamped !== cur) setLoyaltyRedeemPointsInput(clamped);
    if (document.activeElement !== input) input.value = String(getLoyaltyRedeemPointsInput());
    input.max = String(Math.max(0, redemptionReq.maxPoints || 0));
  }
  const req = getLoyaltyRedeemPointsInput();
  const redemptionEff = computeLoyaltyRedemption({ grand: baseGrand }, cust, req);
  if (hintEl) {
    const maxAmt = fmt(redemptionEff.maxDiscount || 0);
    const pctCtx = (redemptionEff.maxPercent < 100 || redemptionEff.binding === 'percent') ? (', ' + redemptionEff.maxPercent + '% of this invoice') : '';
    const maxMsg = 'Maximum redeemable: ' + maxAmt + ' (' + redemptionEff.maxPoints + ' pts' + pctCtx + ').';
    const overMsg = (redemptionEff.maxPercent < 100 || redemptionEff.binding === 'percent' || redemptionReq.maxPercent < 100)
      ? ('You can redeem a maximum of ' + maxAmt + ' (' + (redemptionEff.maxPercent || redemptionReq.maxPercent) + '% of this invoice) using shopping points.')
      : ('You can redeem a maximum of ' + maxAmt + ' (' + redemptionEff.maxPoints + ' points) for this invoice.');
    if (requestedNow > 0 && requestedNow > redemptionReq.maxPoints) {
      hintEl.textContent = overMsg;
    } else if (req > 0 && redemptionEff.allowed) {
      hintEl.textContent = 'Redeeming ' + redemptionEff.points + ' pts (-' + fmt(redemptionEff.discount) + '). ' + maxMsg;
    } else if (req > 0 && !redemptionEff.allowed) {
      const map = {
        min_invoice: 'Bill amount too low for redemption.',
        insufficient_points: 'Not enough points available. ' + maxMsg,
        below_min_points: 'Below minimum redeemable points. ' + maxMsg,
        partial_not_allowed: 'Partial redemption not allowed by rules. ' + maxMsg,
        cap_reached: overMsg,
        over_max_per_invoice: overMsg,
        no_points_requested: ''
      };
      hintEl.textContent = map[redemptionEff.reason] || ('Points cannot be redeemed for this bill. ' + maxMsg);
    } else {
      hintEl.textContent = redemptionEff.maxPoints > 0 ? ('You can redeem up to ' + maxAmt + ' (' + redemptionEff.maxPoints + ' pts' + pctCtx + ') on this bill.') : 'No points redeemable on this bill right now.';
    }
  }
  try { renderPosRewardsPanel(); } catch (e) {}
}

function renderLoyaltyCheckoutUi(a) {
  const s = getLoyaltySettings();
  const cust = (typeof selectedCustomer !== 'undefined') ? selectedCustomer : null;
  const section = els('checkoutLoyaltySection');
  const row = els('co-loyaltyRow');
  const discEl = els('co-loyaltyDiscount');
  const availEl = els('checkoutLoyaltyAvailable');
  const hintEl = els('checkoutLoyaltyHint');
  const input = els('checkoutLoyaltyPointsInput');
  const enabled = !!(s.enabled && s.redemption && s.redemption.enabledAtPos && cust);
  if (section) section.classList.toggle('hidden', !enabled);
  const discount = a && Number(a.loyaltyDiscount) ? Number(a.loyaltyDiscount) : 0;
  if (row) row.classList.toggle('hidden', !(discount > PAY_EPS));
  if (discEl) discEl.textContent = '-' + fmt(discount);
  if (!enabled) return;
  ensureCustomerLoyaltyFields(cust);
  const baseGrand = a && a.beforeLoyalty != null ? Number(a.beforeLoyalty) : (Number(a && a.grand || 0) + discount);
  const requestedNow = getLoyaltyRedeemPointsInput();
  const redemptionReq = computeLoyaltyRedemption({ grand: baseGrand }, cust, requestedNow);
  const overPerInvoice = redemptionReq.maxPerInvoice > 0 && requestedNow > redemptionReq.maxPerInvoice;
  if (availEl) availEl.textContent = 'Available: ' + (Math.max(0, Math.floor(Number(cust.points)||0))) + ' pts';
  if (input) {
    const cur = getLoyaltyRedeemPointsInput();
    let clamped = cur;
    if (cur > 0) clamped = redemptionReq.maxPoints > 0 ? Math.min(cur, redemptionReq.maxPoints) : 0;
    if (overPerInvoice) clamped = Math.min(clamped, redemptionReq.maxPerInvoice);
    if (clamped !== cur) setLoyaltyRedeemPointsInput(clamped);
    if (document.activeElement !== input) input.value = String(getLoyaltyRedeemPointsInput());
    input.max = String(Math.max(0, redemptionReq.maxPoints || 0));
  }
  const req = getLoyaltyRedeemPointsInput();
  const redemptionEff = computeLoyaltyRedemption({ grand: baseGrand }, cust, req);
  if (hintEl) {
    const maxAmt = fmt(redemptionEff.maxDiscount || 0);
    const pctCtx = (redemptionEff.maxPercent < 100 || redemptionEff.binding === 'percent') ? (', ' + redemptionEff.maxPercent + '% of this invoice') : '';
    const overMsg = (redemptionEff.maxPercent < 100 || redemptionEff.binding === 'percent' || redemptionReq.maxPercent < 100)
      ? ('You can redeem a maximum of ' + maxAmt + ' (' + (redemptionEff.maxPercent || redemptionReq.maxPercent) + '% of this invoice) using shopping points.')
      : ('You can redeem a maximum of ' + maxAmt + ' (' + redemptionEff.maxPoints + ' points) for this invoice.');
    if (requestedNow > 0 && requestedNow > redemptionReq.maxPoints) {
      hintEl.textContent = overMsg;
    } else if (req > 0 && redemptionEff.allowed) {
      hintEl.textContent = 'Redeeming ' + redemptionEff.points + ' pts (-' + fmt(redemptionEff.discount) + '). Max ' + maxAmt + ' (' + redemptionEff.maxPoints + ' pts' + pctCtx + ').';
    } else if (req > 0) {
      const map = {
        insufficient_points: 'Not enough points available. Max ' + maxAmt + ' (' + redemptionEff.maxPoints + ' pts' + pctCtx + ').',
        below_min_points: 'Below minimum redeemable points.',
        cap_reached: overMsg,
        over_max_per_invoice: overMsg
      };
      hintEl.textContent = map[redemptionEff.reason] || 'Current points cannot be applied with active rules/limits.';
    } else {
      hintEl.textContent = redemptionEff.maxPoints > 0 ? ('Up to ' + maxAmt + ' (' + redemptionEff.maxPoints + ' pts' + pctCtx + ') can be redeemed.') : 'No redeemable points for this bill.';
    }
  }
}

function setupLoyaltyUiHandlers() {
  if (window.__loyaltyUiHandlersBound) return;
  window.__loyaltyUiHandlersBound = true;
  const onInput = (id) => {
    const el = els(id); if (!el) return;
    el.addEventListener('input', () => {
      const typed = Math.max(0, Math.floor(Number(el.value) || 0));
      setLoyaltyRedeemPointsInput(el.value);
      try {
        const a = (typeof checkoutAmounts === 'function') ? checkoutAmounts() : null;
        const baseGrand = a && a.beforeLoyalty != null ? Number(a.beforeLoyalty) : (a && (Number(a.grand || 0) + Number(a.loyaltyDiscount || 0))) || 0;
        const cust = (typeof selectedCustomer !== 'undefined') ? selectedCustomer : null;
        const probe = computeLoyaltyRedemption({ grand: baseGrand }, cust, typed);
        const lastWarn = window.__loyMaxPerInvWarn || 0;
        if (typed > 0 && typed > probe.maxPoints && lastWarn !== typed) {
          window.__loyMaxPerInvWarn = typed;
          const amt = (typeof fmt === 'function') ? fmt(probe.maxDiscount || 0) : ('₹' + (probe.maxDiscount || 0));
          const pctMsg = probe.maxPercent < 100 || probe.binding === 'percent';
          const msg = pctMsg
            ? ('You can redeem a maximum of ' + amt + ' (' + probe.maxPercent + '% of this invoice) using shopping points.')
            : ('You can redeem a maximum of ' + amt + ' (' + probe.maxPoints + ' points) for this invoice.');
          toast(msg, 'error');
        } else if (typed <= probe.maxPoints) {
          window.__loyMaxPerInvWarn = 0;
        }
      } catch (e) {}
      try { if (typeof renderCartTotals === 'function') renderCartTotals(); } catch (e) {}
      try { if (typeof updateCheckoutStatus === 'function' && els('checkoutModal') && !els('checkoutModal').classList.contains('hidden')) updateCheckoutStatus(); } catch (e) {}
      try { renderLoyaltyCheckoutUi((typeof checkoutAmounts==='function')?checkoutAmounts():null); } catch(e){}
    });
  };
  onInput('posLoyaltyPointsInput');
  onInput('checkoutLoyaltyPointsInput');
  const bindBtn = (id, fn) => { const b = els(id); if (b) b.addEventListener('click', fn); };
  bindBtn('posLoyaltyMaxBtn', () => { try { const a=checkoutAmounts(); const base=a.beforeLoyalty!=null?{grand:a.beforeLoyalty}:{grand:a.grand+a.loyaltyDiscount}; const r=computeLoyaltyRedemption(base, selectedCustomer, 999999999); setLoyaltyRedeemPointsInput(r.maxPoints||0); renderCartTotals(); renderLoyaltyCheckoutUi(checkoutAmounts()); updateCheckoutStatus(); } catch(e){} });
  bindBtn('posLoyaltyClearBtn', () => { setLoyaltyRedeemPointsInput(0); try { renderCartTotals(); renderLoyaltyCheckoutUi(checkoutAmounts()); updateCheckoutStatus(); } catch(e){} });
  bindBtn('checkoutLoyaltyMaxBtn', () => { try { const a=checkoutAmounts(); const base={grand:a.beforeLoyalty!=null?a.beforeLoyalty:(a.grand+a.loyaltyDiscount)}; const r=computeLoyaltyRedemption(base, selectedCustomer, 999999999); setLoyaltyRedeemPointsInput(r.maxPoints||0); renderCartTotals(); renderLoyaltyCheckoutUi(checkoutAmounts()); updateCheckoutStatus(); } catch(e){} });
  bindBtn('checkoutLoyaltyClearBtn', () => { setLoyaltyRedeemPointsInput(0); try { renderCartTotals(); renderLoyaltyCheckoutUi(checkoutAmounts()); updateCheckoutStatus(); } catch(e){} });

  // Loyalty settings view
  const saveBtn = els('saveLoyaltySettingsBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => { try { saveLoyaltySettingsFromForm(); } catch(e){ toast('Failed to save loyalty settings','error'); } });
  ['loyaltyEnabledToggle','loyEarnSpendAmount','loyEarnUnit','loyEarnMinPurchase','loyEarnMinBill','loyEarnMaxPoints','loyEarnExpiryDays','loyEarnCalcBasis','loyEarnDiscounted','loyEarnScope','loyRedeemPointValue','loyRedeemMinPoints','loyRedeemMaxPercent','loyRedeemMinInvoice','loyRedeemPartial','loyRedeemAtPos'].forEach(id => {
    const el = els(id); if (!el) return;
    el.addEventListener('input', () => { if (id !== 'loyaltyEnabledToggle') renderLoyaltyRuleExampleFromForm(); });
    el.addEventListener('change', () => {
      if (id === 'loyaltyEnabledToggle') {
        saveLoyaltySettings({ enabled: !!el.checked });
        renderLoyaltyView();
        try { renderCartTotals(); } catch (e) {}
        try { syncLoyaltyPosUi(); } catch (e) {}
        try { renderPosRewardsPanel(); } catch (e) {}
      } else {
        renderLoyaltyRuleExampleFromForm();
      }
    });
  });
}

function renderLoyaltyRuleExampleFromForm() {
  const el = els('loyaltyRuleExample'); if (!el) return;
  const spend = Math.max(1, Number(els('loyEarnSpendAmount')?.value)||100);
  const earn = Math.max(1, Number(els('loyEarnUnit')?.value)||1);
  const pv = Math.max(0.01, Number(els('loyRedeemPointValue')?.value)||1);
  const basis = els('loyEarnCalcBasis')?.value === 'before_tax' ? 'before tax' : 'after tax';
  const sampleSpend = 1000;
  const samplePts = Math.floor((sampleSpend / spend) * earn);
  const redeemPts = Math.min(50, samplePts || 50);
  el.innerHTML = '<div><strong>Live example</strong></div>' +
    '<div>• Earn rule: every ' + fmt(spend) + ' eligible purchase (' + basis + ') = ' + earn + ' point' + (earn===1?'':'s') + '.</div>' +
    '<div>• Sample: ' + fmt(sampleSpend) + ' eligible purchase = ' + samplePts + ' reward point' + (samplePts===1?'':'s') + '.</div>' +
    '<div>• Redeem rule: 1 point = ' + fmt(pv) + ' discount. If a customer redeems ' + redeemPts + ' points, invoice discount = ' + fmt(redeemPts * pv) + '.</div>';
}

function saveLoyaltySettingsFromForm() {
  const next = {
    enabled: !!els('loyaltyEnabledToggle')?.checked,
    earning: {
      spendAmount: Math.max(1, Number(els('loyEarnSpendAmount')?.value)||100),
      earnUnit: Math.max(1, Number(els('loyEarnUnit')?.value)||1),
      minPurchaseAmount: Math.max(0, Number(els('loyEarnMinPurchase')?.value)||0),
      minBillAmount: Math.max(0, Number(els('loyEarnMinBill')?.value)||0),
      maxPointsPerTxn: Math.max(0, Math.floor(Number(els('loyEarnMaxPoints')?.value)||0)),
      expiryDays: Math.max(0, Math.floor(Number(els('loyEarnExpiryDays')?.value)||0)),
      calcBasis: els('loyEarnCalcBasis')?.value === 'before_tax' ? 'before_tax' : 'after_tax',
      includeDiscounted: (els('loyEarnDiscounted')?.value || 'true') === 'true',
      allSales: (els('loyEarnScope')?.value || 'all') !== 'selected',
      selectedSalesOnly: (els('loyEarnScope')?.value || 'all') === 'selected'
    },
    redemption: {
      pointValue: Math.max(0.01, Number(els('loyRedeemPointValue')?.value)||1),
      minPoints: Math.max(0, Math.floor(Number(els('loyRedeemMinPoints')?.value)||0)),
      maxPercentOfInvoice: Math.min(100, Math.max(0, Number(els('loyRedeemMaxPercent')?.value)||100)),
      minInvoiceAmount: Math.max(0, Number(els('loyRedeemMinInvoice')?.value)||0),
      allowPartial: (els('loyRedeemPartial')?.value || 'true') === 'true',
      enabledAtPos: (els('loyRedeemAtPos')?.value || 'true') === 'true'
    }
  };
  saveLoyaltySettings(next);
  try { syncShoppingPointsRewardFromSettings(); } catch (e) {}
  renderLoyaltyView();
  try { renderCartTotals(); } catch(e){}
  try { renderPosRewardsPanel(); } catch(e){}
  toast('Reward rules saved', 'success');
}

function renderLoyaltyView() {
  try { setupLoyaltyUiHandlers(); } catch(e){}
  try { expireLoyaltyPoints(); } catch(e){}
  const s = getLoyaltySettings();
  if (els('loyaltyEnabledToggle')) els('loyaltyEnabledToggle').checked = !!s.enabled;
  if (els('loyaltyProgramStatusBadge')) {
    els('loyaltyProgramStatusBadge').textContent = s.enabled ? 'Program Enabled' : 'Program Disabled';
    els('loyaltyProgramStatusBadge').className = 'badge-pill ' + (s.enabled ? 'badge-green' : 'badge-gray');
  }
  if (els('loyEarnSpendAmount')) els('loyEarnSpendAmount').value = s.earning.spendAmount;
  if (els('loyEarnUnit')) els('loyEarnUnit').value = s.earning.earnUnit;
  if (els('loyEarnMinPurchase')) els('loyEarnMinPurchase').value = s.earning.minPurchaseAmount;
  if (els('loyEarnMinBill')) els('loyEarnMinBill').value = s.earning.minBillAmount;
  if (els('loyEarnMaxPoints')) els('loyEarnMaxPoints').value = s.earning.maxPointsPerTxn || '';
  if (els('loyEarnExpiryDays')) els('loyEarnExpiryDays').value = s.earning.expiryDays || '';
  if (els('loyEarnCalcBasis')) els('loyEarnCalcBasis').value = s.earning.calcBasis || 'after_tax';
  if (els('loyEarnDiscounted')) els('loyEarnDiscounted').value = s.earning.includeDiscounted ? 'true' : 'false';
  if (els('loyEarnScope')) els('loyEarnScope').value = s.earning.selectedSalesOnly ? 'selected' : 'all';
  if (els('loyRedeemPointValue')) els('loyRedeemPointValue').value = s.redemption.pointValue;
  if (els('loyRedeemMinPoints')) els('loyRedeemMinPoints').value = s.redemption.minPoints;
  if (els('loyRedeemMaxPercent')) els('loyRedeemMaxPercent').value = s.redemption.maxPercentOfInvoice;
  if (els('loyRedeemMinInvoice')) els('loyRedeemMinInvoice').value = s.redemption.minInvoiceAmount;
  if (els('loyRedeemPartial')) els('loyRedeemPartial').value = s.redemption.allowPartial ? 'true' : 'false';
  if (els('loyRedeemAtPos')) els('loyRedeemAtPos').value = s.redemption.enabledAtPos ? 'true' : 'false';
  renderLoyaltyRuleExampleFromForm();

  const stats = computeRewardStats();
  if (els('rewardStatTotal')) els('rewardStatTotal').textContent = String(stats.total);
  if (els('rewardStatActive')) els('rewardStatActive').textContent = String(stats.active);
  if (els('loyaltyStatIssued')) els('loyaltyStatIssued').textContent = String(stats.pointsIssued);
  if (els('loyaltyStatRedeemed')) els('loyaltyStatRedeemed').textContent = String(stats.pointsRedeemed);
  if (els('rewardStatTotalSub')) els('rewardStatTotalSub').textContent = stats.total ? (stats.total + ' across all categories') : 'Across all categories';
  if (els('rewardStatActiveSub')) els('rewardStatActiveSub').textContent = stats.active ? 'Currently redeemable' : 'No active rewards';

  try { renderRewardCategories(); } catch (e) {}
  try { renderRewardTable(); } catch (e) {}
  try { renderReferralDashboard(); } catch (e) {}

  const customersArr = Array.isArray(customers) ? customers : [];
  const topBody = els('loyaltyTopCustomersBody');
  if (topBody) {
    const top = customersArr.slice().map(c => { ensureCustomerLoyaltyFields(c); return c; })
      .filter(c => (Number(c.points) || 0) > 0 || (Number(c.loyaltyEarnedTotal) || 0) > 0)
      .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0) || (Number(b.loyaltyEarnedTotal) || 0) - (Number(a.loyaltyEarnedTotal) || 0))
      .slice(0, 10);
    topBody.innerHTML = top.length ? top.map(c => '<tr><td>' + escapeHtml(c.name || 'Unknown') + '</td><td>' + (Math.max(0, Math.floor(Number(c.points) || 0))) + '</td><td>' + (Math.max(0, Math.floor(Number(c.loyaltyEarnedTotal) || 0))) + '</td></tr>').join('') : '<tr><td colspan="3" class="table-empty">No loyalty data yet.</td></tr>';
  }

  const recentBody = els('loyaltyRecentActivityBody');
  if (recentBody) {
    const txns = Array.isArray(loyaltyTransactions) ? loyaltyTransactions : [];
    const recent = txns.slice(0, 25);
    recentBody.innerHTML = recent.length ? recent.map(t => {
      const c = customersArr.find(x => x.id === t.customerId);
      const ref = t.rewardName || t.invNo || t.invoiceNo || t.referralId || '—';
      const value = Number(t.monetaryValue) > 0 ? fmt(t.monetaryValue) : '—';
      return '<tr><td>' + escapeHtml(t.date || '') + '</td><td>' + escapeHtml(c ? c.name : (t.customerName || 'Unknown')) + '</td><td>' + escapeHtml(ref) + '</td><td>' + escapeHtml(loyaltyTxnTypeLabel(t.type)) + '</td><td>' + (Number(t.points) || 0) + '</td><td>' + value + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="table-empty">No loyalty transactions yet.</td></tr>';
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════════════
// POINTS & REWARDS — four-category engine (additive)
//   1. Shopping Points   2. Free Product
//   3. Offer Product     4. Share & Earn
// Reward definitions live in `rewardConfigs`; every point/reward movement
// is written to the append-only `loyaltyTransactions` ledger with an
// idempotency key so a retried operation can never double-issue.
// ═══════════════════════════════════════════════════════════════════

const REWARD_TYPES = {
  shopping_points: {
    label: 'Shopping Points',
    description: 'Customers earn points on every eligible purchase and redeem them for discounts.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
  },
  free_product: {
    label: 'Free Product',
    description: 'Customers redeem accumulated points for a specific product from your catalogue.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>'
  },
  offer_product: {
    label: 'Offer Product',
    description: 'Give a free product when the cart meets a product-quantity or minimum-spend condition.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v8H4v-8"/><path d="M2 7h20v5H2zM12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>'
  },
  share_earn: {
    label: 'Share & Earn',
    description: 'Reward customers for referring new customers with a unique referral code.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>'
  }
};

const REWARD_TYPE_ORDER = ['shopping_points', 'free_product', 'offer_product', 'share_earn'];

const REWARD_FEATURE_MAP = {
  module: 'rewards',
  shopping_points: 'rewards_shopping_points',
  free_product: 'rewards_free_product',
  offer_product: 'rewards_offer_product',
  share_earn: 'rewards_share_earn',
  referral_monetary: 'rewards_referral_monetary',
  referral_inventory_boost: 'rewards_referral_inventory_boost',
  referral_usage_boost: 'rewards_referral_usage_boost'
};

// Plan entitlements are resolved by the existing SaaS layer. Offline / not-ready
// mode intentionally returns true so a shop can keep billing without a network.
function rewardsPlanAllows(kind) {
  const key = REWARD_FEATURE_MAP[kind] || kind;
  try {
    if (window.HisaabSaaS && typeof window.HisaabSaaS.hasFeature === 'function') {
      return window.HisaabSaaS.hasFeature(key) !== false;
    }
  } catch (e) { /* treat as allowed */ }
  return true;
}

function rewardsGuard(kind, label) {
  if (rewardsPlanAllows(kind)) return true;
  const key = REWARD_FEATURE_MAP[kind] || kind;
  try {
    if (window.HisaabSaaS && typeof window.HisaabSaaS.openUpgrade === 'function') {
      window.HisaabSaaS.openUpgrade(key, label || (REWARD_TYPES[kind] ? REWARD_TYPES[kind].label : 'This reward feature'));
    } else {
      toast((label || 'This reward feature') + ' is not included in your plan.', 'warning');
    }
  } catch (e) {}
  return false;
}

function rewardTypeLabel(type) {
  return (REWARD_TYPES[type] && REWARD_TYPES[type].label) || 'Reward';
}

function rewardTodayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseRewardDate(value, endOfDay) {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + (endOfDay ? 'T23:59:59' : 'T00:00:00'));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function formatRewardDate(value) {
  const t = parseRewardDate(value, false);
  if (t == null) return '';
  try { return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return value; }
}

// ─── Reward configuration store ─────────────────────────────────────
function normalizeRewardConfig(r) {
  if (!r || !r.id || !REWARD_TYPES[r.type]) return null;
  const type = r.type;
  const c = (r.config && typeof r.config === 'object') ? r.config : {};
  const out = {
    id: String(r.id),
    type: type,
    name: String(r.name || REWARD_TYPES[type].label).trim().slice(0, 80) || REWARD_TYPES[type].label,
    status: r.status === 'active' ? 'active' : 'inactive',
    createdAt: Number(r.createdAt) || Date.now(),
    updatedAt: Number(r.updatedAt) || Date.now(),
    createdBy: r.createdBy ? String(r.createdBy) : '',
    config: {}
  };
  if (type === 'shopping_points') {
    out.config = {
      earnSpend: Math.max(1, Number(c.earnSpend) || 100),
      earnPoints: Math.max(1, Math.floor(Number(c.earnPoints) || 1)),
      minPurchase: Math.max(0, Number(c.minPurchase) || 0),
      maxPointsPerTxn: Math.max(0, Math.floor(Number(c.maxPointsPerTxn) || 0)),
      minInvoiceAmount: Math.max(0, Number(c.minInvoiceAmount) || 0),
      pointValue: Math.max(0.01, Number(c.pointValue) || 1),
      expiryDays: Math.max(0, Math.floor(Number(c.expiryDays) || 0)),
      redemptionEnabled: c.redemptionEnabled !== false,
      maxRedeemPointsPerInvoice: Math.max(0, Math.floor(Number(c.maxRedeemPointsPerInvoice) || 0)),
      maxPercentOfInvoice: Math.min(100, Math.max(1, Math.floor(Number(c.maxPercentOfInvoice == null || c.maxPercentOfInvoice === '' ? 100 : c.maxPercentOfInvoice))))
    };
  } else if (type === 'free_product') {
    out.config = {
      productId: c.productId ? String(c.productId) : '',
      quantity: Math.max(1, Math.floor(Number(c.quantity) || 1)),
      pointsRequired: Math.max(1, Math.floor(Number(c.pointsRequired) || 1)),
      validFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(c.validFrom || '')) ? String(c.validFrom) : '',
      validTo: /^\d{4}-\d{2}-\d{2}$/.test(String(c.validTo || '')) ? String(c.validTo) : '',
      maxRedemptions: Math.max(0, Math.floor(Number(c.maxRedemptions) || 0)),
      customerType: c.customerType ? String(c.customerType).slice(0, 40) : ''
    };
  } else if (type === 'offer_product') {
    out.config = {
      mode: c.mode === 'min_spend' ? 'min_spend' : 'buy_products',
      buyItems: Array.isArray(c.buyItems) ? c.buyItems.map(b => ({
        productId: b && b.productId ? String(b.productId) : '',
        qty: Math.max(1, Math.floor(Number(b && b.qty) || 1))
      })).filter(b => b.productId).slice(0, 12) : [],
      minSpend: Math.max(0, Number(c.minSpend) || 0),
      freeProductId: c.freeProductId ? String(c.freeProductId) : '',
      freeQty: Math.max(1, Math.floor(Number(c.freeQty) || 1)),
      validFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(c.validFrom || '')) ? String(c.validFrom) : '',
      validTo: /^\d{4}-\d{2}-\d{2}$/.test(String(c.validTo || '')) ? String(c.validTo) : '',
      maxUsage: Math.max(0, Math.floor(Number(c.maxUsage) || 0))
    };
  } else {
    out.config = {
      description: String(c.description || '').slice(0, 300),
      rewardOption: c.rewardOption === 'limit_boost' ? 'limit_boost' : 'monetary',
      monetaryAmount: Math.max(1, Number(c.monetaryAmount) || 100),
      inventoryBoost: Math.max(0, Math.floor(Number(c.inventoryBoost) || 0)),
      usageBoost: Math.max(0, Math.floor(Number(c.usageBoost) || 0)),
      qualifyMinSpend: Math.max(0, Number(c.qualifyMinSpend) || 0),
      validFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(c.validFrom || '')) ? String(c.validFrom) : '',
      validTo: /^\d{4}-\d{2}-\d{2}$/.test(String(c.validTo || '')) ? String(c.validTo) : '',
      enabled: c.enabled !== false
    };
  }
  return out;
}

function ensureRewardConfigs() {
  if (!Array.isArray(rewardConfigs)) rewardConfigs = [];
  const next = rewardConfigs.map(normalizeRewardConfig).filter(Boolean);
  // De-duplicate by id, keeping the newest record.
  const seen = new Set();
  rewardConfigs = next.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  return rewardConfigs;
}

function saveRewardConfigStore() {
  DB.set('rewardConfigs', rewardConfigs);
}

function rewardById(id) {
  ensureRewardConfigs();
  return rewardConfigs.find(r => r.id === id) || null;
}

function rewardIsValidNow(r) {
  if (!r) return false;
  if (r.status !== 'active') return false;
  const c = r.config || {};
  if (r.type === 'free_product' || r.type === 'offer_product' || r.type === 'share_earn') {
    const from = parseRewardDate(c.validFrom, false);
    const to = parseRewardDate(c.validTo, true);
    const nowTs = Date.now();
    if (from != null && nowTs < from) return false;
    if (to != null && nowTs > to) return false;
  }
  return true;
}

function rewardValidityLabel(r) {
  if (!r) return '—';
  const c = r.config || {};
  if (r.type === 'shopping_points') {
    return Number(c.expiryDays) > 0 ? ('Points expire in ' + c.expiryDays + ' days') : 'Points never expire';
  }
  const from = formatRewardDate(c.validFrom);
  const to = formatRewardDate(c.validTo);
  if (from && to) return from + ' – ' + to;
  if (to) return 'Until ' + to;
  if (from) return 'From ' + from;
  return 'Always valid';
}

function rewardUsageCount(rewardId) {
  const txns = Array.isArray(loyaltyTransactions) ? loyaltyTransactions : [];
  return txns.filter(t => t && t.rewardId === rewardId && (t.type === 'reward_redeemed' || t.type === 'reward_applied') && t.status !== 'reversed' && t.status !== 'cancelled').length;
}

function rewardRemainingUsage(r) {
  const max = Math.max(0, Math.floor(Number(r && r.config && r.config.maxRedemptions != null ? r.config.maxRedemptions : (r && r.config && r.config.maxUsage)) || 0));
  if (max <= 0) return null;
  return Math.max(0, max - rewardUsageCount(r.id));
}

function rewardProductById(id) {
  return (Array.isArray(products) ? products : []).find(p => p && (p.id === id || p.barcode === id || p.sku === id)) || null;
}

function rewardProductLabel(id) {
  const p = rewardProductById(id);
  return p ? p.name : 'Product not found';
}

function rewardProductThumb(p) {
  if (p && p.image) return '<img src="' + escapeHtml(p.image) + '" class="rw-product-thumb" alt="" />';
  return '<span class="rw-product-thumb">' + escapeHtml((p && p.emoji) || '📦') + '</span>';
}

function computeRewardStats() {
  ensureRewardConfigs();
  const list = rewardConfigs;
  const txns = Array.isArray(loyaltyTransactions) ? loyaltyTransactions : [];
  let issued = 0, redeemed = 0;
  txns.forEach(t => {
    if (!t) return;
    const pts = Math.abs(Number(t.points) || 0);
    if (t.type === 'earned') issued += pts;
    else if (t.type === 'redeemed' || t.type === 'reward_redeemed') redeemed += pts;
    else if (t.type === 'expired') redeemed += 0;
    else if (t.type === 'adjusted') { if ((Number(t.points) || 0) > 0) issued += pts; else redeemed += pts; }
  });
  return {
    total: list.length,
    active: list.filter(r => r.status === 'active').length,
    pointsIssued: issued,
    pointsRedeemed: redeemed
  };
}

// ─── Category cards (removed from UI; kept as safe no-op) ───────────
function renderRewardCategories() {
  const grid = els('rewardCategoryGrid');
  if (!grid) return;
  grid.innerHTML = '';
}

// ─── Reward table, search, filter and pagination ────────────────────
const rewardTableState = { page: 1, pageSize: 10 };

function rewardFilteredList() {
  ensureRewardConfigs();
  const q = String((els('rewardSearchInput') && els('rewardSearchInput').value) || '').trim().toLowerCase();
  const type = String((els('rewardTypeFilter') && els('rewardTypeFilter').value) || '');
  const status = String((els('rewardStatusFilter') && els('rewardStatusFilter').value) || '');
  return rewardConfigs
    .filter(r => !type || r.type === type)
    .filter(r => !status || r.status === status)
    .filter(r => {
      if (!q) return true;
      const hay = [r.name, rewardTypeLabel(r.type), rewardDetailsText(r)].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    })
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
}

function rewardDetailsText(r) {
  if (!r) return '';
  const c = r.config || {};
  if (r.type === 'shopping_points') {
    return fmt(c.earnSpend) + ' spend = ' + c.earnPoints + ' pt' + (c.earnPoints === 1 ? '' : 's') + (c.minPurchase > 0 ? ' · Min purchase ' + fmt(c.minPurchase) : '');
  }
  if (r.type === 'free_product') {
    return rewardProductLabel(c.productId) + ' × ' + c.quantity + (c.customerType ? ' · ' + c.customerType : '');
  }
  if (r.type === 'offer_product') {
    const free = rewardProductLabel(c.freeProductId) + ' × ' + c.freeQty;
    if (c.mode === 'min_spend') return 'Spend ' + fmt(c.minSpend) + ' → ' + free;
    const buys = (c.buyItems || []).map(b => rewardProductLabel(b.productId) + ' × ' + b.qty).join(' + ');
    return (buys || 'Select products') + ' → ' + free;
  }
  if (c.rewardOption === 'limit_boost') {
    const bits = [];
    if (Number(c.inventoryBoost) > 0) bits.push('+' + c.inventoryBoost + ' products');
    if (Number(c.usageBoost) > 0) bits.push('+' + c.usageBoost + ' bills');
    return 'One-time limit boost' + (bits.length ? ' · ' + bits.join(' · ') : '');
  }
  return fmt(c.monetaryAmount) + ' per successful referral';
}

function rewardPointsCell(r) {
  const c = r.config || {};
  if (r.type === 'shopping_points') return c.minInvoiceAmount > 0 ? ('Min bill ' + fmt(c.minInvoiceAmount)) : '—';
  if (r.type === 'free_product') return String(c.pointsRequired) + ' pts';
  return '—';
}

function rewardStatusBadge(r) {
  return '<span class="badge-pill ' + (r.status === 'active' ? 'badge-green' : 'badge-gray') + '">' + (r.status === 'active' ? 'Active' : 'Inactive') + '</span>';
}

function rewardActionButtons(r) {
  const id = String(r.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const view = '<button type="button" class="icon-btn" title="View" aria-label="View" onclick="viewReward(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>';
  const edit = '<button type="button" class="icon-btn" title="Edit" aria-label="Edit" onclick="openRewardModal(\'' + r.type + '\',\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>';
  const dup = '<button type="button" class="icon-btn" title="Duplicate" aria-label="Duplicate" onclick="duplicateReward(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>';
  const toggleLabel = r.status === 'active' ? 'Deactivate' : 'Activate';
  const toggle = '<button type="button" class="icon-btn" title="' + toggleLabel + '" aria-label="' + toggleLabel + '" onclick="toggleRewardStatus(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.72 0"/><path d="M12 2v10"/></svg></button>';
  const del = '<button type="button" class="icon-btn danger" title="Delete" aria-label="Delete" onclick="deleteReward(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg></button>';
  return view + edit + dup + toggle + del;
}

function renderRewardTable() {
  const body = els('rewardsBody');
  if (!body) return;
  const list = rewardFilteredList();
  const pageSize = Math.max(1, Number(rewardTableState.pageSize) || 10);
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  if (rewardTableState.page > pages) rewardTableState.page = pages;
  if (rewardTableState.page < 1) rewardTableState.page = 1;
  const start = (rewardTableState.page - 1) * pageSize;
  const rows = list.slice(start, start + pageSize);

  body.innerHTML = rows.length ? rows.map(r => {
    const c = r.config || {};
    let sub = '';
    if (r.type === 'free_product') {
      const p = rewardProductById(c.productId);
      sub = p ? ('Stock ' + (Number(p.stock) || 0) + ' · ' + (p.sku || 'No SKU')) : 'Product missing';
    } else if (r.type === 'offer_product') {
      sub = c.maxUsage > 0 ? ('Used ' + rewardUsageCount(r.id) + ' / ' + c.maxUsage) : 'No usage limit';
    } else if (r.type === 'shopping_points') {
      sub = '1 pt = ' + fmt(c.pointValue);
    } else {
      sub = c.rewardOption === 'limit_boost' ? 'One-time benefit' : 'Referral reward';
    }
    return '<tr>' +
      '<td><div class="rw-name">' + escapeHtml(r.name) + '</div><div class="rw-sub">' + escapeHtml(sub) + '</div></td>' +
      '<td><span class="rw-type-badge"><span class="rw-type-dot"></span>' + escapeHtml(rewardTypeLabel(r.type)) + '</span></td>' +
      '<td>' + escapeHtml(rewardDetailsText(r)) + '</td>' +
      '<td>' + escapeHtml(rewardPointsCell(r)) + '</td>' +
      '<td>' + escapeHtml(rewardValidityLabel(r)) + '</td>' +
      '<td>' + rewardStatusBadge(r) + '</td>' +
      '<td><div class="rw-actions">' + rewardActionButtons(r) + '</div></td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="7" class="table-empty">No rewards match the current search or filter.</td></tr>';

  const info = els('rewardPageInfo');
  if (info) info.textContent = list.length ? ('Showing ' + (start + 1) + '–' + Math.min(list.length, start + pageSize) + ' of ' + list.length + ' rewards') : '0 rewards';
  const prev = els('rewardPrevBtn');
  const next = els('rewardNextBtn');
  if (prev) { prev.disabled = rewardTableState.page <= 1; }
  if (next) { next.disabled = rewardTableState.page >= pages; }
}

function changeRewardPage(delta) {
  rewardTableState.page = Math.max(1, (Number(rewardTableState.page) || 1) + Number(delta || 0));
  renderRewardTable();
}

// ─── Reward create / edit modal ─────────────────────────────────────
let __rewardDraft = { id: null, type: null };

function rewardProductOptions(selectedId, placeholder) {
  const list = Array.isArray(products) ? products : [];
  const head = '<option value="">' + escapeHtml(placeholder || 'Select a product') + '</option>';
  return head + list.map(p => {
    const stock = Number(p.stock) || 0;
    return '<option value="' + escapeHtml(p.id) + '"' + (p.id === selectedId ? ' selected' : '') + '>' +
      escapeHtml(p.name) + ' · ' + stock + ' in stock' + (p.sku ? ' · ' + escapeHtml(p.sku) : '') + '</option>';
  }).join('');
}

function rewardCustomerTypeOptions(selected) {
  const types = Array.from(new Set(['Retail', 'Wholesale', 'Regular', 'VIP']
    .concat((Array.isArray(customers) ? customers : []).map(c => (c && c.customerType) || '').filter(Boolean))));
  return '<option value="">All customer types</option>' + types.map(t =>
    '<option value="' + escapeHtml(t) + '"' + (t === selected ? ' selected' : '') + '>' + escapeHtml(t) + '</option>'
  ).join('');
}

function ensureRewardModal() {
  let overlay = document.getElementById('rewardModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'rewardModalOverlay';
    overlay.className = 'modal-overlay hidden rw-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeRewardModal(); });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function closeRewardModal() {
  const overlay = document.getElementById('rewardModalOverlay');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
  __rewardDraft = { id: null, type: null };
}

function rewardModalMeta(type) {
  const base = REWARD_TYPES[type] || {};
  const accents = {
    shopping_points: { tone: 'violet', accent: '#7c3aed', soft: '#f3e8ff', label: 'Earn & redeem points' },
    free_product: { tone: 'emerald', accent: '#059669', soft: '#ecfdf5', label: 'Redeem points for products' },
    offer_product: { tone: 'amber', accent: '#d97706', soft: '#fffbeb', label: 'Cart-based free offers' },
    share_earn: { tone: 'blue', accent: '#2563eb', soft: '#eff6ff', label: 'Referrals & rewards' }
  };
  const a = accents[type] || { tone: 'violet', accent: '#7c3aed', soft: '#f3e8ff', label: '' };
  return {
    type: type || '',
    label: base.label || 'Reward',
    description: base.description || '',
    icon: base.icon || '',
    accent: a.accent,
    soft: a.soft,
    tone: a.tone,
    hint: a.label
  };
}

function rewardModalShell(opts) {
  const meta = opts.meta || rewardModalMeta(opts.type);
  const size = opts.size || 'modal-lg';
  const subtitle = opts.subtitle || meta.description || '';
  const pill = opts.pill || (meta.label ? '<span class="rw-hero-pill">' + escapeHtml(meta.label) + '</span>' : '');
  return '<div class="modal ' + size + ' rw-reward-modal rw-tone-' + escapeHtml(meta.tone || 'violet') + '">' +
    '<div class="rw-modal-hero">' +
      '<div class="rw-hero-icon">' + (meta.icon || '') + '</div>' +
      '<div class="rw-hero-copy">' +
        pill +
        '<h3>' + escapeHtml(opts.title || meta.label || 'Reward') + '</h3>' +
        (subtitle ? '<p>' + escapeHtml(subtitle) + '</p>' : '') +
      '</div>' +
      '<button type="button" class="modal-close rw-hero-close" onclick="' + (opts.onClose || 'closeRewardModal()') + '" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="modal-body rw-modal-body">' + (opts.body || '') + '</div>' +
    (opts.footer ? '<div class="rw-modal-footer">' + opts.footer + '</div>' : '') +
  '</div>';
}

function openRewardTypeChooser(presetType) {
  if (!rewardsGuard('module', 'Points & Rewards')) return;
  if (presetType) {
    if (!REWARD_TYPES[presetType]) return;
    if (!rewardsGuard(presetType, rewardTypeLabel(presetType))) return;
    let existingId = null;
    if (presetType === 'shopping_points') {
      ensureRewardConfigs();
      const existing = rewardConfigs.find(r => r.type === 'shopping_points');
      existingId = existing ? existing.id : null;
    }
    openRewardModal(presetType, existingId);
    return;
  }
  const overlay = ensureRewardModal();
  const body =
    '<div class="rw-chooser-head"><div class="rw-chooser-eyebrow">Select a category</div><div class="rw-chooser-sub">Choose one of the four reward types. Each is designed for a different customer incentive.</div></div>' +
    '<div class="rw-chooser-grid">' +
      REWARD_TYPE_ORDER.map(type => {
        const meta = rewardModalMeta(type);
        const allowed = rewardsPlanAllows(type);
        const onclick = allowed
          ? 'closeRewardModal();openRewardModal(\'' + type + '\')'
          : 'rewardsGuard(\'' + type + '\',\'' + escapeHtml(meta.label) + '\')';
        return '<button type="button" class="rw-choice-card rw-tone-' + meta.tone + (allowed ? '' : ' is-locked') + '" onclick="' + onclick + '">' +
          '<span class="rw-choice-icon">' + meta.icon + '</span>' +
          '<span class="rw-choice-body">' +
            '<span class="rw-choice-title">' + escapeHtml(meta.label) + (allowed ? '' : ' <span class="rw-lock-pill">Upgrade</span>') + '</span>' +
            '<span class="rw-choice-desc">' + escapeHtml(meta.description) + '</span>' +
            '<span class="rw-choice-hint">' + escapeHtml(meta.hint) + '</span>' +
          '</span>' +
          '<span class="rw-choice-arrow" aria-hidden="true">→</span>' +
        '</button>';
      }).join('') +
    '</div>';

  overlay.innerHTML = rewardModalShell({
    meta: { tone: 'violet', accent: '#7c3aed', soft: '#f3e8ff', icon: REWARD_TYPES.shopping_points.icon, label: 'New Reward' },
    title: 'Create Reward',
    subtitle: 'Build a loyalty experience with points, free products, offers, or referrals.',
    pill: '<span class="rw-hero-pill">4 reward categories</span>',
    size: 'modal-lg',
    body: body,
    footer: '<button type="button" class="btn btn-ghost" onclick="closeRewardModal()">Cancel</button>'
  });
  overlay.classList.remove('hidden');
}

function openRewardModal(type, id) {
  if (!REWARD_TYPES[type]) return;
  ensureRewardConfigs();
  let record = id ? rewardById(id) : null;
  if (type === 'shopping_points' && !record) {
    record = rewardConfigs.find(r => r.type === 'shopping_points') || null;
  }
  if (!record && !rewardsGuard(type, rewardTypeLabel(type))) return;
  if (record && record.type !== type) type = record.type;
  __rewardDraft = { id: record ? record.id : null, type: type };

  const c = record ? record.config : {};
  const isEdit = !!record;
  const title = (isEdit ? 'Edit ' : 'Create ') + rewardTypeLabel(type);
  let fields = '';

  if (type === 'shopping_points') {
    fields =
      '<div class="rw-subsection">' +
        '<div class="rw-subsection-head"><span class="rw-subsection-icon">⚙</span><div><div class="rw-subsection-title">General</div><div class="rw-subsection-sub">Name and status for this points rule.</div></div></div>' +
        '<div class="rw-modal-grid">' +
          '<div class="form-group span-2"><label>Reward Name</label><input type="text" id="rwName" class="form-input" maxlength="80" value="' + escapeHtml(record ? record.name : 'Shopping Points') + '" /></div>' +
          '<div class="form-group"><label>Status</label><select id="rwStatus" class="form-input"><option value="active"' + (!record || record.status === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (record && record.status === 'inactive' ? ' selected' : '') + '>Inactive</option></select></div>' +
        '</div>' +
      '</div>' +
      '<div class="rw-subsection rw-subsection-earn">' +
        '<div class="rw-subsection-head"><span class="rw-subsection-icon">★</span><div><div class="rw-subsection-title">Earning Setup (Reward)</div><div class="rw-subsection-sub">Configure how customers earn points on purchases.</div></div><span class="rw-subsection-pill">Earn</span></div>' +
        '<div class="rw-modal-grid">' +
          '<div class="form-group"><label>Spend Amount (₹)</label><input type="number" id="rwEarnSpend" class="form-input" min="1" step="1" value="' + (Number(c.earnSpend) || 100) + '" /></div>' +
          '<div class="form-group"><label>Points Earned</label><input type="number" id="rwEarnPoints" class="form-input" min="1" step="1" value="' + (Number(c.earnPoints) || 1) + '" /></div>' +
          '<div class="form-group"><label>Minimum Purchase to Earn (₹)</label><input type="number" id="rwMinPurchase" class="form-input" min="0" step="0.01" value="' + (Number(c.minPurchase) || 0) + '" /></div>' +
          '<div class="form-group"><label>Max Points per Transaction</label><input type="number" id="rwMaxPoints" class="form-input" min="0" step="1" placeholder="No limit" value="' + (Number(c.maxPointsPerTxn) || '') + '" /></div>' +
          '<div class="form-group"><label>Point Expiry (days)</label><input type="number" id="rwExpiryDays" class="form-input" min="0" step="1" placeholder="Never expires" value="' + (Number(c.expiryDays) || '') + '" /></div>' +
        '</div>' +
      '</div>' +
      '<div class="rw-subsection rw-subsection-redeem">' +
        '<div class="rw-subsection-head"><span class="rw-subsection-icon">⇄</span><div><div class="rw-subsection-title">Redemption Setup</div><div class="rw-subsection-sub">Configure how customers redeem points at POS.</div></div><span class="rw-subsection-pill">Redeem</span></div>' +
        '<div class="rw-modal-grid">' +
          '<div class="form-group"><label>Minimum Invoice Amount to Redeem (₹)</label><input type="number" id="rwMinInvoice" class="form-input" min="0" step="0.01" value="' + (Number(c.minInvoiceAmount) || 0) + '" /><small class="rw-field-help">Redemption stays blocked on invoices below this amount. Set 0 for no minimum.</small></div>' +
          '<div class="form-group"><label>Maximum Points Redeemable Per Invoice</label><input type="number" id="rwMaxRedeemPerInvoice" class="form-input" min="1" step="1" placeholder="Unlimited" value="' + (Number(c.maxRedeemPointsPerInvoice) > 0 ? Number(c.maxRedeemPointsPerInvoice) : '') + '" /><small class="rw-field-help">Set the maximum number of shopping points a customer can use in a single invoice. Leave blank for unlimited.</small></div>' +
          '<div class="form-group"><label>Maximum Bill Amount Redeemable (%)</label><input type="number" id="rwMaxBillPercent" class="form-input" min="1" max="100" step="1" value="' + Math.min(100, Math.max(1, Math.floor(Number(c.maxPercentOfInvoice == null ? 100 : c.maxPercentOfInvoice)))) + '" /><small class="rw-field-help">Limit the percentage of an invoice that customers can pay using shopping points.</small></div>' +
          '<div class="form-group"><label>1 Point Value (₹ discount)</label><input type="number" id="rwPointValue" class="form-input" min="0.01" step="0.01" value="' + (Number(c.pointValue) || 1) + '" /></div>' +
          '<div class="form-group"><label>Enable Redemption at POS</label><select id="rwRedemptionEnabled" class="form-input"><option value="true"' + (c.redemptionEnabled !== false ? ' selected' : '') + '>Enabled</option><option value="false"' + (c.redemptionEnabled === false ? ' selected' : '') + '>Disabled</option></select></div>' +
        '</div>' +
      '</div>' +
      '<p class="rw-modal-hint">Only one Shopping Points rule can exist. Earning settings control how points are rewarded; redemption settings control how points are used at billing.</p>';
  } else if (type === 'free_product') {
    fields =
      '<div class="rw-modal-grid">' +
        '<div class="form-group span-2"><label>Reward Name</label><input type="text" id="rwName" class="form-input" maxlength="80" value="' + escapeHtml(record ? record.name : 'Free Product Reward') + '" /></div>' +
        '<div class="form-group span-2"><label>Select Product (from inventory)</label><select id="rwProductId" class="form-input">' + rewardProductOptions(c.productId || '', 'Select a product') + '</select></div>' +
        '<div class="form-group"><label>Required Points</label><input type="number" id="rwPointsRequired" class="form-input" min="1" step="1" value="' + (Number(c.pointsRequired) || 100) + '" /></div>' +
        '<div class="form-group"><label>Reward Quantity</label><input type="number" id="rwQuantity" class="form-input" min="1" step="1" value="' + (Number(c.quantity) || 1) + '" /></div>' +
        '<div class="form-group"><label>Valid From</label><input type="date" id="rwValidFrom" class="form-input" value="' + escapeHtml(c.validFrom || '') + '" /></div>' +
        '<div class="form-group"><label>Valid Until</label><input type="date" id="rwValidTo" class="form-input" value="' + escapeHtml(c.validTo || '') + '" /></div>' +
        '<div class="form-group"><label>Maximum Redemptions</label><input type="number" id="rwMaxRedemptions" class="form-input" min="0" step="1" placeholder="No limit" value="' + (Number(c.maxRedemptions) || '') + '" /></div>' +
        '<div class="form-group"><label>Applicable Customer Type</label><select id="rwCustomerType" class="form-input">' + rewardCustomerTypeOptions(c.customerType || '') + '</select></div>' +
        '<div class="form-group"><label>Status</label><select id="rwStatus" class="form-input"><option value="active"' + (!record || record.status === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (record && record.status === 'inactive' ? ' selected' : '') + '>Inactive</option></select></div>' +
      '</div>' +
      '<p class="rw-modal-hint">The free item is added to the POS cart at zero value, stock is deducted through the normal sale flow, and points are deducted only after the bill is completed.</p>';
  } else if (type === 'offer_product') {
    const mode = c.mode === 'min_spend' ? 'min_spend' : 'buy_products';
    const buyItems = Array.isArray(c.buyItems) && c.buyItems.length ? c.buyItems : [{ productId: '', qty: 1 }];
    fields =
      '<div class="rw-modal-grid">' +
        '<div class="form-group span-2"><label>Reward Name</label><input type="text" id="rwName" class="form-input" maxlength="80" value="' + escapeHtml(record ? record.name : 'Offer Product Reward') + '" /></div>' +
        '<div class="form-group span-2"><label>Offer Condition</label>' +
          '<div class="rw-choice-row">' +
            '<button type="button" class="rw-choice' + (mode === 'buy_products' ? ' active' : '') + '" id="rwModeBuy" onclick="setOfferMode(\'buy_products\')"><strong>Buy products</strong><span>Buy selected products and quantities, get a free product.</span></button>' +
            '<button type="button" class="rw-choice' + (mode === 'min_spend' ? ' active' : '') + '" id="rwModeSpend" onclick="setOfferMode(\'min_spend\')"><strong>Minimum spend</strong><span>Spend a set amount, get a free product.</span></button>' +
          '</div>' +
          '<input type="hidden" id="rwOfferMode" value="' + mode + '" />' +
        '</div>' +
        '<div class="form-group span-2' + (mode === 'min_spend' ? ' hidden' : '') + '" id="rwBuyItemsWrap"><label>Qualifying Products</label><div class="rw-pill-list" id="rwBuyItems">' + buyItems.map((b, i) => offerBuyRowHtml(b, i)).join('') + '</div><button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px;align-self:flex-start;" onclick="addOfferBuyRow()">+ Add product</button></div>' +
        '<div class="form-group' + (mode === 'min_spend' ? '' : ' hidden') + '" id="rwMinSpendWrap"><label>Minimum Purchase Amount (₹)</label><input type="number" id="rwMinSpend" class="form-input" min="0" step="0.01" value="' + (Number(c.minSpend) || 0) + '" /></div>' +
        '<div class="form-group span-2"><label>Free Product</label><select id="rwFreeProductId" class="form-input">' + rewardProductOptions(c.freeProductId || '', 'Select the free product') + '</select></div>' +
        '<div class="form-group"><label>Free Quantity</label><input type="number" id="rwFreeQty" class="form-input" min="1" step="1" value="' + (Number(c.freeQty) || 1) + '" /></div>' +
        '<div class="form-group"><label>Maximum Usage</label><input type="number" id="rwMaxUsage" class="form-input" min="0" step="1" placeholder="No limit" value="' + (Number(c.maxUsage) || '') + '" /></div>' +
        '<div class="form-group"><label>Valid From</label><input type="date" id="rwValidFrom" class="form-input" value="' + escapeHtml(c.validFrom || '') + '" /></div>' +
        '<div class="form-group"><label>Valid Until</label><input type="date" id="rwValidTo" class="form-input" value="' + escapeHtml(c.validTo || '') + '" /></div>' +
        '<div class="form-group"><label>Status</label><select id="rwStatus" class="form-input"><option value="active"' + (!record || record.status === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (record && record.status === 'inactive' ? ' selected' : '') + '>Inactive</option></select></div>' +
      '</div>' +
      '<p class="rw-modal-hint">Eligibility is re-validated at billing. The same offer can only be applied once per bill and usage limits are enforced from the reward ledger.</p>';
  } else {
    const opt = c.rewardOption === 'limit_boost' ? 'limit_boost' : 'monetary';
    fields =
      '<div class="rw-modal-grid">' +
        '<div class="form-group span-2"><label>Reward Name</label><input type="text" id="rwName" class="form-input" maxlength="80" value="' + escapeHtml(record ? record.name : 'Refer & Earn') + '" /></div>' +
        '<div class="form-group span-2"><label>Referral Reward Description</label><textarea id="rwDescription" class="form-input" rows="2" maxlength="300" placeholder="e.g. Invite a friend and earn ₹100 when they make their first purchase.">' + escapeHtml(c.description || '') + '</textarea></div>' +
        '<div class="form-group"><label>Reward Option</label><select id="rwRewardOption" class="form-input" onchange="setReferralRewardOption(this.value)"><option value="monetary"' + (opt === 'monetary' ? ' selected' : '') + '>Fixed ₹ amount</option><option value="limit_boost"' + (opt === 'limit_boost' ? ' selected' : '') + '>Subscription limit increase</option></select></div>' +
        '<div class="form-group"><label>Qualifying First Purchase (₹)</label><input type="number" id="rwQualifyMinSpend" class="form-input" min="0" step="0.01" value="' + (Number(c.qualifyMinSpend) || 0) + '" /></div>' +
        '<div class="form-group' + (opt === 'monetary' ? '' : ' hidden') + '" id="rwMonetaryWrap"><label>Reward Amount (₹)</label><input type="number" id="rwMonetaryAmount" class="form-input" min="1" step="0.01" value="' + (Number(c.monetaryAmount) || 100) + '" /></div>' +
        '<div class="form-group' + (opt === 'limit_boost' ? '' : ' hidden') + '" id="rwInventoryWrap"><label>Additional Inventory Items</label><input type="number" id="rwInventoryBoost" class="form-input" min="0" step="1" value="' + (Number(c.inventoryBoost) || 500) + '" /></div>' +
        '<div class="form-group' + (opt === 'limit_boost' ? '' : ' hidden') + '" id="rwUsageWrap"><label>Additional Monthly Bills</label><input type="number" id="rwUsageBoost" class="form-input" min="0" step="1" value="' + (Number(c.usageBoost) || 1000) + '" /></div>' +
        '<div class="form-group"><label>Valid From</label><input type="date" id="rwValidFrom" class="form-input" value="' + escapeHtml(c.validFrom || '') + '" /></div>' +
        '<div class="form-group"><label>Valid Until</label><input type="date" id="rwValidTo" class="form-input" value="' + escapeHtml(c.validTo || '') + '" /></div>' +
        '<div class="form-group"><label>Referral Program</label><select id="rwReferralEnabled" class="form-input"><option value="true"' + (c.enabled !== false ? ' selected' : '') + '>Enabled</option><option value="false"' + (c.enabled === false ? ' selected' : '') + '>Disabled</option></select></div>' +
        '<div class="form-group"><label>Status</label><select id="rwStatus" class="form-input"><option value="active"' + (!record || record.status === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (record && record.status === 'inactive' ? ' selected' : '') + '>Inactive</option></select></div>' +
      '</div>' +
      '<p class="rw-modal-hint"><strong>One-time benefit:</strong> subscription limit increases are granted once per eligible referral and never repeat monthly. A referral only qualifies after the new customer completes a qualifying purchase.</p>';
  }

  const meta = rewardModalMeta(type);
  const sectionTitle = isEdit ? 'Update configuration' : 'Reward configuration';
  const body =
    '<div class="rw-form-section">' +
      '<div class="rw-form-section-head"><span class="rw-form-section-title">' + escapeHtml(sectionTitle) + '</span><span class="rw-form-section-badge">' + escapeHtml(meta.hint || meta.label) + '</span></div>' +
      fields +
    '</div>';

  const overlay = ensureRewardModal();
  overlay.innerHTML = rewardModalShell({
    meta: meta,
    type: type,
    title: title,
    subtitle: meta.description,
    pill: '<span class="rw-hero-pill">' + escapeHtml(isEdit ? 'Editing' : 'New') + ' · ' + escapeHtml(meta.label) + '</span>',
    size: 'modal-lg',
    body: body,
    footer:
      '<button type="button" class="btn btn-ghost" onclick="closeRewardModal()">Cancel</button>' +
      '<button type="button" class="btn btn-primary rw-save-btn" onclick="saveRewardFromForm()">' + (isEdit ? 'Save Changes' : 'Create Reward') + '</button>'
  });
  overlay.classList.remove('hidden');
}

function offerBuyRowHtml(item, index) {
  return '<div class="rw-buy-row" data-buy-row="' + index + '">' +
    '<select class="form-input" data-buy-product="' + index + '">' + rewardProductOptions(item.productId || '', 'Select product') + '</select>' +
    '<input type="number" class="form-input" data-buy-qty="' + index + '" min="1" step="1" value="' + (Number(item.qty) || 1) + '" />' +
    '<button type="button" class="icon-btn danger" title="Remove" onclick="removeOfferBuyRow(' + index + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
  '</div>';
}

function addOfferBuyRow() {
  const wrap = els('rwBuyItems');
  if (!wrap) return;
  const index = wrap.querySelectorAll('[data-buy-row]').length;
  const div = document.createElement('div');
  div.innerHTML = offerBuyRowHtml({ productId: '', qty: 1 }, index);
  wrap.appendChild(div.firstElementChild);
}

function removeOfferBuyRow(index) {
  const wrap = els('rwBuyItems');
  if (!wrap) return;
  const rows = wrap.querySelectorAll('[data-buy-row]');
  if (rows.length <= 1) { toast('At least one qualifying product is required.', 'warning'); return; }
  const row = wrap.querySelector('[data-buy-row="' + index + '"]');
  if (row) row.remove();
}

function setOfferMode(mode) {
  const hidden = els('rwOfferMode');
  if (hidden) hidden.value = mode === 'min_spend' ? 'min_spend' : 'buy_products';
  els('rwModeBuy')?.classList.toggle('active', mode !== 'min_spend');
  els('rwModeSpend')?.classList.toggle('active', mode === 'min_spend');
  els('rwBuyItemsWrap')?.classList.toggle('hidden', mode === 'min_spend');
  els('rwMinSpendWrap')?.classList.toggle('hidden', mode !== 'min_spend');
}

function setReferralRewardOption(option) {
  const boost = option === 'limit_boost';
  els('rwMonetaryWrap')?.classList.toggle('hidden', boost);
  els('rwInventoryWrap')?.classList.toggle('hidden', !boost);
  els('rwUsageWrap')?.classList.toggle('hidden', !boost);
}

function collectRewardConfigFromForm(type) {
  const num = (id, fallback, min) => {
    const el = els(id);
    const v = el ? Number(el.value) : NaN;
    return Number.isFinite(v) ? Math.max(min != null ? min : 0, v) : (fallback || 0);
  };
  const val = (id) => (els(id) ? String(els(id).value || '').trim() : '');
  const dateOK = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  if (type === 'shopping_points') {
    return {
      earnSpend: Math.max(1, num('rwEarnSpend', 100, 1)),
      earnPoints: Math.max(1, Math.floor(num('rwEarnPoints', 1, 1))),
      minPurchase: Math.max(0, num('rwMinPurchase', 0, 0)),
      maxPointsPerTxn: Math.max(0, Math.floor(num('rwMaxPoints', 0, 0))),
      minInvoiceAmount: Math.max(0, num('rwMinInvoice', 0, 0)),
      pointValue: Math.max(0.01, num('rwPointValue', 1, 0.01)),
      expiryDays: Math.max(0, Math.floor(num('rwExpiryDays', 0, 0))),
      redemptionEnabled: val('rwRedemptionEnabled') !== 'false',
      maxRedeemPointsPerInvoice: Math.max(0, Math.floor(num('rwMaxRedeemPerInvoice', 0, 0))),
      maxPercentOfInvoice: Math.min(100, Math.max(1, Math.floor(num('rwMaxBillPercent', 100, 1))))
    };
  }
  if (type === 'free_product') {
    return {
      productId: val('rwProductId'),
      quantity: Math.max(1, Math.floor(num('rwQuantity', 1, 1))),
      pointsRequired: Math.max(1, Math.floor(num('rwPointsRequired', 1, 1))),
      validFrom: dateOK(val('rwValidFrom')),
      validTo: dateOK(val('rwValidTo')),
      maxRedemptions: Math.max(0, Math.floor(num('rwMaxRedemptions', 0, 0))),
      customerType: val('rwCustomerType')
    };
  }
  if (type === 'offer_product') {
    const wrap = els('rwBuyItems');
    const buyItems = [];
    if (wrap) {
      wrap.querySelectorAll('[data-buy-row]').forEach(row => {
        const idx = row.getAttribute('data-buy-row');
        const pid = (wrap.querySelector('[data-buy-product="' + idx + '"]') || {}).value || '';
        const qty = Math.max(1, Math.floor(Number((wrap.querySelector('[data-buy-qty="' + idx + '"]') || {}).value) || 1));
        if (pid) buyItems.push({ productId: pid, qty: qty });
      });
    }
    return {
      mode: val('rwOfferMode') === 'min_spend' ? 'min_spend' : 'buy_products',
      buyItems: buyItems,
      minSpend: Math.max(0, num('rwMinSpend', 0, 0)),
      freeProductId: val('rwFreeProductId'),
      freeQty: Math.max(1, Math.floor(num('rwFreeQty', 1, 1))),
      validFrom: dateOK(val('rwValidFrom')),
      validTo: dateOK(val('rwValidTo')),
      maxUsage: Math.max(0, Math.floor(num('rwMaxUsage', 0, 0)))
    };
  }
  return {
    description: val('rwDescription').slice(0, 300),
    rewardOption: val('rwRewardOption') === 'limit_boost' ? 'limit_boost' : 'monetary',
    monetaryAmount: Math.max(1, num('rwMonetaryAmount', 100, 1)),
    inventoryBoost: Math.max(0, Math.floor(num('rwInventoryBoost', 0, 0))),
    usageBoost: Math.max(0, Math.floor(num('rwUsageBoost', 0, 0))),
    qualifyMinSpend: Math.max(0, num('rwQualifyMinSpend', 0, 0)),
    validFrom: dateOK(val('rwValidFrom')),
    validTo: dateOK(val('rwValidTo')),
    enabled: val('rwReferralEnabled') !== 'false'
  };
}

function validateRewardConfig(type, config) {
  if (type === 'shopping_points') {
    if (!(config.earnSpend >= 1)) return 'Spend amount must be at least ₹1.';
    if (!(config.pointValue > 0)) return 'Point value must be greater than zero.';
    if (!Number.isInteger(Number(config.maxRedeemPointsPerInvoice || 0)) || Number(config.maxRedeemPointsPerInvoice || 0) < 0) {
      return 'Maximum points redeemable per invoice must be a positive whole number or left blank for unlimited.';
    }
    if (!Number.isFinite(Number(config.maxPercentOfInvoice)) || Number(config.maxPercentOfInvoice) < 1 || Number(config.maxPercentOfInvoice) > 100) {
      return 'Maximum bill amount redeemable must be between 1% and 100%.';
    }
    return '';
  }
  if (type === 'free_product') {
    if (!config.productId) return 'Select a product from inventory.';
    if (!rewardProductById(config.productId)) return 'The selected product no longer exists.';
    if (config.validFrom && config.validTo && parseRewardDate(config.validFrom, false) > parseRewardDate(config.validTo, true)) return 'Valid-from date must be before valid-until.';
    return '';
  }
  if (type === 'offer_product') {
    if (!config.freeProductId) return 'Select the free product.';
    if (!rewardProductById(config.freeProductId)) return 'The selected free product no longer exists.';
    if (config.mode === 'buy_products' && (!config.buyItems || !config.buyItems.length)) return 'Add at least one qualifying product.';
    if (config.mode === 'min_spend' && !(config.minSpend > 0)) return 'Enter a minimum purchase amount.';
    if (config.validFrom && config.validTo && parseRewardDate(config.validFrom, false) > parseRewardDate(config.validTo, true)) return 'Valid-from date must be before valid-until.';
    return '';
  }
  if (type === 'share_earn') {
    if (config.rewardOption === 'monetary' && !(config.monetaryAmount > 0)) return 'Enter a reward amount.';
    if (config.rewardOption === 'limit_boost' && !(config.inventoryBoost > 0 || config.usageBoost > 0)) return 'Enter at least one limit increase.';
    if (config.rewardOption === 'limit_boost' && config.inventoryBoost > 0 && !rewardsPlanAllows('referral_inventory_boost')) return 'Inventory limit increase is not included in your plan.';
    if (config.rewardOption === 'limit_boost' && config.usageBoost > 0 && !rewardsPlanAllows('referral_usage_boost')) return 'Monthly usage limit increase is not included in your plan.';
    if (config.rewardOption === 'monetary' && !rewardsPlanAllows('referral_monetary')) return 'Monetary referral rewards are not included in your plan.';
    if (config.validFrom && config.validTo && parseRewardDate(config.validFrom, false) > parseRewardDate(config.validTo, true)) return 'Valid-from date must be before valid-until.';
    return '';
  }
  return 'Unknown reward type.';
}

function saveRewardFromForm() {
  const type = __rewardDraft.type;
  if (!type || !REWARD_TYPES[type]) return;
  const name = String((els('rwName') && els('rwName').value) || '').trim();
  if (!name) { toast('Enter a reward name.', 'error'); return; }
  const statusEl = els('rwStatus');
  const status = statusEl && statusEl.value === 'inactive' ? 'inactive' : 'active';
  if (status === 'active' && !rewardsGuard(type, rewardTypeLabel(type))) return;

  const config = collectRewardConfigFromForm(type);
  const invalid = validateRewardConfig(type, config);
  if (invalid) { toast(invalid, 'error'); return; }

  ensureRewardConfigs();
  const existing = __rewardDraft.id ? rewardById(__rewardDraft.id) : null;
  if (existing && existing.type === 'shopping_points') {
    const dup = rewardConfigs.find(r => r.type === 'shopping_points' && r.id !== existing.id);
    if (dup) rewardConfigs = rewardConfigs.filter(r => r.id !== dup.id);
  }
  const user = (typeof getUserProfile === 'function' && getUserProfile() && getUserProfile().name) ? getUserProfile().name : 'System';

  if (existing) {
    existing.name = name;
    existing.status = status;
    existing.config = config;
    existing.updatedAt = Date.now();
    existing.updatedBy = user;
  } else {
    rewardConfigs.unshift({
      id: 'rw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      type: type,
      name: name,
      status: status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: user,
      config: config
    });
  }
  saveRewardConfigStore();

  if (type === 'shopping_points') {
    try { applyShoppingConfigToLoyaltySettings(config); } catch (e) {}
    if (status === 'active') saveLoyaltySettings({ enabled: true });
  }
  if (type === 'share_earn') {
    // Ensure a referral code exists for every existing customer once the program is live.
    try { ensureAllReferralCodes(); } catch (e) {}
  }
  closeRewardModal();
  renderLoyaltyView();
  try { renderCartTotals(); } catch (e) {}
  try { renderPosRewardsPanel(); } catch (e) {}
  toast(existing ? 'Reward updated' : 'Reward created', 'success');
}

function duplicateReward(id) {
  ensureRewardConfigs();
  const src = rewardById(id);
  if (!src) return;
  if (!rewardsGuard(src.type, rewardTypeLabel(src.type))) return;
  const copy = normalizeRewardConfig(Object.assign({}, src, {
    id: 'rw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    name: (src.name + ' (Copy)').slice(0, 80),
    status: 'inactive',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }));
  if (src.type === 'shopping_points') copy.name = 'Shopping Points (Copy)';
  rewardConfigs.unshift(copy);
  saveRewardConfigStore();
  renderLoyaltyView();
  toast('Reward duplicated as inactive. Edit it and activate when ready.', 'success');
}

function toggleRewardStatus(id) {
  ensureRewardConfigs();
  const r = rewardById(id);
  if (!r) return;
  const activating = r.status !== 'active';
  if (activating && !rewardsGuard(r.type, rewardTypeLabel(r.type))) return;
  if (activating && r.type === 'shopping_points') {
    rewardConfigs.forEach(x => { if (x.type === 'shopping_points' && x.id !== r.id) x.status = 'inactive'; });
  }
  r.status = activating ? 'active' : 'inactive';
  r.updatedAt = Date.now();
  saveRewardConfigStore();
  if (r.type === 'shopping_points') {
    saveLoyaltySettings({ enabled: activating ? true : getLoyaltySettings().enabled });
    try { syncShoppingPointsRewardFromSettings(); } catch (e) {}
  }
  renderLoyaltyView();
  try { renderPosRewardsPanel(); } catch (e) {}
  toast(activating ? 'Reward activated' : 'Reward deactivated', 'success');
}

function deleteReward(id) {
  ensureRewardConfigs();
  const r = rewardById(id);
  if (!r) return;
  const used = rewardUsageCount(id);
  const msg = 'Delete "' + r.name + '"?' + (used ? '\n\nThis reward has ' + used + ' recorded redemption(s). The audit ledger is kept.' : '');
  if (!confirm(msg)) return;
  rewardConfigs = rewardConfigs.filter(x => x.id !== id);
  saveRewardConfigStore();
  renderLoyaltyView();
  try { renderPosRewardsPanel(); } catch (e) {}
  toast('Reward deleted', 'success');
}

function viewReward(id) {
  ensureRewardConfigs();
  const r = rewardById(id);
  if (!r) return;
  const c = r.config || {};
  const rows = [
    ['Reward Name', r.name],
    ['Category', rewardTypeLabel(r.type)],
    ['Status', r.status === 'active' ? 'Active' : 'Inactive'],
    ['Validity', rewardValidityLabel(r)]
  ];
  if (r.type === 'shopping_points') {
    rows.push(['Earning Rule', fmt(c.earnSpend) + ' spend = ' + c.earnPoints + ' point(s)']);
    rows.push(['Minimum Purchase', c.minPurchase > 0 ? fmt(c.minPurchase) : 'None']);
    rows.push(['Max Points / Transaction', c.maxPointsPerTxn > 0 ? String(c.maxPointsPerTxn) : 'No limit']);
    rows.push(['Minimum Invoice to Redeem', c.minInvoiceAmount > 0 ? fmt(c.minInvoiceAmount) : 'No minimum']);
    rows.push(['Max Redeemable / Invoice', c.maxRedeemPointsPerInvoice > 0 ? (c.maxRedeemPointsPerInvoice + ' points') : 'Unlimited']);
    rows.push(['Max Bill Amount Redeemable', Math.min(100, Math.max(1, Number(c.maxPercentOfInvoice) || 100)) + '%']);
    rows.push(['Point Value', fmt(c.pointValue) + ' per point']);
    rows.push(['Redemption at POS', c.redemptionEnabled ? 'Enabled' : 'Disabled']);
  } else if (r.type === 'free_product') {
    const p = rewardProductById(c.productId);
    rows.push(['Product', p ? p.name : 'Missing product']);
    rows.push(['SKU / Stock', p ? ((p.sku || 'No SKU') + ' · ' + (Number(p.stock) || 0) + ' in stock') : '—']);
    rows.push(['Required Points', String(c.pointsRequired)]);
    rows.push(['Reward Quantity', String(c.quantity)]);
    rows.push(['Max Redemptions', c.maxRedemptions > 0 ? String(c.maxRedemptions) : 'No limit']);
    rows.push(['Redemptions Used', String(rewardUsageCount(r.id))]);
    rows.push(['Customer Type', c.customerType || 'All customers']);
  } else if (r.type === 'offer_product') {
    rows.push(['Condition', c.mode === 'min_spend' ? ('Minimum spend ' + fmt(c.minSpend)) : ((c.buyItems || []).map(b => rewardProductLabel(b.productId) + ' × ' + b.qty).join(' + ') || 'Buy products')]);
    rows.push(['Free Product', rewardProductLabel(c.freeProductId) + ' × ' + c.freeQty]);
    rows.push(['Max Usage', c.maxUsage > 0 ? String(c.maxUsage) : 'No limit']);
    rows.push(['Usage Count', String(rewardUsageCount(r.id))]);
  } else {
    rows.push(['Reward Option', c.rewardOption === 'limit_boost' ? 'Subscription limit increase' : 'Fixed monetary reward']);
    rows.push(['Reward Value', c.rewardOption === 'limit_boost' ? ('+' + (c.inventoryBoost || 0) + ' products · +' + (c.usageBoost || 0) + ' bills (one-time)') : fmt(c.monetaryAmount)]);
    rows.push(['Qualifying Purchase', c.qualifyMinSpend > 0 ? fmt(c.qualifyMinSpend) : 'Any first purchase']);
    rows.push(['Referral Program', c.enabled ? 'Enabled' : 'Disabled']);
  }
  const overlay = ensureRewardModal();
  const meta = rewardModalMeta(r.type);
  const body =
    '<div class="rw-form-section">' +
      '<div class="rw-form-section-head"><span class="rw-form-section-title">Reward details</span><span class="rw-form-section-badge">' + escapeHtml(rewardTypeLabel(r.type)) + '</span></div>' +
      '<div class="rw-detail-list">' + rows.map(row => '<div class="rw-reward-detail-row"><span>' + escapeHtml(row[0]) + '</span><span>' + escapeHtml(row[1]) + '</span></div>').join('') + '</div>' +
    '</div>';
  overlay.innerHTML = rewardModalShell({
    meta: meta,
    type: r.type,
    title: r.name,
    subtitle: meta.description,
    pill: '<span class="rw-hero-pill">' + escapeHtml(r.status === 'active' ? 'Active' : 'Inactive') + '</span>',
    size: 'modal-md',
    body: body,
    footer: '<button type="button" class="btn btn-ghost" onclick="closeRewardModal()">Close</button><button type="button" class="btn btn-primary" onclick="closeRewardModal();openRewardModal(\'' + r.type + '\',\'' + String(r.id).replace(/'/g, "\\'") + '\')">Edit Reward</button>'
  });
  overlay.classList.remove('hidden');
}

// Keeps the legacy loyalty settings object aligned with the Shopping Points
// reward so old code paths and offline installs see identical rules.
function applyShoppingConfigToLoyaltySettings(config) {
  if (!config) return;
  saveLoyaltySettings({
    earning: {
      spendAmount: Math.max(1, Number(config.earnSpend) || 100),
      earnUnit: Math.max(1, Math.floor(Number(config.earnPoints) || 1)),
      minPurchaseAmount: Math.max(0, Number(config.minPurchase) || 0),
      maxPointsPerTxn: Math.max(0, Math.floor(Number(config.maxPointsPerTxn) || 0)),
      expiryDays: Math.max(0, Math.floor(Number(config.expiryDays) || 0))
    },
    redemption: {
      pointValue: Math.max(0.01, Number(config.pointValue) || 1),
      minPoints: 0,
      minInvoiceAmount: Math.max(0, Number(config.minInvoiceAmount) || 0),
      enabledAtPos: config.redemptionEnabled !== false,
      maxRedeemPointsPerInvoice: Math.max(0, Math.floor(Number(config.maxRedeemPointsPerInvoice) || 0)),
      maxPercentOfInvoice: Math.min(100, Math.max(1, Math.floor(Number(config.maxPercentOfInvoice == null ? 100 : config.maxPercentOfInvoice))))
    }
  });
}

function syncShoppingPointsRewardFromSettings() {
  ensureRewardConfigs();
  const sp = rewardConfigs.find(r => r.type === 'shopping_points');
  if (!sp) return;
  const s = getLoyaltySettings();
  sp.config.earnSpend = s.earning.spendAmount;
  sp.config.earnPoints = s.earning.earnUnit;
  sp.config.minPurchase = s.earning.minPurchaseAmount;
  sp.config.maxPointsPerTxn = s.earning.maxPointsPerTxn;
  sp.config.expiryDays = s.earning.expiryDays;
  sp.config.minInvoiceAmount = Math.max(0, Number(s.redemption.minInvoiceAmount) || 0);
  sp.config.pointValue = s.redemption.pointValue;
  sp.config.redemptionEnabled = s.redemption.enabledAtPos;
  sp.config.maxRedeemPointsPerInvoice = Math.max(0, Math.floor(Number(s.redemption.maxRedeemPointsPerInvoice) || 0));
  sp.config.maxPercentOfInvoice = Math.min(100, Math.max(1, Math.floor(Number(s.redemption.maxPercentOfInvoice == null ? 100 : s.redemption.maxPercentOfInvoice))));
  sp.updatedAt = Date.now();
  saveRewardConfigStore();
}

// Lazily expires earned points older than the configured window. The sweep is
// conservative: it never takes a balance below zero and is recorded as an
// auditable `expired` ledger entry.
function expireLoyaltyPoints() {
  const s = getLoyaltySettings();
  const days = Math.max(0, Math.floor(Number(s.earning && s.earning.expiryDays) || 0));
  if (!days) return;
  const cutoff = Date.now() - (days * 86400000);
  const txns = Array.isArray(loyaltyTransactions) ? loyaltyTransactions : [];
  let customersChanged = false;
  (Array.isArray(customers) ? customers : []).forEach(c => {
    ensureCustomerLoyaltyFields(c);
    const stale = txns.filter(t => t && t.customerId === c.id && t.type === 'earned' && !t.expirySettled && (Number(t.ts) || 0) < cutoff);
    if (!stale.length) return;
    let expirable = 0;
    stale.forEach(t => { expirable += Math.max(0, Math.floor(Number(t.points) || 0)); });
    const deduct = Math.min(expirable, Math.max(0, Math.floor(Number(c.points) || 0)));
    if (deduct > 0) {
      c.points = Math.max(0, Math.floor(Number(c.points) || 0) - deduct);
      c.loyaltyExpiredTotal = Math.max(0, Math.floor(Number(c.loyaltyExpiredTotal) || 0) + deduct);
      appendLoyaltyTransaction({
        idempotencyKey: 'expire:' + c.id + ':' + cutoff,
        customerId: c.id,
        customerName: c.name,
        type: 'expired',
        points: -deduct,
        balanceAfter: c.points,
        description: 'Points expired after ' + days + ' days'
      });
    }
    stale.forEach(t => { t.expirySettled = true; });
    customersChanged = true;
  });
  if (customersChanged) {
    DB.set('customers', customers);
    if (selectedCustomer) {
      const fresh = customers.find(x => x.id === selectedCustomer.id);
      if (fresh) selectedCustomer = fresh;
    }
  }
}

// ─── POS eligibility: Free Product + Offer Product ──────────────────
function rewardAppliedInCart(rewardId) {
  return (Array.isArray(cart) ? cart : []).some(i => i && i.rewardId === rewardId);
}

function getEligibleFreeProductRewards(cust) {
  ensureRewardConfigs();
  const s = getLoyaltySettings();
  if (!cust || !s.enabled || !rewardsPlanAllows('free_product')) return [];
  ensureCustomerLoyaltyFields(cust);
  const out = [];
  rewardConfigs.forEach(r => {
    if (r.type !== 'free_product' || !rewardIsValidNow(r)) return;
    const c = r.config;
    const product = rewardProductById(c.productId);
    if (!product) return;
    if (Number(product.stock) < Math.max(1, Number(c.quantity) || 1)) return;
    if (c.customerType && String(cust.customerType || '').toLowerCase() !== String(c.customerType).toLowerCase()) return;
    const remaining = rewardRemainingUsage(r);
    if (remaining != null && remaining <= 0) return;
    if ((Math.floor(Number(cust.points) || 0)) < (Number(c.pointsRequired) || 0)) return;
    out.push({ reward: r, product: product, points: Number(c.pointsRequired) || 0, qty: Math.max(1, Number(c.quantity) || 1), remaining: remaining });
  });
  return out;
}

// Chargeable cart value (reward lines never add to the offer threshold).
function cartOfferSubtotal() {
  return r2((Array.isArray(cart) ? cart : []).reduce((sum, i) => {
    if (!i || i.rewardId) return sum;
    const t = calcItemTotal(i);
    return sum + (Number(t.total) || 0);
  }, 0));
}

function cartQtyForProduct(productId) {
  return (Array.isArray(cart) ? cart : []).reduce((sum, i) => {
    if (!i || i.rewardId) return sum;
    return i.id === productId ? sum + (Number(i.qty) || 0) : sum;
  }, 0);
}

function offerRequirementText(r) {
  const c = r.config || {};
  if (c.mode === 'min_spend') {
    const missing = Math.max(0, (Number(c.minSpend) || 0) - cartOfferSubtotal());
    return missing > 0 ? ('Add ' + fmt(missing) + ' more to unlock') : 'Minimum spend reached';
  }
  const missing = (c.buyItems || []).map(b => {
    const need = Math.max(0, (Number(b.qty) || 0) - cartQtyForProduct(b.productId));
    return need > 0 ? (rewardProductLabel(b.productId) + ' × ' + need) : '';
  }).filter(Boolean);
  return missing.length ? ('Add ' + missing.join(', ')) : 'Qualifying products in cart';
}

function isOfferEligible(r) {
  const c = r.config || {};
  if (c.mode === 'min_spend') return cartOfferSubtotal() >= (Number(c.minSpend) || 0);
  const items = c.buyItems || [];
  if (!items.length) return false;
  return items.every(b => cartQtyForProduct(b.productId) >= (Number(b.qty) || 0));
}

function getActiveOfferRewards() {
  ensureRewardConfigs();
  if (!getLoyaltySettings().enabled || !rewardsPlanAllows('offer_product')) return [];
  return rewardConfigs.filter(r => {
    if (r.type !== 'offer_product' || !rewardIsValidNow(r)) return false;
    const remaining = rewardRemainingUsage(r);
    if (remaining != null && remaining <= 0) return false;
    const product = rewardProductById(r.config.freeProductId);
    if (!product) return false;
    if (Number(product.stock) < Math.max(1, Number(r.config.freeQty) || 1)) return false;
    return true;
  }).map(r => ({ reward: r, product: rewardProductById(r.config.freeProductId), eligible: isOfferEligible(r), remaining: rewardRemainingUsage(r) }));
}

function applyFreeProductReward(rewardId) {
  const cust = (typeof selectedCustomer !== 'undefined') ? selectedCustomer : null;
  if (!cust) { toast('Select a customer to redeem this reward.', 'error'); return; }
  if (!rewardsGuard('free_product', 'Free Product Rewards')) return;
  const eligible = getEligibleFreeProductRewards(cust);
  const match = eligible.find(x => x.reward.id === rewardId);
  if (!match) { toast('This free product reward is not eligible for this customer right now.', 'warning'); return; }
  if (rewardAppliedInCart(rewardId)) { toast('This reward is already in the cart.', 'warning'); return; }
  const product = match.product;
  const qty = match.qty;
  if (Number(product.stock) < qty) { toast('Insufficient stock for the free product.', 'error'); return; }

  cart.push({
    id: product.id,
    cartKey: 'reward-' + rewardId + '-' + Date.now().toString(36),
    name: product.name,
    displayName: product.name + ' (Free Reward)',
    price: 0,
    mrp: Number(product.mrp) || Number(product.price) || 0,
    tax: product.tax || 0,
    taxInclusive: !!product.taxInclusive,
    unit: product.unit || 'pcs',
    stock: Number(product.stock) || 0,
    sku: product.sku || '',
    hsn: product.hsn || '',
    category: product.category || '',
    image: product.image || null,
    emoji: product.emoji || '🎁',
    qty: qty,
    itemDiscount: 0,
    rewardFree: true,
    rewardId: rewardId,
    rewardType: 'free_product',
    rewardName: match.reward.name,
    rewardPoints: match.points
  });
  renderCart();
  renderPosRewardsPanel();
  toast('Free product added · ' + match.points + ' points will be deducted after billing.', 'success');
}

function applyOfferReward(rewardId) {
  if (!rewardsGuard('offer_product', 'Offer Product Rewards')) return;
  const offers = getActiveOfferRewards();
  const match = offers.find(x => x.reward.id === rewardId);
  if (!match) { toast('This offer is not available right now.', 'warning'); return; }
  if (!match.eligible) { toast(offerRequirementText(match.reward), 'warning'); return; }
  if (rewardAppliedInCart(rewardId)) { toast('This offer is already applied to the cart.', 'warning'); return; }
  if (Number(match.product.stock) < Math.max(1, Number(match.reward.config.freeQty) || 1)) {
    toast('Insufficient stock for the free product.', 'error');
    return;
  }
  const qty = Math.max(1, Number(match.reward.config.freeQty) || 1);
  cart.push({
    id: match.product.id,
    cartKey: 'reward-' + rewardId + '-' + Date.now().toString(36),
    name: match.product.name,
    displayName: match.product.name + ' (Offer Reward)',
    price: 0,
    mrp: Number(match.product.mrp) || Number(match.product.price) || 0,
    tax: match.product.tax || 0,
    taxInclusive: !!match.product.taxInclusive,
    unit: match.product.unit || 'pcs',
    stock: Number(match.product.stock) || 0,
    sku: match.product.sku || '',
    hsn: match.product.hsn || '',
    category: match.product.category || '',
    image: match.product.image || null,
    emoji: match.product.emoji || '🎁',
    qty: qty,
    itemDiscount: 0,
    rewardFree: true,
    rewardId: rewardId,
    rewardType: 'offer_product',
    rewardName: match.reward.name,
    rewardPoints: 0
  });
  renderCart();
  renderPosRewardsPanel();
  toast('Offer applied · free product added to the cart.', 'success');
}

function removeRewardFromCart(rewardId) {
  if (!Array.isArray(cart)) return;
  cart = cart.filter(i => !i || i.rewardId !== rewardId);
  renderCart();
  renderPosRewardsPanel();
  toast('Reward removed from cart', 'info');
}

function renderPosRewardsPanel() {
  const box = els('posRewardsPanel');
  if (!box) return;
  const cust = (typeof selectedCustomer !== 'undefined') ? selectedCustomer : null;
  const s = getLoyaltySettings();
  const applied = (Array.isArray(cart) ? cart : []).filter(i => i && i.rewardId);
  const moduleAllowed = rewardsPlanAllows('module');
  const offers = moduleAllowed ? getActiveOfferRewards() : [];

  if (!moduleAllowed || !s.enabled || (!cust && !offers.length && !applied.length)) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const free = cust ? getEligibleFreeProductRewards(cust) : [];
  box.classList.remove('hidden');

  let html = '<div class="pos-rewards-head"><span class="pos-rewards-title">Rewards</span>' +
    (cust ? '<span class="pos-rewards-points">' + Math.max(0, Math.floor(Number(cust.points) || 0)) + ' pts available</span>' : '') +
  '</div>';

  if (applied.length) {
    html += applied.map(i => '<div class="pos-reward-item">' +
      '<div class="pos-reward-item-main"><div class="pos-reward-item-name">' + escapeHtml(i.displayName || i.name) + '</div>' +
      '<div class="pos-reward-item-meta">' + escapeHtml(i.rewardName || 'Reward') + (i.rewardPoints ? (' · ' + i.rewardPoints + ' pts on billing') : ' · Offer') + '</div></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" onclick="removeRewardFromCart(\'' + String(i.rewardId).replace(/'/g, "\\'") + '\')">Remove</button>' +
    '</div>').join('');
  }

  if (cust && free.length) {
    html += free.map(x => '<div class="pos-reward-item">' +
      '<div class="pos-reward-item-main"><div class="pos-reward-item-name">' + escapeHtml(x.product.name) + ' × ' + x.qty + ' <span class="pos-offer-badge">FREE</span></div>' +
      '<div class="pos-reward-item-meta">' + x.points + ' pts · ' + escapeHtml(x.reward.name) + '</div></div>' +
      '<button type="button" class="btn btn-primary btn-sm" onclick="applyFreeProductReward(\'' + String(x.reward.id).replace(/'/g, "\\'") + '\')">Redeem</button>' +
    '</div>').join('');
  }

  if (offers.length) {
    html += offers.map(x => {
      const already = rewardAppliedInCart(x.reward.id);
      return '<div class="pos-reward-item">' +
        '<div class="pos-reward-item-main"><div class="pos-reward-item-name">' + escapeHtml(x.product.name) + ' × ' + x.reward.config.freeQty + ' <span class="pos-offer-badge">OFFER</span></div>' +
        '<div class="pos-reward-item-meta">' + escapeHtml(x.reward.name) + ' · ' + escapeHtml(x.eligible ? 'Eligible' : offerRequirementText(x.reward)) + '</div></div>' +
        (already
          ? '<span class="badge-pill badge-green">Applied</span>'
          : '<button type="button" class="btn ' + (x.eligible ? 'btn-primary' : 'btn-ghost') + ' btn-sm" ' + (x.eligible ? '' : 'disabled ') + 'onclick="applyOfferReward(\'' + String(x.reward.id).replace(/'/g, "\\'") + '\')">Apply</button>') +
      '</div>';
    }).join('');
  }

  if (!applied.length && !(cust && free.length) && !offers.length) {
    html += '<div class="pos-rewards-empty">' + (cust ? 'No rewards are eligible for this customer right now.' : 'Select a customer to see available rewards.') + '</div>';
  }
  box.innerHTML = html;
}

// ─── Share & Earn: referral codes, relationships and one-time rewards ─
function activeShareEarnReward() {
  ensureRewardConfigs();
  return rewardConfigs.find(r => r.type === 'share_earn' && rewardIsValidNow(r) && r.config && r.config.enabled !== false) || null;
}

function referralCodeFor(customer) {
  if (!customer) return '';
  if (customer.referralCode) return String(customer.referralCode);
  const seed = String(customer.id || '') + String(customer.phone || '') || String(Date.now());
  let hash = 0;
  for (let i = 0; i < seed.length; i++) { hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0; }
  const base = Math.abs(hash).toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
  let code = 'HIS-' + base;
  let n = 1;
  const taken = (Array.isArray(customers) ? customers : []).some(c => c && c.id !== customer.id && String(c.referralCode || '').toUpperCase() === code);
  while (taken) { code = 'HIS-' + base + String(n++); }
  customer.referralCode = code;
  customer.referralCodeCreatedAt = customer.referralCodeCreatedAt || Date.now();
  return code;
}

function ensureReferralCode(customer) {
  if (!customer) return '';
  const before = customer.referralCode;
  const code = referralCodeFor(customer);
  if (!before) {
    DB.set('customers', customers);
  }
  return code;
}

function ensureAllReferralCodes() {
  let changed = false;
  (Array.isArray(customers) ? customers : []).forEach(c => {
    if (c && !c.referralCode) { referralCodeFor(c); changed = true; }
  });
  if (changed) DB.set('customers', customers);
}

function successfulReferralCount(customerId) {
  return (Array.isArray(referrals) ? referrals : []).filter(r => r && r.referrerCustomerId === customerId && r.status === 'rewarded').length;
}

function referralStatusBadge(status) {
  const map = {
    pending: ['Pending', 'badge-amber'],
    qualified: ['Qualified', 'badge-purple'],
    rewarded: ['Rewarded', 'badge-green'],
    rejected: ['Rejected', 'badge-red']
  };
  const v = map[status] || map.pending;
  return '<span class="badge-pill ' + v[1] + '">' + v[0] + '</span>';
}

function renderReferralDashboard() {
  ensureRewardConfigs();
  const list = Array.isArray(referrals) ? referrals : [];
  const rewarded = list.filter(r => r && r.status === 'rewarded');
  const pending = list.filter(r => r && (r.status === 'pending' || r.status === 'qualified'));
  if (els('refStatTotal')) els('refStatTotal').textContent = String(list.length);
  if (els('refStatSuccessful')) els('refStatSuccessful').textContent = String(rewarded.length);
  if (els('refStatPending')) els('refStatPending').textContent = String(pending.length);
  if (els('refStatRewards')) els('refStatRewards').textContent = String(rewarded.length);

  const summary = els('referralProgramSummary');
  if (summary) {
    const program = rewardConfigs.find(r => r.type === 'share_earn');
    if (!program) {
      summary.innerHTML = 'No referral program configured yet. Create a <strong>Share &amp; Earn</strong> reward to start issuing referral codes.';
    } else {
      const c = program.config || {};
      const option = c.rewardOption === 'limit_boost'
        ? ('One-time limit increase: +' + (c.inventoryBoost || 0) + ' products · +' + (c.usageBoost || 0) + ' bills')
        : ('Fixed reward: ' + fmt(c.monetaryAmount) + ' per successful referral');
      const status = program.status === 'active' && c.enabled !== false ? '<span class="badge-pill badge-green">Active</span>' : '<span class="badge-pill badge-gray">Inactive</span>';
      summary.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;"><strong>' + escapeHtml(program.name) + '</strong>' + status + '</div>' +
        '<div>' + escapeHtml(option) + '</div>' +
        '<div>Qualifies after a first purchase of ' + (c.qualifyMinSpend > 0 ? fmt(c.qualifyMinSpend) : 'any amount') + '.</div>' +
        '<div>Validity: ' + escapeHtml(rewardValidityLabel(program)) + '</div>' +
        '<div class="rw-muted" style="margin-top:4px;">One reward per qualifying referral. Usage and inventory boosts are granted once and never repeat monthly.</div>';
    }
  }

  const body = els('referralHistoryBody');
  if (body) {
    const sorted = list.slice().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)).slice(0, 50);
    body.innerHTML = sorted.length ? sorted.map(r => {
      let reward = '—';
      if (r.status === 'rewarded') {
        reward = r.rewardOption === 'limit_boost'
          ? ('+' + (r.inventoryBoost || 0) + ' products / +' + (r.usageBoost || 0) + ' bills')
          : fmt(r.rewardValue || 0);
      }
      const when = r.createdAt ? new Date(Number(r.createdAt)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
      return '<tr><td>' + escapeHtml(r.referrerName || '—') + '</td><td>' + escapeHtml(r.refereeName || '—') + '</td><td class="rw-referral-code">' + escapeHtml(r.code || '—') + '</td><td>' + referralStatusBadge(r.status) + '</td><td>' + escapeHtml(reward) + '</td><td>' + escapeHtml(when) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="table-empty">No referrals recorded yet.</td></tr>';
  }
}

function ensureReferralModal() {
  let overlay = document.getElementById('referralModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'referralModalOverlay';
    overlay.className = 'modal-overlay hidden';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeReferralModal(); });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function closeReferralModal() {
  const overlay = document.getElementById('referralModalOverlay');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
}

function openRecordReferralModal() {
  if (!rewardsGuard('share_earn', 'Referral Rewards')) return;
  const program = activeShareEarnReward() || (ensureRewardConfigs(), rewardConfigs.find(r => r.type === 'share_earn'));
  if (!program) { toast('Create a Share & Earn reward first.', 'warning'); return; }
  if (program.status !== 'active' || program.config.enabled === false) { toast('The referral program is currently inactive.', 'warning'); return; }
  ensureAllReferralCodes();
  const overlay = ensureReferralModal();
  const custOptions = (Array.isArray(customers) ? customers : [])
    .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .map(c => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name || 'Unnamed') + (c.phone ? ' · ' + escapeHtml(c.phone) : '') + '</option>').join('');
  const meta = rewardModalMeta('share_earn');
  const body =
    '<div class="rw-form-section">' +
      '<div class="rw-form-section-head"><span class="rw-form-section-title">Referral details</span><span class="rw-form-section-badge">Pending until qualified</span></div>' +
      '<div class="rw-modal-grid">' +
        '<div class="form-group span-2"><label>Referring Customer</label><select id="refReferrer" class="form-input" onchange="onReferralReferrerChange()"><option value="">Select customer</option>' + custOptions + '</select></div>' +
        '<div class="form-group span-2"><label>Referral Code</label><input type="text" id="refCode" class="form-input" readonly placeholder="Select a referring customer" /></div>' +
        '<div class="form-group span-2"><label>New Customer</label><select id="refReferee" class="form-input"><option value="">Create a new customer below</option>' + custOptions + '</select></div>' +
        '<div class="form-group"><label>New Customer Name</label><input type="text" id="refName" class="form-input" maxlength="80" placeholder="Full name" /></div>' +
        '<div class="form-group"><label>New Customer Phone</label><input type="tel" id="refPhone" class="form-input" maxlength="10" inputmode="numeric" placeholder="10-digit mobile" oninput="this.value=this.value.replace(/\\D/g,\'\')" /></div>' +
      '</div>' +
      '<p class="rw-modal-hint">The referral stays <strong>Pending</strong> until the new customer completes a qualifying purchase. A customer cannot refer themselves and a referral is rewarded only once.</p>' +
    '</div>';

  overlay.innerHTML = rewardModalShell({
    meta: meta,
    type: 'share_earn',
    title: 'Record Referral',
    subtitle: 'Link a new customer to the referrer’s unique code to track and reward the referral.',
    pill: '<span class="rw-hero-pill">Share & Earn</span>',
    size: 'modal-md',
    body: body,
    onClose: 'closeReferralModal()',
    footer: '<button type="button" class="btn btn-ghost" onclick="closeReferralModal()">Cancel</button><button type="button" class="btn btn-primary" onclick="saveRecordReferral()">Record Referral</button>'
  });
  overlay.classList.remove('hidden');
}

function onReferralReferrerChange() {
  const id = els('refReferrer') ? els('refReferrer').value : '';
  const c = (Array.isArray(customers) ? customers : []).find(x => x.id === id);
  const code = c ? ensureReferralCode(c) : '';
  if (els('refCode')) els('refCode').value = code || '';
}

function saveRecordReferral() {
  if (!rewardsGuard('share_earn', 'Referral Rewards')) return;
  const program = activeShareEarnReward();
  if (!program) { toast('The referral program is not active.', 'warning'); return; }
  const referrerId = els('refReferrer') ? els('refReferrer').value : '';
  const referrer = (Array.isArray(customers) ? customers : []).find(c => c.id === referrerId);
  if (!referrer) { toast('Select the referring customer.', 'error'); return; }
  const code = ensureReferralCode(referrer);
  if (!code) { toast('Could not generate a referral code.', 'error'); return; }

  let referee = null;
  const refereeId = els('refReferee') ? els('refReferee').value : '';
  if (refereeId) {
    referee = (Array.isArray(customers) ? customers : []).find(c => c.id === refereeId);
  } else {
    const name = String((els('refName') && els('refName').value) || '').trim();
    const phone = String((els('refPhone') && els('refPhone').value) || '').replace(/\D/g, '');
    if (!name) { toast('Enter the new customer name.', 'error'); return; }
    if (phone.length !== 10) { toast('Enter a valid 10-digit phone number.', 'error'); return; }
    if (referrer.phone && referrer.phone === phone) { toast('A customer cannot use their own referral code.', 'error'); return; }
    const existing = (Array.isArray(customers) ? customers : []).find(c => c.phone === phone);
    if (existing) { referee = existing; }
    else {
      referee = {
        id: uid(),
        code: (typeof qacNextCode === 'function') ? qacNextCode() : ('C' + Date.now()),
        name: name,
        phone: phone,
        email: '', state: '', address: '', gstin: '', customerType: '',
        points: 0, pointsExpiry: '', due: 0, creditLimit: 0, totalPurchases: 0,
        gstDoc: '', idDoc: '', image: null,
        referredByCode: code,
        createdAt: Date.now()
      };
      customers.unshift(referee);
      DB.set('customers', customers);
    }
  }
  if (!referee) { toast('Select or create the new customer.', 'error'); return; }
  if (referee.id === referrer.id) { toast('A customer cannot use their own referral code.', 'error'); return; }

  const dup = (Array.isArray(referrals) ? referrals : []).some(r => r && r.refereeCustomerId === referee.id && r.status !== 'rejected');
  if (dup) { toast('This customer already has an active referral.', 'error'); return; }
  const reverseDup = (Array.isArray(referrals) ? referrals : []).some(r => r && r.referrerCustomerId === referee.id && r.refereeCustomerId === referrer.id);
  if (reverseDup) { toast('This referral relationship already exists in reverse.', 'error'); return; }

  if (!referee.referredByCode) { referee.referredByCode = code; DB.set('customers', customers); }

  referrals.unshift({
    id: 'rf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    code: code,
    referrerCustomerId: referrer.id,
    referrerName: referrer.name,
    refereeCustomerId: referee.id,
    refereeName: referee.name,
    refereePhone: referee.phone || '',
    rewardId: program.id,
    rewardName: program.name,
    rewardOption: (program.config || {}).rewardOption || 'monetary',
    status: 'pending',
    createdAt: Date.now()
  });
  DB.set('referrals', referrals);
  closeReferralModal();
  renderLoyaltyView();
  toast('Referral recorded as pending', 'success');
}

// Called from the successful-payment path only.
function qualifyReferralsForCustomer(customerId, sale) {
  if (!customerId) return;
  const program = activeShareEarnReward();
  if (!program) return;
  const spend = Math.max(0, Number(sale && sale.total) || 0);
  const threshold = Math.max(0, Number((program.config || {}).qualifyMinSpend) || 0);
  if (spend < threshold) return;
  let changed = false;
  (Array.isArray(referrals) ? referrals : []).forEach(ref => {
    if (!ref || ref.status !== 'pending' || ref.refereeCustomerId !== customerId) return;
    if (ref.referrerCustomerId === customerId) { ref.status = 'rejected'; ref.rejectReason = 'Self-referral'; changed = true; return; }
    ref.qualifiedAt = Date.now();
    ref.qualifyingSaleId = (sale && sale.id) || null;
    ref.qualifyingInvoice = (sale && sale.invNo) || '';
    ref.qualifyingAmount = r2(spend);
    ref.status = 'qualified';
    try { issueReferralReward(ref, program); } catch (e) { /* stays qualified for retry */ }
    changed = true;
  });
  if (changed) DB.set('referrals', referrals);
}

function issueReferralReward(ref, program) {
  if (!ref || ref.status === 'rewarded') return false;
  const refIdem = 'referral:' + ref.id + ':reward';
  if (loyaltyTxnExists(refIdem)) { ref.status = 'rewarded'; return true; }
  const referrer = (Array.isArray(customers) ? customers : []).find(c => c.id === ref.referrerCustomerId);
  if (!referrer) { ref.status = 'rejected'; ref.rejectReason = 'Referring customer no longer exists'; return false; }
  if (referrer.id === ref.refereeCustomerId) { ref.status = 'rejected'; ref.rejectReason = 'Self-referral'; return false; }
  ensureCustomerLoyaltyFields(referrer);
  const c = program.config || {};

  if (c.rewardOption === 'limit_boost') {
    const inv = Math.max(0, Math.floor(Number(c.inventoryBoost) || 0));
    const use = Math.max(0, Math.floor(Number(c.usageBoost) || 0));
    if (inv > 0 && !rewardsPlanAllows('referral_inventory_boost')) return false;
    if (use > 0 && !rewardsPlanAllows('referral_usage_boost')) return false;
    let grant = (Array.isArray(referralGrants) ? referralGrants : []).find(g => g && g.referralId === ref.id);
    if (!grant) {
      grant = {
        id: 'rg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        referralId: ref.id,
        rewardId: program.id,
        rewardName: program.name,
        type: 'referral_boost',
        inventoryBoost: inv,
        usageBoost: use,
        appliedOnce: true,
        createdAt: Date.now()
      };
      referralGrants.push(grant);
      DB.set('referralGrants', referralGrants);
    }
    appendLoyaltyTransaction({
      idempotencyKey: refIdem,
      customerId: referrer.id,
      customerName: referrer.name,
      type: 'referral_reward',
      points: 0,
      monetaryValue: 0,
      rewardId: program.id,
      rewardName: program.name,
      rewardType: 'share_earn',
      referralId: ref.id,
      status: 'completed',
      description: 'One-time limit boost for referral ' + ref.code + ' (+' + inv + ' products, +' + use + ' bills)'
    });
    ref.status = 'rewarded';
    ref.rewardedAt = Date.now();
    ref.rewardOption = 'limit_boost';
    ref.inventoryBoost = inv;
    ref.usageBoost = use;
    ref.grantId = grant.id;
    ref.rewardValue = 0;
    // Best-effort server persistence of the one-time grant.
    try {
      if (window.HisaabSaaS && typeof window.HisaabSaaS.claimReferralBoost === 'function') {
        window.HisaabSaaS.claimReferralBoost({ grantKey: ref.id, inventoryBoost: inv, usageBoost: use });
      }
    } catch (e) {}
    return true;
  }

  if (!rewardsPlanAllows('referral_monetary')) return false;
  const amount = Math.max(1, Number(c.monetaryAmount) || 0);
  referrer.due = r2((Number(referrer.due) || 0) - amount);
  referrer.referralRewardTotal = r2((Number(referrer.referralRewardTotal) || 0) + amount);
  DB.set('customers', customers);
  appendLoyaltyTransaction({
    idempotencyKey: refIdem,
    customerId: referrer.id,
    customerName: referrer.name,
    type: 'referral_reward',
    points: 0,
    monetaryValue: amount,
    rewardId: program.id,
    rewardName: program.name,
    rewardType: 'share_earn',
    referralId: ref.id,
    status: 'completed',
    description: 'Referral reward for ' + ref.refereeName + ' (' + ref.code + ')'
  });
  ref.status = 'rewarded';
  ref.rewardedAt = Date.now();
  ref.rewardOption = 'monetary';
  ref.rewardValue = amount;
  ref.issuedLedgerKey = refIdem;
  return true;
}

function getReferralGrantsTotal() {
  const list = Array.isArray(referralGrants) ? referralGrants : [];
  return list.reduce((acc, g) => {
    if (!g) return acc;
    acc.inventory += Math.max(0, Number(g.inventoryBoost) || 0);
    acc.usage += Math.max(0, Number(g.usageBoost) || 0);
    return acc;
  }, { inventory: 0, usage: 0 });
}

// ─── Checkout: re-validate and consume applied rewards ──────────────
// The cart is user-editable, so eligibility is never trusted from the moment
// a reward was applied. Every reward line is re-checked immediately before the
// invoice is committed, and consumption is keyed to the invoice number so a
// retried confirmPayment can never deduct points twice.
function collectCartRewards() {
  return (Array.isArray(cart) ? cart : [])
    .filter(i => i && i.rewardId)
    .map(i => ({
      rewardId: i.rewardId,
      rewardType: i.rewardType || 'reward',
      rewardName: i.rewardName || '',
      productId: i.id,
      productName: i.name,
      qty: Math.max(0, Number(i.qty) || 0),
      points: Math.max(0, Math.floor(Number(i.rewardPoints) || 0))
    }));
}

function validateRewardsAtCheckout(customer) {
  const applied = collectCartRewards();
  if (!applied.length) return { ok: true, rewards: [] };

  // Duplicate protection: a reward may appear only once per invoice.
  const seen = new Set();
  for (const r of applied) {
    if (seen.has(r.rewardId)) return { ok: false, reason: 'A reward was applied twice. Remove it and try again.', rewards: applied };
    seen.add(r.rewardId);
  }

  // Reward lines must stay free — a non-zero price would corrupt the invoice
  // totals and GST computation.
  const pricedReward = (Array.isArray(cart) ? cart : []).find(i => i && i.rewardId && Number(i.price) !== 0);
  if (pricedReward) {
    return { ok: false, reason: 'A reward item has a non-zero price. Remove it and apply the reward again.', rewards: applied };
  }

  const s = getLoyaltySettings();
  // Points the customer is also spending as an invoice discount must be
  // reserved so a free-product redemption cannot overdraw the balance.
  let reservedDiscountPoints = 0;
  if (customer) {
    try {
      const reqPts = Math.max(0, Math.floor(Number(getLoyaltyRedeemPointsInput()) || 0));
      if (reqPts > 0 && loyaltyRedeemEnabled()) {
        const red = computeLoyaltyRedemption({ grand: r2(Number(checkoutAmounts().beforeLoyalty) || 0) }, customer, reqPts);
        if (red && red.allowed) reservedDiscountPoints = Math.max(0, Math.floor(Number(red.points) || 0));
      }
    } catch (e) { reservedDiscountPoints = 0; }
  }
  for (const r of applied) {
    const cfg = rewardById(r.rewardId);
    if (!cfg) return { ok: false, reason: 'A reward in the cart no longer exists. Remove it to continue.', rewards: applied };
    if (!s.enabled) return { ok: false, reason: 'The rewards program is disabled. Remove reward items to continue.', rewards: applied };
    if (cfg.status !== 'active' || !rewardIsValidNow(cfg)) return { ok: false, reason: '"' + cfg.name + '" is no longer active. Remove it to continue.', rewards: applied };

    const remaining = rewardRemainingUsage(cfg);
    if (remaining != null && remaining <= 0) return { ok: false, reason: '"' + cfg.name + '" has reached its usage limit. Remove it to continue.', rewards: applied };

    const product = rewardProductById(r.productId);
    if (!product) return { ok: false, reason: 'The reward product no longer exists. Remove it to continue.', rewards: applied };
    const totalQty = cart.reduce((sum, i) => (i && i.id === r.productId ? sum + (Number(i.qty) || 0) : sum), 0);
    if (totalQty > (Number(product.stock) || 0)) return { ok: false, reason: 'Only ' + (Number(product.stock) || 0) + ' in stock for "' + product.name + '".', rewards: applied };

    if (cfg.type === 'free_product') {
      if (!customer) return { ok: false, reason: 'Select a customer to redeem "' + cfg.name + '".', rewards: applied };
      if (!rewardsPlanAllows('free_product')) return { ok: false, reason: 'Free product rewards are not included in your plan.', rewards: applied };
      const c = cfg.config || {};
      const expectedQty = Math.max(1, Math.floor(Number(c.quantity) || 1));
      if (Math.floor(Number(r.qty) || 0) !== expectedQty) {
        return { ok: false, reason: '"' + cfg.name + '" must be exactly ' + expectedQty + ' unit(s). Remove it and apply again.', rewards: applied };
      }
      if (c.customerType && String(customer.customerType || '').toLowerCase() !== String(c.customerType).toLowerCase()) {
        return { ok: false, reason: '"' + cfg.name + '" is not available for this customer type.', rewards: applied };
      }
      const need = Math.max(0, Math.floor(Number(c.pointsRequired) || 0));
      ensureCustomerLoyaltyFields(customer);
      if (Math.floor(Number(customer.points) || 0) < need + reservedDiscountPoints) {
        return { ok: false, reason: 'Not enough points for "' + cfg.name + '" (' + need + ' required' + (reservedDiscountPoints > 0 ? ', ' + reservedDiscountPoints + ' reserved for the discount' : '') + ').', rewards: applied };
      }
      r.points = need;
    } else if (cfg.type === 'offer_product') {
      if (!rewardsPlanAllows('offer_product')) return { ok: false, reason: 'Offer product rewards are not included in your plan.', rewards: applied };
      const oc = cfg.config || {};
      const expectedQty = Math.max(1, Math.floor(Number(oc.freeQty) || 1));
      if (Math.floor(Number(r.qty) || 0) !== expectedQty) {
        return { ok: false, reason: '"' + cfg.name + '" must be exactly ' + expectedQty + ' free unit(s). Remove it and apply again.', rewards: applied };
      }
      if (!isOfferEligible(cfg)) return { ok: false, reason: '"' + cfg.name + '" is not eligible for this cart (' + offerRequirementText(cfg) + ').', rewards: applied };
      r.points = 0;
    } else {
      return { ok: false, reason: 'Unsupported reward type in cart.', rewards: applied };
    }
  }
  return { ok: true, rewards: applied };
}

// Writes the reward consumption ledger after a sale has been committed.
// Returns the points deducted through free-product redemptions.
function consumeRewardsForSale(sale, customer) {
  const rewards = (sale && Array.isArray(sale.rewards)) ? sale.rewards : [];
  if (!rewards.length || !customer) return 0;
  let redeemedPoints = 0;
  rewards.forEach(r => {
    const key = 'sale:' + sale.invNo + ':reward:' + r.rewardId;
    if (loyaltyTxnExists(key)) return;
    if (r.rewardType === 'free_product') {
      const deduct = Math.min(Math.max(0, Math.floor(Number(r.points) || 0)), Math.max(0, Math.floor(Number(customer.points) || 0)));
      if (deduct > 0) {
        customer.points = Math.max(0, Math.floor(Number(customer.points) || 0) - deduct);
        customer.loyaltyRedeemedTotal = Math.max(0, Math.floor(Number(customer.loyaltyRedeemedTotal) || 0) + deduct);
        redeemedPoints += deduct;
      }
      appendLoyaltyTransaction({
        idempotencyKey: key,
        customerId: customer.id,
        customerName: customer.name,
        type: 'reward_redeemed',
        points: -deduct,
        balanceAfter: customer.points,
        saleId: sale.id,
        invNo: sale.invNo,
        invoiceId: sale.id,
        rewardId: r.rewardId,
        rewardName: r.rewardName,
        rewardType: r.rewardType,
        status: 'completed',
        description: 'Free product "' + r.productName + '" × ' + r.qty + ' on invoice ' + sale.invNo
      });
    } else {
      appendLoyaltyTransaction({
        idempotencyKey: key,
        customerId: customer.id,
        customerName: customer.name,
        type: 'reward_applied',
        points: 0,
        balanceAfter: Math.max(0, Math.floor(Number(customer.points) || 0)),
        saleId: sale.id,
        invNo: sale.invNo,
        invoiceId: sale.id,
        rewardId: r.rewardId,
        rewardName: r.rewardName,
        rewardType: r.rewardType,
        status: 'completed',
        description: 'Offer "' + r.rewardName + '" applied on invoice ' + sale.invNo
      });
    }
  });
  if (redeemedPoints > 0) DB.set('customers', customers);
  return redeemedPoints;
}

// Reverses free-product point deductions when the reward line is returned.
// Points are restored once, and only after the full reward quantity for that
// product has been returned across all returns for the invoice.
function reverseRewardPointsForReturn(ret) {
  if (!ret || !ret.customer) return 0;
  const invNo = String(ret.invoice || '').trim();
  if (!invNo) return 0;
  const invNorm = invNo.toLowerCase();
  const sale = (Array.isArray(sales) ? sales : []).find(s => s && String(s.invNo || '').trim().toLowerCase() === invNorm);
  if (!sale || !Array.isArray(sale.rewards) || !sale.rewards.length) return 0;
  const customerId = sale.customerId || null;
  const customer = (Array.isArray(customers) ? customers : []).find(c => c && (c.id === customerId || c.name === ret.customer));
  if (!customer) return 0;

  const returnedQtyFor = (productName) => (Array.isArray(returns) ? returns : [])
    .filter(x => x && String(x.invoice || '').trim().toLowerCase() === invNorm && String(x.product || '').trim().toLowerCase() === String(productName || '').trim().toLowerCase())
    .reduce((sum, x) => sum + (Number(x.qty) || 0), 0);

  let restored = 0;
  sale.rewards.forEach(r => {
    if (r.rewardType !== 'free_product') return;
    if (String(r.productName || '') !== String(ret.product || '')) return;
    if (returnedQtyFor(r.productName) < (Number(r.qty) || 0)) return;
    const key = 'return:' + (ret.returnNo || invNo) + ':reward:' + r.rewardId;
    if (loyaltyTxnExists(key)) return;
    const pts = Math.max(0, Math.floor(Number(r.points) || 0));
    if (pts <= 0) return;
    ensureCustomerLoyaltyFields(customer);
    customer.points = Math.max(0, Math.floor(Number(customer.points) || 0) + pts);
    customer.loyaltyRedeemedTotal = Math.max(0, Math.floor(Number(customer.loyaltyRedeemedTotal) || 0) - pts);
    restored += pts;
    appendLoyaltyTransaction({
      idempotencyKey: key,
      customerId: customer.id,
      customerName: customer.name,
      type: 'adjusted',
      points: pts,
      balanceAfter: customer.points,
      invNo: invNo,
      invoiceId: sale.id,
      rewardId: r.rewardId,
      rewardName: r.rewardName,
      rewardType: 'free_product',
      status: 'reversed',
      description: 'Free product reward reversed by return ' + (ret.returnNo || '')
    });
  });
  if (restored > 0) {
    DB.set('customers', customers);
    if (selectedCustomer && selectedCustomer.id === customer.id) selectedCustomer = customer;
  }
  return restored;
}

// Advance a customer already holds = negative due
function customerAdvance(c) {
  const d = Number(c && c.due) || 0;
  return d < -PAY_EPS ? Math.abs(d) : 0;
}

function customerDueLabel(c) {
  const d = Number(c && c.due) || 0;
  if (d > PAY_EPS) return { text: 'Due ' + fmt(d), cls: 'due-bad' };
  if (d < -PAY_EPS) return { text: 'Advance ' + fmt(-d), cls: 'due-good' };
  return { text: 'No Due', cls: 'due-good' };
}

// Table cell: Due / Advance / Nil
function customerBalanceCell(c) {
  const d = Number(c && c.due) || 0;
  if (d > PAY_EPS) return 'Due ' + fmt(d);
  if (d < -PAY_EPS) return 'Advance ' + fmt(-d);
  return 'Nil';
}

function salePaymentStatus(sale) {
  if (sale.paymentStatus) return sale.paymentStatus;
  const due = Number(sale.balanceDue) || 0;
  if (due > PAY_EPS) return due >= (Number(sale.total) || 0) - PAY_EPS ? 'Unpaid' : 'Partial';
  return 'Paid';
}

function payStatusBadgeClass(status) {
  return status === 'Paid' ? 'paid' : (status === 'Partial' ? 'partial' : 'unpaid');
}

// Tax rows to print on receipts / invoices. New sales carry a taxBreakup;
// older sales fall back to the single aggregated tax value.
function saleTaxLines(sale) {
  const b = sale && sale.taxBreakup;
  const rates = (b && b.rates) || [];
  const single = rates.length === 1 ? rates[0] : null;
  const rows = [];
  if (b) {
    if (Number(b.cgst) > 0.000001) rows.push({ label: single ? gstLabel('CGST', single, true) : 'CGST', value: Number(b.cgst) });
    if (Number(b.sgst) > 0.000001) rows.push({ label: single ? gstLabel('SGST', single, true) : 'SGST', value: Number(b.sgst) });
    if (Number(b.igst) > 0.000001) rows.push({ label: single ? gstLabel('IGST', single, false) : 'IGST', value: Number(b.igst) });
  } else if (Number(sale && sale.tax) > 0.000001) {
    rows.push({ label: 'GST', value: Number(sale.tax) });
  }
  return rows;
}

// Bill totals for the checkout, including loyalty redemption and any advance the customer already holds
function checkoutAmounts() {
  const t = computeCartTotals();
  const shipping = parseFloat(els('shippingInput').value) || 0;
  const discount = parseFloat(els('discountInput').value) || 0;
  const beforeLoyalty = r2(Math.max(0, t.subtotal + t.totalTax + shipping - discount));

  // Loyalty redemption (additive, capped by rules). Never affects existing item/tax calculations.
  let loyaltyPointsRedeemed = 0;
  let loyaltyDiscount = 0;
  let loyaltyRedemption = { allowed: false, points: 0, discount: 0, reason: 'disabled', maxPoints: 0 };
  try {
    if (typeof getLoyaltyRedemptionForCheckout === 'function') {
      loyaltyRedemption = getLoyaltyRedemptionForCheckout({ grand: beforeLoyalty }) || loyaltyRedemption;
      if (loyaltyRedemption.allowed) {
        loyaltyPointsRedeemed = Math.max(0, Math.floor(Number(loyaltyRedemption.points) || 0));
        loyaltyDiscount = r2(Math.max(0, Number(loyaltyRedemption.discount) || 0));
      } else {
        // keep requested input but do not apply if not allowed (UI will explain)
        loyaltyPointsRedeemed = 0;
        loyaltyDiscount = 0;
      }
    }
  } catch (e) { loyaltyPointsRedeemed = 0; loyaltyDiscount = 0; }

  const grand = r2(Math.max(0, beforeLoyalty - loyaltyDiscount));

  const available = r2(selectedCustomer ? customerAdvance(selectedCustomer) : 0);
  const appliedAdvance = r2(Math.min(available, grand));
  const payable = r2(Math.max(0, grand - appliedAdvance));

  return {
    subtotal: t.subtotal, totalTax: t.totalTax, shipping: r2(shipping), discount: r2(discount),
    beforeLoyalty, loyaltyPointsRedeemed, loyaltyDiscount: r2(loyaltyDiscount), loyaltyRedemption,
    grand, available, appliedAdvance, payable,
    cgst: t.cgst, sgst: t.sgst, igst: t.igst, rates: t.rates,
    interState: t.interState, place: t.place, business: t.business, customer: t.customer,
    mode: t.mode
  };
}

// Reads the received amount and derives Paid / Partial / Unpaid + change/advance
function checkoutPaymentState() {
  const a = checkoutAmounts();
  const isCredit = paymentMethod === 'credit';
  const blank = els('tenderedAmount').value.trim() === '';
  const rawGiven = parseFloat(els('tenderedAmount').value);
  const coveredByAdvance = a.payable <= PAY_EPS;
  const received = (isCredit || coveredByAdvance)
    ? 0
    : (blank ? a.payable : Math.max(0, rawGiven || 0));

  const extra = Math.max(0, received - a.payable);
  const short = Math.max(0, a.payable - received);
  const keepExtra = !!els('coKeepAdvance') && els('coKeepAdvance').checked && !!selectedCustomer;

  const change = keepExtra ? 0 : extra;
  const advanceCredit = keepExtra ? extra : 0;
  const balanceDue = short;

  const status = balanceDue > PAY_EPS
    ? (received > PAY_EPS ? 'Partial' : 'Unpaid')
    : 'Paid';

  return Object.assign(a, {
    isCredit, blank, received, extra, short, keepExtra,
    change, advanceCredit, balanceDue, status
  });
}

function updateCheckoutStatus() {
  if (!els('coStatusPanel')) return;
  const p = checkoutPaymentState();
  const isDue = p.balanceDue > PAY_EPS;

  const badge = els('co-statusBadge');
  if (badge) {
    badge.textContent = p.status === 'Partial' ? 'Partially Paid' : p.status;
    badge.setAttribute('data-status', payStatusBadgeClass(p.status));
  }

  els('co-statusTotal').textContent = fmt(p.grand);

  const advRow = els('co-advanceRow');
  if (p.appliedAdvance > 0) {
    advRow.style.display = '';
    els('co-statusAdvance').textContent = '-' + fmt(p.appliedAdvance);
  } else {
    advRow.style.display = 'none';
  }

  els('co-statusReceived').textContent = p.isCredit
    ? 'On credit'
    : (p.payable <= PAY_EPS ? 'Covered by advance'
      : fmt(p.received) + (p.blank ? ' (exact)' : ''));

  els('co-dueRow').classList.toggle('has-due', isDue);
  els('co-statusDue').textContent = fmt(p.balanceDue);

  const changeLabel = els('co-changeLabel');
  const changeVal = els('co-change');
  if (p.advanceCredit > 0) {
    changeLabel.textContent = 'Advance credited';
    changeVal.textContent = fmt(p.advanceCredit);
    changeVal.style.color = 'var(--purple-600)';
  } else if (isDue) {
    changeLabel.textContent = 'Short by';
    changeVal.textContent = fmt(p.balanceDue);
    changeVal.style.color = 'var(--red)';
  } else {
    changeLabel.textContent = 'Change to Return';
    changeVal.textContent = fmt(p.change);
    changeVal.style.color = 'var(--green)';
  }

  const keepRow = els('coKeepAdvanceRow');
  if (keepRow) keepRow.classList.toggle('hidden', !(p.extra > PAY_EPS && selectedCustomer));

  const tendered = els('tenderedAmount');
  const lockAmount = p.isCredit || p.payable <= PAY_EPS;
  if (tendered) tendered.disabled = lockAmount;
  document.querySelectorAll('.quick-amt').forEach(b => { b.disabled = lockAmount; });
  if (els('coTenderedLabel')) {
    els('coTenderedLabel').textContent = p.isCredit
      ? 'On credit — nothing received now'
      : (p.payable <= PAY_EPS ? 'No payment needed — covered by advance' : 'Amount Received');
  }

  const btn = els('confirmPayBtn');
  if (btn) {
    btn.textContent = p.status === 'Unpaid'
      ? '✓ Confirm as Unpaid (Due)'
      : (p.status === 'Partial' ? '✓ Confirm with Due' : '✓ Confirm Payment');
  }
}

function openCheckout() {
  const v = cartValidation();
  if (!v.ok) { toast(v.reason, 'error'); return; }

  const a = checkoutAmounts();

  els('co-subtotal').textContent = fmt(a.subtotal);
  paintTaxRow('co-cgstRow', 'co-cgstLabel', 'co-cgst', 'CGST', a.cgst, a.rates, true);
  paintTaxRow('co-sgstRow', 'co-sgstLabel', 'co-sgst', 'SGST', a.sgst, a.rates, true);
  paintTaxRow('co-igstRow', 'co-igstLabel', 'co-igst', 'IGST', a.igst, a.rates, false);
  const coNote = els('co-gstNote');
  if (coNote) {
    if (a.totalTax > PAY_EPS) {
      coNote.textContent = a.interState
        ? 'Inter-state supply → IGST' + (a.place ? ' (' + a.place.name + ')' : '')
        : 'Intra-state supply → CGST + SGST' + (a.place ? ' (' + a.place.name + ')' : '');
      coNote.parentElement?.classList.remove('hidden');
    } else {
      coNote.parentElement?.classList.add('hidden');
    }
  }
  els('co-shipping').textContent = fmt(a.shipping);
  els('co-discount').textContent = '-' + fmt(a.discount);
  if (els('co-loyaltyDiscount')) els('co-loyaltyDiscount').textContent = '-' + fmt(a.loyaltyDiscount || 0);
  if (els('co-loyaltyRow')) els('co-loyaltyRow').classList.toggle('hidden', !((Number(a.loyaltyDiscount)||0) > PAY_EPS));
  try { setupLoyaltyUiHandlers(); } catch(e){}
  try { renderLoyaltyCheckoutUi(a); } catch(e){}
  els('co-total').textContent = fmt(a.grand);
  els('co-due').textContent = fmt(a.payable);
  if (els('co-advanceNote')) {
    els('co-advanceNote').textContent = a.appliedAdvance > 0
      ? 'After ' + fmt(a.appliedAdvance) + ' advance'
      : '';
  }

  els('tenderedAmount').value = '';
  if (els('coKeepAdvance')) els('coKeepAdvance').checked = false;

  const payLabel = { cash: '💵 Cash', card: '💳 Card', upi: '⚡ UPI', credit: '🏦 Credit' };
  els('checkoutPayMethod').innerHTML = `<div class="badge-pill badge-purple" style="font-size:13px;padding:6px 14px;">${payLabel[paymentMethod] || paymentMethod}</div>`;

  els('checkoutItemsList').innerHTML = cart.map(item => {
    const { total } = calcItemTotal(item);
    return `<div class="checkout-item"><div><div class="ci-name" style="display:flex;align-items:center;gap:6px">${item.image ? `<img src="${item.image}" class="ci-thumb" alt="${item.name}" />` : (item.emoji || '📦')} <span>${item.name}</span></div><div class="ci-qty">${item.qty} × ${fmt(item.price)}</div></div><div class="fw-bold">${fmt(total)}</div></div>`;
  }).join('');

  // Assign handlers instead of addEventListener so reopening never stacks them
  els('tenderedAmount').oninput = () => { try { renderLoyaltyCheckoutUi(checkoutAmounts()); } catch(e){} updateCheckoutStatus(); };
  if (els('coKeepAdvance')) els('coKeepAdvance').onchange = () => { try { renderLoyaltyCheckoutUi(checkoutAmounts()); } catch(e){} updateCheckoutStatus(); };

  document.querySelectorAll('.quick-amt').forEach(b => {
    b.onclick = () => {
      const curA = checkoutAmounts();
      if (b.dataset.amt === 'exact') { els('tenderedAmount').value = curA.payable; }
      else { els('tenderedAmount').value = (parseFloat(els('tenderedAmount').value) || 0) + parseFloat(b.dataset.amt); }
      try { renderLoyaltyCheckoutUi(checkoutAmounts()); } catch(e){}
      updateCheckoutStatus();
    };
  });

  updateCheckoutStatus();
  showModal('checkoutModal');
}

let confirmPaymentInFlight = false;

async function confirmPayment() {
  if (confirmPaymentInFlight) return;
  confirmPaymentInFlight = true;
  try {
    const v = cartValidation();
    if (!v.ok) { toast(v.reason, 'error'); return; }

    // Re-validate every applied reward against live data before committing.
    const rewardCheck = validateRewardsAtCheckout(selectedCustomer);
    if (!rewardCheck.ok) { toast(rewardCheck.reason || 'A reward in the cart is no longer valid.', 'error'); return; }

    const p = checkoutPaymentState();
    const grand = p.payable;

    // Validate the typed payment amount before completing the sale
    if (!p.isCredit && p.payable > PAY_EPS) {
      const raw = els('tenderedAmount').value.trim();
      if (raw !== '') {
        const given = Number(raw);
        if (!Number.isFinite(given) || given < 0) {
          toast('Enter a valid payment amount.', 'error');
          return;
        }
      }
    }

    if (p.balanceDue > PAY_EPS && !selectedCustomer) {
      toast('Select a customer to record the balance due.', 'error');
      return;
    }

    const invNo = 'INV-' + String(invoiceCounter).padStart(4, '0');

    // Server-authoritative plan quota. If the monthly bill limit has been
    // reached the sale is blocked before any stock or invoice changes happen.
    if (window.HisaabSaaS && typeof window.HisaabSaaS.consumeBill === 'function') {
      const gate = await window.HisaabSaaS.consumeBill({
        invNo,
        total: r2(grand),
        items: cart.length,
        customer: selectedCustomer?.name || 'Walk-in'
      });
      if (!gate || gate.allowed !== true) return;
    }

  invoiceCounter++;
  DB.set('invoiceCounter', invoiceCounter);

  // Deduct stock
  const saleMovements = [];
  cart.forEach(item => {
    const pr = products.find(x => x.id === item.id);
    if (pr) {
      const qtySold = Math.max(0, Number(item.qty) || 0);
      pr.stock = Math.max(0, (Number(pr.stock) || 0) - qtySold);
      saleMovements.push({
        type: 'sold', productId: pr.id, productName: pr.name, barcode: pr.barcode || '',
        qtyChange: -qtySold, qtyAfter: pr.stock, note: 'Sale ' + invNo
      });
    }
  });
  DB.set('products', products);
  logStockMovements(saleMovements);

  // Loyalty: finalized values (consistent with payment totals shown/charged)
  let loyaltyApplied = { redeemedPoints: 0, redeemedDiscount: 0, earnedPoints: 0, eligibleAmount: 0, enabled: false };
  const beforeLoyalty = (p && p.beforeLoyalty != null) ? Number(p.beforeLoyalty) : r2((Number(p.subtotal)||0) + (Number(p.totalTax)||0) + (Number(p.shipping)||0) - (Number(p.discount)||0));
  try {
    const s = getLoyaltySettings();
    loyaltyApplied.enabled = !!s.enabled;
    if (selectedCustomer) {
      const custForLoyalty = customers.find(x => x.id === selectedCustomer.id) || selectedCustomer;
      ensureCustomerLoyaltyFields(custForLoyalty);
      // Use redemption already applied in checkout/payment state for consistency with paid amounts
      const reqPts = Math.max(0, Math.floor(Number(p.loyaltyPointsRedeemed || getLoyaltyRedeemPointsInput()) || 0));
      const reqDisc = r2(Math.max(0, Number(p.loyaltyDiscount || 0)));
      if (loyaltyRedeemEnabled() && reqPts > 0 && reqDisc > 0) {
        const red = computeLoyaltyRedemption({ grand: beforeLoyalty }, custForLoyalty, reqPts);
        if (red && red.allowed) {
          loyaltyApplied.redeemedPoints = Math.max(0, Math.floor(Number(red.points)||0));
          loyaltyApplied.redeemedDiscount = r2(Math.max(0, Number(red.discount)||0));
        }
      }
      const earnPreview = computeLoyaltyEarnPreview({ grand: r2(Math.max(0, beforeLoyalty - loyaltyApplied.redeemedDiscount)) }, custForLoyalty, {});
      if (earnPreview && earnPreview.eligible) {
        loyaltyApplied.earnedPoints = Math.max(0, Math.floor(Number(earnPreview.points)||0));
        loyaltyApplied.eligibleAmount = r2(Number(earnPreview.eligibleAmount)||0);
      } else if (earnPreview) {
        loyaltyApplied.eligibleAmount = r2(Number(earnPreview.eligibleAmount)||0);
      }
    }
  } catch (e) { loyaltyApplied = { redeemedPoints: 0, redeemedDiscount: 0, earnedPoints: 0, eligibleAmount: 0, enabled: !!(getLoyaltySettings&&getLoyaltySettings().enabled) }; }

  // Record sale (use payment-state grand for consistency with amount paid/due)
  const finalGrandAfterLoyalty = r2(Number(p.grand != null ? p.grand : Math.max(0, beforeLoyalty - (Number(loyaltyApplied.redeemedDiscount)||0))));
  const sale = {
    id: uid(), invNo, ts: Date.now(), date: now(),
    customer: selectedCustomer?.name || 'Walk-in',
    customerId: selectedCustomer?.id || null,
    customerPhone: (selectedCustomer?.phone || els('customerPhone').value.replace(/\D/g, '')) || null,
    items: cart.map(i => {
      const r = calcItemTotal(i);
      return { ...i, taxableValue: r2(r.taxable), taxAmount: r2(r.taxAmt), lineTotal: r2(r.total) };
    }),
    subtotal: r2(p.subtotal), tax: r2(p.totalTax),
    taxBreakup: { cgst: r2(p.cgst), sgst: r2(p.sgst), igst: r2(p.igst), rates: p.rates || [] },
    taxMode: p.interState ? 'inter' : 'intra',
    placeOfSupply: p.place ? p.place.name : '',
    businessState: p.business ? p.business.name : '',
    shipping: r2(p.shipping), discount: r2(p.discount), total: finalGrandAfterLoyalty,
    loyaltyDiscount: r2(Number(loyaltyApplied.redeemedDiscount)||0),
    loyaltyPointsRedeemed: Math.max(0, Math.floor(Number(loyaltyApplied.redeemedPoints)||0)),
    loyaltyPointsEarned: Math.max(0, Math.floor(Number(loyaltyApplied.earnedPoints)||0)),
    loyalty: {
      enabled: !!loyaltyApplied.enabled,
      eligibleAmount: r2(Number(loyaltyApplied.eligibleAmount)||0),
      pointsEarned: Math.max(0, Math.floor(Number(loyaltyApplied.earnedPoints)||0)),
      pointsRedeemed: Math.max(0, Math.floor(Number(loyaltyApplied.redeemedPoints)||0)),
      discountAmount: r2(Number(loyaltyApplied.redeemedDiscount)||0),
      ruleSnapshot: getLoyaltySettings()
    },
    rewards: rewardCheck.rewards.slice(),
    rewardPointsRedeemed: rewardCheck.rewards.reduce((sum, r) => sum + (r.rewardType === 'free_product' ? Math.max(0, Number(r.points) || 0) : 0), 0),
    payment: paymentMethod,
    paymentStatus: p.status,
    status: p.status,
    amountPaid: +(Math.min(p.received, p.payable) + p.appliedAdvance).toFixed(2),
    balanceDue: +p.balanceDue.toFixed(2),
    advanceUsed: +p.appliedAdvance.toFixed(2),
    advanceCredit: +p.advanceCredit.toFixed(2),
    change: +p.change.toFixed(2)
  };
  sales.unshift(sale);
  DB.set('sales', sales);

  // Update cash drawer with the cash actually kept
  if (paymentMethod === 'cash') {
    const cashIn = Math.max(0, p.received - p.change);
    cashDrawer.cashIn = (cashDrawer.cashIn || 0) + cashIn;
    cashDrawer.log.unshift({ type: 'sale', desc: `Sale ${invNo}`, amount: cashIn, time: now() });
    DB.set('cashDrawer', cashDrawer);
  }

  // Update customer due/advance, purchases, and loyalty (successful sale only; idempotent ledger)
  if (selectedCustomer) {
    const c = customers.find(x => x.id === selectedCustomer.id);
    if (c) {
      ensureCustomerLoyaltyFields(c);
      c.due = +((Number(c.due) || 0) + p.appliedAdvance + p.balanceDue - p.advanceCredit).toFixed(2);
      c.totalPurchases = (Number(c.totalPurchases) || 0) + finalGrandAfterLoyalty;

      // Apply redemption first (never below 0), then earn
      const redeemPts = Math.max(0, Math.floor(Number(loyaltyApplied.redeemedPoints)||0));
      const earnPts = Math.max(0, Math.floor(Number(loyaltyApplied.earnedPoints)||0));
      if (redeemPts > 0 && (c.points >= redeemPts) && !loyaltyTxnExists('sale:' + invNo + ':redeem')) {
        c.points = Math.max(0, Math.floor(Number(c.points)||0) - redeemPts);
        c.loyaltyRedeemedTotal = Math.max(0, Math.floor(Number(c.loyaltyRedeemedTotal)||0) + redeemPts);
        appendLoyaltyTransaction({
          idempotencyKey: 'sale:' + invNo + ':redeem',
          customerId: c.id,
          customerName: c.name,
          type: 'redeemed',
          points: -redeemPts,
          balanceAfter: c.points,
          saleId: sale.id,
          invNo: invNo,
          invoiceId: sale.id,
          description: 'Points redeemed on invoice ' + invNo + ' (' + fmt(loyaltyApplied.redeemedDiscount) + ' discount)'
        });
      }
      if (earnPts > 0 && !loyaltyTxnExists('sale:' + invNo + ':earn')) {
        c.points = Math.max(0, Math.floor(Number(c.points)||0) + earnPts);
        c.loyaltyEarnedTotal = Math.max(0, Math.floor(Number(c.loyaltyEarnedTotal)||0) + earnPts);
        appendLoyaltyTransaction({
          idempotencyKey: 'sale:' + invNo + ':earn',
          customerId: c.id,
          customerName: c.name,
          type: 'earned',
          points: earnPts,
          balanceAfter: c.points,
          saleId: sale.id,
          invNo: invNo,
          invoiceId: sale.id,
          description: 'Points earned on invoice ' + invNo + ' (eligible ' + fmt(loyaltyApplied.eligibleAmount) + ')'
        });
      }
      DB.set('customers', customers);
      selectedCustomer = c;

      // Consume free-product rewards only after the sale is committed, then
      // evaluate any pending referrals for this customer.
      try {
        const consumed = consumeRewardsForSale(sale, c);
        if (consumed > 0) sale.rewardPointsRedeemed = consumed;
      } catch (e) { /* reward consumption is best-effort; ledger stays consistent */ }
      try { qualifyReferralsForCustomer(c.id, sale); } catch (e) { /* referral qualification is best-effort */ }
    }
  }

  renderReceipt(sale, p.change);
  hideModal('checkoutModal');
  showModal('receiptModal');
  els('invoiceNumber').textContent = '#' + 'INV-' + String(invoiceCounter).padStart(4, '0');

    // Remember this sale for the receipt's "Send via WhatsApp" button,
    // and auto-send when enabled in the WhatsApp settings.
    window.__lastSale = sale;
    if (window.HisaabWhatsApp) window.HisaabWhatsApp.onSaleComplete(sale);

    // Keep subscription/usage in sync with the server after a completed bill.
    try {
      if (window.HisaabSaaS && typeof window.HisaabSaaS.refresh === 'function') {
        window.HisaabSaaS.refresh({ silent: true });
      }
    } catch (e) { }

    resetCart();
  } finally {
    confirmPaymentInFlight = false;
  }
}

function renderReceipt(sale, change) {
  const status = salePaymentStatus(sale);
  const due = Math.max(0, Number(sale.balanceDue) || 0);
  const advance = Math.max(0, Number(sale.advanceCredit) || 0);
  const advanceUsed = Math.max(0, Number(sale.advanceUsed) || 0);
  const paid = sale.amountPaid !== undefined && sale.amountPaid !== null
    ? Number(sale.amountPaid)
    : (due > 0 ? Math.max(0, (Number(sale.total) || 0) - due) : (Number(sale.total) || 0));
  const changeGiven = sale.change !== undefined && sale.change !== null
    ? Number(sale.change)
    : Math.max(0, Number(change) || 0);

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const total = Math.max(0, Number(sale.total) || 0);
  const items = Array.isArray(sale.items) ? sale.items : [];
  const itemCount = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

  const payLabel = ({ cash: 'Cash', card: 'Card', upi: 'UPI', credit: 'Credit' })[String(sale.payment || '').toLowerCase()]
    || String(sale.payment || '').toUpperCase();

  const statusLabel = status === 'Paid' ? 'Paid' : (status === 'Partial' ? 'Partially paid' : 'Unpaid');
  const statusCls = status === 'Paid' ? 'is-paid' : (status === 'Partial' ? 'is-partial' : 'is-unpaid');

  const customerName = !sale.customer || sale.customer === 'Walk-in' ? 'Walk-in Customer' : sale.customer;
  const customerMeta = status === 'Unpaid' ? 'Payment pending' : 'Paid via ' + payLabel;

  const itemRows = items.map(i => {
    const lineTotal = (i.lineTotal !== undefined && i.lineTotal !== null)
      ? Number(i.lineTotal)
      : calcItemTotal(i).total;
    return `<div class="rcpt-item">
        <span class="rcpt-item-name">${esc(i.name)} <span class="rcpt-item-qty">× ${Number(i.qty) || 1}</span></span>
        <span class="rcpt-item-total">${fmt(lineTotal)}</span>
      </div>`;
  }).join('');

  const taxRows = saleTaxLines(sale)
    .filter(r => Number(r.value) > PAY_EPS)
    .map(r => `<div class="rcpt-line"><span>${esc(r.label)}</span><span>${fmt(r.value)}</span></div>`)
    .join('');

  const paidPct = total > 0 ? Math.max(0, Math.min(100, (Math.min(paid, total) / total) * 100)) : 0;

  let dateStr = sale.date || '';
  const dt = sale.ts ? new Date(sale.ts) : null;
  if (dt && !isNaN(dt.getTime())) {
    dateStr = dt.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
      + ' · ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  const inv = String(sale.invNo || '').trim();
  if (els('receiptInv')) els('receiptInv').textContent = inv ? (inv.startsWith('#') ? inv : '#' + inv) : '';
  if (els('receiptDate')) els('receiptDate').textContent = dateStr;

  els('receiptContent').innerHTML = `
    <div class="rcpt-label">Customer</div>
    <div class="rcpt-customer">
      <span class="rcpt-cust-avatar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 19.5a7 7 0 0 1 14 0" />
        </svg>
      </span>
      <span class="rcpt-cust-main">
        <span class="rcpt-cust-name">${esc(customerName)}</span>
        <span class="rcpt-cust-meta">${esc(customerMeta)}</span>
      </span>
      <span class="rcpt-badge ${statusCls}">${statusLabel}</span>
    </div>

    <div class="rcpt-sum-head">
      <span class="rcpt-label">Order Summary</span>
      <span class="rcpt-count">${itemCount} item${itemCount === 1 ? '' : 's'}</span>
    </div>
    <div class="rcpt-items">${itemRows}</div>

    <div class="rcpt-lines">
      <div class="rcpt-line"><span>Subtotal</span><span>${fmt(sale.subtotal)}</span></div>
      ${taxRows}
      <div class="rcpt-line"><span>Shipping Charges</span><span>${fmt(sale.shipping)}</span></div>
      <div class="rcpt-line"><span>Discount</span><span>−${fmt(sale.discount)}</span></div>
    </div>
    <div class="rcpt-total"><span>Total Amount</span><span>${fmt(total)}</span></div>

    <div class="rcpt-paycard">
      <div class="rcpt-progress"><span style="width:${paidPct}%"></span></div>
      <div class="rcpt-payrow"><span>Paid</span><span class="rcpt-paid">${fmt(paid)}</span></div>
      <div class="rcpt-payrow"><span>Balance due</span><span class="rcpt-due">${fmt(due)}</span></div>
      ${advanceUsed > 0 ? `<div class="rcpt-payrow"><span>Advance used</span><span>−${fmt(advanceUsed)}</span></div>` : ''}
      ${advance > 0 ? `<div class="rcpt-payrow"><span>Advance credit</span><span>${fmt(advance)}</span></div>` : ''}
      ${changeGiven > 0 ? `<div class="rcpt-payrow"><span>Change</span><span>${fmt(changeGiven)}</span></div>` : ''}
    </div>`;

  // Headline reflects the actual payment state
  const title = els('receiptTitle');
  const icon = els('receiptIcon');
  if (title) title.textContent = status === 'Unpaid' ? 'Bill saved' : 'Payment recorded';
  if (icon) {
    icon.textContent = status === 'Paid' ? '✓' : (status === 'Partial' ? '₹' : '!');
    icon.classList.toggle('is-partial', status === 'Partial');
    icon.classList.toggle('is-unpaid', status === 'Unpaid');
  }
}

// ─── PRINT BILL TEMPLATE ─────────────────────────────────────
function inrAmountToWords(amount) {
  const n = Math.round((Number(amount) || 0) * 100);
  const rupees = Math.floor(n / 100);
  const paise = n % 100;
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const toWords = (num) => {
    let s = '';
    if (num >= 10000000) { s += toWords(Math.floor(num / 10000000)) + ' Crore '; num %= 10000000; }
    if (num >= 100000) { s += toWords(Math.floor(num / 100000)) + ' Lakh '; num %= 100000; }
    if (num >= 1000) { s += toWords(Math.floor(num / 1000)) + ' Thousand '; num %= 1000; }
    if (num >= 100) { s += ones[Math.floor(num / 100)] + ' Hundred '; num %= 100; }
    if (num > 0) {
      if (s) s += '';
      if (num < 20) s += ones[num] + ' ';
      else s += tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '') + ' ';
    }
    return s;
  };
  let out = '';
  if (rupees > 0) out += toWords(rupees).trim() + ' Rupees';
  if (paise > 0) out += (rupees > 0 ? ' and ' : '') + toWords(paise).trim() + ' Paise';
  return out.trim() + ' Only';
}

/* ─── Receipt watermark gate ────────────────────────────────────
   Delegates to window.HisaabSaaS.canShowWatermark() which resolves
   from the active subscription plan's flags.pdfWatermark (set by
   Super Admin in the plan catalog). Falls back to the plan chosen
   during onboarding (stored in posSettings.saasPlanWatermark) when
   SaaS is not yet initialized. Offline/local mode defaults to true
   (free plan behaviour). Backend-enforced via entitlements.
   ────────────────────────────────────────────────────────────── */
function windowHisaabCanShowWatermark() {
  if (window.HisaabSaaS && typeof window.HisaabSaaS.canShowWatermark === 'function') {
    try { return window.HisaabSaaS.canShowWatermark(); } catch (e) { /* fall through to local */ }
  }
  // Fallback: use the plan chosen during onboarding
  const pos = getPosSettings ? getPosSettings() : {};
  if (pos && Object.prototype.hasOwnProperty.call(pos, 'saasPlanWatermark')) {
    return !!pos.saasPlanWatermark;
  }
  return true;
}

function buildPrintBillHtml(sale, pos, pt) {
  if (!sale) return '';
  pos = pos || getPosSettings() || {};
  pt = Object.assign({}, POS_SETTINGS_DEFAULTS.printTemplate || {}, (pt || (pos && pos.printTemplate) || {}));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const sym = (typeof pos.currencySymbol === 'string' && pos.currencySymbol) ? pos.currencySymbol : '₹';
  const money = v => sym + (Number(v) || 0).toFixed(2);

  const items = Array.isArray(sale.items) ? sale.items : [];
  const inv = String(sale.invNo || '').trim();
  const invText = inv ? (inv.startsWith('#') ? inv : '#' + inv) : '';
  let dateStr = sale.date || '';
  let timeStr = '';
  const dt = sale.ts ? new Date(sale.ts) : null;
  if (dt && !isNaN(dt.getTime())) {
    dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  const customerName = !sale.customer || sale.customer === 'Walk-in' ? 'Walk-in Customer' : sale.customer;
  const customerPhone = sale.customerPhone || sale.phone || '';
  const total = Math.max(0, Number(sale.total) || 0);
  const paid = sale.amountPaid !== undefined && sale.amountPaid !== null
    ? Number(sale.amountPaid)
    : (Number(sale.due) > 0 ? Math.max(0, total - Number(sale.due)) : total);
  const due = sale.due !== undefined && sale.due !== null ? Number(sale.due) : Math.max(0, total - paid);
  const changeGiven = sale.change !== undefined && sale.change !== null ? Number(sale.change) : 0;
  const payLabel = ({ cash: 'Cash', card: 'Card', upi: 'UPI', credit: 'Credit' })[String(sale.payment || '').toLowerCase()]
    || String(sale.payment || '').toUpperCase() || '—';

  const showHsn = !!pt.showItemHsn;
  const showTax = !!pt.showItemTax;
  const showDisc = !!pt.showItemDiscount;

  // Logo is resolved independently of the caller so every template
  // (80mm, 58mm, A4) shows the saved store logo when enabled.
  const storeLogo = resolveStoreLogo(pos);

  const header = `
    <div class="pbill-header">
      ${pt.showLogo && storeLogo ? `<img src="${esc(storeLogo)}" alt="Store logo" class="pbill-logo" />` : ''}
      ${pt.showStoreName ? `<h1 class="pbill-store">${esc(pos.storeName || 'Hisaab POS')}</h1>` : ''}
      ${pt.showStoreAddress && pos.storeAddress ? `<div class="pbill-meta-line">${esc(pos.storeAddress)}</div>` : ''}
      ${pt.showStorePhone && pos.storePhone ? `<div class="pbill-meta-line">Ph: ${esc(pos.storePhone)}</div>` : ''}
      ${pt.showStoreEmail && pos.storeEmail ? `<div class="pbill-meta-line">${esc(pos.storeEmail)}</div>` : ''}
      ${pt.showGstin && pos.gstin ? `<div class="pbill-meta-line"><strong>GSTIN:</strong> ${esc(pos.gstin)}</div>` : ''}
    </div>`;

  const meta = pt.showInvoiceMeta ? `
    <hr class="pbill-hr" />
    <div class="pbill-row pbill-invoice-row"><span><strong>Invoice:</strong> ${esc(invText || '—')}</span>${timeStr ? `<span>${esc(timeStr)}</span>` : ''}</div>
    ${dateStr ? `<div class="pbill-row pbill-date-row"><span>${esc(dateStr)}</span></div>` : ''}
  ` : '';

  const customer = pt.showCustomer ? `
    <hr class="pbill-hr" />
    <div class="pbill-row pbill-customer-row"><span>${esc(customerName)}</span>${customerPhone ? `<span>${esc(customerPhone)}</span>` : ''}</div>
  ` : '';

  const paper = pt.paperSize === 'a4' ? 'a4' : (pt.paperSize === 'thermal58' ? 'thermal58' : 'thermal');
  const thermal58 = paper === 'thermal58';
  const th = thermal58
    ? `<tr><th class="pbill-item-h">Item</th><th class="num pbill-amt-h">Amt</th></tr>`
    : `<tr>
      <th>#</th>
      <th>Item</th>
      ${showHsn ? '<th>HSN</th>' : ''}
      <th class="num">Qty</th>
      <th class="num">Rate</th>
      ${showDisc ? '<th class="num">Disc</th>' : ''}
      ${showTax ? '<th class="num">Tax%</th>' : ''}
      <th class="num">Amt</th>
    </tr>`;
  const rows = items.map((it, i) => {
    const lt = (it.lineTotal !== undefined && it.lineTotal !== null) ? Number(it.lineTotal) : (typeof calcItemTotal === 'function' ? calcItemTotal(it).total : (Number(it.price)||0)*(Number(it.qty)||1));
    const disc = Number(it.itemDiscount) || 0;
    const qty = Number(it.qty) || 1;
    const detail = thermal58
      ? `<div class="pbill-item-detail">${qty} × ${money(it.price)}${disc ? ` · Disc ${disc}%` : ''}${showTax ? ` · Tax ${Number(it.tax)}%` : ''}</div>`
      : '';
    if (thermal58) {
      return `<tr>
        <td class="pbill-item-cell"><div class="pbill-item-name">${i + 1}. ${esc(it.name || 'Item')}</div>${detail}</td>
        <td class="num pbill-item-amt">${money(lt)}</td>
      </tr>`;
    }
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(it.name || 'Item')}</td>
      ${showHsn ? `<td>${esc(it.hsn || it.sku || '—')}</td>` : ''}
      <td class="num">${qty}</td>
      <td class="num">${money(it.price)}</td>
      ${showDisc ? `<td class="num">${disc ? disc + '%' : '—'}</td>` : ''}
      ${showTax ? `<td class="num">${(Number(it.tax) || 0)}%</td>` : ''}
      <td class="num">${money(lt)}</td>
    </tr>`;
  }).join('');

  const taxRows = (pt.showTaxBreakup && typeof saleTaxLines === 'function')
    ? saleTaxLines(sale).filter(r => Number(r.value) > 0.009).map(r => `<div class="pbill-row"><span>${esc(r.label)}</span><span>${money(r.value)}</span></div>`).join('')
    : '';

  const totals = `
    <hr class="pbill-hr" />
    <div class="pbill-totals">
      ${pt.showSubtotal ? `<div class="pbill-row"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>` : ''}
      ${taxRows}
      ${pt.showShipping ? `<div class="pbill-row"><span>Shipping</span><span>${money(sale.shipping)}</span></div>` : ''}
      ${pt.showDiscount ? `<div class="pbill-row"><span>Discount</span><span>-${money(sale.discount)}</span></div>` : ''}
      ${pt.showGrandTotal ? `<div class="pbill-row pbill-grand"><span>TOTAL</span><span>${money(total)}</span></div>` : ''}
      ${pt.showAmountInWords ? `<div class="pbill-words">Amount: ${esc(inrAmountToWords(total))}</div>` : ''}
    </div>`;

  const payment = pt.showPaymentDetails ? `
    <div class="pbill-totals pbill-pay-details">
      <div class="pbill-row"><span>Payment</span><span>${esc(payLabel)}</span></div>
      <div class="pbill-row"><span>Paid</span><span>${money(paid)}</span></div>
      ${due > 0.009 ? `<div class="pbill-row"><span>Balance Due</span><span>${money(due)}</span></div>` : ''}
      ${changeGiven > 0.009 ? `<div class="pbill-row"><span>Change</span><span>${money(changeGiven)}</span></div>` : ''}
    </div>` : '';

  const footer = pt.showFooter && pos.receiptFooter ? `<div class="pbill-footer">${esc(pos.receiptFooter)}</div>` : '';
  const terms = pt.showTerms && pt.termsText ? `<div class="pbill-terms">${esc(pt.termsText)}</div>` : '';

  // HISAAB watermark: gated by plan entitlement (Super Admin plan flag: pdfWatermark)
  const watermark = windowHisaabCanShowWatermark()
    ? (paper === 'a4'
      ? `<div class="pbill-watermark pbill-watermark-a4"><span>HISAAB</span></div>`
      : `<div class="pbill-watermark pbill-watermark-thermal"></div>`)
    : '';

  const colCount = thermal58 ? 2 : (5 + (showHsn ? 1 : 0) + (showDisc ? 1 : 0) + (showTax ? 1 : 0));
  return `<div class="pbill pbill-${paper}">
    ${header}
    ${meta}
    ${customer}
    <hr class="pbill-hr" />
    <table class="pbill-items"><thead>${th}</thead><tbody>${rows || `<tr><td colspan="${colCount}">No items</td></tr>`}</tbody></table>
    ${totals}
    ${payment}
    ${footer}
    ${terms}
    ${watermark}
  </div>`;
}

function samplePrintBillSale() {
  return {
    invNo: 'INV-0001',
    ts: Date.now(),
    date: now ? now() : new Date().toLocaleString('en-IN'),
    customer: 'Sample Customer',
    customerPhone: '9876543210',
    items: [
      { name: 'Sample Product A', qty: 2, price: 120, itemDiscount: 5, tax: 5, hsn: '1006', lineTotal: 228, taxableValue: 216.67, taxAmount: 10.83 },
      { name: 'Sample Product B', qty: 1, price: 250, itemDiscount: 0, tax: 18, hsn: '2106', lineTotal: 295, taxableValue: 250, taxAmount: 45 }
    ],
    subtotal: 490,
    tax: 56.33,
    taxBreakup: { cgst: 28.17, sgst: 28.16, igst: 0, rates: [5, 18] },
    taxMode: 'intra',
    businessState: (getPosSettings().state || ''),
    placeOfSupply: (getPosSettings().state || ''),
    shipping: 20,
    discount: 10,
    total: 556.33,
    payment: 'cash',
    paymentStatus: 'Paid',
    status: 'Paid',
    amountPaid: 556.33,
    balanceDue: 0,
    change: 0
  };
}

function renderPrintBillPreview() {
  const area = document.getElementById('printBillPreview');
  if (!area) return;
  const pos = Object.assign({}, getPosSettings() || {}, {});
  // reflect unsaved store basics if their inputs exist (nice-to-have) - template is the focus
  const gv = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  if (gv('stgStoreName')) pos.storeName = gv('stgStoreName');
  if (document.getElementById('stgStorePhone')) pos.storePhone = gv('stgStorePhone');
  if (document.getElementById('stgStoreEmail')) pos.storeEmail = gv('stgStoreEmail');
  if (document.getElementById('stgStoreAddress')) pos.storeAddress = gv('stgStoreAddress');
  if (document.getElementById('stgGstin')) pos.gstin = gv('stgGstin').toUpperCase();
  if (document.getElementById('stgReceiptFooter')) pos.receiptFooter = gv('stgReceiptFooter');
  // Reflect unsaved store logo from the preview element (uploaded but not yet saved)
  const logoImg = document.getElementById('stgLogoPreview')?.querySelector('img');
  if (logoImg && logoImg.src) pos.storeLogo = logoImg.src;
  else pos.storeLogo = resolveStoreLogo(pos);
  const pt = collectPrintTemplateFromForm(pos.printTemplate);
  pos.printTemplate = pt;
  area.innerHTML = buildPrintBillHtml(samplePrintBillSale(), pos, pt);
  area.classList.toggle('is-a4', pt.paperSize === 'a4');
  area.classList.toggle('is-thermal58', pt.paperSize === 'thermal58');
}

function getPrintTemplatePreviewState() {
  const pos = Object.assign({}, getPosSettings() || {}, {});
  const gv = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  if (document.getElementById('stgStoreName') && gv('stgStoreName')) pos.storeName = gv('stgStoreName');
  if (document.getElementById('stgStorePhone')) pos.storePhone = gv('stgStorePhone');
  if (document.getElementById('stgStoreEmail')) pos.storeEmail = gv('stgStoreEmail');
  if (document.getElementById('stgStoreAddress')) pos.storeAddress = gv('stgStoreAddress');
  if (document.getElementById('stgGstin')) pos.gstin = gv('stgGstin').toUpperCase();
  if (document.getElementById('stgReceiptFooter')) pos.receiptFooter = gv('stgReceiptFooter');
  const logoImg = document.getElementById('stgLogoPreview')?.querySelector('img');
  if (logoImg && logoImg.src) pos.storeLogo = logoImg.src;
  else pos.storeLogo = resolveStoreLogo(pos);
  const pt = collectPrintTemplateFromForm(pos.printTemplate);
  pos.printTemplate = pt;
  return { pos, pt };
}

function testPrintBillTemplate() {
  const state = getPrintTemplatePreviewState();
  const html = buildPrintBillHtml(samplePrintBillSale(), state.pos, state.pt);
  const area = document.getElementById('printBillArea');
  if (!area || !html) { toast('Unable to generate test print preview', 'error'); return; }
  const prev = area.innerHTML;
  area.innerHTML = html;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    // Restore previous print area content (e.g. last actual receipt) after print dialog closes
    area.innerHTML = prev || '';
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  // Fallback restore in case afterprint doesn't fire in some environments
  setTimeout(restore, 3000);
  setTimeout(() => window.print(), 50);
}

function renderPrintBill(sale) {
  if (!sale) return;
  const pos = getPosSettings();
  const pt = (pos && pos.printTemplate) || POS_SETTINGS_DEFAULTS.printTemplate || {};
  const html = buildPrintBillHtml(sale, pos, pt);
  const area = document.getElementById('printBillArea');
  if (area) area.innerHTML = html;
}

function resetCart() {
  cart = [];
  selectedCustomer = null;
  try { if (typeof setLoyaltyRedeemPointsInput === 'function') setLoyaltyRedeemPointsInput(0); } catch (e) {}
  els('customerPhone').value = '';
  els('customerCard').classList.add('hidden');
  els('noCustomer').classList.remove('hidden');
  hideCustomerNotFound();
  els('clearCustomerBtn')?.classList.add('hidden');
  if (els('shippingInput')) els('shippingInput').value = 0;
  if (els('discountInput')) els('discountInput').value = 0;
  if (els('saleNote')) els('saleNote').value = '';
  try { if (typeof syncLoyaltyPosUi === 'function') syncLoyaltyPosUi(); } catch (e) {}
  renderCart();
}

// ─── NAVIGATION & RESPONSIVE UX ─────────────────────────────
let switchView; // Global reference

// --- URL / route persistence -------------------------------------------
// The active view is mirrored in the URL hash (e.g. #inventory) so a page
// refresh keeps the user on the same screen. Home/POS and landing keep a
// clean "/" URL, and Supabase auth hashes are never touched.
let routeHydrated = false;
let initialRouteView = '';

function isAuthHashPresent() {
  const h = window.location.hash || '';
  if (!h || h.length < 2) return false;
  return /(?:^#|[&#])(access_token|refresh_token|provider_token|expires_in|token_type|error|error_code|error_description)=|[?&#]type=(recovery|invite|signup|magiclink|email_change)\b/i.test(h);
}

function getViewFromHash() {
  let h = window.location.hash || '';
  if (!h || h === '#' || isAuthHashPresent()) return '';
  let raw = h.slice(1);
  if (raw.charAt(0) === '/') raw = raw.slice(1);
  raw = raw.split('?')[0].split('&')[0];
  try { raw = decodeURIComponent(raw); } catch (e) { raw = ''; }
  raw = String(raw || '').trim().replace(/\/+$/, '');
  if (!raw || raw === 'landing') return '';
  const el = document.getElementById('view-' + raw);
  if (!el || !el.classList.contains('view')) return '';
  return raw;
}

function getActiveViewName() {
  const el = document.querySelector('.view.active');
  return (el && el.id.indexOf('view-') === 0) ? el.id.slice(5) : 'pos';
}

function syncViewUrl(v) {
  if (!routeHydrated) return;
  if (isAuthHashPresent()) return;
  const target = (!v || v === 'pos' || v === 'landing') ? '' : '#' + v;
  if ((window.location.hash || '') === target) return;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + target);
  } catch (e) {
    if (target) window.location.hash = target.slice(1);
  }
}

function setupRouteNavigation() {
  window.addEventListener('hashchange', function () {
    if (!routeHydrated || isAuthHashPresent()) return;
    const v = getViewFromHash();
    if (!v) return;
    const el = document.getElementById('view-' + v);
    if (el && el.classList.contains('active')) return;
    switchToView(v);
  });
}

function applyInitialRoute() {
  // Cloud signed-out / landing flow always wins over a deep-linked hash.
  if (document.body.classList.contains('landing-active')) {
    syncViewUrl('landing');
    return;
  }
  if (initialRouteView && initialRouteView !== 'pos') {
    // Re-apply only while the URL still asks for that view. Once the user
    // navigates elsewhere (or goes Home) the hash no longer matches, so
    // later cloud "ready" events cannot pull them back.
    if ((window.location.hash || '') !== '#' + initialRouteView) return;
    const el = document.getElementById('view-' + initialRouteView);
    if (el && !el.classList.contains('active')) {
      switchToView(initialRouteView);
      return; // switchView keeps the URL in sync (or fixes it if gated)
    }
  }
  syncViewUrl(getActiveViewName());
}

function openMobileDrawer() {
  const sidebar = els('sidebar');
  const overlay = els('sidebarOverlay');
  if (sidebar) sidebar.classList.add('open');
  if (overlay) overlay.classList.add('active');
}

function closeMobileDrawer() {
  const sidebar = els('sidebar');
  const overlay = els('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}

function setMobilePosTab(tab) {
  const tabCart = els('posTabCart');
  const tabBill = els('posTabBill');
  const cartArea = document.querySelector('.cart-area');
  const rightPanel = document.querySelector('.right-panel');

  if (tab === 'cart') {
    tabCart?.classList.add('active');
    tabBill?.classList.remove('active');
    if (window.innerWidth <= 768) {
      if (cartArea) cartArea.style.display = 'flex';
      if (rightPanel) rightPanel.style.display = 'none';
    }
  } else if (tab === 'bill') {
    tabBill?.classList.add('active');
    tabCart?.classList.remove('active');
    if (window.innerWidth <= 768) {
      if (cartArea) cartArea.style.display = 'none';
      if (rightPanel) rightPanel.style.display = 'flex';
    }
  }
}

function setupNav() {
  switchView = function (v) {
    // Plan-based restriction: paid views are blocked before navigation,
    // so the user stays on the current screen with an upgrade prompt.
    if (window.HisaabSaaS && typeof window.HisaabSaaS.canView === 'function') {
      if (!window.HisaabSaaS.canView(v)) {
        // Blocked by plan: keep the URL in sync with the screen still shown.
        syncViewUrl(getActiveViewName());
        return;
      }
    }

    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));

    if (typeof updateMoreNavState === 'function') updateMoreNavState(v);

    if (v === 'pos') {
      if (window.innerWidth <= 768) setMobilePosTab('cart');
      if (typeof renderPosCatalog === 'function') renderPosCatalog();
    }
    if (v === 'inventory') renderInventory();
    if (v === 'sales') renderSales();
    if (v === 'customers') renderCustomers();
    if (v === 'damage') renderDamage();
    if (v === 'returns') renderReturns();
    if (v === 'stock-timeline') renderStockTimeline();
    if (v === 'categories-subcategories') renderCategoriesSubcategories();
    if (v === 'help-tutorials' && typeof renderHelpTutorialsView === 'function') renderHelpTutorialsView();
    if (v === 'whatsapp' && window.HisaabWhatsApp) window.HisaabWhatsApp.renderView();
    if (v === 'settings' && typeof renderSettingsView === 'function') renderSettingsView();
    if (v === 'loyalty' && typeof renderLoyaltyView === 'function') renderLoyaltyView();
    if (v === 'subscription' && window.HisaabSaaS) window.HisaabSaaS.renderSubscriptionView();
    if (v === 'admin' && window.HisaabSaaS) window.HisaabSaaS.renderAdminView();

    closeMobileDrawer();

    const activeView = els('view-' + v);
    if (activeView) activeView.scrollTop = 0;

    syncViewUrl(v);
  };

  // Logo click -> POS view
  const logoBtn = document.getElementById('logoBtn') || document.querySelector('.logo');
  if (logoBtn) {
    logoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('pos');
    });
  }

  // Sidebar items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  // Mobile Bottom Nav items
  document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  // Mobile drawer controls
  els('sidebarToggle')?.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      openMobileDrawer();
    }
  });
  els('mobileMenuBtn')?.addEventListener('click', openMobileDrawer);
  els('closeDrawerBtn')?.addEventListener('click', closeMobileDrawer);
  els('sidebarOverlay')?.addEventListener('click', closeMobileDrawer);

  // Mobile POS tabs & transitions
  els('posTabCart')?.addEventListener('click', () => setMobilePosTab('cart'));
  els('posTabBill')?.addEventListener('click', () => setMobilePosTab('bill'));
  els('mobileProceedBtn')?.addEventListener('click', () => {
    const v = cartValidation();
    if (!v.ok) { toast(v.reason, 'error'); return; }
    setMobilePosTab('bill');
  });
  els('btnBackToCart')?.addEventListener('click', () => setMobilePosTab('cart'));

  // Quick action footer buttons
  const navMap = {
    newSaleBtn: () => resetCart(),
    allCustomersBtn: () => switchView('customers'),
    damageBtn: () => switchView('damage'),
    returnBtn: () => switchView('returns'),
    inventoryBtn: () => switchView('inventory')
  };
  Object.entries(navMap).forEach(([id, fn]) => els(id)?.addEventListener('click', fn));

  // Handle window resize between mobile and laptop/desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMobileDrawer();
      const cartArea = document.querySelector('.cart-area');
      const rightPanel = document.querySelector('.right-panel');
      if (cartArea) cartArea.style.display = '';
      if (rightPanel) rightPanel.style.display = '';
    } else {
      const isBillActive = els('posTabBill')?.classList.contains('active');
      setMobilePosTab(isBillActive ? 'bill' : 'cart');
    }
  });
}

// ─── INVENTORY ───────────────────────────────────────────────
let invFilter = 'all';
let invSort = 'name';

function invStockQty(p) {
  const n = Number(p && p.stock);
  return Number.isFinite(n) ? n : 0;
}

function invStockStatus(p) {
  const stock = invStockQty(p);
  const min = Number(p && p.minStock) || 0;
  if (stock <= 0) return 'out';
  if (stock <= min) return 'low';
  return 'in';
}

function setInvFilter(filter) {
  invFilter = ['all', 'in', 'low', 'out'].includes(filter) ? filter : 'all';
  renderInventory();
}

function setInvSort(sort) {
  invSort = sort || 'name';
  renderInventory();
}

function clearInventoryFilters() {
  const input = els('inventorySearchInput');
  if (input) input.value = '';
  invFilter = 'all';
  renderInventory();
}

function renderInventory() {
  if (typeof renderPosCatalog === 'function') renderPosCatalog();

  // The "In stock" tab is hidden on phones (All already covers it). Keep the
  // filter state consistent if the layout crosses the mobile breakpoint.
  if (invFilter === 'in' && window.matchMedia('(max-width: 768px)').matches) invFilter = 'all';

  const totalVal = products.reduce((s, p) => s + (Number(p.price) || 0) * invStockQty(p), 0);
  const statusCounts = { all: products.length, in: 0, low: 0, out: 0 };
  products.forEach(p => { statusCounts[invStockStatus(p)] += 1; });

  const categoryCount = new Set(products.map(p => (p.category || '').trim()).filter(Boolean)).size;
  const subline = els('inventorySubline');
  if (subline) {
    subline.textContent = `${products.length} product${products.length === 1 ? '' : 's'} · ${fmt(totalVal)} stock value`;
  }

  const ico = paths => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const statsEl = els('inventoryStats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="inv-stat inv-stat--purple">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>')}</span><span class="inv-stat-label">Total products</span></div>
        <div class="inv-stat-value">${products.length}</div>
        <div class="inv-stat-foot">${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}</div>
      </div>
      <div class="inv-stat inv-stat--green">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>')}</span><span class="inv-stat-label">Inventory value</span></div>
        <div class="inv-stat-value">${fmt(totalVal)}</div>
        <div class="inv-stat-foot">At selling price</div>
      </div>
      <div class="inv-stat inv-stat--amber">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>')}</span><span class="inv-stat-label">Low stock</span></div>
        <div class="inv-stat-value${statusCounts.low ? ' is-warn' : ''}">${statusCounts.low}</div>
        <div class="inv-stat-foot">At or below minimum</div>
      </div>
      <div class="inv-stat inv-stat--red">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>')}</span><span class="inv-stat-label">Out of stock</span></div>
        <div class="inv-stat-value${statusCounts.out ? ' is-danger' : ''}">${statusCounts.out}</div>
        <div class="inv-stat-foot">${statusCounts.out ? 'Needs restocking' : 'Everything available'}</div>
      </div>`;
  }

  // Filter tab counts
  const countIds = { all: 'invCountAll', in: 'invCountIn', low: 'invCountLow', out: 'invCountOut' };
  Object.keys(countIds).forEach(key => {
    const el = els(countIds[key]);
    if (el) el.textContent = statusCounts[key];
  });
  document.querySelectorAll('#inventoryTabs .inv-tab').forEach(tab => {
    const active = tab.dataset.invFilter === invFilter;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const q = (els('inventorySearchInput')?.value || '').trim().toLowerCase();
  const clearBtn = els('inventorySearchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !q);

  let list = q
    ? products.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.barcode && String(p.barcode).toLowerCase().includes(q)) ||
      (p.sku && String(p.sku).toLowerCase().includes(q)) ||
      (p.hsn && String(p.hsn).includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    )
    : products.slice();

  if (invFilter !== 'all') list = list.filter(p => invStockStatus(p) === invFilter);

  const sorters = {
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
    'stock-asc': (a, b) => invStockQty(a) - invStockQty(b),
    'stock-desc': (a, b) => invStockQty(b) - invStockQty(a),
    'price-desc': (a, b) => (Number(b.price) || 0) - (Number(a.price) || 0)
  };
  list.sort(sorters[invSort] || sorters.name);

  const sortSelect = els('inventorySort');
  if (sortSelect && sortSelect.value !== invSort) sortSelect.value = invSort;

  const countEl = els('inventoryCount');
  if (countEl) {
    countEl.textContent = list.length === products.length
      ? `${products.length} product${products.length === 1 ? '' : 's'}`
      : `${list.length} of ${products.length} products`;
  }
  const footEl = els('inventoryFoot');
  if (footEl) {
    footEl.textContent = `Showing ${list.length} of ${products.length} product${products.length === 1 ? '' : 's'}`;
  }

  if (!list.length) {
    const filtering = !!q || invFilter !== 'all';
    els('inventoryBody').innerHTML = products.length
      ? `<tr class="inv-empty-row"><td colspan="6"><div class="inv-empty">
           <div class="inv-empty-icon">${ico('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}</div>
           <div class="inv-empty-title">No products match your filters</div>
           <p class="inv-empty-text">Try a different search term or show all products.</p>
           ${filtering ? '<button type="button" class="btn btn-ghost inv-empty-btn" onclick="clearInventoryFilters()">Clear filters</button>' : ''}
         </div></td></tr>`
      : `<tr class="inv-empty-row"><td colspan="6"><div class="inv-empty">
           <div class="inv-empty-icon">${ico('<path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="M3.3 7 12 12l8.7-5"/>')}</div>
           <div class="inv-empty-title">No products yet</div>
           <p class="inv-empty-text">Add your first product to start billing and tracking stock.</p>
           <button type="button" class="btn btn-primary inv-empty-btn" onclick="openAddProductPage()">Add product</button>
         </div></td></tr>`;
    return;
  }

  els('inventoryBody').innerHTML = list.map(p => {
    const stock = invStockQty(p);
    const minStock = Number(p.minStock) || 0;
    const statusKey = invStockStatus(p);
    const statusMap = {
      out: { label: 'Out of stock', cls: 'badge-red', stockCls: 'is-out', qtyCls: 'is-out' },
      low: { label: 'Low stock', cls: 'badge-amber', stockCls: 'is-low', qtyCls: 'is-low' },
      in: { label: 'In stock', cls: 'badge-green', stockCls: 'is-in', qtyCls: 'is-in' }
    };
    const meta = statusMap[statusKey];
    const exp = expiryStatus(p);

    const metaBits = [];
    if (p.category) metaBits.push(p.category);
    if (p.expiryDate) metaBits.push('Exp ' + fmtShortDate(p.expiryDate));
    if (p.warrantyMonths) metaBits.push(p.warrantyMonths + ' mo warranty');

    const skuBits = ['SKU: ' + (p.sku || '—')];
    if (p.hsn) skuBits.push('HSN ' + p.hsn);

    const stockMeta = statusKey === 'out'
      ? 'Restock needed'
      : (minStock > 0 ? 'Min ' + minStock + ' ' + (p.unit || 'Pcs') : 'No minimum set');

    return `<tr>
      <td class="inv-td-prod">
        <div class="inv-prod">
          <div class="prod-icon">${p.image ? `<img src="${p.image}" alt="${escapeNotifHtml(p.name || '')}" />` : (p.emoji || '📦')}</div>
          <div class="inv-prod-txt">
            <div class="inv-prod-name">${escapeNotifHtml(p.name || 'Untitled product')}</div>
            <div class="inv-prod-meta">${metaBits.length ? escapeNotifHtml(metaBits.join(' · ')) : 'Uncategorized'}</div>
          </div>
        </div>
      </td>
      <td class="inv-td-code">
        <div class="inv-code">
          ${p.barcode ? `<span class="barcode-pill" title="Product barcode">${escapeNotifHtml(p.barcode)}</span>` : '<span class="inv-code-empty">No barcode</span>'}
          <span class="inv-sku">${escapeNotifHtml(skuBits.join(' · '))}</span>
        </div>
      </td>
      <td class="inv-td-price">
        <div class="inv-price">${fmt(p.price)}</div>
        <div class="inv-price-meta">${Number(p.tax) || 0}% GST</div>
      </td>
      <td class="inv-td-stock">
        <div class="inv-stock-qty ${meta.qtyCls}">${stock}<span>${escapeNotifHtml(p.unit || 'Pcs')}</span></div>
        <div class="inv-stock-meta">${escapeNotifHtml(stockMeta)}</div>
      </td>
      <td class="inv-td-status">
        <span class="badge-pill ${meta.cls}">${meta.label}</span>
        ${exp ? `<div class="inv-exp"><span class="badge-pill ${exp.cls}">${exp.label}</span></div>` : ''}
      </td>
      <td class="inv-actions-cell inv-td-actions">
        <button type="button" class="inv-actions-btn" aria-haspopup="menu" aria-expanded="false" title="Actions" aria-label="Actions for ${escapeNotifHtml(p.name || 'product')}" onclick="toggleInvActions(event, this, '${p.id}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

// ─── INVENTORY ROW ACTIONS (three-dot menu) ─────────────────
// One compact menu per row keeps the table clean while housing every row
// action: View, Edit, Stock In, Stock Out and Delete.
let invActionsState = null;

function closeInvActions() {
  const menu = document.getElementById('invActionsMenu');
  if (menu) menu.remove();
  document.querySelectorAll('.inv-actions-btn.is-open').forEach(btn => {
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  });
  invActionsState = null;
}

function toggleInvActions(ev, btn, productId) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const wasOpen = !!(invActionsState && invActionsState.productId === productId && document.getElementById('invActionsMenu'));
  closeInvActions();
  if (wasOpen) return;

  const p = products.find(x => x.id === productId);
  if (!p) return;

  const icon = (paths) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const items = [
    { action: 'view', label: 'View', icon: icon('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>') },
    { action: 'edit', label: 'Edit', icon: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') },
    { action: 'stock-in', label: 'Stock In', icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>') },
    { action: 'stock-out', label: 'Stock Out', icon: icon('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>') },
    { action: 'barcode', label: 'Print Barcode', icon: icon('<path d="M3 5v14M6.5 5v14M10 5v14M13.5 5v14M17 5v14M20.5 5v14"/>') },
    { action: 'delete', label: 'Delete', danger: true, icon: icon('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>') }
  ];

  const menu = document.createElement('div');
  menu.id = 'invActionsMenu';
  menu.className = 'inv-actions-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map(item => (
    `<button type="button" class="inv-actions-item${item.danger ? ' inv-actions-item-danger' : ''}" role="menuitem" onclick="invMenuAction('${item.action}')">${item.icon}<span>${item.label}</span></button>`
  )).join('');
  document.body.appendChild(menu);

  const rect = (btn || ev.target).getBoundingClientRect();
  const menuW = menu.offsetWidth || 184;
  const menuH = menu.offsetHeight || 208;
  const gap = 6;
  let left = rect.right - menuW;
  left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
  let top = rect.bottom + gap;
  if (top + menuH > window.innerHeight - 8) top = Math.max(8, rect.top - menuH - gap);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  requestAnimationFrame(() => menu.classList.add('open'));

  if (btn) {
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  }
  invActionsState = { productId };
}

function invMenuAction(action) {
  const state = invActionsState;
  if (!state) return;
  const id = state.productId;
  closeInvActions();
  if (action === 'view') viewProduct(id);
  else if (action === 'edit') editProduct(id);
  else if (action === 'stock-in') openStockAdjust(id, 'in');
  else if (action === 'stock-out') openStockAdjust(id, 'out');
  else if (action === 'barcode') printBarcodeForProduct(id);
  else if (action === 'delete') deleteProduct(id);
}

document.addEventListener('click', (e) => {
  if (!document.getElementById('invActionsMenu')) return;
  const t = e.target;
  if (t && t.closest && (t.closest('#invActionsMenu') || t.closest('.inv-actions-btn'))) return;
  closeInvActions();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvActions(); });
window.addEventListener('resize', closeInvActions);
window.addEventListener('scroll', closeInvActions, true);

// ─── BARCODE LABEL PRINTING ─────────────────────────────────
// Renders the barcode that is already stored on the product – never
// generates a new code. Supports Code 128 / EAN-13 / UPC-A with a safe
// Code 128 fallback so a saved code is never silently changed.
const BC_CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232'
];
const BC_CODE128_STOP = '2331112';

const BC_EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const BC_EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const BC_EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const BC_EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function bcClamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function bcEan13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function bcEan13Valid(code) {
  const c = String(code || '');
  return /^\d{13}$/.test(c) && Number(c[12]) === bcEan13CheckDigit(c.slice(0, 12));
}

function bcUpcAValid(code) {
  const c = String(code || '');
  return /^\d{12}$/.test(c) && Number(c[11]) === bcEan13CheckDigit('0' + c.slice(0, 11));
}

// Code 128 – Code Set C for even-length numeric codes (compact), else Set B.
function bcCode128Modules(raw) {
  const value = String(raw || '').replace(/[^\x20-\x7E]/g, '');
  if (!value) return null;
  const codes = [];
  if (/^\d+$/.test(value) && value.length >= 2 && value.length % 2 === 0) {
    codes.push(105); // Start C
    for (let i = 0; i < value.length; i += 2) codes.push(parseInt(value.substr(i, 2), 10));
  } else {
    codes.push(104); // Start B
    for (let i = 0; i < value.length; i++) codes.push(value.charCodeAt(i) - 32);
  }
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103, 106); // checksum + stop

  let modules = '';
  codes.forEach((code, symIndex) => {
    const pattern = code === 106 ? BC_CODE128_STOP : BC_CODE128_PATTERNS[code];
    if (!pattern) return;
    for (let i = 0; i < pattern.length; i++) {
      modules += (i % 2 === 0 ? '1' : '0').repeat(Number(pattern[i]));
    }
  });
  return modules || null;
}

function bcEan13Modules(digits13) {
  const d = String(digits13 || '');
  if (!/^\d{13}$/.test(d)) return null;
  const parity = BC_EAN_PARITY[Number(d[0])] || BC_EAN_PARITY[0];
  let modules = '101';
  for (let i = 1; i <= 6; i++) {
    const digit = Number(d[i]);
    modules += parity[i - 1] === 'L' ? BC_EAN_L[digit] : BC_EAN_G[digit];
  }
  modules += '01010';
  for (let i = 7; i <= 12; i++) modules += BC_EAN_R[Number(d[i])];
  modules += '101';
  return modules;
}

// Binary module string -> single-path SVG (crisp, scales to any label size).
function bcModulesToSvg(modules, quietModules) {
  if (!modules) return '';
  const quiet = quietModules == null ? 10 : quietModules;
  const total = modules.length + quiet * 2;
  let d = '';
  let i = 0;
  while (i < total) {
    const start = i;
    const inBars = i >= quiet && i < quiet + modules.length;
    const on = inBars && modules[i - quiet] === '1';
    while (i < total) {
      const nextOn = i >= quiet && i < quiet + modules.length && modules[i - quiet] === '1';
      if (nextOn !== on) break;
      i++;
    }
    if (on) d += 'M' + start + ' 0h' + (i - start) + 'v100h-' + (i - start) + 'z';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="bc-svg" viewBox="0 0 ${total} 100" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Product barcode"><rect width="${total}" height="100" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Resolves the saved code into a printable barcode.
// requestedType: 'auto' | 'code128' | 'ean13' | 'upca'
function bcBuildBarcode(code, requestedType) {
  const value = String(code == null ? '' : code).trim();
  if (!value) return { ok: false, error: 'No barcode saved for this product.' };
  if (/[\x00-\x1F\x7F]/.test(value)) return { ok: false, error: 'The saved barcode contains invalid control characters.' };

  const type = requestedType || 'auto';
  const digits = /^\d+$/.test(value);
  const eanOK = digits && bcEan13Valid(value);
  const upcOK = digits && bcUpcAValid(value);

  const asCode128 = (warning) => {
    const modules = bcCode128Modules(value);
    if (!modules) return { ok: false, error: 'This barcode contains characters that cannot be printed.' };
    return { ok: true, format: 'Code 128', svg: bcModulesToSvg(modules), text: value, warning: warning || '', moduleCount: modules.length };
  };
  const asEan13 = () => {
    const modules = bcEan13Modules(value);
    return { ok: true, format: 'EAN-13', svg: bcModulesToSvg(modules), text: value, warning: '', moduleCount: modules.length };
  };
  const asUpcA = () => {
    const ean = '0' + value;
    const modules = bcEan13Modules(ean);
    return { ok: true, format: 'UPC-A', svg: bcModulesToSvg(modules), text: value, warning: '', moduleCount: modules.length };
  };

  if (type === 'ean13') {
    if (eanOK) return asEan13();
    return asCode128('This code is not a valid EAN-13, so it is printed as Code 128.');
  }
  if (type === 'upca') {
    if (upcOK) return asUpcA();
    return asCode128('This code is not a valid UPC-A, so it is printed as Code 128.');
  }
  if (type === 'code128') return asCode128('');
  if (eanOK) return asEan13();
  if (upcOK) return asUpcA();
  return asCode128('');
}

// ── Barcode print settings (saved per user on this device) ──
const BARCODE_PRINT_DEFAULTS = {
  preset: '38x25',
  labelWidth: 38,
  labelHeight: 25,
  paper: 'a4',
  orientation: 'portrait',
  align: 'center',
  barcodePosition: 'top',
  showName: true,
  showSku: true,
  showPrice: true,
  showMrp: true,
  showCode: true,
  fontSize: 7.5,
  gap: 2,
  perRow: 3,
  barcodeHeight: 12,
  barcodeType: 'auto'
};

const BARCODE_LABEL_PRESETS = {
  '38x25': { labelWidth: 38, labelHeight: 25 },
  '50x25': { labelWidth: 50, labelHeight: 25 },
  '50x30': { labelWidth: 50, labelHeight: 30 },
  '58x40': { labelWidth: 58, labelHeight: 40 },
  '40x30': { labelWidth: 40, labelHeight: 30 }
};

function barcodeSettingsStorageKey() {
  let who = 'device';
  try {
    if (window.HisaabCloud && typeof window.HisaabCloud.userId === 'function') {
      const id = window.HisaabCloud.userId();
      if (id) who = 'u_' + String(id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    }
  } catch (e) { /* ignore */ }
  return 'hisaab_barcodePrint_' + who;
}

function getBarcodePrintSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(barcodeSettingsStorageKey()) || 'null'); } catch (e) { saved = null; }
  if (!saved) {
    try { saved = JSON.parse(localStorage.getItem('hisaab_barcodePrint') || 'null'); } catch (e) { saved = null; }
  }
  const cfg = Object.assign({}, BARCODE_PRINT_DEFAULTS, saved || {});
  cfg.labelWidth = bcClamp(cfg.labelWidth, 15, 120);
  cfg.labelHeight = bcClamp(cfg.labelHeight, 10, 120);
  cfg.fontSize = bcClamp(cfg.fontSize, 4, 16);
  cfg.gap = bcClamp(cfg.gap, 0, 15);
  cfg.perRow = Math.round(bcClamp(cfg.perRow, 1, 10));
  cfg.barcodeHeight = bcClamp(cfg.barcodeHeight, 5, 40);
  if (!BARCODE_LABEL_PRESETS[cfg.preset]) cfg.preset = 'custom';
  return cfg;
}

function saveBarcodePrintSettings(cfg) {
  const payload = JSON.stringify(cfg);
  try { localStorage.setItem(barcodeSettingsStorageKey(), payload); } catch (e) { console.warn('Barcode settings could not be saved', e); }
  try { localStorage.setItem('hisaab_barcodePrint', payload); } catch (e) { /* ignore */ }
}

function barcodePaperSize(cfg) {
  const sheet = {
    a4: { w: 210, h: 297, margin: 2, roll: false },
    a5: { w: 148, h: 210, margin: 2, roll: false },
    letter: { w: 215.9, h: 279.4, margin: 2, roll: false },
    thermal80: { w: 80, h: 0, margin: 0, roll: true },
    thermal58: { w: 58, h: 0, margin: 0, roll: true }
  }[cfg.paper] || { w: 210, h: 297, margin: 2, roll: false };
  const paper = Object.assign({}, sheet);
  if (!paper.roll && cfg.orientation === 'landscape') {
    const w = paper.w;
    paper.w = paper.h;
    paper.h = w;
  }
  return paper;
}

function barcodeColumns(cfg) {
  const paper = barcodePaperSize(cfg);
  const usable = paper.w - paper.margin * 2;
  const gap = Number(cfg.gap) || 0;
  const fits = Math.floor((usable + gap) / (Number(cfg.labelWidth) + gap));
  return Math.max(1, Math.min(Math.round(cfg.perRow) || 1, Math.max(1, fits)));
}

// Builds one printable label for a product/variant.
function buildBarcodeLabelHtml(item, cfg) {
  const bc = bcBuildBarcode(item.code, cfg.barcodeType);
  if (!bc.ok) return '';
  const esc = escapeNotifHtml;
  const width = bcClamp(cfg.labelWidth, 15, 120);
  const height = bcClamp(cfg.labelHeight, 10, 120);
  const fs = bcClamp(cfg.fontSize, 4, 16);
  const barH = bcClamp(cfg.barcodeHeight, 5, 40);
  const align = cfg.align === 'left' ? 'flex-start' : cfg.align === 'right' ? 'flex-end' : 'center';
  const textAlign = cfg.align === 'left' ? 'left' : cfg.align === 'right' ? 'right' : 'center';
  const metaFs = Math.max(4, fs - 1);

  const nameHtml = cfg.showName && item.name
    ? `<div class="bc-label-name" style="font-size:${fs}pt;text-align:${textAlign};">${esc(item.name)}</div>`
    : '';
  const codeHtml = `<div class="bc-label-code" style="height:${barH}mm;">${bc.svg}</div>` +
    (cfg.showCode ? `<div class="bc-label-human" style="font-size:${metaFs}pt;text-align:${textAlign};">${esc(bc.text)}</div>` : '');
  const priceHtml = cfg.showPrice && item.price != null && item.price !== ''
    ? `<div class="bc-label-price" style="font-size:${fs}pt;text-align:${textAlign};">${esc(fmt(item.price))}</div>`
    : '';
  const metaBits = [];
  if (cfg.showSku && item.sku) metaBits.push('SKU: ' + item.sku);
  if (cfg.showMrp && item.mrp != null && item.mrp !== '') metaBits.push('MRP ' + fmt(item.mrp));
  const metaHtml = metaBits.length
    ? `<div class="bc-label-meta" style="font-size:${metaFs}pt;text-align:${textAlign};">${esc(metaBits.join('  ·  '))}</div>`
    : '';

  const blocks = { name: nameHtml, code: codeHtml, price: priceHtml, meta: metaHtml };
  const order = cfg.barcodePosition === 'bottom'
    ? ['name', 'price', 'meta', 'code']
    : cfg.barcodePosition === 'middle'
      ? ['name', 'code', 'price', 'meta']
      : ['code', 'name', 'price', 'meta'];

  return `<div class="bc-label" style="width:${width}mm;height:${height}mm;font-size:${fs}pt;align-items:${align};">${order.map(k => blocks[k]).join('')}</div>`;
}

function barcodeSampleItem() {
  return {
    name: 'Sample Product',
    sku: 'SKU-0001',
    price: 120,
    mrp: 150,
    code: '8901234567890'
  };
}

function renderBarcodeSettingsPreview() {
  const host = els('barcodeSettingsPreview');
  if (!host) return;
  const cfg = readBarcodeSettingsFromForm();
  const info = els('barcodePreviewInfo');
  const paper = barcodePaperSize(cfg);
  const cols = barcodeColumns(cfg);
  const count = Math.max(1, Math.min(cols * 2, 8));
  const labels = [];
  for (let i = 0; i < count; i++) labels.push(buildBarcodeLabelHtml(barcodeSampleItem(), cfg));
  if (!labels[0]) {
    host.innerHTML = '<div class="bc-preview-empty">Enter a valid barcode type to see the label preview.</div>';
    return;
  }
  host.innerHTML = `<div class="bc-sheet bc-sheet-preview" style="grid-template-columns:repeat(${cols}, ${cfg.labelWidth}mm);gap:${cfg.gap}mm;">${labels.join('')}</div>`;
  if (info) {
    const paperName = { a4: 'A4', a5: 'A5', letter: 'Letter', thermal80: '80 mm roll', thermal58: '58 mm roll' }[cfg.paper] || 'A4';
    let text = `${paperName} · ${cols} label${cols > 1 ? 's' : ''} per row · label ${cfg.labelWidth} × ${cfg.labelHeight} mm`;
    const first = host.querySelector('.bc-label');
    if (first && first.scrollHeight > first.clientHeight + 1) {
      text += ' · Content is taller than the label – reduce barcode height or font size.';
    }
    info.textContent = text;
  }
}

// Density guard: barcodes need roughly 0.25 mm per module to scan well.
function barcodeDensityNote(cfg, moduleCount) {
  const usable = Math.max(10, bcClamp(cfg.labelWidth, 15, 120) - 2.4);
  const perModule = usable / Math.max(1, Number(moduleCount) || 0);
  if (perModule >= 0.25) return '';
  return `This barcode is dense for a ${bcClamp(cfg.labelWidth, 15, 120)} mm label – a wider label scans more reliably.`;
}

function readBarcodeSettingsFromForm() {
  const val = id => els(id) ? els(id).value : '';
  const num = (id, def) => { const v = parseFloat(val(id)); return Number.isFinite(v) ? v : def; };
  const chk = id => !!(els(id) && els(id).checked);
  const cfg = Object.assign({}, BARCODE_PRINT_DEFAULTS);
  cfg.preset = val('stgBarcode_preset') || BARCODE_PRINT_DEFAULTS.preset;
  cfg.labelWidth = bcClamp(num('stgBarcode_labelWidth', cfg.labelWidth), 15, 120);
  cfg.labelHeight = bcClamp(num('stgBarcode_labelHeight', cfg.labelHeight), 10, 120);
  cfg.paper = val('stgBarcode_paper') || cfg.paper;
  cfg.orientation = (val('stgBarcode_orientation') || cfg.orientation) === 'landscape' ? 'landscape' : 'portrait';
  cfg.align = ['left', 'center', 'right'].includes(val('stgBarcode_align')) ? val('stgBarcode_align') : 'center';
  cfg.barcodePosition = ['top', 'middle', 'bottom'].includes(val('stgBarcode_barcodePosition')) ? val('stgBarcode_barcodePosition') : 'top';
  cfg.showName = chk('stgBarcode_showName');
  cfg.showSku = chk('stgBarcode_showSku');
  cfg.showPrice = chk('stgBarcode_showPrice');
  cfg.showMrp = chk('stgBarcode_showMrp');
  cfg.showCode = chk('stgBarcode_showCode');
  cfg.fontSize = bcClamp(num('stgBarcode_fontSize', cfg.fontSize), 4, 16);
  cfg.gap = bcClamp(num('stgBarcode_gap', cfg.gap), 0, 15);
  cfg.perRow = Math.round(bcClamp(num('stgBarcode_perRow', cfg.perRow), 1, 10));
  cfg.barcodeHeight = bcClamp(num('stgBarcode_barcodeHeight', cfg.barcodeHeight), 5, 40);
  cfg.barcodeType = ['auto', 'code128', 'ean13', 'upca'].includes(val('stgBarcode_barcodeType')) ? val('stgBarcode_barcodeType') : 'auto';
  return cfg;
}

function renderBarcodeSettingsFields() {
  const cfg = getBarcodePrintSettings();
  const setVal = (id, v) => { const el = els(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = els(id); if (el) el.checked = !!v; };
  setVal('stgBarcode_preset', cfg.preset);
  setVal('stgBarcode_labelWidth', cfg.labelWidth);
  setVal('stgBarcode_labelHeight', cfg.labelHeight);
  setVal('stgBarcode_paper', cfg.paper);
  setVal('stgBarcode_orientation', cfg.orientation);
  setVal('stgBarcode_align', cfg.align);
  setVal('stgBarcode_barcodePosition', cfg.barcodePosition);
  setChk('stgBarcode_showName', cfg.showName);
  setChk('stgBarcode_showSku', cfg.showSku);
  setChk('stgBarcode_showPrice', cfg.showPrice);
  setChk('stgBarcode_showMrp', cfg.showMrp);
  setChk('stgBarcode_showCode', cfg.showCode);
  setVal('stgBarcode_fontSize', cfg.fontSize);
  setVal('stgBarcode_gap', cfg.gap);
  setVal('stgBarcode_perRow', cfg.perRow);
  setVal('stgBarcode_barcodeHeight', cfg.barcodeHeight);
  setVal('stgBarcode_barcodeType', cfg.barcodeType);
  renderBarcodeSettingsPreview();
}

function applyBarcodeLabelPreset() {
  const preset = els('stgBarcode_preset')?.value || '';
  const size = BARCODE_LABEL_PRESETS[preset];
  if (size) {
    const w = els('stgBarcode_labelWidth');
    const h = els('stgBarcode_labelHeight');
    if (w) w.value = size.labelWidth;
    if (h) h.value = size.labelHeight;
  }
}

function saveBarcodePrintSettingsFromForm() {
  const cfg = readBarcodeSettingsFromForm();
  saveBarcodePrintSettings(cfg);
  toast('Barcode print settings saved', 'success');
  renderBarcodeSettingsPreview();
}

// ── Per-product barcode resolution (variant first, then product) ──
function barcodeForProduct(product, variant) {
  const vb = variant && variant.barcode ? String(variant.barcode).trim() : '';
  if (vb) return { code: vb, source: 'variant' };
  const pb = product && product.barcode ? String(product.barcode).trim() : '';
  if (pb) return { code: pb, source: variant ? 'product-fallback' : 'product' };
  return { code: '', source: 'none' };
}

let barcodePrintState = null; // { productId, variantIndex }
let barcodePrintBusy = false;

function barcodeModalItem() {
  if (!barcodePrintState) return null;
  const p = products.find(x => x.id === barcodePrintState.productId);
  if (!p) return null;
  const variants = (p.hasVariants && Array.isArray(p.variants)) ? p.variants.filter(Boolean) : [];
  const variant = variants[barcodePrintState.variantIndex] || null;
  const resolved = barcodeForProduct(p, variant);
  const label = variant ? getVariantLabel(variant, p) : '';
  return {
    product: p,
    variant,
    code: resolved.code,
    source: resolved.source,
    name: variant && label ? p.name + ' — ' + label : p.name,
    sku: (variant && variant.sku) || p.sku || '',
    price: variant && variant.price != null ? variant.price : p.price,
    mrp: variant && variant.mrp != null ? variant.mrp : (p.mrp != null ? p.mrp : p.price)
  };
}

function renderBarcodeModal() {
  const item = barcodeModalItem();
  if (!item) return;
  const esc = escapeNotifHtml;
  const nameEl = els('bcpProductName');
  const metaEl = els('bcpProductMeta');
  const codeEl = els('bcpCodeText');
  const warnEl = els('bcpNoBarcode');
  const noteEl = els('bcpNote');
  const printBtn = els('bcpPrintBtn');
  const scale = els('bcpPreviewScale');
  const preview = els('bcpPreview');
  if (!preview) return;

  if (nameEl) nameEl.textContent = item.name;
  if (metaEl) {
    const bits = [];
    if (item.sku) bits.push('SKU: ' + item.sku);
    if (item.price != null) bits.push('Price: ' + fmt(item.price));
    if (item.mrp != null) bits.push('MRP: ' + fmt(item.mrp));
    metaEl.textContent = bits.join('  ·  ');
  }

  const cfg = getBarcodePrintSettings();
  const bc = item.code ? bcBuildBarcode(item.code, cfg.barcodeType) : { ok: false, error: 'No barcode saved for this product.' };

  if (codeEl) codeEl.textContent = item.code || '—';
  if (warnEl) warnEl.classList.toggle('hidden', bc.ok);
  if (printBtn) {
    printBtn.disabled = !bc.ok;
    printBtn.setAttribute('aria-disabled', bc.ok ? 'false' : 'true');
  }

  if (bc.ok) {
    preview.innerHTML = buildBarcodeLabelHtml(item, cfg);
    const notes = [];
    if (item.source === 'product-fallback') notes.push('This variant has no barcode of its own, so the product barcode is printed.');
    if (item.source === 'variant') notes.push('Using the barcode saved on this variant.');
    if (bc.warning) notes.push(bc.warning);
    const density = barcodeDensityNote(cfg, bc.moduleCount);
    if (density) notes.push(density);
    notes.push('Barcode is printed exactly as saved — nothing is regenerated.');
    if (noteEl) noteEl.textContent = notes.join(' ');
  } else {
    preview.innerHTML = '';
    if (noteEl) noteEl.textContent = '';
  }
}

function printBarcodeForProduct(productId) {
  // Plan entitlement: reuse the SaaS plan gate (opens the existing upgrade
  // dialog when the active plan does not include Barcode Printing). Local /
  // offline / signed-out use is still allowed and the server re-checks on print.
  if (window.HisaabSaaS && typeof window.HisaabSaaS.canPrintBarcodes === 'function') {
    if (!window.HisaabSaaS.canPrintBarcodes()) {
      if (typeof window.HisaabSaaS.openUpgrade === 'function') {
        window.HisaabSaaS.openUpgrade('barcode_printing', 'Barcode printing');
      }
      return;
    }
  }
  const p = products.find(x => x.id === productId);
  if (!p) { toast('Product not found', 'error'); return; }
  const variants = (p.hasVariants && Array.isArray(p.variants)) ? p.variants.filter(Boolean) : [];
  barcodePrintState = { productId: productId, variantIndex: 0 };

  const wrap = els('bcpVariantWrap');
  const sel = els('bcpVariant');
  if (sel && wrap) {
    if (variants.length) {
      sel.innerHTML = variants.map((v, i) => {
        const code = v && v.barcode ? String(v.barcode).trim() : '';
        return `<option value="${i}">${escapeNotifHtml(getVariantLabel(v, p) || ('Variant ' + (i + 1)))}${code ? ' — ' + escapeNotifHtml(code) : ' — no barcode'}</option>`;
      }).join('');
      sel.value = '0';
      wrap.style.display = '';
    } else {
      sel.innerHTML = '';
      wrap.style.display = 'none';
    }
  }
  const copies = els('bcpCopies');
  if (copies) copies.value = '1';
  renderBarcodeModal();
  showModal('barcodePrintModal');
}

function closeBarcodePrintModal() {
  hideModal('barcodePrintModal');
  barcodePrintState = null;
  const preview = els('bcpPreview');
  if (preview) preview.innerHTML = '';
}

async function printBarcodeLabels() {
  if (barcodePrintBusy) return;
  const item = barcodeModalItem();
  if (!item) return;
  if (!item.code) { toast('This product has no barcode to print.', 'error'); return; }
  const cfg = getBarcodePrintSettings();
  const single = buildBarcodeLabelHtml(item, cfg);
  if (!single) { toast('This barcode cannot be printed. Check the barcode type.', 'error'); return; }

  // Server-side entitlement check: the plan restriction must hold even if the
  // UI gate is bypassed, so ask the backend before rendering the labels.
  if (window.HisaabSaaS && typeof window.HisaabSaaS.authorizeBarcodePrint === 'function') {
    barcodePrintBusy = true;
    const printBtn = els('bcpPrintBtn');
    if (printBtn) printBtn.disabled = true;
    let auth;
    try { auth = await window.HisaabSaaS.authorizeBarcodePrint(); }
    catch (e) { auth = { allowed: true, degraded: true }; }
    barcodePrintBusy = false;
    if (!auth || auth.allowed === false) {
      if (printBtn) printBtn.disabled = false;
      return; // upgrade dialog was opened by the SaaS layer
    }
    if (printBtn) printBtn.disabled = false;
  }

  const copies = Math.round(bcClamp(parseInt(els('bcpCopies')?.value, 10) || 1, 1, 500));
  const cols = barcodeColumns(cfg);
  const paper = barcodePaperSize(cfg);
  const area = els('barcodePrintArea');
  if (!area) { toast('Printing is unavailable. Reload the app and try again.', 'error'); return; }

  let labels = '';
  for (let i = 0; i < copies; i++) labels += single;

  const pageSize = paper.roll ? `${paper.w}mm auto` : `${paper.w}mm ${paper.h}mm`;
  area.innerHTML = `<style>@page { size: ${pageSize}; margin: ${paper.margin}mm; } .bc-sheet { display: grid; grid-template-columns: repeat(${cols}, ${cfg.labelWidth}mm); gap: ${cfg.gap}mm; justify-content: start; }</style>` +
    `<div class="bc-sheet">${labels}</div>`;

  document.body.classList.add('printing-barcodes');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove('printing-barcodes');
    try { area.innerHTML = ''; } catch (e) { }
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => { try { window.print(); } catch (e) { cleanup(); } }, 80);
  setTimeout(cleanup, 60000);
}

function setupBarcodePrinting() {
  const modal = els('barcodePrintModal');
  if (modal && !modal.dataset.wired) {
    modal.dataset.wired = '1';
    els('barcodePrintClose')?.addEventListener('click', closeBarcodePrintModal);
    els('barcodePrintCancel')?.addEventListener('click', closeBarcodePrintModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeBarcodePrintModal(); });
    els('bcpPrintBtn')?.addEventListener('click', printBarcodeLabels);
    els('bcpVariant')?.addEventListener('change', (e) => {
      if (!barcodePrintState) return;
      barcodePrintState.variantIndex = Math.max(0, parseInt(e.target.value, 10) || 0);
      renderBarcodeModal();
    });
    const step = (delta) => {
      const input = els('bcpCopies');
      if (!input) return;
      input.value = String(Math.round(bcClamp((parseInt(input.value, 10) || 1) + delta, 1, 500)));
    };
    els('bcpCopiesDec')?.addEventListener('click', () => step(-1));
    els('bcpCopiesInc')?.addEventListener('click', () => step(1));
    els('bcpCopies')?.addEventListener('change', (e) => {
      e.target.value = String(Math.round(bcClamp(parseInt(e.target.value, 10) || 1, 1, 500)));
    });
    els('bcpEditProductBtn')?.addEventListener('click', () => {
      const id = barcodePrintState && barcodePrintState.productId;
      closeBarcodePrintModal();
      if (id) editProduct(id);
    });
  }

  const panel = els('stg-panel-barcode');
  if (panel && !panel.dataset.previewBound) {
    panel.dataset.previewBound = '1';
    panel.addEventListener('input', renderBarcodeSettingsPreview);
    panel.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'stgBarcode_preset') applyBarcodeLabelPreset();
      renderBarcodeSettingsPreview();
    });
  }
  els('stgSaveBarcodeBtn')?.addEventListener('click', saveBarcodePrintSettingsFromForm);
  els('stgResetBarcodeBtn')?.addEventListener('click', () => {
    saveBarcodePrintSettings(Object.assign({}, BARCODE_PRINT_DEFAULTS));
    renderBarcodeSettingsFields();
    toast('Barcode print settings reset', 'info');
  });
}

// ─── STOCK IN / STOCK OUT ───────────────────────────────────
let stockAdjustState = null;

function fmtStockQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}

function getStockAdjustTarget() {
  if (!stockAdjustState) return null;
  const product = products.find(x => x.id === stockAdjustState.productId);
  if (!product) return null;
  const variants = (Array.isArray(product.variants) ? product.variants : []).filter(Boolean);
  if (product.hasVariants && variants.length) {
    const idx = Math.max(0, Math.min(variants.length - 1, Number(stockAdjustState.variantIndex) || 0));
    const variant = variants[idx];
    return {
      product,
      variant,
      variants,
      variantIndex: idx,
      label: getVariantLabel(variant, product),
      stock: getVariantStock(variant)
    };
  }
  return { product, variant: null, variants: [], label: '', stock: Number(product.stock) || 0 };
}

function updateStockAdjustInfo() {
  const target = getStockAdjustTarget();
  const nameEl = document.getElementById('stockAdjustProductName');
  const stockEl = document.getElementById('stockAdjustCurrentStock');
  const qtyEl = document.getElementById('stockAdjustQty');
  const hintEl = document.getElementById('stockAdjustQtyHint');
  if (!target) return;

  const unit = target.product.unit || 'Pcs';
  const mode = stockAdjustState ? stockAdjustState.mode : 'in';
  if (nameEl) nameEl.textContent = target.product.name + (target.label ? ' — ' + target.label : '');

  if (stockEl) {
    if (target.variant) {
      const total = Number(target.product.stock) || 0;
      stockEl.innerHTML = `Available stock: <strong>${escapeNotifHtml(fmtStockQty(target.stock))} ${escapeNotifHtml(unit)}</strong> <span class="text-muted">(total across variants: ${escapeNotifHtml(fmtStockQty(total))} ${escapeNotifHtml(unit)})</span>`;
    } else {
      stockEl.innerHTML = `Available stock: <strong>${escapeNotifHtml(fmtStockQty(target.stock))} ${escapeNotifHtml(unit)}</strong>`;
    }
  }
  if (qtyEl) {
    if (mode === 'out') qtyEl.max = String(target.stock);
    else qtyEl.removeAttribute('max');
  }
  if (hintEl) {
    hintEl.textContent = mode === 'out'
      ? `Quantity to remove. Maximum ${fmtStockQty(target.stock)} ${unit}.`
      : 'Quantity to add to available stock.';
  }
}

function openStockAdjust(productId, mode) {
  const product = products.find(x => x.id === productId);
  if (!product) {
    toast('This product no longer exists. Its history is available in Stock Timeline.', 'error');
    return;
  }

  const dir = mode === 'out' ? 'out' : 'in';
  const variants = (Array.isArray(product.variants) ? product.variants : []).filter(Boolean);
  const useVariants = !!(product.hasVariants && variants.length);

  stockAdjustState = { productId, mode: dir, variantIndex: 0 };

  const title = document.getElementById('stockAdjustTitle');
  const saveBtn = document.getElementById('stockAdjustSaveBtn');
  if (title) title.textContent = dir === 'in' ? 'Stock In' : 'Stock Out';
  if (saveBtn) {
    saveBtn.textContent = dir === 'in' ? 'Add Stock' : 'Remove Stock';
    saveBtn.classList.toggle('btn-danger', dir === 'out');
    saveBtn.classList.toggle('btn-primary', dir === 'in');
  }

  const wrap = document.getElementById('stockAdjustVariantWrap');
  const select = document.getElementById('stockAdjustVariant');
  if (wrap && select) {
    if (useVariants) {
      select.innerHTML = variants.map((v, i) => {
        const label = getVariantLabel(v, product) || ('Variant ' + (i + 1));
        return `<option value="${i}">${escapeNotifHtml(label)} — ${escapeNotifHtml(fmtStockQty(getVariantStock(v)))} ${escapeNotifHtml(product.unit || 'Pcs')} in stock</option>`;
      }).join('');
      select.value = '0';
      wrap.style.display = '';
    } else {
      select.innerHTML = '';
      wrap.style.display = 'none';
    }
  }

  const qtyEl = document.getElementById('stockAdjustQty');
  if (qtyEl) qtyEl.value = '';
  const remarksEl = document.getElementById('stockAdjustRemarks');
  if (remarksEl) {
    remarksEl.value = '';
    remarksEl.placeholder = dir === 'in' ? 'Optional, e.g. new stock received' : 'Optional, e.g. damaged / expired stock';
  }

  updateStockAdjustInfo();
  showModal('stockAdjustModal');
  setTimeout(() => { try { qtyEl && qtyEl.focus(); } catch (e) { } }, 60);
}

function saveStockAdjust() {
  const target = getStockAdjustTarget();
  if (!target || !stockAdjustState) {
    toast('Product not found. Reopen the stock adjustment.', 'error');
    return;
  }

  const mode = stockAdjustState.mode;
  const unit = target.product.unit || 'Pcs';
  const qtyEl = document.getElementById('stockAdjustQty');
  const rawQty = qtyEl ? qtyEl.value : '';
  const qty = Number(rawQty);
  if (rawQty === '' || !Number.isFinite(qty) || qty <= 0) {
    toast('Enter a quantity greater than zero.', 'error');
    qtyEl && qtyEl.focus();
    return;
  }

  const qtyChange = Math.round(qty * 1000) / 1000;
  const prevStock = target.stock;
  if (mode === 'out' && qtyChange > prevStock) {
    toast(`Cannot remove ${fmtStockQty(qtyChange)} ${unit}. Only ${fmtStockQty(prevStock)} ${unit} in stock.`, 'error');
    qtyEl && qtyEl.focus();
    return;
  }

  const newStock = Math.round((mode === 'in' ? prevStock + qtyChange : prevStock - qtyChange) * 1000) / 1000;
  const remarksEl = document.getElementById('stockAdjustRemarks');
  const remarks = (remarksEl ? remarksEl.value : '').trim();

  if (target.variant) {
    target.variant.stock = newStock;
    if (target.variant.qty != null) target.variant.qty = newStock;
    target.product.stock = target.variants.reduce((sum, v) => sum + getVariantStock(v), 0);
  } else {
    target.product.stock = newStock;
  }

  const totalAfter = Number(target.product.stock) || 0;
  target.product.status = totalAfter === 0 ? 'Out of Stock' : (totalAfter <= minStockOf(target.product) ? 'Low Stock' : 'In Stock');
  DB.set('products', products);

  const noteParts = [
    (mode === 'in' ? 'Added ' : 'Removed ') + fmtStockQty(qtyChange) + ' ' + unit
  ];
  if (target.variant) noteParts.push('Variant: ' + (target.label || 'Variant'));
  noteParts.push('previous ' + fmtStockQty(prevStock) + ' → ' + fmtStockQty(newStock));
  if (target.variant) noteParts.push('total now ' + fmtStockQty(totalAfter) + ' ' + unit);
  if (remarks) noteParts.push('Remarks: ' + remarks);

  logStockMovement({
    type: mode === 'in' ? 'stock_in' : 'stock_out',
    productId: target.product.id,
    productName: target.product.name,
    barcode: target.product.barcode || '',
    qtyChange: mode === 'in' ? qtyChange : -qtyChange,
    qtyBefore: prevStock,
    qtyAfter: newStock,
    remarks: remarks,
    note: noteParts.join(' · ')
  });

  stockAdjustState = null;
  hideModal('stockAdjustModal');
  renderInventory();
  renderStockTimeline();
  if (typeof renderPosCatalog === 'function') renderPosCatalog();
  toast(mode === 'in'
    ? `Stock In saved: +${fmtStockQty(qtyChange)} ${unit} for ${target.product.name}`
    : `Stock Out saved: -${fmtStockQty(qtyChange)} ${unit} for ${target.product.name}`, 'success');
}

// ─── CATEGORIES & SUBCATEGORIES MANAGEMENT ──────────────

const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderCategoriesSubcategories() {
  const q = (els('catSubSearchInput')?.value || '').trim().toLowerCase();
  const clearBtn = els('catSubSearchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !q);

  const catList = q
    ? categories.filter(c => c.name.toLowerCase().includes(q))
    : categories;

  const subList = q
    ? subcategories.filter(s => s.name.toLowerCase().includes(q) || (s.category && s.category.toLowerCase().includes(q)))
    : subcategories;

  const totalCatProducts = catList.reduce((sum, c) => sum + products.filter(p => p.category === c.name).length, 0);
  const totalSubProducts = subList.reduce((sum, s) => sum + products.filter(p => p.subCategory === s.name).length, 0);

  els('catSubStats').innerHTML = `
    <div class="stat-card purple"><div class="stat-label">Categories</div><div class="stat-value">${categories.length}</div></div>
    <div class="stat-card purple"><div class="stat-label">Subcategories</div><div class="stat-value">${subcategories.length}</div></div>
    <div class="stat-card green"><div class="stat-label">Products (Categories)</div><div class="stat-value">${totalCatProducts}</div></div>
    <div class="stat-card green"><div class="stat-label">Products (Subcategories)</div><div class="stat-value">${totalSubProducts}</div></div>`;

  if (!catList.length) {
    els('catBody').innerHTML = categories.length
      ? `<tr><td colspan="6" class="table-empty">No categories found matching "<strong>${q}</strong>"</td></tr>`
      : '<tr><td colspan="6" class="table-empty">No categories yet. Add your first category to organize products.</td></tr>';
  } else {
    els('catBody').innerHTML = catList.map(c => {
      const productCount = products.filter(p => p.category === c.name).length;
      const subCount = subcategories.filter(s => s.categoryId === c.id).length;
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:10px"><div class="prod-icon" style="background:#f5f3ff;color:#6d28d9">${c.emoji || '📁'}</div><div><div class="fw-semi">${escHtml(c.name)}</div></div></div></td>
        <td>${escHtml(c.description || '—')}</td>
        <td class="fw-semi">${productCount}</td>
        <td class="fw-semi">${subCount}</td>
        <td>
          <button class="tbl-action tbl-view" onclick="viewCategoryProducts('${escHtml(c.name)}')" title="View products in ${escHtml(c.name)}">View Products</button>
          <button class="tbl-action tbl-edit" onclick="editCategory('${c.id}')">Edit</button>
          <button class="tbl-action tbl-del" onclick="deleteCategory('${c.id}', '${escHtml(c.name)}')">Delete</button>
        </td>
      </tr>`;
    }).join('');
  }

  if (!subList.length) {
    els('subcatBody').innerHTML = subcategories.length
      ? `<tr><td colspan="6" class="table-empty">No subcategories found matching "<strong>${q}</strong>"</td></tr>`
      : '<tr><td colspan="6" class="table-empty">No subcategories yet. Add your first subcategory to organize products further.</td></tr>';
  } else {
    els('subcatBody').innerHTML = subList.map(s => {
      const category = categories.find(c => c.id === s.categoryId);
      const productCount = products.filter(p => p.subCategory === s.name).length;
      return `<tr>
        <td><div class="fw-semi">${escHtml(s.name)}</div></td>
        <td>${escHtml(category ? category.name : '—')}</td>
        <td>${escHtml(s.description || '—')}</td>
        <td class="fw-semi">${productCount}</td>
        <td>
          <button class="tbl-action tbl-view" onclick="viewSubcategoryProducts('${escHtml(s.name)}')" title="View products in ${escHtml(s.name)}">View Products</button>
          <button class="tbl-action tbl-edit" onclick="editSubcategory('${s.id}')">Edit</button>
          <button class="tbl-action tbl-del" onclick="deleteSubcategory('${s.id}', '${escHtml(s.name)}')">Delete</button>
        </td>
      </tr>`;
    }).join('');
  }
}

function renderBrands() {
  const q = (els('brandSearchInput')?.value || '').trim().toLowerCase();
  const clearBtn = els('brandSearchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !q);

  const list = q
    ? brands.filter(b => b.name.toLowerCase().includes(q))
    : brands;

  const totalProducts = list.reduce((sum, b) => sum + products.filter(p => p.brand === b.name).length, 0);

  els('brandStats').innerHTML = `
    <div class="stat-card purple"><div class="stat-label">Total Brands</div><div class="stat-value">${brands.length}</div></div>
    <div class="stat-card green"><div class="stat-label">Total Products</div><div class="stat-value">${totalProducts}</div></div>`;

  if (!list.length) {
    els('brandBody').innerHTML = brands.length
      ? `<tr><td colspan="4" class="table-empty">No brands found matching "<strong>${q}</strong>"</td></tr>`
      : '<tr><td colspan="4" class="table-empty">No brands yet. Add your first brand to identify product makers.</td></tr>';
    return;
  }

  els('brandBody').innerHTML = list.map(b => {
    const productCount = products.filter(p => p.brand === b.name).length;
    return `<tr>
      <td><div class="fw-semi">${escHtml(b.name)}</div></td>
      <td>${escHtml(b.description || '—')}</td>
      <td class="fw-semi">${productCount}</td>
      <td>
        <button class="tbl-action tbl-view" onclick="viewBrandProducts('${escHtml(b.name)}')" title="View products from ${escHtml(b.name)}">View Products</button>
        <button class="tbl-action tbl-edit" onclick="editBrand('${b.id}')">Edit</button>
        <button class="tbl-action tbl-del" onclick="deleteBrand('${b.id}', '${escHtml(b.name)}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function saveCategory() {
  const name = els('catName')?.value?.trim() || '';
  const desc = els('catDesc')?.value?.trim() || '';
  const emoji = els('catEmoji')?.value || '📁';
  const id = els('editingCategoryId')?.value || '';
  const isEdit = !!id;

  if (!name) { toast('Category name is required', 'error'); return; }
  if (categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== id)) {
    toast('Category already exists', 'error'); return;
  }

  const entry = { id: id || uid(), name, description: desc, emoji, createdAt: isEdit ? (categories.find(c => c.id === id)?.createdAt || Date.now()) : Date.now() };
  if (isEdit) {
    const idx = categories.findIndex(c => c.id === id);
    categories[idx] = entry;
  } else {
    categories.unshift(entry);
  }
  DB.set('categories', categories);
  hideModal('catModal');
  renderCategoriesSubcategories();
  toast(isEdit ? 'Category updated' : 'Category created', 'success');
}

function saveSubcategory() {
  const name = els('subcatName')?.value?.trim() || '';
  const desc = els('subcatDesc')?.value?.trim() || '';
  const categoryId = els('subcatCategory')?.value || '';
  const id = els('editingSubcategoryId')?.value || '';
  const isEdit = !!id;

  if (!name) { toast('Subcategory name is required', 'error'); return; }
  if (!categoryId) { toast('Please select a category', 'error'); return; }
  if (subcategories.some(s => s.name.toLowerCase() === name.toLowerCase() && s.id !== id)) {
    toast('Subcategory already exists', 'error'); return;
  }

  const entry = { id: id || uid(), name, description: desc, categoryId, createdAt: isEdit ? (subcategories.find(s => s.id === id)?.createdAt || Date.now()) : Date.now() };
  if (isEdit) {
    const idx = subcategories.findIndex(s => s.id === id);
    subcategories[idx] = entry;
  } else {
    subcategories.unshift(entry);
  }
  DB.set('subcategories', subcategories);
  hideModal('subcatModal');
  renderCategoriesSubcategories();
  toast(isEdit ? 'Subcategory updated' : 'Subcategory created', 'success');
}

function saveBrand() {
  const name = els('brandName')?.value?.trim() || '';
  const desc = els('brandDesc')?.value?.trim() || '';
  const id = els('editingBrandId')?.value || '';
  const isEdit = !!id;

  if (!name) { toast('Brand name is required', 'error'); return; }
  if (brands.some(b => b.name.toLowerCase() === name.toLowerCase() && b.id !== id)) {
    toast('Brand already exists', 'error'); return;
  }

  const entry = { id: id || uid(), name, description: desc, createdAt: isEdit ? (brands.find(b => b.id === id)?.createdAt || Date.now()) : Date.now() };
  if (isEdit) {
    const idx = brands.findIndex(b => b.id === id);
    brands[idx] = entry;
  } else {
    brands.unshift(entry);
  }
  DB.set('brands', brands);
  hideModal('brandModal');
  renderBrands();
  toast(isEdit ? 'Brand updated' : 'Brand created', 'success');
}

function deleteCategory(id, name) {
  if (!confirm(`Delete category "${name}"? Products in this category will lose their category assignment, and subcategories under it will be orphaned.`)) return;
  categories = categories.filter(c => c.id !== id);
  // Unassign category from products
  products.forEach(p => { if (p.category === name) p.category = ''; });
  // Orphan subcategories
  subcategories.forEach(s => { if (s.categoryId === id) s.categoryId = ''; });
  DB.set('categories', categories);
  DB.set('subcategories', subcategories);
  DB.set('products', products);
  renderCategoriesSubcategories();
  renderInventory();
  toast('Category deleted', 'warning');
}

function deleteSubcategory(id, name) {
  if (!confirm(`Delete subcategory "${name}"? Products in this subcategory will lose their subcategory assignment.`)) return;
  subcategories = subcategories.filter(s => s.id !== id);
  products.forEach(p => { if (p.subCategory === name) p.subCategory = ''; });
  DB.set('subcategories', subcategories);
  DB.set('products', products);
  renderCategoriesSubcategories();
  renderInventory();
  toast('Subcategory deleted', 'warning');
}

function deleteBrand(id, name) {
  if (!confirm(`Delete brand "${name}"? Products from this brand will lose their brand assignment.`)) return;
  brands = brands.filter(b => b.id !== id);
  products.forEach(p => { if (p.brand === name) p.brand = ''; });
  DB.set('brands', brands);
  DB.set('products', products);
  renderBrands();
  renderInventory();
  toast('Brand deleted', 'warning');
}

function editCategory(id) {
  const c = categories.find(c => c.id === id);
  if (!c) return;
  els('editingCategoryId').value = c.id;
  els('catName').value = c.name;
  els('catDesc').value = c.description || '';
  els('catEmoji').value = c.emoji || '📁';
  showModal('catModal');
}

function editSubcategory(id) {
  const s = subcategories.find(s => s.id === id);
  if (!s) return;
  els('editingSubcategoryId').value = s.id;
  els('subcatName').value = s.name;
  els('subcatDesc').value = s.description || '';
  // Populate category dropdown
  const catSel = els('subcatCategory');
  catSel.innerHTML = categories.map(c => `<option value="${c.id}" ${c.id === s.categoryId ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');
  showModal('subcatModal');
}

function editBrand(id) {
  const b = brands.find(b => b.id === id);
  if (!b) return;
  els('editingBrandId').value = b.id;
  els('brandName').value = b.name;
  els('brandDesc').value = b.description || '';
  showModal('brandModal');
}

function viewCategoryProducts(categoryName) {
  // Switch to inventory view and filter by category
  const searchInput = els('inventorySearchInput');
  if (searchInput) {
    searchInput.value = categoryName;
    renderInventory();
  }
  switchToView('inventory');
}

function viewSubcategoryProducts(subcategoryName) {
  const searchInput = els('inventorySearchInput');
  if (searchInput) {
    searchInput.value = subcategoryName;
    renderInventory();
  }
  switchToView('inventory');
}

function viewBrandProducts(brandName) {
  const searchInput = els('inventorySearchInput');
  if (searchInput) {
    searchInput.value = brandName;
    renderInventory();
  }
  switchToView('inventory');
}

// Category modal handlers
function openCategoryModal() {
  els('editingCategoryId').value = '';
  els('catName').value = '';
  els('catDesc').value = '';
  els('catEmoji').value = '📁';
  showModal('catModal');
}

function openSubcategoryModal() {
  els('editingSubcategoryId').value = '';
  els('subcatName').value = '';
  els('subcatDesc').value = '';
  const catSel = els('subcatCategory');
  catSel.innerHTML = categories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  if (!categories.length) catSel.innerHTML = '<option value="">No categories available — create one first</option>';
  showModal('subcatModal');
}

function openBrandModal() {
  els('editingBrandId').value = '';
  els('brandName').value = '';
  els('brandDesc').value = '';
  showModal('brandModal');
}

// Search clear handler
function clearCatSubSearch() { els('catSubSearchInput').value = ''; renderCategoriesSubcategories(); }
function clearBrandSearch() { els('brandSearchInput').value = ''; renderBrands(); }

// ─── EXPIRY & WARRANTY + NOTIFICATIONS ───────────────────────

const EXPIRY_ALERT_DAYS = 30;

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateOnly(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysUntilDate(value) {
  const d = parseDateOnly(value);
  if (!d) return null;
  return Math.round((d.getTime() - todayStart().getTime()) / 86400000);
}

function fmtShortDate(value) {
  const d = parseDateOnly(value);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}

// ─── STOCK TIMELINE / MOVEMENTS ──────────────────────────────
const STOCK_MOVEMENT_TYPES = [
  { id: 'created', label: 'Created', cls: 'tl-created' },
  { id: 'added', label: 'Stock Added', cls: 'tl-added' },
  { id: 'stock_in', label: 'Stock In', cls: 'tl-stockin' },
  { id: 'stock_out', label: 'Stock Out', cls: 'tl-stockout' },
  { id: 'adjusted', label: 'Adjusted', cls: 'tl-adjusted' },
  { id: 'sold', label: 'Sold', cls: 'tl-sold' },
  { id: 'returned', label: 'Returned', cls: 'tl-returned' },
  { id: 'damaged', label: 'Damaged', cls: 'tl-damaged' },
  { id: 'deleted', label: 'Deleted', cls: 'tl-deleted' }
];

function logStockMovement(entry) {
  if (!entry || !entry.type) return;
  stockMovements = DB.get('stockMovements') || stockMovements || [];
  stockMovements.unshift(Object.assign({
    id: uid(),
    ts: Date.now(),
    date: now(),
    user: (getUserProfile && getUserProfile().name) || 'User'
  }, entry));
  if (stockMovements.length > 2000) stockMovements.length = 2000;
  DB.set('stockMovements', stockMovements);
  if (typeof renderStockTimeline === 'function') renderStockTimeline();
}

function logStockMovements(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  stockMovements = DB.get('stockMovements') || stockMovements || [];
  const baseTs = Date.now();
  entries.forEach((entry, i) => {
    if (!entry || !entry.type) return;
    stockMovements.unshift(Object.assign({
      id: uid(),
      ts: baseTs - i,
      date: now(),
      user: (getUserProfile && getUserProfile().name) || 'User'
    }, entry));
  });
  if (stockMovements.length > 2000) stockMovements.length = 2000;
  DB.set('stockMovements', stockMovements);
  if (typeof renderStockTimeline === 'function') renderStockTimeline();
}

let stockTimelineFilters = { type: 'all', product: 'all', from: '', to: '', q: '' };

function stockTypeMeta(type) {
  return STOCK_MOVEMENT_TYPES.find(t => t.id === type) || { label: type || 'Activity', cls: '' };
}

// Stock movements keep their own product identity (name, SKU/barcode) so
// history stays readable after a product is deleted. Deletion itself is a
// normal activity entry, never a status attached to other transactions.
function stockMovementProductInfo(m, productMap, historySnapshots) {
  const id = (m && m.productId) ? String(m.productId) : '';
  const activeProduct = (productMap && id) ? productMap.get(id) : null;
  const snap = (m && m.productSnapshot && typeof m.productSnapshot === 'object')
    ? m.productSnapshot
    : ((historySnapshots && historySnapshots.get(id)) || null);
  const name = (m && m.productName) || (activeProduct && activeProduct.name) || (snap && snap.name) || (id ? 'Deleted product' : '—');

  const unit = (snap && snap.unit) || (activeProduct && activeProduct.unit) || 'Pcs';
  const sku = (snap && snap.sku) || (activeProduct && activeProduct.sku) || '';
  const barcode = (m && m.barcode) || (snap && snap.barcode) || (activeProduct && activeProduct.barcode) || '';

  return { id, name, unit, sku, barcode };
}

function renderStockTimeline() {
  const body = els('stockTimelineBody');
  if (!body) return;

  const activeIds = new Set((products || []).map(p => String(p.id)));
  const productMap = new Map((products || []).map(p => [String(p.id), p]));
  // Deletion snapshots keep name/SKU available for every older movement of a
  // product that no longer exists. Prefer the snapshot from the deletion event.
  const historySnapshots = new Map();
  (stockMovements || []).forEach(m => {
    const pid = (m && m.productId) ? String(m.productId) : '';
    if (!pid || !m.productSnapshot || typeof m.productSnapshot !== 'object') return;
    if (m.type === 'deleted' || !historySnapshots.has(pid)) historySnapshots.set(pid, m.productSnapshot);
  });
  const f = stockTimelineFilters || { type: 'all', product: 'all', from: '', to: '', q: '' };
  const q = (f.q || '').trim().toLowerCase();
  const rows = (stockMovements || []).filter(m => {
    if (f.type === 'sales' && m.type !== 'sold') return false;
    if (f.type !== 'all' && f.type !== 'sales' && m.type !== f.type) return false;
    if (f.product && f.product !== 'all' && m.productId !== f.product) return false;
    if (f.from) {
      const d = parseDateOnly(f.from);
      if (d && Number(m.ts) < d.getTime()) return false;
    }
    if (f.to) {
      const d = parseDateOnly(f.to);
      if (d && Number(m.ts) >= d.getTime() + 86400000) return false;
    }
    if (q) {
      const snap = (m.productSnapshot && typeof m.productSnapshot === 'object') ? m.productSnapshot : null;
      const hay = [
        m.productName,
        snap && snap.name,
        snap && snap.category,
        snap && snap.sku,
        m.note,
        m.type,
        m.user,
        m.barcode
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const productSel = els('stlProduct');
  if (productSel) {
    const names = new Map();
    products.forEach(p => names.set(String(p.id), p.name));
    (stockMovements || []).forEach(m => {
      const id = m.productId ? String(m.productId) : '';
      if (!id || names.has(id)) return;
      const name = m.productName || (m.productSnapshot && m.productSnapshot.name);
      if (name) names.set(id, name);
    });
    const opts = ['<option value="all">All products</option>'].concat(
      Array.from(names.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])))
        .map(([id, name]) => {
          const deleted = !activeIds.has(id);
          return `<option value="${escapeNotifHtml(id)}"${f.product === id ? ' selected' : ''}>${escapeNotifHtml(name)}${deleted ? ' (Deleted)' : ''}</option>`;
        })
    );
    productSel.innerHTML = opts.join('');
  }

  const summary = els('stockTimelineSummary');
  if (summary) {
    summary.textContent = rows.length + ' activit' + (rows.length === 1 ? 'y' : 'ies') + ' shown';
  }

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="table-empty">No stock activity matches these filters. Product creation, sales, returns, damage, edits and deletes will appear here.</td></tr>';
    return;
  }

  body.innerHTML = rows.slice(0, 500).map(m => {
    const meta = stockTypeMeta(m.type);
    const delta = Number(m.qtyChange) || 0;
    const deltaText = delta === 0 ? '—' : (delta > 0 ? '+' + delta : String(delta));
    const deltaCls = delta > 0 ? 'text-green' : (delta < 0 ? 'text-red' : 'text-muted');
    const info = stockMovementProductInfo(m, productMap, historySnapshots);

    const productIdText = info.sku ? ('SKU: ' + info.sku) : (info.barcode || '');

    const afterNum = (m.qtyAfter == null || m.qtyAfter === '') ? null : Number(m.qtyAfter);
    const beforeNum = (m.qtyBefore != null && m.qtyBefore !== '')
      ? Number(m.qtyBefore)
      : ((afterNum != null && m.qtyChange != null) ? afterNum - Number(m.qtyChange) : null);
    const hasAfter = afterNum != null && Number.isFinite(afterNum);
    const hasBefore = beforeNum != null && Number.isFinite(beforeNum);

    return `<tr>
      <td>${escapeNotifHtml(m.date || '')}</td>
      <td>
        <div class="stl-product-name"><span class="fw-semi">${escapeNotifHtml(info.name)}</span></div>
        ${productIdText ? `<div class="stl-product-id">${escapeNotifHtml(productIdText)}</div>` : ''}
      </td>
      <td><span class="badge-pill ${escapeNotifHtml(meta.cls)}">${escapeNotifHtml(meta.label)}</span></td>
      <td class="fw-semi ${deltaCls}">${deltaText}</td>
      <td>
        ${hasAfter ? `<div class="stl-stock-now">${escapeNotifHtml(fmtStockQty(afterNum))} ${escapeNotifHtml(info.unit)}</div>` : '<span class="text-muted">—</span>'}
        ${hasBefore ? `<div class="stl-stock-prev">Previous: ${escapeNotifHtml(fmtStockQty(beforeNum))}</div>` : ''}
      </td>
      <td>${escapeNotifHtml(m.note || '—')}</td>
      <td>${escapeNotifHtml(m.user || '—')}</td>
    </tr>`;
  }).join('');
}

function setupStockTimeline() {
  const type = els('stlType');
  const product = els('stlProduct');
  const from = els('stlFrom');
  const to = els('stlTo');
  const q = els('stlSearch');
  const clear = els('stlClearBtn');
  const read = () => {
    stockTimelineFilters = {
      type: (type && type.value) || 'all',
      product: (product && product.value) || 'all',
      from: (from && from.value) || '',
      to: (to && to.value) || '',
      q: (q && q.value) || ''
    };
    renderStockTimeline();
  };
  [type, product, from, to].forEach(el => el && el.addEventListener('change', read));
  q && q.addEventListener('input', read);
  clear && clear.addEventListener('click', () => {
    stockTimelineFilters = { type: 'all', product: 'all', from: '', to: '', q: '' };
    if (type) type.value = 'all';
    if (product) product.value = 'all';
    if (from) from.value = '';
    if (to) to.value = '';
    if (q) q.value = '';
    renderStockTimeline();
  });
}

function expiryStatus(p) {
  if (!p || !p.expiryDate || Number(p.stock) <= 0) return null;
  const days = daysUntilDate(p.expiryDate);
  if (days === null) return null;
  if (days < 0) return { cls: 'badge-red', label: 'Expired ' + Math.abs(days) + 'd ago' };
  if (days === 0) return { cls: 'badge-red', label: 'Expires today' };
  if (days <= EXPIRY_ALERT_DAYS) return { cls: 'badge-amber', label: 'Expires in ' + days + 'd' };
  return null;
}

function escapeNotifHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function minStockOf(p) {
  const n = Number(p && p.minStock);
  return Number.isFinite(n) ? n : 5;
}

function getProductAlerts() {
  const dismissed = DB.get('dismissedAlerts') || [];
  const alerts = [];

  products.forEach(p => {
    const stock = Number(p.stock) || 0;
    const min = minStockOf(p);
    const unit = p.unit || 'Pcs';

    // Stock alerts
    if (stock <= 0) {
      const key = 'stock|' + p.id + '|out|' + stock;
      if (!dismissed.includes(key)) {
        alerts.push({ key, id: p.id, name: p.name, type: 'out', days: 0, stock, unit, min });
      }
    } else if (stock <= min) {
      const key = 'stock|' + p.id + '|low|' + stock + '|' + min;
      if (!dismissed.includes(key)) {
        alerts.push({ key, id: p.id, name: p.name, type: 'low', days: 0, stock, unit, min });
      }
    }

    // Expiry alerts
    if (p.expiryDate && stock > 0) {
      const days = daysUntilDate(p.expiryDate);
      if (days !== null && days <= EXPIRY_ALERT_DAYS) {
        const key = 'expiry|' + p.id + '|' + p.expiryDate;
        if (!dismissed.includes(key)) {
          alerts.push({
            key, id: p.id, name: p.name,
            type: days < 0 ? 'expired' : 'expiring',
            days, date: p.expiryDate, stock, unit, min
          });
        }
      }
    }
  });

  const rank = { expired: 0, out: 1, expiring: 2, low: 3 };
  return alerts.sort((a, b) => {
    const diff = (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
    return diff !== 0 ? diff : a.days - b.days;
  });
}

// ── 80% MONTHLY BILL USAGE ALERT ─────────────────────────────────────────
let usageAlertCurrent = null;
let usageAlertTimer = null;

function getBillUsageAlert() {
  try {
    if (!window.HisaabSaaS || typeof window.HisaabSaaS.getUsageAlert !== 'function') return null;
    return window.HisaabSaaS.getUsageAlert();
  } catch (err) { return null; }
}

function getVisibleBillUsageAlert() {
  const alert = getBillUsageAlert();
  if (!alert) return null;
  const stored = DB.get('dismissedAlerts');
  const dismissed = Array.isArray(stored) ? stored : [];
  if (dismissed.indexOf(alert.key) >= 0) return null;
  return alert;
}

function billUsageAlertItemHtml(alert) {
  const key = String(alert.key || '').replace(/'/g, "\\'");
  return `
      <div class="notif-item is-usage" role="menuitem" tabindex="0"
        onclick="openUsagePricing()"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openUsagePricing();}">
        <span class="notif-dot" aria-hidden="true"></span>
        <div class="notif-item-body">
          <div class="notif-item-name">${escapeNotifHtml(alert.percent + '% of monthly bills used')}</div>
          <div class="notif-item-msg">${escapeNotifHtml(alert.message)}</div>
          <div class="notif-item-date">${escapeNotifHtml(alert.used + ' of ' + alert.limit + ' bills used')}</div>
          <button class="notif-action-btn" type="button"
            onclick="event.stopPropagation();openUsagePricing()">Upgrade Plan</button>
        </div>
        <button class="notif-dismiss" type="button" title="Dismiss alert" aria-label="Dismiss alert"
          onclick="dismissNotifAlert(event, '${key}')">&times;</button>
      </div>`;
}

function showUsageAlertPopup(alert) {
  const popup = els('usageAlertPopup');
  if (!popup || !alert) return false;
  usageAlertCurrent = alert;

  const percent = Math.max(0, Math.min(100, Number(alert.percent) || 0));
  const title = els('usageAlertTitle');
  if (title) title.textContent = alert.percent + '% of your monthly bills used';
  const text = els('usageAlertText');
  if (text) text.textContent = alert.message;
  const usage = els('usageAlertUsage');
  if (usage) usage.textContent = alert.used + ' of ' + alert.limit + ' bills used';
  const fill = els('usageAlertFill');
  if (fill) {
    fill.style.width = percent + '%';
    fill.classList.toggle('is-high', percent >= 90);
  }

  popup.classList.remove('hidden');
  if (usageAlertTimer) clearTimeout(usageAlertTimer);
  usageAlertTimer = setTimeout(hideUsageAlertPopup, 20000);
  return true;
}

function hideUsageAlertPopup() {
  const popup = els('usageAlertPopup');
  if (popup) popup.classList.add('hidden');
  if (usageAlertTimer) { clearTimeout(usageAlertTimer); usageAlertTimer = null; }
}

function openUsagePricing() {
  hideUsageAlertPopup();
  closeNotifPanel();
  if (window.HisaabSaaS && typeof window.HisaabSaaS.openPricing === 'function') {
    window.HisaabSaaS.openPricing();
    return;
  }
  if (typeof switchToView === 'function') switchToView('subscription');
}

function setupUsageAlert() {
  els('usageAlertUpgrade')?.addEventListener('click', openUsagePricing);
  els('usageAlertDismiss')?.addEventListener('click', hideUsageAlertPopup);
  els('usageAlertClose')?.addEventListener('click', hideUsageAlertPopup);
}

function renderNotifications() {
  const badge = els('notifBadge');
  const list = els('notifList');
  if (!badge || !list) return;

  const alerts = getProductAlerts();
  const usageAlert = getVisibleBillUsageAlert();
  const total = alerts.length + (usageAlert ? 1 : 0);

  badge.textContent = total > 9 ? '9+' : String(total);
  badge.classList.toggle('hidden', total === 0);

  const btn = els('notifBtn');
  if (btn) btn.setAttribute('aria-label', total ? total + ' alerts' : 'Alerts');
  const sub = els('notifSub');
  if (sub) sub.textContent = usageAlert
    ? 'Plan usage, low stock and expiry'
    : 'Low stock, out of stock and expiry';

  if (!total) {
    list.innerHTML = `
      <div class="notif-empty">
        <span class="notif-empty-ico">✓</span>
        <div>
          <strong>No alerts</strong>
          <p>Products that are low, out of stock, expiring within ${EXPIRY_ALERT_DAYS} days, or expired will appear here.</p>
        </div>
      </div>`;
    return;
  }

  const usageHtml = usageAlert ? billUsageAlertItemHtml(usageAlert) : '';
  list.innerHTML = usageHtml + alerts.map(a => {
    const critical = a.type === 'expired' || a.type === 'out';
    let msg = '';
    let meta = '';

    if (a.type === 'expired') {
      const n = Math.abs(a.days);
      msg = `Expired ${n} day${n === 1 ? '' : 's'} ago · ${a.stock} ${a.unit} in stock`;
      meta = 'Expiry: ' + fmtShortDate(a.date);
    } else if (a.type === 'expiring') {
      msg = a.days === 0
        ? `Expires today · ${a.stock} ${a.unit} in stock`
        : `Expires in ${a.days} day${a.days === 1 ? '' : 's'} · ${a.stock} ${a.unit} in stock`;
      meta = 'Expiry: ' + fmtShortDate(a.date);
    } else if (a.type === 'out') {
      msg = 'Out of stock · reorder now';
      meta = `Minimum stock: ${a.min} ${a.unit}`;
    } else {
      msg = `Low stock · ${a.stock} ${a.unit} left`;
      meta = `Minimum stock: ${a.min} ${a.unit}`;
    }

    return `
      <div class="notif-item${critical ? ' is-expired' : ''}" role="menuitem" tabindex="0"
        onclick="openAlertProduct('${a.id}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openAlertProduct('${a.id}');}">
        <span class="notif-dot" aria-hidden="true"></span>
        <div class="notif-item-body">
          <div class="notif-item-name">${escapeNotifHtml(a.name)}</div>
          <div class="notif-item-msg">${escapeNotifHtml(msg)}</div>
          <div class="notif-item-date">${escapeNotifHtml(meta)}</div>
        </div>
        <button class="notif-dismiss" type="button" title="Dismiss alert" aria-label="Dismiss alert"
          onclick="dismissNotifAlert(event, '${a.key.replace(/'/g, "\\'")}')">&times;</button>
      </div>`;
  }).join('');
}

function openAlertProduct(id) {
  closeNotifPanel();
  if (typeof openAddProductPage === 'function') openAddProductPage(id);
}

function dismissNotifAlert(ev, key) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const dismissed = DB.get('dismissedAlerts') || [];
  if (!dismissed.includes(key)) dismissed.push(key);
  DB.set('dismissedAlerts', dismissed);
  renderNotifications();
}

function closeNotifPanel() {
  const panel = els('notifPanel');
  const btn = els('notifBtn');
  if (panel) panel.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function setupNotifications() {
  const btn = els('notifBtn');
  const panel = els('notifPanel');
  if (!btn || !panel) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = panel.classList.contains('hidden');
    if (willOpen) renderNotifications();
    panel.classList.toggle('hidden', !willOpen);
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  els('notifCloseBtn')?.addEventListener('click', closeNotifPanel);

  document.addEventListener('click', (e) => {
    if (panel.classList.contains('hidden')) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    closeNotifPanel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNotifPanel();
  });

  renderNotifications();
  setInterval(renderNotifications, 60000);
}

// ─── ADD / EDIT PRODUCT MODULE (Full Design Workflow) ─────────
let apAttributes = [];
let apUploadedImages = [];
let apActiveTab = 'general';
let apVariantRows = []; // saved per-variant rows when editing a variant product

function updateBarcodeStatus(barcode) {
  const statusText = els('apBarcodeStatusText');
  const dot = document.querySelector('.ap-barcode-dot');
  if (!statusText) return;

  if (!barcode) {
    statusText.innerHTML = 'Ready for scanner (USB, Mobile, or Camera)';
    if (dot) dot.style.background = 'var(--purple-400)';
    return;
  }

  const existing = products.find(p =>
    p.barcode &&
    p.barcode.toLowerCase() === barcode.toLowerCase() &&
    p.id !== editingProductId
  );

  if (existing) {
    statusText.innerHTML = `<span style="color:var(--red,#ef4444);font-weight:600;">⚠️ Already in use by: <strong>${existing.name}</strong></span>`;
    if (dot) dot.style.background = 'var(--red,#ef4444)';
  } else {
    statusText.innerHTML = `<span style="color:var(--green,#10b981);font-weight:600;">✓ Valid unique barcode (${barcode.length} chars)</span>`;
    if (dot) dot.style.background = 'var(--green,#10b981)';
  }
}

function setProductBarcode(code) {
  if (!code) return;
  const barcode = String(code).trim();
  const input = els('apBarcode');
  if (!input) return;

  input.value = barcode;
  switchAddProductTab('general');
  input.focus();

  // Visual pulse & audio beep
  input.classList.remove('barcode-pulse');
  void input.offsetWidth;
  input.classList.add('barcode-pulse');
  playScanBeep(true);

  const badge = els('apBarcodeBadge');
  if (badge) {
    badge.textContent = 'Scanned ✓';
    badge.style.display = 'inline-block';
  }

  updateBarcodeStatus(barcode);
  toast(`📷 Barcode Scanned: ${barcode}`, 'success');
}

// Current GST slabs (post GST 2.0: 0 / 5 / 18 / 40, plus the 3% rate for
// gold & jewellery). Products saved before the reform may still carry 12% or
// 28%, so those are re-added as a "Legacy rate" option while editing instead
// of silently changing the saved rate.
const AP_GST_SLABS = [0, 3, 5, 18, 40];

function syncTaxSelect(value) {
  const sel = els('apTax');
  if (!sel) return;
  const v = String(Number(value) || 0);
  let opt = Array.from(sel.options).find(o => o.value === v);
  if (!opt) {
    opt = document.createElement('option');
    opt.value = v;
    opt.textContent = 'GST ' + v + '% — Legacy rate';
    opt.dataset.legacy = '1';
    const next = Array.from(sel.options).find(o => Number(o.value) > Number(v));
    sel.insertBefore(opt, next || null);
  }
  sel.value = v;
}

function clearLegacyTaxRates() {
  const sel = els('apTax');
  if (!sel) return;
  Array.from(sel.options).forEach(o => { if (o.dataset.legacy === '1') o.remove(); });
}

function openAddProductPage(productId = null) {
  editingProductId = productId;
  apUploadedImages = [];
  apActiveTab = 'general';
  switchAddProductTab('general');

  if (productId) {
    const p = products.find(x => x.id === productId);
    if (!p) return;
    els('apPageTitle').textContent = 'Edit Product';
    els('apBreadcrumbCurrent').textContent = 'Edit Product';
    els('apName').value = p.name || '';
    els('apDesc').value = p.description || '';
    els('apSku').value = p.sku || '';
    els('apBarcode').value = p.barcode || '';
    updateBarcodeStatus(p.barcode || '');
    const badge = els('apBarcodeBadge');
    if (badge) {
      badge.textContent = p.barcode ? 'Saved' : '';
      badge.style.display = p.barcode ? 'inline-block' : 'none';
    }
    els('apHsn').value = p.hsn || '';

    // Category/subcategory are stored as names. Ensure selects contain the
    // saved (or imported/custom) values so Edit Product populates correctly.
    const setSelectValue = (select, value, managedList) => {
      if (!select) return;
      let resolved = String(value || '').trim();
      if (resolved && Array.isArray(managedList)) {
        const rec = managedList.find(item => item && String(item.name || '').trim().toLowerCase() === resolved.toLowerCase());
        if (rec && rec.name) resolved = String(rec.name);
      }
      if (resolved && !Array.from(select.options).some(o => String(o.value).toLowerCase() === resolved.toLowerCase())) {
        const opt = document.createElement('option');
        opt.value = resolved;
        opt.textContent = resolved;
        select.appendChild(opt);
      }
      select.value = resolved || '';
      if (resolved && String(select.value).toLowerCase() !== resolved.toLowerCase()) {
        const match = Array.from(select.options).find(o => String(o.value).toLowerCase() === resolved.toLowerCase());
        if (match) select.value = match.value;
      }
    };
    setSelectValue(els('apCategory'), p.category, typeof categories !== 'undefined' ? categories : []);
    setSelectValue(els('apSubCategory'), p.subCategory, typeof subcategories !== 'undefined' ? subcategories : []);

    els('apBrand').value = p.brand || '';
    els('apPrimaryUnit').value = p.unit || 'Pcs';

    // Pricing & Stocks
    const hasVar = Boolean(p.hasVariants && ((Array.isArray(p.variants) && p.variants.length) || (Array.isArray(p.attributes) && p.attributes.length)));
    els('apHasVariants').checked = hasVar;
    apVariantRows = Array.isArray(p.variants) ? JSON.parse(JSON.stringify(p.variants)) : [];
    toggleVariantsDisplay(hasVar);
    els('apHasVariants').onchange = (e) => toggleVariantsDisplay(e.target.checked);
    els('apAddAttributeBtn').onclick = addAttributeRow;
    if (els('apCopyVariantPricingBtn')) els('apCopyVariantPricingBtn').onclick = copyFirstVariantPricingToAll;
    if (els('apSaveBtn')) els('apSaveBtn').onclick = () => saveNewProductWorkflow(false);
    if (els('apNextBtn')) els('apNextBtn').onclick = () => {
      if (apActiveTab === 'general') switchAddProductTab('pricing');
      else if (apActiveTab === 'pricing') switchAddProductTab('images');
      else saveNewProductWorkflow(false);
    };
    if (els('apCancelBtn')) els('apCancelBtn').onclick = () => switchToView('inventory');
    if (els('apDraftBtn')) els('apDraftBtn').onclick = () => saveNewProductWorkflow(true);

    els('apPurchasePrice').value = p.purchasePrice || '';
    els('apSellingPrice').value = p.price || '';
    els('apMrp').value = p.mrp || p.price || '';
    clearLegacyTaxRates();
    syncTaxSelect((p.tax === 0 || p.tax) ? p.tax : 18);
    if (els('apTaxInclusive')) els('apTaxInclusive').checked = !!p.taxInclusive;
    updateSellingPriceLabel();
    els('apStockQty').value = p.stock || 0;
    els('apMinStock').value = p.minStock || 5;
    if (els('apExpiryDate')) els('apExpiryDate').value = p.expiryDate || '';
    if (els('apWarrantyMonths')) els('apWarrantyMonths').value = p.warrantyMonths || '';
    const dt = String(p.discountType || '').toLowerCase();
    els('apDiscountType').value = dt === 'fixed' ? 'fixed' : 'percentage';
    els('apDiscountVal').value = p.discount || 0;
    updateDiscountSymbol();

    if (p.attributes && p.attributes.length) {
      apAttributes = JSON.parse(JSON.stringify(p.attributes));
    } else {
      apAttributes = [];
    }
    renderAttributesAndMatrix();
    if (hasVar) fillVariantsMatrixFromSaved(apVariantRows);

    // Load existing images into the preview grid
    if (p.images && Array.isArray(p.images) && p.images.length) {
      apUploadedImages = p.images.map((url, i) => ({ url, name: 'image-' + i, isPrimary: i === 0 }));
    } else if (p.image) {
      apUploadedImages = [{ url: p.image, name: 'image-0', isPrimary: true }];
    }
    renderImagePreviews();
  } else {
    els('apPageTitle').textContent = 'Add Product';
    els('apBreadcrumbCurrent').textContent = 'Add Product';
    // Clear all fields
    ['apName', 'apDesc', 'apHsn', 'apPurchasePrice', 'apSellingPrice', 'apMrp',
      'apStockQty', 'apExpiryDate', 'apWarrantyMonths', 'apDiscountVal'].forEach(id => {
        if (els(id)) els(id).value = '';
      });
    els('apSku').value = generateAutoSku();
    els('apBarcode').value = ''; // Clean for scanning!
    updateBarcodeStatus('');
    const badge = els('apBarcodeBadge');
    if (badge) badge.style.display = 'none';

    els('apCategory').value = '';
    els('apSubCategory').value = '';
    els('apBrand').value = '';
    els('apPrimaryUnit').value = 'Pcs';
    clearLegacyTaxRates();
    syncTaxSelect(18);
    if (els('apTaxInclusive')) els('apTaxInclusive').checked = false;
    updateSellingPriceLabel();
    els('apMinStock').value = 5;
    els('apDiscountType').value = 'percentage';
    updateDiscountSymbol();

    // Default variants: completely empty, no prefilled data
    els('apHasVariants').checked = false;
    toggleVariantsDisplay(false);
    // Ensure variants toggle handler is wired (init() may not have run if
    // DOMContentLoaded already fired before app.js loaded)
    els('apHasVariants').onchange = (e) => toggleVariantsDisplay(e.target.checked);
    // Ensure Add Attribute handler is wired
    els('apAddAttributeBtn').onclick = addAttributeRow;
    if (els('apCopyVariantPricingBtn')) els('apCopyVariantPricingBtn').onclick = copyFirstVariantPricingToAll;
    if (els('apSaveBtn')) els('apSaveBtn').onclick = () => saveNewProductWorkflow(false);
    if (els('apNextBtn')) els('apNextBtn').onclick = () => {
      if (apActiveTab === 'general') switchAddProductTab('pricing');
      else if (apActiveTab === 'pricing') switchAddProductTab('images');
      else saveNewProductWorkflow(false);
    };
    if (els('apCancelBtn')) els('apCancelBtn').onclick = () => switchToView('inventory');
    if (els('apDraftBtn')) els('apDraftBtn').onclick = () => saveNewProductWorkflow(true);
    apAttributes = [];
    apVariantRows = [];
    renderAttributesAndMatrix();
  }
  renderImagePreviews();
  switchToView('add-product');
}

function viewProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const esc = (v) => escapeNotifHtml(v == null || v === '' ? '—' : v);
  const exp = expiryStatus(p);
  const stockCls = Number(p.stock) === 0 ? 'stock-out' : (Number(p.stock) <= minStockOf(p) ? 'stock-low' : 'stock-ok');
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--grey-200);" />`
    : `<div style="width:72px;height:72px;border-radius:10px;background:var(--grey-100);display:flex;align-items:center;justify-content:center;font-size:30px;">${p.emoji || '📦'}</div>`;
  const row = (label, value) => `<div class="pd-row"><span class="pd-label">${label}</span><span class="pd-value">${value}</span></div>`;

  els('productDetailTitle').textContent = p.name || 'Product Details';
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const hasVariants = p.hasVariants && variants.length;
  let variantsHtml = '';
  if (hasVariants) {
    const attrs = Array.isArray(p.attributes) ? p.attributes.filter(a => a && (a.name || (a.options && a.options.length))) : [];
    let attrNames = attrs.map(a => a.name || 'Attribute');
    if (!attrNames.length && variants[0]) {
      if (Array.isArray(variants[0].attrNames)) attrNames = variants[0].attrNames.slice();
      else if (Array.isArray(variants[0].options)) attrNames = variants[0].options.map((_, i) => 'Attribute ' + (i + 1));
      else {
        attrNames = [variants[0].attr1Name || 'Option 1'];
        if (variants[0].attr2Name || variants[0].option2) attrNames.push(variants[0].attr2Name || 'Option 2');
      }
    }
    if (!attrNames.length) attrNames = ['Option'];
    const getOpts = (v) => {
      if (Array.isArray(v.options)) return v.options.slice();
      const o = [v.option1 != null ? v.option1 : (v.opt1 != null ? v.opt1 : '')];
      const hasSecond = v.option2 != null || v.opt2 != null || attrNames.length > 1;
      if (hasSecond) o.push(v.option2 != null ? v.option2 : (v.opt2 != null ? v.opt2 : ''));
      for (let i = 3; i <= attrNames.length || v['option' + i] != null; i++) {
        if (v['option' + i] != null) o.push(v['option' + i]);
      }
      return o;
    };
    const vRows = variants.map(v => {
      const vStock = Number(v.stock != null ? v.stock : v.qty) || 0;
      const vExp = v.expiryDate ? fmtShortDate(v.expiryDate) : '—';
      const vWar = v.warrantyMonths ? (v.warrantyMonths + ' mo') : '—';
      const opts = getOpts(v);
      const optCells = attrNames.map((_, i) => `<td style="padding:8px 10px;${i === 0 ? 'font-weight:600;' : ''}">${esc(opts[i] || '—')}</td>`).join('');
      return `<tr>
        ${optCells}
        <td style="padding:8px 10px;">${esc(vStock + ' ' + (p.unit || 'Pcs'))}</td>
        <td style="padding:8px 10px;">${esc(fmt(v.price || 0))}</td>
        <td style="padding:8px 10px;">${esc(fmt(v.mrp || v.price || 0))}</td>
        <td style="padding:8px 10px;">${esc((Number(v.tax) || 0) + '%')}</td>
        <td style="padding:8px 10px;">${esc(v.discount ? v.discount : '—')}</td>
        <td style="padding:8px 10px;">${esc(vExp)}</td>
        <td style="padding:8px 10px;">${esc(vWar)}</td>
      </tr>`;
    }).join('');
    const headCells = attrNames.map(n => `<th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">${esc(n)}</th>`).join('');
    const colCount = attrNames.length + 7;
    variantsHtml = `
      <div style="margin-top:14px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--grey-700,#374151);">Variants (${variants.length})</div>
        <div style="overflow:auto;border:1px solid var(--grey-200,#e5e7eb);border-radius:10px;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:var(--grey-50,#f9fafb);text-align:left;">
                ${headCells}
                <th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">Stock</th>
                <th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">Price</th>
                <th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">MRP</th>
                <th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">Tax</th>
                <th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">Discount</th>
                <th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">Expiry</th>
                <th style="padding:8px 10px;border-bottom:1px solid var(--grey-200,#e5e7eb);">Warranty</th>
              </tr>
            </thead>
            <tbody>${vRows || `<tr><td colspan="${colCount}" style="padding:10px;color:var(--grey-400);">No variant rows saved.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }

  els('productDetailBody').innerHTML = `
    <div class="pd-head">
      ${img}
      <div style="min-width:0;">
        <div class="pd-name">${esc(p.name)}</div>
        <div class="pd-meta">${esc([p.category, p.subCategory, p.brand].filter(Boolean).join(' • ') || 'Uncategorized')}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
          ${Number(p.stock) === 0 ? '<span class="badge-pill badge-red">Out of Stock</span>' : (Number(p.stock) <= minStockOf(p) ? '<span class="badge-pill badge-amber">Low Stock</span>' : '<span class="badge-pill badge-green">In Stock</span>')}
          ${exp ? `<span class="badge-pill ${exp.cls}">${esc(exp.label)}</span>` : ''}
          ${p.warrantyMonths ? `<span class="badge-pill badge-purple">${esc(p.warrantyMonths)} mo warranty</span>` : ''}
          ${hasVariants ? `<span class="badge-pill badge-purple">${esc(variants.length)} variants</span>` : ''}
        </div>
      </div>
    </div>
    ${p.description ? `<div class="pd-desc">${esc(p.description)}</div>` : ''}
    <div class="pd-grid">
      ${row('Barcode', esc(p.barcode))}
      ${row('SKU / Item Code', esc(p.sku))}
      ${row('HSN', esc(p.hsn))}
      ${row('Unit', esc(p.unit || 'Pcs'))}
      ${row('Selling Price', hasVariants ? esc('Varies by variant') : esc(fmt(p.price)))}
      ${row('MRP', hasVariants ? esc('Varies by variant') : esc(fmt(p.mrp || p.price)))}
      ${row('Purchase Price', (!hasVariants && p.purchasePrice) ? esc(fmt(p.purchasePrice)) : (hasVariants ? 'Varies by variant' : '—'))}
      ${row('Tax / GST', hasVariants ? 'Per variant' : (esc((Number(p.tax) || 0) + '%') + (p.taxInclusive ? ' · Inclusive' : ' · Exclusive')))}
      ${row('Current Stock', `<span class="${stockCls}">${esc((Number(p.stock) || 0) + ' ' + (p.unit || 'Pcs'))}${hasVariants ? ' (total)' : ''}</span>`)}
      ${row('Minimum Stock', esc((minStockOf(p)) + ' ' + (p.unit || 'Pcs')))}
      ${row('Expiry Date', p.expiryDate ? esc(fmtShortDate(p.expiryDate) + ' (' + p.expiryDate + ')') : (hasVariants ? 'Per variant' : '—'))}
      ${row('Warranty', p.warrantyMonths ? esc(p.warrantyMonths + ' month' + (Number(p.warrantyMonths) === 1 ? '' : 's')) : (hasVariants ? 'Per variant' : '—'))}
      ${row('Discount', hasVariants ? 'Per variant' : (p.discount ? esc(p.discount + (String(p.discountType || '').toLowerCase() === 'fixed' ? ' (₹)' : '%')) : '-'))}
      ${row('Status', esc(p.status || '—'))}
    </div>
    ${variantsHtml}`;

  const editBtn = els('editProductDetailBtn');
  if (editBtn) editBtn.onclick = () => { hideModal('productDetailModal'); editProduct(p.id); };
  showModal('productDetailModal');
}

function editProduct(id) {
  openAddProductPage(id);
}

function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  const p = products.find(x => x.id === id);
  if (p) {
    const lastStock = Number(p.stock) || 0;
    // Never record the same deletion twice (e.g. stale tab, repeated click).
    const alreadyLogged = (DB.get('stockMovements') || []).some(
      m => m && m.type === 'deleted' && String(m.productId) === String(p.id)
    );
    if (!alreadyLogged) {
      // Snapshot the product inside the deletion movement. Stock history stays
      // readable even though the product row itself is gone.
      const productSnapshot = {
        id: p.id,
        name: p.name,
        sku: p.sku || '',
        barcode: p.barcode || '',
        category: p.category || '',
        subCategory: p.subCategory || '',
        brand: p.brand || '',
        unit: p.unit || 'Pcs',
        price: Number(p.price) || 0,
        mrp: Number(p.mrp) || 0,
        tax: Number(p.tax) || 0,
        stock: lastStock,
        hasVariants: !!p.hasVariants,
        variants: Array.isArray(p.variants) ? p.variants.map(v => Object.assign({}, v)) : []
      };
      logStockMovement({
        type: 'deleted',
        productId: p.id,
        productName: p.name,
        sku: p.sku || '',
        barcode: p.barcode || '',
        productSnapshot,
        qtyChange: 0,
        qtyBefore: lastStock,
        qtyAfter: 0,
        note: 'Product deleted from inventory'
      });
    }
  }
  products = products.filter(x => x.id !== id);
  DB.set('products', products);
  if (window.HisaabSaaS && typeof window.HisaabSaaS.syncProducts === 'function') {
    window.HisaabSaaS.syncProducts(products.length);
  }
  renderInventory();
  renderStockTimeline();
  toast('Product deleted. Its stock history is kept in Stock Timeline.', 'warning');
}

function switchAddProductTab(tab) {
  apActiveTab = tab;
  document.querySelectorAll('.ap-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.apTab === tab);
  });
  document.querySelectorAll('.ap-tab-content').forEach(c => {
    c.classList.toggle('active', c.id === 'apTab-' + tab);
  });
}

function generateAutoSku() {
  return 'SKU-' + Math.floor(1000 + Math.random() * 9000);
}

// EAN-13 check digit so the generated barcode is printable AND scannable
function ean13CheckDigit(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(code12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

function generateAutoBarcode() {
  for (let attempt = 0; attempt < 25; attempt++) {
    // 890 = India GS1 prefix, then 9 random digits, then the EAN-13 checksum
    const body = '890' + String(Math.floor(Math.random() * 1000000000)).padStart(9, '0');
    const code = body + ean13CheckDigit(body);
    const taken = (typeof products !== 'undefined' && Array.isArray(products))
      ? products.some(p => p.barcode === code)
      : false;
    if (!taken) return code;
  }
  // Extremely unlikely fallback – still valid EAN-13
  const body = '890' + String(Date.now()).slice(-9);
  return body + ean13CheckDigit(body);
}

function updateDiscountSymbol() {
  const sym = els('apDiscountSymbol');
  if (!sym) return;
  sym.textContent = els('apDiscountType')?.value === 'fixed' ? '₹' : '%';
}

function toggleVariantsDisplay(checked) {
  const std = els('apStandardPricingSection');
  const varSec = els('apVariantsSection');
  if (std) std.classList.toggle('hidden', checked);
  if (varSec) varSec.classList.toggle('hidden', !checked);
  if (checked && apAttributes.length === 0) {
    apAttributes = [{ name: '', options: [] }];
    renderAttributesAndMatrix();
  }
}

function updateSellingPriceLabel() {
  const lbl = els('apSellingPriceLabel');
  const inc = !!(els('apTaxInclusive') && els('apTaxInclusive').checked);
  if (lbl) lbl.textContent = inc ? 'Selling Price (Inclusive of Tax) *' : 'Selling Price (Exclusive Tax) *';
  const card = els('apTaxModeCard');
  if (card) card.classList.toggle('is-on', inc);
  const hint = els('apTaxModeHint');
  if (hint) {
    hint.textContent = inc
      ? 'GST is already inside the price — shown separately on the bill, not added on top.'
      : 'GST is added on top of the selling price.';
  }
}

function renderAttributesAndMatrix() {
  const listEl = els('apAttributesList');
  if (!listEl) return;

  if (!apAttributes.length) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:18px;color:var(--grey-400);font-size:13px;">
        No variant attributes added yet. Click <strong>"+ Add Attribute"</strong> below to create your first attribute (e.g. Color, Size).
      </div>
    `;
    renderVariantsMatrixTable();
    return;
  }

  listEl.innerHTML = apAttributes.map((attr, idx) => `
    <div class="ap-attr-row">
      <div>
        <label class="ap-label">Attributes (Color, Size, Weight etc)</label>
        <div class="ap-input-wrapper">
          <input type="text" class="ap-input" value="${attr.name || ''}" placeholder="e.g. Color, Size, Weight"
            oninput="updateAttributeName(${idx}, this.value)" />
        </div>
      </div>
      <div>
        <label class="ap-label">Options (Small, Medium 32, 34 etc)</label>
        <div class="ap-tags-container" id="apTagsWrap_${idx}">
          ${(attr.options || []).map((opt, oIdx) => `
            <span class="ap-tag-chip">
              ${opt}
              <span class="ap-tag-close" onclick="removeOption(${idx}, ${oIdx})">&times;</span>
            </span>
          `).join('')}
          <input type="text" class="ap-tags-input" placeholder="Type option & press Enter…"
            onkeydown="handleOptionInput(event, ${idx})" />
        </div>
      </div>
      <div style="padding-top:24px;">
        <button type="button" class="ap-attr-del-btn" onclick="removeAttributeRow(${idx})" title="Delete Attribute">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19.5 5.5-.62 10.03c-.16 2.56-.24 3.84-1.06 4.63-.66.63-1.59 1.04-2.68 1.04H8.86c-1.09 0-2.02-.41-2.68-1.04-.82-.79-.9-2.07-1.06-4.63L4.5 5.5" />
            <path d="M3 5.5h18M16.06 5.5l-.68-1.41c-.45-.94-.68-1.4-1.07-1.69a2 2 0 0 0-.27-.17C13.6 2 13.08 2 12.04 2c-1.07 0-1.6 0-2.04.23a2 2 0 0 0-.28.18c-.4.3-.62.79-1.06 1.76l-.61 1.33" />
            <path d="M9.5 16.5v-6M14.5 16.5v-6" />
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  renderVariantsMatrixTable();
}

function updateAttributeName(idx, val) {
  if (apAttributes[idx]) {
    apAttributes[idx].name = val.trim();
    renderVariantsMatrixTable();
  }
}

function handleOptionInput(e, attrIdx) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(',', '');
    if (val && !apAttributes[attrIdx].options.includes(val)) {
      apAttributes[attrIdx].options.push(val);
      renderAttributesAndMatrix();
    }
    e.target.value = '';
    // Keep focus on the same input so the user can enter the next option
    // without clicking the box again.
    const wrap = document.getElementById('apTagsWrap_' + attrIdx);
    if (wrap) {
      const input = wrap.querySelector('.ap-tags-input');
      if (input) input.focus();
    }
  }
}

function removeOption(attrIdx, optIdx) {
  apAttributes[attrIdx].options.splice(optIdx, 1);
  renderAttributesAndMatrix();
}

function removeAttributeRow(idx) {
  apAttributes.splice(idx, 1);
  renderAttributesAndMatrix();
}

function addAttributeRow() {
  apAttributes.push({ name: '', options: [] });
  renderAttributesAndMatrix();
}

function cartesianProduct(arrays) {
  if (!arrays.length) return [[]];
  return arrays.reduce((acc, curr) => {
    const res = [];
    acc.forEach(a => curr.forEach(b => res.push(a.concat([b]))));
    return res;
  }, [[]]);
}

function getVariantOptions(v, attrCount) {
  if (Array.isArray(v.options)) return v.options.slice(0, attrCount);
  const opts = [];
  for (let i = 0; i < attrCount; i++) {
    if (i === 0) opts.push(v.option1 != null ? v.option1 : (v.opt1 != null ? v.opt1 : ''));
    else if (i === 1) opts.push(v.option2 != null ? v.option2 : (v.opt2 != null ? v.opt2 : ''));
    else opts.push(v['option' + (i + 1)] != null ? v['option' + (i + 1)] : '');
  }
  return opts;
}

function optionsMatch(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (String(a[i] || '') !== String(b[i] || '')) return false;
  }
  return true;
}

function renderVariantsMatrixTable() {
  const tbody = els('apVariantsTableBody');
  const thead = els('apVariantsTableHead');
  if (!tbody) return;

  const activeAttrs = apAttributes.filter(a => a.options && a.options.length > 0);
  const fixedCols = ['Quantity', 'Purchase Price', 'Selling Price', 'MRP', 'Tax %', 'Discount', 'Expiry Date', 'Warranty (months)'];

  if (!activeAttrs.length) {
    if (thead) {
      thead.innerHTML = `<tr><th>Attribute</th>${fixedCols.map(c => `<th>${c}</th>`).join('')}<th style="width:70px;">Delete</th></tr>`;
    }
    tbody.innerHTML = `<tr><td colspan="${fixedCols.length + 2}" style="text-align:center;padding:28px 16px;color:var(--grey-400);font-size:13px;">No variants configured. Enter attribute name (e.g. Color) and type options (e.g. Red, Blue) above to generate the variant matrix table.</td></tr>`;
    return;
  }

  const attrNames = activeAttrs.map(a => a.name || 'Attribute');
  const optionLists = activeAttrs.map(a => a.options);
  const combos = cartesianProduct(optionLists);

  const escAttr = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/'/g, '&#39;');

  if (thead) {
    thead.innerHTML = `<tr>${attrNames.map(n => `<th>${escAttr(n)}</th>`).join('')}${fixedCols.map(c => `<th>${c}</th>`).join('')}<th style="width:70px;">Delete</th></tr>`;
  }
  const findSaved = (opts) => (apVariantRows || []).find(v => optionsMatch(getVariantOptions(v, activeAttrs.length), opts)) || null;

  // If saved variant rows exist but none match the current attribute combinations
  // (e.g. user added/changed attributes or options), reset so all current combos show.
  if (apVariantRows && apVariantRows.length > 0 && !combos.some(opts => findSaved(opts))) {
    apVariantRows = [];
  }

  const basePurchase = els('apPurchasePrice')?.value || '';
  const basePrice = els('apSellingPrice')?.value || '';
  const baseMrp = els('apMrp')?.value || '';
  const baseTax = els('apTax')?.value || '';
  const baseDiscount = els('apDiscountVal')?.value || '';

  let html = '';
  combos.forEach(opts => {
    if (!(apVariantRows && apVariantRows.length > 0) || findSaved(opts)) {
      const saved = findSaved(opts);
      const qty = saved && saved.stock != null ? saved.stock : (saved && saved.qty != null ? saved.qty : '');
      const purchase = saved && saved.purchasePrice != null ? saved.purchasePrice : basePurchase;
      const price = saved && saved.price != null ? saved.price : basePrice;
      const mrp = saved && saved.mrp != null ? saved.mrp : (baseMrp || price || '');
      const tax = saved && saved.tax != null ? saved.tax : baseTax;
      const discount = saved && saved.discount != null ? saved.discount : baseDiscount;
      const expiry = saved && (saved.expiryDate || saved.expiry) || '';
      const warranty = saved && (saved.warrantyMonths != null ? saved.warrantyMonths : (saved.warranty != null ? saved.warranty : '')) || '';
      const optsJson = escAttr(JSON.stringify(opts));

      html += `<tr class="ap-variant-row" data-options="${optsJson}">`;
      opts.forEach((o, i) => {
        html += `<td class="${i === 0 ? 'ap-tbl-group-col' : ''}"><span class="ap-tag-chip">${escAttr(o)}</span></td>`;
      });
      html += `
          <td><input type="number" class="ap-tbl-input ap-var-field" data-vfield="qty" placeholder="0" min="0" step="1" value="${escAttr(qty)}" /></td>
          <td><input type="number" class="ap-tbl-input ap-var-field" data-vfield="purchasePrice" placeholder="₹ 0.00" min="0" step="0.01" value="${escAttr(purchase)}" /></td>
          <td><input type="number" class="ap-tbl-input ap-var-field" data-vfield="price" placeholder="₹ 0.00" min="0" step="0.01" value="${escAttr(price)}" /></td>
          <td><input type="number" class="ap-tbl-input ap-var-field" data-vfield="mrp" placeholder="₹ 0.00" min="0" step="0.01" value="${escAttr(mrp)}" /></td>
          <td><input type="number" class="ap-tbl-input ap-var-field" data-vfield="tax" placeholder="0 %" min="0" step="0.01" value="${escAttr(tax)}" /></td>
          <td><input type="number" class="ap-tbl-input ap-var-field" data-vfield="discount" placeholder="0" min="0" step="0.01" value="${escAttr(discount)}" /></td>
          <td><input type="date" class="ap-tbl-input ap-var-field" data-vfield="expiryDate" value="${escAttr(expiry)}" /></td>
          <td><input type="number" class="ap-tbl-input ap-var-field" data-vfield="warrantyMonths" placeholder="0" min="0" step="1" value="${escAttr(warranty)}" /></td>
          <td style="text-align:center;">
            <button type="button" class="ap-btn-delete" onclick="deleteVariantRowByKey(this)" title="Delete this variant">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.5 5.5L18.8803 15.5251C18.7219 18.0864 18.6428 19.3671 18.0008 20.2879C17.6833 20.7431 17.2747 21.1273 16.8007 21.416C15.8421 22 14.559 22 11.9927 22C9.42312 22 8.1383 22 7.17905 21.4149C6.7048 21.1257 6.296 20.7408 5.97868 20.2848C5.33688 19.3626 5.25945 18.0801 5.10461 15.5152L4.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3 5.5H21M16.0557 5.5L15.3731 4.09173C14.9196 3.15626 14.6928 2.68852 14.3017 2.39681C14.215 2.3321 14.1231 2.27454 14.027 2.2247C13.5939 2 13.0741 2 12.0345 2C10.9688 2 10.436 2 9.99568 2.23412C9.8981 2.28601 9.80498 2.3459 9.71729 2.41317C9.32164 2.7167 9.10063 3.20155 8.65861 4.17126L8.05292 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.5 16.5L9.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14.5 16.5L14.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </td>
        </tr>`;
    }
  });

  tbody.innerHTML = html || `<tr><td colspan="${activeAttrs.length + fixedCols.length + 1}" style="text-align:center;padding:20px;color:var(--grey-400);">No variants. Add options above to generate variants.</td></tr>`;
}

function fillVariantsMatrixFromSaved(rows) {
  apVariantRows = Array.isArray(rows) ? rows : [];
  // Re-render to apply saved values to inputs
  renderVariantsMatrixTable();
}

function collectVariantsFromMatrix() {
  const tbody = els('apVariantsTableBody');
  if (!tbody) return [];
  const activeAttrs = apAttributes.filter(a => a.options && a.options.length > 0);
  const attrNames = activeAttrs.map(a => a.name || ('Attribute ' + (activeAttrs.indexOf(a) + 1)));
  const rows = Array.from(tbody.querySelectorAll('tr.ap-variant-row'));
  return rows.map((tr, idx) => {
    let opts = [];
    try { opts = JSON.parse(tr.getAttribute('data-options') || '[]'); } catch (e) { opts = []; }
    if (!opts.length) {
      // backward compat
      const o1 = tr.getAttribute('data-opt1') || '';
      const o2 = tr.getAttribute('data-opt2') || '';
      opts = [o1];
      if (o2 && o2 !== 'Default') opts.push(o2);
      else if (activeAttrs.length > 1) opts.push(o2 || '');
    }
    const get = (field) => {
      const input = tr.querySelector(`[data-vfield="${field}"]`);
      return input ? input.value : '';
    };
    const num = (field) => { const v = get(field); return v === '' ? null : Math.max(0, parseFloat(v) || 0); };
    const intNum = (field) => { const v = get(field); return v === '' ? null : Math.max(0, parseInt(v, 10) || 0); };
    const qty = intNum('qty');
    const purchasePrice = num('purchasePrice');
    const price = num('price');
    const mrp = num('mrp') || price;
    const tax = num('tax');
    const discount = num('discount');
    const expiryDate = get('expiryDate') || '';
    const warrantyMonths = intNum('warrantyMonths');
    const label = opts.filter(o => o && o !== 'Default').join(' / ') || ('Variant ' + (idx + 1));
    const existing = (apVariantRows || []).find(v => optionsMatch(getVariantOptions(v, activeAttrs.length), opts));
    const variant = {
      id: (existing && existing.id) ? existing.id : ('var_' + Date.now().toString(36) + '_' + idx),
      options: opts.slice(),
      attrNames: attrNames.slice(),
      // backward compat
      option1: opts[0] || '',
      option2: opts[1] || '',
      attr1Name: attrNames[0] || 'Option 1',
      attr2Name: attrNames[1] || '',
      label,
      stock: qty,
      qty,
      purchasePrice,
      price,
      mrp,
      tax,
      discount,
      expiryDate,
      warrantyMonths
    };
    // store extra options as option3, option4... for compat
    opts.forEach((o, i) => { if (i >= 2) variant['option' + (i + 1)] = o; });
    return variant;
  });
}

function deleteVariantRowByKey(btnOrKey) {
  const activeAttrs = apAttributes.filter(a => a.options && a.options.length > 0);
  let opts = [];
  if (btnOrKey && btnOrKey.closest) {
    const tr = btnOrKey.closest('tr');
    try { opts = JSON.parse(tr?.getAttribute('data-options') || '[]'); } catch (e) { opts = []; }
  } else if (Array.isArray(btnOrKey)) {
    opts = btnOrKey;
  }
  if (!opts.length) return;

  const attrNames = activeAttrs.map(a => a.name || 'Attribute');

  // Seed from all combinations if not yet seeded
  if (!apVariantRows || apVariantRows.length === 0) {
    const optionLists = activeAttrs.map(a => a.options);
    const combos = cartesianProduct(optionLists);
    apVariantRows = combos.map((c, i) => {
      const v = {
        id: 'var_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6) + '_' + i,
        options: c.slice(),
        attrNames: attrNames.slice(),
        option1: c[0] || '',
        option2: c[1] || '',
        attr1Name: attrNames[0] || 'Option 1',
        attr2Name: attrNames[1] || '',
        stock: null, qty: null, purchasePrice: null, price: null, mrp: null,
        tax: null, discount: null, expiryDate: '', warrantyMonths: null
      };
      c.forEach((o, j) => { if (j >= 2) v['option' + (j + 1)] = o; });
      return v;
    });
  }

  apVariantRows = apVariantRows.filter(v => !optionsMatch(getVariantOptions(v, activeAttrs.length), opts));
  renderVariantsMatrixTable();
  toast('Variant removed.', 'info');
}

// backward compat
function deleteVariantRow(opt1, opt2) {
  deleteVariantRowByKey([opt1, opt2]);
}

function copyFirstVariantPricingToAll() {
  const tbody = els('apVariantsTableBody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr.ap-variant-row'));
  if (rows.length < 2) {
    toast('Add at least two variants to copy pricing.', 'info');
    return;
  }
  const fields = ['purchasePrice', 'price', 'mrp', 'tax', 'discount'];
  const first = rows[0];
  const values = {};
  fields.forEach(f => {
    const inp = first.querySelector(`[data-vfield="${f}"]`);
    values[f] = inp ? inp.value : '';
  });
  rows.slice(1).forEach(tr => {
    fields.forEach(f => {
      const inp = tr.querySelector(`[data-vfield="${f}"]`);
      if (inp) inp.value = values[f];
    });
  });
  toast('Pricing copied from the first variant to all other variants. You can still edit individual fields.', 'success');
}

function handleImageFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      apUploadedImages.push({ url: e.target.result, name: file.name, isPrimary: apUploadedImages.length === 0 });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews() {
  const grid = els('apImagesPreviewGrid');
  if (!grid) return;
  if (!apUploadedImages.length) {
    grid.innerHTML = '';
    return;
  }
  grid.innerHTML = apUploadedImages.map((img, i) => `
    <div class="ap-img-card">
      <img src="${img.url}" alt="${img.name}" />
      ${img.isPrimary ? '<span class="ap-img-primary-tag">Primary</span>' : ''}
      <button type="button" class="ap-img-remove-btn" onclick="removeUploadedImage(${i})" title="Remove image">&times;</button>
    </div>
  `).join('');
}

function removeUploadedImage(idx) {
  apUploadedImages.splice(idx, 1);
  if (apUploadedImages.length && !apUploadedImages.some(x => x.isPrimary)) {
    apUploadedImages[0].isPrimary = true;
  }
  renderImagePreviews();
}

function saveNewProductWorkflow(isDraft = false) {
  const name = els('apName').value.trim();
  if (!name) {
    toast('Product Name is required!', 'error');
    switchAddProductTab('general');
    els('apName').focus();
    return;
  }

  const hasVariants = els('apHasVariants').checked;
  let sellingPrice = parseFloat(els('apSellingPrice').value) || 0;
  let stockQty = parseInt(els('apStockQty').value) || 0;
  let variantList = [];

  if (hasVariants) {
    variantList = collectVariantsFromMatrix();
    if (!variantList.length) {
      toast('Please add at least one variant attribute and option.', 'error');
      switchAddProductTab('pricing');
      return;
    }
    stockQty = variantList.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
    if (!sellingPrice) sellingPrice = Number(variantList[0].price) || 0;
  }

  if (!hasVariants && sellingPrice <= 0) {
    toast('Please enter a valid Selling Price!', 'error');
    switchAddProductTab('pricing');
    els('apSellingPrice').focus();
    return;
  }
  if (hasVariants && !variantList.some(v => Number(v.price) > 0)) {
    toast('Please enter a selling price for at least one variant.', 'error');
    switchAddProductTab('pricing');
    return;
  }

  const category = els('apCategory').value || 'Other';
  const emojis = { 'Fruits & Vegetables': '🍎', 'Groceries': '🛒', 'Electronics': '💻', 'Furniture': '🪑', 'Personal Care': '🧴', 'Other': '📦' };

  // Plan-based product limit (only when creating, not editing).
  if (!editingProductId && window.HisaabSaaS && typeof window.HisaabSaaS.canAddProduct === 'function') {
    if (!window.HisaabSaaS.canAddProduct(products.length + 1)) return;
  }

  const inputBarcode = els('apBarcode').value.trim();
  const finalBarcode = inputBarcode || generateAutoBarcode();

  // Check duplicate barcode
  const duplicate = products.find(p =>
    p.barcode &&
    p.barcode.toLowerCase() === finalBarcode.toLowerCase() &&
    p.id !== editingProductId
  );
  if (duplicate) {
    const proceed = confirm(`Barcode "${finalBarcode}" is already assigned to "${duplicate.name}". Do you still want to save?`);
    if (!proceed) {
      switchAddProductTab('general');
      els('apBarcode').focus();
      return;
    }
  }

  const taxRate = parseFloat(els('apTax').value);
  const basePrice = sellingPrice || (hasVariants && variantList[0] ? Number(variantList[0].price) || 0 : 100);
  const baseMrp = parseFloat(els('apMrp').value) || (hasVariants && variantList[0] ? Number(variantList[0].mrp) || 0 : 0) || basePrice;
  const basePurchase = parseFloat(els('apPurchasePrice').value) || (hasVariants && variantList[0] ? Number(variantList[0].purchasePrice) || 0 : 0);
  const baseTax = Number.isFinite(taxRate) ? taxRate : (hasVariants && variantList[0] && variantList[0].tax != null ? Number(variantList[0].tax) : 18);

  const productData = {
    name,
    description: els('apDesc').value.trim(),
    sku: els('apSku').value.trim() || generateAutoSku(),
    barcode: finalBarcode,
    hsn: els('apHsn').value.trim(),
    category,
    subCategory: els('apSubCategory').value,
    brand: els('apBrand').value,
    unit: els('apPrimaryUnit').value || 'Pcs',
    price: basePrice,
    purchasePrice: basePurchase,
    mrp: baseMrp,
    tax: baseTax,
    taxInclusive: !!(els('apTaxInclusive') && els('apTaxInclusive').checked),
    stock: stockQty,
    minStock: parseInt(els('apMinStock').value) || 5,
    expiryDate: (els('apExpiryDate') && els('apExpiryDate').value) || '',
    warrantyMonths: Math.max(0, parseInt(els('apWarrantyMonths') && els('apWarrantyMonths').value) || 0),
    discountType: els('apDiscountType').value,
    discount: parseFloat(els('apDiscountVal').value) || 0,
    hasVariants,
    attributes: hasVariants ? apAttributes : [],
    variants: hasVariants ? variantList : [],
    images: apUploadedImages.map(x => x.url),
    image: apUploadedImages.length ? apUploadedImages[0].url : null,
    emoji: emojis[category] || '📦',
    status: isDraft ? 'Draft' : (stockQty === 0 ? 'Out of Stock' : stockQty <= 5 ? 'Low Stock' : 'In Stock')
  };

  apVariantRows = hasVariants ? variantList : [];

  if (editingProductId) {
    const idx = products.findIndex(p => p.id === editingProductId);
    if (idx !== -1) {
      const old = products[idx] || {};
      const oldStock = Number(old.stock) || 0;
      const newStock = Number(productData.stock) || 0;
      const diff = newStock - oldStock;
      products[idx] = { ...old, ...productData };
      if (diff !== 0) {
        logStockMovement({
          type: diff > 0 ? 'added' : 'adjusted',
          productId: products[idx].id,
          productName: products[idx].name,
          barcode: products[idx].barcode || '',
          qtyChange: diff,
          qtyAfter: newStock,
          note: diff > 0 ? ('Stock added (' + oldStock + ' → ' + newStock + ')') : ('Stock adjusted (' + oldStock + ' → ' + newStock + ')')
        });
      }
      toast(`Product "${name}" updated successfully!`, 'success');
    }
  } else {
    const newProduct = { id: uid(), ...productData };
    products.unshift(newProduct);
    logStockMovement({
      type: 'created',
      productId: newProduct.id,
      productName: newProduct.name,
      barcode: newProduct.barcode || '',
      qtyChange: Number(newProduct.stock) || 0,
      qtyAfter: Number(newProduct.stock) || 0,
      note: isDraft ? 'Product created as draft' : 'Product added to inventory'
    });
    toast(`Product "${name}" ${isDraft ? 'saved as Draft' : 'added to inventory'}!`, 'success');
  }

  DB.set('products', products);
  if (window.HisaabSaaS && typeof window.HisaabSaaS.syncProducts === 'function') {
    window.HisaabSaaS.syncProducts(products.length);
  }
  renderInventory();
  renderStockTimeline();
  switchToView('inventory');
}

// ─── SALES HISTORY ────────────────────────────────────────────
// A sale counts as "today" if its timestamp matches, falling back to the
// printed date string for older records saved before `ts` existed.
function isTodaySale(s) {
  const ref = new Date();
  if (s.ts) {
    const d = new Date(s.ts);
    if (!isNaN(d.getTime())) return d.toDateString() === ref.toDateString();
  }
  const d = new Date(s.date);
  if (!isNaN(d.getTime())) return d.toDateString() === ref.toDateString();
  const label = ref.toLocaleString('en-IN', { dateStyle: 'medium' });
  return String(s.date || '').startsWith(label);
}

// Mobile date section headers: "TODAY", "YESTERDAY", or a formatted date.
function salesDateSectionKey(s) {
  const ref = new Date();
  const d = s.ts ? new Date(Number(s.ts)) : new Date(s.date || '');
  if (!Number.isFinite(d.getTime())) return null;
  const ds = d.toDateString();
  const today = ref.toDateString();
  if (ds === today) return 'today';
  const yesterday = new Date(ref);
  yesterday.setDate(ref.getDate() - 1);
  if (ds === yesterday.toDateString()) return 'yesterday';
  return ds;
}

function salesDateSectionLabel(key) {
  if (key === 'today') return 'TODAY';
  if (key === 'yesterday') return 'YESTERDAY';
  const d = new Date(key);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  return d.toLocaleDateString('en-IN', opts).toUpperCase();
}

let salesFilters = { q: '', payment: 'all', status: 'all', from: '', to: '' };
let salesSort = 'newest';

function saleMatchesDateRange(s, from, to) {
  if (!from && !to) return true;
  let ts = Number(s && s.ts);
  if (!Number.isFinite(ts) || !ts) {
    // fallback: try parsing display date is unreliable across locales; skip if no ts
    return true;
  }
  if (from) {
    const d = parseDateOnly(from);
    if (d && ts < d.getTime()) return false;
  }
  if (to) {
    const d = parseDateOnly(to);
    if (d && ts >= d.getTime() + 86400000) return false;
  }
  return true;
}

function getFilteredSales(opts) {
  const f = salesFilters || {};
  const ignoreStatus = !!(opts && opts.ignoreStatus);
  const q = (f.q || '').trim().toLowerCase();
  return (sales || []).filter(s => {
    const st = salePaymentStatus(s);
    if (f.payment && f.payment !== 'all' && String(s.payment || '').toLowerCase() !== f.payment) return false;
    if (!ignoreStatus && f.status && f.status !== 'all' && st !== f.status) return false;
    if (!saleMatchesDateRange(s, f.from, f.to)) return false;
    if (q) {
      const hay = [s.invNo, s.customer, s.customerPhone, st, s.payment].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function saleSortTs(s) {
  const n = Number(s && s.ts);
  if (Number.isFinite(n) && n) return n;
  const d = new Date(s && s.date);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function sortSalesList(list) {
  const out = list.slice();
  if (salesSort === 'oldest') out.sort((a, b) => saleSortTs(a) - saleSortTs(b));
  else if (salesSort === 'amount-desc') out.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
  else out.sort((a, b) => saleSortTs(b) - saleSortTs(a));
  return out;
}

function setSalesStatusFilter(status) {
  salesFilters.status = ['Paid', 'Partial', 'Unpaid'].includes(status) ? status : 'all';
  renderSales();
}

function setSalesSort(sort) {
  salesSort = sort || 'newest';
  renderSales();
}

function clearSalesFilters() {
  salesFilters = { q: '', payment: 'all', status: 'all', from: '', to: '' };
  const q = els('salesSearch');
  const payment = els('salesPayment');
  const from = els('salesFrom');
  const to = els('salesTo');
  if (q) q.value = '';
  if (payment) payment.value = 'all';
  if (from) from.value = '';
  if (to) to.value = '';
  renderSales();
}

function renderSales() {
  const all = sales || [];
  const revenue = all.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const outstanding = all.reduce((s, x) => s + Math.max(0, Number(x.balanceDue) || 0), 0);
  const collected = Math.max(0, revenue - outstanding);
  const todaySales = all.filter(isTodaySale);
  const todayTotal = todaySales.reduce((s, x) => s + (Number(x.total) || 0), 0);

  // Status counts honour every other filter, exactly like the Inventory tabs.
  const statusCounts = { all: 0, Paid: 0, Partial: 0, Unpaid: 0 };
  getFilteredSales({ ignoreStatus: true }).forEach(s => {
    statusCounts.all += 1;
    const st = salePaymentStatus(s);
    if (statusCounts[st] != null) statusCounts[st] += 1;
  });

  // KPI context lines describe the whole ledger, not the filtered view.
  const globalPaid = all.filter(s => salePaymentStatus(s) === 'Paid').length;
  const globalDue = all.length - globalPaid;

  const subline = els('salesSubline');
  if (subline) {
    subline.textContent = `${all.length} sale${all.length === 1 ? '' : 's'} · ${fmt(revenue)} revenue`;
  }

  const ico = paths => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const statsEl = els('salesStats');
  if (statsEl) {
    const dueCount = globalDue;
    statsEl.innerHTML = `
      <div class="inv-stat inv-stat--purple">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>')}</span><span class="inv-stat-label">Total sales</span></div>
        <div class="inv-stat-value">${all.length}</div>
        <div class="inv-stat-foot">${globalPaid} paid invoice${globalPaid === 1 ? '' : 's'}</div>
      </div>
      <div class="inv-stat inv-stat--green">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<path d="M12 2v20"/><path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')}</span><span class="inv-stat-label">Revenue</span></div>
        <div class="inv-stat-value">${fmt(revenue)}</div>
        <div class="inv-stat-foot">${fmt(collected)} collected</div>
      </div>
      <div class="inv-stat inv-stat--amber">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>')}</span><span class="inv-stat-label">Today</span></div>
        <div class="inv-stat-value">${todaySales.length}</div>
        <div class="inv-stat-foot">${fmt(todayTotal)} billed today</div>
      </div>
      <div class="inv-stat inv-stat--red">
        <div class="inv-stat-head"><span class="inv-stat-icon">${ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/>')}</span><span class="inv-stat-label">Outstanding</span></div>
        <div class="inv-stat-value${outstanding > 0 ? ' is-danger' : ''}">${fmt(outstanding)}</div>
        <div class="inv-stat-foot">${dueCount ? `${dueCount} invoice${dueCount === 1 ? '' : 's'} with balance` : 'Everything settled'}</div>
      </div>`;
  }

  const countIds = { all: 'salesCountAll', Paid: 'salesCountPaid', Partial: 'salesCountPartial', Unpaid: 'salesCountUnpaid' };
  Object.keys(countIds).forEach(key => {
    const el = els(countIds[key]);
    if (el) el.textContent = statusCounts[key];
  });
  document.querySelectorAll('#salesTabs .inv-tab').forEach(tab => {
    const active = (tab.dataset.salesStatus || 'all') === (salesFilters.status || 'all');
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const sortSelect = els('salesSort');
  if (sortSelect && sortSelect.value !== salesSort) sortSelect.value = salesSort;

  const filtered = sortSalesList(getFilteredSales());
  const active = !!(salesFilters.q || salesFilters.payment !== 'all' || salesFilters.status !== 'all' || salesFilters.from || salesFilters.to);

  const countEl = els('salesResultCount');
  if (countEl) {
    countEl.textContent = filtered.length === all.length
      ? `${all.length} sale${all.length === 1 ? '' : 's'}`
      : `${filtered.length} of ${all.length} sales`;
  }
  const footEl = els('salesFoot');
  if (footEl) {
    footEl.textContent = `Showing ${filtered.length} of ${all.length} sale${all.length === 1 ? '' : 's'}`;
  }

  if (!filtered.length) {
    els('salesBody').innerHTML = all.length
      ? `<tr class="sls-empty-row"><td colspan="6"><div class="sls-empty">
           <div class="sls-empty-icon">${ico('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}</div>
           <div class="sls-empty-title">No sales match your filters</div>
           <p class="sls-empty-text">Try a different search term, payment method or date range.</p>
           ${active ? '<button type="button" class="btn btn-ghost inv-empty-btn" onclick="clearSalesFilters()">Clear filters</button>' : ''}
         </div></td></tr>`
      : `<tr class="sls-empty-row"><td colspan="6"><div class="sls-empty">
           <div class="sls-empty-icon">${ico('<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>')}</div>
           <div class="sls-empty-title">No sales yet</div>
           <p class="sls-empty-text">Completed bills will appear here with their payment status.</p>
           <button type="button" class="btn btn-primary inv-empty-btn" onclick="switchToView('pos')">Start billing</button>
         </div></td></tr>`;
    return;
  }

  const eye = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM11 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a2 2 0 1 0-4 0 2 2 0 0 0 4 0z"/><circle cx="12" cy="12" r="3"/></svg>';
  const trash = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  const menu = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';

  const mobile = window.matchMedia('(max-width: 768px)').matches;

  const renderSaleRow = (s) => {
    const st = salePaymentStatus(s);
    const due = Math.max(0, Number(s.balanceDue) || 0);
    const badge = st === 'Paid' ? 'badge-green' : (st === 'Partial' ? 'badge-amber' : 'badge-red');
    const items = (s.items || []).length;
    return `<tr class="sls-sale-row sls-clickable" role="button" tabindex="0" onclick="viewSale('${s.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();viewSale('${s.id}');}">
    <td class="sls-td-inv">
      <div class="sls-inv-no">${escapeNotifHtml(s.invNo || '—')}</div>
      <div class="sls-inv-items">${items} item${items === 1 ? '' : 's'}</div>
    </td>
    <td class="sls-td-date"><span class="sls-date">${escapeNotifHtml(s.date || '—')}</span></td>
    <td class="sls-td-customer">
      <div class="sls-customer">${escapeNotifHtml(s.customer || 'Walk-in')}</div>
      ${s.customerPhone ? `<div class="sls-phone">${escapeNotifHtml(s.customerPhone)}</div>` : ''}
    </td>
    <td class="sls-td-payment"><span class="badge-pill badge-purple">${escapeNotifHtml(String(s.payment || '—').toUpperCase())}</span></td>
    <td class="sls-td-total">
      <div class="sls-total">${fmt(s.total)}</div>
      ${due > 0 ? `<div class="sls-due">Due ${fmt(due)}</div>` : ''}
    </td>
    <td class="sls-td-status"><span class="badge-pill ${badge}">${st}</span></td>
  </tr>`;
  };

  if (mobile) {
    const rows = [];
    let lastKey = null;
    filtered.forEach(s => {
      const key = salesDateSectionKey(s);
      if (key !== lastKey) {
        lastKey = key;
        rows.push(`<tr class="sls-section-row"><td colspan="6"><div class="sls-section">${escapeNotifHtml(salesDateSectionLabel(key))}</div></td></tr>`);
      }
      rows.push(renderSaleRow(s));
    });
    els('salesBody').innerHTML = rows.join('');
    return;
  }

  els('salesBody').innerHTML = filtered.map(renderSaleRow).join('');
}

function toggleSaleMenu(ev, btn, saleId) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const sale = sales.find(s => s.id === saleId);
  if (!sale) return;
  const wasOpen = !!(window.__saleMenuOpen && window.__saleMenuOpen.id === saleId && document.getElementById('saleActionsMenu'));
  closeSaleMenu();
  if (wasOpen) return;
  const menu = document.createElement('div');
  menu.id = 'saleActionsMenu';
  menu.className = 'sale-actions-menu';
  menu.setAttribute('role', 'menu');
  const viewIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM11 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a2 2 0 1 0-4 0 2 2 0 0 0 4 0z"/><circle cx="12" cy="12" r="3"/></svg>';
  const delIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  menu.innerHTML = `
    <button type="button" class="sale-actions-item" role="menuitem" onclick="viewSale('${saleId}')">${viewIcon}<span>View receipt</span></button>
    <button type="button" class="sale-actions-item sale-actions-danger" role="menuitem" onclick="deleteSale('${saleId}')">${delIcon}<span>Delete sale</span></button>
  `;
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  const menuW = menu.offsetWidth || 160;
  const menuH = menu.offsetHeight || 80;
  const gap = 8;
  let left = rect.right - menuW;
  left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
  let top = rect.bottom + gap;
  if (top + menuH > window.innerHeight - 8) top = Math.max(8, rect.top - menuH - gap);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  requestAnimationFrame(() => menu.classList.add('open'));
  btn.classList.add('is-open');
  window.__saleMenuOpen = { id: saleId, btn };
}

function closeSaleMenu() {
  const menu = document.getElementById('saleActionsMenu');
  if (menu) menu.remove();
  document.querySelectorAll('.sls-menu-btn.is-open').forEach(btn => {
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  });
  window.__saleMenuOpen = null;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#saleActionsMenu') && !e.target.closest('.sls-menu-btn')) closeSaleMenu();
});

function toggleSalesFilters() {
  const bar = document.getElementById('salesFilterBar');
  if (!bar) return;
  const open = bar.classList.toggle('open');
  bar.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setupSalesFilters() {
  const q = els('salesSearch');
  const payment = els('salesPayment');
  const from = els('salesFrom');
  const to = els('salesTo');
  const clear = els('salesClearBtn');
  if (!q && !payment) return;
  const read = () => {
    salesFilters = {
      q: (q && q.value) || '',
      payment: (payment && payment.value) || 'all',
      status: salesFilters.status || 'all',
      from: (from && from.value) || '',
      to: (to && to.value) || ''
    };
    renderSales();
  };
  [payment, from, to].forEach(el => el && el.addEventListener('change', read));
  q && q.addEventListener('input', read);
  clear && clear.addEventListener('click', clearSalesFilters);
}

function viewSale(id) {
  const sale = sales.find(s => s.id === id);
  if (!sale) return;
  renderReceipt(sale, 0);
  window.__lastSale = sale;
  showModal('receiptModal');
}

function deleteSale(id) {
  toast('Sales records cannot be deleted', 'warning');
}

function exportSalesCSV() {
  if (window.HisaabSaaS && typeof window.HisaabSaaS.guard === 'function') {
    if (!window.HisaabSaaS.guard('csv_export', 'CSV export')) return;
  }
  const list = typeof getFilteredSales === 'function' ? getFilteredSales() : sales;
  const rows = [['Invoice', 'Date', 'Customer', 'Phone', 'Items', 'Total', 'Paid', 'Due', 'Advance', 'Payment', 'Status']];
  list.forEach(s => rows.push([
    s.invNo, s.date, s.customer, s.customerPhone || '', s.items.length, s.total,
    Number(s.amountPaid) || 0, Number(s.balanceDue) || 0, Number(s.advanceCredit) || 0,
    s.payment, salePaymentStatus(s)
  ]));
  const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'hisaab_sales.csv'; a.click();
  toast(list.length + ' sales exported', 'success');
}

// ─── CUSTOMERS ────────────────────────────────────────────────
let custActionsState = null;

function renderCustomers() {
  if (!customers.length) {
    els('customersBody').innerHTML = '<tr><td colspan="7" class="table-empty">No customers yet. Capture a phone number at billing or add a customer to get started.</td></tr>';
    return;
  }
  els('customersBody').innerHTML = customers.map(c => `<tr>
    <td class="fw-semi">${escapeNotifHtml(c.name || '')}</td>
    <td>${escapeNotifHtml(c.phone || '')}</td>
    <td>${c.email ? escapeNotifHtml(c.email) : '—'}</td>
    <td><span class="badge-pill badge-purple">${Number(c.points) || 0} pts</span></td>
    <td>${fmt(c.totalPurchases || 0)}</td>
    <td class="${Number(c.due) > 0 ? 'text-red' : (Number(c.due) < 0 ? 'text-purple' : 'text-green')} fw-semi">${customerBalanceCell(c)}</td>
    <td class="inv-actions-cell">
      <button type="button" class="inv-actions-btn" aria-haspopup="menu" aria-expanded="false" title="Actions" aria-label="Actions for ${escapeNotifHtml(c.name || 'customer')}" onclick="toggleCustActions(event, this, '${c.id}')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
      </button>
    </td>
  </tr>`).join('');
}

function loadCustomerInPOS(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  els('customerPhone').value = c.phone;
  renderCustomerCard(c);
  switchToView('pos');
  toast(`${c.name} selected`, 'success');
}

function deleteCustomer(id) {
  if (!confirm('Delete this customer?')) return;
  customers = customers.filter(c => c.id !== id);
  DB.set('customers', customers);
  renderCustomers();
  toast('Customer deleted', 'warning');
}

function closeCustActions() {
  const menu = document.getElementById('custActionsMenu');
  if (menu) menu.remove();
  document.querySelectorAll('#view-customers .inv-actions-btn.is-open, .inv-actions-btn.is-open[data-cust-menu="1"]').forEach(btn => {
    btn.classList.remove('is-open');
    btn.removeAttribute('data-cust-menu');
    btn.setAttribute('aria-expanded', 'false');
  });
  custActionsState = null;
}

function toggleCustActions(ev, btn, customerId) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const wasOpen = !!(custActionsState && custActionsState.customerId === customerId && document.getElementById('custActionsMenu'));
  closeCustActions();
  if (wasOpen) return;

  const c = customers.find(x => x.id === customerId);
  if (!c) return;

  const icon = (paths) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const items = [
    { action: 'view', label: 'View Customer', icon: icon('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>') },
    { action: 'transactions', label: 'View All Transactions', icon: icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>') },
    { action: 'edit', label: 'Edit Customer', icon: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') },
    { action: 'invoice', label: 'Create Invoice', icon: icon('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>') },
    { action: 'credit', label: 'Credit Notes', icon: icon('<path d="M3 7h18"/><path d="M7 3v4M17 3v4"/><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 13h8M8 17h5"/>') },
    { action: 'settle', label: 'Settle Outstanding', icon: icon('<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>') }
  ];

  const menu = document.createElement('div');
  menu.id = 'custActionsMenu';
  menu.className = 'inv-actions-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map(item => (
    `<button type="button" class="inv-actions-item" role="menuitem" onclick="custMenuAction('${item.action}')">${item.icon}<span>${item.label}</span></button>`
  )).join('');
  document.body.appendChild(menu);

  const rect = (btn || ev.target).getBoundingClientRect();
  const menuW = menu.offsetWidth || 220;
  const menuH = menu.offsetHeight || 220;
  const gap = 6;
  let left = rect.right - menuW;
  left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
  let top = rect.bottom + gap;
  if (top + menuH > window.innerHeight - 8) top = Math.max(8, rect.top - menuH - gap);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  requestAnimationFrame(() => menu.classList.add('open'));

  if (btn) {
    btn.classList.add('is-open');
    btn.setAttribute('data-cust-menu', '1');
    btn.setAttribute('aria-expanded', 'true');
  }
  custActionsState = { customerId };
}

function custMenuAction(action) {
  const state = custActionsState;
  if (!state) return;
  const id = state.customerId;
  closeCustActions();
  if (action === 'view') viewCustomer(id);
  else if (action === 'transactions') openCustomerTransactionsModal(id);
  else if (action === 'edit') editCustomer(id);
  else if (action === 'invoice') createInvoiceForCustomer(id);
  else if (action === 'credit') openCustomerCreditNotes(id);
  else if (action === 'settle') openSettleOutstanding(id);
}

document.addEventListener('click', (e) => {
  if (!document.getElementById('custActionsMenu')) return;
  const t = e.target;
  if (t && t.closest && (t.closest('#custActionsMenu') || t.closest('[data-cust-menu="1"]'))) return;
  closeCustActions();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCustActions(); });
window.addEventListener('resize', closeCustActions);
window.addEventListener('scroll', closeCustActions, true);

function createInvoiceForCustomer(id) {
  loadCustomerInPOS(id);
}

function openCustomerCreditNotes(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  selectedCustomer = c;
  if (els('customerPhone')) els('customerPhone').value = c.phone || '';
  switchToView('returns');
  if (typeof populateProductSelects === 'function') populateProductSelects();
  if (typeof renderReturns === 'function') renderReturns();
  toast(`Returns / credit notes: ${c.name}. Use "Process Return" to record a credit note.`, 'info');
}

function getCustomerTransactionHistory(customerId) {
  const c = customers.find(x => x.id === customerId);
  if (!c) return [];
  const items = [];
  (sales || []).forEach(s => {
    if (s.customerId === customerId) {
      items.push({
        date: s.date || s.createdAt || '',
        ts: Date.parse(s.createdAt || s.date || 0) || 0,
        type: 'Sale',
        ref: s.invNo || '',
        detail: `${(s.items || []).length} item(s) · ${s.payment || ''} · ${salePaymentStatus ? salePaymentStatus(s) : ''}`,
        amount: Number(s.total) || 0,
        balanceImpact: (Number(s.balanceDue) || 0) - (Number(s.advanceCredit) || 0) + (Number(s.advanceUsed) || 0)
      });
    }
  });
  (returns || []).forEach(r => {
    if (r.customer === c.name) {
      items.push({
        date: r.date || '',
        ts: Date.parse(r.date || 0) || 0,
        type: 'Return / Credit Note',
        ref: r.returnNo || r.invoice || '',
        detail: `${r.product || ''} x${r.qty || 0}`,
        amount: -(Number(r.refund) || 0),
        balanceImpact: null
      });
    }
  });
  (customerSettlements || []).forEach(p => {
    if (p.customerId === customerId) {
      items.push({
        date: p.date || '',
        ts: Date.parse(p.createdAt || p.date || 0) || 0,
        type: p.type === 'refund_advance' ? 'Advance Refund' : 'Payment Received',
        ref: p.refNo || '',
        detail: `${p.paymentMode || ''}${p.note ? ' · ' + p.note : ''}`,
        amount: p.type === 'refund_advance' ? -(Number(p.amount) || 0) : (Number(p.amount) || 0),
        balanceImpact: (Number(p.balanceAfter) || 0) - (Number(p.balanceBefore) || 0)
      });
    }
  });
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return items.slice(0, 20);
}

function viewCustomer(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  const due = Number(c.due) || 0;
  const isAdvance = due < -PAY_EPS;
  const isDue = due > PAY_EPS;
  const history = getCustomerTransactionHistory(id);
  const rows = history.length ? history.map(h => `
    <tr>
      <td>${escapeNotifHtml(String(h.date || '—'))}</td>
      <td>${escapeNotifHtml(h.type)}</td>
      <td>${escapeNotifHtml(h.ref || '—')}</td>
      <td>${escapeNotifHtml(h.detail || '')}</td>
      <td class="fw-semi">${h.amount < 0 ? '-' : ''}${fmt(Math.abs(h.amount || 0))}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="table-empty">No transactions found for this customer yet.</td></tr>';

  try { if (typeof ensureCustomerLoyaltyFields === 'function') ensureCustomerLoyaltyFields(c); } catch(e){}
  const loySummary = (typeof getCustomerLoyaltySummary === 'function') ? getCustomerLoyaltySummary(c) : { earnedTotal: 0, available: Number(c.points)||0, redeemedTotal: 0, expiredTotal: 0 };
  let rewardSummary = { rewards: [], availableCount: 0, referralCode: '', successfulReferrals: 0, referralRewardTotal: 0, pointsValue: 0 };
  try { if (typeof getCustomerRewardSummary === 'function') rewardSummary = getCustomerRewardSummary(c); } catch (e) {}
  const loyTxns = (typeof loyaltyCustomerTxns === 'function') ? loyaltyCustomerTxns(c.id).slice(0, 20) : [];
  const loyRows = loyTxns.length ? loyTxns.map(t => `
    <tr>
      <td>${escapeNotifHtml(String(t.date || '—'))}</td>
      <td>${escapeNotifHtml(typeof loyaltyTxnTypeLabel === 'function' ? loyaltyTxnTypeLabel(t.type) : String(t.type || ''))}</td>
      <td>${escapeNotifHtml(String(t.rewardName || t.invNo || t.invoiceId || t.saleId || '—'))}</td>
      <td>${Number(t.points)||0}</td>
      <td>${Number(t.monetaryValue) ? fmt(t.monetaryValue) : '—'}</td>
      <td>${escapeNotifHtml(String(t.description || ''))}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="table-empty">No loyalty transactions yet.</td></tr>';
  const availableRewardRows = rewardSummary.rewards.length
    ? rewardSummary.rewards.map(r => `<div class="rw-reward-detail-row"><span>${escapeNotifHtml(r.productName)} × ${r.quantity}</span><span>${r.points} pts ${r.eligible ? '<span class="badge-pill badge-green">Eligible</span>' : '<span class="badge-pill badge-gray">Locked</span>'}</span></div>`).join('')
    : '<div class="rw-muted">No free-product rewards configured.</div>';

  const html = `
    <div class="modal modal-md" role="dialog" aria-modal="true" aria-labelledby="custDetailTitle" style="max-width:860px;width:96vw;">
      <div class="modal-header">
        <h3 id="custDetailTitle">Customer Details</h3>
        <button type="button" class="modal-close" onclick="closeCustomerDetailModal()" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
          <div><div class="text-muted" style="font-size:12px;">Name</div><div class="fw-semi">${escapeNotifHtml(c.name || '')}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Phone</div><div>${escapeNotifHtml(c.phone || '—')}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Email</div><div>${escapeNotifHtml(c.email || '—')}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Points (Available)</div><div>${Number(loySummary.available) || 0} pts</div></div>
          <div><div class="text-muted" style="font-size:12px;">Total Purchases</div><div>${fmt(c.totalPurchases || 0)}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Balance</div><div class="${isDue ? 'text-red' : (isAdvance ? 'text-purple' : 'text-green')} fw-semi">${isDue ? 'Due ' + fmt(due) : (isAdvance ? 'Advance ' + fmt(Math.abs(due)) : 'No Due / No Advance')}</div></div>
        </div>

        <div style="margin:0 0 16px;padding:12px;border:1px solid var(--border,#e5e7eb);border-radius:10px;background:var(--surface-alt,#f8fafc);">
          <div class="fw-semi" style="margin-bottom:8px;">Loyalty / Rewards</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px;">
            <div><div class="text-muted" style="font-size:12px;">Total Earned</div><div>${Number(loySummary.earnedTotal)||0} pts</div></div>
            <div><div class="text-muted" style="font-size:12px;">Available</div><div>${Number(loySummary.available)||0} pts</div></div>
            <div><div class="text-muted" style="font-size:12px;">Redeemed</div><div>${Number(loySummary.redeemedTotal)||0} pts</div></div>
            <div><div class="text-muted" style="font-size:12px;">Expired</div><div>${Number(loySummary.expiredTotal)||0} pts</div></div>
            <div><div class="text-muted" style="font-size:12px;">Points Value</div><div>${fmt(rewardSummary.pointsValue)}</div></div>
            <div><div class="text-muted" style="font-size:12px;">Referral Rewards</div><div>${fmt(rewardSummary.referralRewardTotal)}</div></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:10px;">
            <div><div class="text-muted" style="font-size:12px;">Referral Code</div><div class="rw-referral-code">${escapeNotifHtml(rewardSummary.referralCode || '—')}</div></div>
            <div><div class="text-muted" style="font-size:12px;">Successful Referrals</div><div>${Number(rewardSummary.successfulReferrals)||0}</div></div>
            <div><div class="text-muted" style="font-size:12px;">Rewards Available</div><div>${Number(rewardSummary.availableCount)||0} of ${rewardSummary.rewards.length}</div></div>
          </div>
          <div style="margin-bottom:10px;">
            <div class="text-muted" style="font-size:12px;margin-bottom:4px;">Free Product Rewards</div>
            ${availableRewardRows}
          </div>
          <div class="table-wrapper" style="max-height:220px;overflow:auto;">
            <table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Reward / Invoice</th><th>Points</th><th>Value</th><th>Reason</th></tr></thead><tbody>${loyRows}</tbody></table>
          </div>
        </div>

        <div style="margin-bottom:8px;" class="fw-semi">Recent Transactions</div>
        <div class="table-wrapper" style="max-height:260px;overflow:auto;">
          <table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Details</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" class="btn btn-ghost" onclick="closeCustomerDetailModal()">Close</button>
        <button type="button" class="btn btn-ghost" onclick="closeCustomerDetailModal(); openCustomerTransactionsModal('${c.id}')">View All Transactions</button>
        <button type="button" class="btn btn-ghost" onclick="closeCustomerDetailModal(); editCustomer('${c.id}')">Edit</button>
        <button type="button" class="btn btn-ghost" onclick="closeCustomerDetailModal(); openCustomerCreditNotes('${c.id}')">Credit Notes</button>
        <button type="button" class="btn btn-ghost" onclick="closeCustomerDetailModal(); openSettleOutstanding('${c.id}')">Settle Outstanding</button>
        <button type="button" class="btn btn-primary" onclick="closeCustomerDetailModal(); createInvoiceForCustomer('${c.id}')">Create Invoice</button>
      </div>
    </div>`;

  let overlay = document.getElementById('customerDetailModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'customerDetailModal';
    overlay.className = 'modal-overlay hidden';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCustomerDetailModal(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = html;
  overlay.classList.remove('hidden');
}

function closeCustomerDetailModal() {
  const overlay = document.getElementById('customerDetailModal');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
}

// ==================== CUSTOMER: VIEW ALL TRANSACTIONS ====================
const custTxnState = {
  customerId: null,
  search: '',
  type: 'all',
  dateFrom: '',
  dateTo: '',
  page: 1,
  pageSize: 20,
  all: [],
  filtered: []
};

function custTxnParseDate(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  const t = Date.parse(String(value));
  return isNaN(t) ? NaN : t;
}

function custTxnDateKey(ts) {
  if (!isFinite(ts)) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function custTxnProductsText(items) {
  if (!Array.isArray(items) || !items.length) return '-';
  return items.map(i => `${i && (i.name || 'Item')} x ${Number(i && i.qty) || 0}`).join(', ');
}

function custTxnProductsSummary(items) {
  if (!Array.isArray(items) || !items.length) return '-';
  const totalItems = items.reduce((s, i) => s + (Number(i && i.qty) || 0), 0);
  const names = items.map(i => `${i && (i.name || 'Item')} x ${Number(i && i.qty) || 0}`);
  const full = names.join(', ');
  const count = items.length;
  if (count <= 2 && full.length <= 60) return full;
  const preview = names.slice(0, 2).join(', ');
  const more = count - 2;
  const summary = more > 0
    ? `${count} items (${totalItems} qty): ${preview} +${more} more`
    : `${count} items (${totalItems} qty): ${preview}`;
  return summary;
}

function buildCustomerAllTransactions(customerId) {
  const c = (customers || []).find(x => x.id === customerId);
  if (!c) return [];
  const items = [];
  const custNameNorm = String(c.name || '').trim().toLowerCase();

  (sales || []).forEach(s => {
    if (!s || s.customerId !== customerId) return;
    const ts = custTxnParseDate(s.createdAt || s.ts || s.date);
    const total = Number(s.total) || 0;
    const due = Math.max(0, Number(s.balanceDue) || 0);
    const adv = Math.max(0, Number(s.advanceCredit) || 0);
    const productsFull = custTxnProductsText(s.items);
    const productsSummary = custTxnProductsSummary(s.items);
    items.push({
      kind: 'sale',
      id: s.id || '',
      invoiceNo: s.invNo || '-',
      ts: isFinite(ts) ? ts : 0,
      date: s.date || (isFinite(ts) ? new Date(ts).toLocaleString('en-IN') : '-'),
      type: 'Sale',
      products: productsSummary,
      productsFull: productsFull,
      total: total,
      paymentMethod: s.payment || '-',
      paymentStatus: typeof salePaymentStatus === 'function' ? salePaymentStatus(s) : (s.paymentStatus || '-'),
      outstanding: due > PAY_EPS ? fmt(due) + ' Due' : (adv > PAY_EPS ? fmt(adv) + ' Advance' : 'No Due'),
      outstandingValue: due,
      canViewInvoice: !!s.id,
      raw: s
    });
  });

  (returns || []).forEach(r => {
    if (!r) return;
    const byId = r.customerId && r.customerId === customerId;
    const byName = !r.customerId && custNameNorm && String(r.customer || '').trim().toLowerCase() === custNameNorm;
    if (!byId && !byName) return;
    const ts = custTxnParseDate(r.createdAt || r.ts || r.date);
    const refund = Math.max(0, Number(r.refund) || 0);
    const qty = Number(r.qty) || 0;
    const prod = r.product ? `${r.product}${qty ? ' x ' + qty : ''}` : '-';
    items.push({
      kind: 'return',
      id: r.id || r.returnNo || '',
      invoiceNo: r.returnNo || r.invoice || '-',
      ts: isFinite(ts) ? ts : 0,
      date: r.date || (isFinite(ts) ? new Date(ts).toLocaleString('en-IN') : '-'),
      type: 'Return / Credit Note',
      products: prod,
      productsFull: prod,
      total: -refund,
      paymentMethod: r.refundMethod || r.paymentMethod || 'Refund',
      paymentStatus: r.status || 'Processed',
      outstanding: '-',
      outstandingValue: 0,
      canViewInvoice: false,
      raw: r
    });
  });

  (customerSettlements || []).forEach(p => {
    if (!p || p.customerId !== customerId) return;
    const ts = custTxnParseDate(p.createdAt || p.ts || p.date);
    const amount = Math.max(0, Number(p.amount) || 0);
    const isRefund = p.type === 'refund_advance';
    const balAfter = Number(p.balanceAfter);
    let balText = '-';
    if (isFinite(balAfter)) {
      if (Math.abs(balAfter) <= (typeof PAY_EPS !== 'undefined' ? PAY_EPS : 0.01)) balText = 'Settled';
      else if (balAfter > 0) balText = fmt(balAfter) + ' Due';
      else balText = fmt(Math.abs(balAfter)) + ' Advance';
    }
    const prod = p.note ? String(p.note) : '-';
    items.push({
      kind: 'settlement',
      id: p.id || p.refNo || '',
      invoiceNo: p.refNo || '-',
      ts: isFinite(ts) ? ts : 0,
      date: p.date || (isFinite(ts) ? new Date(ts).toLocaleString('en-IN') : '-'),
      type: isRefund ? 'Advance Refund' : 'Payment Received',
      products: prod,
      productsFull: prod,
      total: isRefund ? -amount : amount,
      paymentMethod: p.paymentMode || '-',
      paymentStatus: 'Completed',
      outstanding: balText,
      outstandingValue: isFinite(balAfter) && balAfter > 0 ? balAfter : 0,
      canViewInvoice: false,
      raw: p
    });
  });

  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return items;
}

function custTxnApplyFilters() {
  const q = String(custTxnState.search || '').trim().toLowerCase();
  const type = custTxnState.type || 'all';
  const from = custTxnState.dateFrom ? Date.parse(custTxnState.dateFrom + 'T00:00:00') : NaN;
  const to = custTxnState.dateTo ? Date.parse(custTxnState.dateTo + 'T23:59:59.999') : NaN;
  custTxnState.filtered = (custTxnState.all || []).filter(t => {
    if (type !== 'all' && t.type !== type) return false;
    if (isFinite(from) && (t.ts || 0) < from) return false;
    if (isFinite(to) && (t.ts || 0) > to) return false;
    if (q) {
      const hay = [t.invoiceNo, t.type, t.products, t.paymentMethod, t.paymentStatus, t.outstanding, t.date, (t.total != null ? String(t.total) : '')].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(custTxnState.filtered.length / custTxnState.pageSize));
  if (custTxnState.page > totalPages) custTxnState.page = totalPages;
  if (custTxnState.page < 1) custTxnState.page = 1;
}

function custTxnPageItems() {
  const start = (custTxnState.page - 1) * custTxnState.pageSize;
  return custTxnState.filtered.slice(start, start + custTxnState.pageSize);
}

function custTxnTypeOptions(selected) {
  const types = ['all', 'Sale', 'Return / Credit Note', 'Payment Received', 'Advance Refund'];
  return types.map(t => `<option value="${escapeNotifHtml(t)}"${t === selected ? ' selected' : ''}>${t === 'all' ? 'All Types' : escapeNotifHtml(t)}</option>`).join('');
}

function renderCustomerTransactionsModalBody() {
  custTxnApplyFilters();
  const c = (customers || []).find(x => x.id === custTxnState.customerId);
  const pageItems = custTxnPageItems();
  const total = custTxnState.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / custTxnState.pageSize));
  const page = custTxnState.page;

  const rows = pageItems.length ? pageItems.map(t => {
    const amt = Number(t.total) || 0;
    const amtHtml = amt < 0 ? `<span class="text-red fw-semi">-${fmt(Math.abs(amt))}</span>` : `<span class="fw-semi">${fmt(amt)}</span>`;
    const status = String(t.paymentStatus || '-');
    const statusClass = status === 'Paid' || status === 'Completed' || status === 'Processed' || status === 'Received' ? 'badge-green'
      : (status === 'Partial' ? 'badge-amber' : (status === 'Unpaid' ? 'badge-red' : 'badge-gray'));
    const invSafe = escapeNotifHtml(String(t.invoiceNo || '-'));
    const invCell = t.canViewInvoice
      ? `<button type="button" title="Open invoice/bill" onclick="custTxnViewInvoice('${escapeNotifHtml(String(t.id))}')" style="background:none;border:none;padding:0;margin:0;font:inherit;font-weight:600;color:var(--primary,#2563eb);cursor:pointer;text-decoration:underline;text-underline-offset:2px;">${invSafe}</button>`
      : `<span class="fw-semi">${invSafe}</span>`;
    const productsDisplay = escapeNotifHtml(String(t.products || '-'));
    const productsFull = escapeNotifHtml(String(t.productsFull || t.products || '-'));
    const viewInvBtn = t.canViewInvoice
      ? `<button type="button" class="btn btn-ghost btn-xs" onclick="custTxnViewInvoice('${escapeNotifHtml(String(t.id))}')">View/Print</button>`
      : `<span class="text-muted">-</span>`;
    return `<tr>
      <td>${invCell}</td>
      <td>${escapeNotifHtml(String(t.date || '-'))}</td>
      <td>${escapeNotifHtml(String(t.type || '-'))}</td>
      <td title="${productsFull}" style="max-width:240px;"><div style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${productsDisplay}</div></td>
      <td>${amtHtml}</td>
      <td>${escapeNotifHtml(String(t.paymentMethod || '-'))}</td>
      <td><span class="badge-pill ${statusClass}">${escapeNotifHtml(status)}</span></td>
      <td>${escapeNotifHtml(String(t.outstanding || '-'))}</td>
      <td style="white-space:nowrap;">
        <button type="button" class="btn btn-ghost btn-xs" onclick="custTxnOpenDetail('${escapeNotifHtml(String(t.id))}','${escapeNotifHtml(String(t.kind))}','${escapeNotifHtml(String(t.invoiceNo||''))}','${t.ts||0}')">Details</button>
        ${viewInvBtn}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="table-empty">No transactions found for this customer.</td></tr>';

  const name = c ? (c.name || 'Customer') : 'Customer';
  const phone = c ? (c.phone || '') : '';
  const from = (page - 1) * custTxnState.pageSize + (total ? 1 : 0);
  const to = Math.min(page * custTxnState.pageSize, total);

  return `
    <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="custTxnTitle" style="max-width:1100px;width:97vw;">
      <div class="modal-header">
        <div>
          <h3 id="custTxnTitle" style="margin:0;">All Transactions</h3>
          <div class="text-muted" style="font-size:12px;margin-top:2px;">${escapeNotifHtml(name)}${phone ? ' · ' + escapeNotifHtml(phone) : ''}</div>
        </div>
        <button type="button" class="modal-close" onclick="closeCustomerTransactionsModal()" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:minmax(180px,1.4fr) repeat(3,minmax(140px,1fr));gap:8px;margin-bottom:12px;align-items:end;">
          <div>
            <label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px;">Search</label>
            <input type="text" class="qac-input" placeholder="Invoice, product, payment, status..." value="${escapeNotifHtml(custTxnState.search)}" oninput="custTxnSetFilter('search', this.value)" />
          </div>
          <div>
            <label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px;">Type</label>
            <select class="qac-input" onchange="custTxnSetFilter('type', this.value)">${custTxnTypeOptions(custTxnState.type)}</select>
          </div>
          <div>
            <label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px;">From Date</label>
            <input type="date" class="qac-input" value="${escapeNotifHtml(custTxnState.dateFrom)}" onchange="custTxnSetFilter('dateFrom', this.value)" />
          </div>
          <div>
            <label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px;">To Date</label>
            <input type="date" class="qac-input" value="${escapeNotifHtml(custTxnState.dateTo)}" onchange="custTxnSetFilter('dateTo', this.value)" />
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <div class="text-muted" style="font-size:12px;">Showing ${from}-${to} of ${total} transaction${total === 1 ? '' : 's'}</div>
          <button type="button" class="btn btn-ghost btn-sm" onclick="custTxnResetFilters()">Reset Filters</button>
        </div>
        <div class="table-wrapper" style="max-height:55vh;overflow:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice/Bill No</th>
                <th>Date</th>
                <th>Type</th>
                <th>Products Purchased</th>
                <th>Total Amount</th>
                <th>Payment Method</th>
                <th>Payment Status</th>
                <th>Outstanding/Due</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost btn-sm" onclick="custTxnGoPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>Prev</button>
          <span class="text-muted" style="font-size:12px;">Page ${page} of ${totalPages}</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="custTxnGoPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Next</button>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-ghost" onclick="closeCustomerTransactionsModal()">Close</button>
      </div>
    </div>`;
}

function openCustomerTransactionsModal(customerId) {
  const c = (customers || []).find(x => x.id === customerId);
  if (!c) { toast('Customer not found', 'error'); return; }
  custTxnState.customerId = customerId;
  custTxnState.search = '';
  custTxnState.type = 'all';
  custTxnState.dateFrom = '';
  custTxnState.dateTo = '';
  custTxnState.page = 1;
  custTxnState.all = buildCustomerAllTransactions(customerId);

  let overlay = document.getElementById('customerTransactionsModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'customerTransactionsModal';
    overlay.className = 'modal-overlay hidden';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCustomerTransactionsModal(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = renderCustomerTransactionsModalBody();
  overlay.classList.remove('hidden');
}

function refreshCustomerTransactionsModal() {
  const overlay = document.getElementById('customerTransactionsModal');
  if (!overlay || overlay.classList.contains('hidden') || !custTxnState.customerId) return;
  custTxnState.all = buildCustomerAllTransactions(custTxnState.customerId);
  overlay.innerHTML = renderCustomerTransactionsModalBody();
}

function closeCustomerTransactionsModal() {
  const overlay = document.getElementById('customerTransactionsModal');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
  custTxnState.customerId = null;
  custTxnState.all = [];
  custTxnState.filtered = [];
  closeCustomerTransactionDetailModal();
}

function custTxnSetFilter(key, value) {
  custTxnState[key] = value == null ? '' : value;
  custTxnState.page = 1;
  refreshCustomerTransactionsModal();
}

function custTxnResetFilters() {
  custTxnState.search = '';
  custTxnState.type = 'all';
  custTxnState.dateFrom = '';
  custTxnState.dateTo = '';
  custTxnState.page = 1;
  refreshCustomerTransactionsModal();
}

function custTxnGoPage(p) {
  const n = Number(p) || 1;
  custTxnState.page = n;
  refreshCustomerTransactionsModal();
}

function custTxnFind(id, kind, invoiceNo, ts) {
  const list = custTxnState.all && custTxnState.all.length ? custTxnState.all : buildCustomerAllTransactions(custTxnState.customerId);
  return list.find(t => String(t.id) === String(id) && String(t.kind) === String(kind) && String(t.invoiceNo || '') === String(invoiceNo || '') && Number(t.ts||0) === Number(ts||0))
    || list.find(t => String(t.id) === String(id) && String(t.kind) === String(kind))
    || null;
}

function custTxnOpenDetail(id, kind, invoiceNo, ts) {
  const t = custTxnFind(id, kind, invoiceNo, ts);
  if (!t) { toast('Transaction not found', 'error'); return; }
  const amt = Number(t.total) || 0;
  const amtHtml = amt < 0 ? '-' + fmt(Math.abs(amt)) : fmt(amt);
  let extra = '';
  if (t.kind === 'sale' && t.raw) {
    const s = t.raw;
    const itemsHtml = Array.isArray(s.items) && s.items.length
      ? `<div class="table-wrapper" style="max-height:220px;overflow:auto;margin-top:8px;"><table class="data-table"><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Tax</th><th>Total</th></tr></thead><tbody>${s.items.map(i => `<tr><td>${escapeNotifHtml(String(i.name||'Item'))}</td><td>${Number(i.qty)||0}</td><td>${fmt(Number(i.price)||0)}</td><td>${fmt(Number(i.taxAmount)||0)}</td><td>${fmt(Number(i.lineTotal)||0)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="text-muted" style="margin-top:8px;">No item details available.</div>';
    extra = `
      <div style="margin-top:12px;"><div class="fw-semi" style="margin-bottom:4px;">Items</div>${itemsHtml}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:12px;">
        <div><div class="text-muted" style="font-size:12px;">Subtotal</div><div>${fmt(Number(s.subtotal)||0)}</div></div>
        <div><div class="text-muted" style="font-size:12px;">Tax</div><div>${fmt(Number(s.tax)||0)}</div></div>
        <div><div class="text-muted" style="font-size:12px;">Amount Paid</div><div>${fmt(Number(s.amountPaid)||0)}</div></div>
        <div><div class="text-muted" style="font-size:12px;">Balance Due</div><div>${fmt(Number(s.balanceDue)||0)}</div></div>
        <div><div class="text-muted" style="font-size:12px;">Advance Credit</div><div>${fmt(Number(s.advanceCredit)||0)}</div></div>
      </div>`;
  } else if (t.kind === 'return' && t.raw) {
    const r = t.raw;
    extra = `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
      <div><div class="text-muted" style="font-size:12px;">Linked Invoice</div><div>${escapeNotifHtml(String(r.invoice||'-'))}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Reason</div><div>${escapeNotifHtml(String(r.reason||'-'))}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Refund</div><div>${fmt(Number(r.refund)||0)}</div></div>
    </div>`;
  } else if (t.kind === 'settlement' && t.raw) {
    const p = t.raw;
    extra = `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
      <div><div class="text-muted" style="font-size:12px;">Balance Before</div><div>${fmt(Number(p.balanceBefore)||0)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Balance After</div><div>${fmt(Number(p.balanceAfter)||0)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Note</div><div>${escapeNotifHtml(String(p.note||'-'))}</div></div>
    </div>`;
  }
  const canInv = t.canViewInvoice ? `<button type="button" class="btn btn-primary" onclick="closeCustomerTransactionDetailModal(); custTxnViewInvoice('${escapeNotifHtml(String(t.id))}')">View/Print Invoice</button>` : '';
  const html = `
    <div class="modal modal-md" role="dialog" aria-modal="true" aria-labelledby="custTxnDetailTitle" style="max-width:760px;width:96vw;">
      <div class="modal-header">
        <h3 id="custTxnDetailTitle">Transaction Details</h3>
        <button type="button" class="modal-close" onclick="closeCustomerTransactionDetailModal()" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
          <div><div class="text-muted" style="font-size:12px;">Invoice/Bill No</div><div class="fw-semi">${t.canViewInvoice ? `<button type="button" onclick="closeCustomerTransactionDetailModal(); custTxnViewInvoice('${escapeNotifHtml(String(t.id))}')" style="background:none;border:none;padding:0;margin:0;font:inherit;font-weight:600;color:var(--primary,#2563eb);cursor:pointer;text-decoration:underline;text-underline-offset:2px;">${escapeNotifHtml(String(t.invoiceNo||'-'))}</button>` : escapeNotifHtml(String(t.invoiceNo||'-'))}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Date</div><div>${escapeNotifHtml(String(t.date||'-'))}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Type</div><div>${escapeNotifHtml(String(t.type||'-'))}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Total Amount</div><div class="fw-semi">${amtHtml}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Payment Method</div><div>${escapeNotifHtml(String(t.paymentMethod||'-'))}</div></div>
          <div><div class="text-muted" style="font-size:12px;">Payment Status</div><div>${escapeNotifHtml(String(t.paymentStatus||'-'))}</div></div>
          <div style="grid-column:1/-1;"><div class="text-muted" style="font-size:12px;">Products Purchased</div><div style="white-space:normal;line-height:1.45;">${escapeNotifHtml(String(t.productsFull||t.products||'-'))}</div></div>
          <div style="grid-column:1/-1;"><div class="text-muted" style="font-size:12px;">Outstanding/Due Amount</div><div>${escapeNotifHtml(String(t.outstanding||'-'))}</div></div>
        </div>
        ${extra}
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
        ${canInv}
        <button type="button" class="btn btn-ghost" onclick="closeCustomerTransactionDetailModal()">Close</button>
      </div>
    </div>`;
  let overlay = document.getElementById('customerTransactionDetailModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'customerTransactionDetailModal';
    overlay.className = 'modal-overlay hidden';
    overlay.style.zIndex = '11020';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCustomerTransactionDetailModal(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = html;
  overlay.classList.remove('hidden');
}

function closeCustomerTransactionDetailModal() {
  const overlay = document.getElementById('customerTransactionDetailModal');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
}

function custTxnViewInvoice(saleId) {
  if (!saleId) return;
  const sale = (sales || []).find(s => s && s.id === saleId);
  if (!sale) { toast('Invoice not found', 'error'); return; }
  if (typeof viewSale === 'function') {
    viewSale(saleId);
  } else if (typeof renderReceipt === 'function' && typeof showModal === 'function') {
    renderReceipt(sale, 0);
    window.__lastSale = sale;
    showModal('receiptModal');
  } else {
    toast('Invoice view is not available', 'error');
  }
}

let settleCustomerId = null;

function openSettleOutstanding(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  settleCustomerId = id;
  const due = Number(c.due) || 0;
  const isAdvance = due < -PAY_EPS;
  const abs = Math.abs(due);
  let overlay = document.getElementById('settleOutstandingModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'settleOutstandingModal';
    overlay.className = 'modal-overlay hidden';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettleOutstanding(); });
    document.body.appendChild(overlay);
  }
  const statusHtml = isAdvance
    ? `<div class="badge-pill badge-purple" style="display:inline-block;margin-bottom:8px;">Advance balance: ${fmt(abs)}</div><p class="text-muted" style="margin:0 0 12px;">This customer has advance credit with you. Record a refund or adjustment to reduce the advance.</p>`
    : (due > PAY_EPS
      ? `<div class="badge-pill badge-amber" style="display:inline-block;margin-bottom:8px;">Due balance: ${fmt(abs)}</div><p class="text-muted" style="margin:0 0 12px;">Receive payment from the customer to reduce the outstanding due.</p>`
      : `<div class="badge-pill badge-green" style="display:inline-block;margin-bottom:8px;">No outstanding balance</div><p class="text-muted" style="margin:0 0 12px;">This customer has no due or advance to settle.</p>`);

  overlay.innerHTML = `
    <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="settleTitle">
      <div class="modal-header">
        <h3 id="settleTitle">Settle Outstanding</h3>
        <button type="button" class="modal-close" onclick="closeSettleOutstanding()" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:12px;"><div class="fw-semi">${escapeNotifHtml(c.name || '')}</div><div class="text-muted" style="font-size:12px;">${escapeNotifHtml(c.phone || '')}</div></div>
        ${statusHtml}
        <div class="form-grid" style="display:grid;gap:12px;">
          <div class="form-group">
            <label for="settleAmount">Settlement amount</label>
            <input type="number" id="settleAmount" class="qac-input" min="0" step="0.01" value="${abs > 0 ? abs.toFixed(2) : ''}" ${abs <= 0 ? 'disabled' : ''} placeholder="0.00" />
          </div>
          <div class="form-group">
            <label for="settleMode">Payment mode</label>
            <select id="settleMode" class="qac-input" ${abs <= 0 ? 'disabled' : ''}>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Bank">Bank</option>
              <option value="Card">Card</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label for="settleNote">Note (optional)</label>
            <input type="text" id="settleNote" class="qac-input" maxlength="120" placeholder="e.g. Cash received / Advance refunded" ${abs <= 0 ? 'disabled' : ''} />
          </div>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" onclick="closeSettleOutstanding()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="confirmSettleOutstanding()" ${abs <= 0 ? 'disabled' : ''}>Continue</button>
      </div>
    </div>`;
  overlay.classList.remove('hidden');
  setTimeout(() => { const inp = document.getElementById('settleAmount'); if (inp && !inp.disabled) { inp.focus(); inp.select(); } }, 30);
}

function closeSettleOutstanding() {
  const overlay = document.getElementById('settleOutstandingModal');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
  settleCustomerId = null;
}

function confirmSettleOutstanding() {
  const c = customers.find(x => x.id === settleCustomerId);
  if (!c) { toast('Customer not found', 'error'); return; }
  const due = Number(c.due) || 0;
  const abs = Math.abs(due);
  if (abs <= PAY_EPS) { toast('No outstanding balance to settle', 'info'); return; }
  const amt = r2(parseFloat((document.getElementById('settleAmount') || {}).value) || 0);
  const mode = ((document.getElementById('settleMode') || {}).value || 'Cash').trim();
  const note = ((document.getElementById('settleNote') || {}).value || '').trim();
  if (!(amt > 0)) { toast('Enter a valid settlement amount', 'error'); return; }
  if (amt - abs > PAY_EPS) { toast('Amount cannot exceed the current outstanding balance', 'error'); return; }

  const isAdvance = due < -PAY_EPS;
  const actionLabel = isAdvance ? 'Refund / adjust advance' : 'Receive payment';
  const impactLabel = isAdvance ? `Advance will reduce by ${fmt(amt)}${Math.abs(abs - amt) <= PAY_EPS ? ' (fully settled)' : ''}.` : `Due will reduce by ${fmt(amt)}${Math.abs(abs - amt) <= PAY_EPS ? ' (fully settled)' : ''}.`;
  const msg = `${actionLabel} of ${fmt(amt)} for ${c.name} via ${mode}?\n\n${impactLabel}${note ? '\nNote: ' + note : ''}`;
  if (!confirm(msg)) return;

  applyCustomerSettlement(c.id, amt, mode, note);
}

function applyCustomerSettlement(customerId, amount, paymentMode, note) {
  const idx = customers.findIndex(x => x.id === customerId);
  if (idx === -1) { toast('Customer not found', 'error'); return; }
  const c = customers[idx];
  const before = Number(c.due) || 0;
  const amt = r2(Math.min(Math.abs(before), Math.max(0, Number(amount) || 0)));
  if (amt <= PAY_EPS) { toast('Nothing to settle', 'info'); return; }

  let after = before;
  let type = 'receive_due';
  let cashDelta = 0; // + in, - out
  let desc = '';

  if (before > PAY_EPS) {
    // Customer owes us: receiving payment reduces due
    after = r2(before - amt);
    type = 'receive_due';
    cashDelta = amt;
    desc = `Settlement received from ${c.name}`;
  } else if (before < -PAY_EPS) {
    // Customer has advance: refund/adjustment reduces advance (moves toward 0)
    after = r2(before + amt);
    type = 'refund_advance';
    cashDelta = -amt;
    desc = `Advance refund/adjustment to ${c.name}`;
  } else {
    toast('No outstanding balance to settle', 'info');
    return;
  }

  c.due = after;
  customers[idx] = c;
  DB.set('customers', customers);

  customerSettlements = Array.isArray(customerSettlements) ? customerSettlements : [];
  const entry = {
    id: uid(),
    refNo: 'SET-' + Date.now().toString().slice(-8),
    customerId: c.id,
    customerName: c.name,
    date: new Date().toLocaleDateString('en-IN'),
    createdAt: new Date().toISOString(),
    type,
    amount: amt,
    paymentMode: paymentMode || 'Cash',
    note: note || '',
    balanceBefore: r2(before),
    balanceAfter: r2(after)
  };
  customerSettlements.unshift(entry);
  if (customerSettlements.length > 2000) customerSettlements.length = 2000;
  DB.set('customerSettlements', customerSettlements);

  // Accounting/cash impact for money actually moving now
  try {
    cashDrawer = DB.get('cashDrawer') || cashDrawer || { opening: 0, cashIn: 0, cashOut: 0, log: [] };
    if (cashDelta > 0) {
      cashDrawer.cashIn = r2((Number(cashDrawer.cashIn) || 0) + cashDelta);
      cashDrawer.log = Array.isArray(cashDrawer.log) ? cashDrawer.log : [];
      cashDrawer.log.unshift({ type: 'in', desc: desc + (entry.refNo ? ` (${entry.refNo})` : ''), amount: r2(cashDelta), time: now ? now() : new Date().toLocaleString('en-IN') });
    } else if (cashDelta < 0) {
      const outAmt = Math.abs(cashDelta);
      cashDrawer.cashOut = r2((Number(cashDrawer.cashOut) || 0) + outAmt);
      cashDrawer.log = Array.isArray(cashDrawer.log) ? cashDrawer.log : [];
      cashDrawer.log.unshift({ type: 'out', desc: desc + (entry.refNo ? ` (${entry.refNo})` : ''), amount: r2(outAmt), time: now ? now() : new Date().toLocaleString('en-IN') });
    }
    if (Array.isArray(cashDrawer.log) && cashDrawer.log.length > 200) cashDrawer.log.length = 200;
    DB.set('cashDrawer', cashDrawer);
  } catch (e) { /* keep customer/ledger update even if cash drawer write fails */ }

  if (selectedCustomer && selectedCustomer.id === c.id) {
    selectedCustomer = c;
    try { renderCustomerCard(c); } catch (e) {}
  }

  renderCustomers();
  closeSettleOutstanding();
  closeCustomerDetailModal();
  const doneMsg = type === 'refund_advance'
    ? `Advance settled: ${fmt(amt)} refunded/adjusted for ${c.name}.`
    : `Payment received: ${fmt(amt)} from ${c.name}.`;
  toast(doneMsg, 'success');
}

// ─── DAMAGE ──────────────────────────────────────────────────
function renderDamage() {
  if (!damages.length) {
    els('damageBody').innerHTML = '<tr><td colspan="6" class="table-empty">No damage logged yet. Record spoilage or breakage to keep stock accurate.</td></tr>';
    return;
  }
  els('damageBody').innerHTML = damages.map(d => `<tr>
    <td>${d.date}</td>
    <td class="fw-semi">${d.product}</td>
    <td class="text-red fw-semi">${d.qty}</td>
    <td><span class="badge-pill badge-amber">${d.reason}</span></td>
    <td class="text-red">${fmt(d.lossValue)}</td>
    <td>${d.loggedBy}</td>
  </tr>`).join('');
}

function saveDamage() {
  if (window.HisaabSaaS && typeof window.HisaabSaaS.guard === 'function') {
    if (!window.HisaabSaaS.guard('damage_tracking', 'Damaged stock tracking')) return;
  }
  const pid = els('dProduct').value;
  const p = products.find(x => x.id === pid);
  if (!p) return;
  const qty = parseInt(els('dQty').value) || 1;
  if (qty > p.stock) { toast('Damage qty exceeds stock', 'error'); return; }
  p.stock -= qty;
  DB.set('products', products);
  logStockMovement({
    type: 'damaged', productId: p.id, productName: p.name, barcode: p.barcode || '',
    qtyChange: -qty, qtyAfter: p.stock, note: 'Damage · ' + (els('dReason').value || 'Logged')
  });
  damages.unshift({
    id: uid(), date: new Date().toLocaleDateString('en-IN'), product: p.name, qty,
    reason: els('dReason').value, lossValue: p.price * qty, loggedBy: getUserProfile().name
  });
  DB.set('damages', damages);
  hideModal('addDamageModal');
  renderDamage();
  toast('Damage logged', 'warning');
}

// ─── RETURNS ─────────────────────────────────────────────────
function renderReturns() {
  if (!returns.length) {
    els('returnsBody').innerHTML = '<tr><td colspan="8" class="table-empty">No returns recorded yet. Processed returns restore stock automatically.</td></tr>';
    return;
  }
  els('returnsBody').innerHTML = returns.map(r => `<tr>
    <td class="fw-semi text-purple">${r.returnNo}</td>
    <td>${r.invoice}</td>
    <td>${r.date}</td>
    <td>${r.customer}</td>
    <td>${r.product}</td>
    <td>${r.qty}</td>
    <td class="text-green fw-semi">${fmt(r.refund)}</td>
    <td><span class="badge-pill badge-green">${r.status}</span></td>
  </tr>`).join('');
}

function saveReturn() {
  if (window.HisaabSaaS && typeof window.HisaabSaaS.guard === 'function') {
    if (!window.HisaabSaaS.guard('returns', 'Sales returns')) return;
  }
  const pid = els('rProduct').value;
  const p = products.find(x => x.id === pid);
  if (!p) return;
  const qty = parseInt(els('rQty').value) || 1;
  const inv = els('rInvoice').value.trim();
  if (!inv) { toast('Enter original invoice number', 'error'); return; }
  p.stock += qty;
  DB.set('products', products);
  logStockMovement({
    type: 'returned', productId: p.id, productName: p.name, barcode: p.barcode || '',
    qtyChange: qty, qtyAfter: p.stock, note: 'Return ' + inv
  });
  const retNo = 'RET-' + String(returns.length + 1).padStart(4, '0');
  const retRecord = {
    id: uid(), returnNo: retNo, invoice: inv, date: new Date().toLocaleDateString('en-IN'),
    customer: selectedCustomer?.name || 'Walk-in', product: p.name, qty,
    refund: p.price * qty, status: 'Processed'
  };
  returns.unshift(retRecord);
  DB.set('returns', returns);

  // Restore free-product reward points if the reward line is fully returned.
  try { reverseRewardPointsForReturn(retRecord); } catch (e) { /* return must still succeed */ }

  // Loyalty reversal (best-effort, additive, auditable): if this return relates to a sale with loyalty activity,
  // reverse points proportionally to refund vs sale total (idempotent per return+sale).
  try {
    const invNorm = String(inv || '').trim().toLowerCase();
    const sale = (Array.isArray(sales) ? sales : []).find(s => String(s && (s.invNo || '')).trim().toLowerCase() === invNorm);
    if (sale && sale.customerId) {
      const cust = (Array.isArray(customers) ? customers : []).find(c => c.id === sale.customerId);
      if (cust) {
        ensureCustomerLoyaltyFields(cust);
        const saleTotal = Math.max(0, Number(sale.total) || 0);
        const refundAmt = Math.max(0, Number(retRecord.refund) || 0);
        const ratio = saleTotal > 0 ? Math.min(1, refundAmt / saleTotal) : 0;
        const saleEarn = Math.max(0, Math.floor(Number((sale.loyalty && sale.loyalty.pointsEarned) || sale.loyaltyPointsEarned || 0)));
        const saleRedeem = Math.max(0, Math.floor(Number((sale.loyalty && sale.loyalty.pointsRedeemed) || sale.loyaltyPointsRedeemed || 0)));
        // Proportional reversal; keep integers and cap to original sale loyalty
        let revEarn = Math.min(saleEarn, Math.round(saleEarn * ratio));
        let revRedeem = Math.min(saleRedeem, Math.round(saleRedeem * ratio));
        // If amounts match closely, reverse full remaining for this sale context
        if (ratio >= 0.999) { revEarn = saleEarn; revRedeem = saleRedeem; }
        const baseKey = 'return:' + retNo + ':sale:' + (sale.id || sale.invNo || invNorm);
        // Reverse earned points (remove points previously awarded)
        if (revEarn > 0 && !loyaltyTxnExists(baseKey + ':revEarn')) {
          const deduct = Math.min(revEarn, Math.max(0, Math.floor(Number(cust.points)||0)));
          cust.points = Math.max(0, Math.floor(Number(cust.points)||0) - deduct);
          cust.loyaltyEarnedTotal = Math.max(0, Math.floor(Number(cust.loyaltyEarnedTotal)||0) - revEarn);
          appendLoyaltyTransaction({
            idempotencyKey: baseKey + ':revEarn',
            customerId: cust.id, customerName: cust.name, type: 'reversed', points: -revEarn,
            balanceAfter: cust.points, saleId: sale.id, invNo: sale.invNo, invoiceId: sale.id, returnId: retRecord.id,
            description: 'Earned points reversed for return ' + retNo + ' (invoice ' + (sale.invNo||inv) + ')'
          });
        }
        // Reverse redeemed points (restore points previously spent) - only up to what was redeemed on sale
        if (revRedeem > 0 && !loyaltyTxnExists(baseKey + ':revRedeem')) {
          cust.points = Math.max(0, Math.floor(Number(cust.points)||0) + revRedeem);
          cust.loyaltyRedeemedTotal = Math.max(0, Math.floor(Number(cust.loyaltyRedeemedTotal)||0) - revRedeem);
          appendLoyaltyTransaction({
            idempotencyKey: baseKey + ':revRedeem',
            customerId: cust.id, customerName: cust.name, type: 'reversed', points: revRedeem,
            balanceAfter: cust.points, saleId: sale.id, invNo: sale.invNo, invoiceId: sale.id, returnId: retRecord.id,
            description: 'Redeemed points restored for return ' + retNo + ' (invoice ' + (sale.invNo||inv) + ')'
          });
        }
        DB.set('customers', customers);
      }
    }
  } catch (e) { /* keep return flow working */ }

  if (window.HisaabSaaS && typeof window.HisaabSaaS.track === 'function') {
    window.HisaabSaaS.track('return', { invoice: inv, qty, product: p.name });
  }
  hideModal('addReturnModal');
  renderReturns();
  toast('Return processed & stock updated', 'success');
}

// ─── CASH DRAWER ─────────────────────────────────────────────
function openCashDrawer() {
  cashDrawer = DB.get('cashDrawer') || { opening: 0, cashIn: 0, cashOut: 0, log: [] };
  const bal = cashDrawer.opening + (cashDrawer.cashIn || 0) - (cashDrawer.cashOut || 0);
  els('drawerOpening').textContent = fmt(cashDrawer.opening);
  els('drawerSales').textContent = fmt(cashDrawer.cashIn || 0);
  els('drawerOut').textContent = fmt(cashDrawer.cashOut || 0);
  els('drawerBalance').textContent = fmt(bal);
  els('drawerLog').innerHTML = cashDrawer.log.length
    ? cashDrawer.log.slice(0, 10).map(l => `<div class="log-item"><span>${l.desc}</span><span class="${l.type === 'out' ? 'text-red' : 'text-green'} fw-semi">${l.type === 'out' ? '-' : '+'} ${fmt(l.amount)}</span></div>`).join('')
    : '<p class="log-empty">No transactions today.</p>';
  showModal('cashDrawerModal');
}

function cashInOut(type) {
  const amt = parseFloat(prompt(`Enter amount to ${type === 'in' ? 'add' : 'remove'}:`));
  if (!amt || amt <= 0) return;
  if (type === 'in') cashDrawer.cashIn = (cashDrawer.cashIn || 0) + amt;
  else cashDrawer.cashOut = (cashDrawer.cashOut || 0) + amt;
  cashDrawer.log.unshift({ type, desc: `Cash ${type === 'in' ? 'In' : 'Out'}`, amount: amt, time: now() });
  DB.set('cashDrawer', cashDrawer);
  openCashDrawer();
  toast(`Cash ${type === 'in' ? 'added' : 'removed'}: ${fmt(amt)}`, 'success');
}

// ─── POPULATE SELECT DROPDOWNS ────────────────────────────────
function populateProductSelects() {
  [els('dProduct'), els('rProduct')].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = products.map(p => `<option value="${p.id}">${p.name} (Stock: ${p.stock})</option>`).join('');
  });
}

// ─── UTILITY ─────────────────────────────────────────────────
function switchToView(v) {
  if (typeof switchView === 'function') {
    switchView(v);
  } else {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));
    if (typeof updateMoreNavState === 'function') updateMoreNavState(v);
    if (v === 'categories-subcategories' && typeof renderCategoriesSubcategories === 'function') {
      renderCategoriesSubcategories();
    }
    if (v === 'loyalty' && typeof renderLoyaltyView === 'function') {
      renderLoyaltyView();
    }
  }
}

function setDate() {
  const d = new Date();
  if (els('cartDate')) els('cartDate').textContent = d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const pos = (typeof getPosSettings === 'function') ? getPosSettings() : (DB.get('posSettings') || {});
  const prefix = (pos.invoicePrefix || 'INV-').toString();
  if (els('invoiceNumber')) els('invoiceNumber').textContent = '#' + prefix + String(invoiceCounter).padStart(4, '0');
}

// ─── SETTINGS (POS Settings + User Profile) ───────────────────
const POS_SETTINGS_DEFAULTS = {
  storeName: 'Hisaab POS',
  businessType: 'Retail store',
  storePhone: '',
  storeEmail: '',
  gstin: '',
  state: '',
  storeAddress: '',
  storeLogo: null,
  saasPlan: 'free',
  saasPlanWatermark: true,
  saasPlanLimits: { billsPerMonth: 50, products: 100, devices: 1 },
  invoicePrefix: 'INV-',
  currencySymbol: '₹',
  defaultTax: 0,
  lowStockAlert: 5,
  receiptFooter: 'Thank you for shopping!',
  printTemplate: {
    paperSize: 'thermal',
    showLogo: true,
    showStoreName: true,
    showStoreAddress: true,
    showStorePhone: true,
    showStoreEmail: false,
    showGstin: true,
    showInvoiceMeta: true,
    showCustomer: true,
    showItemHsn: false,
    showItemTax: true,
    showItemDiscount: false,
    showSubtotal: true,
    showTaxBreakup: true,
    showShipping: true,
    showDiscount: true,
    showGrandTotal: true,
    showPaymentDetails: true,
    showAmountInWords: false,
    showFooter: true,
    showTerms: false,
    termsText: 'Goods once sold will not be taken back.'
  }
};

const USER_PROFILE_DEFAULTS = {
  name: 'Shop Owner',
  role: 'Owner',
  email: '',
  phone: '',
  avatar: null // data URL or null
};

/* ── Store / business logo persistence ─────────────────────────
   The logo is kept in its own small key (separate from posSettings)
   in three tiers so a preview can never be lost:
     1. in-memory     → survives view/page re-renders instantly
     2. sessionStorage→ survives a page reload in the same tab
     3. localStorage  → survives restarts and future visits
   posSettings still mirrors the logo for compatibility, but the
   dedicated key is the source of truth and is re-merged on read.
   ────────────────────────────────────────────────────────────── */
const STORE_LOGO_LS_KEY = 'hisaab_storeLogo';
let storeLogoMemory = null;

function readStoredLogo() {
  if (storeLogoMemory) return storeLogoMemory;
  try {
    const v = localStorage.getItem(STORE_LOGO_LS_KEY);
    if (v && v.length > 10) { storeLogoMemory = v; return v; }
  } catch (e) { /* storage unavailable */ }
  try {
    const v = sessionStorage.getItem(STORE_LOGO_LS_KEY);
    if (v && v.length > 10) { storeLogoMemory = v; return v; }
  } catch (e) { /* storage unavailable */ }
  return null;
}

function writeStoredLogo(dataUrl) {
  storeLogoMemory = dataUrl || null;
  let ok = false;
  if (dataUrl) {
    try { localStorage.setItem(STORE_LOGO_LS_KEY, dataUrl); ok = true; }
    catch (e) { console.warn('Store logo: localStorage unavailable', e); }
    try { sessionStorage.setItem(STORE_LOGO_LS_KEY, dataUrl); ok = true; }
    catch (e) { /* ignore */ }
  } else {
    try { localStorage.removeItem(STORE_LOGO_LS_KEY); } catch (e) { }
    try { sessionStorage.removeItem(STORE_LOGO_LS_KEY); } catch (e) { }
    ok = true;
  }
  return ok;
}

/* Single resolver used by settings and every receipt template. */
function resolveStoreLogo(pos) {
  const fromPos = pos && typeof pos.storeLogo === 'string' ? pos.storeLogo.trim() : '';
  if (fromPos) return fromPos;
  return readStoredLogo() || '';
}

/* Resize/compress an uploaded logo so it always fits in storage.
   512px is more than enough for a 24–48px tall receipt logo. */
function prepareStoreLogo(dataUrl, cb) {
  if (!dataUrl) { cb(''); return; }
  if (/^data:image\/svg\+xml/i.test(dataUrl)) { cb(dataUrl); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const maxDim = 512;
      const iw = img.width || 1;
      const ih = img.height || 1;
      const scale = Math.min(1, maxDim / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const keepAlpha = /^data:image\/(png|gif|webp)/i.test(dataUrl);
      let out = canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.92);
      // Long edge 512px photos can still be heavy as PNG/quality 0.92
      if (out.length > 350000) out = canvas.toDataURL('image/jpeg', 0.85);
      cb(out);
    } catch (e) {
      cb(dataUrl);
    }
  };
  img.onerror = () => cb(dataUrl);
  img.src = dataUrl;
}

function getPosSettings() {
  const saved = DB.get('posSettings') || {};
  const merged = Object.assign({}, POS_SETTINGS_DEFAULTS, saved, {
    printTemplate: Object.assign({}, POS_SETTINGS_DEFAULTS.printTemplate, (saved && saved.printTemplate) || {})
  });
  // Dedicated key is the source of truth for the logo
  const storedLogo = readStoredLogo();
  if (storedLogo) merged.storeLogo = storedLogo;
  return merged;
}
function getUserProfile() {
  const saved = DB.get('userProfile') || {};
  const p = Object.assign({}, USER_PROFILE_DEFAULTS, saved);
  let changed = false;
  // Older builds shipped a demo identity. Replace it with neutral defaults.
  if (['Alok Ranjan Oraon', 'Alok Ranjan Or…', 'Alok Ranjan', 'Kaleen Bhaiya'].includes(p.name)) {
    p.name = USER_PROFILE_DEFAULTS.name;
    changed = true;
  }
  if (p.role === 'Product Designer') {
    p.role = USER_PROFILE_DEFAULTS.role;
    changed = true;
  }
  if (p.phone && !/^\d{10}$/.test(String(p.phone))) {
    p.phone = '';
    changed = true;
  }
  if (changed) DB.set('userProfile', p);
  return p;
}

function userInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function applyUserProfile(profile, fromCloud) {
  const p = Object.assign({}, USER_PROFILE_DEFAULTS, profile || {});
  if (!fromCloud) DB.set('userProfile', p);

  const avatarBtn = document.getElementById('userAvatarBtn');
  const nameEl = document.querySelector('.user-name');
  const roleEl = document.querySelector('.user-role');
  const profileContainer = document.querySelector('.user-profile');
  const dropdownAvatar = document.getElementById('dropdownAvatar');
  const dropdownName = document.querySelector('.dropdown-name');
  const dropdownEmail = document.querySelector('.dropdown-email');
  const fullName = (p.name || '').trim() || 'User';
  if (nameEl) {
    nameEl.textContent = fullName;
    nameEl.title = fullName;
  }
  if (profileContainer) {
    profileContainer.title = fullName;
  }
  if (dropdownName) {
    dropdownName.textContent = fullName;
  }
  if (dropdownEmail) {
    dropdownEmail.textContent = p.email || 'not set';
  }
  if (roleEl) roleEl.textContent = p.role || '';
  const initials = userInitials(fullName);
  if (avatarBtn) {
    if (p.avatar) {
      avatarBtn.textContent = '';
      avatarBtn.style.backgroundImage = `url(${p.avatar})`;
      avatarBtn.style.backgroundSize = 'cover';
      avatarBtn.style.backgroundPosition = 'center';
    } else {
      avatarBtn.style.backgroundImage = '';
      avatarBtn.textContent = initials;
    }
  }
  if (dropdownAvatar) {
    if (p.avatar) {
      dropdownAvatar.style.backgroundImage = `url(${p.avatar})`;
      dropdownAvatar.style.backgroundSize = 'cover';
      dropdownAvatar.style.backgroundPosition = 'center';
      dropdownAvatar.textContent = '';
    } else {
      dropdownAvatar.style.backgroundImage = '';
      dropdownAvatar.textContent = initials;
    }
  }
}

function applyPosSettings(settings, fromCloud) {
  const s = Object.assign({}, POS_SETTINGS_DEFAULTS, settings || {});
  // A logo already saved on this device must never be dropped by an
  // unrelated settings write (plan apply, cloud context refresh, …)
  if (!s.storeLogo) {
    const storedLogo = readStoredLogo();
    if (storedLogo) s.storeLogo = storedLogo;
  }
  if (!fromCloud) {
    // Write the small logo key first: even if the big settings blob hits the
    // storage quota, the logo still survives and is merged back on read.
    writeStoredLogo(s.storeLogo || null);
    DB.set('posSettings', s);
  }

  // Update invoice prefix display helper if present
  const invEl = els('invoiceNumber');
  if (invEl && typeof invoiceCounter !== 'undefined') {
    const prefix = (s.invoicePrefix || 'INV-').toString();
    invEl.textContent = '#' + prefix + String(invoiceCounter).padStart(4, '0');
  }

  // Apply default tax to product form helper if empty/default context is desired
  // (non-destructive: only affects new entries via form defaulting elsewhere)
  window.__posSettings = s;

  // Business state/GSTIN may have changed → refresh the tax split on screen
  if (document.getElementById('subtotalDisplay') && typeof renderCartTotals === 'function') {
    try { renderCartTotals(); } catch (e) { }
  }
}

function populateStateSelect(sel, selectedName) {
  if (!sel) return;
  if (!sel.dataset.gstStatesReady) {
    sel.innerHTML = '<option value="">Select state</option>' +
      GST_STATES.map(s => `<option value="${s[1]}">${s[1]} (${s[0]})</option>`).join('');
    sel.dataset.gstStatesReady = '1';
  }
  const hit = gstStateFromName(selectedName);
  sel.value = hit ? hit.name : '';
}

function renderSettingsView(section) {
  const sec = section || (document.querySelector('.stg-nav-btn.active')?.dataset.stg) || 'pos';
  // nav
  document.querySelectorAll('.stg-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.stg === sec));
  document.querySelectorAll('.stg-panel').forEach(p => p.classList.toggle('active', p.id === 'stg-panel-' + sec));

  const pos = getPosSettings();
  const stg = (id) => document.getElementById(id);
  if (stg('stgStoreName')) stg('stgStoreName').value = pos.storeName || '';
  if (stg('stgBusinessType')) stg('stgBusinessType').value = pos.businessType || POS_SETTINGS_DEFAULTS.businessType;
  if (stg('stgStorePhone')) stg('stgStorePhone').value = pos.storePhone || '';
  if (stg('stgStoreEmail')) stg('stgStoreEmail').value = pos.storeEmail || '';
  if (stg('stgGstin')) stg('stgGstin').value = pos.gstin || '';
  populateStateSelect(stg('stgState'), pos.state || (gstStateFromGstin(pos.gstin)?.name) || '');
  if (stg('stgStoreAddress')) stg('stgStoreAddress').value = pos.storeAddress || '';

  // Store / Business Logo preview (dedicated storage is the source of truth)
  const logoPrev = stg('stgLogoPreview');
  if (logoPrev) {
    const existingLogoImg = logoPrev.querySelector('img');
    const logoSrc = resolveStoreLogo(pos) || (existingLogoImg ? existingLogoImg.src : '');
    if (logoSrc) {
      if (!existingLogoImg || existingLogoImg.getAttribute('src') !== logoSrc) {
        logoPrev.innerHTML = `<img src="${logoSrc}" alt="Store logo" class="stg-logo-preview-img" />`;
      }
      const rm = stg('stgLogoRemove');
      if (rm) rm.style.display = '';
    } else {
      logoPrev.innerHTML = '';
      const rm = stg('stgLogoRemove');
      if (rm) rm.style.display = 'none';
    }
  }

  if (stg('stgInvoicePrefix')) stg('stgInvoicePrefix').value = pos.invoicePrefix || 'INV-';
  if (stg('stgCurrency')) stg('stgCurrency').value = pos.currencySymbol || '₹';
  if (stg('stgDefaultTax')) stg('stgDefaultTax').value = pos.defaultTax ?? 0;
  if (stg('stgLowStockAlert')) stg('stgLowStockAlert').value = pos.lowStockAlert ?? 5;
  if (stg('stgReceiptFooter')) stg('stgReceiptFooter').value = pos.receiptFooter || '';

  // Print template
  const pt = (pos && pos.printTemplate) || POS_SETTINGS_DEFAULTS.printTemplate || {};
  Object.keys(POS_SETTINGS_DEFAULTS.printTemplate).forEach(k => {
    const el = stg('stgPrint_' + k);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!pt[k];
    else el.value = pt[k] == null ? '' : String(pt[k]);
  });
  if (typeof renderPrintBillPreview === 'function') renderPrintBillPreview();

  // Barcode label print settings
  if (stg('stgBarcode_preset')) renderBarcodeSettingsFields();

  const prof = getUserProfile();
  if (stg('stgUserName')) stg('stgUserName').value = prof.name || '';
  if (stg('stgUserRole')) stg('stgUserRole').value = prof.role || '';
  if (stg('stgUserEmail')) stg('stgUserEmail').value = prof.email || '';
  if (stg('stgUserPhone')) stg('stgUserPhone').value = prof.phone || '';
  renderProfileAvatarPreview(prof);
}

function renderProfileAvatarPreview(prof) {
  const box = document.getElementById('stgAvatarPreview');
  if (!box) return;
  const p = prof || getUserProfile();
  if (p.avatar) {
    box.innerHTML = `<img src="${p.avatar}" alt="Profile photo" />`;
  } else {
    box.textContent = userInitials(p.name || 'User');
  }
}

function collectPrintTemplateFromForm(base) {
  const pt = Object.assign({}, POS_SETTINGS_DEFAULTS.printTemplate, (base || getPosSettings().printTemplate) || {});
  Object.keys(POS_SETTINGS_DEFAULTS.printTemplate).forEach(k => {
    const el = document.getElementById('stgPrint_' + k);
    if (!el) return;
    if (el.type === 'checkbox') pt[k] = !!el.checked;
    else pt[k] = (el.value ?? '').toString();
  });
  return pt;
}

function savePosSettingsFromForm() {
  const v = id => (document.getElementById(id)?.value ?? '').toString().trim();
  const settings = Object.assign({}, getPosSettings(), {
    storeName: v('stgStoreName') || 'Hisaab POS',
    businessType: v('stgBusinessType') || getPosSettings().businessType || 'Retail store',
    storePhone: v('stgStorePhone'),
    storeEmail: v('stgStoreEmail'),
    gstin: v('stgGstin').toUpperCase(),
    state: v('stgState') || (gstStateFromGstin(v('stgGstin'))?.name || gstStateFromText(v('stgStoreAddress'))?.name || ''),
    storeAddress: v('stgStoreAddress'),
    storeLogo: (() => {
      const img = document.getElementById('stgLogoPreview')?.querySelector('img');
      if (img && img.src) return img.src;
      // No preview rendered — keep whatever logo is already stored instead of
      // wiping it while saving unrelated settings.
      return readStoredLogo();
    })(),
    invoicePrefix: v('stgInvoicePrefix') || 'INV-',
    currencySymbol: v('stgCurrency') || '₹',
    defaultTax: Math.max(0, Math.min(100, parseFloat(v('stgDefaultTax')) || 0)),
    lowStockAlert: Math.max(0, parseInt(v('stgLowStockAlert'), 10) || 0),
    receiptFooter: v('stgReceiptFooter') || 'Thank you for shopping!',
    printTemplate: collectPrintTemplateFromForm(getPosSettings().printTemplate)
  });
  applyPosSettings(settings);
  renderCartTotals();
  toast('POS settings saved', 'success');

  // Cloud mode: write the shop details through to the organization's store.
  // Local value is already saved, so a network failure changes nothing here.
  if (window.HisaabCloud && typeof window.HisaabCloud.saveBusiness === 'function') {
    try { window.HisaabCloud.saveBusiness(settings).catch(function () { }); } catch (e) { }
  }
}

function savePrintSettingsFromForm() {
  const settings = Object.assign({}, getPosSettings(), {
    printTemplate: collectPrintTemplateFromForm(getPosSettings().printTemplate)
  });
  applyPosSettings(settings);
  toast('Print template settings saved', 'success');
}

function saveUserProfileFromForm() {
  const v = id => (document.getElementById(id)?.value ?? '').toString().trim();
  const prev = getUserProfile();
  const profile = Object.assign({}, prev, {
    name: v('stgUserName') || 'User',
    role: v('stgUserRole'),
    email: v('stgUserEmail'),
    phone: v('stgUserPhone')
  });
  applyUserProfile(profile);
  renderProfileAvatarPreview(profile);
  toast('Profile saved', 'success');

  // Cloud mode: keep the Supabase profile in sync with the local one.
  if (window.HisaabCloud && typeof window.HisaabCloud.saveProfile === 'function') {
    try {
      window.HisaabCloud.saveProfile({ full_name: profile.name, phone: profile.phone }).catch(function () { });
    } catch (e) { }
  }
}

async function openDeleteAccountDialog() {
  const saas = window.HisaabSaaS;
  let state = saas && saas.state ? saas.state : null;
  let account = state && state.account ? state.account : null;
  const cloud = window.HisaabCloud;
  const cloudActive = !!(cloud && typeof cloud.isActive === 'function' && cloud.isActive());

  // In cloud mode the billing/SaaS session is provisioned asynchronously from
  // the signed-in Supabase identity. Ensure it is ready before opening deletion.
  if (saas && cloudActive) {
    try {
      const cloudUserId = (typeof cloud.userId === 'function' && cloud.userId()) || (state && state.identityId) || '';
      if (cloudUserId && typeof saas.setIdentity === 'function') {
        saas.setIdentity(cloudUserId);
      }
      if ((!state || !state.token || !state.account) && typeof saas.refresh === 'function') {
        await saas.refresh({ silent: true });
      }
    } catch (e) { /* ignore */ }
    state = saas && saas.state ? saas.state : null;
    account = state && state.account ? state.account : null;
  }

  if (!account || !state || (!state.token && !state.deviceId)) {
    if (typeof toast === 'function') {
      toast(cloudActive
        ? 'Could not connect to your account session. Please check your connection and try again.'
        : 'Sign in to your account to delete it.', 'info');
    }
    return;
  }

  const hasPassword = !!account.hasPassword;
  const overlay = document.createElement('div');
  overlay.className = 'stg-delete-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="stg-delete-modal" style="max-width:560px;width:calc(100% - 32px);background:var(--card-bg,#fff);border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.25);">
      <h3 style="margin:0 0 8px;font-size:18px;">Delete account</h3>
      <p style="margin:0 0 10px;color:var(--text-secondary,#4b5563);font-size:14px;">Your account will be <strong>deactivated now</strong> (soft-deleted), not immediately permanently erased. You will be signed out and cannot access it normally.</p>
      <ul style="margin:0 0 12px 18px;color:var(--text-secondary,#4b5563);font-size:13px;line-height:1.5;">
        <li>Account, subscription, billing and available SaaS records are retained securely for recovery within the retention period.</li>
        <li>If you sign in again with the same email, you can <strong>Recover old account</strong> or <strong>Start fresh account</strong>.</li>
        <li>Starting fresh will not restore previous business data, products, customers, inventory, transactions or settings.</li>
      </ul>
      <div class="stg-field" style="margin:10px 0;">
        <label for="stgDeleteConfirmText" style="display:block;font-size:13px;margin-bottom:6px;">To continue, type <strong>DELETE</strong></label>
        <input id="stgDeleteConfirmText" class="stg-input" type="text" placeholder="DELETE" autocomplete="off" />
      </div>
      ${hasPassword ? `<div class="stg-field" style="margin:10px 0;">
        <label for="stgDeletePassword" style="display:block;font-size:13px;margin-bottom:6px;">Confirm your password</label>
        <input id="stgDeletePassword" class="stg-input" type="password" placeholder="Your password" autocomplete="current-password" />
      </div>` : `<p style="margin:6px 0 10px;color:var(--text-secondary,#6b7280);font-size:13px;">This device account has no password. Typing DELETE confirms your identity for this request.</p>`}
      <div id="stgDeleteError" style="display:none;margin:8px 0;color:#b91c1c;font-size:13px;"></div>
      <div class="stg-actions" style="justify-content:flex-end;gap:8px;margin-top:14px;">
        <button type="button" class="btn" id="stgDeleteCancelBtn">Cancel</button>
        <button type="button" class="btn btn-danger" id="stgDeleteConfirmBtn">Deactivate account</button>
      </div>
    </div>`;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10050;padding:16px;';
  document.body.appendChild(overlay);

  const close = () => { try { overlay.remove(); } catch (e) {} };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#stgDeleteCancelBtn')?.addEventListener('click', close);

  const errEl = overlay.querySelector('#stgDeleteError');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
  overlay.querySelector('#stgDeleteConfirmBtn')?.addEventListener('click', async () => {
    const confirmText = String(overlay.querySelector('#stgDeleteConfirmText')?.value || '').trim();
    const password = String(overlay.querySelector('#stgDeletePassword')?.value || '');
    if (confirmText.toUpperCase() !== 'DELETE') return showErr('Please type DELETE to confirm.');
    if (hasPassword && !password) return showErr('Enter your password to confirm your identity.');
    const btn = overlay.querySelector('#stgDeleteConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Deactivating...'; }
    try {
      const r = await saas.deleteMyAccount({ password, confirm: confirmText });
      if (!r || !r.ok) {
        showErr((r && r.data && r.data.error) || 'Could not delete the account. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'Deactivate account'; }
        return;
      }
      close();
      if (typeof toast === 'function') toast('Your account has been deactivated. You can recover it or start fresh when you sign in again.', 'success');
      // Sign out of cloud session if active (best effort).
      try { if (cloud && typeof cloud.signOut === 'function' && cloudActive) await cloud.signOut(); } catch (e) {}
      // Return to a safe signed-out state.
      setTimeout(() => {
        try {
          if (typeof switchToView === 'function') switchToView('landing');
          else if (typeof go === 'function') go('landing');
        } catch (e) {}
        try { window.location.hash = '#/landing'; } catch (e) {}
      }, 400);
    } catch (e) {
      showErr('Could not delete the account. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Deactivate account'; }
    }
  });
}


function setupSettings() {
  // Sub-nav
  document.querySelectorAll('.stg-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => renderSettingsView(btn.dataset.stg));
  });

  // User profile dropdown (replaces opening Settings from the header)
  const userProfileWrap = els('userProfileWrap');
  const userProfileBtn = els('userProfileBtn');
  const userAvatarBtn = els('userAvatarBtn');
  const userDropdown = els('userDropdown');

  function closeUserDropdown() {
    if (!userDropdown) return;
    userDropdown.classList.add('hidden');
    if (userProfileBtn) userProfileBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('user-dropdown-open');
  }

  function toggleUserDropdown(e) {
    if (e) e.stopPropagation();
    if (userDropdown.classList.contains('hidden')) {
      // Close other menus first
      document.querySelectorAll('.cmaster-menu.hidden').forEach(m => { m.classList.remove('hidden'); });
      document.querySelectorAll('.cmaster-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
      userDropdown.classList.remove('hidden');
      if (userProfileBtn) userProfileBtn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('user-dropdown-open');
    } else {
      closeUserDropdown();
    }
  }

  if (userProfileBtn) userProfileBtn.addEventListener('click', toggleUserDropdown);
  if (userAvatarBtn) userAvatarBtn.addEventListener('click', toggleUserDropdown);

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (userDropdown && !userDropdown.contains(e.target) && !userProfileBtn?.contains(e.target)) {
      closeUserDropdown();
    }
  });

  // Dropdown item actions
  els('menuProfile')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeUserDropdown();
    switchToView('settings');
    renderSettingsView('profile');
  });
  els('menuSettings')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeUserDropdown();
    switchToView('settings');
    renderSettingsView('profile');
  });
  els('menuLogout')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeUserDropdown();
    // Use cloud sign-out if Supabase is configured, otherwise local demo logout
    if (window.HisaabCloud && typeof window.HisaabCloud.signOut === 'function') {
      window.HisaabCloud.signOut();
    } else {
      DB.remove('userProfile');
      DB.remove('onboardingDone');
      DB.remove('onboardingDraft');
      location.reload();
    }
  });

  els('stgSavePosBtn')?.addEventListener('click', savePosSettingsFromForm);
  els('stgSavePrintBtn')?.addEventListener('click', savePrintSettingsFromForm);
  els('stgTestPrintBtn')?.addEventListener('click', testPrintBillTemplate);

  // Barcode label printing (modal + settings preview)
  setupBarcodePrinting();

  // Live print template preview
  const stgPrintPanel = document.getElementById('stg-panel-print');
  if (stgPrintPanel && !stgPrintPanel.dataset.previewBound) {
    stgPrintPanel.dataset.previewBound = '1';
    stgPrintPanel.addEventListener('input', (e) => {
      const t = e.target;
      if (t && (t.id && t.id.startsWith('stgPrint_') || ['stgStoreName','stgStorePhone','stgStoreEmail','stgStoreAddress','stgGstin','stgReceiptFooter','stgStoreLogo'].includes(t.id))) {
        renderPrintBillPreview();
      }
    });
    stgPrintPanel.addEventListener('change', (e) => {
      const t = e.target;
      if (t && (t.id && (t.id.startsWith('stgPrint_') || t.id === 'stgStoreLogo'))) renderPrintBillPreview();
    });
  }

  // ─── Store / Business Logo upload ─────────────────────────
  const logoInput = els('stgLogoRemove') && els('stgStoreLogo');
  const logoPrev = els('stgLogoPreview');
  const logoRemoveBtn = els('stgLogoRemove');

  if (logoInput && logoPrev) {
    logoInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast('Please choose an image file', 'error'); return; }
      if (file.size > 2 * 1024 * 1024) { toast('Max file size is 2MB', 'error'); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        prepareStoreLogo(ev.target.result, (dataUrl) => {
          if (!dataUrl) return;
          logoPrev.innerHTML = `<img src="${dataUrl}" alt="Store logo" class="stg-logo-preview-img" />`;
          if (logoRemoveBtn) logoRemoveBtn.style.display = '';
          // Persist immediately so the logo survives page/tab navigation
          const settings = Object.assign({}, getPosSettings(), { storeLogo: dataUrl });
          applyPosSettings(settings);
          // Mirror to the cloud store (survives a cleared browser cache / new device)
          if (window.HisaabCloud && typeof window.HisaabCloud.saveStoreLogo === 'function') {
            try { window.HisaabCloud.saveStoreLogo(dataUrl).catch(function () { }); } catch (err) { }
          }
          if (readStoredLogo()) {
            toast('Logo uploaded successfully.', 'success');
          } else {
            toast('Logo added, but this browser could not store it. Try a smaller image.', 'error');
          }
          // Refresh template preview to show the uploaded logo
          if (typeof renderPrintBillPreview === 'function') renderPrintBillPreview();
        });
      };
      reader.readAsDataURL(file);
    });
  }

  if (logoRemoveBtn && logoPrev) {
    logoRemoveBtn.addEventListener('click', () => {
      logoPrev.innerHTML = '';
      logoRemoveBtn.style.display = 'none';
      const input = els('stgStoreLogo');
      if (input) input.value = '';
      // Auto-save removal to POS settings (and the dedicated logo key)
      try {
        writeStoredLogo(null);
        const settings = Object.assign({}, getPosSettings(), { storeLogo: null });
        applyPosSettings(settings);
      } catch (e) { /* ignore */ }
      if (window.HisaabCloud && typeof window.HisaabCloud.saveStoreLogo === 'function') {
        try { window.HisaabCloud.saveStoreLogo(null).catch(function () { }); } catch (err) { }
      }
      toast('Logo removed.', 'success');
      if (typeof renderPrintBillPreview === 'function') renderPrintBillPreview();
    });
  }
  els('stgSaveProfileBtn')?.addEventListener('click', saveUserProfileFromForm);
  els('stgDeleteAccountBtn')?.addEventListener('click', openDeleteAccountDialog);

  // Business state drives CGST/SGST vs IGST — auto-fill it from the GSTIN prefix
  populateStateSelect(els('stgState'), getPosSettings().state || '');
  els('stgGstin')?.addEventListener('input', () => {
    const st = gstStateFromGstin(els('stgGstin').value);
    if (st && els('stgState')) els('stgState').value = st.name;
  });

  // Avatar upload
  els('stgAvatarInput')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file', 'error'); return; }
    if (file.size > 1024 * 1024) { toast('Max file size is 1MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const prof = Object.assign({}, getUserProfile(), { avatar: ev.target.result });
      DB.set('userProfile', prof); // save photo immediately
      renderProfileAvatarPreview(prof);
      toast('Photo selected — click Save Profile to apply to header', 'info');
    };
    reader.readAsDataURL(file);
  });
  els('stgRemovePhotoBtn')?.addEventListener('click', () => {
    const prof = Object.assign({}, getUserProfile(), { avatar: null });
    DB.set('userProfile', prof);
    renderProfileAvatarPreview(prof);
    toast('Photo removed — click Save Profile to apply', 'info');
  });

  // Apply saved profile/settings on load (header etc.)
  applyUserProfile(getUserProfile(), true);
  applyPosSettings(getPosSettings(), true);
}

// ─── FIRST-RUN ONBOARDING ────────────────────────────────────
// Create account (email + phone OTP) → email verification → 3-step business setup.
let obScreen = 'signup';
let obDraft = null;
let obPhoneVerified = false;
let obResendTimer = null;
let obResendLeft = 0;
let obBusinessTypes = [];
let obTeamSize = '';
let obSelectedPlan = 'free';
let obCarouselTimer = null;
let obCarouselIndex = 0;

/* ── Plan catalogue (mirrors saas.js FALLBACK_PLANS + catalog flags) ── */
const OB_PLANS = {
  free: {
    id: 'free', name: 'Free', badge: 'Free forever',
    price: { monthly: 0, yearly: 0 },
    limits: { billsPerMonth: 50, products: 100, devices: 1 },
    watermark: true,
    highlights: ['50 bills per month', 'Up to 100 products', 'Thermal & A4 receipts', 'Basic POS billing']
  },
  starter: {
    id: 'starter', name: 'Starter', badge: 'Most popular',
    price: { monthly: 299, yearly: 2999 },
    limits: { billsPerMonth: 1000, products: 2000, devices: 3 },
    watermark: false,
    highlights: ['1,000 bills per month', 'Up to 2,000 products', 'No watermark on receipts', 'Sales returns & damaged stock', 'CSV export']
  },
  pro: {
    id: 'pro', name: 'Pro', badge: 'Best value',
    price: { monthly: 699, yearly: 6999 },
    limits: { billsPerMonth: null, products: null, devices: 10 },
    watermark: false,
    highlights: ['Unlimited bills', 'Unlimited products', 'No watermark on receipts', 'Advanced reports', 'Multi-store ready', 'Priority support & API access']
  }
};

const OB_CAROUSEL_DELAY = 5000;

function obEl(id) { return document.getElementById(id); }

function obVal(id) {
  const el = obEl(id);
  return el ? String(el.value || '').trim() : '';
}

function obSet(id, value) {
  const el = obEl(id);
  if (el) el.value = value == null ? '' : String(value);
}

function obChecked(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : '';
}

/* ── Right-panel photo carousel ──────────────────────────── */
function obSlides() {
  return Array.from(document.querySelectorAll('#obSlides .ob-slide'));
}

function obShowSlide(index) {
  const slides = obSlides();
  if (!slides.length) return;
  obCarouselIndex = ((index % slides.length) + slides.length) % slides.length;
  slides.forEach((slide, i) => slide.classList.toggle('is-active', i === obCarouselIndex));
}

function obStopCarousel() {
  if (obCarouselTimer) {
    clearInterval(obCarouselTimer);
    obCarouselTimer = null;
  }
}

function obStartCarousel() {
  obStopCarousel();
  if (!obSlides().length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  obCarouselTimer = setInterval(() => obShowSlide(obCarouselIndex + 1), OB_CAROUSEL_DELAY);
}

function obSetRadio(name, value) {
  const el = value ? document.querySelector(`input[name="${name}"][value="${value}"]`) : null;
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => { r.checked = !!el && r === el; });
}

function obPhoneDigits() {
  return obVal('obPhone').replace(/\D/g, '').slice(0, 10);
}

function obEmailValid() {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obVal('obEmail'));
}

function obToggleError(errorId, inputId, on) {
  const err = obEl(errorId);
  if (err) err.classList.toggle('is-visible', !!on);
  if (!inputId) return;
  const input = obEl(inputId);
  if (input) input.classList.toggle('has-error', !!on);
  const row = input && input.closest('.ob-phone-row');
  if (row) row.classList.toggle('has-error', !!on);
}

function obUpdateSignupAs() {
  const who = obVal('obEmail') || (obDraft && obDraft.email) || '';
  ['obSignupAs', 'obSignupAs2', 'obSignupAs3'].forEach(id => {
    const el = obEl(id);
    if (el) el.textContent = who || 'you';
  });
}

function obShow(name) {
  const valid = ['signup', 'signin', 'verify', 'step1', 'step2', 'step3', 'plan'];
  obScreen = valid.includes(name) ? name : 'signup';

  document.querySelectorAll('.ob-screen').forEach(sec => {
    sec.classList.toggle('is-active', sec.dataset.obScreen === obScreen);
  });
  const verify = obEl('obEmailVerify');
  if (verify) verify.classList.toggle('hidden', obScreen !== 'verify');

  obUpdateSignupAs();
  obSyncPhoneUi();

  if (obScreen === 'step2') obApplyGstMode();
  obRefreshButtons();

  const overlay = obEl('onboardingScreen');
  if (overlay) overlay.scrollTop = 0;

  if (obScreen === 'signup') {
    setTimeout(() => { try { obEl('obEmail')?.focus({ preventScroll: true }); } catch (e) { } }, 80);
  } else if (obScreen === 'signin') {
    setTimeout(() => { try { obEl('obLoginId')?.focus({ preventScroll: true }); } catch (e) { } }, 80);
  } else if (obScreen === 'step1') {
    setTimeout(() => { try { obEl('obFullName')?.focus({ preventScroll: true }); } catch (e) { } }, 80);
  } else if (obScreen === 'plan') {
    obRenderPlanGrid();
    obUpdatePlanNote();
  }
}

/* ── Validation + button state ───────────────────────────── */
function obSignupReady() {
  // Phone OTP is handled separately; the Continue button just needs both fields.
  return obEmailValid() && obPhoneDigits().length === 10;
}

function obUpdateContinueHint() {
  const hint = obEl('obContinueHint');
  if (!hint) return;
  if (!obEmailValid()) hint.textContent = 'Enter your work email to continue.';
  else if (obPhoneDigits().length !== 10) hint.textContent = 'Enter your 10-digit phone number to continue.';
  else if (!obPhoneVerified) {
    const wrap = obEl('obOtpWrap');
    hint.textContent = (wrap && !wrap.classList.contains('hidden'))
      ? 'Enter the 6-digit code sent to your phone.'
      : 'Tap "Send OTP" to verify your phone number, then continue.';
  }
  else hint.textContent = 'Next: we\'ll send a verification link to your email.';
}

function obStep1Valid() {
  const name = obVal('obFullName');
  const pw = obEl('obStepPassword')?.value || '';
  const confirm = obEl('obStepConfirm')?.value || '';
  return !!name && pw.length >= 8 && pw === confirm;
}

function obStep2Valid() {
  const gst = obChecked('obGst');
  if (!gst) return false;
  if (gst !== 'yes') return true;
  return obVal('obGstin').toUpperCase().length === 15 && !!obVal('obBusinessAddress');
}

function obRefreshButtons() {
  const cont = obEl('obContinueEmailBtn');
  if (cont) cont.disabled = !obSignupReady();
  obUpdateContinueHint();

  const s1 = obEl('obStep1Continue');
  if (s1) s1.disabled = !obStep1Valid();

  const s2 = obEl('obStep2Continue');
  if (s2) s2.disabled = !obStep2Valid();
}

/* ── Phone verification UI state ─────────────────────────── */
function obSyncPhoneUi() {
  const btn = obEl('obVerifyPhoneBtn');
  const hint = obEl('obPhoneHint');
  const success = obEl('obPhoneSuccess');
  if (hint) hint.classList.toggle('hidden', obPhoneVerified);
  if (success) success.classList.toggle('hidden', !obPhoneVerified);
  if (btn) {
    btn.textContent = obPhoneVerified ? 'Verified ✓' : 'Send OTP';
    btn.disabled = obPhoneVerified;
    btn.classList.toggle('is-verified', obPhoneVerified);
  }
}

/* ── Draft persistence ───────────────────────────────────── */
function obCollectDraft() {
  return {
    screen: obScreen,
    email: obVal('obEmail'),
    phone: obVal('obPhone'),
    phoneVerified: obPhoneVerified,
    fullName: obVal('obFullName'),
    businessTypes: obBusinessTypes.slice(),
    gst: obChecked('obGst'),
    gstin: obVal('obGstin').toUpperCase(),
    legalName: obVal('obLegalName'),
    gstType: obVal('obGstType'),
    gstState: obVal('obGstState'),
    businessAddress: obVal('obBusinessAddress'),
    addressState: obVal('obAddressState'),
    city: obVal('obCity'),
    pincode: obVal('obPinCode'),
    locations: obChecked('obLocations'),
    posUse: obChecked('obPosUse'),
    taxBilling: obChecked('obTaxBilling'),
    teamSize: obTeamSize,
    plan: obSelectedPlan
  };
}

function obSaveDraft() {
  obDraft = obCollectDraft();
  DB.set('onboardingDraft', obDraft);
}

/* ── Phone OTP (local demo) ──────────────────────────────── */
function obOtpBoxes() {
  return Array.from(document.querySelectorAll('#obOtpBoxes input'));
}

function obOtpValue() {
  return obOtpBoxes().map(b => b.value).join('');
}

function obStopResendTimer() {
  if (obResendTimer) { clearInterval(obResendTimer); obResendTimer = null; }
}

function obRenderResend() {
  const btn = obEl('obResendBtn');
  if (!btn) return;
  if (obResendLeft > 0) {
    btn.disabled = true;
    btn.classList.remove('is-ready');
    btn.textContent = `Resend in ${obResendLeft}s`;
  } else {
    btn.disabled = false;
    btn.classList.add('is-ready');
    btn.textContent = 'Resend OTP';
  }
}

function obStartResendTimer() {
  obStopResendTimer();
  obResendLeft = 23;
  obRenderResend();
  obResendTimer = setInterval(() => {
    obResendLeft -= 1;
    if (obResendLeft <= 0) {
      obResendLeft = 0;
      obStopResendTimer();
    }
    obRenderResend();
  }, 1000);
}

function obOtpMetaVisible(show) {
  const meta = document.querySelector('.ob-otp-meta');
  if (meta) meta.classList.toggle('is-hidden', !show);
}

function obCompleteOtp() {
  obPhoneVerified = true;
  obStopResendTimer();
  obOtpMetaVisible(false);
  const wrap = obEl('obOtpWrap');
  if (wrap) wrap.classList.add('hidden');
  obSyncPhoneUi();
  obSaveDraft();
  obRefreshButtons();
  toast('Phone number verified', 'success');
}

function obResetPhoneVerification() {
  obPhoneVerified = false;
  obOtpBoxes().forEach(b => { b.value = ''; });
  obStopResendTimer();
  obOtpMetaVisible(true);
  const wrap = obEl('obOtpWrap');
  if (wrap) wrap.classList.add('hidden');
  obSyncPhoneUi();
  obRefreshButtons();
}

function obSetupOtpInputs() {
  const boxes = obOtpBoxes();
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = (box.value.replace(/\D/g, '') || '').slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
      if (obOtpValue().length === boxes.length) obCompleteOtp();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].value = '';
        boxes[i - 1].focus();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' && i > 0) {
        boxes[i - 1].focus();
      } else if (e.key === 'ArrowRight' && i < boxes.length - 1) {
        boxes[i + 1].focus();
      }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, boxes.length).split('');
      digits.forEach((digit, k) => { if (boxes[k]) boxes[k].value = digit; });
      if (digits.length) boxes[Math.min(digits.length, boxes.length) - 1].focus();
      if (obOtpValue().length === boxes.length) obCompleteOtp();
    });
    box.addEventListener('focus', () => box.select());
  });
}

function obStartOtp() {
  const digits = obPhoneDigits();
  if (digits.length !== 10) {
    obToggleError('obPhoneError', 'obPhone', true);
    obEl('obPhone')?.focus();
    return;
  }
  obToggleError('obPhoneError', 'obPhone', false);

  const wrap = obEl('obOtpWrap');
  if (wrap) wrap.classList.remove('hidden');
  const target = obEl('obOtpTarget');
  if (target) target.textContent = 'xxxxx x' + digits.slice(6);
  obOtpBoxes().forEach(b => { b.value = ''; });
  obOtpMetaVisible(true);
  obStartResendTimer();
  setTimeout(() => { try { obOtpBoxes()[0]?.focus(); } catch (e) { } }, 60);
}

/* ── GST step behaviour ──────────────────────────────────── */
function obPopulateStates(sel, selected) {
  if (!sel) return;
  if (!sel.dataset.obStatesReady) {
    sel.innerHTML = '<option value="">Select state</option>' +
      GST_STATES.map(s => `<option value="${s[1]}">${s[1]}</option>`).join('');
    sel.dataset.obStatesReady = '1';
  }
  const hit = gstStateFromName(selected);
  sel.value = hit ? hit.name : '';
}

function obGstinValid() {
  return obVal('obGstin').toUpperCase().length === 15;
}

function obApplyGstMode() {
  const gst = obChecked('obGst');
  const yes = gst === 'yes';
  const valid = yes && obGstinValid();

  const section = obEl('obGstSection');
  if (section) section.classList.toggle('hidden', !yes);

  const prompt = obEl('obGstPrompt');
  if (prompt) prompt.classList.toggle('is-hidden', valid);

  const extra = obEl('obGstExtra');
  if (extra) extra.classList.toggle('hidden', !valid);

  const status = obEl('obGstStatus');
  if (status) status.classList.toggle('is-valid', valid);

  const hint = obEl('obGstinHint');
  if (hint) hint.classList.toggle('hidden', valid);
}

/* ── Signup → verify email → step 1 ──────────────────────── */
function obContinueWithEmail() {
  const emailOk = obEmailValid();
  obToggleError('obEmailError', 'obEmail', !emailOk);
  if (!emailOk) { obEl('obEmail')?.focus(); return; }

  const phoneOk = obPhoneDigits().length === 10;
  obToggleError('obPhoneError', 'obPhone', !phoneOk);
  if (!phoneOk) { obEl('obPhone')?.focus(); return; }

  // Phone not verified yet → sending the OTP is the next action this tap does.
  if (!obPhoneVerified) {
    const wrap = obEl('obOtpWrap');
    if (!wrap || wrap.classList.contains('hidden')) {
      obStartOtp();
      toast('We sent a 6-digit code to your phone', 'info');
    } else {
      const boxes = obOtpBoxes();
      (boxes.find(b => !b.value) || boxes[0])?.focus();
      toast('Enter the 6-digit code to verify your phone', 'info');
    }
    obSaveDraft();
    return;
  }

  obSaveDraft();

  const addr = obEl('obVerifyEmailAddr');
  if (addr) addr.textContent = obVal('obEmail');
  obShow('verify');
}

function obResendEmail() {
  const email = obVal('obEmail') || 'your email';
  toast(`Verification email sent again to ${email}`, 'info');
}

function obEmailVerified() {
  obSaveDraft();
  obShow('step1');
}

function obChangeEmail() {
  obShow('signup');
  setTimeout(() => { try { obEl('obEmail')?.focus({ preventScroll: true }); } catch (e) { } }, 80);
}

/* ── Plan selection (step 4) ────────────────────────────────── */
function obRenderPlanGrid() {
  const grid = obEl('obPlanGrid');
  if (!grid) return;
  grid.innerHTML = Object.values(OB_PLANS).map(p => {
    const selected = obSelectedPlan === p.id;
    const monthly = p.price.monthly === 0 ? 'Free' : `₹${p.price.monthly}/mo`;
    const yearly = p.price.yearly === 0 ? '' : ` / yr ₹${p.price.yearly}`;
    const lim = p.limits;
    const bills = lim.billsPerMonth == null ? 'Unlimited' : `${lim.billsPerMonth} bills/mo`;
    const products = lim.products == null ? 'Unlimited' : `${lim.products} products`;
    const devices = lim.devices == null ? 'Unlimited' : `${lim.devices} devices`;
    const wm = p.watermark ? 'Receipt watermark' : 'No receipt watermark';

    return `
      <div class="ob-plan-card${selected ? ' is-selected' : ''}" role="radio" aria-checked="${selected}" tabindex="0" data-plan="${p.id}">
        <div class="ob-plan-radio"></div>
        <div class="ob-plan-header">
          <div class="ob-plan-name">${p.name}</div>
          <div class="ob-plan-badge">${p.badge}</div>
        </div>
        <div class="ob-plan-price">${monthly}${yearly}</div>
        <div class="ob-plan-tagline">${p.tagline || ''}</div>
        <ul class="ob-plan-features">
          ${(p.highlights || []).map(h => `<li>${h}</li>`).join('')}
        </ul>
        <div class="ob-plan-limits-note">${bills} · ${products} · ${devices} · ${wm}</div>
      </div>`;
    }).join('');
}

function obUpdatePlanNote() {
  const p = OB_PLANS[obSelectedPlan];
  if (!p) return;
  const badge = obEl('obPlanBadge');
  const price = obEl('obPlanPrice');
  const limits = obEl('obPlanLimits');
  const cont = obEl('obPlanContinue');
  if (badge) badge.textContent = p.name;
  if (price) price.textContent = p.price.monthly === 0 ? 'Free forever' : `₹${p.price.monthly}/mo`;
  if (limits) {
    const lim = p.limits;
    const bills = lim.billsPerMonth == null ? 'Unlimited bills' : `${lim.billsPerMonth} bills/month`;
    const prods = lim.products == null ? 'Unlimited products' : `${lim.products} products`;
    limits.textContent = `${bills} · ${prods}`;
  }
  if (cont) cont.disabled = false; // always enabled once a plan is selected (default free)
}

function obSelectPlan(planId) {
  if (!OB_PLANS[planId]) return;
  obSelectedPlan = planId;
  obRenderPlanGrid();
  obUpdatePlanNote();
  obSaveDraft();
}

/* ── Apply plan settings to POS config ───────────────────────── */
function obApplyPlanSettings(settings, planId) {
  const p = OB_PLANS[planId];
  if (!p) return settings;
  const lim = p.limits;
  return Object.assign({}, settings, {
    saasPlan: planId,
    saasPlanLimits: {
      billsPerMonth: lim.billsPerMonth,
      products: lim.products,
      devices: lim.devices
    },
    saasPlanWatermark: p.watermark,
    defaultTax: settings.defaultTax || 0
  });
}

/* ── Completion ──────────────────────────────────────────── */
function obFinishAndOpenPos(skippedTax) {
  const d = obCollectDraft();
  const prevPos = getPosSettings();
  const prevProf = getUserProfile();

  const firstType = d.businessTypes[0] || '';
  const typeMap = {
    'Retail': 'Retail store',
    'Wholesale': 'Other',
    'Distributor': 'Other',
    'E-Commerce': 'Other',
    'Trader': 'Other',
    'Other': 'Other'
  };
  const storeName = d.legalName || (firstType ? `${firstType} Store` : prevPos.storeName || 'Hisaab POS');
  const address = [d.businessAddress, d.city, d.pincode].filter(Boolean).join(', ');
  const gstRegistered = d.gst === 'yes' && !!d.gstin;

  const settings = Object.assign({}, prevPos, {
    storeName,
    businessType: typeMap[firstType] || prevPos.businessType || 'Retail store',
    businessTypes: d.businessTypes.slice(),
    storePhone: d.phone,
    storeEmail: d.email,
    gstin: gstRegistered ? d.gstin : '',
    state: d.gstState || d.addressState || '',
    storeAddress: address,
    defaultTax: skippedTax || d.taxBilling === 'skip' ? 0 : prevPos.defaultTax,
    receiptFooter: prevPos.receiptFooter || 'Thank you for shopping!'
  });
  const planSettings = obApplyPlanSettings(settings, d.plan || obSelectedPlan || 'free');
  applyPosSettings(planSettings);

  const profile = Object.assign({}, prevProf, {
    name: d.fullName || prevProf.name,
    email: d.email || prevProf.email,
    phone: d.phone || prevProf.phone
  });

  applyUserProfile(profile);
  DB.set('onboardingProfile', {
    locations: d.locations,
    posUse: d.posUse,
    taxBilling: skippedTax ? 'skip' : d.taxBilling,
    teamSize: d.teamSize
  });

  DB.set('onboardingDone', true);
  DB.remove('onboardingDraft');
  obDraft = null;
  obPhoneVerified = false;
  obStopResendTimer();

  closeOnboarding();
  document.body.classList.remove('landing-active');
  document.body.classList.remove('ob-open');
  // Force-hide landing and show POS
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const posView = document.getElementById('view-pos');
  if (posView) posView.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === 'pos'));
  setDate();
  if (typeof renderCartTotals === 'function') renderCartTotals();
  if (typeof renderPosCatalog === 'function') renderPosCatalog();
  toast('Setup complete — welcome to Hisaab!', 'success');
}

function obSignIn() {
  const id = obVal('obLoginId');
  const pw = obEl('obLoginPassword')?.value || '';

  obToggleError('obLoginIdError', 'obLoginId', !id);
  obToggleError('obLoginPasswordError', 'obLoginPassword', !pw);
  if (!id) { obEl('obLoginId')?.focus(); return; }
  if (!pw) { obEl('obLoginPassword')?.focus(); return; }

  const looksLikeEmail = id.includes('@');
  applyUserProfile(Object.assign({}, getUserProfile(), looksLikeEmail ? { email: id } : { phone: id }));

  DB.set('onboardingDone', true);
  DB.remove('onboardingDraft');
  obDraft = null;
  obStopResendTimer();
  closeOnboarding();
  // Ensure landing-page styling is fully cleared before opening POS
  document.body.classList.remove('landing-active');
  document.body.classList.remove('ob-open');
  // Force-hide landing and show POS (belt-and-suspenders)
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const posView = document.getElementById('view-pos');
  if (posView) posView.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === 'pos'));
  setDate();
  if (typeof renderPosCatalog === 'function') renderPosCatalog();
  toast('Welcome back!', 'success');
}

/* ── Open / close ────────────────────────────────────────── */
function openOnboarding(startScreen) {
  // If Supabase cloud is configured, open the cloud auth gate instead of the
  // local first-run onboarding. The landing page stays visible behind it.
  if (window.HisaabCloud && typeof window.HisaabCloud.isConfigured === 'function' &&
      window.HisaabCloud.isConfigured()) {
    if (typeof window.HisaabCloud.openGate === 'function') {
      window.HisaabCloud.openGate();
    }
    return;
  }

  const overlay = obEl('onboardingScreen');
  if (!overlay) return;

  if (!obDraft) {
    const saved = DB.get('onboardingDraft');
    obDraft = (saved && typeof saved === 'object') ? saved : {};
  }
  const d = obDraft || {};
  const prof = getUserProfile();
  const fmtPhone = (v) => {
    const digits = String(v || '').replace(/\D/g, '').slice(0, 10);
    return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  };

  obSet('obEmail', d.email || prof.email || '');
  obSet('obPhone', fmtPhone(d.phone || prof.phone || ''));
  obSet('obFullName', d.fullName || '');
  obSet('obStepPassword', '');
  obSet('obStepConfirm', '');
  obSet('obGstin', d.gstin || '');
  obSet('obLegalName', d.legalName || '');
  obSet('obGstType', d.gstType || 'Regular');
  obSet('obBusinessAddress', d.businessAddress || '');
  obSet('obCity', d.city || '');
  obSet('obPinCode', d.pincode || '');

  obPopulateStates(obEl('obGstState'), d.gstState || '');
  obPopulateStates(obEl('obAddressState'), d.addressState || '');

  obSetRadio('obGst', d.gst || '');
  obSetRadio('obLocations', d.locations || '');
  obSetRadio('obPosUse', d.posUse || '');
  obSetRadio('obTaxBilling', d.taxBilling || '');

  obBusinessTypes = Array.isArray(d.businessTypes) ? d.businessTypes.slice() : [];
  obTeamSize = d.teamSize || '';
  obSelectedPlan = d.plan || 'free';
  obRenderBusinessPills();
  obRenderTeamPills();

  obPhoneVerified = !!d.phoneVerified;
  obOtpBoxes().forEach(b => { b.value = ''; });
  const wrap = obEl('obOtpWrap');
  if (wrap) wrap.classList.add('hidden');
  obOtpMetaVisible(true);
  obStopResendTimer();
  obResendLeft = 0;
  obRenderResend();
  obSyncPhoneUi();

  obSet('obLoginId', d.email || prof.email || '');
  obSet('obLoginPassword', '');

  document.querySelectorAll('.ob-error.is-visible').forEach(e => e.classList.remove('is-visible'));
  document.querySelectorAll('.has-error').forEach(e => e.classList.remove('has-error'));

  overlay.classList.remove('hidden');
  document.body.classList.add('ob-open');
  document.documentElement.classList.remove('needs-onboarding');

  const resume = d.screen && /^(step[123]|plan)$/.test(d.screen);
  obShow(resume ? d.screen : (startScreen || 'signin'));
  obShowSlide(0);
  obStartCarousel();
}

function closeOnboarding() {
  const overlay = obEl('onboardingScreen');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('ob-open');
  document.body.classList.remove('landing-active');
  document.documentElement.classList.remove('needs-onboarding');
  obStopResendTimer();
  obStopCarousel();
  obSet('obStepPassword', '');
  obSet('obStepConfirm', '');
  obSet('obLoginPassword', '');
}

/* ── Business-type + team pills ──────────────────────────── */
function obRenderBusinessPills() {
  document.querySelectorAll('#obBusinessTypePills .ob-pill').forEach(pill => {
    pill.classList.toggle('is-selected', obBusinessTypes.includes(pill.dataset.value));
  });
}

function obRenderTeamPills() {
  document.querySelectorAll('#obTeamPills .ob-pill').forEach(pill => {
    pill.classList.toggle('is-selected', pill.dataset.value === obTeamSize);
  });
}

/* ── Wiring ──────────────────────────────────────────────── */
function setupOnboarding() {
  const overlay = obEl('onboardingScreen');
  if (!overlay) {
    document.documentElement.classList.remove('needs-onboarding');
    return;
  }

  obPopulateStates(obEl('obGstState'), '');
  obPopulateStates(obEl('obAddressState'), '');
  obSetupOtpInputs();

  // Pause the right-panel carousel while the app is in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) obStopCarousel();
    else if (overlay && !overlay.classList.contains('hidden')) obStartCarousel();
  });

  const errorMap = {
    obEmail: 'obEmailError',
    obPhone: 'obPhoneError',
    obFullName: 'obFullNameError',
    obStepPassword: 'obStepPasswordError',
    obStepConfirm: 'obStepConfirmError',
    obGstin: 'obGstinError',
    obBusinessAddress: 'obBusinessAddressError',
    obLoginId: 'obLoginIdError',
    obLoginPassword: 'obLoginPasswordError'
  };

  // Any edit updates the draft + button states, and clears that field's error.
  overlay.addEventListener('input', (e) => {
    obSaveDraft();
    const id = e.target && e.target.id;
    if (id && errorMap[id]) obToggleError(errorMap[id], id, false);
    obRefreshButtons();
  });
  overlay.addEventListener('change', () => {
    obSaveDraft();
    obRefreshButtons();
  });

  // Phone: digits only, grouped like 98745 25142
  obEl('obPhone')?.addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    e.target.value = digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
    if (obPhoneVerified) obResetPhoneVerification();
  });

  // PIN: digits only
  obEl('obPinCode')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  // GSTIN: uppercase, 15 chars; reveal Active + address block
  obEl('obGstin')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
    obApplyGstMode();
    obToggleError('obGstinError', 'obGstin', false);
  });

  obEl('obVerifyPhoneBtn')?.addEventListener('click', obStartOtp);

  obEl('obResendBtn')?.addEventListener('click', () => {    if (obResendLeft > 0) return;
    obOtpBoxes().forEach(b => { b.value = ''; });
    obOtpMetaVisible(true);
    obStartResendTimer();
    toast('A new code was sent (demo: enter any 6 digits)', 'info');
    try { obOtpBoxes()[0]?.focus(); } catch (e) { }
  });

  obEl('obContinueEmailBtn')?.addEventListener('click', obContinueWithEmail);
  obEl('obResendEmailBtn')?.addEventListener('click', obResendEmail);
  obEl('obEmailVerifiedBtn')?.addEventListener('click', obEmailVerified);
  obEl('obVerifyChangeEmail')?.addEventListener('click', obChangeEmail);

  obEl('obLoginLink')?.addEventListener('click', () => {
    const prof = getUserProfile();
    obSet('obLoginId', obVal('obEmail') || (obDraft && obDraft.email) || prof.email || '');
    obShow('signin');
  });
  obEl('obSignupLink')?.addEventListener('click', () => obShow('signup'));
  obEl('obSignInBtn')?.addEventListener('click', obSignIn);
  obEl('obForgotBtn')?.addEventListener('click', () => {
    toast('Hisaab runs locally on this device — no password reset needed.', 'info');
  });

  obEl('obLoginEye')?.addEventListener('click', () => obTogglePassword('obLoginPassword', 'obLoginEye'));
  obEl('obStepEye1')?.addEventListener('click', () => obTogglePassword('obStepPassword', 'obStepEye1'));
  obEl('obStepEye2')?.addEventListener('click', () => obTogglePassword('obStepConfirm', 'obStepEye2'));

  obEl('obGoogleBtn')?.addEventListener('click', () => {
    toast('Google sign-in is not connected in this demo — use email instead.', 'info');
  });
  obEl('obGoogleSigninBtn')?.addEventListener('click', () => {
    toast('Google sign-in is not connected in this demo — use email instead.', 'info');
  });

  obEl('obTermsLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    toast('Terms & Service — available in the full Hisaab app.', 'info');
  });
  obEl('obPrivacyLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    toast('Privacy Policy — your data stays on this device.', 'info');
  });
  document.querySelectorAll('.ob-terms-link, .ob-privacy-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      toast(link.classList.contains('ob-terms-link') ? 'Terms & Service — available in the full Hisaab app.' : 'Privacy Policy — your data stays on this device.', 'info');
    });
  });

  obEl('obLogoLink')?.addEventListener('click', (e) => e.preventDefault());

  // Business type pills (multi-select)
  obEl('obBusinessTypePills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.ob-pill');
    if (!pill) return;
    const value = pill.dataset.value;
    const idx = obBusinessTypes.indexOf(value);
    if (idx >= 0) obBusinessTypes.splice(idx, 1);
    else obBusinessTypes.push(value);
    obRenderBusinessPills();
    obSaveDraft();
  });

  // Team size pills (single-select)
  obEl('obTeamPills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.ob-pill');
    if (!pill) return;
    obTeamSize = obTeamSize === pill.dataset.value ? '' : pill.dataset.value;
    obRenderTeamPills();
    obSaveDraft();
  });

  // Step 1
  obEl('obStep1Continue')?.addEventListener('click', () => {
    const nameOk = !!obVal('obFullName');
    const pw = obEl('obStepPassword')?.value || '';
    const confirm = obEl('obStepConfirm')?.value || '';
    obToggleError('obFullNameError', 'obFullName', !nameOk);
    obToggleError('obStepPasswordError', 'obStepPassword', !(pw.length >= 8));
    obToggleError('obStepConfirmError', 'obStepConfirm', !(pw && confirm === pw));
    if (!nameOk) { obEl('obFullName')?.focus(); return; }
    if (pw.length < 8) { obEl('obStepPassword')?.focus(); return; }
    if (confirm !== pw) { obEl('obStepConfirm')?.focus(); return; }

    obSet('obStepPassword', '');
    obSet('obStepConfirm', '');
    obSaveDraft();
    obShow('step2');
  });

  // Step 2
  document.querySelectorAll('input[name="obGst"]').forEach(radio => {
    radio.addEventListener('change', () => {
      obApplyGstMode();
      obSaveDraft();
      obRefreshButtons();
    });
  });

  obEl('obStep2Continue')?.addEventListener('click', () => {
    const gst = obChecked('obGst');
    if (!gst) return;
    if (gst === 'yes') {
      if (!obGstinValid()) {
        obToggleError('obGstinError', 'obGstin', true);
        obEl('obGstin')?.focus();
        return;
      }
      if (!obVal('obBusinessAddress')) {
        obToggleError('obBusinessAddressError', 'obBusinessAddress', true);
        obEl('obBusinessAddress')?.focus();
        return;
      }
    }
    obSaveDraft();
    obShow('step3');
  });

  // Step 3 → go to plan selection
  obEl('obStep3Skip')?.addEventListener('click', () => { obSelectPlan('free'); obShow('plan'); });
  obEl('obStep3Continue')?.addEventListener('click', () => {
    if (!obChecked('obTaxBilling')) obSetRadio('obTaxBilling', 'skip');
    obShow('plan');
  });

  // Plan → back to step3
  obEl('obPlanBack')?.addEventListener('click', () => obShow('step3'));

  // Plan → finish
  obEl('obPlanContinue')?.addEventListener('click', () => {
    if (!obChecked('obTaxBilling')) obSetRadio('obTaxBilling', 'skip');
    obFinishAndOpenPos(false);
  });

  // Plan card click (keyboard + click)
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.ob-plan-card[data-plan]');
    if (card) {
      e.preventDefault();
      obSelectPlan(card.dataset.plan);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.ob-plan-card[data-plan]');
    if (card) {
      e.preventDefault();
      obSelectPlan(card.dataset.plan);
    }
  });

  // Enter to advance (except in textareas)
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target || e.target.tagName === 'TEXTAREA') return;
    if (e.target.closest('#obOtpBoxes')) return;
    e.preventDefault();
    if (obScreen === 'signup') {
      if (!obEl('obContinueEmailBtn')?.disabled) obContinueWithEmail();
    } else if (obScreen === 'signin') {
      obSignIn();
    } else if (obScreen === 'step1') {
      if (!obEl('obStep1Continue')?.disabled) obEl('obStep1Continue').click();
    } else if (obScreen === 'step2') {
      if (!obEl('obStep2Continue')?.disabled) obEl('obStep2Continue').click();
    } else if (obScreen === 'step3') {
      obEl('obStep3Continue')?.click();
    } else if (obScreen === 'plan') {
      obEl('obPlanContinue')?.click();
    }
  });

  // Restart from Settings → POS Settings
  obEl('stgRestartOnboardingBtn')?.addEventListener('click', () => {
    obDraft = null;
    obPhoneVerified = false;
    DB.remove('onboardingDraft');
    openOnboarding('signup');
  });

  // Landing page buttons → open onboarding (sign in / new user)
  const goSignIn = () => { document.body.classList.remove('landing-active'); openOnboarding('signin'); };
  const goNewUser = () => { document.body.classList.remove('landing-active'); openOnboarding('signup'); };
  els('lpSignInBtn')?.addEventListener('click', goSignIn);
  els('lpSignInHeroBtn')?.addEventListener('click', goSignIn);
  els('lpFooterSignInBtn')?.addEventListener('click', goSignIn);
  els('lpNewUserBtn')?.addEventListener('click', goNewUser);
  els('lpGetStartedBtn')?.addEventListener('click', goNewUser);

  const done = !!DB.get('onboardingDone');
  if (done) {
    closeOnboarding();
    switchToView('pos');
  } else {
    switchToView('landing');
    document.body.classList.add('landing-active');
  }
}

function obTogglePassword(inputId, buttonId) {
  const input = obEl(inputId);
  const eye = obEl(buttonId);
  if (!input || !eye) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const showIcon = eye.querySelector('.ob-eye-show');
  const hideIcon = eye.querySelector('.ob-eye-hide');
  if (showIcon) showIcon.style.display = show ? 'none' : '';
  if (hideIcon) hideIcon.style.display = show ? '' : 'none';
  eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

// ─── CREATE MASTER (topbar dropdown) ──────────────────────────
function setupCreateMaster() {
  const btn = document.getElementById('createBtn');
  const menu = document.getElementById('cmasterMenu');
  if (!btn || !menu) return;

  const positionMenu = () => {
    const br = btn.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const margin = 8;
    const gap = 8;

    menu.style.position = 'fixed';
    menu.style.zIndex = '1200';
    menu.style.opacity = '1';
    menu.style.animation = 'none';
    menu.style.transform = 'none';
    menu.style.visibility = 'visible';

    // Measure menu at its natural width/height constraints.
    const mr = menu.getBoundingClientRect();
    const menuW = Math.min(mr.width || 280, vw - margin * 2);

    let left = br.right - menuW;
    if (left < margin) left = margin;
    if (left + menuW > vw - margin) left = Math.max(margin, vw - margin - menuW);

    let top = br.bottom + gap;
    const spaceBelow = vh - top - margin;
    const spaceAbove = br.top - gap - margin;
    let maxH = Math.min(420, Math.max(160, spaceBelow));

    // If not enough space below, open above the button.
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      maxH = Math.min(420, Math.max(160, spaceAbove));
      // Temporarily set maxHeight to compute height for upward placement.
      menu.style.maxHeight = maxH + 'px';
      const h = menu.getBoundingClientRect().height || Math.min(mr.height || 200, maxH);
      top = Math.max(margin, br.top - gap - h);
    }

    menu.style.left = left + 'px';
    menu.style.right = 'auto';
    menu.style.top = top + 'px';
    menu.style.bottom = 'auto';
    menu.style.maxHeight = maxH + 'px';
  };

  const onViewportChange = () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  };

  const open = () => {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    positionMenu();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
  };
  const close = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    menu.style.position = '';
    menu.style.left = '';
    menu.style.right = '';
    menu.style.top = '';
    menu.style.bottom = '';
    menu.style.maxHeight = '';
    menu.style.zIndex = '';
    menu.style.opacity = '';
    menu.style.animation = '';
    menu.style.transform = '';
    menu.style.visibility = '';
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
  };
  const toggle = (e) => { e && e.stopPropagation(); menu.classList.contains('hidden') ? open() : close(); };

  btn.addEventListener('click', toggle);

  menu.querySelectorAll('.cmaster-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.cmaster;
      close();
      if (action === 'product') {
        // Add Products
        if (typeof openAddProductPage === 'function') openAddProductPage();
        else switchToView('inventory');
      } else if (action === 'customer') {
        // Customer
        if (typeof openQuickAddCustomer === 'function') openQuickAddCustomer(null);
        else switchToView('customers');
      } else if (action === 'damage') {
        switchToView('damage');
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

// Mobile phones only: collapse page headers + KPI cards while scrolling.
// Table/list pages reveal the bars only when scrolled back to the top so
// mid-list reading is never interrupted. The Home (POS) page also slides the
// app top bar away and brings it back on an upward scroll, like a native app.
function setupMobileScrollHideBars() {
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
  const HIDE_AFTER = 24; // px of downward travel before collapsing
  const SHOW_AFTER = 28; // px of upward travel before revealing on Home
  const TOP_SHOW = 6;    // px from the top where the bars always return

  const barSelector = '.view-header, .inventory-stats, .sales-stats, .cart-header';
  const hiddenViews = new WeakMap(); // view -> boolean
  const scrollState = new WeakMap(); // scroller -> { lastY, downAcc, upAcc }

  function barsOf(view) {
    return view ? view.querySelectorAll(barSelector) : [];
  }

  function applyBars(view, hidden) {
    if (!view) return;
    barsOf(view).forEach(el => {
      if (el._mobileBarTimer) { clearTimeout(el._mobileBarTimer); el._mobileBarTimer = null; }
      if (hidden) {
        if (el.classList.contains('mobile-bars-hidden')) return;
        el.style.maxHeight = '';
        el.classList.add('mobile-bars-hidden');
      } else {
        if (!el.classList.contains('mobile-bars-hidden')) {
          el.style.maxHeight = '';
          return;
        }
        el.classList.remove('mobile-bars-hidden');
        el.style.maxHeight = '';
        el.dataset.mobileBarHeight = '';
      }
    });
  }

  function applyForView(view, hidden) {
    if (!view) return;
    const isPos = view.id === 'view-pos';
    // Only the POS view uses scroll-hide chrome behavior on mobile.
    // Other list/data views use natural whole-view scrolling.
    applyBars(view, isPos ? hidden : false);
    document.body.classList.toggle('pos-scroll-hidden', !!hidden && isPos);
    hiddenViews.set(view, !!(isPos && hidden));
  }

  // Find the scroll offset that matters for a view (POS has several panels)
  function viewScrollTop(view) {
    if (!view) return 0;
    let y = 0;
    if (view.id === 'view-pos') {
      view.querySelectorAll('.pos-catalog, .pos-catalog-grid, .table-wrapper, .right-panel-scroll').forEach(s => {
        if (s.offsetParent === null) return; // hidden panel/tab
        y = Math.max(y, s.scrollTop || 0);
      });
    } else {
      y = Math.max(view.scrollTop || 0, 0);
    }
    return y;
  }

  function syncView(view) {
    if (!view) return;
    if (view.id !== 'view-pos') {
      applyForView(view, false);
      return;
    }
    const shouldHide = isMobile() && viewScrollTop(view) > TOP_SHOW;
    applyForView(view, shouldHide);
  }

  function handleScroll(scroller) {
    if (!isMobile()) return;
    if (!(scroller instanceof Element)) return;

    const view = scroller.closest('.view');
    if (!view) return;
    const isPos = view.id === 'view-pos';

    // List/data views: natural scroll (no bar-collapsing behavior)
    if (!isPos) {
      applyForView(view, false);
      return;
    }

    if (!scroller.classList.contains('table-wrapper') && !scroller.classList.contains('scrollable') &&
        !scroller.classList.contains('pos-catalog') && !scroller.classList.contains('pos-catalog-grid') &&
        !scroller.classList.contains('right-panel-scroll')) {
      return;
    }

    const style = getComputedStyle(scroller);
    if (!/(auto|scroll)/.test(style.overflowY)) return;

    const y = scroller.scrollTop;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;

    let st = scrollState.get(scroller);
    if (!st) { st = { lastY: y, downAcc: 0, upAcc: 0 }; scrollState.set(scroller, st); }

    // Back at the very top (or nothing to scroll): the bars always return
    if (y <= TOP_SHOW || maxScroll <= 0) {
      st.lastY = y;
      st.downAcc = 0;
      st.upAcc = 0;
      if (hiddenViews.get(view)) applyForView(view, false);
      return;
    }

    const dy = y - st.lastY;
    st.lastY = y;

    if (dy > 0) {
      st.downAcc += dy;
      st.upAcc = 0;
      if (!hiddenViews.get(view) && st.downAcc >= HIDE_AFTER) applyForView(view, true);
    } else if (dy < 0) {
      st.downAcc = 0;
      // Home behaves like a native app: a real upward scroll reveals the bar
      st.upAcc -= dy;
      if (hiddenViews.get(view) && st.upAcc >= SHOW_AFTER) applyForView(view, false);
    }
  }

  // rAF-throttled capture listener for scroll events on inner containers
  let ticking = false;
  document.addEventListener('scroll', e => {
    const target = e.target;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      handleScroll(target);
    });
  }, { capture: true, passive: true });

  function resetAllBars() {
    document.body.classList.remove('pos-scroll-hidden');
    document.querySelectorAll('.mobile-bars-hidden').forEach(el => el.classList.remove('mobile-bars-hidden'));
    document.querySelectorAll(barSelector).forEach(el => {
      el.style.maxHeight = '';
      el.dataset.mobileBarHeight = '';
      if (el._mobileBarTimer) { clearTimeout(el._mobileBarTimer); el._mobileBarTimer = null; }
    });
  }

  // Desktop/tablet: make sure nothing stays collapsed or shifted
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      resetAllBars();
    } else {
      const active = document.querySelector('.view.active');
      if (active) syncView(active);
    }
  });

  // When a view becomes active, match the bars to that view's scroll position
  const obs = new MutationObserver(mutations => {
    if (!isMobile()) return;
    mutations.forEach(m => {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const el = m.target;
        if (el.classList && el.classList.contains('view') && el.classList.contains('active')) {
          syncView(el);
        }
      }
    });
  });
  document.querySelectorAll('.view').forEach(v => obs.observe(v, { attributes: true, attributeFilter: ['class'] }));
}

// ─── BOOTSTRAP ───────────────────────────────────────────────
function init() {
  initialRouteView = getViewFromHash();
  setDate();
  applyUserProfile(getUserProfile(), true);
  setupSearch();
  setupPosProductSearch();
  setupPosCatalog();
  setupCustomer();
  setupQuickAddCustomer();
  setupSettings();
  setupOnboarding();
  setupCreateMaster();
  setupPaymentMethods();
  setupNotifications();
  setupUsageAlert();
  setupNav();
  setupMoreMenu();
  // Points & Rewards: normalize stored configs and backfill referral codes.
  try { ensureRewardConfigs(); } catch (e) {}
  try { ensureAllReferralCodes(); } catch (e) {}
  try { renderPosRewardsPanel(); } catch (e) {}
  setupStockTimeline();
  setupHelpTutorials();
  setupSalesFilters();
  els('closeProductDetail')?.addEventListener('click', () => hideModal('productDetailModal'));
  els('closeProductDetailBtn')?.addEventListener('click', () => hideModal('productDetailModal'));
  setupMobileScrollHideBars();

  // Start with clean walk-in customer (no prefilled customer)
  selectedCustomer = null;
  els('customerPhone').value = '';
  els('customerCard').classList.add('hidden');
  els('noCustomer').classList.remove('hidden');
  hideCustomerNotFound();
  els('clearCustomerBtn')?.classList.add('hidden');

  // Top-level button wires
  els('clearCartBtn').onclick = () => { if (confirm('Clear cart?')) resetCart(); };
  els('checkoutBtn').onclick = openCheckout;
  els('cashDrawerBtn').onclick = openCashDrawer;

  // Sync with Supabase cloud (if config.js is set up) — non-blocking
  CloudSync.pull();
  els('collapsePanel').onclick = () => {
    const qa = document.querySelector('.quick-actions');
    const isCollapsed = qa.classList.toggle('quick-actions-hidden');
    const text = els('collapseStateText');
    const icon = els('collapseArrowIcon');
    if (text) text.textContent = isCollapsed ? 'Expand' : 'Collapse';
    if (icon) {
      icon.innerHTML = isCollapsed
        ? '<path d="m6 9 6 6 6-6" />'
        : '<path d="m18 15-6-6-6 6" />';
    }
  };

  // Shipping/Discount live update
  els('shippingInput').addEventListener('input', renderCartTotals);
  els('discountInput').addEventListener('input', renderCartTotals);

  // Checkout modal
  els('closeCheckout').onclick = () => hideModal('checkoutModal');
  els('confirmPayBtn').onclick = confirmPayment;
  els('closeReceipt').onclick = () => hideModal('receiptModal');
  const applyPrintPageSize = () => {
    const pt = (getPosSettings().printTemplate) || {};
    let st = document.getElementById('printPageSizeStyle');
    if (!st) { st = document.createElement('style'); st.id = 'printPageSizeStyle'; document.head.appendChild(st); }
    st.textContent = pt.paperSize === 'a4'
      ? '@media print { @page { size: A4; margin: 12mm; } }'
      : '@media print { @page { size: 80mm auto; margin: 3mm; } }';
  };
  els('printReceiptBtn').onclick = () => {
    if (window.__lastSale) renderPrintBill(window.__lastSale);
    else { toast('No bill to print', 'error'); return; }
    applyPrintPageSize();
    setTimeout(() => window.print(), 50);
  };
  els('newSaleFromReceiptBtn').onclick = () => { hideModal('receiptModal'); resetCart(); };

  // Add Product (New Full SaaS Workflow)
  els('addProductBtn').onclick = () => openAddProductPage();
  if (els('inventoryBtn')) els('inventoryBtn').onclick = () => switchToView('inventory');

  // Add Product Tabs
  document.querySelectorAll('.ap-tab-btn').forEach(btn => {
    btn.onclick = () => switchAddProductTab(btn.dataset.apTab);
  });

  // Auto SKU and Barcode
  els('apAutoSkuBtn').onclick = () => { els('apSku').value = generateAutoSku(); toast('Generated SKU', 'info'); };
  els('apAutoBarcodeBtn').onclick = () => {
    els('apBarcode').value = generateAutoBarcode();
    updateBarcodeStatus(els('apBarcode').value);
    const badge = els('apBarcodeBadge');
    if (badge) { badge.textContent = 'Auto'; badge.style.display = 'inline-block'; }
    toast('Generated Barcode', 'info');
  };

  // Barcode input typing feedback & Enter key
  const barcodeInp = els('apBarcode');
  if (barcodeInp) {
    barcodeInp.oninput = () => {
      updateBarcodeStatus(barcodeInp.value.trim());
      const badge = els('apBarcodeBadge');
      if (badge) badge.style.display = 'none';
    };
    barcodeInp.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const code = barcodeInp.value.trim();
        if (code) setProductBarcode(code);
      }
    };
  }

  // Barcode Scan Button (Add Product Page) -> opens Camera Barcode Scanner Modal for Add Product
  const scanBtn = els('apScanBarcodeBtn');
  if (scanBtn) scanBtn.onclick = () => openScanBarcodeModal('add-product');

  // POS Sale Barcode Scanner Button (in Cart Header)
  const posScanBtn = els('posScanBarcodeBtn');
  if (posScanBtn) {
    posScanBtn.onclick = (e) => {
      e.preventDefault();
      openScanBarcodeModal('pos');
    };
  }

  // Search Barcode Scanner Button (in Topbar Search)
  const searchScanBtn = els('searchScanBarcodeBtn');
  if (searchScanBtn) {
    searchScanBtn.onclick = (e) => {
      e.preventDefault();
      openScanBarcodeModal('pos');
    };
  }

  // Camera Barcode Scanner Modal bindings
  if (els('closeScanBarcodeModal')) els('closeScanBarcodeModal').onclick = closeScanBarcodeModal;
  if (els('tabSnapPhotoBtn')) els('tabSnapPhotoBtn').onclick = () => switchScannerMode('snap');
  if (els('tabLiveVideoBtn')) els('tabLiveVideoBtn').onclick = () => switchScannerMode('live');
  if (els('camSnapActionBtn')) els('camSnapActionBtn').onclick = () => els('camSnapInput')?.click();
  if (els('camLiveSnapFallbackBtn')) {
    els('camLiveSnapFallbackBtn').onclick = () => {
      switchScannerMode('snap');
      setTimeout(() => els('camSnapInput')?.click(), 60);
    };
  }
  if (els('camErrorSwitchSnapBtn')) {
    els('camErrorSwitchSnapBtn').onclick = () => {
      switchScannerMode('snap');
      setTimeout(() => els('camSnapInput')?.click(), 60);
    };
  }
  if (els('camUploadGalleryBtn')) els('camUploadGalleryBtn').onclick = () => els('camFileInput')?.click();
  if (els('camSnapInput')) {
    els('camSnapInput').onchange = (e) => {
      if (e.target.files && e.target.files[0]) handleCapturedBarcodeFile(e.target.files[0]);
    };
  }
  if (els('camFileInput')) {
    els('camFileInput').onchange = (e) => {
      if (e.target.files && e.target.files[0]) handleCapturedBarcodeFile(e.target.files[0]);
    };
  }
  if (els('camSelect')) els('camSelect').onchange = () => startCameraScanner(els('camSelect').value);
  if (els('camTorchBtn')) els('camTorchBtn').onclick = toggleCameraTorch;
  if (els('camRetryBtn')) els('camRetryBtn').onclick = () => startCameraScanner(els('camSelect')?.value);
  if (els('camOpenMobileBtn')) {
    els('camOpenMobileBtn').onclick = () => {
      closeScanBarcodeModal();
      if (typeof window.openPairingModal === 'function') window.openPairingModal();
    };
  }
  if (els('camManualSubmitBtn')) {
    els('camManualSubmitBtn').onclick = () => {
      const v = els('camManualInput')?.value.trim();
      if (v) onCameraBarcodeFound(v);
    };
  }
  if (els('camManualInput')) {
    els('camManualInput').onkeydown = (e) => {
      if (e.key === 'Enter') {
        const v = els('camManualInput')?.value.trim();
        if (v) onCameraBarcodeFound(v);
      }
    };
  }

  // Inventory Search Input & Clear Button
  const invSearch = els('inventorySearchInput');
  if (invSearch) {
    invSearch.oninput = () => renderInventory();
    invSearch.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const val = invSearch.value.trim().toLowerCase();
        if (val) {
          const match = products.find(p => (p.barcode && p.barcode.toLowerCase() === val) || (p.sku && p.sku.toLowerCase() === val));
          if (match) {
            toast(`Found product: ${match.name}`, 'success');
          }
        }
      }
    };
  }
  const invClear = els('inventorySearchClearBtn');
  if (invClear) {
    invClear.onclick = () => {
      if (invSearch) { invSearch.value = ''; renderInventory(); invSearch.focus(); }
    };
  }

  // Stock In / Stock Out modal
  const stockAdjModal = els('stockAdjustModal');
  const closeStockAdjust = () => {
    stockAdjustState = null;
    hideModal('stockAdjustModal');
  };
  els('closeStockAdjustModal')?.addEventListener('click', closeStockAdjust);
  els('closeStockAdjustModalBtn')?.addEventListener('click', closeStockAdjust);
  els('stockAdjustForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveStockAdjust();
  });
  els('stockAdjustVariant')?.addEventListener('change', (e) => {
    if (!stockAdjustState) return;
    stockAdjustState.variantIndex = Number(e.target.value) || 0;
    updateStockAdjustInfo();
  });
  if (stockAdjModal) {
    stockAdjModal.addEventListener('click', (e) => {
      if (e.target === stockAdjModal) closeStockAdjust();
    });
  }

  // Categories & Subcategories search
  const catSubSearch = els('catSubSearchInput');
  if (catSubSearch) {
    catSubSearch.oninput = () => renderCategoriesSubcategories();
    catSubSearch.onkeydown = (e) => { if (e.key === 'Enter') catSubSearch.blur(); };
  }
  const catSubClear = els('catSubSearchClearBtn');
  if (catSubClear) catSubClear.onclick = clearCatSubSearch;

  // Brands search
  const brandSearch = els('brandSearchInput');
  if (brandSearch) {
    brandSearch.oninput = () => renderBrands();
    brandSearch.onkeydown = (e) => { if (e.key === 'Enter') brandSearch.blur(); };
  }
  const brandClear = els('brandSearchClearBtn');
  if (brandClear) brandClear.onclick = clearBrandSearch;

  // Add buttons
  els('addCategoryBtn')?.addEventListener('click', openCategoryModal);
  els('addSubcategoryBtn')?.addEventListener('click', openSubcategoryModal);
  els('addBrandBtn')?.addEventListener('click', openBrandModal);

  // Save buttons
  els('saveCatBtn')?.addEventListener('click', saveCategory);
  els('saveSubcatBtn')?.addEventListener('click', saveSubcategory);
  els('saveBrandBtn')?.addEventListener('click', saveBrand);

  // Close buttons
  els('closeCatModalBtn')?.addEventListener('click', () => hideModal('catModal'));
  els('closeSubcatModalBtn')?.addEventListener('click', () => hideModal('subcatModal'));
  els('closeBrandModalBtn')?.addEventListener('click', () => hideModal('brandModal'));

  // Modal backdrop click to close
  ['catModal', 'subcatModal', 'brandModal'].forEach(modalId => {
    const modal = els(modalId);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) hideModal(modalId);
      });
    }
  });

  // Variants toggle
  els('apHasVariants').onchange = (e) => toggleVariantsDisplay(e.target.checked);
  els('apTaxInclusive')?.addEventListener('change', updateSellingPriceLabel);
  els('apAddAttributeBtn').onclick = addAttributeRow;
  if (els('apCopyVariantPricingBtn')) els('apCopyVariantPricingBtn').onclick = copyFirstVariantPricingToAll;

  // Images Dropzone & input
  const dropzone = els('apImageDropzone');
  const imgInput = els('apImageInput');
  dropzone.onclick = () => imgInput.click();
  imgInput.onchange = (e) => handleImageFiles(e.target.files);
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); };
  dropzone.ondragleave = () => dropzone.classList.remove('drag-over');
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files) handleImageFiles(e.dataTransfer.files);
  };

  // Add Product Footer Actions
  els('apCancelBtn').onclick = () => switchToView('inventory');
  els('apDraftBtn').onclick = () => saveNewProductWorkflow(true);
  els('apSaveBtn').onclick = () => saveNewProductWorkflow(false);
  els('apNextBtn').onclick = () => {
    if (apActiveTab === 'general') switchAddProductTab('pricing');
    else if (apActiveTab === 'pricing') switchAddProductTab('images');
    else saveNewProductWorkflow(false);
  };

  // ─── BULK IMPORT ───────────────────────────────────────────────
  // The button lives on the Inventory page next to "Add product". ONE column
  // schema drives BOTH the Excel template and the importer, so the downloaded
  // sheet and the parser can never drift apart.
  els('bulkImportBtn').onclick = () => {
    hideBulkImportProblems();
    resetBulkImportFile();
    showModal('bulkUploadModal');
  };
  els('closeBulkUpload').onclick = () => hideModal('bulkUploadModal');
  if (els('bulkCsvInput')) {
    els('bulkCsvInput').onchange = () => {
      hideBulkImportProblems();
      const selected = els('bulkCsvInput').files && els('bulkCsvInput').files[0];
      const fileLabel = els('bulkFileName');
      if (fileLabel) fileLabel.textContent = selected ? ('Selected: ' + selected.name) : 'No file selected';
    };
  }
  if (els('bulkZipInput')) {
    els('bulkZipInput').onchange = () => {
      hideBulkImportProblems();
      const selected = els('bulkZipInput').files && els('bulkZipInput').files[0];
      const zipLabel = els('bulkZipName');
      if (zipLabel) zipLabel.textContent = selected ? ('Selected: ' + selected.name) : 'No ZIP selected';
    };
  }

  const BULK_COLUMNS = [
    // Product information
    { key: 'name', header: 'Product Name', required: true, width: 28, group: 'Product Information', example: 'Wireless Mouse', help: 'Name shown to customers on bills and in inventory. Required.' },
    { key: 'description', header: 'Description', width: 36, group: 'Product Information', example: 'Ergonomic 2.4 GHz wireless mouse', help: 'Short description of the product. Optional.' },
    // Category and classification
    { key: 'category', header: 'Category', required: true, width: 20, group: 'Category', example: 'Electronics', help: 'Category name, e.g. Groceries, Fruits & Vegetables, Personal Care, Electronics, Clothing, Furniture or Other. Required.' },
    { key: 'subCategory', header: 'Sub Category', width: 20, group: 'Category', example: 'Computer Accessories', help: 'Optional sub-category, e.g. Tea & Coffee.' },
    { key: 'brand', header: 'Brand', width: 16, group: 'Category', example: 'Logitech', help: 'Brand or manufacturer name. Optional.' },
    // Identification
    { key: 'sku', header: 'SKU', width: 16, group: 'Identification', example: 'SKU-1001', help: 'Your own product code. Must be unique. Leave blank to generate automatically.' },
    { key: 'barcode', header: 'Barcode', width: 18, group: 'Identification', example: '8901234567891', help: 'EAN / UPC barcode printed on the product. Leave blank to generate automatically.' },
    { key: 'hsn', header: 'HSN Code', width: 14, group: 'Identification', example: '84716060', help: 'HSN or SAC code used on GST invoices. Optional.' },
    { key: 'unit', header: 'Unit', width: 12, group: 'Identification', example: 'Pcs', help: 'Selling unit. Choose from: Pcs, Kg, Litre, Box, Pack. Default: Pcs.' },
    { key: 'productImage', header: 'Product Image', width: 22, group: 'Identification', example: 'wireless-mouse.jpg', help: 'Image filename from the uploaded ZIP (e.g. mouse.jpg). You can also name the image file after the product SKU. Optional.' },
    // Pricing
    { key: 'purchasePrice', header: 'Purchase Price', width: 16, group: 'Pricing', example: '350', help: 'Price you pay your supplier (cost price). Optional.' },
    { key: 'price', header: 'Selling Price', required: true, width: 16, group: 'Pricing', example: '599', help: 'Price charged to the customer. Numbers only. Required (for variant products you may use Variant Selling Price instead).' },
    { key: 'mrp', header: 'MRP', width: 14, group: 'Pricing', example: '699', help: 'Maximum retail price printed on the pack. Optional.' },
    { key: 'tax', header: 'Tax %', width: 12, group: 'Pricing', example: '18', help: 'GST rate as a number, e.g. 0, 3, 5, 12, 18, 28 or 40. Default: 18.' },
    { key: 'taxInclusive', header: 'Tax Inclusive', width: 14, group: 'Pricing', example: 'No', help: 'Whether selling price includes tax. Choose Yes or No. Default: No.' },
    { key: 'discount', header: 'Discount', width: 14, group: 'Pricing', example: '0', help: 'Discount value. Use with Discount Type. Optional.' },
    { key: 'discountType', header: 'Discount Type', width: 20, group: 'Pricing', example: 'Percentage (%)', help: 'How the discount is applied: Percentage (%) or Rupees (₹). Default: Percentage (%).' },
    // Stock details
    { key: 'stock', header: 'Opening Stock', width: 16, group: 'Stock Details', example: '50', help: 'Quantity available right now. Leave blank for 0. For variant products use Variant Stock.' },
    { key: 'minStock', header: 'Minimum Stock', width: 16, group: 'Stock Details', example: '10', help: 'Low-stock alert level. Default: 5.' },
    { key: 'status', header: 'Status', width: 16, group: 'Stock Details', example: 'In Stock', help: 'In Stock, Low Stock, Out of Stock or Draft. Leave blank to calculate from stock.' },
    { key: 'expiryDate', header: 'Expiry Date', width: 16, group: 'Stock Details', example: '2027-12-31', help: 'Expiry date in YYYY-MM-DD format, e.g. 2027-12-31. Optional.' },
    { key: 'warrantyMonths', header: 'Warranty (Months)', width: 18, group: 'Stock Details', example: '12', help: 'Warranty period in months. Optional.' },
    // Variants
    { key: 'hasVariants', header: 'Has Variants', width: 14, group: 'Variants', example: 'Yes', help: 'Yes if this product has options such as colour or size, otherwise No.' },
    { key: 'variantAttr1Name', header: 'Variant 1 Name', width: 18, group: 'Variants', example: 'Colour', help: 'First option name, e.g. Colour or Size.' },
    { key: 'variantAttr1Option', header: 'Variant 1 Option', width: 20, group: 'Variants', example: 'Red', help: 'Option value for this row, e.g. Red.' },
    { key: 'variantAttr2Name', header: 'Variant 2 Name', width: 18, group: 'Variants', example: 'Size', help: 'Second option name, if the product has two options, e.g. Size.' },
    { key: 'variantAttr2Option', header: 'Variant 2 Option', width: 20, group: 'Variants', example: 'M', help: 'Second option value for this row, e.g. M.' },
    { key: 'variantPrice', header: 'Variant Selling Price', width: 22, group: 'Variants', example: '499', help: 'Selling price for this variant. Falls back to Selling Price when blank.' },
    { key: 'variantMrp', header: 'Variant MRP', width: 18, group: 'Variants', example: '599', help: 'MRP for this variant. Falls back to product MRP when blank.' },
    { key: 'variantStock', header: 'Variant Stock', width: 18, group: 'Variants', example: '30', help: 'Stock for this variant. Falls back to Opening Stock when blank.' }
  ];

  // Extra spellings accepted when reading a file, so a saved or edited sheet
  // still maps even if a header is worded slightly differently.
  const BULK_HEADER_ALIASES = {
    name: ['product name', 'name', 'product', 'item name', 'product title', 'item'],
    description: ['description', 'product description', 'details', 'notes'],
    category: ['category', 'product category', 'cat'],
    subCategory: ['sub category', 'subcategory', 'sub-category'],
    brand: ['brand', 'brand name', 'manufacturer'],
    sku: ['sku', 'product code', 'item code', 'code', 'sku code'],
    barcode: ['barcode', 'bar code', 'ean', 'upc', 'barcode number'],
    hsn: ['hsn code', 'hsn', 'hsn sac', 'sac', 'hsn sac code'],
    unit: ['unit', 'uom', 'unit of measure', 'selling unit', 'measure'],
    productImage: ['product image', 'image', 'image file', 'image filename', 'image name', 'photo', 'picture', 'product photo', 'image url'],
    purchasePrice: ['purchase price', 'cost price', 'buying price', 'cost', 'purchase rate'],
    price: ['selling price', 'sale price', 'price', 'rate', 'selling rate'],
    mrp: ['mrp', 'maximum retail price', 'list price'],
    tax: ['tax percent', 'tax', 'gst', 'gst percent', 'gst rate', 'tax rate', 'tax percent rate'],
    taxInclusive: ['tax inclusive', 'price includes tax', 'inclusive of tax', 'tax included'],
    discount: ['discount', 'discount value', 'discount amount'],
    discountType: ['discount type', 'discount mode'],
    stock: ['opening stock', 'stock', 'stock qty', 'quantity', 'qty', 'opening quantity', 'current stock'],
    minStock: ['minimum stock', 'min stock', 'low stock level', 'reorder level', 'min qty'],
    status: ['status', 'product status'],
    expiryDate: ['expiry date', 'expiry', 'exp date', 'best before'],
    warrantyMonths: ['warranty months', 'warranty', 'warranty period', 'warranty in months'],
    hasVariants: ['has variants', 'variants', 'has variant', 'is variant', 'variant product'],
    variantAttr1Name: ['variant 1 name', 'variant attribute 1 name', 'attribute 1 name', 'option 1 name'],
    variantAttr1Option: ['variant 1 option', 'variant attribute 1 option', 'attribute 1 option', 'option 1', 'variant option 1'],
    variantAttr2Name: ['variant 2 name', 'variant attribute 2 name', 'attribute 2 name', 'option 2 name'],
    variantAttr2Option: ['variant 2 option', 'variant attribute 2 option', 'attribute 2 option', 'option 2', 'variant option 2'],
    variantPrice: ['variant selling price', 'variant price', 'variant rate'],
    variantMrp: ['variant mrp', 'variant maximum retail price'],
    variantStock: ['variant stock', 'variant quantity', 'variant qty']
  };

  function bulkNormHeader(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/%/g, ' percent ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const BULK_HEADER_LOOKUP = (() => {
    const lookup = {};
    const register = (text, key) => {
      const normal = bulkNormHeader(text);
      if (!normal) return;
      lookup[normal] = key;
      // Also accept run-together forms such as "TaxInclusive" or "ProductName".
      lookup[normal.replace(/\s+/g, '')] = key;
    };
    BULK_COLUMNS.forEach(col => {
      register(col.header, col.key);
      register(col.key, col.key);
      (BULK_HEADER_ALIASES[col.key] || []).forEach(alias => register(alias, col.key));
    });
    return lookup;
  })();

  function bulkHeaderLabel(col) {
    return col.header + (col.required ? ' *' : '');
  }

  function bulkCategoryEmoji(category) {
    const key = String(category || '').trim().toLowerCase();
    if (Array.isArray(categories)) {
      const found = categories.find(c => c && String(c.name || '').trim().toLowerCase() === key);
      if (found && found.emoji) return found.emoji;
    }
    const fallback = {
      'fruits and vegetables': '🍎',
      'fruits & vegetables': '🍎',
      'groceries': '🛒',
      'electronics': '💻',
      'furniture': '🪑',
      'personal care': '🧴',
      'clothing': '👕',
      'other': '📦'
    };
    return fallback[key] || '📦';
  }

  function bulkCellToText(value) {
    if (value == null) return '';
    if (value instanceof Date) return bulkDateToIso(value);
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function bulkToNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const cleaned = String(value).replace(/[₹$,\s]/g, '').replace(/%$/, '');
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : NaN;
  }

  function bulkDateToIso(value) {
    if (!(value instanceof Date) || isNaN(value.getTime())) return '';
    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  }

  function bulkParseDate(value) {
    if (value == null || value === '') return { iso: '', ok: true };
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return { iso: '', ok: false };
      return { iso: bulkDateToIso(value), ok: true };
    }
    if (typeof value === 'number') {
      if (typeof XLSX !== 'undefined' && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
        const d = XLSX.SSF.parse_date_code(value);
        if (d && d.y) return { iso: d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'), ok: true };
      }
      return { iso: '', ok: false };
    }
    const text = String(value).trim();
    let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) {
      const iso = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
      return { iso, ok: !isNaN(new Date(iso + 'T00:00:00').getTime()) };
    }
    m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      let day = a;
      let month = b;
      if (a > 12 && b <= 12) { day = a; month = b; }
      else if (b > 12 && a <= 12) { month = a; day = b; }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return { iso: m[3] + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'), ok: true };
      }
      return { iso: '', ok: false };
    }
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) return { iso: bulkDateToIso(parsed), ok: true };
    return { iso: '', ok: false };
  }

  function bulkParseYesNo(value, label, rowNum, errors) {
    const text = bulkCellToText(value);
    if (!text) return false;
    if (/^(yes|y|true|1)$/i.test(text)) return true;
    if (/^(no|n|false|0)$/i.test(text)) return false;
    errors.push('Row ' + rowNum + ': ' + label + ' must be "Yes" or "No" (found "' + text + '").');
    return false;
  }

  function bulkNormalizeStatus(value) {
    const text = bulkCellToText(value).toLowerCase();
    if (!text) return '';
    if (text === 'draft') return 'Draft';
    if (/^(in stock|instock|in-stock|available)$/.test(text)) return 'In Stock';
    if (/^(low stock|low|lowstock|low-stock)$/.test(text)) return 'Low Stock';
    if (/^(out of stock|out|outofstock|out-of-stock|sold out)$/.test(text)) return 'Out of Stock';
    return null;
  }

  function bulkNormalizeDiscountType(value) {
    const text = bulkCellToText(value).toLowerCase().replace(/[₹()%]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return 'percentage';
    if (/^(percentage|percent|pct)$/.test(text)) return 'percentage';
    if (/^(rupees|rupee|rs|inr|fixed|amount|flat|value)$/.test(text)) return 'fixed';
    return null;
  }

  function bulkNormalizeUnit(value) {
    const raw = bulkCellToText(value);
    if (!raw) return 'Pcs';
    const t = raw.toLowerCase().replace(/\./g, '').trim();
    if (/^(pcs|pc|piece|pieces)$/.test(t)) return 'Pcs';
    if (/^(kg|kgs|kilogram|kilograms|kilo|kilos)$/.test(t)) return 'Kg';
    if (/^(litre|litres|liter|liters|ltr|ltrs|l)$/.test(t)) return 'Litre';
    if (/^(box|boxes|bx)$/.test(t)) return 'Box';
    if (/^(pack|packs|packet|packets|pkt|pkts)$/.test(t)) return 'Pack';
    // Unknown custom unit: keep trimmed original to avoid data loss.
    return raw.trim();
  }

  // ─── Parse one spreadsheet / CSV row into a normalised record ──
  function parseBulkRecord(raw, map, rowNum, errors) {
    const cell = (key) => (map[key] != null && map[key] < raw.length ? raw[map[key]] : '');
    const text = (key) => bulkCellToText(cell(key));

    const rec = {
      rowNum,
      name: text('name'),
      description: text('description'),
      category: text('category'),
      subCategory: text('subCategory'),
      brand: text('brand'),
      sku: text('sku'),
      barcode: text('barcode'),
      hsn: text('hsn'),
      unit: bulkNormalizeUnit(text('unit')),
      purchasePrice: null,
      price: null,
      mrp: null,
      tax: null,
      taxInclusive: false,
      discount: null,
      discountType: 'percentage',
      stock: null,
      minStock: null,
      statusText: '',
      expiryDate: '',
      warrantyMonths: null,
      hasVariants: false,
      variantAttr1Name: '',
      variantAttr1Option: '',
      variantAttr2Name: '',
      variantAttr2Option: '',
      variantPrice: null,
      variantMrp: null,
      variantStock: null
    };

    const numericFields = [
      ['purchasePrice', 'Purchase Price'],
      ['price', 'Selling Price'],
      ['mrp', 'MRP'],
      ['tax', 'Tax %'],
      ['discount', 'Discount'],
      ['stock', 'Opening Stock'],
      ['minStock', 'Minimum Stock'],
      ['warrantyMonths', 'Warranty (Months)'],
      ['variantPrice', 'Variant Selling Price'],
      ['variantMrp', 'Variant MRP'],
      ['variantStock', 'Variant Stock']
    ];

    numericFields.forEach(([key, label]) => {
      const value = bulkToNumber(cell(key));
      if (value == null) return;
      if (!Number.isFinite(value)) {
        errors.push('Row ' + rowNum + ': ' + label + ' must be a number (found "' + text(key) + '").');
        return;
      }
      if (value < 0) {
        errors.push('Row ' + rowNum + ': ' + label + ' cannot be negative.');
        return;
      }
      if (key === 'tax' && value > 100) {
        errors.push('Row ' + rowNum + ': Tax % cannot be more than 100.');
        return;
      }
      rec[key] = value;
    });

    rec.taxInclusive = bulkParseYesNo(cell('taxInclusive'), 'Tax Inclusive', rowNum, errors);
    rec.hasVariants = bulkParseYesNo(cell('hasVariants'), 'Has Variants', rowNum, errors);

    const statusText = text('status');
    if (statusText) {
      const status = bulkNormalizeStatus(statusText);
      if (status === null) {
        errors.push('Row ' + rowNum + ': Status must be In Stock, Low Stock, Out of Stock or Draft (found "' + statusText + '").');
      } else {
        rec.statusText = status;
      }
    }

    const discountType = bulkNormalizeDiscountType(cell('discountType'));
    if (discountType === null) {
      errors.push('Row ' + rowNum + ': Discount Type must be Percentage (%) or Rupees (₹) (found "' + text('discountType') + '").');
    } else {
      rec.discountType = discountType;
    }
    if (discountType === 'percentage' && rec.discount != null && rec.discount > 100) {
      errors.push('Row ' + rowNum + ': Discount percentage cannot be more than 100.');
    }

    const expiry = bulkParseDate(cell('expiryDate'));
    if (!expiry.ok) {
      errors.push('Row ' + rowNum + ': Expiry Date must be a valid date, e.g. 2027-12-31.');
    } else {
      rec.expiryDate = expiry.iso;
    }

    if (rec.warrantyMonths != null && Math.round(rec.warrantyMonths) !== rec.warrantyMonths) {
      errors.push('Row ' + rowNum + ': Warranty (Months) must be a whole number.');
    }

    rec.variantAttr1Name = text('variantAttr1Name');
    rec.variantAttr1Option = text('variantAttr1Option');
    rec.variantAttr2Name = text('variantAttr2Name');
    rec.variantAttr2Option = text('variantAttr2Option');
    rec.productImage = text('productImage');

    return rec;
  }

  function buildBulkSingleProduct(rec) {
    const stock = rec.stock != null ? Math.round(rec.stock) : 0;
    const minStock = rec.minStock != null ? Math.round(rec.minStock) : 5;
    const price = rec.price;
    const status = rec.statusText || (stock <= 0 ? 'Out of Stock' : stock <= minStock ? 'Low Stock' : 'In Stock');
    return {
      id: uid(),
      name: rec.name,
      description: rec.description,
      sku: rec.sku || generateAutoSku(),
      barcode: rec.barcode || '',
      hsn: rec.hsn,
      category: rec.category,
      subCategory: rec.subCategory,
      brand: rec.brand,
      unit: rec.unit || 'Pcs',
      price: price,
      purchasePrice: rec.purchasePrice != null ? rec.purchasePrice : 0,
      mrp: rec.mrp != null ? rec.mrp : price,
      tax: rec.tax != null ? rec.tax : 18,
      taxInclusive: !!rec.taxInclusive,
      stock: stock,
      minStock: minStock,
      expiryDate: rec.expiryDate || '',
      warrantyMonths: rec.warrantyMonths != null ? Math.round(rec.warrantyMonths) : 0,
      discountType: rec.discountType,
      discount: rec.discount != null ? rec.discount : 0,
      hasVariants: false,
      attributes: [],
      variants: [],
      images: [],
      image: null,
      emoji: bulkCategoryEmoji(rec.category),
      status: status
    };
  }

  // ─── Bulk import: product images from an optional ZIP ───────────
  async function readBulkZipFile(file) {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const dec = new TextDecoder('utf-8');

    // Locate End of Central Directory (scan backwards, max comment 64KB).
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('The selected ZIP file could not be read. Please choose a valid .zip file.');

    const totalEntries = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);
    // Zip64 fallback (rare for small image zips) — best effort.
    if (cdOffset === 0xffffffff || totalEntries === 0xffff) {
      for (let i = eocd - 20; i >= Math.max(0, eocd - 100); i--) {
        if (view.getUint32(i, true) === 0x07064b50) {
          const eocd64 = view.getUint32(i + 8, true);
          if (eocd64 + 56 <= bytes.length && view.getUint32(eocd64, true) === 0x06064b50) {
            cdOffset = Number(view.getBigUint64(eocd64 + 48, true));
          }
          break;
        }
      }
    }

    const entries = new Map(); // lowercased full path -> { name, data, mime }
    const warnings = [];

    for (let n = 0; n < totalEntries && cdOffset + 46 <= bytes.length; n++) {
      if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
      const method = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localOffset = view.getUint32(cdOffset + 42, true);
      const rawName = dec.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      cdOffset += 46 + nameLen + extraLen + commentLen;

      // Skip folders and macOS/resource junk.
      if (!rawName || rawName.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/i.test(rawName)) continue;

      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) continue;
      const lhNameLen = view.getUint16(localOffset + 26, true);
      const lhExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > bytes.length) continue;

      let data = null;
      try {
        if (method === 0) {
          data = bytes.slice(dataStart, dataEnd);
        } else if (method === 8) {
          if (typeof DecompressionStream === 'undefined') {
            warnings.push('Image "' + rawName + '" could not be read (compressed ZIP not supported in this browser).');
            continue;
          }
          const ds = new DecompressionStream('deflate-raw');
          const blob = new Blob([bytes.subarray(dataStart, dataEnd)]);
          data = new Uint8Array(await new Response(blob.stream().pipeThrough(ds)).arrayBuffer());
        } else {
          warnings.push('Image "' + rawName + '" uses an unsupported format inside the ZIP and was skipped.');
          continue;
        }
      } catch (e) {
        warnings.push('Image "' + rawName + '" could not be extracted from the ZIP.');
        continue;
      }

      const mime = bulkImageMime(rawName);
      if (!mime) {
        warnings.push('"' + rawName + '" is not a supported image (JPG, PNG, WebP, GIF) and was skipped.');
        continue;
      }
      // Guardrail: skip very large images to avoid blowing up localStorage.
      if (data.byteLength > 5 * 1024 * 1024) {
        warnings.push('"' + rawName + '" is larger than 5 MB and was skipped.');
        continue;
      }

      const key = rawName.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
      if (!entries.has(key)) entries.set(key, { name: rawName, data, mime });
    }

    return { entries, warnings };
  }

  function bulkImageMime(name) {
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return null;
  }

  function uint8ToBase64(u8) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function buildBulkImageIndex(zip) {
    if (!zip || !zip.entries) return null;
    const byPath = new Map();
    const byBase = new Map();
    zip.entries.forEach((entry, key) => {
      byPath.set(key, entry);
      const base = key.split('/').pop();
      if (base && !byBase.has(base)) byBase.set(base, entry);
    });
    return { byPath, byBase };
  }

  function findBulkZipImage(imageIndex, value) {
    if (!imageIndex || !value) return null;
    const norm = String(value).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().trim();
    if (!norm) return null;
    if (imageIndex.byPath.has(norm)) return imageIndex.byPath.get(norm);
    const base = norm.split('/').pop();
    if (base && imageIndex.byBase.has(base)) return imageIndex.byBase.get(base);
    // Try adding common extensions when the value has no extension (e.g. SKU).
    if (base && base.indexOf('.') === -1) {
      const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      for (let i = 0; i < exts.length; i++) {
        if (imageIndex.byBase.has(base + exts[i])) return imageIndex.byBase.get(base + exts[i]);
        const pathTry = norm + exts[i];
        if (imageIndex.byPath.has(pathTry)) return imageIndex.byPath.get(pathTry);
      }
    }
    return null;
  }

  function resolveBulkProductImage(product, records, rowNums, imageIndex, zipProvided) {
    const name = product.name || (records[0] && records[0].name) || '';
    const refs = [];
    records.forEach(r => { if (r && r.productImage) refs.push(String(r.productImage).trim()); });
    // Also allow matching by product SKU / variant SKUs when user named files after SKU.
    if (product.sku) refs.push(String(product.sku));
    (product.variants || []).forEach(v => { if (v && v.sku) refs.push(String(v.sku)); });

    const seen = Object.create(null);
    const uniqueRefs = refs.filter(v => { const k = String(v).toLowerCase(); if (!v || seen[k]) return false; seen[k] = true; return true; });

    if (!imageIndex) {
      // A reference was given but no ZIP uploaded -> warn, import without image.
      if (zipProvided === false && records.some(r => r && r.productImage)) {
        return { warning: { name, rows: rowNums.slice(), reasons: ['Row ' + rowNums[0] + ': Product image "' + records.find(r => r && r.productImage).productImage + '" was specified but no images ZIP was uploaded. Product imported without an image.'] } };
      }
      return {};
    }

    for (let i = 0; i < uniqueRefs.length; i++) {
      const entry = findBulkZipImage(imageIndex, uniqueRefs[i]);
      if (entry) {
        try {
          const dataUrl = 'data:' + entry.mime + ';base64,' + uint8ToBase64(entry.data);
          return { images: [dataUrl], image: dataUrl };
        } catch (e) {
          return { warning: { name, rows: rowNums.slice(), reasons: ['Row ' + rowNums[0] + ': Image "' + uniqueRefs[i] + '" could not be attached. Product imported without an image.'] } };
        }
      }
    }

    // No match found. Warn only if the user explicitly asked for an image or provided a ZIP
    // while naming files by SKU is plausible (keep noise low if column unused).
    const requested = records.some(r => r && r.productImage);
    if (requested) {
      const asked = records.find(r => r && r.productImage).productImage;
      return { warning: { name, rows: rowNums.slice(), reasons: ['Row ' + rowNums[0] + ': Image "' + asked + '" was not found in the uploaded ZIP. Product imported without an image.'] } };
    }
    return {};
  }

  // Build products from the parsed sheet. Valid rows are imported and invalid
  // rows are reported back with their reasons, so one bad row never blocks the
  // rest of the file.
  function buildProductsFromBulk(rows, header, imageIndex, zipProvided) {
    const headerIndex = header.headerIndex;
    const map = header.map;
    const records = [];

    for (let r = headerIndex + 1; r < rows.length; r++) {
      const raw = rows[r] || [];
      const cells = raw.map(bulkCellToText);
      const firstFilled = cells.find(v => v !== '') || '';
      if (!firstFilled || firstFilled.startsWith('#')) continue;
      const rowNum = r + 1;
      const issues = [];
      const rec = parseBulkRecord(raw, map, rowNum, issues);
      rec.issues = issues;
      records.push(rec);
    }

    if (!records.length) {
      return {
        imported: 0,
        failed: [],
        warnings: [],
        errors: ['No product rows were found below the header row. Enter your products in the "Products" sheet and upload again.']
      };
    }

    // Friendly fill-down: a variant row may leave Product Name blank when the
    // variant above already names the product (common when copying rows).
    let lastVariantName = '';
    records.forEach(rec => {
      const variantish = !!(rec.variantAttr1Option || rec.variantAttr2Option || rec.variantPrice != null || rec.variantStock != null);
      if (rec.name) {
        lastVariantName = (rec.hasVariants || variantish) ? rec.name : '';
      } else if (variantish && lastVariantName) {
        rec.name = lastVariantName;
      }
    });
    records.forEach(rec => {
      if (!rec.name) rec.issues.push('Row ' + rec.rowNum + ': Product Name is required.');
    });

    // Duplicate SKUs / barcodes — both inside the file and against inventory.
    const existingSku = new Set();
    const existingBarcode = new Set();
    (products || []).forEach(p => {
      if (p.sku) existingSku.add(String(p.sku).trim().toLowerCase());
      if (p.barcode) existingBarcode.add(String(p.barcode).trim().toLowerCase());
      (p.variants || []).forEach(v => {
        if (v.sku) existingSku.add(String(v.sku).trim().toLowerCase());
        if (v.barcode) existingBarcode.add(String(v.barcode).trim().toLowerCase());
      });
    });
    const seenSku = new Map();
    const seenBarcode = new Map();

    records.forEach(rec => {
      if (rec.sku) {
        const key = rec.sku.toLowerCase();
        if (existingSku.has(key)) {
          rec.issues.push('Row ' + rec.rowNum + ': SKU "' + rec.sku + '" already exists in inventory. Use a different SKU or leave it blank.');
        } else if (seenSku.has(key)) {
          rec.issues.push('Row ' + rec.rowNum + ': SKU "' + rec.sku + '" is also used on row ' + seenSku.get(key) + '. SKUs must be unique.');
        } else {
          seenSku.set(key, rec.rowNum);
        }
      }
      if (rec.barcode) {
        const key = rec.barcode.toLowerCase();
        if (existingBarcode.has(key)) {
          rec.issues.push('Row ' + rec.rowNum + ': Barcode "' + rec.barcode + '" already exists in inventory.');
        } else if (seenBarcode.has(key)) {
          rec.issues.push('Row ' + rec.rowNum + ': Barcode "' + rec.barcode + '" is also used on row ' + seenBarcode.get(key) + '. Barcodes must be unique.');
        } else {
          seenBarcode.set(key, rec.rowNum);
        }
      }
    });

    const groups = new Map();
    records.filter(rec => rec.name).forEach(rec => {
      // Group by product name only: continuation rows of a variant product may
      // leave repeated fields such as Category or Unit blank.
      const key = bulkNormHeader(rec.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rec);
    });

    const built = [];
    const failed = [];
    const warnings = [];
    const ungrouped = records.filter(rec => !rec.name);

    groups.forEach(groupRows => {
      const isVariantGroup = groupRows.some(r =>
        r.hasVariants || r.variantAttr1Option || r.variantAttr2Option || r.variantAttr1Name || r.variantAttr2Name
      );

      if (!isVariantGroup) {
        groupRows.forEach(rec => {
          const issues = rec.issues.slice();
          if (!rec.category) {
            issues.push('Row ' + rec.rowNum + ': Category is required.');
          }
          if (rec.price == null) {
            if (!issues.some(text => text.indexOf('Selling Price') !== -1)) {
              issues.push('Row ' + rec.rowNum + ': Selling Price is required.');
            }
          } else if (!(rec.price > 0)) {
            issues.push('Row ' + rec.rowNum + ': Selling Price must be greater than 0.');
          }
          if (issues.length) {
            failed.push({ name: rec.name, rows: [rec.rowNum], reasons: bulkUniqueReasons(issues) });
            return;
          }
          const single = buildBulkSingleProduct(rec);
          const img = resolveBulkProductImage(single, [rec], [rec.rowNum], imageIndex, zipProvided);
          if (img && img.images) { single.images = img.images; single.image = img.image; }
          if (img && img.warning) warnings.push(img.warning);
          built.push(single);
        });
        return;
      }

      // ── Variant product group ──
      // A product is one unit: if any row of this product has a problem, none
      // of its variant rows are imported, so partial variants never go live.
      const groupIssues = [];
      groupRows.forEach(r => r.issues.forEach(issue => groupIssues.push(issue)));
      let attr1Name = '';
      let attr2Name = '';
      groupRows.forEach(r => {
        if (!attr1Name && r.variantAttr1Name) attr1Name = r.variantAttr1Name;
        if (!attr2Name && r.variantAttr2Name) attr2Name = r.variantAttr2Name;
      });
      if (!attr2Name && groupRows.some(r => r.variantAttr2Option)) attr2Name = 'Option 2';
      if (!attr1Name) attr1Name = 'Option 1';

      const variantRows = groupRows.filter(r => r.variantAttr1Option || r.variantAttr2Option);
      if (!variantRows.length) {
        groupIssues.push('Row ' + groupRows[0].rowNum + ': Has Variants is Yes, but no Variant 1 Option / Variant 2 Option was entered. Add one row per variant (for example Red / M).');
        failed.push({ name: groupRows[0].name, rows: groupRows.map(r => r.rowNum), reasons: bulkUniqueReasons(groupIssues) });
        return;
      }
      groupRows.filter(r => !(r.variantAttr1Option || r.variantAttr2Option)).forEach(r => {
        groupIssues.push('Row ' + r.rowNum + ': This row has the same product name as a variant product but no Variant 1 Option. Enter the variant option or give the product a different name.');
      });

      const pick = (key) => {
        const value = groupRows.map(r => r[key]).find(v => v != null && v !== '');
        return value !== undefined ? value : null;
      };

      const groupPrice = pick('price');
      const groupMrp = pick('mrp');
      const groupPurchase = pick('purchasePrice');
      const groupTax = pick('tax');
      const groupDiscount = pick('discount');
      const groupExpiry = pick('expiryDate');
      const groupWarranty = pick('warrantyMonths');

      const attributes = [{ name: attr1Name, options: [] }];
      if (attr2Name) attributes.push({ name: attr2Name, options: [] });

      const variantList = [];
      const variantKeys = new Set();

      variantRows.forEach(rec => {
        const opt1 = rec.variantAttr1Option;
        const opt2 = attr2Name ? rec.variantAttr2Option : '';
        if (!opt1) {
          groupIssues.push('Row ' + rec.rowNum + ': Variant 1 Option is required (e.g. Red).');
          return;
        }
        if (attr2Name && !opt2) {
          groupIssues.push('Row ' + rec.rowNum + ': Variant 2 Option is required for this product (e.g. M).');
          return;
        }
        const options = attr2Name ? [opt1, opt2] : [opt1];
        const variantKey = options.join('\u0000').toLowerCase();
        if (variantKeys.has(variantKey)) {
          groupIssues.push('Row ' + rec.rowNum + ': Duplicate variant "' + options.join(' / ') + '" for this product.');
          return;
        }
        variantKeys.add(variantKey);

        const price = rec.variantPrice != null ? rec.variantPrice : (rec.price != null ? rec.price : groupPrice);
        if (price == null) {
          groupIssues.push('Row ' + rec.rowNum + ': Enter a Selling Price or Variant Selling Price.');
          return;
        }
        if (!(price > 0)) {
          groupIssues.push('Row ' + rec.rowNum + ': Variant Selling Price must be greater than 0.');
          return;
        }

        const mrp = rec.variantMrp != null ? rec.variantMrp
          : (rec.mrp != null ? rec.mrp : (groupMrp != null ? groupMrp : price));
        const purchasePrice = rec.purchasePrice != null ? rec.purchasePrice
          : (groupPurchase != null ? groupPurchase : null);
        const tax = rec.tax != null ? rec.tax : (groupTax != null ? groupTax : 18);
        const discount = rec.discount != null ? rec.discount
          : (groupDiscount != null ? groupDiscount : 0);
        const stock = rec.variantStock != null ? Math.round(rec.variantStock)
          : (rec.stock != null ? Math.round(rec.stock) : 0);
        const expiryDate = rec.expiryDate || (groupExpiry || '');
        const warrantyMonths = rec.warrantyMonths != null ? Math.round(rec.warrantyMonths)
          : (groupWarranty != null ? Math.round(groupWarranty) : 0);

        if (!attributes[0].options.includes(opt1)) attributes[0].options.push(opt1);
        if (attr2Name && !attributes[1].options.includes(opt2)) attributes[1].options.push(opt2);

        const variant = {
          id: 'var_' + Date.now().toString(36) + '_' + variantList.length + '_' + Math.random().toString(36).slice(2, 6),
          options: options.slice(),
          attrNames: attributes.map(a => a.name),
          option1: opt1,
          option2: opt2 || '',
          attr1Name: attributes[0].name,
          attr2Name: attr2Name || '',
          label: options.join(' / '),
          stock: stock,
          qty: stock,
          purchasePrice: purchasePrice,
          price: price,
          mrp: mrp,
          tax: tax,
          discount: discount,
          expiryDate: expiryDate,
          warrantyMonths: warrantyMonths
        };
        if (rec.sku) variant.sku = rec.sku;
        if (rec.barcode) variant.barcode = rec.barcode;
        variantList.push(variant);
      });

      if (!variantList.length) {
        if (!groupIssues.length) {
          groupIssues.push('Row ' + groupRows[0].rowNum + ': No complete variant rows were found for this product.');
        }
        failed.push({ name: groupRows[0].name, rows: groupRows.map(r => r.rowNum), reasons: bulkUniqueReasons(groupIssues) });
        return;
      }

      const stockQty = variantList.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
      const first = groupRows[0];
      const category = groupRows.map(r => r.category).find(v => v) || '';
      if (!category) groupIssues.push('Row ' + first.rowNum + ': Category is required.');
      const description = groupRows.map(r => r.description).find(v => v) || '';
      const unit = groupRows.map(r => r.unit).find(v => v && v !== 'Pcs') || 'Pcs';
      const hsn = groupRows.map(r => r.hsn).find(v => v) || '';
      const sku = groupRows.map(r => r.sku).find(v => v) || generateAutoSku();
      const barcode = groupRows.map(r => r.barcode).find(v => v) || '';
      const subCategory = groupRows.map(r => r.subCategory).find(v => v) || '';
      const brand = groupRows.map(r => r.brand).find(v => v) || '';
      const discountType = (groupRows.find(r => r.discountType) || {}).discountType || 'percentage';
      const minStock = pick('minStock') != null ? Math.round(pick('minStock')) : 5;
      const price = groupPrice != null ? groupPrice : variantList[0].price;
      const mrp = groupMrp != null ? groupMrp : variantList[0].mrp;
      const tax = groupTax != null ? groupTax : variantList[0].tax;
      const discount = groupDiscount != null ? groupDiscount : 0;
      const statusText = first.statusText || (stockQty <= 0 ? 'Out of Stock' : stockQty <= minStock ? 'Low Stock' : 'In Stock');

      if (groupIssues.length) {
        failed.push({ name: first.name, rows: groupRows.map(r => r.rowNum), reasons: bulkUniqueReasons(groupIssues) });
        return;
      }

      const groupProduct = {
        id: uid(),
        name: first.name,
        description: description,
        sku: sku,
        barcode: barcode,
        hsn: hsn,
        category: category,
        subCategory: subCategory,
        brand: brand,
        unit: unit,
        price: price,
        purchasePrice: groupPurchase != null ? groupPurchase : 0,
        mrp: mrp,
        tax: tax,
        taxInclusive: !!groupRows.find(r => r.taxInclusive),
        stock: stockQty,
        minStock: minStock,
        expiryDate: groupExpiry || '',
        warrantyMonths: groupWarranty != null ? Math.round(groupWarranty) : 0,
        discountType: discountType,
        discount: discount,
        hasVariants: true,
        attributes: attributes,
        variants: variantList,
        images: [],
        image: null,
        emoji: bulkCategoryEmoji(first.category),
        status: statusText
      };
      const img = resolveBulkProductImage(groupProduct, groupRows, groupRows.map(r => r.rowNum), imageIndex, zipProvided);
      if (img && img.images) { groupProduct.images = img.images; groupProduct.image = img.image; }
      if (img && img.warning) warnings.push(img.warning);
      built.push(groupProduct);
    });

    ungrouped.forEach(rec => {
      failed.push({
        name: rec.name || '',
        rows: [rec.rowNum],
        reasons: bulkUniqueReasons(rec.issues.length ? rec.issues : ['Row ' + rec.rowNum + ': Product Name is required.'])
      });
    });

    if (built.length) {
      products.unshift(...built);
      DB.set('products', products);
      if (typeof logStockMovements === 'function') {
        logStockMovements(built.map(p => ({
          type: 'created',
          productId: p.id,
          productName: p.name,
          barcode: p.barcode || '',
          qtyChange: Number(p.stock) || 0,
          qtyAfter: Number(p.stock) || 0,
          note: 'Imported via bulk import'
        })));
      }
      if (window.HisaabSaaS && typeof window.HisaabSaaS.syncProducts === 'function') {
        try { window.HisaabSaaS.syncProducts(products.length); } catch (e) { }
      }
      // Imported products must be visible straight away: clear any active
      // search/filter and re-render Inventory (and the stock timeline).
      invFilter = 'all';
      const searchInput = els('inventorySearchInput');
      if (searchInput) searchInput.value = '';
      renderInventory();
      if (typeof renderStockTimeline === 'function') renderStockTimeline();
    }

    return { imported: built.length, failed: failed, warnings: warnings, errors: [] };
  }

  // De-duplicate repeated reasons (a variant group reports the same message
  // once even when several of its rows hit the same validation).
  function bulkUniqueReasons(list) {
    const seen = Object.create(null);
    const unique = [];
    list.forEach(reason => {
      const text = String(reason);
      if (seen[text]) return;
      seen[text] = true;
      unique.push(text);
    });
    return unique;
  }

  // Read .xlsx / .xls / .csv into a 2D array and locate the header row.
  async function readBulkUploadFile(file) {
    const fileName = String(file.name || '').toLowerCase();

    if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      const text = await file.text();
      // Keep blank rows so spreadsheet row numbers in error messages stay correct.
      const rows = parseCsvRows(text).map(row => row.map(bulkCellToText));
      const header = findBulkHeaderRow(rows);
      if (!header) throw new Error('No "Product Name" column was found. Download a fresh template and keep its header row unchanged.');
      return { rows: rows, headerIndex: header.headerIndex, map: header.map, sheetName: 'CSV' };
    }

    if (typeof XLSX === 'undefined') {
      throw new Error('The Excel reader did not load. Refresh the page and try again.');
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    let best = null;

    workbook.SheetNames.forEach(sheetName => {
      if (/how to use|instruction|example/i.test(sheetName)) return;
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true });
      const header = findBulkHeaderRow(rows);
      if (header && (!best || header.score > best.score)) {
        best = { rows, headerIndex: header.headerIndex, map: header.map, score: header.score, sheetName };
      }
    });

    if (!best) {
      throw new Error('This file does not contain the product columns. Download a fresh template and keep its header row unchanged.');
    }
    return best;
  }

  // Find the header row inside the first 15 rows. The template keeps it as row
  // 1, but users often add a title line — this keeps the import working.
  function findBulkHeaderRow(rows) {
    const limit = Math.min(rows.length, 15);
    let best = null;
    for (let r = 0; r < limit; r++) {
      const map = {};
      let score = 0;
      (rows[r] || []).forEach((cell, index) => {
        const key = BULK_HEADER_LOOKUP[bulkNormHeader(cell)];
        if (key && map[key] == null) {
          map[key] = index;
          score++;
        }
      });
      if (map.name != null && score >= 3 && (!best || score > best.score)) {
        best = { headerIndex: r, map, score };
      }
    }
    return best;
  }

  // Robust CSV parser: supports quoted fields, embedded commas and newlines.
  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const source = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (inQuotes) {
        if (ch === '"') {
          if (source[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && source[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function styleBulkHeaderRow(sheet, columns) {
    columns.forEach((col, index) => {
      const address = XLSX.utils.encode_cell({ r: 0, c: index });
      if (!sheet[address]) sheet[address] = { t: 's', v: bulkHeaderLabel(col) };
      const required = !!col.required;
      sheet[address].s = {
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: required ? 'FFFFFF' : '4C1D95' } },
        fill: { patternType: 'solid', fgColor: { rgb: required ? '5B21B6' : 'EDE9FE' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: 'C4B5FD' } },
          bottom: { style: 'thin', color: { rgb: 'C4B5FD' } },
          left: { style: 'thin', color: { rgb: 'C4B5FD' } },
          right: { style: 'thin', color: { rgb: 'C4B5FD' } }
        }
      };
    });
  }

  function styleBulkExamplesSheet(sheet, columns) {
    styleBulkHeaderRow(sheet, columns);
    sheet['!cols'] = columns.map(col => ({ wch: col.width }));
    sheet['!rows'] = [{ hpt: 34 }];
  }

  // ─── Download the ready-to-use Excel template (.xlsx) ──────────
  els('downloadSampleCsvBtn').onclick = async () => {
    if (typeof XLSX === 'undefined' || !XLSX.utils) {
      toast('Excel library did not load. Refresh the page and try again.', 'error');
      return;
    }
    try {
      const workbook = XLSX.utils.book_new();
      workbook.Props = {
        Title: 'HISAAB POS Product Import Template',
        Subject: 'Bulk product upload',
        Author: 'HISAAB POS',
        CreatedDate: new Date()
      };

      const headers = BULK_COLUMNS.map(bulkHeaderLabel);
      const lastCol = XLSX.utils.encode_col(BULK_COLUMNS.length - 1);

      // 1) Products sheet — headers only, ready for data entry.
      const productsSheet = XLSX.utils.aoa_to_sheet([headers]);
      styleBulkHeaderRow(productsSheet, BULK_COLUMNS);
      productsSheet['!cols'] = BULK_COLUMNS.map(col => ({ wch: col.width }));
      productsSheet['!rows'] = [{ hpt: 34 }];
      productsSheet['!autofilter'] = { ref: 'A1:' + lastCol + '1' };
      XLSX.utils.book_append_sheet(workbook, productsSheet, 'Products');

      // 2) Examples sheet — same columns, filled with realistic examples.
      const examples = [
        {
          name: 'Wireless Mouse', description: 'Ergonomic 2.4 GHz wireless mouse', category: 'Electronics',
          subCategory: 'Computer Accessories', brand: 'Logitech', sku: 'SKU-1001', barcode: '8901234567891',
          hsn: '84716060', unit: 'Pcs', purchasePrice: 350, price: 599, mrp: 699, tax: 18,
          taxInclusive: 'No', discount: 0, discountType: 'Percentage (%)', stock: 50, minStock: 10,
          status: 'In Stock', expiryDate: '', warrantyMonths: 12, hasVariants: 'No'
        },
        {
          name: 'Green Tea 250g', description: 'Organic green tea pouch', category: 'Groceries',
          subCategory: 'Tea & Coffee', brand: '', sku: 'SKU-1002', barcode: '8909876543212',
          hsn: '09021020', unit: 'Box', purchasePrice: 180, price: 299, mrp: 349, tax: 5,
          taxInclusive: 'Yes', discount: 5, discountType: 'Percentage (%)', stock: 80, minStock: 20,
          status: 'In Stock', expiryDate: '2027-12-31', warrantyMonths: 0, hasVariants: 'No'
        },
        {
          name: 'Premium Cotton T-Shirt', description: '100% cotton premium t-shirt', category: 'Clothing',
          subCategory: 'Mens Wear', sku: 'TSHIRT-RED-M', unit: 'Pcs', price: 499, mrp: 599, tax: 18,
          minStock: 5, discountType: 'Percentage (%)', discount: 10, status: 'In Stock', warrantyMonths: 0,
          hasVariants: 'Yes', variantAttr1Name: 'Colour', variantAttr1Option: 'Red',
          variantAttr2Name: 'Size', variantAttr2Option: 'M', variantPrice: 499, variantMrp: 599, variantStock: 30
        },
        {
          name: 'Premium Cotton T-Shirt', sku: 'TSHIRT-RED-L', hasVariants: 'Yes',
          variantAttr1Name: 'Colour', variantAttr1Option: 'Red',
          variantAttr2Name: 'Size', variantAttr2Option: 'L', variantPrice: 499, variantMrp: 599, variantStock: 25
        },
        {
          name: 'Premium Cotton T-Shirt', sku: 'TSHIRT-BLUE-M', hasVariants: 'Yes',
          variantAttr1Name: 'Colour', variantAttr1Option: 'Blue',
          variantAttr2Name: 'Size', variantAttr2Option: 'M', variantPrice: 499, variantMrp: 599, variantStock: 20
        },
        {
          name: 'Premium Cotton T-Shirt', sku: 'TSHIRT-BLUE-L', hasVariants: 'Yes',
          variantAttr1Name: 'Colour', variantAttr1Option: 'Blue',
          variantAttr2Name: 'Size', variantAttr2Option: 'L', variantPrice: 499, variantMrp: 599, variantStock: 15
        }
      ];
      const exampleRows = [headers].concat(examples.map(example =>
        BULK_COLUMNS.map(col => (example[col.key] == null ? '' : example[col.key]))
      ));
      const examplesSheet = XLSX.utils.aoa_to_sheet(exampleRows);
      styleBulkExamplesSheet(examplesSheet, BULK_COLUMNS);
      XLSX.utils.book_append_sheet(workbook, examplesSheet, 'Examples');

      // 3) How to Use sheet — instructions + column reference.
      const info = [];
      const fullWidthRows = [];
      const pushRow = (row) => { info.push(row); return info.length - 1; };
      const fullRow = (text) => { const r = pushRow([text]); fullWidthRows.push(r); return r; };

      const titleRow = fullRow('HISAAB POS — Product Import Template');
      const subtitleRow = fullRow('The template is ready to use. Type your product details in the "Products" sheet, save the file, then upload the same file from Inventory → Bulk import.');
      pushRow([]);
      const stepsTitle = fullRow('HOW TO USE THIS TEMPLATE');
      fullRow('Step 1 — Open the "Products" sheet. All column headers are already there. Do not rename, reorder or delete them.');
      fullRow('Step 2 — Enter one product per row. Only the three columns marked * are compulsory: Product Name, Category and Selling Price.');
      fullRow('Step 3 — Leave any optional column blank to use its default: Unit = Pcs, Tax % = 18, Tax Inclusive = No, Opening Stock = 0, Minimum Stock = 5, Discount Type = Percentage (%), Has Variants = No.');
      fullRow('Step 4 — For a product with variants (colour, size, etc.), set Has Variants = Yes and repeat the product name on one row per variant. Example: Red / M, Red / L, Blue / M, Blue / L. Fill Variant 1/2 Name and Option; Variant Selling Price, MRP and Stock can be left blank to use the product-level values.');
      fullRow('Step 5 — Save this file, then upload it: Inventory → Bulk import → Select Excel / CSV File → Import Products.');
      fullRow('Tip — The "Examples" sheet shows two single products and one product with four variants. Copy any row from there into the "Products" sheet and change the values.');
      pushRow([]);
      const guideTitle = fullRow('COLUMN GUIDE');
      const tableHeaderRow = pushRow(['Column', 'Required?', 'What to enter', 'Example']);
      BULK_COLUMNS.forEach(col => {
        pushRow([bulkHeaderLabel(col), col.required ? 'Yes' : 'Optional', col.help, String(col.example)]);
      });
      const tableLastRow = info.length - 1;
      pushRow([]);
      const notesTitle = fullRow('ALLOWED VALUES & TIPS');
      fullRow('Status: In Stock, Low Stock, Out of Stock or Draft.');
      fullRow('Discount Type: Percentage (%) or Rupees (₹).');
      fullRow('Tax Inclusive: Yes or No.  Has Variants: Yes or No.');
      fullRow('Unit: Pcs, Kg, Litre, Box or Pack.');
      fullRow('Expiry Date: YYYY-MM-DD (for example 2027-12-31).');
      fullRow('Category: any category name. Common choices: Groceries, Fruits & Vegetables, Personal Care, Electronics, Clothing, Furniture, Other.');
      fullRow('SKU and Barcode are generated automatically when left blank. If you enter them, they must be unique.');
      fullRow('Numbers only in price, tax, stock and warranty columns. Do not type currency symbols, letters or commas.');
      fullRow('Need to change a header? Download a fresh template instead — renamed headers cannot be matched to product fields.');

      const infoSheet = XLSX.utils.aoa_to_sheet(info);
      infoSheet['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 78 }, { wch: 34 }];
      infoSheet['!merges'] = fullWidthRows.map(r => ({ s: { r: r, c: 0 }, e: { r: r, c: 3 } }));

      // Title
      const titleCell = { r: titleRow, c: 0 };
      infoSheet[XLSX.utils.encode_cell(titleCell)].s = {
        font: { name: 'Calibri', sz: 16, bold: true, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: '5B21B6' } },
        alignment: { horizontal: 'left', vertical: 'center' }
      };
      infoSheet['!rows'] = info.map(() => ({ hpt: 16 }));
      infoSheet['!rows'][titleRow] = { hpt: 30 };
      infoSheet[XLSX.utils.encode_cell({ r: subtitleRow, c: 0 })].s = {
        font: { name: 'Calibri', sz: 11, italic: true, color: { rgb: '4B5563' } },
        alignment: { wrapText: true, vertical: 'center' }
      };
      infoSheet['!rows'][subtitleRow] = { hpt: 32 };

      [stepsTitle, guideTitle, notesTitle].forEach(r => {
        infoSheet[XLSX.utils.encode_cell({ r: r, c: 0 })].s = {
          font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: '4C1D95' } },
          fill: { patternType: 'solid', fgColor: { rgb: 'EDE9FE' } },
          alignment: { vertical: 'center' },
          border: { bottom: { style: 'thin', color: { rgb: 'C4B5FD' } } }
        };
        infoSheet['!rows'][r] = { hpt: 24 };
      });

      // Steps and notes: wrap text so long instructions stay readable.
      for (let r = stepsTitle + 1; r < tableHeaderRow; r++) {
        const cell = infoSheet[XLSX.utils.encode_cell({ r: r, c: 0 })];
        if (cell && cell.v) {
          cell.s = { font: { name: 'Calibri', sz: 11, color: { rgb: '1F2937' } }, alignment: { wrapText: true, vertical: 'top' } };
          infoSheet['!rows'][r] = { hpt: 30 };
        }
      }

      // Column guide table styles.
      BULK_COLUMNS.forEach((col, i) => {
        const row = tableHeaderRow + 1 + i;
        const required = !!col.required;
        for (let c = 0; c < 4; c++) {
          const address = XLSX.utils.encode_cell({ r: row, c: c });
          const cell = infoSheet[address];
          if (!cell) continue;
          const style = {
            font: { name: 'Calibri', sz: 11, color: { rgb: '1F2937' } },
            alignment: { wrapText: true, vertical: 'top' },
            border: {
              top: { style: 'thin', color: { rgb: 'E5E7EB' } },
              bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
              left: { style: 'thin', color: { rgb: 'E5E7EB' } },
              right: { style: 'thin', color: { rgb: 'E5E7EB' } }
            }
          };
          if (required) style.fill = { patternType: 'solid', fgColor: { rgb: 'F5F3FF' } };
          cell.s = style;
        }
        const labelCell = infoSheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
        if (labelCell) labelCell.s.font = { name: 'Calibri', sz: 11, bold: true, color: { rgb: '4C1D95' } };
      });
      for (let c = 0; c < 4; c++) {
        const cell = infoSheet[XLSX.utils.encode_cell({ r: tableHeaderRow, c: c })];
        if (!cell) continue;
        cell.s = {
          font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
          fill: { patternType: 'solid', fgColor: { rgb: '7C3AED' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: {
            top: { style: 'thin', color: { rgb: 'C4B5FD' } },
            bottom: { style: 'thin', color: { rgb: 'C4B5FD' } },
            left: { style: 'thin', color: { rgb: 'C4B5FD' } },
            right: { style: 'thin', color: { rgb: 'C4B5FD' } }
          }
        };
      }
      infoSheet['!rows'][tableHeaderRow] = { hpt: 22 };

      for (let r = tableLastRow + 2; r < info.length; r++) {
        const cell = infoSheet[XLSX.utils.encode_cell({ r: r, c: 0 })];
        if (cell && cell.v) {
          cell.s = { font: { name: 'Calibri', sz: 11, color: { rgb: '374151' } }, alignment: { wrapText: true, vertical: 'top' } };
          infoSheet['!rows'][r] = { hpt: 26 };
        }
      }

      XLSX.utils.book_append_sheet(workbook, infoSheet, 'How to Use');

      // --- Helpers: add dropdowns (data validations) to Products sheet ---
      const bulkColLetter = (idx) => {
        let s = ''; let n = idx + 1;
        while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
        return s;
      };
      const bulkCrc32 = (() => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
          table[i] = c >>> 0;
        }
        return (u8) => {
          let c = 0xFFFFFFFF;
          for (let i = 0; i < u8.length; i++) c = table[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
          return (c ^ 0xFFFFFFFF) >>> 0;
        };
      })();
      const readZipEntries = async (buffer) => {
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        const dec = new TextDecoder('utf-8');
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
          if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('Invalid xlsx');
        const total = view.getUint16(eocd + 10, true);
        let cdOffset = view.getUint32(eocd + 16, true);
        const out = [];
        for (let n = 0; n < total && cdOffset + 46 <= bytes.length; n++) {
          if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
          const method = view.getUint16(cdOffset + 10, true);
          const compSize = view.getUint32(cdOffset + 20, true);
          const nameLen = view.getUint16(cdOffset + 28, true);
          const extraLen = view.getUint16(cdOffset + 30, true);
          const commentLen = view.getUint16(cdOffset + 32, true);
          const localOffset = view.getUint32(cdOffset + 42, true);
          const name = dec.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
          cdOffset += 46 + nameLen + extraLen + commentLen;
          if (localOffset + 30 > bytes.length) continue;
          const lhNameLen = view.getUint16(localOffset + 26, true);
          const lhExtraLen = view.getUint16(localOffset + 28, true);
          const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
          const dataEnd = dataStart + compSize;
          if (dataEnd > bytes.length) continue;
          let data = null;
          if (method === 0) data = bytes.slice(dataStart, dataEnd);
          else if (method === 8 && typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate-raw');
            data = new Uint8Array(await new Response(new Blob([bytes.subarray(dataStart, dataEnd)]).stream().pipeThrough(ds)).arrayBuffer());
          } else {
            throw new Error('Unsupported compression');
          }
          out.push({ name, data });
        }
        return out;
      };
      const writeZipEntries = (entries) => {
        const enc = new TextEncoder();
        const chunks = [];
        const central = [];
        let offset = 0;
        const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
        const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
        entries.forEach(entry => {
          const nameBytes = enc.encode(entry.name);
          const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
          const crc = bulkCrc32(data);
          const local = new Uint8Array(30 + nameBytes.length);
          const lv = new DataView(local.buffer);
          lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
          lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
          lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
          lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
          local.set(nameBytes, 30);
          chunks.push(local, data);

          const cdir = new Uint8Array(46 + nameBytes.length);
          const cv = new DataView(cdir.buffer);
          cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
          cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
          cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
          cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
          cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
          cdir.set(nameBytes, 46);
          central.push(cdir);
          offset += local.length + data.length;
        });
        const cdStart = offset;
        let cdSize = 0;
        central.forEach(c => { chunks.push(c); cdSize += c.length; offset += c.length; });
        const eocd = new Uint8Array(22);
        const ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
        ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
        ev.setUint32(12, cdSize, true); ev.setUint32(16, cdStart, true); ev.setUint16(20, 0, true);
        chunks.push(eocd);
        const total = chunks.reduce((s, a) => s + a.length, 0);
        const outBuf = new Uint8Array(total);
        let pos = 0;
        chunks.forEach(a => { outBuf.set(a, pos); pos += a.length; });
        return outBuf.buffer;
      };
      const injectDataValidations = (xml, validations) => {
        if (!validations.length) return xml;
        const dvBody = validations.map(v =>
          '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="' + v.sqref + '"><formula1>"' + v.list + '"</formula1></dataValidation>'
        ).join('');
        const dv = '<dataValidations count="' + validations.length + '">' + dvBody + '</dataValidations>';
        if (/<dataValidations[\s>]/.test(xml)) return xml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/, dv);
        // SpreadsheetML worksheet child order requires dataValidations before these elements.
        const afterDv = /<(?:hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s/>]/;
        const m = xml.match(afterDv);
        if (m && typeof m.index === 'number') return xml.slice(0, m.index) + dv + xml.slice(m.index);
        return xml.replace(/<\/worksheet>\s*$/, dv + '</worksheet>');
      };

      // Generate xlsx and inject dropdowns (Unit, Tax Inclusive, Discount Type) into Products sheet.
      let outArray = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      try {
        const colOf = (key) => {
          const idx = BULK_COLUMNS.findIndex(c => c.key === key);
          return idx >= 0 ? bulkColLetter(idx) : null;
        };
        const unitCol = colOf('unit');
        const taxCol = colOf('taxInclusive');
        const discCol = colOf('discountType');
        const maxRow = 5000;
        const validations = [];
        if (unitCol) validations.push({ sqref: unitCol + '2:' + unitCol + maxRow, list: 'Pcs,Kg,Litre,Box,Pack' });
        if (taxCol) validations.push({ sqref: taxCol + '2:' + taxCol + maxRow, list: 'Yes,No' });
        if (discCol) validations.push({ sqref: discCol + '2:' + discCol + maxRow, list: 'Percentage (%),Rupees (&#8377;)' });
        if (validations.length) {
          const ab = (outArray instanceof ArrayBuffer)
            ? outArray
            : (outArray && outArray.buffer instanceof ArrayBuffer && !(Array.isArray(outArray)))
              ? outArray.buffer
              : new Uint8Array(outArray).buffer;
          const entries = await readZipEntries(ab);
          const sheet = entries.find(e => e.name === 'xl/worksheets/sheet1.xml');
          if (sheet) {
            const xml = new TextDecoder('utf-8').decode(sheet.data);
            const patched = injectDataValidations(xml, validations);
            sheet.data = new TextEncoder().encode(patched);
            outArray = new Uint8Array(writeZipEntries(entries));
          }
        }
      } catch (patchErr) {
        console.warn('[BULK TEMPLATE] Dropdown injection skipped:', patchErr);
        // Fall back to the original generated file (no dropdowns) rather than failing.
      }

      const blob = new Blob([outArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'HISAAB_Product_Import_Template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast('Excel template downloaded', 'success');
    } catch (err) {
      console.error('[BULK TEMPLATE]', err);
      toast('Could not create the template: ' + (err && err.message ? err.message : err), 'error');
    }
  };

  // ─── Import the filled Excel / CSV file ────────────────────────
  els('confirmBulkUploadBtn').onclick = async () => {
    const input = els('bulkCsvInput');
    const file = input && input.files && input.files[0];
    if (!file) {
      toast('Choose an Excel (.xlsx) or CSV file first.', 'warning');
      return;
    }

    const button = els('confirmBulkUploadBtn');
    const originalLabel = button ? button.textContent : 'Import Products';
    if (button) {
      button.disabled = true;
      button.textContent = 'Importing…';
    }

    try {
      const zipInput = els('bulkZipInput');
      const zipFile = zipInput && zipInput.files && zipInput.files[0];

      let imageIndex = null;
      let zipWarnings = [];
      if (zipFile) {
        const zip = await readBulkZipFile(zipFile);
        imageIndex = buildBulkImageIndex(zip);
        zipWarnings = (zip && zip.warnings) ? zip.warnings.slice() : [];
      }

      const parsed = await readBulkUploadFile(file);
      const result = buildProductsFromBulk(parsed.rows, parsed, imageIndex, !!zipFile);
      const imported = result.imported || 0;
      const failed = result.failed || [];
      const warnings = (result.warnings || []).concat(zipWarnings.map(msg => ({ name: '', rows: [], reasons: [msg] })));
      const fileErrors = result.errors || [];

      // The file itself could not be read (missing header, wrong format…).
      if (fileErrors.length) {
        showBulkImportResult({ imported: 0, failed: failed, warnings: warnings, errors: fileErrors });
        toast(fileErrors[0], 'error');
        return;
      }

      // Full success with no issues: close the modal and let the refreshed Inventory speak.
      if (imported && !failed.length && !warnings.length) {
        hideBulkImportProblems();
        hideModal('bulkUploadModal');
        resetBulkImportFile();
        toast(imported + ' product' + (imported === 1 ? '' : 's') + ' imported successfully!', 'success');
        return;
      }

      // Success (possibly with image warnings) or partial / nothing valid:
      // keep the modal open so the user can see what was added and what needs attention.
      showBulkImportResult({ imported: imported, failed: failed, warnings: warnings, errors: [] });
      resetBulkImportFile();
      if (imported && !failed.length) {
        toast(imported + ' imported with ' + warnings.length + ' image note' + (warnings.length === 1 ? '' : 's'), 'warning');
      } else if (imported) {
        toast(imported + ' imported · ' + failed.length + ' row' + (failed.length === 1 ? '' : 's') + ' skipped', 'warning');
      } else {
        toast('Nothing was imported — fix the listed rows and try again.', 'error');
      }
    } catch (err) {
      console.error('[BULK IMPORT]', err);
      showBulkImportResult({ imported: 0, failed: [], warnings: [], errors: [err && err.message ? err.message : String(err)] });
      toast(err && err.message ? err.message : 'Import failed.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  };

  function resetBulkImportFile() {
    const input = els('bulkCsvInput');
    if (input) input.value = '';
    const fileLabel = els('bulkFileName');
    if (fileLabel) fileLabel.textContent = 'No file selected';
    const zipInput = els('bulkZipInput');
    if (zipInput) zipInput.value = '';
    const zipLabel = els('bulkZipName');
    if (zipLabel) zipLabel.textContent = 'No ZIP selected';
  }

  // Result panel shown inside the modal: import count plus the skipped rows
  // with their reasons. Green when products were added, red when none were.
  function showBulkImportResult(result) {
    const box = els('bulkUploadStatus');
    const imported = Number(result.imported) || 0;
    const failed = result.failed || [];
    const warnings = result.warnings || [];
    const errors = result.errors || [];

    if (!box) {
      const first = errors[0] || (failed[0] && failed[0].reasons && failed[0].reasons[0]) || (warnings[0] && warnings[0].reasons && warnings[0].reasons[0]) || '';
      toast(first || (imported + ' products imported'), first && !imported ? 'error' : 'success');
      return;
    }

    // Whole-file problem (unreadable file, no header, no product rows).
    if (!imported && !failed.length) {
      box.style.background = '#fef2f2';
      box.style.borderColor = '#fecaca';
      box.innerHTML =
        '<div style="font-weight:700;color:#b91c1c;margin-bottom:6px;">This file could not be imported</div>' +
        '<ul style="margin:0;padding-left:18px;color:#7f1d1d;line-height:1.55;max-height:180px;overflow:auto;">' +
        errors.map(error => '<li>' + escHtml(error) + '</li>').join('') +
        '</ul>' +
        '<div style="margin-top:8px;color:#374151;font-size:12px;">Fix the file and upload it again. Your inventory has not been changed.</div>';
      box.classList.remove('hidden');
      return;
    }

    const hasSuccess = imported > 0;
    box.style.background = hasSuccess ? '#f0fdf4' : '#fef2f2';
    box.style.borderColor = hasSuccess ? '#bbf7d0' : '#fecaca';

    let html = '';
    if (hasSuccess) {
      html +=
        '<div style="font-weight:700;color:#15803d;margin-bottom:6px;display:flex;align-items:center;gap:6px;">' +
        '<span style="display:inline-flex;width:16px;height:16px;border-radius:50%;background:#16a34a;color:#fff;font-size:11px;line-height:1;align-items:center;justify-content:center;">&#10003;</span>' +
        escHtml(String(imported)) + ' product' + (imported === 1 ? '' : 's') + ' imported successfully' +
        '</div>' +
        '<div style="color:#166534;font-size:12px;">The new products are now visible in Inventory.</div>';
    }

    if (warnings.length) {
      const wRows = warnings.slice(0, 12).map(item => {
        const rowsLabel = (item.rows || []).join(', ');
        const label = rowsLabel ? ('Row' + ((item.rows || []).length > 1 ? 's ' : ' ') + rowsLabel + (item.name ? ' · ' + item.name : '')) : (item.name || 'Image note');
        const reasons = (item.reasons || []).map(reason => escHtml(reason)).join('<br>');
        return '<li style="margin-bottom:6px;">' +
          (rowsLabel || item.name ? '<span style="font-weight:600;color:#92400e;">' + escHtml(label) + '</span><br>' : '') +
          '<span style="color:#78350f;">' + (reasons || 'Imported without an image.') + '</span>' +
          '</li>';
      });
      if (warnings.length > 12) {
        const rest = warnings.length - 12;
        wRows.push('<li style="color:#92400e;">…and ' + rest + ' more image note' + (rest === 1 ? '' : 's') + '.</li>');
      }
      html +=
        '<div style="font-weight:700;color:#92400e;margin:' + (hasSuccess ? '12px' : '0') + ' 0 6px;">' +
        warnings.length + ' image note' + (warnings.length === 1 ? '' : 's') + '</div>' +
        '<ul style="margin:0;padding-left:18px;line-height:1.55;max-height:160px;overflow:auto;font-size:12px;">' + wRows.join('') + '</ul>' +
        '<div style="margin-top:6px;color:#374151;font-size:12px;">These products were imported without the listed images. You can add images later from Edit Product.</div>';
    }

    if (failed.length) {
      const rows = failed.slice(0, 15).map(item => {
        const rowsLabel = (item.rows || []).join(', ');
        const label = 'Row' + ((item.rows || []).length > 1 ? 's ' : ' ') + rowsLabel +
          (item.name ? ' · ' + item.name : '');
        const reasons = (item.reasons || []).map(reason => escHtml(reason)).join('<br>');
        return '<li style="margin-bottom:6px;">' +
          '<span style="font-weight:600;color:#7f1d1d;">' + escHtml(label) + '</span>' +
          '<div style="color:#991b1b;">' + (reasons || 'This row was skipped.') + '</div>' +
          '</li>';
      });
      if (failed.length > 15) {
        const rest = failed.length - 15;
        rows.push('<li style="color:#7f1d1d;">…and ' + rest + ' more skipped row' + (rest === 1 ? '' : 's') + '.</li>');
      }
      html +=
        '<div style="font-weight:700;color:#b91c1c;margin:' + (hasSuccess || warnings.length ? '12px' : '0') + ' 0 6px;">' +
        failed.length + ' row' + (failed.length === 1 ? '' : 's') + ' could not be imported</div>' +
        '<ul style="margin:0;padding-left:18px;line-height:1.55;max-height:200px;overflow:auto;font-size:12px;">' + rows.join('') + '</ul>' +
        '<div style="margin-top:8px;color:#374151;font-size:12px;">' +
        (hasSuccess
          ? 'Only the listed rows were skipped. Correct them in your file and upload it again for those products.'
          : 'Nothing was imported. Correct the listed rows and upload the file again.') +
        '</div>';
    }

    box.innerHTML = html;
    box.classList.remove('hidden');
    try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { }
  }

  function hideBulkImportProblems() {
    const box = els('bulkUploadStatus');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
  }


  // Add Customer (uses the redesigned Quick Add Customer modal)
  // openQuickAddCustomer is wired in setupQuickAddCustomer()

  // Damage
  els('addDamageBtn').onclick = () => { populateProductSelects(); showModal('addDamageModal'); };
  els('closeAddDamage').onclick = () => hideModal('addDamageModal');
  els('cancelAddDamage').onclick = () => hideModal('addDamageModal');
  els('saveDamageBtn').onclick = saveDamage;

  // Returns
  els('addReturnBtn').onclick = () => { populateProductSelects(); showModal('addReturnModal'); };
  els('closeAddReturn').onclick = () => hideModal('addReturnModal');
  els('cancelAddReturn').onclick = () => hideModal('addReturnModal');
  els('saveReturnBtn').onclick = saveReturn;

  // Cash Drawer
  els('closeCashDrawer').onclick = () => hideModal('cashDrawerModal');
  els('cashInBtn').onclick = () => cashInOut('in');
  els('cashOutBtn').onclick = () => cashInOut('out');

  // Export
  els('exportSalesBtn')?.addEventListener('click', exportSalesCSV);

  // Close modals on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
  });

  // Start with empty cart - users manually search and add products
  cart = [];
  renderCart();

  // Cloud identity: Supabase Auth + organization onboarding.
  // Initialised by cloud.js IIFE. Also called here as a fallback.
  if (window.HisaabCloud && typeof window.HisaabCloud.init === 'function') {
    try { window.HisaabCloud.init(); } catch (err) { console.warn('[Cloud] init failed', err); }
  }

  // SaaS: nav chip, plan gates, checkout and the usage bridge.
  // In cloud mode it boots in a dormant state and wakes up when
  // HisaabCloud hands over the signed-in Supabase identity.
  if (window.HisaabSaaS && typeof window.HisaabSaaS.init === 'function') {
    try { window.HisaabSaaS.init(); } catch (err) { console.warn('[SaaS] init failed', err); }
  }

  // Restore the view from the URL now that nav + modules are ready. This runs
  // after setupOnboarding() so its default POS/landing redirect cannot win.
  routeHydrated = true;
  setupRouteNavigation();

  // Cloud identity can resolve more than once (auth + org bootstrap) and its
  // showApp() re-activates POS each time. Re-apply the URL route on every
  // ready event; it only acts while the URL still requests that same view.
  const hasCloudReady = !!(window.HisaabCloud && typeof window.HisaabCloud.onReady === 'function');
  const cloudConfigured = !!(window.HisaabSupabase && typeof window.HisaabSupabase.configured === 'function' && window.HisaabSupabase.configured());
  if (hasCloudReady) window.HisaabCloud.onReady(applyInitialRoute);
  // When cloud is configured, wait for auth so the hash is not stripped before
  // we know whether the session is signed in or should fall back to landing.
  if (!hasCloudReady || !cloudConfigured) applyInitialRoute();
}

// ══════════════════════════════════════════════════════════════
//   CAMERA BARCODE SCANNER (Mobile Snap Fallback + Live Stream)
// ══════════════════════════════════════════════════════════════
let camStream = null;
let camDetector = null;
let zxingReader = null;
let zxingMultiReader = null;
let camScanning = false;
let camTorchOn = false;
let scannerTarget = 'pos'; // 'pos' | 'add-product'
let scannerMode = 'snap'; // 'snap' | 'live'
let lastDetectedBarcode = '';
let lastDetectTime = 0;

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 768);
}

function canUseLiveCamera() {
  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return hasMedia && isSecure;
}

function getZXingHints() {
  if (typeof ZXing === 'undefined') return null;
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.CODABAR,
      ZXing.BarcodeFormat.DATA_MATRIX
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    return hints;
  } catch (e) {
    return null;
  }
}

function getZXingMultiReader() {
  if (zxingMultiReader) return zxingMultiReader;
  if (typeof ZXing === 'undefined') return null;
  try {
    const reader = new ZXing.MultiFormatReader();
    const hints = getZXingHints();
    if (hints) reader.setHints(hints);
    zxingMultiReader = reader;
    return zxingMultiReader;
  } catch (e) {
    console.warn('[ZXing] Failed to create MultiFormatReader:', e);
    return null;
  }
}

function switchScannerMode(mode) {
  scannerMode = mode;
  const tabSnap = els('tabSnapPhotoBtn');
  const tabLive = els('tabLiveVideoBtn');
  const secSnap = els('camSnapSection');
  const secLive = els('camLiveSection');

  if (mode === 'snap') {
    stopCameraScanner();
    if (tabSnap) tabSnap.classList.add('active');
    if (tabLive) tabLive.classList.remove('active');
    if (secSnap) secSnap.classList.remove('hidden');
    if (secLive) secLive.classList.add('hidden');
  } else {
    if (tabLive) tabLive.classList.add('active');
    if (tabSnap) tabSnap.classList.remove('active');
    if (secLive) secLive.classList.remove('hidden');
    if (secSnap) secSnap.classList.add('hidden');
    startCameraScanner();
  }
}

async function openScanBarcodeModal(target = 'auto') {
  if (target === 'auto') {
    const isAddProductActive = els('view-add-product')?.classList.contains('active');
    scannerTarget = isAddProductActive ? 'add-product' : 'pos';
  } else {
    scannerTarget = target;
  }

  showModal('scanBarcodeModal');

  // Reset feedback & preview states
  const previewWrap = els('camPhotoPreviewWrap');
  const promptWrap = els('camSnapPromptWrap');
  const feedback = els('camSnapFeedback');
  const actionBtnText = els('camSnapActionBtnText');
  if (previewWrap) previewWrap.classList.add('hidden');
  if (promptWrap) promptWrap.classList.remove('hidden');
  if (feedback) feedback.classList.add('hidden');
  if (actionBtnText) actionBtnText.textContent = 'Open Phone Camera';

  // Badge & continuous option row
  const badge = els('camScannerTargetBadge');
  const continuousRow = els('camContinuousCheck')?.parentElement;
  if (badge) {
    if (scannerTarget === 'pos') {
      badge.textContent = '🛒 POS Sale Cart';
      badge.style.background = '#ede9fe';
      badge.style.color = '#6d28d9';
      if (continuousRow) continuousRow.style.display = 'flex';
    } else {
      badge.textContent = '📦 Add Product Form';
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
      if (continuousRow) continuousRow.style.display = 'none';
    }
  }

  const isPhone = isMobileDevice();
  const canLive = canUseLiveCamera();

  // On phone devices, hide the desktop "Connect Mobile Scanner" button in the modal
  const mobileBtn = els('camOpenMobileBtn');
  if (mobileBtn) {
    mobileBtn.style.display = isPhone ? 'none' : 'inline-block';
  }

  // Prevent virtual keyboard from popping up on mobile
  const manual = els('camManualInput');
  if (manual) {
    manual.value = '';
    manual.placeholder = scannerTarget === 'pos' ? 'Type or USB scan barcode to add to cart…' : 'Type or USB scan barcode into form…';
    if (!isPhone) {
      setTimeout(() => manual.focus(), 300);
    }
  }

  // If on mobile (or HTTP without mediaDevices), default to 'snap' mode for 100% reliability
  if (!canLive || isPhone) {
    switchScannerMode('snap');
  } else {
    switchScannerMode('live');
  }
}

async function decodeBarcodeFromImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = async () => {
      let barcodeResult = null;

      // 1. Native BarcodeDetector (Chrome/Android)
      if ('BarcodeDetector' in window) {
        try {
          const detector = new BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf', 'codabar']
          });
          const barcodes = await detector.detect(img);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            barcodeResult = barcodes[0].rawValue;
          }
        } catch (e) { }
      }

      // 2. ZXing fallback with smart resolution downscaling
      if (!barcodeResult && typeof ZXing !== 'undefined') {
        const reader = getZXingMultiReader();
        if (reader) {
          const origW = img.naturalWidth || img.width;
          const origH = img.naturalHeight || img.height;

          // Scale down high-megapixel phone camera images to ~1200px max dimension
          const maxDim = 1200;
          let targetW = origW;
          let targetH = origH;
          if (origW > maxDim || origH > maxDim) {
            if (origW > origH) {
              targetH = Math.round((origH * maxDim) / origW);
              targetW = maxDim;
            } else {
              targetW = Math.round((origW * maxDim) / origH);
              targetH = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, targetW, targetH);

          // Pass 1: Standard orientation
          try {
            const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
            const bin = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
            const res = reader.decode(bin);
            if (res && res.getText()) {
              barcodeResult = res.getText();
            }
          } catch (e) { }

          // Pass 2: 90-degree rotation (useful if barcode is horizontal and photo was shot portrait)
          if (!barcodeResult) {
            try {
              const rCanvas = document.createElement('canvas');
              rCanvas.width = targetH;
              rCanvas.height = targetW;
              const rCtx = rCanvas.getContext('2d');
              rCtx.translate(targetH / 2, targetW / 2);
              rCtx.rotate(90 * Math.PI / 180);
              rCtx.drawImage(canvas, -targetW / 2, -targetH / 2);
              const rLum = new ZXing.HTMLCanvasElementLuminanceSource(rCanvas);
              const rBin = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(rLum));
              const res = reader.decode(rBin);
              if (res && res.getText()) {
                barcodeResult = res.getText();
              }
            } catch (e) { }
          }

          // Pass 3: 270-degree rotation
          if (!barcodeResult) {
            try {
              const rCanvas2 = document.createElement('canvas');
              rCanvas2.width = targetH;
              rCanvas2.height = targetW;
              const rCtx2 = rCanvas2.getContext('2d');
              rCtx2.translate(targetH / 2, targetW / 2);
              rCtx2.rotate(270 * Math.PI / 180);
              rCtx2.drawImage(canvas, -targetW / 2, -targetH / 2);
              const rLum2 = new ZXing.HTMLCanvasElementLuminanceSource(rCanvas2);
              const rBin2 = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(rLum2));
              const res = reader.decode(rBin2);
              if (res && res.getText()) {
                barcodeResult = res.getText();
              }
            } catch (e) { }
          }
        }
      }

      URL.revokeObjectURL(url);
      resolve(barcodeResult);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

async function handleCapturedBarcodeFile(file) {
  if (!file) return;

  const previewWrap = els('camPhotoPreviewWrap');
  const previewImg = els('camPhotoPreviewImg');
  const overlay = els('camDecodingOverlay');
  const feedback = els('camSnapFeedback');
  const promptWrap = els('camSnapPromptWrap');
  const actionBtnText = els('camSnapActionBtnText');

  if (previewWrap && previewImg) {
    previewWrap.classList.remove('hidden');
    previewImg.src = URL.createObjectURL(file);
  }
  if (promptWrap) promptWrap.classList.add('hidden');
  if (overlay) overlay.classList.remove('hidden');
  if (feedback) { feedback.className = 'cam-snap-feedback hidden'; feedback.textContent = ''; }

  const detectedCode = await decodeBarcodeFromImage(file);

  if (overlay) overlay.classList.add('hidden');

  if (detectedCode) {
    const isContinuous = els('camContinuousCheck')?.checked;
    if (feedback) {
      feedback.className = 'cam-snap-feedback success';
      feedback.innerHTML = `✅ <strong>Barcode Scanned:</strong> ${escapeHtml(detectedCode)}`;
      feedback.classList.remove('hidden');
    }
    if (actionBtnText) {
      actionBtnText.textContent = isContinuous ? '📸 Snap Next Product' : '📸 Snap Another';
    }
    onCameraBarcodeFound(detectedCode);
  } else {
    playScanBeep(false);
    if (feedback) {
      feedback.className = 'cam-snap-feedback error';
      feedback.innerHTML = `⚠️ <strong>No barcode detected.</strong> Please ensure the barcode is sharp, well-lit, and try again.`;
      feedback.classList.remove('hidden');
    }
    if (actionBtnText) {
      actionBtnText.textContent = '🔄 Retake Barcode Photo';
    }
  }

  // Clear file input value to allow snapping same code or re-trying
  if (els('camSnapInput')) els('camSnapInput').value = '';
  if (els('camFileInput')) els('camFileInput').value = '';
}

async function startCameraScanner(deviceId = null) {
  stopCameraScanner();
  const video = els('camScanVideo');
  if (!video) return;

  const errorBox = els('camScanError');
  const viewfinder = els('camViewfinder');
  const errorText = els('camScanErrorText');
  const errorSub = els('camScanErrorSub');

  if (errorBox) errorBox.classList.add('hidden');
  if (viewfinder) viewfinder.classList.remove('hidden');

  // Check if getUserMedia is supported
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (errorBox) errorBox.classList.remove('hidden');
    if (viewfinder) viewfinder.classList.add('hidden');
    if (errorText) errorText.textContent = 'Live video requires HTTPS on mobile';
    if (errorSub) errorSub.textContent = 'Mobile browsers block live camera video on unencrypted HTTP LAN. Use the Phone Camera Snap button below!';
    return;
  }

  // Multi-step constraint fallback
  const constraintList = [
    deviceId
      ? { video: { deviceId: { exact: deviceId } } }
      : { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: { ideal: 'environment' } } },
    { video: true }
  ];

  let stream = null;
  let lastErr = null;

  for (const c of constraintList) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(c);
      if (stream) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!stream) {
    console.warn('[CameraScanner] All camera constraints failed:', lastErr);
    if (errorBox) errorBox.classList.remove('hidden');
    if (viewfinder) viewfinder.classList.add('hidden');
    if (errorText) {
      errorText.textContent = lastErr && lastErr.name === 'NotAllowedError'
        ? 'Camera permission denied'
        : 'Camera unavailable for live stream';
    }
    if (errorSub) {
      errorSub.textContent = 'You can tap below to snap with your phone camera directly instead!';
    }
    return;
  }

  try {
    camStream = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.srcObject = camStream;
    await video.play().catch(e => console.warn('[CameraScanner] video play warning:', e));

    // Check torch capability
    const track = camStream.getVideoTracks()[0];
    const torchBtn = els('camTorchBtn');
    if (track && torchBtn) {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      torchBtn.style.display = caps.torch ? 'inline-block' : 'none';
    }

    enumerateCameras();
    camScanning = true;
    startBarcodeLoop();
  } catch (err) {
    console.warn('[CameraScanner] Error playing video stream:', err);
    if (errorBox) errorBox.classList.remove('hidden');
    if (viewfinder) viewfinder.classList.add('hidden');
  }
}

async function enumerateCameras() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    const select = els('camSelect');
    if (!select || videoDevices.length <= 1) return;

    select.innerHTML = videoDevices.map((d, i) =>
      `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`
    ).join('');
  } catch (e) { }
}

async function toggleCameraTorch() {
  if (!camStream) return;
  const track = camStream.getVideoTracks()[0];
  if (!track) return;
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (!caps.torch) return;
    camTorchOn = !camTorchOn;
    await track.applyConstraints({ advanced: [{ torch: camTorchOn }] });
    const btn = els('camTorchBtn');
    if (btn) btn.textContent = camTorchOn ? '🔦 Torch ON' : '🔦 Torch';
  } catch (e) { }
}

function stopCameraScanner() {
  camScanning = false;
  camTorchOn = false;
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  const video = els('camScanVideo');
  if (video) video.srcObject = null;
}

function closeScanBarcodeModal() {
  stopCameraScanner();
  hideModal('scanBarcodeModal');
}

function onCameraBarcodeFound(code) {
  if (!code) return;
  const barcode = normalizeBarcode(code);
  if (!barcode) return;
  const now = Date.now();

  // Only capture into the product form when that form is genuinely open;
  // otherwise a stale target must not swallow POS scans.
  const addProductActive = els('view-add-product')?.classList.contains('active');
  if (scannerTarget === 'add-product' && addProductActive) {
    closeScanBarcodeModal();
    setProductBarcode(barcode);
    toast(`Barcode set: ${barcode}`, 'success');
    return;
  }

  // POS Sale Target
  const isContinuous = els('camContinuousCheck')?.checked;

  // Debounce duplicate reads in continuous mode within 1.3s
  if (isContinuous && barcode === lastDetectedBarcode && (now - lastDetectTime < 1300)) {
    return;
  }
  lastDetectedBarcode = barcode;
  lastDetectTime = now;

  const product = findProductByCode(barcode);
  const success = scanProductToCart(barcode);

  // In-modal feedback so the user can see what happened without closing the camera
  const hint = document.querySelector('#camViewfinder .cam-hint');
  if (hint) {
    hint.textContent = success
      ? `✓ ${product ? product.name : 'Product'} added to cart`
      : `Not found: ${barcode} — try another barcode`;
    setTimeout(() => { hint.textContent = 'Position barcode inside frame'; }, 2200);
  }

  if (isContinuous) {
    // Flash viewfinder border green (or red if not found) and keep camera active
    const vf = els('camViewfinder');
    if (vf) {
      vf.style.borderColor = success ? '#10b981' : '#ef4444';
      vf.style.boxShadow = success ? '0 0 20px rgba(16, 185, 129, 0.7)' : '0 0 20px rgba(239, 68, 68, 0.7)';
      setTimeout(() => {
        vf.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        vf.style.boxShadow = 'none';
      }, 500);
    }
  } else if (success) {
    setTimeout(() => closeScanBarcodeModal(), 400);
  }
}

async function startBarcodeLoop() {
  const video = els('camScanVideo');
  const canvas = els('camScanCanvas');
  if (!video || !canvas) return;

  const BARCODE_FORMATS = [
    'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128',
    'code_39', 'qr_code', 'itf', 'codabar'
  ];

  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
    } catch (e) {
      try { detector = new BarcodeDetector(); } catch (e2) { }
    }
  }

  const zReader = getZXingMultiReader();
  const ctx = canvas.getContext('2d');
  let frameCount = 0;

  async function detect() {
    if (!camScanning) return;
    if (video.readyState >= 2) {
      frameCount++;
      let detectedCode = null;

      // 1. Try BarcodeDetector
      if (detector) {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            detectedCode = barcodes[0].rawValue;
          }
        } catch (e) { }
      }

      // 2. Fallback to ZXing if BarcodeDetector didn't detect or every 2nd frame
      if (!detectedCode && zReader && frameCount % 2 === 0) {
        try {
          const w = Math.min(video.videoWidth || 640, 800);
          const h = Math.round((w * (video.videoHeight || 480)) / (video.videoWidth || 640));
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
          const bin = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
          const res = zReader.decode(bin);
          if (res && res.getText()) {
            detectedCode = res.getText();
          }
        } catch (e) { }
      }

      if (detectedCode) {
        onCameraBarcodeFound(detectedCode);
      }
    }

    if (camScanning) {
      requestAnimationFrame(detect);
    }
  }

  detect();
}

// ══════════════════════════════════════════════════════════════
//   HARDWARE BARCODE SCANNER LISTENER (USB / Bluetooth Keyboard Wedge)
// ══════════════════════════════════════════════════════════════
(function initHardwareScanner() {
  let buffer = '';
  let lastKeyTime = 0;

  window.addEventListener('keydown', e => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;

    const nowTime = Date.now();
    const timeDiff = nowTime - lastKeyTime;
    lastKeyTime = nowTime;

    if (e.key === 'Enter') {
      if (buffer.length >= 3 && timeDiff < 90) {
        const scannedCode = buffer.trim();
        buffer = '';
        e.preventDefault();
        e.stopPropagation();

        const addProductView = els('view-add-product');
        const isAddProductActive = addProductView && addProductView.classList.contains('active');
        const scanModal = els('scanBarcodeModal');
        const isScanModalOpen = scanModal && !scanModal.classList.contains('hidden');

        if (isScanModalOpen) {
          onCameraBarcodeFound(scannedCode);
          return;
        }

        if (isAddProductActive) {
          setProductBarcode(scannedCode);
          return;
        }

        const posView = els('view-pos');
        if (posView && posView.classList.contains('active')) {
          scanProductToCart(scannedCode);
          return;
        }

        const invView = els('view-inventory');
        if (invView && invView.classList.contains('active')) {
          const invSearch = els('inventorySearchInput');
          if (invSearch) {
            invSearch.value = scannedCode;
            renderInventory();
            toast(`Filtered inventory by barcode: ${scannedCode}`, 'info');
          }
          return;
        }
      }
      buffer = '';
      return;
    }

    if (timeDiff > 100) {
      buffer = '';
    }

    if (e.key.length === 1) {
      buffer += e.key;
    }
  }, true);
})();

document.addEventListener('DOMContentLoaded', init);

/* ══════════════════════════════════════════════════════════════
   MOBILE SCANNER MODULE – Socket.IO Integration
   Handles QR pairing, connection status, and barcode → cart
══════════════════════════════════════════════════════════════ */

(function MobileScanner() {
  'use strict';

  // ── STATE ────────────────────────────────────────────────
  // Derive server URL from current page origin so it works on both
  // localhost and when opened on a phone via the LAN IP (e.g. 192.168.x.x:3000)
  const SERVER_URL = window.location.origin;
  let socket = null;
  let socketId = null;
  let pairingToken = null;
  let sessionId = null;
  let scannerState = 'disconnected'; // disconnected | connecting | connected
  let countdownTimer = null;
  let countdownSecs = 300; // 5 minutes

  const el = id => document.getElementById(id);

  // ── SOCKET.IO AVAILABILITY CHECK ─────────────────────────
  function isSocketIOAvailable() {
    return typeof io !== 'undefined';
  }

  // ── STATUS HELPERS ────────────────────────────────────────
  function setScannerState(state, label) {
    scannerState = state;

    // Update topbar button
    const btn = el('connectMobileBtn');
    const badge = el('mobileStatusBadge');
    if (btn) {
      btn.classList.toggle('connected', state === 'connected');
    }
    if (badge) {
      badge.className = 'mobile-status-badge';
      badge.textContent = label || state;
      if (state === 'connected') badge.classList.add('badge-connected');
      if (state === 'connecting') badge.classList.add('badge-connecting');
    }

    // Update modal pill
    const pill = el('modalStatusPill');
    const pillText = el('modalStatusText');
    if (pill) {
      pill.setAttribute('data-status', state);
      if (pillText) pillText.textContent = label || state;
    }

    // Show/hide modal sections based on state
    const qrSec = el('qrSection');
    const conSec = el('connectedSection');
    const genSec = el('generatingSection');
    if (qrSec && conSec && genSec) {
      qrSec.style.display = state === 'disconnected' ? 'block' : 'none';
      conSec.style.display = state === 'connected' ? 'block' : 'none';
      genSec.style.display = state === 'connecting' ? 'block' : 'none';
    }
  }

  // ── QR CODE GENERATION ───────────────────────────────────
  async function generateQR(url) {
    const canvas = el('qrCanvas');
    if (!canvas) return;
    if (typeof QRCode === 'undefined') {
      // Fallback: show URL as text
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111';
      ctx.font = '11px monospace';
      ctx.fillText('QRCode lib not loaded', 10, 100);
      return;
    }
    try {
      await QRCode.toCanvas(canvas, url, {
        width: 200,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    } catch (e) {
      console.error('QR generation error:', e);
    }
  }

  // ── COUNTDOWN TIMER ──────────────────────────────────────
  function startCountdown(seconds) {
    stopCountdown();
    countdownSecs = seconds;
    function tick() {
      const m = Math.floor(countdownSecs / 60);
      const s = countdownSecs % 60;
      const cd = el('qrCountdown');
      if (cd) cd.textContent = m + ':' + String(s).padStart(2, '0');
      if (countdownSecs <= 0) {
        stopCountdown();
        if (scannerState === 'disconnected') {
          toast('QR code expired. Please open the modal again for a new one.', 'warning');
          setScannerState('disconnected', 'Disconnected');
        }
        return;
      }
      countdownSecs--;
      countdownTimer = setTimeout(tick, 1000);
    }
    tick();
  }

  function stopCountdown() {
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
  }

  // ── INIT SOCKET CONNECTION ────────────────────────────────
  function initSocket() {
    if (socket && socket.connected) return;
    if (!isSocketIOAvailable()) {
      console.warn('[MobileScanner] Socket.IO not available. Run: node server.js');
      return;
    }

    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 20,
    });

    socket.on('connect', () => {
      socketId = socket.id;
      console.log('[MobileScanner] Connected to server:', socketId);
      socket.emit('desktop-register');
    });

    socket.on('scanner-connected', ({ sessionId: sid }) => {
      sessionId = sid;
      setScannerState('connected', 'Connected');
      stopCountdown();
      toast('📱 Mobile scanner connected!', 'success');
      // If modal is open, switch to connected view
      const modal = el('mobileScannerModal');
      if (modal && !modal.classList.contains('hidden')) {
        setScannerState('connected', 'Connected');
      }
    });

    socket.on('scanner-disconnected', ({ reason }) => {
      sessionId = null;
      setScannerState('disconnected', 'Disconnected');
      const msg = reason === 'manual'
        ? 'Scanner disconnected.'
        : 'Mobile scanner disconnected.';
      toast(msg, 'warning');
    });

    socket.on('barcode-received', ({ barcode, eventId }) => {
      handleBarcode(barcode, eventId);
    });

    socket.on('disconnect', () => {
      console.log('[MobileScanner] Server disconnected');
      if (scannerState === 'connected') {
        setScannerState('disconnected', 'Disconnected');
      }
    });

    socket.on('connect_error', err => {
      console.warn('[MobileScanner] Connect error:', err.message);
    });
  }

  // ── HANDLE BARCODE FROM MOBILE ────────────────────────────
  function handleBarcode(barcode, eventId) {
    if (!barcode) return;
    barcode = String(barcode).trim();
    console.log('[MobileScanner] Barcode received:', barcode);

    // If currently on Add Product page or scan modal is open in add-product mode:
    const addProductView = els('view-add-product');
    const isAddProductActive = addProductView && addProductView.classList.contains('active');
    const scanModal = els('scanBarcodeModal');
    const isScanModalOpen = scanModal && !scanModal.classList.contains('hidden');

    if (isAddProductActive || (isScanModalOpen && scannerTarget === 'add-product')) {
      if (typeof setProductBarcode === 'function') {
        setProductBarcode(barcode);
      }
      if (isScanModalOpen && typeof hideModal === 'function') {
        hideModal('scanBarcodeModal');
      }
      if (socket && pairingToken) {
        socket.emit('product-result', {
          token: pairingToken,
          found: true,
          product: { name: 'Barcode Scanned', price: barcode, message: 'Captured into Add Product ✓' },
        });
      }
      return;
    }

    // POS Sale Mode: Scan directly to cart
    // Make sure the desktop is actually showing the POS so the item is visible
    const posView = els('view-pos');
    if (posView && !posView.classList.contains('active')) {
      if (typeof switchToView === 'function') switchToView('pos');
    }
    const added = scanProductToCart(barcode);
    const product = findProductByCode(barcode);

    if (added && product) {
      if (socket && pairingToken) {
        socket.emit('product-result', {
          token: pairingToken,
          found: true,
          product: { name: product.name, price: product.price },
        });
      }
    } else {
      if (socket && pairingToken) {
        socket.emit('product-result', {
          token: pairingToken,
          found: false,
          product: null,
        });
      }
    }
  }

  window.handleBarcode = handleBarcode;
  window.openPairingModal = openPairingModal;

  // ── OPEN PAIRING MODAL ────────────────────────────────────
  async function openPairingModal() {
    if (!isSocketIOAvailable()) {
      alert('Socket.IO server is not running.\n\nPlease start the server first:\n\n  node server.js\n\nThen reload this page and try again.');
      return;
    }

    // Ensure socket is connected
    initSocket();
    showModal('mobileScannerModal');

    if (scannerState === 'connected') {
      // Already connected – just show connected view
      setScannerState('connected', 'Connected');
      return;
    }

    // Show generating spinner
    setScannerState('connecting', 'Generating…');

    // Wait for socket to connect (max 4 seconds)
    let waited = 0;
    while ((!socket || !socket.connected) && waited < 4000) {
      await new Promise(r => setTimeout(r, 200));
      waited += 200;
    }

    if (!socket || !socket.connected) {
      setScannerState('disconnected', 'Disconnected');
      toast('Cannot reach server. Is server.js running?', 'error');
      return;
    }

    socketId = socket.id;

    try {
      // Request pairing token from server
      const resp = await fetch(SERVER_URL + '/api/create-pairing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desktopSocketId: socketId }),
      });
      const data = await resp.json();

      if (!data.token) throw new Error('No token returned');

      pairingToken = data.token;

      // Build scanner URL using LAN IP so the phone can reach it.
      // Prefer HTTPS when the server has a cert: mobile browsers only expose
      // the live camera (getUserMedia) on secure origins, never on http://LAN-IP.
      let lanBase = SERVER_URL; // fallback: current origin
      let usingHttps = window.location.protocol === 'https:';
      try {
        const ipResp = await fetch(SERVER_URL + '/api/lan-ip');
        if (ipResp.ok) {
          const ipData = await ipResp.json();
          if (ipData.ip && ipData.ip !== 'localhost') {
            if (ipData.https) {
              usingHttps = true;
              lanBase = `https://${ipData.ip}:${ipData.securePort || 3443}`;
            } else {
              lanBase = `http://${ipData.ip}:${ipData.port || 3000}`;
            }
          }
        }
      } catch (e) { /* keep fallback */ }

      const scannerURL = `${lanBase}/scanner.html?token=${pairingToken}`;

      // Show the phone-certificate hint only when using the self-signed HTTPS URL
      const qrNote = el('qrNote');
      if (qrNote) qrNote.style.display = usingHttps ? 'block' : 'none';

      el('scannerUrl').textContent = scannerURL;
      el('scannerUrl').href = scannerURL;

      // Render QR code
      await generateQR(scannerURL);

      // Show QR section and start countdown
      setScannerState('disconnected', 'Waiting for mobile…');
      startCountdown(Math.floor((data.expiresIn || 300000) / 1000));
    } catch (err) {
      console.error('[MobileScanner] Pairing error:', err);
      setScannerState('disconnected', 'Disconnected');
      toast('Failed to generate QR code. Check if server.js is running.', 'error');
    }
  }

  // ── DISCONNECT SCANNER ────────────────────────────────────
  function disconnectScanner() {
    if (!socket || !pairingToken) return;
    socket.emit('disconnect-scanner', { token: pairingToken });
    pairingToken = null;
    sessionId = null;
    setScannerState('disconnected', 'Disconnected');
    toast('Scanner disconnected.', 'info');
    hideModal('mobileScannerModal');
  }

  // ── BIND EVENTS ───────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Auto-connect socket on page load (background, silent)
    setTimeout(() => {
      if (isSocketIOAvailable()) initSocket();
    }, 1000);

    // Connect Mobile button
    const connectBtn = el('connectMobileBtn');
    if (connectBtn) {
      connectBtn.addEventListener('click', openPairingModal);
    }

    // Modal close
    const closeBtn = el('closeMobileScannerModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => hideModal('mobileScannerModal'));
    }

    // Disconnect button inside modal
    const discBtn = el('disconnectScannerBtn');
    if (discBtn) {
      discBtn.addEventListener('click', disconnectScanner);
    }
  });

})();

/* ══════════════════════════════════════════════════════════════
   WHATSAPP INVOICE MODULE
   Official Meta WhatsApp Cloud API (via the local server proxy)
   + wa.me deep-link fallback when not connected.
══════════════════════════════════════════════════════════════ */

(function WhatsAppInvoices() {
  'use strict';

  const el = id => document.getElementById(id);

  const DEFAULT_CONFIG = {
    phoneNumberId: '',
    wabaId: '',
    token: '',
    apiVersion: 'v21.0',
    senderName: 'Hisaab POS',
    autoSend: false,
    templateName: '',
    templateLang: 'en',
    format: 'pdf',
    verifiedName: '',
    displayPhone: ''
  };

  let config = Object.assign({}, DEFAULT_CONFIG, DB.get('waConfig') || {});
  let sendLog = DB.get('waLog') || [];
  let pendingSale = null;
  let pendingPdfUrl = '';
  let pendingLinkForInv = '';
  let busy = false;

  const isConfigured = () => !!(config.phoneNumberId && config.token);

  function persist() { DB.set('waConfig', config); }
  function persistLog() { DB.set('waLog', sendLog.slice(0, 50)); }

  function setMsg(id, text, type) {
    const n = el(id);
    if (!n) return;
    if (!text) { n.className = 'wa-msg'; n.textContent = ''; return; }
    n.className = 'wa-msg show ' + (type || 'info');
    n.textContent = text;
  }

  /* ── PHONE ─────────────────────────────────────────────── */

  function normalizeNumber(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10) d = '91' + d;
    else if (d.length === 11 && d.charAt(0) === '0') d = '91' + d.slice(1);
    return d;
  }

  function prettyNumber(d) {
    return d ? '+' + String(d).replace(/^(\d{2})(\d{5})(\d{5})$/, '$1 $2 $3') : '';
  }

  /* ── INVOICE TEXT ──────────────────────────────────────── */

  function buildInvoiceText(sale) {
    const shop = (config.senderName || 'Hisaab POS').trim();
    const out = [];

    out.push('*' + shop + '*');
    out.push('Invoice: *' + sale.invNo + '*');
    out.push(sale.date || '');
    if (sale.customer && sale.customer !== 'Walk-in') out.push('Customer: ' + sale.customer);
    out.push('');

    (sale.items || []).forEach((item, i) => {
      const lineTotal = lineTotalOf(item);
      out.push((i + 1) + '. ' + item.name);
      out.push('   ' + item.qty + ' ' + (item.unit || '') + ' x ' + fmt(item.price) + ' = *' + fmt(lineTotal) + '*');
    });

    out.push('');
    out.push('Subtotal: ' + fmt(sale.subtotal));
    saleTaxLines(sale).forEach(r => out.push(r.label + ': ' + fmt(r.value)));
    if (sale.shipping) out.push('Shipping: ' + fmt(sale.shipping));
    if (sale.discount) out.push('Discount: -' + fmt(sale.discount));
    out.push('*TOTAL: ' + fmt(sale.total) + '*');
    out.push('Payment: ' + String(sale.payment || '').toUpperCase());

    const st = salePaymentStatus(sale);
    const dueAmt = Math.max(0, Number(sale.balanceDue) || 0);
    const advAmt = Math.max(0, Number(sale.advanceCredit) || 0);
    const advUsed = Math.max(0, Number(sale.advanceUsed) || 0);

    out.push('Status: ' + (st === 'Partial' ? 'PARTIALLY PAID' : st.toUpperCase()));
    if (advUsed > 0) out.push('Advance used: -' + fmt(advUsed));
    if (dueAmt > 0) out.push('*Balance due: ' + fmt(dueAmt) + '*');
    if (advAmt > 0) out.push('Advance credited: ' + fmt(advAmt));

    out.push('');
    out.push('Thank you for shopping with us!');

    return out.join('\n');
  }

  function buildInvoiceMessage(sale, pdfUrl) {
    const base = buildInvoiceText(sale);
    if (!pdfUrl) return base;
    return base + '\n\nView & download your invoice (PDF):\n' + pdfUrl;
  }

  async function createInvoiceLink(sale) {
    const pdf = buildInvoicePdf(sale);
    let resp;
    try {
      resp = await fetch('/api/invoice-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64: pdf.base64,
          filename: pdf.filename,
          invNo: sale && sale.invNo ? sale.invNo : ''
        })
      });
    } catch (e) {
      throw new Error('Cannot reach server to create invoice link. Start/restart the POS server (node server.js) and try again.');
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok || !data.url) {
      const msg = (data && data.error) || ('Could not generate invoice link (server returned ' + resp.status + '). Restart the POS server to enable invoice links.');
      throw new Error(msg);
    }
    const path = data.url;
    const fullUrl = /^https?:\/\//i.test(path) ? path : (window.location.origin + path);
    return fullUrl;
  }

  /* ── PDF INVOICE ───────────────────────────────────────── */

  // jsPDF's built-in fonts have no ₹ glyph, so PDFs use "Rs."
  function rs(n) { return 'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Defensive line total – missing tax/discount fields fall back to 0
  function lineTotalOf(item) {
    try {
      return calcItemTotal(Object.assign({ itemDiscount: 0, tax: 0, qty: 0, price: 0 }, item)).total;
    } catch (e) {
      return (Number(item.price) || 0) * (Number(item.qty) || 0);
    }
  }

  function buildInvoicePdf(sale) {
    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) throw new Error('PDF library not loaded');

    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const M = 15;                 // page margin
    const W = 210;                // A4 width
    const RIGHT = W - M;
    let y = M;

    const shop = (config.senderName || 'Hisaab POS').trim();
    const posSet = (typeof getPosSettings === 'function') ? getPosSettings() : (DB.get('posSettings') || {});

    // ── Header
    doc.setFillColor(124, 58, 237);
    doc.rect(0, 0, W, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text(shop, M, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('TAX INVOICE', M, 19.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('INVOICE', RIGHT, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(String(sale.invNo || ''), RIGHT, 19.5, { align: 'right' });

    y = 36;
    doc.setTextColor(30, 30, 40);

    // ── Payment status strip
    const st = salePaymentStatus(sale);
    const stLabel = st === 'Partial' ? 'PARTIALLY PAID' : st.toUpperCase();
    const dueAmt = Math.max(0, Number(sale.balanceDue) || 0);
    const advAmt = Math.max(0, Number(sale.advanceCredit) || 0);
    const advUsed = Math.max(0, Number(sale.advanceUsed) || 0);

    const stColor = st === 'Paid' ? [22, 163, 74] : (st === 'Partial' ? [217, 119, 6] : [220, 38, 38]);
    doc.setFillColor(stColor[0], stColor[1], stColor[2]);
    doc.rect(M, 30, W - M * 2, 7.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('PAYMENT STATUS: ' + stLabel, M + 3, 34.9);
    doc.setFontSize(8);
    doc.text(
      dueAmt > 0 ? 'BALANCE DUE: ' + rs(dueAmt)
        : (advAmt > 0 ? 'ADVANCE CREDIT: ' + rs(advAmt) : 'FULLY PAID'),
      RIGHT - 3, 34.9, { align: 'right' }
    );

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 40);
    y = 44;

    // ── Meta block
    doc.setFontSize(9);
    const meta = [
      ['Invoice No', String(sale.invNo || '')],
      ['Date', String(sale.date || '')],
      ['Customer', String(sale.customer || 'Walk-in')],
      ['Payment', String(sale.payment || '').toUpperCase()],
      ['Status', stLabel],
    ];
    if (sale.amountPaid !== undefined && sale.amountPaid !== null) {
      meta.push(['Amount Paid', rs(sale.amountPaid)]);
    }
    if (sale.placeOfSupply) meta.push(['Place of Supply', String(sale.placeOfSupply)]);
    const pdfTax = sale.taxBreakup
      ? Number(sale.taxBreakup.cgst || 0) + Number(sale.taxBreakup.sgst || 0) + Number(sale.taxBreakup.igst || 0)
      : 0;
    if (pdfTax > 0.000001) meta.push(['GST Type', sale.taxMode === 'inter' ? 'IGST (Inter-state)' : 'CGST + SGST (Intra-state)']);
    if (posSet.gstin) meta.push(['GSTIN', String(posSet.gstin)]);
    if (posSet.state) meta.push(['Business State', String(posSet.state)]);
    meta.forEach(function (row, i) {
      const yy = y + i * 5.4;
      doc.setTextColor(120, 125, 140);
      doc.text(row[0], M, yy);
      doc.setTextColor(30, 30, 40);
      doc.text(row[1], M + 24, yy);
    });

    y += meta.length * 5.4 + 6;

    // ── Table header
    const colItem = M;
    const colQty = 118;
    const colRate = 145;
    const colAmt = RIGHT;

    doc.setFillColor(243, 240, 255);
    doc.rect(M, y - 5, W - M * 2, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(70, 50, 140);
    doc.text('ITEM', colItem + 2, y);
    doc.text('QTY', colQty + 10, y, { align: 'right' });
    doc.text('RATE', colRate + 18, y, { align: 'right' });
    doc.text('AMOUNT', colAmt - 2, y, { align: 'right' });

    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 40);

    (sale.items || []).forEach(function (item) {
      const lineTotal = lineTotalOf(item);

      if (y > 258) { doc.addPage(); y = 20; }

      // Wrap long product names onto a second line instead of cutting them off
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const fullName = String(item.name || '');
      const nameLines = doc.splitTextToSize(fullName, 86);
      const name1 = nameLines[0] || '';
      const name2 = nameLines.length > 1 ? nameLines.slice(1).join(' ') : '';

      doc.text(name1, colItem + 2, y);
      doc.text(String(item.qty) + ' ' + (item.unit || ''), colQty + 10, y, { align: 'right' });
      doc.text(rs(item.price).replace('Rs. ', ''), colRate + 18, y, { align: 'right' });
      doc.text(rs(lineTotal).replace('Rs. ', ''), colAmt - 2, y, { align: 'right' });

      y += 4.6;
      if (name2) {
        doc.setFontSize(8.5);
        doc.text(name2, colItem + 2, y);
        y += 4.2;
      }

      const metaParts = [];
      if (item.hsn) metaParts.push('HSN: ' + item.hsn);
      if (item.sku) metaParts.push('SKU: ' + item.sku);
      if (item.tax) metaParts.push('GST: ' + item.tax + '%' + (item.taxInclusive ? ' (incl.)' : ''));
      if (metaParts.length) {
        doc.setFontSize(7.2);
        doc.setTextColor(135, 138, 150);
        doc.text(metaParts.join('   '), colItem + 2, y);
        doc.setTextColor(30, 30, 40);
        y += 3.4;
      } else {
        y += 1.2;
      }
    });

    // ── Totals
    if (y > 235) { doc.addPage(); y = 20; }
    y += 3;
    doc.setDrawColor(225, 225, 235);
    doc.line(M, y, RIGHT, y);
    y += 6;

    const rows = [['Subtotal', rs(sale.subtotal)]];
    saleTaxLines(sale).forEach(r => rows.push([r.label, rs(r.value)]));
    if (sale.shipping) rows.push(['Shipping', rs(sale.shipping)]);
    if (sale.discount) rows.push(['Discount', '-' + rs(sale.discount)]);
    if (advUsed > 0) rows.push(['Advance used', '-' + rs(advUsed)]);

    doc.setFontSize(9);
    rows.forEach(function (row) {
      doc.setTextColor(110, 115, 130);
      doc.text(row[0], 132, y);
      doc.setTextColor(30, 30, 40);
      doc.text(row[1], RIGHT, y, { align: 'right' });
      y += 5.4;
    });

    y += 1.5;
    doc.setFillColor(124, 58, 237);
    doc.rect(126, y - 5.5, RIGHT - 126, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL', 130, y + 0.8);
    doc.text(rs(sale.total), RIGHT - 2, y + 0.8, { align: 'right' });

    // Amount still owed / credit held, under the total bar
    doc.setFontSize(9);
    if (dueAmt > 0) {
      y += 12;
      doc.setTextColor(220, 38, 38);
      doc.text('Balance due', 132, y);
      doc.text(rs(dueAmt), RIGHT, y, { align: 'right' });
    }
    if (advAmt > 0) {
      y += 8;
      doc.setTextColor(124, 58, 237);
      doc.text('Advance credit', 132, y);
      doc.text(rs(advAmt), RIGHT, y, { align: 'right' });
    }

    // ── Footer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 145, 160);
    doc.text('Thank you for shopping with us!', M, 283);
    doc.text('Generated by ' + shop, RIGHT, 283, { align: 'right' });

    return {
      base64: doc.output('datauristring').split(',')[1],
      filename: 'Invoice-' + String(sale.invNo || 'POS').replace(/[^\w.-]/g, '') + '.pdf'
    };
  }

  /* ── SERVER CALLS ──────────────────────────────────────── */

  async function apiSendDocument(to, base64, filename, caption) {
    const resp = await fetch('/api/whatsapp/send-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumberId: config.phoneNumberId,
        token: config.token,
        apiVersion: config.apiVersion,
        to: to,
        filename: filename,
        caption: caption,
        pdfBase64: base64
      })
    });
    return resp.json();
  }

  async function apiSend(to, message, useTemplate) {
    const payload = {
      phoneNumberId: config.phoneNumberId,
      token: config.token,
      apiVersion: config.apiVersion,
      to: to,
      type: useTemplate ? 'template' : 'text',
      text: message,
      template: config.templateName,
      language: config.templateLang || 'en'
    };

    const resp = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return resp.json();
  }

  function openWaLink(to, message) {
    window.open('https://wa.me/' + to + '?text=' + encodeURIComponent(message), '_blank');
  }

  /* ── SENDING ───────────────────────────────────────────── */

  async function sendInvoice(sale, opts) {
    opts = opts || {};
    const to = normalizeNumber(opts.to);

    if (!to || to.length < 10) {
      return { ok: false, error: 'Enter a valid customer WhatsApp number.' };
    }

    let pdfUrl = opts.pdfUrl || '';
    if (!pdfUrl) {
      try {
        pdfUrl = await createInvoiceLink(sale);
      } catch (err) {
        const msg = 'Could not create invoice PDF link: ' + err.message;
        addLog({ invNo: sale.invNo, to: to, status: 'failed', detail: msg });
        return { ok: false, error: msg };
      }
    }

    const message = buildInvoiceMessage(sale, pdfUrl);

    if (!isConfigured()) {
      openWaLink(to, message);
      addLog({ invNo: sale.invNo, to: to, status: 'link', detail: 'Invoice PDF link opened in WhatsApp' });
      return { ok: true, via: 'link', pdfUrl };
    }

    let data = await apiSend(to, message, false);
    let via = 'api';

    // 131047 = outside the 24h customer-service window -> retry as a template
    if (!data.ok && config.templateName &&
      (data.code === 131047 || /24|re-engagement|template/i.test(data.error || ''))) {
      const retry = await apiSend(to, message, true);
      if (retry.ok) { data = retry; via = 'template'; }
      else data.error = data.error + ' (template "' + config.templateName + '" also failed: ' + retry.error + ')';
    }

    if (data.ok) {
      addLog({
        invNo: sale.invNo, to: to, status: 'sent',
        detail: 'Invoice PDF link sent' + (data.messageId ? ' · ' + data.messageId.slice(0, 18) + '…' : '')
      });
      return { ok: true, via: via, messageId: data.messageId, pdfUrl };
    }

    addLog({ invNo: sale.invNo, to: to, status: 'failed', detail: data.error || 'Unknown error' });
    return { ok: false, error: data.error || 'Meta rejected the message.', pdfUrl };
  }

  async function sendNow() {
    if (busy || !pendingSale) return;

    const to = el('waSendNumber').value.trim();
    if (!normalizeNumber(to)) {
      setMsg('waSendMsg', 'Enter a valid customer WhatsApp number.', 'err');
      return;
    }

    busy = true;
    if (el('waSendNowBtn')) el('waSendNowBtn').disabled = true;
    setMsg('waSendMsg', 'Generating invoice PDF link and sending…', 'info');

    try {
      const res = await sendInvoice(pendingSale, { to: to });
      if (res.ok) {
        if (res.via === 'link') {
          if (res.pdfUrl && el('waSendMessage')) el('waSendMessage').value = buildInvoiceMessage(pendingSale, res.pdfUrl);
          setMsg('waSendMsg', 'WhatsApp opened with the invoice PDF link. Press send in WhatsApp to deliver it.', 'ok');
          toast('Invoice link opened in WhatsApp', 'success');
        } else {
          if (res.pdfUrl && el('waSendMessage')) el('waSendMessage').value = buildInvoiceMessage(pendingSale, res.pdfUrl);
          setMsg('waSendMsg', 'Invoice PDF link sent to ' + prettyNumber(normalizeNumber(to)) + '.', 'ok');
          toast('Invoice PDF link sent on WhatsApp', 'success');
        }
        setTimeout(() => hideModal('waSendModal'), 1400);
      } else {
        setMsg('waSendMsg', res.error, 'err');
      }
    } catch (err) {
      setMsg('waSendMsg', 'Network error: ' + err.message, 'err');
    } finally {
      busy = false;
      if (el('waSendNowBtn')) el('waSendNowBtn').disabled = false;
    }
  }

  /* ── LOG ───────────────────────────────────────────────── */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addLog(entry) {
    sendLog.unshift({
      invNo: entry.invNo,
      to: entry.to,
      status: entry.status,
      detail: entry.detail || '',
      ts: Date.now()
    });
    persistLog();
    renderLog();
  }

  function renderLog() {
    const box = el('waLog');
    if (!box) return;

    if (!sendLog.length) {
      box.innerHTML = '<p class="wa-empty">No invoices sent yet.</p>';
      return;
    }

    box.innerHTML = sendLog.map(function (r) {
      const when = new Date(r.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      const label = r.status === 'sent' ? 'Sent' : (r.status === 'failed' ? 'Failed' : 'Link');
      return '<div class="wa-log-row">' +
        '<div class="wa-log-main">' +
        '<span class="wa-log-inv">' + r.invNo + ' &middot; ' + prettyNumber(r.to) + '</span>' +
        '<span class="wa-log-meta">' + when + (r.detail ? ' &middot; ' + escapeHtml(r.detail) : '') + '</span>' +
        '</div>' +
        '<span class="wa-log-badge ' + r.status + '">' + label + '</span>' +
        '</div>';
    }).join('');
  }

  /* ── VIEW ──────────────────────────────────────────────── */

  function setStatus(state, text) {
    const pill = el('waStatusPill');
    const label = el('waStatusText');
    if (pill) pill.setAttribute('data-state', state);
    if (label) label.textContent = text;
  }

  function renderView() {
    if (!el('view-whatsapp')) return;

    el('waPhoneNumberId').value = config.phoneNumberId || '';
    el('waWabaId').value = config.wabaId || '';
    el('waToken').value = config.token || '';
    el('waApiVersion').value = config.apiVersion || 'v21.0';
    el('waSenderName').value = config.senderName || '';
    el('waAutoSend').checked = !!config.autoSend;
    el('waTemplateName').value = config.templateName || '';
    el('waTemplateLang').value = config.templateLang || 'en';

    const isPdf = config.format !== 'text';
    if (el('waFormatPdf')) el('waFormatPdf').checked = isPdf;
    if (el('waFormatText')) el('waFormatText').checked = !isPdf;

    if (isConfigured()) {
      setStatus('connected', config.verifiedName || config.displayPhone || 'Connected');
    } else {
      setStatus('disconnected', 'Not connected');
    }

    renderLog();
  }

  function readForm() {
    config.phoneNumberId = el('waPhoneNumberId').value.trim();
    config.wabaId = el('waWabaId').value.trim();
    config.token = el('waToken').value.trim();
    config.apiVersion = el('waApiVersion').value.trim() || 'v21.0';
    config.senderName = el('waSenderName').value.trim() || 'Hisaab POS';
    config.autoSend = el('waAutoSend').checked;
    config.templateName = el('waTemplateName').value.trim();
    config.templateLang = el('waTemplateLang').value.trim() || 'en';

    const checkedFormat = document.querySelector('input[name="waFormat"]:checked');
    config.format = checkedFormat ? checkedFormat.value : (config.format || 'pdf');
  }

  async function testConnection() {
    readForm();
    persist();

    if (!config.phoneNumberId || !config.token) {
      setMsg('waConnMsg', 'Phone Number ID and Access Token are both required.', 'err');
      return;
    }

    setStatus('checking', 'Checking…');
    setMsg('waConnMsg', 'Contacting Meta…', 'info');

    try {
      const resp = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId: config.phoneNumberId,
          token: config.token,
          apiVersion: config.apiVersion
        })
      });
      const data = await resp.json();

      if (data.ok) {
        config.verifiedName = data.verifiedName || '';
        config.displayPhone = data.displayPhoneNumber || '';
        persist();
        setStatus('connected', config.verifiedName || config.displayPhone || 'Connected');
        setMsg('waConnMsg',
          'Connected to ' + (data.verifiedName || 'WhatsApp Business') +
          (data.displayPhoneNumber ? ' (' + data.displayPhoneNumber + ')' : '') + '.', 'ok');
        toast('WhatsApp connected', 'success');
      } else {
        setStatus('disconnected', 'Not connected');
        setMsg('waConnMsg', data.error || 'Verification failed.', 'err');
      }
    } catch (err) {
      setStatus('disconnected', 'Not connected');
      setMsg('waConnMsg', 'Could not reach the POS server: ' + err.message, 'err');
    }
  }

  /* ── SEND MODAL ────────────────────────────────────────── */

  async function ensurePendingInvoiceLink() {
    if (!pendingSale) throw new Error('No invoice selected.');
    const inv = String(pendingSale.invNo || '');
    if (pendingPdfUrl && pendingLinkForInv === inv) return pendingPdfUrl;
    const url = await createInvoiceLink(pendingSale);
    pendingPdfUrl = url;
    pendingLinkForInv = inv;
    return url;
  }

  async function openSend(sale) {
    if (!sale) return;
    pendingSale = sale;
    pendingPdfUrl = '';
    pendingLinkForInv = '';

    const custPhone = (typeof selectedCustomer !== 'undefined' && selectedCustomer) ? selectedCustomer.phone : '';
    if (el('waSendNumber')) el('waSendNumber').value = sale.customerPhone || custPhone || '';
    if (el('waSendMessage')) el('waSendMessage').value = buildInvoiceText(sale);

    const pdfBox = el('waSendPdf');
    if (pdfBox) pdfBox.checked = true;

    const hint = el('waSendPdfHint');
    if (hint) {
      hint.textContent = 'A secure PDF link for this invoice will be generated and included in the message.';
    }

    setMsg('waSendMsg', 'Generating invoice PDF link…', 'info');
    showModal('waSendModal');

    try {
      const url = await ensurePendingInvoiceLink();
      if (pendingSale !== sale) return; // modal switched to another sale
      if (el('waSendMessage')) el('waSendMessage').value = buildInvoiceMessage(sale, url);
      setMsg('waSendMsg', isConfigured()
        ? 'Invoice PDF link ready. Sending from ' + (config.verifiedName || config.displayPhone || 'your connected number') + '.'
        : 'Invoice PDF link ready. You can send it now or open WhatsApp with the link.',
        'ok');
    } catch (err) {
      if (pendingSale !== sale) return;
      setMsg('waSendMsg', 'Could not generate invoice PDF link: ' + err.message, 'err');
    }
  }

  /* ── AUTO-SEND ─────────────────────────────────────────── */

  async function onSaleComplete(sale) {
    if (!config.autoSend || !sale) return;

    const to = normalizeNumber(sale.customerPhone || '');
    if (!to) return;

    if (!isConfigured()) {
      toast('Auto-send needs WhatsApp connected (WhatsApp tab)', 'warning');
      return;
    }

    const res = await sendInvoice(sale, { to: to });
    if (res.ok) toast('Invoice auto-sent on WhatsApp', 'success');
    else toast('WhatsApp auto-send failed: ' + res.error, 'error');
  }

  /* ── BIND ──────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    renderView();

    if (el('waSaveBtn')) el('waSaveBtn').addEventListener('click', function () {
      readForm();
      persist();
      renderView();
      setMsg('waConnMsg', 'Settings saved locally.', 'ok');
      toast('WhatsApp settings saved', 'success');
    });

    if (el('waTestBtn')) el('waTestBtn').addEventListener('click', testConnection);

    if (el('waClearBtn')) el('waClearBtn').addEventListener('click', function () {
      if (!confirm('Disconnect WhatsApp and clear the saved credentials?')) return;
      config = Object.assign({}, DEFAULT_CONFIG);
      persist();
      renderView();
      setMsg('waConnMsg', 'Disconnected. Credentials removed from this browser.', 'info');
      toast('WhatsApp disconnected', 'info');
    });

    if (el('waToggleToken')) el('waToggleToken').addEventListener('click', function () {
      const input = el('waToken');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el('waToggleToken').textContent = show ? 'Hide' : 'Show';
    });

    if (el('waAutoSend')) el('waAutoSend').addEventListener('change', function () {
      readForm();
      persist();
    });

    document.querySelectorAll('input[name="waFormat"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        readForm();
        persist();
      });
    });

    if (el('waClearLogBtn')) el('waClearLogBtn').addEventListener('click', function () {
      sendLog = [];
      persistLog();
      renderLog();
    });

    if (el('whatsappReceiptBtn')) el('whatsappReceiptBtn').addEventListener('click', function () {
      openSend(window.__lastSale);
    });

    if (el('closeWaSend')) el('closeWaSend').addEventListener('click', function () { hideModal('waSendModal'); });
    if (el('waSendNowBtn')) el('waSendNowBtn').addEventListener('click', sendNow);

    if (el('waOpenLinkBtn')) el('waOpenLinkBtn').addEventListener('click', async function () {
      if (!pendingSale) return;
      const to = normalizeNumber(el('waSendNumber') ? el('waSendNumber').value : '');
      if (!to) { setMsg('waSendMsg', 'Enter a valid customer WhatsApp number.', 'err'); return; }
      try {
        setMsg('waSendMsg', 'Generating invoice PDF link…', 'info');
        const url = await ensurePendingInvoiceLink();
        const message = buildInvoiceMessage(pendingSale, url);
        if (el('waSendMessage')) el('waSendMessage').value = message;
        openWaLink(to, message);
        addLog({ invNo: pendingSale.invNo, to: to, status: 'link', detail: 'Invoice PDF link opened in WhatsApp' });
        setMsg('waSendMsg', 'WhatsApp opened with the invoice PDF link. Press send in WhatsApp to deliver it.', 'ok');
      } catch (err) {
        setMsg('waSendMsg', 'Could not generate invoice PDF link: ' + err.message, 'err');
      }
    });
  });

  window.HisaabWhatsApp = {
    openSend: openSend,
    onSaleComplete: onSaleComplete,
    buildInvoiceText: buildInvoiceText,
    renderView: renderView,
    isConfigured: isConfigured,
    // _buildInvoicePdf is exposed for diagnostics/testing only.
    _buildInvoicePdf: buildInvoicePdf,
    // _cloudApply lets the Supabase sync layer hydrate config/log from cloud.
    _cloudApply: function (key, value) {
      if (key === 'waConfig' && value && typeof value === 'object') {
        config = Object.assign({}, DEFAULT_CONFIG, value);
        try { localStorage.setItem('hisaab_waConfig', JSON.stringify(config)); } catch (e) { }
        renderConfigStatus();
        updateNavHint();
      }
      if (key === 'waLog' && Array.isArray(value)) {
        sendLog = value;
        try { localStorage.setItem('hisaab_waLog', JSON.stringify(sendLog)); } catch (e) { }
        renderLog();
      }
    }
  };
})();
