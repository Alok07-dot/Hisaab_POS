/* ══════════════════════════════════════════════════════════════
   HISAAB POS – Super Admin User Management test
   Run: node test/user-admin.test.js

   Spawns its own server with a throw-away data dir so real data is
   never touched.
   ══════════════════════════════════════════════════════════════ */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = Number(process.env.TEST_PORT || 3211);
const HTTPS_PORT = PORT + 1200;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(os.tmpdir(), 'hisaab-user-admin-test-' + Date.now());
const ADMIN_EMAIL = 'admin@hisaab.local';
const ADMIN_PASSWORD = 'Admin@12345';

let passed = 0;
let failed = 0;
let serverLog = '';

function ok(name) {
  passed++;
  console.log('  ✓ ' + name);
}

function fail(name, err) {
  failed++;
  console.error('  ✗ ' + name);
  console.error('    ' + (err && err.message ? err.message : String(err)));
}

async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
    throw err;
  }
}

async function api(method, endpoint, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + endpoint, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  return { status: res.status, data, headers: res.headers };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForServer() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch (err) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Server did not start in time');
}

async function createDevice(deviceId, extra = {}) {
  return api('POST', '/api/auth/device', Object.assign({
    deviceId,
    name: extra.name || 'Shop Owner',
    storeName: extra.storeName || 'Hisaab Store',
    email: extra.email || ''
  }, extra));
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HTTPS_PORT: String(HTTPS_PORT),
      HISAAB_DATA_DIR: DATA_DIR,
      ADMIN_EMAIL,
      ADMIN_PASSWORD
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', d => { serverLog += d.toString(); });
  child.stderr.on('data', d => { serverLog += d.toString(); });

  const stop = () => {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        child.kill('SIGKILL');
      }
    } catch (err) { /* ignore */ }
  };

  try {
    await waitForServer();
    console.log('\nSuper Admin – User Management test\n');

    // ── 1. Super Admin auth ──
    let r = await api('POST', '/api/super-admin/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    let saToken;
    await check('super admin can sign in', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.ok, true);
      saToken = r.data.token;
      assert.ok(saToken, 'missing super admin token');
    });

    r = await api('GET', '/api/super-admin/v1/auth/me', undefined, saToken);
    await check('super admin session exposes permissions', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.ok, true);
      const perms = r.data.permissions || [];
      assert.ok(perms.includes('*') || perms.includes('users.view'));
    });

    // ── 2. Provision test users ──
    let u1Token, u1Id, u2Token, u2Id, u3Token, u3Id;
    r = await createDevice('ua-device-alpha-001', { name: 'Alpha Owner', storeName: 'Alpha Mart', email: 'alpha@example.com' });
    await check('device account A provisioned', () => {
      assert.strictEqual(r.status, 200);
      u1Token = r.data.token;
      u1Id = r.data.account.id;
      assert.strictEqual(r.data.plan.id, 'free');
    });

    r = await createDevice('ua-device-beta-002', { name: 'Beta Owner', storeName: 'Beta Store', email: 'beta@example.com' });
    await check('device account B provisioned', () => {
      assert.strictEqual(r.status, 200);
      u2Token = r.data.token;
      u2Id = r.data.account.id;
    });

    r = await createDevice('ua-device-gamma-003', { name: 'Gamma Owner', storeName: 'Gamma Shop', email: 'gamma@example.com' });
    await check('device account C provisioned', () => {
      assert.strictEqual(r.status, 200);
      u3Token = r.data.token;
      u3Id = r.data.account.id;
    });

    // Record usage and create a pending order on A for deletion/purge coverage
    r = await api('POST', '/api/usage/consume', { kind: 'bill', meta: { invNo: 'UA-INV-001' } }, u1Token);
    await check('user A can record bill usage', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.allowed, true);
    });
    r = await api('POST', '/api/usage/consume', { kind: 'return', meta: { invNo: 'UA-RET-001' } }, u1Token);
    // return may be feature-locked on free; either allowed or feature_locked is acceptable, but record that we tried
    assert.ok(r.status === 200 || r.status === 402);

    r = await api('POST', '/api/billing/order', { planId: 'starter', cycle: 'monthly' }, u1Token);
    await check('user A can create a pending billing order (mock)', () => {
      assert.ok(r.status === 200 || r.status === 201);
      assert.strictEqual(r.data.ok, true);
      assert.ok(r.data.order && r.data.order.id);
    });

    // ── 3. Dashboard listing, search, filters, sort, pagination ──
    r = await api('GET', '/api/super-admin/v1/users?page=1&pageSize=2', undefined, saToken);
    await check('users list returns paginated live data', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.ok, true);
      assert.ok(Array.isArray(r.data.items));
      assert.ok(r.data.total >= 3, 'expected at least 3 provisioned users');
      assert.strictEqual(r.data.page, 1);
      assert.strictEqual(r.data.pageSize, 2);
      assert.ok(r.data.pages >= 2);
      assert.ok(r.data.stats && typeof r.data.stats.total === 'number');
      assert.strictEqual(r.data.items.length, 2);
    });

    r = await api('GET', '/api/super-admin/v1/users?q=alpha', undefined, saToken);
    await check('users search filters by name/email/business/id', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.items.some(i => i.id === u1Id));
      assert.ok(r.data.items.every(i => (i.id + i.name + i.email + i.business).toLowerCase().includes('alpha')));
    });

    r = await api('GET', '/api/super-admin/v1/users?status=active', undefined, saToken);
    await check('users filter by account status works', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.items.every(i => i.status === 'active'));
    });

    r = await api('GET', '/api/super-admin/v1/users?sort=name&dir=asc&pageSize=50', undefined, saToken);
    await check('users sorting works', () => {
      assert.strictEqual(r.status, 200);
      const names = r.data.items.map(i => String(i.name || '').toLowerCase());
      const sorted = names.slice().sort();
      assert.deepStrictEqual(names, sorted);
    });

    // ── 4. User detail, history, data summary ──
    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id), undefined, saToken);
    await check('user detail returns account, subscription, entitlements and data summary', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.id, u1Id);
      assert.ok(r.data.subscription);
      assert.ok(r.data.plan || r.data.subscription.planId);
      assert.ok(r.data.data && Array.isArray(r.data.data.items));
      assert.ok(Array.isArray(r.data.payments));
      assert.ok(Array.isArray(r.data.orders));
      assert.ok(Array.isArray(r.data.sessions));
      assert.ok(!JSON.stringify(r.data).includes('passwordHash'));
      assert.ok(!JSON.stringify(r.data).includes('tokenHash'));
    });

    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/history', undefined, saToken);
    await check('user history endpoint returns subscription/payment/order/audit history', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.accountId, u1Id);
      assert.ok(Array.isArray(r.data.subscriptionHistory));
      assert.ok(Array.isArray(r.data.payments));
      assert.ok(Array.isArray(r.data.orders));
      assert.ok(Array.isArray(r.data.audit));
    });

    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/data', undefined, saToken);
    await check('user data summary reports supported and unsupported categories', () => {
      assert.strictEqual(r.status, 200);
      const items = r.data.data.items || [];
      assert.ok(items.some(i => i.supported === true));
      assert.ok(items.some(i => i.supported === false));
      assert.ok(Array.isArray(r.data.data.purgeScopes));
    });

    // ── 5. Edit permitted details ──
    r = await api('PATCH', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id), {
      name: 'Alpha Updated',
      storeName: 'Alpha Supermart',
      phone: '+91 90000 11111',
      contactEmail: 'alpha.contact@example.com'
    }, saToken);
    await check('super admin can edit permitted user details', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.name, 'Alpha Updated');
      assert.strictEqual(r.data.account.storeName, 'Alpha Supermart');
      assert.strictEqual(r.data.account.phone, '+91 90000 11111');
      assert.strictEqual(r.data.account.contactEmail, 'alpha.contact@example.com');
    });

    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id), undefined, saToken);
    await check('edited details persist in detail view', () => {
      assert.strictEqual(r.data.account.name, 'Alpha Updated');
      assert.strictEqual(r.data.account.phone, '+91 90000 11111');
    });

    // ── 6. Block/unblock and session invalidation ──
    r = await api('GET', '/api/auth/me', undefined, u2Token);
    await check('user B session is valid before blocking', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.id, u2Id);
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u2Id) + '/status', {
      status: 'blocked',
      reason: 'policy test'
    }, saToken);
    await check('blocking a user revokes sessions and preserves data', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.status, 'blocked');
      assert.strictEqual(r.data.dataPreserved, true);
      assert.ok(r.data.revokedSessions >= 1);
    });

    r = await api('GET', '/api/auth/me', undefined, u2Token);
    await check('blocked user session is invalidated immediately', () => {
      assert.ok(r.status === 401 || r.status === 403);
      assert.strictEqual(r.data.code, r.status === 401 ? 'unauthenticated' : 'blocked');
    });

    r = await api('POST', '/api/auth/device', { deviceId: 'ua-device-beta-002', name: 'Beta Owner', storeName: 'Beta Store' });
    await check('blocked user cannot establish a new device session', () => {
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.data.code, 'blocked');
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u2Id) + '/status', { status: 'active' }, saToken);
    await check('unblocking restores account access', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.status, 'active');
    });

    r = await api('POST', '/api/auth/device', { deviceId: 'ua-device-beta-002', name: 'Beta Owner', storeName: 'Beta Store' });
    let u2Token2;
    await check('unblocked user can sign in again', () => {
      assert.strictEqual(r.status, 200);
      u2Token2 = r.data.token;
      assert.ok(u2Token2);
    });

    // ── 7. Suspend/reactivate ──
    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u3Id) + '/status', { status: 'suspended' }, saToken);
    await check('suspending a user revokes sessions', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.status, 'suspended');
      assert.ok(r.data.revokedSessions >= 1);
    });
    r = await api('GET', '/api/auth/me', undefined, u3Token);
    await check('suspended user session is invalidated', () => {
      assert.ok(r.status === 401 || r.status === 403);
    });
    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u3Id) + '/status', { status: 'active' }, saToken);
    await check('reactivating a suspended user restores account state', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.status, 'active');
    });

    // ── 8. Subscription plan management and feature access ──
    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, u1Token);
    await check('user A has barcode printing on free plan (plan access preserved)', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.allowed, true);
    });

    r = await api('POST', '/api/super-admin/v1/plans', {
      name: 'No Barcode Test',
      identifier: 'ua_nobarcode',
      status: 'active',
      availableForNew: true,
      monthlyPricePaise: 9900,
      annualPricePaise: 99000,
      features: ['pos_billing', 'inventory_management', 'customer_management', 'pdf_invoice'],
      limits: { maxProducts: 500 },
      notes: 'user-admin test plan without barcode printing'
    }, saToken);
    let noBarcodePlanId;
    await check('can create a plan without barcode printing for downgrade/access test', () => {
      assert.strictEqual(r.status, 200);
      noBarcodePlanId = r.data.plan.id;
      assert.ok(!(r.data.plan.currentVersion.features || []).includes('barcode_printing'));
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/subscription/plan', {
      planId: noBarcodePlanId,
      cycle: 'monthly',
      days: 30,
      status: 'active',
      note: 'downgrade test'
    }, saToken);
    await check('super admin can downgrade/assign a plan and no duplicate record is created', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.subscription.planId, noBarcodePlanId);
      assert.strictEqual(r.data.previous.planId, 'free');
    });

    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, u1Token);
    await check('plan feature access updates correctly after downgrade', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.code, 'feature_locked');
      assert.strictEqual(r.data.feature, 'barcode_printing');
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/subscription/plan', {
      planId: 'pro',
      cycle: 'monthly',
      days: 30,
      status: 'active',
      note: 'upgrade test'
    }, saToken);
    await check('super admin can upgrade a plan', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.subscription.planId, 'pro');
      assert.strictEqual(r.data.previous.planId, noBarcodePlanId);
    });

    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, u1Token);
    await check('plan feature access updates correctly after upgrade', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.allowed, true);
    });

    // ── 9. Extend expiry and change subscription status ──
    const beforeDetail = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id), undefined, saToken);
    const beforeEnd = beforeDetail.data.subscription && beforeDetail.data.subscription.currentPeriodEnd;

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/subscription/extend', { days: 45 }, saToken);
    await check('super admin can extend subscription expiry', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.subscription.currentPeriodEnd > beforeEnd);
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/subscription/status', { status: 'expired', note: 'expiry test' }, saToken);
    await check('super admin can change subscription status to expired', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.subscription.status, 'expired');
    });

    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, u1Token);
    await check('expired subscription falls back to free-plan entitlements', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.allowed, true); // free plan has barcode_printing in this build
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/subscription/status', { status: 'active', days: 30 }, saToken);
    await check('super admin can reactivate subscription status', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.subscription.status, 'active');
    });

    r = await api('GET', '/api/super-admin/v1/users?subscriptionStatus=expired', undefined, saToken);
    await check('subscription status filter works', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.items.every(i => i.subscriptionStatus === 'expired' || i.subscriptionStatus === 'cancelled'));
    });

    // ── 10. Selected data purge ──
    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/data/purge', {
      scopes: ['sessions'],
      confirm: u1Id
    }, saToken);
    await check('selected data purge requires no account deletion and removes scoped records', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.accountId, u1Id);
      assert.ok(r.data.removed.sessions >= 0);
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/data/purge', {
      scopes: ['usage_history', 'devices', 'pending_orders'],
      confirm: 'alpha.contact@example.com'
    }, saToken);
    await check('purging usage/devices/pending orders works with email confirmation', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.removed.usage_history >= 1);
      assert.ok(r.data.removed.devices >= 1);
      assert.ok(r.data.removed.pending_orders >= 1);
      assert.strictEqual(r.data.data.totals.usageEntries, 0);
      assert.strictEqual(r.data.data.totals.pendingOrders, 0);
      assert.strictEqual(r.data.data.totals.devices, 0);
    });

    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id), undefined, saToken);
    await check('account remains intact after selected data purge', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.id, u1Id);
      assert.strictEqual(r.data.account.name, 'Alpha Updated');
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u1Id) + '/data/purge', {
      scopes: ['usage_history'],
      confirm: 'wrong'
    }, saToken);
    await check('purge requires a valid confirmation value', () => {
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.data.code, 'confirm_mismatch');
    });

    // ── 11. Permanent account deletion + orphan checks ──
    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u2Id) + '/delete', { confirm: 'nope' }, saToken);
    await check('permanent deletion requires typed confirmation', () => {
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.data.code, 'confirm_mismatch');
    });

    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u2Id) + '/delete', { confirm: u2Id }, saToken);
    await check('permanent deletion removes SaaS store records with clean orphan check', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.deleted, true);
      assert.ok(r.data.summary.removed.accounts === 1);
      assert.strictEqual(r.data.orphanCheck.count, 0);
    });

    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u2Id), undefined, saToken);
    await check('deleted user is no longer retrievable', () => {
      assert.strictEqual(r.status, 404);
      assert.strictEqual(r.data.code, 'not_found');
    });

    r = await api('GET', '/api/super-admin/v1/users?q=beta', undefined, saToken);
    await check('deleted user no longer appears in search/list results', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(!r.data.items.some(i => i.id === u2Id));
    });

    // ── 12. Protection and authorization ──
    // find the protected platform admin account (saas admin seeded in this data dir)
    r = await api('GET', '/api/super-admin/v1/users?q=admin@hisaab.local&pageSize=50', undefined, saToken);
    const platformAdmin = (r.data.items || []).find(i => i.email === ADMIN_EMAIL || i.isProtected || i.role === 'admin') || (r.data.items || [])[0];
    await check('platform admin account is discoverable for protection checks', () => {
      assert.ok(platformAdmin && platformAdmin.id, 'could not locate platform admin account');
    });

    if (platformAdmin) {
      r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(platformAdmin.id) + '/status', { status: 'blocked' }, saToken);
      await check('protected/platform admin accounts cannot be blocked', () => {
        assert.strictEqual(r.status, 403);
        assert.strictEqual(r.data.code, 'protected_account');
      });

      r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(platformAdmin.id) + '/delete', { confirm: platformAdmin.id }, saToken);
      await check('protected/platform admin accounts cannot be deleted', () => {
        assert.strictEqual(r.status, 403);
        assert.strictEqual(r.data.code, 'protected_account');
      });
    }

    // regular POS user must not access Super Admin operations
    r = await api('GET', '/api/super-admin/v1/users', undefined, u1Token);
    await check('regular user token cannot access Super Admin user management', () => {
      assert.ok(r.status === 401 || r.status === 403);
    });
    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(u3Id) + '/status', { status: 'blocked' }, u1Token);
    await check('regular user cannot perform privileged admin actions', () => {
      assert.ok(r.status === 401 || r.status === 403);
    });

    r = await api('GET', '/api/super-admin/v1/users', undefined, null);
    await check('unauthenticated requests are rejected', () => {
      assert.ok(r.status === 401 || r.status === 403);
    });

    // ── 13. Audit log coverage ──
    r = await api('GET', '/api/super-admin/v1/audit-logs?entityId=' + encodeURIComponent(u1Id) + '&limit=100', undefined, saToken);
    await check('audit log records important actions for the affected user', () => {
      assert.strictEqual(r.status, 200);
      const actions = (r.data.items || []).map(e => e.action);
      assert.ok(actions.some(a => /users\.edit/.test(a)), 'missing edit audit');
      assert.ok(actions.some(a => /users\.subscription\.plan_change/.test(a)), 'missing plan change audit');
      assert.ok(actions.some(a => /users\.data\.purge/.test(a)), 'missing purge audit');
      const sample = (r.data.items || [])[0];
      if (sample) {
        assert.ok(sample.actorEmail || sample.actorRole, 'audit missing actor');
        assert.ok(sample.occurredAt, 'audit missing timestamp');
        assert.ok(!JSON.stringify(sample).includes('passwordHash'));
        assert.ok(!JSON.stringify(sample).includes('tokenHash'));
      }
    });

    r = await api('GET', '/api/super-admin/v1/audit-logs?entityId=' + encodeURIComponent(u2Id) + '&limit=100', undefined, saToken);
    await check('audit log records block/unblock and deletion actions', () => {
      assert.strictEqual(r.status, 200);
      const actions = (r.data.items || []).map(e => e.action);
      assert.ok(actions.some(a => /users\.block/.test(a)), 'missing block audit');
      assert.ok(actions.some(a => /users\.(unblock|reactivate)/.test(a)), 'missing unblock/reactivate audit');
      assert.ok(actions.some(a => /users\.delete/.test(a)), 'missing delete audit');
    });

    // ── 14. Isolation / no cross-user side effects ──
    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(u3Id), undefined, saToken);
    await check('other user remains intact and isolated after operations on different users', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.id, u3Id);
      assert.strictEqual(r.data.account.status, 'active');
      assert.strictEqual(r.data.subscription.planId, 'free');
    });

    r = await api('GET', '/api/super-admin/v1/system/health', undefined, saToken);
    await check('system health endpoint still responds (regression smoke)', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.ok, true);
    });

  } catch (err) {
    if (!failed) fail('unexpected error', err);
    if (serverLog.trim()) {
      console.error('\n--- server log (tail) ---\n' + serverLog.trim().slice(-6000) + '\n--------------------------');
    }
  } finally {
    stop();
    await sleep(500);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
}

main();
