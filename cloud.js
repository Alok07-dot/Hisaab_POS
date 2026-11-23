/* ══════════════════════════════════════════════════════════════
   HISAAB POS — cloud identity
   Supabase Auth + organization onboarding.

   When config.js holds real Supabase credentials the app becomes a
   multi-tenant product: every user signs in, every user belongs to an
   organization, and Postgres RLS keeps the organizations apart.

   When Supabase is not configured the app stays exactly as before:
   local mode, no gate, no network dependency.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var LS = {
    deviceUser: 'hisaab_cloud_user'
  };

  var state = {
    configured: false,
    ready: false,
    mode: 'local',          // local | signed_out | onboarding | active
    session: null,
    user: null,
    profile: null,
    memberships: [],
    org: null,
    store: null,
    role: null,
    authMode: 'login',
    busy: false,
    offline: false,
    error: '',
    info: ''
  };

  var listeners = [];

  function $(id) { return document.getElementById(id); }

  function sb() { return window.HisaabSupabase; }

  function configured() {
    return !!(sb() && sb().configured());
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toastMsg(message, type) {
    if (typeof window.toast === 'function') window.toast(message, type || 'info');
    else console.log('[Cloud] ' + message);
  }

  function showEl(el) { if (el) el.classList.remove('hidden'); }
  function hideEl(el) { if (el) el.classList.add('hidden'); }

  function setError(message) {
    state.error = message || '';
    var box = $('cloudAuthError');
    if (box) {
      if (message) { box.textContent = message; showEl(box); }
      else { box.textContent = ''; hideEl(box); }
    }
    var orgBox = $('cloudOrgError');
    if (orgBox) {
      if (message) { orgBox.textContent = message; showEl(orgBox); }
      else { orgBox.textContent = ''; hideEl(orgBox); }
    }
  }

  function setInfo(message) {
    state.info = message || '';
    var box = $('cloudAuthInfo');
    if (!box) return;
    if (message) { box.textContent = message; showEl(box); }
    else { box.textContent = ''; hideEl(box); }
  }

  /* ─── overlay ─────────────────────────────────────────────── */

  function showGate() {
    var gate = $('cloudGate');
    if (!gate) return;
    gate.classList.remove('hidden');
    document.documentElement.classList.add('cloud-gate-open');
    document.documentElement.classList.remove('cloud-pending');
    document.body.classList.add('cloud-gate-open');
  }

  function hideGate() {
    var gate = $('cloudGate');
    if (gate) gate.classList.add('hidden');
    document.documentElement.classList.remove('cloud-gate-open');
    document.body.classList.remove('cloud-gate-open');
    document.documentElement.classList.remove('cloud-pending');
  }

  function showAuthPanel(mode) {
    state.authMode = mode === 'signup' ? 'signup' : 'login';
    var isSignup = state.authMode === 'signup';

    hideEl($('cloudOrgPanel'));
    showEl($('cloudAuthPanel'));

    var tabLogin = $('cloudTabLogin');
    var tabSignup = $('cloudTabSignup');
    if (tabLogin) tabLogin.classList.toggle('is-active', !isSignup);
    if (tabSignup) tabSignup.classList.toggle('is-active', isSignup);

    if ($('cloudNameField')) $('cloudNameField').classList.toggle('hidden', !isSignup);

    var submit = $('cloudAuthSubmit');
    if (submit) submit.textContent = isSignup ? 'Create account' : 'Sign in';

    var sub = $('cloudBrandSub');
    if (sub) sub.textContent = isSignup ? 'Create your Hisaab account' : 'Sign in to your shop';

    var pwd = $('cloudPassword');
    if (pwd) pwd.setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');

    setError('');
    setInfo('');
    showEl($('cloudRetry'));
  }

  function showOrgPanel() {
    hideEl($('cloudAuthPanel'));
    showEl($('cloudOrgPanel'));
    setError('');

    var sub = $('cloudBrandSub');
    if (sub) sub.textContent = 'One more step';
  }

  /* ─── apply organization to the local app ─────────────────── */

  function composeAddress(store) {
    if (!store) return '';
    var line = String(store.address || '').trim();
    var lower = line.toLowerCase();
    var parts = [line];
    ['city', 'state', 'pincode'].forEach(function (key) {
      var part = store[key] ? String(store[key]).trim() : '';
      if (part && lower.indexOf(part.toLowerCase()) === -1) parts.push(part);
    });
    return parts.filter(function (part) { return part; }).join(', ');
  }

  function applyContext() {
    var org = state.org || {};
    var store = state.store || {};
    var user = state.user || {};
    var profile = state.profile || {};

    var prevPos = (typeof window.getPosSettings === 'function')
      ? window.getPosSettings() : {};
    var cloudLogo = (store.settings && (store.settings.logo || store.settings.storeLogo)) || '';
    var settings = Object.assign({}, prevPos, {
      storeName: store.name || org.name || prevPos.storeName || 'Hisaab Store',
      storePhone: store.phone || prevPos.storePhone || '',
      storeEmail: store.email || user.email || prevPos.storeEmail || '',
      storeAddress: composeAddress(store) || prevPos.storeAddress || '',
      gstin: store.gstin || prevPos.gstin || '',
      state: store.state || prevPos.state || '',
      businessType: (store.settings && store.settings.businessType) || prevPos.businessType || 'Retail store',
      invoicePrefix: store.invoice_prefix || prevPos.invoicePrefix || 'INV-',
      // A logo saved on this device wins; otherwise hydrate it from the org store
      storeLogo: prevPos.storeLogo || cloudLogo || null
    });

    var prevProfile = (typeof window.getUserProfile === 'function')
      ? window.getUserProfile() : {};
    var person = Object.assign({}, prevProfile, {
      name: profile.full_name || (user.user_metadata && user.user_metadata.full_name) ||
        (user.email ? user.email.split('@')[0] : prevProfile.name) || 'Shop Owner',
      email: user.email || profile.email || prevProfile.email || '',
      phone: profile.phone || user.phone || prevProfile.phone || ''
    });

    if (typeof window.applyPosSettings === 'function') window.applyPosSettings(settings);
    else try { localStorage.setItem('hisaab_posSettings', JSON.stringify(settings)); } catch (e) { }

    if (typeof window.applyUserProfile === 'function') window.applyUserProfile(person);
    else try { localStorage.setItem('hisaab_userProfile', JSON.stringify(person)); } catch (e) { }

    try {
      localStorage.setItem('hisaab_onboardingDone', 'true');
      localStorage.setItem('hisaab_cloudOrg', JSON.stringify({
        orgId: org.id || null,
        orgName: org.name || '',
        storeId: store.id || null,
        storeName: store.name || '',
        role: state.role || 'owner',
        planId: org.plan_id || 'free'
      }));
    } catch (e) { /* ignore */ }

    sb().org.select(org.id, store.id);
  }

  function showApp() {
    document.documentElement.classList.remove('cloud-pending');
    document.documentElement.classList.remove('needs-onboarding');
    document.body.classList.remove('landing-active');
    document.body.classList.remove('ob-open');

    if (typeof window.closeOnboarding === 'function') {
      try { window.closeOnboarding(); } catch (e) { /* ignore */ }
    }
    var ob = $('onboardingScreen');
    if (ob) ob.classList.add('hidden');

    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var pos = $('view-pos');
    if (pos) pos.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === 'pos');
    });

    if (typeof window.setDate === 'function') window.setDate();
    if (typeof window.renderCartTotals === 'function') window.renderCartTotals();
    if (typeof window.renderPosCatalog === 'function') window.renderPosCatalog();
    if (typeof window.renderSettingsView === 'function') {
      var settingsView = $('view-settings');
      if (settingsView && settingsView.classList.contains('active')) window.renderSettingsView();
    }
  }

  function goActive() {
    state.mode = 'active';
    state.ready = true;
    hideGate();
    applyContext();
    showApp();
    syncAccountEntries();
    notify();
    try { initCatalogSync().catch(function (e) { console.warn('[Cloud] catalog sync init failed', e); }); } catch (e) {}
  }

  /* ─── bootstrap ───────────────────────────────────────────── */

  async function loadUserContext(session) {
    var userId = session.user.id;
    state.user = session.user;

    var results = await Promise.all([
      sb().profile.get(userId),
      sb().org.listMemberships(userId)
    ]);

    var profileRes = results[0];
    var memberRes = results[1];

    if (profileRes.ok && profileRes.profile) state.profile = profileRes.profile;

    if (!memberRes.ok) {
      var err = memberRes.error || {};
      state.mode = 'signed_out';
      showGate();
      showAuthPanel('login');
      if (String(err.code) === '42P01' || String(err.code) === 'PGRST205' ||
          /could not find the table|does not exist/i.test(err.message || '')) {
        setInfo('Database not initialised yet. Open Supabase → SQL Editor and run supabase/migrations/0001_core_tenancy.sql, then refresh.');
      } else {
        setError(err.message || 'Could not load your organization.');
      }
      return false;
    }

    state.memberships = memberRes.memberships || [];

    if (!state.memberships.length) {
      state.mode = 'onboarding';
      state.ready = true;
      showGate();
      showOrgPanel();
      notify();
      return false;
    }

    var savedOrgId = sb().org.currentId();
    var membership = state.memberships.filter(function (m) { return m.orgId === savedOrgId; })[0] ||
      state.memberships[0];

    state.org = membership.org || {};
    state.role = membership.role;

    var storeRes = await sb().org.fetchDefaultStore(membership.orgId);
    state.store = storeRes.ok ? storeRes.store : null;

    if (!state.store) {
      // The org exists but has no store yet: create one through onboarding.
      state.mode = 'onboarding';
      state.ready = true;
      showGate();
      showOrgPanel();
      notify();
      return false;
    }

    goActive();
    return true;
  }

  async function init() {
    state.configured = configured();

    if (!state.configured) {
      state.mode = 'local';
      state.ready = true;
      document.documentElement.classList.remove('cloud-pending');
      syncAccountEntries();
      notify();
      return { mode: 'local' };
    }

    // Cloud mode: keep cloud-pending until we know the destination view
    // (prevents a flash of the POS before the landing page or gate).
    try {
      syncAccountEntries();
    } catch (err) {
      console.warn('[Cloud] syncAccountEntries failed', err);
    }

    var sessionRes = null;
    try {
      sessionRes = await sb().auth.getSession();
    } catch (err) {
      console.warn('[Cloud] getSession failed', err);
      sessionRes = { offline: false, session: null };
    }

    if (sessionRes.offline) {
      state.offline = true;
      state.mode = 'signed_out';
      state.ready = true;
      document.documentElement.classList.remove('cloud-pending');
      document.body.classList.add('landing-active');
      hideGate();
      notify();
      return { mode: 'signed_out', offline: true };
    }

    if (!sessionRes.session) {
      state.mode = 'signed_out';
      state.ready = true;
      // Cloud is configured but nobody is signed in: show landing page.
      document.documentElement.classList.remove('cloud-pending');
      document.body.classList.add('landing-active');
      hideGate();
      if (typeof window.switchToView === 'function') {
        try { window.switchToView('landing'); } catch (e) { /* ignore */ }
      }
      notify();
      return { mode: 'signed_out' };
    }

    state.session = sessionRes.session;
    try {
      var ok = await loadUserContext(sessionRes.session);
    } catch (err) {
      console.warn('[Cloud] loadUserContext failed', err);
      var ok = false;
    }
    // Always remove cloud-pending so content is visible regardless of outcome.
    document.documentElement.classList.remove('cloud-pending');
    if (ok) {
      state.mode = 'active';
      state.ready = true;
      notify();
    } else {
      // loadUserContext failed: show landing page so user can sign in again
      // or the app can recover.
      state.mode = 'signed_out';
      state.ready = true;
      document.body.classList.add('landing-active');
      hideGate();
      if (typeof window.switchToView === 'function') {
        try { window.switchToView('landing'); } catch (e) { /* ignore */ }
      }
      notify();
    }
    return { mode: state.mode, signedIn: ok };
  }

  /* ─── auth actions ────────────────────────────────────────── */

  async function submitAuth(event) {
    if (event) event.preventDefault();
    if (state.busy) return;

    var email = (($('cloudEmail') || {}).value || '').trim();
    var password = (($('cloudPassword') || {}).value || '');
    var name = (($('cloudName') || {}).value || '').trim();
    var isSignup = state.authMode === 'signup';
    var submit = $('cloudAuthSubmit');

    setError('');
    setInfo('');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address.'); return; }
    if (isSignup && password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!isSignup && !password) { setError('Enter your password.'); return; }

    state.busy = true;
    if (submit) { submit.disabled = true; submit.textContent = isSignup ? 'Creating account…' : 'Signing in…'; }

    try {
      var result = isSignup
        ? await sb().auth.signUp(email, password, name)
        : await sb().auth.signIn(email, password);

      if (!result.ok) {
        setError((result.error && result.error.message) || 'Could not sign you in.');
        return;
      }

      if (result.needsConfirmation) {
        setInfo('Account created. Check ' + email + ' for a confirmation link, then sign in. Tip: turn off “Confirm email” in Supabase for instant access.');
        showAuthPanel('login');
        if ($('cloudEmail')) $('cloudEmail').value = email;
        return;
      }

      state.session = result.session;
      state.user = result.user;
      await loadUserContext(result.session);
    } finally {
      state.busy = false;
      if (submit) {
        submit.disabled = false;
        submit.textContent = state.authMode === 'signup' ? 'Create account' : 'Sign in';
      }
    }
  }

  async function signOut() {
    if (state.busy) return;
    state.busy = true;
    state._signingOut = true;   // prevent onAuthChange from re-showing the gate
    state.mode = 'signed_out';  // mark as signed out before Supabase clears the session
    resetCatalogSyncState();
    try {
      await sb().auth.signOut();
    } catch (e) { /* ignore */ }

    state.session = null;
    state.user = null;
    state.profile = null;
    state.memberships = [];
    state.org = null;
    state.store = null;
    state.role = null;
    state.ready = true;
    state.busy = false;
    state._signingOut = false;

    sb().org.clear();
    try { localStorage.removeItem(LS.deviceUser); } catch (e) { }
    try { localStorage.removeItem('hisaab_cloudOrg'); } catch (e) { }
    try { localStorage.removeItem('hisaab_posSettings'); } catch (e) { }
    try { localStorage.removeItem('hisaab_storeLogo'); } catch (e) { }
    try { localStorage.removeItem('hisaab_userProfile'); } catch (e) { }

    if (window.HisaabSaaS && typeof window.HisaabSaaS.clearIdentity === 'function') {
      window.HisaabSaaS.clearIdentity();
    }
    try {
      if (typeof window.HisaabResetCloudBusinessData === 'function') {
        window.HisaabResetCloudBusinessData({ render: false });
      }
    } catch (e) { /* ignore */ }

    // Return to the landing page (not the auth gate) after sign-out.
    hideGate();
    // If we were inside the POS, switch back to the landing view.
    if (typeof window.switchToView === 'function') {
      try { window.switchToView('landing'); } catch (e) { /* ignore */ }
    }
    document.body.classList.add('landing-active');
    document.body.classList.remove('user-dropdown-open');

    syncAccountEntries();
    notify();
    toastMsg('Signed out.', 'info');
  }

  async function submitOrg(event) {
    if (event) event.preventDefault();
    if (state.busy) return;

    var name = (($('cloudOrgName') || {}).value || '').trim();
    var storeName = (($('cloudStoreName') || {}).value || '').trim();
    var phone = (($('cloudOrgPhone') || {}).value || '').trim();
    var gstin = (($('cloudOrgGstin') || {}).value || '').trim().toUpperCase();
    var address = (($('cloudOrgAddress') || {}).value || '').trim();
    var city = (($('cloudOrgCity') || {}).value || '').trim();
    var orgState = (($('cloudOrgState') || {}).value || '').trim();
    var pincode = (($('cloudOrgPincode') || {}).value || '').replace(/\D/g, '').slice(0, 6);
    var businessType = (($('cloudOrgType') || {}).value || 'Retail store');

    if (!name) { setError('Business name is required.'); if ($('cloudOrgName')) $('cloudOrgName').focus(); return; }
    if (gstin && gstin.length !== 15) { setError('GSTIN must be 15 characters.'); return; }

    state.busy = true;
    var submit = $('cloudOrgSubmit');
    if (submit) { submit.disabled = true; submit.textContent = 'Creating…'; }

    try {
      var res = await sb().org.create({
        name: name,
        storeName: storeName || name,
        phone: phone,
        gstin: gstin,
        address: address,
        city: city,
        state: orgState,
        pincode: pincode,
        businessType: businessType
      });

      if (!res.ok) {
        setError((res.error && res.error.message) || 'Could not create your business.');
        return;
      }

      if (res.organization) state.org = res.organization;
      if (res.store) state.store = res.store;
      state.role = 'owner';

      var memberRes = await sb().org.listMemberships(state.user.id);
      if (memberRes.ok) state.memberships = memberRes.memberships;

      var storeRes = await sb().org.fetchDefaultStore(state.org.id);
      if (storeRes.ok && storeRes.store) state.store = storeRes.store;

      goActive();
      syncAccountEntries();
      toastMsg('Business created — welcome to Hisaab, ' + name + '.', 'success');
    } finally {
      state.busy = false;
      if (submit) { submit.disabled = false; submit.textContent = 'Create business'; }
    }
  }

  async function forgotPassword() {
    var email = (($('cloudEmail') || {}).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter your email above, then tap “Forgot password”.');
      return;
    }
    var res = await sb().auth.resetPassword(email);
    if (!res.ok) { setError((res.error && res.error.message) || 'Could not send the reset email.'); return; }
    setInfo('Password reset link sent to ' + email + '.');
  }

  /* ─── cloud app data sync (catalog + operational data) ────── */
  var catalogSync = {
    ready: false,
    pushing: false,
    timer: null,
    lastPushedAt: 0,
    suspendCount: 0
  };

  function suspendCatalogPush() {
    catalogSync.suspendCount = (catalogSync.suspendCount || 0) + 1;
    if (catalogSync.timer) {
      clearTimeout(catalogSync.timer);
      catalogSync.timer = null;
    }
  }

  function resumeCatalogPush() {
    catalogSync.suspendCount = Math.max(0, (catalogSync.suspendCount || 0) - 1);
  }

  function resetCatalogSyncState() {
    if (catalogSync.timer) {
      clearTimeout(catalogSync.timer);
      catalogSync.timer = null;
    }
    catalogSync.ready = false;
    catalogSync.pushing = false;
  }
  var DATA_KEYS = ['products', 'categories', 'subcategories', 'brands', 'customers', 'sales', 'returns', 'damages', 'stockMovements', 'cashDrawer', 'invoiceCounter', 'waConfig', 'waLog'];

  function readCatalogLocal() {
    var out = {};
    DATA_KEYS.forEach(function (k) {
      try {
        var raw = localStorage.getItem('hisaab_' + k);
        if (raw == null) {
          out[k] = (k === 'cashDrawer') ? { opening: 0, cashIn: 0, cashOut: 0, log: [] } : (k === 'invoiceCounter' ? 1 : (k === 'waConfig' ? {} : []));
          return;
        }
        var v = JSON.parse(raw);
        if (k === 'cashDrawer') out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? v : { opening: 0, cashIn: 0, cashOut: 0, log: [] };
        else if (k === 'invoiceCounter') out[k] = Number(v) || 1;
        else if (k === 'waConfig') out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        else out[k] = Array.isArray(v) ? v : [];
      } catch (e) {
        out[k] = (k === 'cashDrawer') ? { opening: 0, cashIn: 0, cashOut: 0, log: [] } : (k === 'invoiceCounter' ? 1 : (k === 'waConfig' ? {} : []));
      }
    });
    return out;
  }

  function hasLocalCatalogData(c) {
    if (!c) return false;
    return DATA_KEYS.some(function (k) {
      var v = c[k];
      if (Array.isArray(v)) return v.length > 0;
      if (k === 'invoiceCounter') return Number(v) > 1;
      if (k === 'cashDrawer') return !!(v && (Number(v.opening) || Number(v.cashIn) || Number(v.cashOut) || (Array.isArray(v.log) && v.log.length)));
      if (k === 'waConfig') return !!(v && typeof v === 'object' && Object.keys(v).length > 0);
      return false;
    });
  }

  function cloudCatalogValid(cat) {
    return !!(cat && typeof cat === 'object' && (cat._synced || cat.updatedAt || DATA_KEYS.some(function (k) { return Object.prototype.hasOwnProperty.call(cat, k); })));
  }

  async function fetchOrgFresh() {
    if (!configured() || !state.org || !state.org.id) return null;
    try {
      var res = await sb().client.from('organizations').select('id, settings, plan_id, name, status, currency, timezone').eq('id', state.org.id).single();
      if (res.error) return null;
      return res.data || null;
    } catch (e) { return null; }
  }

  async function initCatalogSync() {
    if (!configured() || state.mode !== 'active' || !state.org || !state.org.id) return;
    catalogSync.ready = false;

    var orgRow = await fetchOrgFresh();
    if (orgRow) {
      state.org = Object.assign({}, state.org || {}, orgRow);
    }
    var orgSettings = (state.org && state.org.settings && typeof state.org.settings === 'object') ? state.org.settings : {};
    var cloudCat = orgSettings.catalog;

    if (cloudCatalogValid(cloudCat)) {
      // Cloud is source of truth for shared app data
      if (typeof window.HisaabApplyCloudCatalog === 'function') {
        window.HisaabApplyCloudCatalog(cloudCat);
      } else {
        DATA_KEYS.forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(cloudCat, k)) {
            try { localStorage.setItem('hisaab_' + k, JSON.stringify(cloudCat[k])); } catch (e) {}
          }
        });
      }
      toastMsg('Synced data from cloud.', 'success');
    } else {
      // First-time sync: upload existing local data if present
      var localCat = readCatalogLocal();
      await pushCatalogNow(localCat, true);
      if (hasLocalCatalogData(localCat)) toastMsg('Uploaded local data to cloud.', 'success');
    }
    catalogSync.ready = true;
  }

  async function pushCatalogNow(catalogData, force) {
    if (!configured() || state.mode !== 'active' || !state.org || !state.org.id) return { ok: false };
    if (catalogSync.pushing && !force) return { ok: false, busy: true };
    catalogSync.pushing = true;
    try {
      var base = catalogData && typeof catalogData === 'object' ? catalogData : readCatalogLocal();
      var payloadCatalog = { updatedAt: new Date().toISOString(), _synced: true };
      DATA_KEYS.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(base, k)) payloadCatalog[k] = base[k];
        else {
          // ensure complete snapshot
          if (k === 'cashDrawer') payloadCatalog[k] = { opening: 0, cashIn: 0, cashOut: 0, log: [] };
          else if (k === 'invoiceCounter') payloadCatalog[k] = 1;
          else if (k === 'waConfig') payloadCatalog[k] = {};
          else payloadCatalog[k] = [];
        }
      });

      // Merge with latest org settings to avoid clobbering unrelated keys
      var orgRow = await fetchOrgFresh();
      var currentSettings = (orgRow && orgRow.settings && typeof orgRow.settings === 'object') ? orgRow.settings : ((state.org && state.org.settings) || {});
      var mergedSettings = Object.assign({}, currentSettings, { catalog: payloadCatalog });

      var res = await sb().org.update(state.org.id, { settings: mergedSettings });
      if (res.ok && res.organization) {
        state.org = Object.assign({}, state.org || {}, res.organization);
        catalogSync.lastPushedAt = Date.now();
        return { ok: true };
      }
      return { ok: false, error: res.error || null };
    } catch (e) {
      return { ok: false, error: e };
    } finally {
      catalogSync.pushing = false;
    }
  }

  function queueCatalogPush() {
    if (!configured() || state.mode !== 'active' || !catalogSync.ready) return;
    if (catalogSync.suspendCount > 0) return;
    if (catalogSync.timer) clearTimeout(catalogSync.timer);
    catalogSync.timer = setTimeout(function () {
      catalogSync.timer = null;
      if (catalogSync.suspendCount > 0 || state.mode !== 'active') return;
      pushCatalogNow(null, false).catch(function (e) { console.warn('[Cloud] catalog push failed', e); });
    }, 1200);
  }

  /* ─── write-through from Settings forms ───────────────────── */

  /**
   * Persist shop details edited in Settings → POS Settings.
   * The store row is the source of truth; the local settings object stays a
   * cache so billing keeps working if the network drops.
   */
  async function saveBusiness(settings) {
    if (!configured() || state.mode !== 'active') return { ok: false, localOnly: true };
    var store = state.store || {};
    if (!store.id) return { ok: false, localOnly: true };

    var patch = {
      name: settings.storeName || store.name || 'Hisaab Store',
      phone: settings.storePhone || null,
      email: settings.storeEmail || null,
      address: settings.storeAddress || null,
      state: settings.state || null,
      gstin: settings.gstin || null,
      settings: Object.assign({}, store.settings || {}, {
        businessType: settings.businessType || 'Retail store',
        // Keep the logo in the store's settings JSONB so a new device (or a
        // cleared browser cache) can restore it.
        logo: settings.storeLogo !== undefined
          ? (settings.storeLogo || null)
          : ((store.settings && store.settings.logo) || null)
      })
    };

    var res = await sb().org.updateStore(store.id, patch);
    if (res.ok && res.store) {
      state.store = res.store;
      toastMsg('Business details saved to your organization.', 'success');
      return { ok: true, store: res.store };
    }
    toastMsg((res.error && res.error.message) || 'Saved locally — could not reach the server.', 'error');
    return { ok: false, localOnly: true, error: res.error || null };
  }

  /** Persist just the store logo to the organization's store row. */
  async function saveStoreLogo(logo) {
    if (!configured() || state.mode !== 'active') return { ok: false, localOnly: true };
    var store = state.store || {};
    if (!store.id) return { ok: false, localOnly: true };
    var patch = {
      settings: Object.assign({}, store.settings || {}, { logo: logo || null })
    };
    var res = await sb().org.updateStore(store.id, patch);
    if (res.ok && res.store) {
      state.store = res.store;
      return { ok: true, store: res.store };
    }
    return { ok: false, error: res.error || null };
  }

  /** Persist the signed-in person's name / phone to their profile. */
  async function saveProfile(patch) {
    if (!configured() || state.mode !== 'active' || !state.user) {
      return { ok: false, localOnly: true };
    }
    var res = await sb().profile.update(state.user.id, {
      full_name: (patch && patch.full_name) || '',
      phone: (patch && patch.phone) || null
    });
    if (res.ok) {
      state.profile = res.profile;
      return { ok: true, profile: res.profile };
    }
    return { ok: false, error: res.error || null };
  }

  /* ─── account menu ────────────────────────────────────────── */

  function syncAccountEntries() {
    var signOutBtn = $('menuSignOut');
    if (signOutBtn) signOutBtn.classList.toggle('hidden', !state.configured || state.mode !== 'active');

    var logoutBtn = $('menuLogout');
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !!state.configured);

    // The local setup wizard would create a second, unrelated shop profile.
    // In cloud mode the organization is the source of truth, so hide it.
    var wizard = $('stgSetupWizardCard');
    if (wizard) wizard.classList.toggle('hidden', !!state.configured);

    var cloudEmail = $('menuCloudEmail');
    if (cloudEmail) {
      if (state.configured && state.user && state.user.email) {
        cloudEmail.textContent = state.user.email;
        cloudEmail.classList.remove('hidden');
      } else {
        cloudEmail.classList.add('hidden');
      }
    }
  }

  /* ─── listeners ───────────────────────────────────────────── */

  function notify() {
    listeners.slice().forEach(function (fn) {
      try { fn(api()); } catch (e) { console.warn('[Cloud] listener failed', e); }
    });

    // Billing is keyed to the signed-in identity.
    if (state.mode === 'active' && state.user && window.HisaabSaaS && typeof window.HisaabSaaS.setIdentity === 'function') {
      window.HisaabSaaS.setIdentity(state.user.id);
    }
  }

  function wire() {
    var gate = $('cloudGate');
    if (gate) {
      gate.addEventListener('click', function (e) {
        var tab = e.target.closest && e.target.closest('[data-cloud-tab]');
        if (tab) {
          e.preventDefault();
          showAuthPanel(tab.getAttribute('data-cloud-tab'));
        }
      });
    }

    var authForm = $('cloudAuthForm');
    if (authForm) authForm.addEventListener('submit', submitAuth);

    var orgForm = $('cloudOrgForm');
    if (orgForm) orgForm.addEventListener('submit', submitOrg);

    var tabLogin = $('cloudTabLogin');
    if (tabLogin) tabLogin.addEventListener('click', function () { showAuthPanel('login'); });
    var tabSignup = $('cloudTabSignup');
    if (tabSignup) tabSignup.addEventListener('click', function () { showAuthPanel('signup'); });

    var forgot = $('cloudForgot');
    if (forgot) forgot.addEventListener('click', forgotPassword);

    var retry = $('cloudRetry');
    if (retry) retry.addEventListener('click', function () { init(); });

    var orgSignOut = $('cloudOrgSignOut');
    if (orgSignOut) orgSignOut.addEventListener('click', signOut);

    var menuSignOut = $('menuSignOut');
    if (menuSignOut) {
      menuSignOut.addEventListener('click', function (e) {
        e.preventDefault();
        var dd = $('userDropdown');
        if (dd) dd.classList.add('hidden');
        signOut();
      });
    }

    if (configured()) {
      sb().auth.onAuthChange(function (event) {
        // Ignore session changes while we are in the middle of signing out.
        if (state._signingOut) return;
        if (event === 'SIGNED_OUT' && state.mode === 'active') {
          // Session revoked elsewhere; return to the landing page.
          resetCatalogSyncState();
          state.session = null;
          state.mode = 'signed_out';
          sb().org.clear();
          try { localStorage.removeItem('hisaab_cloudOrg'); } catch (e) { }
          try { localStorage.removeItem('hisaab_posSettings'); } catch (e) { }
          try { localStorage.removeItem('hisaab_storeLogo'); } catch (e) { }
          try { localStorage.removeItem('hisaab_userProfile'); } catch (e) { }
          try {
            if (typeof window.HisaabResetCloudBusinessData === 'function') {
              window.HisaabResetCloudBusinessData({ render: false });
            }
          } catch (e) { /* ignore */ }
          hideGate();
          document.body.classList.add('landing-active');
          if (typeof window.switchToView === 'function') {
            try { window.switchToView('landing'); } catch (e) { /* ignore */ }
          }
          syncAccountEntries();
          notify();
        }
      });
    }
  }

  function api() {
    return {
      configured: state.configured,
      ready: state.ready,
      mode: state.mode,
      userId: state.user ? state.user.id : null,
      email: state.user ? state.user.email : null,
      org: state.org,
      store: state.store,
      role: state.role,
      memberships: state.memberships,
      signOut: signOut,
      openGate: function () { showGate(); showAuthPanel('login'); }
    };
  }

  window.HisaabCloud = {
    init: init,
    isConfigured: function () { return state.configured; },
    isReady: function () { return state.ready; },
    isCloudMode: function () { return state.configured; },
    isActive: function () { return state.mode === 'active'; },
    userId: function () { return state.user ? state.user.id : null; },
    userEmail: function () { return state.user ? state.user.email : null; },
    org: function () { return state.org; },
    store: function () { return state.store; },
    role: function () { return state.role; },
    signOut: signOut,
    openGate: function () { showGate(); showAuthPanel('login'); },
    saveBusiness: saveBusiness,
    saveStoreLogo: saveStoreLogo,
    saveProfile: saveProfile,
    queueCatalogPush: queueCatalogPush,
    syncCatalogNow: function () { return pushCatalogNow(null, true); },
    _suspendCatalogPush: suspendCatalogPush,
    _resumeCatalogPush: resumeCatalogPush,
    onReady: function (fn) {
      if (typeof fn !== 'function') return function () { };
      listeners.push(fn);
      if (state.ready) { try { fn(api()); } catch (e) { } }
      return function () {
        listeners = listeners.filter(function (item) { return item !== fn; });
      };
    },
    state: state
  };

  // Hide the POS shell immediately when Supabase is configured, so the user
  // never sees the old local landing page flash behind the auth gate.
  if (window.HisaabSupabase && window.HisaabSupabase.configured()) {
    document.documentElement.classList.add('cloud-pending');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  // Initialize cloud identity (auth + organization). Safe to call multiple times.
  if (window.HisaabSupabase && window.HisaabSupabase.configured()) {
    // Use setTimeout(0) to allow the browser to finish initializing before
    // calling init(), preventing any race conditions with script loading.
    setTimeout(() => {
      init().catch(err => console.warn('[Cloud] init failed', err));
    }, 0);
  }

  // Safety net: remove cloud-pending after 2 seconds in case init() never completes.
  // This prevents the page from being permanently hidden.
  setTimeout(() => {
    if (document.documentElement.classList.contains('cloud-pending')) {
      console.warn('[Cloud] cloud-pending timeout, forcing removal');
      document.documentElement.classList.remove('cloud-pending');
      document.body.classList.add('landing-active');
      if (typeof window.switchToView === 'function') {
        try { window.switchToView('landing'); } catch (e) { /* ignore */ }
      }
    }
  }, 2000);
})();
