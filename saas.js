/* ══════════════════════════════════════════════════════════════
   HISAAB POS – SaaS client
   Subscription UI, plan gates, checkout and admin dashboard.

   Talks to the API mounted by saas/index.js:
     • bills are metered server-side
     • upgrades are verified server-side before activation
     • local mode: every installation gets a Free device account
     • cloud mode: the billing identity is derived from the signed-in
       Supabase user (see setIdentity), so a person keeps one account
       across devices and never gets a random guest account
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const LS = {
    device: 'hisaab_device_id',
    token: 'hisaab_saas_token',
    cycle: 'hisaab_saas_cycle',
    usageAlert: 'hisaab_saas_usage_alert'
  };

  const state = {
    booted: false,
    ready: false,
    refreshing: false,
    offline: false,
    anonymous: false,
    token: '',
    deviceId: '',
    // Cloud mode: the app is signed in through Supabase Auth, so billing is
    // keyed to the Supabase user instead of an auto-provisioned device.
    cloudMode: false,
    identityId: '',
    account: null,
    plan: null,
    subscription: null,
    usage: null,
    features: [],
    limits: null,
    plans: [],
    paymentConfig: null,
    payments: [],
    ledger: [],
    cycle: 'monthly',
    pendingOrder: null,
    authMode: 'login',
    upgradeReason: '',
    upgradeContext: null,
    admin: null,
    adminTab: 'overview',
    adminQuery: '',
    adminLoading: false,
    lastError: ''
  };

  const FEATURE_NAMES = {
    billing: 'POS billing',
    inventory: 'Inventory',
    receipts: 'Receipts',
    sales_history: 'Sales history',
    customers: 'Customers',
    whatsapp_share: 'WhatsApp sharing',
    expiry_alerts: 'Expiry alerts',
    returns: 'Sales returns',
    stock_timeline: 'Stock timeline',
    damage_tracking: 'Damaged stock',
    barcode_printing: 'Barcode printing',
    csv_export: 'CSV export',
    whatsapp_pdf: 'WhatsApp PDF',
    advanced_reports: 'Advanced reports',
    multi_store: 'Multi-store',
    priority_support: 'Priority support',
    api_access: 'API access',
    rewards: 'Points & Rewards',
    rewards_shopping_points: 'Shopping Points',
    rewards_free_product: 'Free Product rewards',
    rewards_offer_product: 'Offer Product rewards',
    rewards_share_earn: 'Share & Earn referrals',
    rewards_referral_monetary: 'Monetary referral rewards',
    rewards_referral_inventory_boost: 'Referral inventory limit increase',
    rewards_referral_usage_boost: 'Referral usage limit increase'
  };

  const GATED_VIEWS = {
    returns: 'returns',
    'stock-timeline': 'stock_timeline'
  };

  // Used only when the server is unreachable, so the UI can still render.
  const FALLBACK_PLANS = [
    {
      id: 'free', name: 'Free', badge: 'Free forever',
      tagline: 'Everything you need to start billing.',
      price: { monthly: 0, yearly: 0 },
      limits: { billsPerMonth: 50, products: 100, devices: 1 },
      features: ['billing', 'inventory', 'receipts', 'sales_history', 'customers', 'whatsapp_share', 'expiry_alerts'],
      highlights: ['50 bills per month', 'Up to 100 products', 'Thermal & A4 receipts', 'Low-stock and expiry alerts', 'WhatsApp text bill sharing']
    },
    {
      id: 'starter', name: 'Starter', badge: 'Most popular',
      tagline: 'For busy shops that bill every day.',
      price: { monthly: 29900, yearly: 299900 },
      limits: { billsPerMonth: 1000, products: 2000, devices: 3 },
      features: ['billing', 'inventory', 'receipts', 'sales_history', 'customers', 'whatsapp_share', 'expiry_alerts', 'returns', 'stock_timeline', 'damage_tracking', 'csv_export', 'whatsapp_pdf'],
      highlights: ['1,000 bills per month', 'Up to 2,000 products', 'Sales returns & damaged stock', 'Stock movement timeline', 'CSV export & WhatsApp PDF']
    },
    {
      id: 'pro', name: 'Pro', badge: 'Best value',
      tagline: 'Unlimited billing for growing businesses.',
      price: { monthly: 69900, yearly: 699900 },
      limits: { billsPerMonth: null, products: null, devices: 10 },
      features: ['billing', 'inventory', 'receipts', 'sales_history', 'customers', 'whatsapp_share', 'expiry_alerts', 'returns', 'stock_timeline', 'damage_tracking', 'csv_export', 'whatsapp_pdf', 'advanced_reports', 'multi_store', 'priority_support', 'api_access'],
      highlights: ['Unlimited bills', 'Unlimited products', 'Advanced reports', 'Multi-store ready', 'Priority support & API access']
    }
  ];

  /* ─── tiny helpers ───────────────────────────────────────── */

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(paise) {
    const n = Number(paise) || 0;
    return '\u20B9' + (n / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function moneyExact(paise) {
    const n = Number(paise) || 0;
    return '\u20B9' + (n / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
      ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function toastMsg(message, type) {
    if (typeof window.toast === 'function') window.toast(message, type || 'info');
    else console.log('[SaaS] ' + message);
  }

  function getProfile() {
    try { return typeof window.getUserProfile === 'function' ? window.getUserProfile() : {}; }
    catch (err) { return {}; }
  }

  function getStore() {
    try { return typeof window.getPosSettings === 'function' ? window.getPosSettings() : {}; }
    catch (err) { return {}; }
  }

  function productCount() {
    try {
      if (Array.isArray(window.products)) return window.products.length;
      // app.js stores the live catalog as a top-level `let products = [...]`
      // (script-scoped, not on window); read it directly when available.
      if (typeof products !== 'undefined' && Array.isArray(products)) return products.length;
      if (typeof DB !== 'undefined' && DB.get) {
        const p = DB.get('products');
        return Array.isArray(p) ? p.length : 0;
      }
      return 0;
    } catch (err) { return 0; }
  }

  function ensureDeviceId() {
    let id = '';
    try { id = localStorage.getItem(LS.device) || ''; } catch (err) { /* ignore */ }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
      id = 'dev_' + (window.crypto && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)));
      try { localStorage.setItem(LS.device, id); } catch (err) { /* ignore */ }
    }
    return id;
  }

  function readToken() {
    try { return localStorage.getItem(LS.token) || ''; } catch (err) { return ''; }
  }

  function saveToken(token) {
    state.token = token || '';
    try {
      if (token) localStorage.setItem(LS.token, token);
      else localStorage.removeItem(LS.token);
    } catch (err) { /* ignore */ }
  }

  function readCycle() {
    try {
      const c = localStorage.getItem(LS.cycle);
      return c === 'yearly' ? 'yearly' : 'monthly';
    } catch (err) { return 'monthly'; }
  }

  function saveCycle(cycle) {
    state.cycle = cycle === 'yearly' ? 'yearly' : 'monthly';
    try { localStorage.setItem(LS.cycle, state.cycle); } catch (err) { /* ignore */ }
  }

  /* ─── API ────────────────────────────────────────────────── */

  async function api(path, options) {
    const opts = options || {};
    const headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    try {
      const res = await fetch(path, {
        method: opts.method || 'GET',
        headers,
        credentials: 'same-origin',
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      });
      let data = {};
      try { data = await res.json(); } catch (err) { data = {}; }
      if (data && data.token) saveToken(data.token);
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, offline: true, data: {}, error: err.message };
    }
  }

  /* ─── state application ──────────────────────────────────── */

  function applyBilling(data) {
    if (!data) return;
    if (data.account) state.account = data.account;
    if (data.plan) state.plan = data.plan;
    if (data.subscription) state.subscription = data.subscription;
    if (data.usage) state.usage = data.usage;
    if (Array.isArray(data.features)) state.features = data.features;
    else if (data.plan && Array.isArray(data.plan.features)) state.features = data.plan.features;
    if (data.limits) state.limits = data.limits;
    else if (data.plan) state.limits = data.plan.limits;
    if (Array.isArray(data.plans) && data.plans.length) state.plans = data.plans;
    if (data.payment) state.paymentConfig = data.payment;
    state.offline = false;
    state.anonymous = false;
    state.ready = true;
  }

  function applyOffline() {
    const profile = getProfile();
    const store = getStore();
    const free = FALLBACK_PLANS[0];
    state.offline = true;
    state.ready = true;
    state.token = readToken();
    state.account = state.account || {
      id: 'local',
      email: null,
      contactEmail: profile.email || null,
      name: profile.name || 'Shop Owner',
      storeName: store.storeName || 'Hisaab Store',
      role: 'owner',
      status: 'active'
    };
    state.plan = free;
    state.subscription = {
      planId: 'free', effectivePlanId: 'free', status: 'offline',
      cycle: 'monthly', isPaid: false, daysLeft: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false
    };
    state.features = free.features.slice();
    state.limits = free.limits;
    state.usage = {
      period: '', bills: { used: 0, limit: null, remaining: null, percent: 0 },
      products: { used: productCount(), limit: null, remaining: null, percent: 0 },
      counters: { returns: 0, whatsapp: 0, exports: 0 }
    };
    state.plans = FALLBACK_PLANS;
    state.payments = [];
    state.ledger = [];
  }

  function hasFeature(feature) {
    if (!feature) return true;
    if (state.account && state.account.role === 'admin') return true;
    if (!state.ready || state.offline) return true;
    return (state.features || []).indexOf(feature) >= 0;
  }

  /* ─── Receipt watermark entitlement ───────────────────────────
     Backend-authoritative: resolves from the active plan's
     flags.pdfWatermark (set by Super Admin in the plan catalog).
     Returns true when the HISAAB watermark should appear on printed
     receipts (A4 + thermal). Offline/local mode defaults to true
     (free plan behaviour). Admin never gets a watermark.
     ───────────────────────────────────────────────────────────── */
  function canShowWatermark() {
    if (state.account && state.account.role === 'admin') return false;
    if (!state.ready || state.offline) return true;
    const plan = state.plan;
    if (!plan) return true;
    const flags = plan.flags || {};
    return !!flags.pdfWatermark;
  }

  /* ─── 80% monthly bill usage alert ───────────────────────────────────────
     Threshold is computed from the server-supplied usage bucket so it stays
     correct for paid subscription periods and the calendar-month free plan.
     The popup is announced once per billing cycle per account; the period
     string changes on renewal / month rollover, which re-arms the alert. */

  const USAGE_ALERT_PERCENT = 80;

  // Guards against re-entrant refresh loops when the subscription view
  // triggers a silent sync before rendering.
  let syncingUsageForView = false;

  function getUsageAlert() {
    if (!state.ready || state.offline || !state.token) return null;
    if (state.account && state.account.role === 'admin') return null;

    const usage = state.usage;
    if (!usage || !usage.period) return null;

    const bills = usage.bills || {};
    const limit = Number(bills.limit);
    const used = Math.max(0, Number(bills.used) || 0);
    if (!Number.isFinite(limit) || limit <= 0) return null;
    if (used * 100 < limit * USAGE_ALERT_PERCENT) return null;
    // At 100% the existing "monthly bill limit reached" checkout modal is the
    // right message; do not stack the 80% notice on top of it.
    if (used >= limit) return null;

    const percent = Math.max(0, Math.min(99, Math.round((used / limit) * 100)));
    return {
      key: 'usage80|' + usage.period + '|' + limit,
      period: usage.period,
      used: used,
      limit: limit,
      percent: percent,
      remaining: Math.max(0, limit - used),
      message: "You've used " + used + ' of ' + limit + ' bills this month (' + percent +
        '%). Upgrade to keep billing without interruption.'
    };
  }

  function readUsageAlertState() {
    try {
      const raw = localStorage.getItem(LS.usageAlert);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.tokens && typeof parsed.tokens === 'object') return parsed;
      // Older single-entry shape: migrate it into the token map.
      if (parsed && parsed.token) {
        const tokens = {};
        tokens[parsed.token] = parsed.shownAt || Date.now();
        return { tokens: tokens };
      }
    } catch (err) { /* ignore */ }
    return { tokens: {} };
  }

  function writeUsageAlertState(entry) {
    try { localStorage.setItem(LS.usageAlert, JSON.stringify(entry)); } catch (err) { /* ignore */ }
  }

  function usageAlertToken(alert) {
    // The limit is part of the token so a plan upgrade re-arms the notice for
    // the (higher) new limit instead of staying silent for the rest of the
    // cycle. A period change (renewal / month rollover) also re-arms it.
    return (state.identityId || state.deviceId || 'local') + '::' +
      (alert.period || '') + '::' + alert.limit;
  }

  function maybeNotifyUsage80() {
    const alert = getUsageAlert();
    if (!alert) {
      // Usage dropped back under the threshold, the plan changed, or the user
      // signed out: do not leave a stale notice on screen.
      if (typeof window.hideUsageAlertPopup === 'function') window.hideUsageAlertPopup();
      return null;
    }
    if (document.body && document.body.classList.contains('landing-active')) return alert;

    const token = usageAlertToken(alert);
    const seen = readUsageAlertState();
    if (seen.tokens[token]) return alert; // already announced this cycle

    if (typeof window.showUsageAlertPopup !== 'function') return alert;
    const shown = window.showUsageAlertPopup(alert);
    if (shown === false) return alert; // UI not ready yet; retry on next update

    seen.tokens[token] = Date.now();
    // Keep the marker small; a handful of cycles is more than enough.
    const tokens = Object.keys(seen.tokens);
    if (tokens.length > 20) {
      tokens.sort(function (a, b) { return seen.tokens[a] - seen.tokens[b]; })
        .slice(0, tokens.length - 20)
        .forEach(function (k) { delete seen.tokens[k]; });
    }
    writeUsageAlertState({ tokens: seen.tokens });
    return alert;
  }

  function openPricing() {
    if (typeof window.switchToView === 'function') {
      window.switchToView('subscription');
      return true;
    }
    return false;
  }

  /* ─── refresh ────────────────────────────────────────────── */

  let refreshPromise = null;

  async function refresh(options) {
    const opts = options || {};

    // Cloud mode with nobody signed in: there is no billing identity yet.
    // cloud.js shows the auth gate, so stay quiet instead of provisioning.
    if (state.cloudMode && !state.identityId) {
      state.ready = true;
      return { ok: false, status: 401, data: {} };
    }

    if (refreshPromise) return refreshPromise;
    refreshPromise = (async function () {
      state.refreshing = true;
      let r = await api('/api/billing/subscription');

      if (r.status === 401) {
        // No (or expired) session: provision the Free account for this
        // identity. In cloud mode the id is derived from the Supabase user,
        // so no random device account is ever created.
        const profile = getProfile();
        const store = getStore();
        const provision = await api('/api/auth/device', {
          method: 'POST',
          body: {
            deviceId: state.deviceId,
            email: profile.email || '',
            name: profile.name || 'Shop Owner',
            storeName: store.storeName || 'Hisaab Store'
          }
        });
        if (provision.ok) {
          if (provision.data.token) saveToken(provision.data.token);
          r = provision;
        } else if (provision.status === 0) {
          r = provision;
        }
      }

      if (r.ok) {
        applyBilling(r.data);
        await loadHistory();
        // Keep server-side inventory size in sync with the local catalog.
        try {
          var localCount = productCount();
          var serverCount = state.usage && state.usage.products ? Number(state.usage.products.used) || 0 : null;
          if ((state.token || state.deviceId) && !state.offline && serverCount !== null && localCount !== serverCount) {
            syncProducts(localCount);
          }
        } catch (err) { /* ignore */ }
      } else if (r.offline) {
        applyOffline();
      } else if (!state.account) {
        state.ready = true;
        state.lastError = (r.data && r.data.error) || 'Could not load subscription.';
        // In cloud mode the signed-in user is already known, so this is a
        // billing failure, not a "not signed in" state.
        state.anonymous = !state.cloudMode;
      }

      state.refreshing = false;
      renderAll();
      return r;
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
      state.refreshing = false;
      if (opts.silent !== true) renderAll();
    }
  }

  async function loadHistory() {
    const [payments, ledger] = await Promise.all([
      api('/api/billing/payments'),
      api('/api/usage/ledger?limit=25')
    ]);
    if (payments.ok && Array.isArray(payments.data.payments)) state.payments = payments.data.payments;
    if (ledger.ok && Array.isArray(ledger.data.entries)) state.ledger = ledger.data.entries;
  }

  /* ─── gates used by app.js ───────────────────────────────── */

  function canView(view) {
    const feature = GATED_VIEWS[view];
    if (!feature) return true;
    if (hasFeature(feature)) return true;
    openUpgrade(feature, feature === 'returns' ? 'Sales returns' : 'Stock timeline');
    return false;
  }

  function guard(feature, label) {
    if (hasFeature(feature)) return true;
    openUpgrade(feature, label || FEATURE_NAMES[feature] || feature);
    return false;
  }

  async function consumeBill(meta) {
    if (state.offline) return { allowed: true, local: true };
    // Resolve billing identity before metering so usage is never silently
    // skipped. In cloud mode the API can authenticate by device identity
    // (X-Device-Id) even when a bearer token is not issued, so do not gate
    // on token alone.
    if (!state.ready || (!state.token && !state.deviceId)) {
      try { await refresh({ silent: true }); } catch (e) { /* ignore */ }
    }
    if (!state.ready) return { allowed: true, local: true };
    if (!state.token && !state.deviceId) return { allowed: true, local: true };
    if (state.cloudMode && !state.identityId) return { allowed: true, local: true };
    const r = await api('/api/usage/consume', { method: 'POST', body: { kind: 'bill', meta: meta || {} } });
    if (r.ok) {
      if (r.data.usage) state.usage = r.data.usage;
      renderAll();
      return { allowed: true, usage: r.data.usage };
    }
    if (r.status === 402) {
      const data = r.data || {};
      if (data.plan) state.plan = data.plan;
      if (data.subscription) state.subscription = data.subscription;
      if (data.usage) state.usage = data.usage;
      if (Array.isArray(data.plans)) state.plans = data.plans;
      renderAll();
      openUpgrade('bills', 'Monthly bill limit reached', data);
      return { allowed: false, reason: data.error };
    }
    if (r.status === 403) {
      toastMsg((r.data && r.data.error) || 'This account is suspended.', 'error');
      return { allowed: false, reason: 'Account suspended' };
    }
    // Network hiccup: never block a sale that is otherwise valid.
    return { allowed: true, degraded: true };
  }

  /* Barcode printing entitlement. The UI gate (canPrintBarcodes) only reads the
     cached feature list; authorizeBarcodePrint makes the server the authority on
     every print so a manipulated client cannot silently bypass a plan
     restriction. */
  function canPrintBarcodes() {
    // No billing identity yet (standalone app, offline, or signed-out device):
    // keep local printing available — the server gate still applies whenever a
    // session exists. Same degradation rule as consumeBill.
    if (!state.ready || state.offline || !state.account) return true;
    if (state.account.role === 'admin') return true;
    return hasFeature('barcode_printing');
  }

  async function authorizeBarcodePrint() {
    if (state.offline) return { allowed: true, local: true };
    if (!state.ready) {
      try { await refresh({ silent: true }); } catch (e) { /* ignore */ }
    }
    if (!state.ready || (!state.token && !state.deviceId)) return { allowed: true, local: true };
    if (state.cloudMode && !state.identityId) return { allowed: true, local: true };
    const r = await api('/api/usage/consume', { method: 'POST', body: { kind: 'barcode_print', meta: {} } });
    if (r.ok) {
      if (r.data && r.data.usage) state.usage = r.data.usage;
      return { allowed: true };
    }
    if (r.status === 402) {
      const data = r.data || {};
      if (data.plan) state.plan = data.plan;
      if (data.subscription) state.subscription = data.subscription;
      if (Array.isArray(data.plans)) state.plans = data.plans;
      if (data.feature) {
        state.features = (state.features || []).filter(function (f) { return f !== data.feature; });
      }
      renderAll();
      openUpgrade('barcode_printing', 'Barcode printing', data);
      return { allowed: false, reason: data.error || 'Barcode printing is not included in your plan.' };
    }
    if (r.status === 403) {
      toastMsg((r.data && r.data.error) || 'This account is suspended.', 'error');
      return { allowed: false, reason: 'Account suspended' };
    }
    // Server unreachable: keep local/offline printing working (same rule as billing).
    return { allowed: true, degraded: true };
  }

  function canAddProduct(nextCount) {
    if (state.account && state.account.role === 'admin') return true;
    if (!state.ready || state.offline) return true;
    const limit = state.limits && state.limits.products;
    if (limit == null) return true;
    if (Number(nextCount) > Number(limit)) {
      openUpgrade('products', 'Product limit reached');
      return false;
    }
    return true;
  }

  async function syncProducts(count) {
    if (state.offline) return null;
    if (!state.ready || (!state.token && !state.deviceId)) {
      try { await refresh({ silent: true }); } catch (e) { /* ignore */ }
    }
    if (state.offline) return null;
    if (!state.ready || (!state.token && !state.deviceId)) return null;
    if (state.cloudMode && !state.identityId) return null;
    var n = Math.max(0, Number(count) || 0);
    try {
      const r = await api('/api/usage/products', { method: 'POST', body: { count: n } });
      if (r && r.ok && r.data.usage) {
        state.usage = r.data.usage;
        renderAll();
      } else if (r && r.status === 402) {
        openUpgrade('products', 'Product limit reached');
      }
      return r;
    } catch (e) { return null; }
  }

  function track(kind, meta) {
    if (!state.token || state.offline) return;
    api('/api/usage/consume', { method: 'POST', body: { kind, meta: meta || {} } })
      .then(r => {
        if (r.ok && r.data.usage) { state.usage = r.data.usage; renderAll(); }
        else if (r.status === 402 && r.data && r.data.feature) openUpgrade(r.data.feature, FEATURE_NAMES[r.data.feature]);
      })
      .catch(() => { /* ignore */ });
  }

  /* ─── plan UI ────────────────────────────────────────────── */

  function planById(id) {
    return (state.plans || []).filter(p => p.id === id)[0] || null;
  }

  function currentPlanName() {
    if (state.offline) return 'Local';
    return state.plan ? state.plan.name : 'Free';
  }

  function statusPill() {
    const sub = state.subscription || {};
    if (state.offline) return '<span class="saas-pill saas-pill-grey">Local mode</span>';
    if (sub.cancelAtPeriodEnd) return '<span class="saas-pill saas-pill-amber">Cancels soon</span>';
    if (sub.status === 'expired') return '<span class="saas-pill saas-pill-red">Expired</span>';
    if (sub.status === 'active') return '<span class="saas-pill saas-pill-green">Active</span>';
    return '<span class="saas-pill saas-pill-grey">' + esc(sub.status || 'Inactive') + '</span>';
  }

  function renewalLine() {
    const sub = state.subscription || {};
    if (state.offline) return 'Server unreachable — bills are not being metered.';
    if (!sub.isPaid) return 'Free plan · resets every calendar month';
    if (sub.status === 'expired') return 'Expired on ' + fmtDate(sub.currentPeriodEnd) + ' — renew to restore paid features';
    if (sub.currentPeriodEnd) {
      const days = sub.daysLeft == null ? '' : ' · ' + sub.daysLeft + ' day' + (sub.daysLeft === 1 ? '' : 's') + ' left';
      return (sub.cancelAtPeriodEnd ? 'Access ends ' : 'Renews ') + fmtDate(sub.currentPeriodEnd) + days;
    }
    return 'Active subscription';
  }

  function usageBar(used, limit, percent, label) {
    const unlimited = limit == null;
    const pct = unlimited ? 100 : Math.max(0, Math.min(100, Number(percent) || 0));
    const cls = !unlimited && pct >= 100 ? ' is-full' : (!unlimited && pct >= 80 ? ' is-high' : '');
    return '<div class="saas-meter">' +
      '<div class="saas-meter-top"><span>' + esc(label) + '</span><strong>' +
      (unlimited ? 'Unlimited' : used + ' / ' + limit) + '</strong></div>' +
      '<div class="saas-meter-track"><div class="saas-meter-fill' + cls + '" style="width:' + pct + '%"></div></div>' +
      '</div>';
  }

  function planCard(plan) {
    const isCurrent = state.plan && state.plan.id === plan.id;
    const price = state.cycle === 'yearly' ? plan.price.yearly : plan.price.monthly;
    const suffix = plan.id === 'free' ? '' : (state.cycle === 'yearly' ? '/year' : '/month');
    const note = plan.id === 'free'
      ? 'No card required'
      : (state.cycle === 'yearly'
        ? money(Math.round(plan.price.yearly / 12)) + '/mo, billed yearly'
        : 'Billed monthly');
    const button = isCurrent
      ? '<button class="saas-plan-btn is-current" disabled>Current plan</button>'
      : (plan.id === 'free'
        ? '<button class="saas-plan-btn is-ghost" data-saas="buy" data-plan="free">Downgrade to Free</button>'
        : '<button class="saas-plan-btn" data-saas="buy" data-plan="' + esc(plan.id) + '">Choose ' + esc(plan.name) + '</button>');
    return '<article class="saas-plan' + (isCurrent ? ' is-current' : '') + (plan.id === 'pro' ? ' is-pro' : '') + '">' +
      '<div class="saas-plan-head">' +
        '<div class="saas-plan-name">' + esc(plan.name) + '</div>' +
        (plan.badge ? '<span class="saas-plan-badge">' + esc(plan.badge) + '</span>' : '') +
      '</div>' +
      '<p class="saas-plan-tagline">' + esc(plan.tagline) + '</p>' +
      '<div class="saas-plan-price">' + money(price) + '<span>' + esc(suffix) + '</span></div>' +
      '<div class="saas-plan-note">' + esc(note) + '</div>' +
      '<ul class="saas-plan-list">' + (plan.highlights || []).map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
      button +
    '</article>';
  }

  function planGrid() {
    const plans = (state.plans && state.plans.length) ? state.plans : FALLBACK_PLANS;
    return '<div class="saas-plans">' + plans.map(planCard).join('') + '</div>';
  }

  function cycleToggle() {
    return '<div class="saas-cycle">' +
      '<button type="button" class="saas-cycle-btn' + (state.cycle === 'monthly' ? ' is-active' : '') + '" data-saas="cycle" data-cycle="monthly">Monthly</button>' +
      '<button type="button" class="saas-cycle-btn' + (state.cycle === 'yearly' ? ' is-active' : '') + '" data-saas="cycle" data-cycle="yearly">Yearly <span>save 2 months</span></button>' +
    '</div>';
  }

  /* ─── subscription view ──────────────────────────────────── */

  function renderChip() {
    const chip = $('saasPlanChip');
    if (!chip) return;
    const label = chip.querySelector('.saas-chip-label');
    if (label) label.textContent = currentPlanName();
    chip.className = 'saas-plan-chip' +
      (state.offline ? ' is-offline' : '') +
      (state.plan && state.plan.id === 'pro' ? ' is-pro' : '') +
      (state.plan && state.plan.id === 'starter' ? ' is-starter' : '');
    chip.title = 'Subscription & billing — ' + currentPlanName();
  }

  function renderSubscriptionView() {
    renderChip();
    const root = $('saasSubscriptionRoot');
    if (!root) return;

    // Always surface server-fresh usage when the Subscription & Billing view
    // is rendered, so Bills this month / Inventory Size stay in sync even if
    // an earlier consumeBill fell back to local mode.
    if (!state.offline && state.ready && (state.token || state.deviceId) && !syncingUsageForView && typeof refresh === 'function') {
      syncingUsageForView = true;
      refresh({ silent: true })
        .catch(function () { /* ignore */ })
        .finally(function () { syncingUsageForView = false; });
    }

    if (!state.ready) {
      root.innerHTML = '<div class="saas-loading"><span class="saas-spinner"></span> Loading subscription…</div>';
      return;
    }

    const sub = state.subscription || {};
    const usage = state.usage || { bills: {}, products: {} };
    const account = state.account || {};
    const isAdmin = account.role === 'admin';
    const isPaid = !!(sub.isPaid);
    const freePlan = planById('free') || FALLBACK_PLANS[0];

    const heroActions = [];
    if (isPaid) {
      heroActions.push('<button class="btn btn-primary" data-saas="renew" data-plan="' + esc(state.plan.id) + '">Renew plan</button>');
      if (sub.cancelAtPeriodEnd) {
        heroActions.push('<button class="btn btn-ghost" data-saas="resume">Resume auto-renew</button>');
      } else {
        heroActions.push('<button class="btn btn-ghost" data-saas="cancel">Cancel renewal</button>');
      }
    } else if (!state.offline) {
      heroActions.push('<button class="btn btn-primary" data-saas="buy" data-plan="starter">Upgrade to Starter</button>');
    }
    heroActions.push('<button class="btn btn-ghost" data-saas="refresh" title="Refresh">↻ Refresh</button>');

    const paymentsRows = (state.payments || []).length
      ? state.payments.map(p => '<tr>' +
          '<td class="fw-semi">' + moneyExact(p.amount) + '</td>' +
          '<td>' + esc(String(p.provider || '').toUpperCase()) + '</td>' +
          '<td><span class="badge-pill badge-green">' + esc(p.status || 'captured') + '</span></td>' +
          '<td>' + esc(fmtDateTime(p.createdAt)) + '</td>' +
        '</tr>').join('')
      : '<tr><td colspan="4" class="table-empty">No payments yet. Your plan receipts will appear here.</td></tr>';

    const ledgerRows = (state.ledger || []).length
      ? state.ledger.map(e => '<tr>' +
          '<td class="fw-semi">' + esc(kindLabel(e.kind)) + '</td>' +
          '<td>' + (e.kind === 'bill' && e.meta && e.meta.invNo ? esc(e.meta.invNo) : '—') + '</td>' +
          '<td>' + esc(e.quantity == null ? 1 : e.quantity) + '</td>' +
          '<td>' + esc(fmtDateTime(e.createdAt)) + '</td>' +
        '</tr>').join('')
      : '<tr><td colspan="4" class="table-empty">No usage recorded yet.</td></tr>';

    let accountCard;
    if (state.cloudMode) {
      const cloud = window.HisaabCloud || {};
      const cloudOrg = (typeof cloud.org === 'function' && cloud.org()) || {};
      const cloudEmail = (typeof cloud.userEmail === 'function' && cloud.userEmail()) || account.email || '';
      const cloudRole = (typeof cloud.role === 'function' && cloud.role()) || 'owner';
      const displayName = account.name || cloudOrg.name ||
        (cloudEmail ? cloudEmail.split('@')[0] : 'Shop Owner');
      accountCard =
        '<div class="saas-account-row"><div class="saas-avatar">' + esc(initials(displayName)) + '</div>' +
        '<div><div class="saas-account-name">' + esc(displayName) + '</div>' +
        '<div class="saas-account-sub">' + esc(cloudEmail || 'Supabase account') + '</div></div></div>' +
        '<div class="saas-kv"><span>Business</span><strong>' + esc(cloudOrg.name || account.storeName || '—') + '</strong></div>' +
        '<div class="saas-kv"><span>Role</span><strong>' + esc(cloudRole) + '</strong></div>' +
        '<div class="saas-note">Signed in with Supabase. Each business is isolated by row-level security, so no other shop can read your data.</div>' +
        '<div class="saas-account-actions">' +
          '<button class="btn btn-ghost" data-saas="cloud-signout">Sign out</button>' +
        '</div>';
    } else if (isAdmin) {
      accountCard =
        '<div class="saas-account-row"><div class="saas-avatar">' + esc(initials(account.name)) + '</div>' +
        '<div><div class="saas-account-name">' + esc(account.name) + '</div>' +
        '<div class="saas-account-sub">' + esc(account.email || account.contactEmail || 'Admin account') + '</div></div></div>' +
        '<div class="saas-note">You are signed in as the platform administrator. Admin accounts always have Pro access.</div>' +
        '<div class="saas-account-actions">' +
          '<button class="btn btn-primary" data-saas="admin">Open admin dashboard</button>' +
          '<button class="btn btn-ghost" data-saas="logout">Exit admin</button>' +
        '</div>';
    } else if (account.email || account.hasPassword) {
      accountCard =
        '<div class="saas-account-row"><div class="saas-avatar">' + esc(initials(account.name)) + '</div>' +
        '<div><div class="saas-account-name">' + esc(account.name) + '</div>' +
        '<div class="saas-account-sub">' + esc(account.email || 'Device account') + '</div></div></div>' +
        '<div class="saas-kv"><span>Store</span><strong>' + esc(account.storeName || '—') + '</strong></div>' +
        '<div class="saas-kv"><span>Account ID</span><strong>' + esc(shortId(account.id)) + '</strong></div>' +
        '<div class="saas-note">This device stays signed in. Use another device to sign in with this email and password.</div>' +
        '<div class="saas-account-actions">' +
          '<button class="btn btn-ghost" data-saas="auth-login">Sign in to another account</button>' +
        '</div>';
    } else {
      accountCard =
        '<div class="saas-account-row"><div class="saas-avatar">' + esc(initials(account.name)) + '</div>' +
        '<div><div class="saas-account-name">' + esc(account.name) + '</div>' +
        '<div class="saas-account-sub">Device account · Free plan</div></div></div>' +
        '<div class="saas-note">Add an email and password so you can recover this account and sign in from another device. Your local shop data stays on this device.</div>' +
        '<div class="saas-account-actions">' +
          '<button class="btn btn-primary" data-saas="auth-claim">Create login</button>' +
          '<button class="btn btn-ghost" data-saas="auth-login">Sign in</button>' +
        '</div>';
    }

    const offlineBanner = state.offline
      ? '<div class="saas-banner saas-banner-amber"><strong>Server offline.</strong> Subscription checks are paused, so billing continues in local mode. ' +
        '<button class="saas-link" data-saas="refresh">Retry connection</button></div>'
      : '';

    const anonymousBanner = state.anonymous
      ? '<div class="saas-banner saas-banner-red"><strong>Not signed in.</strong> ' + esc(state.lastError || 'Sign in to load your subscription.') +
        ' <button class="saas-link" data-saas="auth-login">Sign in</button></div>'
      : '';

    const pendingBanner = (sub.status === 'expired')
      ? '<div class="saas-banner saas-banner-red"><strong>' + esc((sub.pendingPlanId ? planName(sub.pendingPlanId) : 'Paid') + ' plan expired.') +
        '</strong> You are now on Free limits. Renew to unlock your paid features. ' +
        '<button class="saas-link" data-saas="buy" data-plan="' + esc(sub.pendingPlanId || 'starter') + '">Renew now</button></div>'
      : (sub.cancelAtPeriodEnd
        ? '<div class="saas-banner saas-banner-amber"><strong>Auto-renew is off.</strong> Access continues until ' + esc(fmtDate(sub.currentPeriodEnd)) + '. ' +
          '<button class="saas-link" data-saas="resume">Resume</button></div>'
        : '');

    root.innerHTML =
      offlineBanner + anonymousBanner + pendingBanner +
      '<div class="saas-hero' + (state.plan && state.plan.id === 'pro' ? ' is-pro' : '') + '">' +
        '<div class="saas-hero-main">' +
          '<div class="saas-eyebrow">CURRENT PLAN</div>' +
          '<div class="saas-hero-title">' + esc(currentPlanName()) + ' ' + statusPill() + '</div>' +
          '<div class="saas-hero-sub">' + esc(renewalLine()) + '</div>' +
        '</div>' +
        '<div class="saas-hero-actions">' + heroActions.join('') + '</div>' +
      '</div>' +

      '<div class="saas-meter-grid">' +
        '<div class="saas-card saas-meter-card">' +
          '<div class="saas-card-title">Bills this month</div>' +
          usageBar(usage.bills && usage.bills.used, usage.bills && usage.bills.limit, usage.bills && usage.bills.percent, 'Monthly bill quota') +
          '<div class="saas-card-foot">' + (usage.period ? 'Usage period ' + esc(usage.period) : 'Resets on the 1st of every month') + '</div>' +
        '</div>' +
        '<div class="saas-card saas-meter-card">' +
          '<div class="saas-card-title">Products</div>' +
          usageBar(usage.products && usage.products.used, usage.products && usage.products.limit, usage.products && usage.products.percent, 'Inventory size') +
          '<div class="saas-card-foot">Becomes read-only at the limit; existing stock is never deleted.</div>' +
        '</div>' +
      '</div>' +

      '<div class="saas-section-head">' +
        '<div><h3>Plans</h3><p>Upgrade instantly. Payment is verified on the server before activation.</p></div>' +
        cycleToggle() +
      '</div>' +
      planGrid() +

      (state.paymentConfig && state.paymentConfig.testMode
        ? '<div class="saas-testmode"><strong>Test payment mode.</strong> Upgrades use a local mock gateway; no real money moves and card fields are never sent to the server. Add Razorpay keys to go live.</div>'
        : '') +

      '<div class="saas-two-col">' +
        '<div class="saas-card">' +
          '<div class="saas-card-head"><div class="saas-card-title">Billing history</div></div>' +
          '<div class="table-wrapper"><table class="data-table saas-table"><thead><tr><th>Amount</th><th>Gateway</th><th>Status</th><th>Date</th></tr></thead><tbody>' + paymentsRows + '</tbody></table></div>' +
        '</div>' +
        '<div class="saas-card">' +
          '<div class="saas-card-head"><div class="saas-card-title">Account &amp; security</div></div>' +
          accountCard +
        '</div>' +
      '</div>' +

      '<div class="saas-card">' +
        '<div class="saas-card-head"><div class="saas-card-title">Usage ledger</div><span class="saas-card-hint">Latest 25 events</span></div>' +
        '<div class="table-wrapper"><table class="data-table saas-table"><thead><tr><th>Event</th><th>Reference</th><th>Qty</th><th>When</th></tr></thead><tbody>' + ledgerRows + '</tbody></table></div>' +
      '</div>' +

      '<div class="saas-footnote">Need help? Contact support. Paid plans renew automatically unless cancelled before the renewal date. ' +
      'GST included. Prices in INR.</div>';
  }

  function planName(id) {
    const p = planById(id);
    return p ? p.name : id;
  }

  function initials(name) {
    const parts = String(name || 'Shop Owner').trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('') || 'SO';
  }

  function shortId(id) {
    const s = String(id || '');
    if (s.length <= 14) return s;
    return s.slice(0, 8) + '…' + s.slice(-4);
  }

  function kindLabel(kind) {
    return ({
      bill: 'Bill created',
      return: 'Return processed',
      whatsapp: 'WhatsApp share',
      export: 'CSV export',
      payment: 'Payment',
      products: 'Product sync',
      admin_grant: 'Admin grant'
    })[kind] || kind || 'Event';
  }

  /* ─── upgrade modal ──────────────────────────────────────── */

  function openUpgrade(feature, label, context) {
    state.upgradeReason = label || FEATURE_NAMES[feature] || 'This feature';
    state.upgradeContext = context || null;
    const body = $('saasUpgradeBody');
    if (!body) return;
    if (context && Array.isArray(context.plans) && context.plans.length) state.plans = context.plans;

    const usage = state.usage || { bills: {} };
    const limitLine = (context && context.code === 'plan_limit')
      ? '<div class="saas-upgrade-limit">You have used <strong>' + esc(context.used) + '</strong> of <strong>' + esc(context.limit) + '</strong> bills this month.</div>'
      : '';

    body.innerHTML =
      '<div class="saas-upgrade-head">' +
        '<div class="saas-upgrade-icon">🔒</div>' +
        '<div><h3>' + esc(state.upgradeReason) + ' is not included in your plan</h3>' +
        '<p>Upgrade to keep billing without interruption. Activation is immediate after server verification.</p></div>' +
      '</div>' +
      limitLine +
      cycleToggle() +
      '<div class="saas-plans saas-plans-compact">' +
        ((state.plans && state.plans.length) ? state.plans : FALLBACK_PLANS)
          .filter(p => p.id !== 'free')
          .map(p => {
            const price = state.cycle === 'yearly' ? p.price.yearly : p.price.monthly;
            const suffix = state.cycle === 'yearly' ? '/year' : '/month';
            return '<article class="saas-plan' + (p.id === 'pro' ? ' is-pro' : '') + '">' +
              '<div class="saas-plan-head"><div class="saas-plan-name">' + esc(p.name) + '</div>' +
              (p.badge ? '<span class="saas-plan-badge">' + esc(p.badge) + '</span>' : '') + '</div>' +
              '<div class="saas-plan-price">' + money(price) + '<span>' + suffix + '</span></div>' +
              '<ul class="saas-plan-list">' + (p.highlights || []).slice(0, 4).map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
              '<button class="saas-plan-btn" data-saas="upgrade-buy" data-plan="' + esc(p.id) + '">Upgrade to ' + esc(p.name) + '</button>' +
            '</article>';
          }).join('') +
      '</div>' +
      '<div class="saas-upgrade-foot">' +
        (usage.bills && usage.bills.limit != null
          ? 'Free plan limit: ' + esc(usage.bills.limit) + ' bills/month. '
          : '') +
        '<button class="saas-link" data-saas="open-pricing">View pricing &amp; plans</button> · ' +
        '<button class="saas-link" data-saas="upgrade-login">Already paid on another device? Sign in</button>' +
      '</div>';

    if (typeof window.showModal === 'function') window.showModal('saasUpgradeModal');
    else { const el = $('saasUpgradeModal'); if (el) el.classList.remove('hidden'); }
  }

  /* ─── checkout ───────────────────────────────────────────── */

  async function buyPlan(planId, renew) {
    if (!planId) return;
    if (state.offline) {
      toastMsg('The server is offline. Reconnect to manage your subscription.', 'error');
      return;
    }
    // Ensure we have a billing token; if missing, provision a device account first
    if (!state.token) {
      try {
        const refreshed = await refresh({ silent: true });
        if (!state.token) {
          openAuth('login');
          return;
        }
      } catch (err) {
        openAuth('login');
        return;
      }
    }
    if (planId === 'free') {
      if (state.subscription && state.subscription.isPaid) cancelPlan();
      else toastMsg('You are already on the Free plan.', 'info');
      return;
    }
    const plan = planById(planId);
    if (!plan) { toastMsg('Unknown plan.', 'error'); return; }
    if (!renew && state.plan && state.plan.id === planId && state.subscription && state.subscription.status === 'active') {
      toastMsg('This is your current plan. Use Renew to extend it.', 'info');
      return;
    }

    const r = await api('/api/billing/order', { method: 'POST', body: { planId, cycle: state.cycle } });
    if (!r.ok) {
      toastMsg((r.data && r.data.error) || 'Could not start checkout.', 'error');
      return;
    }

    state.pendingOrder = r.data.order;
    if (typeof window.hideModal === 'function') window.hideModal('saasUpgradeModal');

    const cfg = r.data.payment || state.paymentConfig || {};
    if (cfg.provider === 'razorpay') {
      openRazorpay(r.data.order, cfg);
    } else {
      openMockCheckout(r.data.order);
    }
  }

  function openMockCheckout(order) {
    const plan = planById(order.planId);
    const summary = $('saasCheckoutSummary');
    if (summary) {
      summary.innerHTML =
        '<div class="saas-kv"><span>Plan</span><strong>' + esc(plan ? plan.name : order.planId) + '</strong></div>' +
        '<div class="saas-kv"><span>Billing cycle</span><strong>' + (order.cycle === 'yearly' ? 'Yearly' : 'Monthly') + '</strong></div>' +
        '<div class="saas-kv"><span>Amount</span><strong class="saas-amount">' + moneyExact(order.amount) + '</strong></div>';
    }
    const btnLabel = $('saasPayBtnLabel');
    if (btnLabel) btnLabel.textContent = 'Pay ' + moneyExact(order.amount) + ' (test)';
    const err = $('saasCheckoutError');
    if (err) { err.textContent = ''; err.classList.add('hidden'); }
    if (typeof window.showModal === 'function') {
      window.showModal('saasCheckoutModal');
    } else {
      const el = $('saasCheckoutModal');
      if (el) el.classList.remove('hidden');
    }
  }

  async function payMockOrder() {
    const order = state.pendingOrder;
    if (!order) return;
    const btn = $('saasPayBtn');
    const err = $('saasCheckoutError');
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    if (err) { err.textContent = ''; err.classList.add('hidden'); }

    try {
      const paid = await api('/api/billing/mock/pay', { method: 'POST', body: { orderId: order.id } });
      if (!paid.ok) {
        showCheckoutError((paid.data && paid.data.error) || 'The test gateway could not create a payment.');
        return;
      }
      const verified = await api('/api/billing/verify', {
        method: 'POST',
        body: {
          orderId: order.id,
          paymentId: paid.data.paymentId,
          signature: paid.data.signature
        }
      });
      if (!verified.ok) {
        showCheckoutError((verified.data && verified.data.error) || 'Payment verification failed.');
        return;
      }
      applyBilling(verified.data);
      state.pendingOrder = null;
      if (typeof window.hideModal === 'function') window.hideModal('saasCheckoutModal');
      await loadHistory();
      renderAll();
      toastMsg('Payment verified — ' + currentPlanName() + ' plan activated.', 'success');
      if (typeof window.switchToView === 'function') window.switchToView('subscription');
    } catch (err) {
      showCheckoutError(err.message || 'Checkout failed. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  }

  function showCheckoutError(message) {
    const err = $('saasCheckoutError');
    if (err) {
      err.textContent = message;
      err.classList.remove('hidden');
    } else {
      toastMsg(message, 'error');
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load the payment gateway.')); };
      document.head.appendChild(s);
    });
  }

  async function openRazorpay(order, cfg) {
    try {
      await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    } catch (err) {
      toastMsg(err.message, 'error');
      return;
    }
    if (!window.Razorpay) {
      toastMsg('Payment gateway unavailable. Check your connection.', 'error');
      return;
    }
    const plan = planById(order.planId);
    const account = state.account || {};
    const rzp = new window.Razorpay({
      key: cfg.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.providerOrderId,
      name: (getStore().storeName || 'Hisaab POS'),
      description: (plan ? plan.name : order.planId) + ' plan · ' + order.cycle,
      prefill: {
        name: account.name || '',
        email: account.email || account.contactEmail || ''
      },
      theme: { color: '#7c3aed' },
      handler: async function (response) {
        const verified = await api('/api/billing/verify', {
          method: 'POST',
          body: {
            orderId: order.id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature
          }
        });
        if (!verified.ok) {
          toastMsg((verified.data && verified.data.error) || 'Payment verification failed.', 'error');
          return;
        }
        applyBilling(verified.data);
        state.pendingOrder = null;
        await loadHistory();
        renderAll();
        toastMsg('Payment verified — ' + currentPlanName() + ' plan activated.', 'success');
      },
      modal: {
        ondismiss: function () { toastMsg('Checkout closed.', 'info'); }
      }
    });
    rzp.open();
  }

  async function cancelPlan() {
    if (!window.confirm('Cancel auto-renew? You keep paid features until the end of the current period.')) return;
    const r = await api('/api/billing/cancel', { method: 'POST' });
    if (!r.ok) { toastMsg((r.data && r.data.error) || 'Could not cancel.', 'error'); return; }
    applyBilling(r.data);
    renderAll();
    toastMsg('Auto-renew cancelled. Access continues until ' + fmtDate(state.subscription.currentPeriodEnd) + '.', 'info');
  }

  async function resumePlan() {
    const r = await api('/api/billing/resume', { method: 'POST' });
    if (!r.ok) { toastMsg((r.data && r.data.error) || 'Could not resume.', 'error'); return; }
    applyBilling(r.data);
    renderAll();
    toastMsg('Auto-renew resumed.', 'success');
  }

  /* ─── auth modal ─────────────────────────────────────────── */

  function openAuth(mode) {
    // In cloud mode Supabase Auth owns sign-in; never show the legacy
    // device-account modal.
    if (state.cloudMode) {
      if (window.HisaabCloud && typeof window.HisaabCloud.openGate === 'function') {
        window.HisaabCloud.openGate();
      }
      return;
    }
    state.authMode = mode || 'login';
    const body = $('saasAuthBody');
    if (!body) return;
    const profile = getProfile();
    const store = getStore();
    const isSignup = state.authMode === 'signup';
    const isClaim = state.authMode === 'claim';
    const title = isSignup ? 'Create your account' : (isClaim ? 'Create a login for this device' : 'Sign in');
    const subtitle = isSignup
      ? 'Your shop data stays on this device. The account is used for licensing and billing.'
      : (isClaim
        ? 'Add an email and password so you can recover this device account and sign in elsewhere.'
        : 'Sign in to load a paid subscription or the admin dashboard.');
    const submitLabel = isSignup ? 'Create account' : (isClaim ? 'Save login' : 'Sign in');

    body.innerHTML =
      '<div class="saas-auth-head"><h3>' + esc(title) + '</h3><p>' + esc(subtitle) + '</p></div>' +
      '<form id="saasAuthForm" class="saas-form" novalidate>' +
        (isSignup
          ? '<div class="saas-form-row"><label for="saasAuthName">Your name</label><input id="saasAuthName" class="stg-input" type="text" value="' + esc(profile.name || '') + '" placeholder="Shop owner name" /></div>' +
            '<div class="saas-form-row"><label for="saasAuthStore">Store name</label><input id="saasAuthStore" class="stg-input" type="text" value="' + esc(store.storeName || '') + '" placeholder="Store name" /></div>'
          : '') +
        '<div class="saas-form-row"><label for="saasAuthEmail">Email</label><input id="saasAuthEmail" class="stg-input" type="email" autocomplete="email" value="' + esc(profile.email || '') + '" placeholder="you@example.com" required /></div>' +
        '<div class="saas-form-row"><label for="saasAuthPassword">Password</label><input id="saasAuthPassword" class="stg-input" type="password" autocomplete="' + (isSignup || isClaim ? 'new-password' : 'current-password') + '" placeholder="At least 8 characters" required /></div>' +
        '<div class="saas-form-error hidden" id="saasAuthError"></div>' +
        '<div class="saas-form-actions">' +
          '<button type="button" class="btn btn-ghost" data-saas="auth-close">Cancel</button>' +
          '<button type="submit" class="btn btn-primary" id="saasAuthSubmit">' + esc(submitLabel) + '</button>' +
        '</div>' +
        '<div class="saas-auth-switch">' +
          (state.authMode === 'login'
            ? 'New here? <button type="button" class="saas-link" data-saas="auth-signup">Create an account</button>'
            : 'Already have an account? <button type="button" class="saas-link" data-saas="auth-login">Sign in</button>') +
        '</div>' +
      '</form>';

    if (typeof window.showModal === 'function') window.showModal('saasAuthModal');
  }

  async function submitAuth(form) {
    const mode = state.authMode;
    const email = (($('saasAuthEmail') || {}).value || '').trim();
    const password = (($('saasAuthPassword') || {}).value || '');
    const name = (($('saasAuthName') || {}).value || '').trim();
    const storeName = (($('saasAuthStore') || {}).value || '').trim();
    const err = $('saasAuthError');
    const btn = $('saasAuthSubmit');

    const showError = function (message) {
      if (err) { err.textContent = message; err.classList.remove('hidden'); }
    };

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Enter a valid email address.');
    if (mode !== 'login' && password.length < 8) return showError('Password must be at least 8 characters.');
    if (mode === 'login' && !password) return showError('Enter your password.');

    if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }
    try {
      let r;
      if (mode === 'login') {
        r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      } else if (mode === 'signup') {
        r = await api('/api/auth/signup', {
          method: 'POST',
          body: { email, password, name, storeName, deviceId: state.deviceId }
        });
      } else {
        r = await api('/api/auth/claim', { method: 'POST', body: { email, password } });
      }
      if (!r.ok) {
        if (r.data && r.data.code === 'account_deleted_recovery' && r.data.recovery) {
          openRecovery(r.data.recovery, { email, password, source: mode });
          return;
        }
        showError((r.data && r.data.error) || (r.offline ? 'The server is unreachable.' : 'Could not complete that request.'));
        return;
      }
      if (r.data.token) saveToken(r.data.token);
      applyBilling(r.data);
      await loadHistory();
      if (typeof window.hideModal === 'function') window.hideModal('saasAuthModal');
      renderAll();
      toastMsg(mode === 'claim' ? 'Login created for this device.' : 'Signed in successfully.', 'success');
      if (state.account && state.account.role === 'admin') {
        if (typeof window.switchToView === 'function') window.switchToView('admin');
      } else if (typeof window.switchToView === 'function') {
        window.switchToView('subscription');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = mode === 'signup' ? 'Create account' : (mode === 'claim' ? 'Save login' : 'Sign in'); }
    }
  }

  async function adminLogout() {
    if (!window.confirm('Exit the admin dashboard? This returns the browser to its own shop account.')) return;
    await api('/api/auth/logout', { method: 'POST' });
    saveToken('');
    state.account = null;
    state.plan = null;
    state.admin = null;
    state.adminTab = 'overview';
    state.adminQuery = '';
    await refresh({ force: true });
    toastMsg('Signed out.', 'info');
    if (typeof window.switchToView === 'function') window.switchToView('subscription');
  }

  /* ─── admin dashboard ────────────────────────────────────── */

  async function loadAdmin(force) {
    if (!state.account || state.account.role !== 'admin') {
      renderAdminView();
      return;
    }
    if (state.adminLoading) return;
    state.adminLoading = true;
    renderAdminView();

    const q = encodeURIComponent(state.adminQuery || '');
    const results = await Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/accounts?limit=100&q=' + q),
      api('/api/admin/payments?limit=100'),
      api('/api/admin/usage?limit=200')
    ]);

    if (!results[0].ok && results[0].status === 401) {
      saveToken('');
      state.account = null;
      state.adminLoading = false;
      await refresh({ force: true });
      return;
    }

    state.admin = {
      stats: results[0].ok ? results[0].data.stats : (state.admin && state.admin.stats),
      accounts: results[1].ok ? results[1].data.accounts : (state.admin && state.admin.accounts) || [],
      payments: results[2].ok ? results[2].data.payments : (state.admin && state.admin.payments) || [],
      usage: results[3].ok ? results[3].data.entries : (state.admin && state.admin.usage) || [],
      loadedAt: Date.now()
    };
    state.adminLoading = false;
    renderAdminView();
  }

  async function loadAdminAccounts() {
    const r = await api('/api/admin/accounts?limit=100&q=' + encodeURIComponent(state.adminQuery || ''));
    if (r.ok) {
      state.admin = state.admin || {};
      state.admin.accounts = r.data.accounts;
      renderAdminView();
    }
  }

  function statCard(label, value, tone) {
    return '<div class="saas-stat ' + (tone || '') + '"><div class="saas-stat-label">' + esc(label) + '</div>' +
      '<div class="saas-stat-value">' + esc(value) + '</div></div>';
  }

  function renderAdminView() {
    const root = $('saasAdminRoot');
    if (!root) return;

    if (!state.account || state.account.role !== 'admin') {
      root.innerHTML =
        '<div class="saas-card saas-admin-locked">' +
          '<div class="saas-admin-lock-icon">🛡️</div>' +
          '<h3>Admin access required</h3>' +
          '<p>Sign in with an administrator account to view platform MRR, accounts, payments and the global usage ledger.</p>' +
          '<div class="saas-account-actions">' +
            '<button class="btn btn-primary" data-saas="auth-login">Sign in as admin</button>' +
            '<button class="btn btn-ghost" data-saas="refresh">Refresh</button>' +
          '</div>' +
          '<div class="saas-note">In development, an admin account may be seeded on first run if configured. Set <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> (strong, server-side) for initial provisioning; do not use default passwords.</div>' +
        '</div>';
      return;
    }

    if (!state.admin) {
      root.innerHTML = '<div class="saas-loading"><span class="saas-spinner"></span> Loading admin data…</div>';
      if (!state.adminLoading) loadAdmin();
      return;
    }

    const stats = state.admin.stats || {};
    const accounts = state.admin.accounts || [];
    const payments = state.admin.payments || [];
    const usage = state.admin.usage || [];
    const tab = state.adminTab;

    const distribution = stats.distribution || {};
    const distTotal = Math.max(1, (distribution.free || 0) + (distribution.starter || 0) + (distribution.pro || 0));
    const distBar = ['free', 'starter', 'pro'].map(id => {
      const n = distribution[id] || 0;
      const pct = Math.round((n / distTotal) * 100);
      return '<div class="saas-dist-row">' +
        '<span class="saas-dist-label">' + esc(id === 'free' ? 'Free' : id === 'starter' ? 'Starter' : 'Pro') + '</span>' +
        '<div class="saas-meter-track"><div class="saas-meter-fill saas-dist-' + id + '" style="width:' + pct + '%"></div></div>' +
        '<span class="saas-dist-num">' + n + '</span>' +
      '</div>';
    }).join('');

    const recentPayments = (stats.recentPayments || []).length
      ? stats.recentPayments.map(p => '<div class="saas-list-row">' +
          '<div><div class="saas-list-main">' + esc(p.email || p.accountId) + '</div>' +
          '<div class="saas-list-sub">' + esc(fmtDateTime(p.createdAt)) + ' · ' + esc(String(p.provider || '').toUpperCase()) + '</div></div>' +
          '<strong>' + moneyExact(p.amount) + '</strong></div>').join('')
      : '<div class="saas-empty">No payments yet.</div>';

    const recentAccounts = (stats.recentAccounts || []).length
      ? stats.recentAccounts.map(a => '<div class="saas-list-row">' +
          '<div><div class="saas-list-main">' + esc(a.name || a.email || a.id) + '</div>' +
          '<div class="saas-list-sub">' + esc(a.email || a.storeName || '') + ' · ' + esc(fmtDateTime(a.createdAt)) + '</div></div>' +
          '<span class="saas-plan-tag saas-tag-' + esc(a.planId) + '">' + esc(planName(a.planId)) + '</span></div>').join('')
      : '<div class="saas-empty">No accounts yet.</div>';

    const accountRows = accounts.length
      ? accounts.map(a => {
          const planSel = ['free', 'starter', 'pro'].map(id =>
            '<option value="' + id + '"' + (a.planId === id ? ' selected' : '') + '>' + planName(id) + '</option>'
          ).join('');
          return '<tr>' +
            '<td><div class="fw-semi">' + esc(a.name) + '</div>' +
              '<div class="row-sub">' + esc(a.email || a.contactEmail || 'device account') + '</div>' +
              '<div class="row-sub">' + esc(a.storeName || '') + '</div></td>' +
            '<td><span class="saas-plan-tag saas-tag-' + esc(a.planId) + '">' + esc(a.planName) + '</span>' +
              (a.daysLeft != null ? '<div class="row-sub">' + esc(a.daysLeft) + ' days left</div>' : '') + '</td>' +
            '<td>' + esc(a.billsThisMonth) + '<div class="row-sub">' + esc(a.productCount) + ' products</div></td>' +
            '<td><span class="badge-pill ' + (a.status === 'suspended' ? 'badge-red' : 'badge-green') + '">' + esc(a.status) + '</span></td>' +
            '<td class="saas-grant-cell">' +
              '<div class="saas-grant">' +
                '<select class="stg-input saas-grant-plan" id="saasGrantPlan-' + esc(a.id) + '">' + planSel + '</select>' +
                '<input class="stg-input saas-grant-days" id="saasGrantDays-' + esc(a.id) + '" type="number" min="1" max="3650" value="30" title="Days" />' +
                '<button class="btn btn-primary saas-grant-btn" data-saas="admin-grant" data-account="' + esc(a.id) + '">Grant</button>' +
              '</div>' +
            '</td>' +
            '<td>' +
              '<button class="tbl-action ' + (a.status === 'suspended' ? 'tbl-view' : 'tbl-del') + '" data-saas="admin-status" data-account="' + esc(a.id) + '" data-status="' + (a.status === 'suspended' ? 'active' : 'suspended') + '">' +
                (a.status === 'suspended' ? 'Activate' : 'Suspend') +
              '</button>' +
            '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" class="table-empty">No accounts match this search.</td></tr>';

    const paymentRows = payments.length
      ? payments.map(p => '<tr>' +
          '<td class="fw-semi">' + moneyExact(p.amount) + '</td>' +
          '<td>' + esc(p.email || p.accountId) + '<div class="row-sub">' + esc(p.storeName || '') + '</div></td>' +
          '<td>' + esc(String(p.provider || '').toUpperCase()) + '</td>' +
          '<td><span class="badge-pill badge-green">' + esc(p.status) + '</span></td>' +
          '<td>' + esc(fmtDateTime(p.createdAt)) + '</td>' +
        '</tr>').join('')
      : '<tr><td colspan="5" class="table-empty">No payments recorded.</td></tr>';

    const usageRows = usage.length
      ? usage.map(u => '<tr>' +
          '<td class="fw-semi">' + esc(kindLabel(u.kind)) + '</td>' +
          '<td>' + esc(u.email || u.accountId) + '<div class="row-sub">' + esc(u.storeName || '') + '</div></td>' +
          '<td>' + esc(u.quantity == null ? 1 : u.quantity) + '</td>' +
          '<td>' + esc(u.kind === 'bill' && u.meta && u.meta.invNo ? u.meta.invNo : '—') + '</td>' +
          '<td>' + esc(fmtDateTime(u.createdAt)) + '</td>' +
        '</tr>').join('')
      : '<tr><td colspan="5" class="table-empty">No usage recorded.</td></tr>';

    let tabHtml = '';
    if (tab === 'overview') {
      tabHtml =
        '<div class="saas-two-col">' +
          '<div class="saas-card"><div class="saas-card-head"><div class="saas-card-title">Plan distribution</div></div>' +
            '<div class="saas-dist">' + distBar + '</div>' +
            '<div class="saas-card-foot">' + esc(stats.paidActive || 0) + ' paid · ' + esc(stats.freeActive || 0) + ' free · ' + esc(stats.suspended || 0) + ' suspended</div>' +
          '</div>' +
          '<div class="saas-card"><div class="saas-card-head"><div class="saas-card-title">Recent payments</div></div>' +
            '<div class="saas-list">' + recentPayments + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="saas-card"><div class="saas-card-head"><div class="saas-card-title">Newest accounts</div></div>' +
          '<div class="saas-list">' + recentAccounts + '</div>' +
        '</div>';
    } else if (tab === 'accounts') {
      tabHtml =
        '<div class="saas-card">' +
          '<div class="saas-card-head saas-admin-toolbar">' +
            '<div class="saas-card-title">Accounts</div>' +
            '<input class="stg-input saas-admin-search" id="saasAdminSearch" type="search" placeholder="Search email, store or ID…" value="' + esc(state.adminQuery) + '" />' +
          '</div>' +
          '<div class="table-wrapper"><table class="data-table saas-table"><thead><tr>' +
            '<th>Account</th><th>Plan</th><th>This month</th><th>Status</th><th>Grant plan</th><th></th>' +
          '</tr></thead><tbody>' + accountRows + '</tbody></table></div>' +
          '<div class="saas-card-foot">Granting a plan immediately activates it for the number of days entered. Leave a note in the usage ledger by using the API.</div>' +
        '</div>';
    } else if (tab === 'payments') {
      tabHtml =
        '<div class="saas-card"><div class="saas-card-head"><div class="saas-card-title">All payments</div></div>' +
          '<div class="table-wrapper"><table class="data-table saas-table"><thead><tr>' +
            '<th>Amount</th><th>Account</th><th>Gateway</th><th>Status</th><th>Date</th>' +
          '</tr></thead><tbody>' + paymentRows + '</tbody></table></div>' +
        '</div>';
    } else {
      tabHtml =
        '<div class="saas-card"><div class="saas-card-head"><div class="saas-card-title">Global usage ledger</div>' +
          '<span class="saas-card-hint">Latest 200 events</span></div>' +
          '<div class="table-wrapper"><table class="data-table saas-table"><thead><tr>' +
            '<th>Event</th><th>Account</th><th>Qty</th><th>Reference</th><th>When</th>' +
          '</tr></thead><tbody>' + usageRows + '</tbody></table></div>' +
        '</div>';
    }

    root.innerHTML =
      '<div class="saas-admin-head">' +
        '<div><h2>Admin dashboard</h2><p>Platform revenue, subscriptions and usage.</p></div>' +
        '<div class="saas-admin-actions">' +
          '<span class="saas-admin-refreshed">' + (state.adminLoadedAt ? 'Updated ' + fmtDateTime(state.adminLoadedAt) : '') + '</span>' +
          '<button class="btn btn-ghost" data-saas="admin-refresh">↻ Refresh</button>' +
          '<button class="btn btn-ghost" data-saas="logout">Exit admin</button>' +
        '</div>' +
      '</div>' +
      (state.adminLoading ? '<div class="saas-loading-inline"><span class="saas-spinner"></span> Updating…</div>' : '') +
      '<div class="saas-stats">' +
        statCard('Accounts', stats.accounts || 0, 'purple') +
        statCard('Paid active', stats.paidActive || 0, 'green') +
        statCard('MRR', moneyExact(stats.mrr || 0), 'green') +
        statCard('Revenue (30d)', moneyExact(stats.revenue30d || 0), 'purple') +
        statCard('Revenue (total)', moneyExact(stats.revenueTotal || 0), '') +
        statCard('Bills this month', stats.billsThisMonth || 0, 'amber') +
        statCard('Bills today', stats.billsToday || 0, 'amber') +
        statCard('New accounts (7d)', stats.newAccounts7d || 0, '') +
      '</div>' +
      '<div class="saas-tabs">' +
        ['overview', 'accounts', 'payments', 'usage'].map(id =>
          '<button class="saas-tab' + (tab === id ? ' is-active' : '') + '" data-saas="admin-tab" data-tab="' + id + '">' +
            id.charAt(0).toUpperCase() + id.slice(1) +
          '</button>'
        ).join('') +
      '</div>' +
      tabHtml;
  }

  async function grantPlan(accountId) {
    const planEl = $('saasGrantPlan-' + accountId);
    const daysEl = $('saasGrantDays-' + accountId);
    const planId = planEl ? planEl.value : 'starter';
    const days = daysEl ? Math.max(1, Math.min(3650, parseInt(daysEl.value, 10) || 30)) : 30;
    const r = await api('/api/admin/accounts/' + encodeURIComponent(accountId) + '/plan', {
      method: 'POST',
      body: { planId, days, note: 'Granted from admin dashboard' }
    });
    if (!r.ok) { toastMsg((r.data && r.data.error) || 'Could not grant plan.', 'error'); return; }
    toastMsg(planName(planId) + ' granted for ' + days + ' days.', 'success');
    await loadAdmin();
  }

  async function toggleAccountStatus(accountId, status) {
    const label = status === 'suspended' ? 'Suspend' : 'Activate';
    if (!window.confirm(label + ' this account?')) return;
    const r = await api('/api/admin/accounts/' + encodeURIComponent(accountId) + '/status', {
      method: 'POST',
      body: { status }
    });
    if (!r.ok) { toastMsg((r.data && r.data.error) || 'Could not update status.', 'error'); return; }
    toastMsg('Account ' + (status === 'suspended' ? 'suspended' : 'activated') + '.', 'success');
    await loadAdmin();
  }

  /* ─── render all ─────────────────────────────────────────── */

  function renderAll() {
    renderChip();
    renderSubscriptionView();
    if (state.account && state.account.role === 'admin') {
      const view = $('view-admin');
      if (view && view.classList.contains('active')) renderAdminView();
    }
    syncAdminEntries();
    // Keep the Alerts panel in step with usage changes (threshold reached,
    // dismissed, or a new billing cycle).
    try {
      if (typeof window.renderNotifications === 'function') window.renderNotifications();
    } catch (err) { /* ignore */ }
    maybeNotifyUsage80();
  }

  function syncAdminEntries() {
    const isAdmin = !!(state.account && state.account.role === 'admin');
    const moreAdmin = $('moreAdminBtn');
    if (moreAdmin) moreAdmin.classList.toggle('hidden', !isAdmin);
    const menuAdmin = $('menuAdmin');
    if (menuAdmin) menuAdmin.classList.toggle('hidden', !isAdmin);
  }

  /* ─── navigation bindings ────────────────────────────────── */

  function closeMoreMenu() {
    const menu = $('moreMenu');
    if (menu) menu.classList.add('hidden');
    const btn = $('moreNavBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function setupNavEntries() {
    $('saasPlanChip')?.addEventListener('click', function () {
      if (typeof window.switchToView === 'function') window.switchToView('subscription');
    });

    $('moreSubscriptionBtn')?.addEventListener('click', function (e) {
      e.preventDefault();
      closeMoreMenu();
      if (typeof window.switchToView === 'function') window.switchToView('subscription');
    });

    $('moreAdminBtn')?.addEventListener('click', function (e) {
      e.preventDefault();
      closeMoreMenu();
      if (typeof window.switchToView === 'function') window.switchToView('admin');
    });

    $('menuSubscription')?.addEventListener('click', function (e) {
      e.preventDefault();
      $('userDropdown')?.classList.add('hidden');
      if (typeof window.switchToView === 'function') window.switchToView('subscription');
    });

    $('menuAdmin')?.addEventListener('click', function (e) {
      e.preventDefault();
      $('userDropdown')?.classList.add('hidden');
      if (typeof window.switchToView === 'function') window.switchToView('admin');
    });
  }

  /* ─── delegated events ───────────────────────────────────── */

  function onClick(event) {
    const el = event.target.closest ? event.target.closest('[data-saas]') : null;
    if (!el) return;
    const action = el.getAttribute('data-saas');

    switch (action) {
      case 'refresh':
        event.preventDefault();
        refresh({});
        break;
      case 'cycle':
        event.preventDefault();
        saveCycle(el.getAttribute('data-cycle'));
        renderAll();
        if (state.upgradeContext || ($('saasUpgradeModal') && !$('saasUpgradeModal').classList.contains('hidden'))) {
          openUpgrade(state.upgradeReason, state.upgradeReason, state.upgradeContext);
        }
        break;
      case 'buy':
        event.preventDefault();
        buyPlan(el.getAttribute('data-plan'), false);
        break;
      case 'renew':
        event.preventDefault();
        buyPlan(el.getAttribute('data-plan'), true);
        break;
      case 'upgrade-buy':
        event.preventDefault();
        if (typeof window.hideModal === 'function') window.hideModal('saasUpgradeModal');
        buyPlan(el.getAttribute('data-plan'), true);
        break;
      case 'open-pricing':
        event.preventDefault();
        if (typeof window.hideModal === 'function') window.hideModal('saasUpgradeModal');
        openPricing();
        break;
      case 'cancel':
        event.preventDefault();
        cancelPlan();
        break;
      case 'resume':
        event.preventDefault();
        resumePlan();
        break;
      case 'auth-login':
        event.preventDefault();
        openAuth('login');
        break;
      case 'auth-signup':
        event.preventDefault();
        openAuth('signup');
        break;
      case 'auth-claim':
        event.preventDefault();
        openAuth('claim');
        break;
      case 'auth-close':
        event.preventDefault();
        if (typeof window.hideModal === 'function') window.hideModal('saasAuthModal');
        break;
      case 'checkout-close':
        event.preventDefault();
        state.pendingOrder = null;
        if (typeof window.hideModal === 'function') window.hideModal('saasCheckoutModal');
        break;
      case 'upgrade-close':
        event.preventDefault();
        if (typeof window.hideModal === 'function') window.hideModal('saasUpgradeModal');
        break;
      case 'admin':
        event.preventDefault();
        loadAdmin();
        if (typeof window.switchToView === 'function') window.switchToView('admin');
        break;
      case 'logout':
        event.preventDefault();
        adminLogout();
        break;
      case 'cloud-signout':
        event.preventDefault();
        if (window.HisaabCloud && typeof window.HisaabCloud.signOut === 'function') {
          window.HisaabCloud.signOut();
        }
        break;
      case 'admin-refresh':
        event.preventDefault();
        loadAdmin(true);
        break;
      case 'admin-tab':
        event.preventDefault();
        state.adminTab = el.getAttribute('data-tab') || 'overview';
        renderAdminView();
        break;
      case 'admin-grant':
        event.preventDefault();
        grantPlan(el.getAttribute('data-account'));
        break;
      case 'admin-status':
        event.preventDefault();
        toggleAccountStatus(el.getAttribute('data-account'), el.getAttribute('data-status'));
        break;
      case 'upgrade-login':
        event.preventDefault();
        if (typeof window.hideModal === 'function') window.hideModal('saasUpgradeModal');
        openAuth('login');
        break;
      default:
        break;
    }
  }

  function onSubmit(event) {
    if (event.target && event.target.id === 'saasAuthForm') {
      event.preventDefault();
      submitAuth(event.target);
    } else if (event.target && event.target.id === 'saasCheckoutForm') {
      event.preventDefault();
      payMockOrder();
    }
  }

  let adminSearchTimer = null;
  function onInput(event) {
    const target = event.target;
    if (!target) return;
    if (target.id === 'saasAdminSearch') {
      state.adminQuery = target.value || '';
      clearTimeout(adminSearchTimer);
      adminSearchTimer = setTimeout(loadAdminAccounts, 300);
    }
  }

  function setupGates() {
    // These actions are triggered from menus that app.js owns; stop the
    // click before the modal/export opens so the upgrade prompt wins.
    document.addEventListener('click', function (event) {
      if (!event.target.closest) return;
      if (event.target.closest('#moreDamageBtn') && !guard('damage_tracking', 'Damaged stock tracking')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  /* ─── cloud identity bridge ──────────────────────────────── */

  // Billing identity derived from the Supabase user id. It is deterministic,
  // so the same person keeps one billing account on every device, and the
  // hex-only form matches the id format the billing API accepts.
  function cloudDeviceId(userId) {
    const hex = String(userId || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    return hex ? 'sb' + hex : '';
  }

  /**
   * Called by cloud.js when Supabase reports a signed-in user.
   * Cloud mode never auto-provisions a random device account.
   */
  function setIdentity(userId) {
    const nextId = cloudDeviceId(userId);
    state.cloudMode = true;
    if (!nextId) return;

    const changed = state.identityId !== userId || state.deviceId !== nextId;
    state.identityId = userId;

    if (!changed) {
      // Same user (e.g. a later cloud notify): recover billing if the first
      // attempt never completed or the auth token is missing.
      if (state.ready && !state.offline && state.token) return;
      refresh({ silent: true });
      return;
    }

    state.deviceId = nextId;
    state.account = null;
    state.plan = null;
    state.subscription = null;
    state.usage = null;
    state.features = [];
    state.limits = null;
    state.payments = [];
    state.ledger = [];
    state.ready = false;
    state.offline = false;
    state.anonymous = false;
    saveToken('');
    refresh({ initial: true });
  }

  /** Called on sign-out: drop the billing session and stop metering. */
  function clearIdentity() {
    state.cloudMode = true;
    state.identityId = '';
    state.deviceId = '';
    state.account = null;
    state.plan = null;
    state.subscription = null;
    state.usage = null;
    state.features = [];
    state.limits = null;
    state.payments = [];
    state.ledger = [];
    state.ready = false;
    state.offline = false;
    state.anonymous = false;
    saveToken('');
    renderAll();
  }

  /* ─── public API ─────────────────────────────────────────── */


  /* ─── account deletion & recovery (self-service) ─────────── */

  function clearAppLocalData() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('hisaab_') === 0) keys.push(k);
      }
      keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      try { if (window.DB && typeof window.DB.clearCache === 'function') window.DB.clearCache(); } catch (e) {}
    } catch (e) { /* ignore */ }
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(Number(ts)).toLocaleString(); } catch (e) { return '—'; }
  }

  function openRecovery(recovery, ctx) {
    const body = $('saasAuthBody');
    if (!body) return;
    const email = esc((recovery && recovery.email) || (ctx && ctx.email) || '');
    const deletedAt = fmtDate(recovery && recovery.deletedAt);
    const retentionUntil = fmtDate(recovery && recovery.retentionUntil);
    body.innerHTML =
      '<div class="saas-auth-head"><h3>Account recovery</h3>' +
      '<p>This account (<strong>' + email + '</strong>) was deleted on <strong>' + esc(deletedAt) + '</strong>. ' +
      'Your data is retained securely until <strong>' + esc(retentionUntil) + '</strong> (if within the retention period). Choose how you want to continue.</p></div>' +
      '<div class="saas-form" id="saasRecoveryForm">' +
        '<div class="saas-form-error hidden" id="saasRecoveryError"></div>' +
        '<div class="saas-card" style="border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:14px;margin:10px 0;">' +
          '<h4 style="margin:0 0 6px;font-size:14px;">Recover old account</h4>' +
          '<p style="margin:0 0 10px;font-size:13px;color:var(--text-muted,#6b7280);">Restore your previous account and associated SaaS data (plan, billing, usage history) where available. Access is re-enabled after verification.</p>' +
          '<button type="button" class="btn btn-primary" data-recovery="recover">Recover old account</button>' +
        '</div>' +
        '<div class="saas-card" style="border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:14px;margin:10px 0;">' +
          '<h4 style="margin:0 0 6px;font-size:14px;">Start fresh account</h4>' +
          '<p style="margin:0 0 10px;font-size:13px;color:var(--text-muted,#6b7280);">Create a completely new account with the same email. Previous business data, products, customers, transactions and settings will not be restored, and old/new data stay separated.</p>' +
          '<button type="button" class="btn btn-ghost" data-recovery="fresh">Start fresh account</button>' +
        '</div>' +
        '<div class="saas-form-actions"><button type="button" class="btn btn-ghost" data-saas="auth-login">Back to sign in</button></div>' +
      '</div>';

    if (typeof window.showModal === 'function') window.showModal('saasAuthModal');

    body.querySelectorAll('[data-recovery]').forEach(btn => {
      btn.addEventListener('click', async function () {
        const choice = btn.getAttribute('data-recovery');
        await submitRecovery(choice, recovery, ctx);
      });
    });
    const back = body.querySelector('[data-saas="auth-login"]');
    if (back) back.addEventListener('click', function () { openAuth('login'); });
  }

  async function submitRecovery(choice, recovery, ctx) {
    const errEl = $('saasRecoveryError');
    const showError = function (msg) { if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); } };
    const buttons = Array.from(document.querySelectorAll('[data-recovery]'));
    buttons.forEach(b => { b.disabled = true; });
    try {
      const endpoint = choice === 'fresh' ? '/api/auth/account/start-fresh' : '/api/auth/account/recover';
      const payload = {
        email: (recovery && recovery.email) || (ctx && ctx.email) || '',
        recoveryToken: recovery && recovery.recoveryToken,
        deviceId: state.deviceId
      };
      const r = await api(endpoint, { method: 'POST', body: payload });
      if (!r.ok) {
        showError((r.data && r.data.error) || 'Could not complete recovery. Please sign in again.');
        return;
      }
      if (r.data.token) saveToken(r.data.token);
      applyBilling(r.data);
      if (r.data.clearLocalData || r.data.freshStart || choice === 'fresh') {
        clearAppLocalData();
        await loadHistory().catch(function () {});
        if (typeof window.hideModal === 'function') window.hideModal('saasAuthModal');
        renderAll();
        toastMsg('A fresh account has been created. Previous local business data was cleared to keep accounts separate.', 'success');
        setTimeout(function () { try { window.location.reload(); } catch (e) {} }, 700);
        return;
      }
      await loadHistory().catch(function () {});
      if (typeof window.hideModal === 'function') window.hideModal('saasAuthModal');
      renderAll();
      toastMsg('Your previous account has been restored.', 'success');
      if (typeof window.switchToView === 'function') window.switchToView('subscription');
    } catch (e) {
      showError('Could not complete recovery. Please try again.');
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  }

  async function deleteMyAccount(options) {
    const opts = options || {};
    const r = await api('/api/auth/account/delete', {
      method: 'POST',
      body: { password: opts.password || '', confirm: opts.confirm || '' }
    });
    if (!r.ok) return r;
    try { saveToken(''); } catch (e) {}
    state.token = '';
    state.account = null;
    state.plan = null;
    state.subscription = null;
    state.usage = null;
    state.features = [];
    state.limits = null;
    state.admin = null;
    renderAll();
    return r;
  }


  // Applies a one-time referral limit boost locally and, when online, records
  // it server-side. The grant key makes it idempotent: retrying a referral can
  // never add the same boost twice, and boosts never recur monthly.
  async function claimReferralBoost(grant) {
    const key = grant && grant.grantKey ? String(grant.grantKey) : '';
    if (!key) return { ok: false, reason: 'missing_grant_key' };
    const inventoryBoost = Math.max(0, Math.floor(Number(grant.inventoryBoost) || 0));
    const usageBoost = Math.max(0, Math.floor(Number(grant.usageBoost) || 0));
    if (!inventoryBoost && !usageBoost) return { ok: false, reason: 'empty_grant' };

    state.referralBoosts = Array.isArray(state.referralBoosts) ? state.referralBoosts : [];
    const alreadyLocal = state.referralBoosts.some(b => b && b.grantKey === key);
    if (!alreadyLocal) {
      state.referralBoosts.push({ grantKey: key, inventoryBoost, usageBoost, at: Date.now() });
      applyBoostToState(inventoryBoost, usageBoost);
      renderAll();
    }

    if (state.offline) return { ok: true, local: true };
    if (!state.ready) { try { await refresh({ silent: true }); } catch (e) {} }
    if (!state.ready || (!state.token && !state.deviceId)) return { ok: true, local: true };

    const r = await api('/api/usage/boost', {
      method: 'POST',
      body: { grantKey: key, inventoryBoost, usageBoost }
    });
    if (r.ok) {
      if (r.data && r.data.usage) state.usage = r.data.usage;
      renderAll();
      return { ok: true, duplicate: !!(r.data && r.data.duplicate) };
    }
    if (r.status === 402 && r.data && r.data.feature) {
      try { openUpgrade(r.data.feature, FEATURE_NAMES[r.data.feature]); } catch (e) {}
    }
    return { ok: false, reason: (r.data && r.data.error) || 'boost_failed' };
  }

  function applyBoostToState(inventoryBoost, usageBoost) {
    const inv = Math.max(0, Number(inventoryBoost) || 0);
    const use = Math.max(0, Number(usageBoost) || 0);
    if (state.limits && state.limits.products != null && inv > 0) {
      state.limits.products = Number(state.limits.products) + inv;
    }
    if (state.usage && state.usage.bills && state.usage.bills.limit != null && use > 0) {
      state.usage.bills.limit = Number(state.usage.bills.limit) + use;
      if (state.usage.bills.remaining != null) state.usage.bills.remaining = Number(state.usage.bills.remaining) + use;
    }
  }

  window.HisaabSaaS = {
    init: function () {
      if (state.booted) return;
      state.booted = true;
      state.cycle = readCycle();
      setupNavEntries();
      setupGates();
      document.addEventListener('click', onClick);
      document.addEventListener('submit', onSubmit);
      document.addEventListener('input', onInput);

      // If Supabase is configured, the app signs in through Supabase Auth and
      // cloud.js calls setIdentity() after login. Never auto-provision a
      // random device account in that case.
      state.cloudMode = !!(window.HisaabCloud && typeof window.HisaabCloud.isConfigured === 'function' &&
        window.HisaabCloud.isConfigured());

      if (state.cloudMode) {
        renderAll();
      } else {
        state.deviceId = ensureDeviceId();
        state.token = readToken();
        refresh({ initial: true });
      }

      setInterval(function () {
        if (document.hidden) return;
        if (state.cloudMode && !state.identityId) return;
        refresh({ silent: true });
      }, 60000);
    },
    refresh: refresh,
    setIdentity: setIdentity,
    clearIdentity: clearIdentity,
    canView: canView,
    guard: guard,
    canShowWatermark: canShowWatermark,
    consumeBill: consumeBill,
    authorizeBarcodePrint: authorizeBarcodePrint,
    canPrintBarcodes: canPrintBarcodes,
    canAddProduct: canAddProduct,
    claimReferralBoost: claimReferralBoost,
    syncProducts: syncProducts,
    track: track,
    getUsageAlert: getUsageAlert,
    maybeNotifyUsage80: maybeNotifyUsage80,
    openPricing: openPricing,
    openUpgrade: openUpgrade,
    renderSubscriptionView: renderSubscriptionView,
    renderAdminView: function () {
      renderAdminView();
      if (state.account && state.account.role === 'admin' && !state.admin) loadAdmin();
    },
    deleteMyAccount: deleteMyAccount,
    state: state
  };
})();
