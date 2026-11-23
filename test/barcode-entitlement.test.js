/* ══════════════════════════════════════════════════════════════
   HISAAB POS – Barcode Printing plan entitlement test
   Run: node test/barcode-entitlement.test.js
   Spawns its own server on port 3200 with a throw-away data dir, so real
   plans and subscriptions are never touched.
   ══════════════════════════════════════════════════════════════ */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = Number(process.env.TEST_PORT || 3200);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(os.tmpdir(), 'hisaab-barcode-test-' + Date.now());
const ADMIN_EMAIL = 'admin@hisaab.local';
const ADMIN_PASSWORD = 'Admin@12345';

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log('  ✓ ' + name); }
function fail(name, err) {
  failed++;
  console.error('  ✗ ' + name);
  console.error('    ' + (err && err.message ? err.message : err));
}
async function check(name, fn) {
  try { await fn(); ok(name); } catch (err) { fail(name, err); throw err; }
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForServer() {
  const deadline = Date.now() + 20000;
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
    console.log('\nBarcode printing entitlement test\n');

    /* ── 1. Plan catalogue exposes the feature, existing config intact ── */
    let r = await api('GET', '/api/saas/plans');
    await check('barcode printing is part of the plan catalogue', () => {
      assert.strictEqual(r.status, 200);
      const free = r.data.plans.find(p => p.id === 'free');
      const pro = r.data.plans.find(p => p.id === 'pro');
      assert.ok(free.features.includes('barcode_printing'), 'free missing feature');
      assert.ok(pro.features.includes('barcode_printing'), 'pro missing feature');
      // existing free plan configuration must be unchanged
      ['billing', 'inventory', 'receipts', 'sales_history', 'customers', 'whatsapp_share', 'expiry_alerts']
        .forEach(k => assert.ok(free.features.includes(k), 'free lost feature: ' + k));
      assert.strictEqual(free.limits.products, 20);
      assert.strictEqual(free.limits.billsPerMonth, 200);
      // existing pro configuration must be unchanged
      ['returns', 'stock_timeline', 'damage_tracking', 'csv_export', 'report_export', 'remove_pdf_watermark']
        .forEach(k => assert.ok(pro.features.includes(k), 'pro lost feature: ' + k));
      assert.strictEqual(pro.price.monthly, 19900);
      assert.strictEqual(pro.price.yearly, 199000);
    });

    /* ── 2. Super Admin toggle exists ── */
    r = await api('POST', '/api/super-admin/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    let saToken;
    await check('super admin can sign in', () => {
      assert.strictEqual(r.status, 200);
      saToken = r.data.token;
    });

    r = await api('GET', '/api/super-admin/v1/plans/features', undefined, saToken);
    await check('feature registry lists "Barcode Printing" as implemented', () => {
      assert.strictEqual(r.status, 200);
      const f = (r.data.features || []).find(x => x.key === 'barcode_printing');
      assert.ok(f, 'barcode_printing missing from registry');
      assert.strictEqual(f.name, 'Barcode Printing');
      assert.strictEqual(f.implemented, true);
    });

    r = await api('GET', '/api/super-admin/v1/plans', undefined, saToken);
    await check('plan editor data exposes the toggle per plan', () => {
      assert.strictEqual(r.status, 200);
      const pro = (r.data.plans || []).find(p => p.id === 'pro');
      assert.ok(pro.currentVersion.features.includes('barcode_printing'));
    });

    /* ── 3. Enabled plan → server allows printing ── */
    r = await api('POST', '/api/auth/device', {
      deviceId: 'barcode-device-0001',
      name: 'Barcode Owner',
      storeName: 'Barcode Store',
      email: 'barcode@example.com'
    });
    let token;
    let accountId;
    await check('device account provisioned on the free plan', () => {
      assert.strictEqual(r.status, 200);
      token = r.data.token;
      accountId = r.data.account.id;
      assert.strictEqual(r.data.plan.id, 'free');
    });

    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, token);
    await check('scenario 1: plan with Barcode Printing allows printing', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.allowed, true);
    });

    /* ── 4. Unauthenticated request ── */
    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' });
    await check('unauthenticated barcode print request is rejected', () => {
      assert.strictEqual(r.status, 401);
      assert.strictEqual(r.data.code, 'unauthenticated');
    });

    /* ── 5. Plan without the feature → denied ── */
    r = await api('POST', '/api/super-admin/v1/plans', {
      name: 'Basic (no barcode)',
      identifier: 'basic_nobarcode',
      status: 'active',
      availableForNew: true,
      monthlyPricePaise: 9900,
      annualPricePaise: 99000,
      features: ['pos_billing', 'inventory_management', 'customer_management', 'pdf_invoice'],
      limits: { maxProducts: 500 },
      notes: 'barcode entitlement test plan'
    }, saToken);
    let basicPlanId;
    await check('super admin creates a plan without Barcode Printing', () => {
      assert.strictEqual(r.status, 200);
      basicPlanId = r.data.plan.id;
      assert.ok(!(r.data.plan.currentVersion.features || []).includes('barcode_printing'));
    });

    r = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    let adminToken;
    await check('saas admin can sign in', () => {
      assert.strictEqual(r.status, 200);
      adminToken = r.data.token;
    });

    r = await api('POST', '/api/admin/accounts/' + accountId + '/plan', {
      planId: basicPlanId, days: 30, note: 'barcode entitlement test'
    }, adminToken);
    await check('subscriber moved to the plan without the feature', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.plan.id, basicPlanId);
    });

    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, token);
    await check('scenario 2: plan without Barcode Printing blocks printing', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.allowed, false);
      assert.strictEqual(r.data.code, 'feature_locked');
      assert.strictEqual(r.data.feature, 'barcode_printing');
      assert.ok(Array.isArray(r.data.plans) && r.data.plans.length >= 2, 'upgrade plans missing');
    });

    /* ── 6. Upgrade → allowed ── */
    r = await api('POST', '/api/admin/accounts/' + accountId + '/plan', {
      planId: 'pro', days: 30, note: 'upgrade test'
    }, adminToken);
    await check('subscriber upgraded to Pro', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.plan.id, 'pro');
    });
    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, token);
    await check('scenario 3: upgrade to a plan with access enables printing', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.allowed, true);
    });

    /* ── 7. Super Admin disables the feature on Pro → denied ── */
    r = await api('GET', '/api/billing/subscription', undefined, token);
    const subBefore = r.data.subscription;
    assert.ok(subBefore && subBefore.currentPeriodEnd);

    r = await api('GET', '/api/super-admin/v1/plans/pro', undefined, saToken);
    const proFeatures = r.data.plan.currentVersion.features.slice();
    assert.ok(proFeatures.includes('barcode_printing'));

    r = await api('PUT', '/api/super-admin/v1/plans/pro', {
      features: proFeatures.filter(f => f !== 'barcode_printing'),
      changeSummary: 'test: disable barcode printing'
    }, saToken);
    await check('super admin disables Barcode Printing for Pro', () => {
      assert.strictEqual(r.status, 200);
      const feats = r.data.plan.currentVersion.features || [];
      assert.ok(!feats.includes('barcode_printing'));
      assert.ok(feats.includes('returns'), 'unrelated feature was dropped');
      assert.ok(feats.includes('csv_export'), 'unrelated feature was dropped');
    });

    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, token);
    await check('scenario 4: disabling the feature restricts the subscriber', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.code, 'feature_locked');
      assert.strictEqual(r.data.feature, 'barcode_printing');
    });

    r = await api('GET', '/api/billing/subscription', undefined, token);
    await check('plan changes never rewrite the existing subscription', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.subscription.currentPeriodEnd, subBefore.currentPeriodEnd);
      assert.strictEqual(r.data.subscription.planId, subBefore.planId);
      assert.strictEqual(r.data.subscription.status, 'active');
    });

    r = await api('PUT', '/api/super-admin/v1/plans/pro', {
      features: proFeatures,
      changeSummary: 'test: restore barcode printing'
    }, saToken);
    await check('super admin re-enables Barcode Printing', () => {
      assert.strictEqual(r.status, 200);
      assert.ok((r.data.plan.currentVersion.features || []).includes('barcode_printing'));
    });
    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print' }, token);
    await check('printing is available again after re-enabling', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.allowed, true);
    });

    /* ── 8. Direct API manipulation cannot bypass the plan ── */
    r = await api('POST', '/api/usage/consume', { kind: 'barcode_print', planId: 'pro', features: ['barcode_printing'] }, token);
    await check('client-supplied plan/feature fields are ignored', () => {
      assert.strictEqual(r.status, 200); // pro currently has the feature
      assert.strictEqual(r.data.allowed, true);
    });
    // With the subscriber actually on the no-barcode plan, extra client fields
    // must not help either.
    r = await api('POST', '/api/admin/accounts/' + accountId + '/plan', { planId: basicPlanId, days: 30 }, adminToken);
    assert.strictEqual(r.status, 200);
    r = await api('POST', '/api/usage/consume', {
      kind: 'barcode_print',
      planId: 'pro',
      features: ['barcode_printing'],
      plan: { id: 'pro', features: ['barcode_printing'] }
    }, token);
    await check('spoofed payload cannot bypass a disabled plan', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.feature, 'barcode_printing');
    });

    /* ── 9. Other subscription features unaffected ── */
    r = await api('POST', '/api/usage/consume', { kind: 'return' }, token);
    await check('unrelated feature gating still works (returns on a basic plan)', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.feature, 'returns');
    });

    r = await api('POST', '/api/admin/accounts/' + accountId + '/plan', { planId: 'free', days: 30 }, adminToken);
    assert.strictEqual(r.status, 200);
    r = await api('POST', '/api/usage/products', { count: 21 }, token);
    await check('product limit enforcement still works', () => {
      assert.strictEqual(r.status, 402);
      assert.strictEqual(r.data.code, 'plan_limit');
    });
    r = await api('POST', '/api/usage/consume', { kind: 'bill', meta: { invNo: 'BAR-TEST-1' } }, token);
    await check('billing metering still works', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.usage.bills.used >= 1);
    });
    r = await api('POST', '/api/usage/consume', { kind: 'not_a_real_kind' }, token);
    await check('unknown usage kinds are still rejected', () => {
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.data.code, 'bad_kind');
    });

    r = await api('GET', '/api/saas/health');
    await check('server health reports stored records', () => {
      assert.strictEqual(r.status, 200);
      assert.ok(r.data.storage.accounts >= 2);
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
