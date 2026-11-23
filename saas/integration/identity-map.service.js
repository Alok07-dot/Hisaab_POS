'use strict';

/**
 * STEP 7 integration: SaaS JSON <-> Supabase identity mapping/reconciliation.
 * - Always provides live read models from existing SaaS store (authoritative for billing/auth linkage).
 * - Optionally enriches from Supabase via server-only privileged REST access when
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are configured. Service key is never exposed.
 * - RLS/tenant isolation preserved: enrichment is read-only and server-side only.
 */

const store = require('../store');

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.HISAAB_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

function supabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

async function supabaseFetch(pathWithQuery) {
  if (!supabaseConfigured()) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathWithQuery, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        Accept: 'application/json'
      }
    });
    if (!res.ok) return { error: `supabase_${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: 'supabase_unreachable' };
  }
}

function normalizeAccountRow(a) {
  const sub = store.effectiveSubscription(a);
  const plan = store.effectivePlan(a);
  return {
    source: 'saas_json',
    account: store.publicAccount(a),
    subscription: sub,
    effectivePlan: plan ? plan.id : (sub && sub.planId) || 'free',
    links: { supabase: { status: supabaseConfigured() ? 'reconcilable' : 'not_configured' } }
  };
}

function listSaasAccounts({ limit = 200, offset = 0, q = '', status = '', plan = '' } = {}) {
  const db = store.load();
  let rows = (db.accounts || []).slice();
  if (q) {
    const s = String(q).toLowerCase();
    rows = rows.filter(a => [a.id, a.email, a.contactEmail, a.name, a.storeName].some(v => String(v || '').toLowerCase().includes(s)));
  }
  if (status) rows = rows.filter(a => String(a.status) === status);
  if (plan) rows = rows.filter(a => (store.effectiveSubscription(a) && store.effectiveSubscription(a).planId) === plan);
  rows.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  const total = rows.length;
  const lim = Math.max(1, Math.min(500, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);
  const items = rows.slice(off, off + lim).map(normalizeAccountRow);
  return { items, total, meta: { source: 'saas_json', supabaseConfigured: supabaseConfigured() } };
}

function resolveAccount(idOrEmail) {
  let acc = store.findAccountById(idOrEmail);
  if (!acc) acc = store.findAccountByEmail(idOrEmail);
  if (!acc) return null;
  const plan = store.effectivePlan(acc);
  return {
    source: 'saas_json',
    account: store.publicAccount(acc),
    subscription: store.effectiveSubscription(acc),
    effectivePlan: plan,
    usage: acc.usage || {},
    links: { supabase: { status: supabaseConfigured() ? 'reconcilable' : 'not_configured', note: supabaseConfigured() ? 'Supabase enrichment available via server-side service access (read-only).' : 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for Supabase enrichment.' } }
  };
}

// Best-effort businesses view: SaaS accounts represent billable businesses in current architecture.
// Optionally augments with Supabase organizations if available.
async function listBusinesses({ limit = 200, q = '' } = {}) {
  const accounts = listSaasAccounts({ limit, q });
  const items = accounts.items.map(it => {
    const a = it.account || {};
    const sub = it.subscription || {};
    return {
      id: a.id,
      name: a.storeName || a.name || 'Business',
      owner: a.name || '—',
      email: a.email || a.contactEmail || '—',
      status: a.status || 'active',
      plan: it.effectivePlan || (sub.planId || 'free'),
      subscriptionStatus: sub.status || 'active',
      joined: a.createdAt || null,
      lastActive: a.lastSeenAt || null,
      products: a.productCount || 0,
      devices: a.deviceCount || 0,
      source: 'saas_json',
      raw: it
    };
  });
  let supa = null;
  if (supabaseConfigured()) {
    // Attempt read-only org/profile discovery without assuming schema; safe best-effort.
    const orgs = await supabaseFetch('organizations?select=id,name,created_at&limit=200');
    if (Array.isArray(orgs)) supa = { organizations: orgs.length };
  }
  return { items, total: accounts.total, meta: { source: 'saas_json', supabaseConfigured: supabaseConfigured(), supabase: supa, note: supabaseConfigured() ? 'Businesses derived from SaaS accounts with Supabase server access available for enrichment.' : 'Businesses derived from SaaS accounts. Configure Supabase service env for direct org/profile enrichment.' } };
}

module.exports = { listSaasAccounts, resolveAccount, listBusinesses, supabaseConfigured };
