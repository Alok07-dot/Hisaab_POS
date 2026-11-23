/**
 * ==============================================================================
 * HISAAB POS - Supabase client
 * ==============================================================================
 * Auth (Supabase Auth) + organization/store bootstrap for the multi-tenant app.
 *
 * Security notes:
 * - Only the PUBLIC anon key is used here. It is safe in the browser.
 * - Tenant isolation is enforced by Postgres RLS, not by this file, so a
 *   tampered request can only ever return the caller's own organization.
 * - Never put the service_role key in client-side code.
 *
 * If config.js still holds placeholders the app stays in local/offline mode.
 */

(function () {
  'use strict';

  var ORG_KEY = 'hisaab_org_id';
  var STORE_KEY = 'hisaab_store_id';

  function readLS(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function writeLS(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
  }

  function normalizeError(error) {
    if (!error) return { message: 'Unknown error.' };
    return {
      message: error.message || String(error),
      code: error.code || error.status || null,
      details: error.details || null
    };
  }

  window.HisaabSupabase = {
    client: null,
    isConfigured: false,
    status: 'uninitialized',
    lastError: null,

    /* ── init ─────────────────────────────────────────────────────────── */

    init: function () {
      if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
        this.status = 'sdk_missing';
        console.warn('[Hisaab Supabase] SDK not loaded. Check the script tag in index.html.');
        return null;
      }

      var config = window.SUPABASE_CONFIG || {};
      var url = config.url ? String(config.url).trim() : '';
      var anonKey = config.anonKey ? String(config.anonKey).trim() : '';

      var isPlaceholder = !url || !anonKey ||
        url.indexOf('YOUR_PROJECT_ID') !== -1 ||
        anonKey.indexOf('YOUR_SUPABASE_ANON_PUBLIC_KEY') !== -1 ||
        url.indexOf('your-project') !== -1;

      if (isPlaceholder) {
        this.status = 'pending_config';
        this.isConfigured = false;
        console.info(
          '%c[Hisaab]%c Supabase not configured — running in local mode. ' +
          'Add your Project URL and anon public key to config.js.',
          'color:#7c3aed;font-weight:bold;',
          'color:#4b5563;'
        );
        return null;
      }

      try {
        this.client = window.supabase.createClient(url, anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'hisaab_auth_session'
          }
        });
        this.isConfigured = true;
        this.status = 'ready';
        console.info('%c[Hisaab]%c Supabase connected.', 'color:#10b981;font-weight:bold;', 'color:#4b5563;');
        return this.client;
      } catch (err) {
        this.status = 'init_error';
        this.lastError = err;
        console.error('[Hisaab Supabase] Initialization error:', err);
        return null;
      }
    },

    configured: function () {
      return !!this.isConfigured && !!this.client;
    },

    /* ── connectivity check (non-destructive) ─────────────────────────── */

    verifyConnection: async function () {
      if (!this.client || !this.isConfigured) {
        return {
          connected: false,
          status: this.status,
          message: 'Supabase client is not configured yet.'
        };
      }
      try {
        var res = await this.client.auth.getSession();
        if (res.error) {
          return { connected: false, status: 'auth_error', message: res.error.message };
        }
        return { connected: true, status: 'connected', message: 'Supabase reachable.', session: res.data ? res.data.session : null };
      } catch (err) {
        return { connected: false, status: 'network_error', message: err.message || String(err) };
      }
    },

    /* ── Auth ─────────────────────────────────────────────────────────── */

    auth: {
      getSession: async function () {
        var sb = window.HisaabSupabase;
        if (!sb.configured()) return { session: null, user: null, offline: true };
        try {
          var res = await sb.client.auth.getSession();
          if (res.error) return { session: null, user: null, error: normalizeError(res.error) };
          var session = (res.data && res.data.session) || null;
          return { session: session, user: session ? session.user : null };
        } catch (err) {
          return { session: null, user: null, offline: true, error: normalizeError(err) };
        }
      },

      signUp: async function (email, password, fullName) {
        var sb = window.HisaabSupabase;
        if (!sb.configured()) return { ok: false, error: { message: 'Supabase is not configured.' } };
        try {
          var res = await sb.client.auth.signUp({
            email: email,
            password: password,
            options: { data: { full_name: fullName || '' } }
          });
          if (res.error) return { ok: false, error: normalizeError(res.error) };
          var session = res.data ? res.data.session : null;
          return {
            ok: true,
            session: session,
            user: res.data ? res.data.user : null,
            needsConfirmation: !session
          };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      },

      signIn: async function (email, password) {
        var sb = window.HisaabSupabase;
        if (!sb.configured()) return { ok: false, error: { message: 'Supabase is not configured.' } };
        try {
          var res = await sb.client.auth.signInWithPassword({ email: email, password: password });
          if (res.error) return { ok: false, error: normalizeError(res.error) };
          return { ok: true, session: res.data.session, user: res.data.user };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      },

      signOut: async function () {
        var sb = window.HisaabSupabase;
        if (!sb.configured()) return { ok: true };
        try {
          var res = await sb.client.auth.signOut();
          return { ok: !res.error, error: res.error ? normalizeError(res.error) : null };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      },

      resetPassword: async function (email, redirectTo) {
        var sb = window.HisaabSupabase;
        if (!sb.configured()) return { ok: false, error: { message: 'Supabase is not configured.' } };
        try {
          var res = await sb.client.auth.resetPasswordForEmail(email, {
            redirectTo: redirectTo || (window.location.origin + window.location.pathname)
          });
          return { ok: !res.error, error: res.error ? normalizeError(res.error) : null };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      },

      onAuthChange: function (handler) {
        var sb = window.HisaabSupabase;
        if (!sb.configured()) return function () {};
        var sub = sb.client.auth.onAuthStateChange(function (event, session) {
          try { handler(event, session); } catch (err) { console.warn('[Hisaab] auth handler failed', err); }
        });
        return function () {
          try { if (sub && sub.data && sub.data.subscription) sub.data.subscription.unsubscribe(); } catch (e) { /* ignore */ }
        };
      }
    },

    /* ── Organizations & stores ───────────────────────────────────────── */

    org: {
      /**
       * Memberships for a user, with the organization embedded.
       * RLS already limits this to the caller's own rows.
       */
      listMemberships: async function (userId) {
        var sb = window.HisaabSupabase;
        if (!sb.configured() || !userId) return { ok: false, memberships: [] };
        try {
          var res = await sb.client
            .from('org_members')
            .select('org_id, role, status, organizations(id, name, slug, plan_id, status, currency, timezone)')
            .eq('user_id', userId)
            .eq('status', 'active');
          if (res.error) return { ok: false, error: normalizeError(res.error), memberships: [] };
          var rows = (res.data || []).map(function (row) {
            var org = row.organizations || {};
            return {
              orgId: row.org_id,
              role: row.role,
              org: org
            };
          });
          return { ok: true, memberships: rows };
        } catch (err) {
          return { ok: false, error: normalizeError(err), memberships: [] };
        }
      },

      create: async function (payload) {
        var sb = window.HisaabSupabase;
        if (!sb.configured()) return { ok: false, error: { message: 'Supabase is not configured.' } };
        var p = payload || {};
        try {
          var res = await sb.client.rpc('create_organization', {
            p_name: p.name,
            p_store_name: p.storeName || p.name,
            p_phone: p.phone || null,
            p_address: p.address || null,
            p_city: p.city || null,
            p_state: p.state || null,
            p_pincode: p.pincode || null,
            p_gstin: p.gstin || null,
            p_business_type: p.businessType || 'Retail store'
          });
          if (res.error) return { ok: false, error: normalizeError(res.error) };
          var data = res.data || {};
          return {
            ok: true,
            organization: data.organization || null,
            store: data.store || null
          };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      },

      fetchDefaultStore: async function (orgId) {
        var sb = window.HisaabSupabase;
        if (!sb.configured() || !orgId) return { ok: false, store: null };
        try {
          var res = await sb.client
            .from('stores')
            .select('id, org_id, name, phone, email, address, city, state, pincode, gstin, invoice_prefix, is_default, settings')
            .eq('org_id', orgId)
            .eq('is_active', true)
            .order('is_default', { ascending: false })
            .limit(1);
          if (res.error) return { ok: false, error: normalizeError(res.error), store: null };
          var rows = res.data || [];
          return { ok: true, store: rows.length ? rows[0] : null };
        } catch (err) {
          return { ok: false, error: normalizeError(err), store: null };
        }
      },

      updateStore: async function (storeId, patch) {
        var sb = window.HisaabSupabase;
        if (!sb.configured() || !storeId) return { ok: false, error: { message: 'Missing store.' } };
        try {
          var res = await sb.client.from('stores').update(patch).eq('id', storeId).select('*').single();
          if (res.error) return { ok: false, error: normalizeError(res.error) };
          return { ok: true, store: res.data };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      },

      update: async function (orgId, patch) {
        var sb = window.HisaabSupabase;
        if (!sb.configured() || !orgId) return { ok: false, error: { message: 'Missing organization.' } };
        try {
          var res = await sb.client.from('organizations').update(patch).eq('id', orgId).select('*').single();
          if (res.error) return { ok: false, error: normalizeError(res.error) };
          return { ok: true, organization: res.data };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      },

      /** Current organization id remembered on this device. */
      currentId: function () {
        return readLS(ORG_KEY);
      },

      select: function (orgId, storeId) {
        writeLS(ORG_KEY, orgId || '');
        writeLS(STORE_KEY, storeId || '');
      },

      clear: function () {
        writeLS(ORG_KEY, '');
        writeLS(STORE_KEY, '');
      }
    },

    profile: {
      get: async function (userId) {
        var sb = window.HisaabSupabase;
        if (!sb.configured() || !userId) return { ok: false, profile: null };
        try {
          var res = await sb.client
            .from('profiles')
            .select('id, full_name, phone, avatar_url, locale')
            .eq('id', userId)
            .maybeSingle();
          if (res.error) return { ok: false, error: normalizeError(res.error), profile: null };
          return { ok: true, profile: res.data };
        } catch (err) {
          return { ok: false, error: normalizeError(err), profile: null };
        }
      },

      update: async function (userId, patch) {
        var sb = window.HisaabSupabase;
        if (!sb.configured() || !userId) return { ok: false, error: { message: 'Missing user.' } };
        try {
          var res = await sb.client.from('profiles').update(patch).eq('id', userId).select('*').single();
          if (res.error) return { ok: false, error: normalizeError(res.error) };
          return { ok: true, profile: res.data };
        } catch (err) {
          return { ok: false, error: normalizeError(err) };
        }
      }
    }
  };

  // Auto-init on script evaluation.
  window.HisaabSupabase.init();
})();
