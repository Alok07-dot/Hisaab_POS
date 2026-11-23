/* ══════════════════════════════════════════════════════════════
   HISAAB POS – SaaS API integration test
   Run: node test/saas.test.js
   Spawns its own server on port 3199 with a throw-away data dir.
   ══════════════════════════════════════════════════════════════ */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = Number(process.env.TEST_PORT || 3199);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(os.tmpdir(), 'hisaab-saas-test-' + Date.now());
const ADMIN_EMAIL = 'admin@hisaab.local';
const ADMIN_PASSWORD = 'Admin@12345';

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log('  ✓ ' + name);
}

function fail(name, err) {
  failed++;
  console.error('  ✗ ' + name);
  console.error('    ' + (err && err.message ? err.message : err));
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
  return { status: res.status, data };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch (err) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Server did not start in time');
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HTTPS_PORT: String(PORT + 1000),
      HISAAB_DATA_DIR: DATA_DIR,
      ADMIN_EMAIL,
      ADMIN_PASSWORD
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let serverLog = '';
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
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  };

  try {
    await waitForServer();
    console.log('\nSaaS API integration test\n');

    /* ── plans ── */
    let r = await api('GET', '/api/saas/plans');
    await check('plans endpoint returns free/starter/pro', () => {
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.data.plans.map(p => p.id), ['free', 'starter', 'pro']);
      assert.strictEqual(r.data.payment.provider, 'mock');
    });

    /* ── device account ── */
    const deviceId = 'test-device-0001';
    r = await api('POST', '/api/auth/device', {
      deviceId,
      name: 'Test Owner',
      storeName: 'Test Kirana',
      email: 'owner@example.com'
    });
    let token;
    await check('device auth provisions a free account', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.token, 'token missing');
      assert.strictEqual(r.data.plan.id, 'free');
      assert.strictEqual(r.data.usage.bills.limit, 50);
      assert.strictEqual(r.data.account.role, 'owner');
      token = r.data.token;
    });
    const accountId = r.data.account.id;

    /* ── usage: free quota ── */
    let lastConsume = null;
    for (let i = 0; i < 50; i++) {
      lastConsume = await api('POST', '/api/usage/consume', {
        kind: 'bill',
        meta: { invNo: 'INV-' + (i + 1), total: 100 }
      }, token);
    }
    await check('50 bills accepted on the free plan', () => {
      assert.strictEqual(lastConsume.status, 200);
      assert.strictEqual(lastConsume.data.allowed, true);
      assert.strictEqual(lastConsume.data.usage.bills.used, 50);
      assert.strictEqual(lastConsume.data.usage.bills.remaining, 0);
    });

    r = await api('POST', '/api/usage/consume', { kind: 'bill' }, token);
    await check('51st bill is rejected with plan_limit', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.code, 'plan_limit');
      assert.strictEqual(r.data.allowed, false);
      assert.strictEqual(r.data.plan.id, 'free');
    });

    r = await api('POST', '/api/usage/products', { count: 101 }, token);
    await check('product limit is enforced server-side', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.code, 'plan_limit');
    });

    r = await api('POST', '/api/usage/products', { count: 40 }, token);
    await check('product count under the limit is accepted', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.usage.products.used, 40);
    });

    /* ── billing: order + signature ── */
    r = await api('POST', '/api/billing/order', { planId: 'free', cycle: 'monthly' }, token);
    await check('free plan cannot create a paid order', () => {
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.data.code, 'free_plan');
    });

    r = await api('POST', '/api/billing/order', { planId: 'starter', cycle: 'monthly' }, token);
    let order;
    await check('paid order is created with the server-side amount', () => {
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.data.order.amount, 29900);
      assert.ok(r.data.order.providerOrderId.startsWith('mock_'));
      order = r.data.order;
    });

    r = await api('POST', '/api/billing/verify', {
      orderId: order.id,
      paymentId: 'mockpay_fake',
      signature: 'deadbeef'
    }, token);
    await check('invalid payment signature is rejected', () => {
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.data.code, 'invalid_signature');
    });

    r = await api('POST', '/api/billing/mock/pay', { orderId: order.id }, token);
    let paid;
    await check('mock gateway produces a payment id and signature', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.paymentId);
      assert.ok(r.data.signature);
      paid = r.data;
    });

    r = await api('POST', '/api/billing/verify', {
      orderId: order.id,
      paymentId: paid.paymentId,
      signature: paid.signature
    }, token);
    await check('verified payment activates Starter instantly', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.plan.id, 'starter');
      assert.strictEqual(r.data.subscription.status, 'active');
      assert.strictEqual(r.data.subscription.cycle, 'monthly');
      assert.ok(r.data.subscription.daysLeft >= 29);
      assert.strictEqual(r.data.usage.bills.limit, 1000);
      assert.ok(r.data.features.includes('returns'));
    });
    const periodEnd = r.data.subscription.currentPeriodEnd;

    r = await api('POST', '/api/billing/verify', {
      orderId: order.id,
      paymentId: paid.paymentId,
      signature: paid.signature
    }, token);
    await check('replayed verification is idempotent', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.alreadyProcessed, true);
      assert.strictEqual(r.data.subscription.currentPeriodEnd, periodEnd);
    });

    r = await api('GET', '/api/billing/payments', undefined, token);
    await check('payment history records the captured payment', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.payments.length, 1);
      assert.strictEqual(r.data.payments[0].amount, 29900);
    });

    r = await api('POST', '/api/billing/cancel', undefined, token);
    await check('cancel schedules downgrade at period end', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.subscription.cancelAtPeriodEnd, true);
      assert.strictEqual(r.data.plan.id, 'starter');
    });
    r = await api('POST', '/api/billing/resume', undefined, token);
    await check('resume clears the scheduled cancel', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.subscription.cancelAtPeriodEnd, false);
    });

    r = await api('GET', '/api/usage/ledger?limit=100', undefined, token);
    await check('usage ledger contains bills and the payment', () => {
      assert.strictEqual(r.status, 200);
      const kinds = r.data.entries.map(e => e.kind);
      assert.ok(kinds.filter(k => k === 'bill').length >= 50);
      assert.ok(kinds.includes('payment'));
    });

    /* ── yearly pricing ── */
    r = await api('POST', '/api/billing/order', { planId: 'pro', cycle: 'yearly' }, token);
    await check('yearly Pro order uses yearly price', () => {
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.data.order.amount, 699900);
    });

    /* ── account claim + login ── */
    r = await api('POST', '/api/auth/claim', {
      email: 'claim-me@example.com',
      password: 'Password123'
    }, token);
    await check('device account can be claimed with email + password', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.email, 'claim-me@example.com');
      assert.strictEqual(r.data.account.hasPassword, true);
    });

    r = await api('POST', '/api/auth/login', {
      email: 'claim-me@example.com',
      password: 'Password123',
      deviceId: 'second-device-0002'
    });
    await check('claimed account can sign in from another device', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.token);
      assert.strictEqual(r.data.account.email, 'claim-me@example.com');
      assert.strictEqual(r.data.plan.id, 'starter');
    });
    const loginToken = r.data.token;

    r = await api('POST', '/api/auth/logout', undefined, loginToken);
    await check('logout revokes the session', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.ok, true);
    });
    r = await api('GET', '/api/auth/me', undefined, loginToken);
    await check('revoked session is rejected', () => {
      assert.strictEqual(r.status, 401);
    });

    /* ── signup (independent account) ── */
    r = await api('POST', '/api/auth/signup', {
      email: 'new-shop@example.com',
      password: 'Password123',
      name: 'New Shop',
      storeName: 'New Store',
      deviceId: 'new-device-0003'
    });
    await check('email signup creates a free account', () => {
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.data.plan.id, 'free');
      assert.strictEqual(r.data.account.email, 'new-shop@example.com');
    });
    const newToken = r.data.token;
    r = await api('POST', '/api/auth/signup', {
      email: 'new-shop@example.com',
      password: 'Password123'
    });
    await check('duplicate email signup is rejected', () => {
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.data.code, 'email_taken');
    });
    r = await api('GET', '/api/admin/stats', undefined, newToken);
    await check('non-admin cannot open the admin dashboard', () => {
      assert.strictEqual(r.status, 403);
    });

    /* ── admin ── */
    r = await api('POST', '/api/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    let adminToken;
    await check('seeded admin can sign in', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.role, 'admin');
      assert.strictEqual(r.data.plan.id, 'pro');
      adminToken = r.data.token;
    });

    r = await api('GET', '/api/admin/stats', undefined, adminToken);
    await check('admin stats report accounts, revenue and bills', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.stats.accounts >= 3);
      assert.strictEqual(r.data.stats.revenueTotal, 29900);
      assert.strictEqual(r.data.stats.billsThisMonth, 50);
      assert.ok(r.data.stats.mrr > 0);
    });

    r = await api('GET', '/api/admin/accounts?q=claim-me', undefined, adminToken);
    await check('admin can search accounts', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.accounts.length, 1);
      assert.strictEqual(r.data.accounts[0].id, accountId);
    });

    r = await api('POST', '/api/admin/accounts/' + accountId + '/plan', {
      planId: 'pro',
      days: 45,
      note: 'integration test grant'
    }, adminToken);
    await check('admin can grant a plan with an expiry window', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.plan.id, 'pro');
    });

    r = await api('GET', '/api/billing/subscription', undefined, token);
    await check('granted plan is visible to the shop account', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.plan.id, 'pro');
      assert.ok(r.data.subscription.daysLeft >= 44);
      assert.strictEqual(r.data.usage.bills.limit, null);
    });

    r = await api('GET', '/api/admin/usage?limit=10', undefined, adminToken);
    await check('admin usage ledger includes admin grants', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.entries.some(e => e.kind === 'admin_grant'));
    });

    r = await api('GET', '/api/admin/payments', undefined, adminToken);
    await check('admin payments list includes the account email', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.payments[0].email);
    });

    r = await api('POST', '/api/admin/accounts/' + accountId + '/status', {
      status: 'suspended'
    }, adminToken);
    await check('admin can suspend an account', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.status, 'suspended');
    });
    r = await api('GET', '/api/billing/subscription', undefined, token);
    await check('suspended account loses API access', () => {
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.data.code, 'suspended');
    });
    await api('POST', '/api/admin/accounts/' + accountId + '/status', { status: 'active' }, adminToken);

    /* ── webhook security ── */
    r = await api('POST', '/api/billing/webhook', { event: 'payment.captured' });
    await check('unsigned webhook is rejected', () => {
      assert.strictEqual(r.status, 400);
    });

    /* ── persistence ── */
    r = await api('GET', '/api/saas/health');
    await check('health reports stored records', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.storage.accounts >= 3);
      assert.ok(r.data.storage.payments >= 1);
    });

  } catch (err) {
    if (!failed) fail('unexpected error', err);
    if (serverLog.trim()) {
      console.error('\n--- server log ---\n' + serverLog.trim().slice(-4000) + '\n------------------');
    }
  } finally {
    stop();
    await sleep(400);
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
}

main();
