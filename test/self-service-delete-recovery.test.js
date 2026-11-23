/* ══════════════════════════════════════════════════════════════
   HISAAB POS – Self-service account delete & recovery test
   Run: node test/self-service-delete-recovery.test.js
   ══════════════════════════════════════════════════════════════ */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const PORT = Number(process.env.TEST_PORT || 3215);
const HTTPS_PORT = PORT + 1400;
const HOST = '127.0.0.1';
const DATA_DIR = path.join(os.tmpdir(), 'hisaab-self-delete-test-' + Date.now());
const ADMIN_EMAIL = 'admin@hisaab.local';
const ADMIN_PASSWORD = 'Admin@12345';

let passed = 0;
let failed = 0;
let serverLog = '';

function ok(name) { passed++; console.log('  ✓ ' + name); }
function fail(name, err) { failed++; console.error('  ✗ ' + name); console.error('    ' + (err && err.message ? err.message : String(err))); }
async function check(name, fn) { try { await fn(); ok(name); } catch (err) { fail(name, err); throw err; } }

function request(method, endpoint, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: endpoint,
      method,
      headers: Object.assign(
        payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
        token ? { Authorization: 'Bearer ' + token } : {}
      )
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = { raw }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function api(method, endpoint, body, token) {
  try { return await request(method, endpoint, body, token); }
  catch (e) { return { status: 0, data: { error: e.message } }; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await request('GET', '/api/health');
      if (r.status === 200) return;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Server did not start in time');
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(PORT), HTTPS_PORT: String(HTTPS_PORT), HISAAB_DATA_DIR: DATA_DIR,
      ADMIN_EMAIL, ADMIN_PASSWORD
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', d => { serverLog += d.toString(); });
  child.stderr.on('data', d => { serverLog += d.toString(); });
  const stop = () => {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    } catch (e) {}
  };

  try {
    await waitForServer();
    console.log('\nSelf-service delete & recovery test\n');

    // 1) Create email/password user, generate data/state
    let r = await api('POST', '/api/auth/signup', {
      email: 'recoverme@example.com', password: 'Passw0rd!', name: 'Recover Me', storeName: 'Recover Store', deviceId: 'ss-device-0001'
    });
    let token, accountId;
    await check('user can sign up', () => {
      assert.strictEqual(r.status, 201);
      token = r.data.token; accountId = r.data.account.id;
      assert.ok(token && accountId);
    });

    // Give paid subscription/records context via admin grant (valid/existing flow)
    r = await api('POST', '/api/super-admin/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    let saToken = r.data.token;
    assert.ok(saToken);
    r = await api('POST', '/api/super-admin/v1/users/' + encodeURIComponent(accountId) + '/subscription/plan', { planId: 'pro', cycle: 'monthly', days: 30, status: 'active' }, saToken);
    await check('user can be assigned a paid plan before deletion (billing context)', () => { assert.strictEqual(r.status, 200); assert.strictEqual(r.data.subscription.planId, 'pro'); });

    r = await api('POST', '/api/usage/consume', { kind: 'bill', meta: { invNo: 'SS-INV-1' } }, token);
    await check('user can record usage before deletion', () => { assert.strictEqual(r.status, 200); assert.strictEqual(r.data.allowed, true); });

    // 2) Request account deletion (soft-delete), identity confirmation required
    r = await api('POST', '/api/auth/account/delete', { password: 'wrong', confirm: 'DELETE' }, token);
    await check('delete requires correct password identity confirmation', () => { assert.strictEqual(r.status, 401); assert.strictEqual(r.data.code, 'invalid_credentials'); });

    r = await api('POST', '/api/auth/account/delete', { password: 'Passw0rd!', confirm: 'DELETE' }, token);
    await check('user can request account deletion (soft-delete)', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.deleted, true);
      assert.strictEqual(r.data.softDeleted, true);
      assert.ok(r.data.retentionUntil);
    });

    // 3) Deleted user cannot access old account normally
    r = await api('GET', '/api/auth/me', undefined, token);
    await check('deleted session cannot access old account normally', () => { assert.ok(r.status === 401 || r.status === 403); });

    r = await api('POST', '/api/auth/device', { deviceId: 'ss-device-0001' });
    await check('deleted device account cannot be auto-resumed', () => {
      // either no account found for deleted device link or not authorized; must not return an active session for deleted account
      assert.ok(r.status !== 200 || (r.data.account && r.data.account.status !== 'deleted'));
      if (r.status === 200) assert.notStrictEqual(r.data.account && r.data.account.id, accountId);
    });

    // 4) Login again -> recovery screen/options
    r = await api('POST', '/api/auth/login', { email: 'recoverme@example.com', password: 'Passw0rd!' });
    let recoveryToken;
    await check('login after deletion returns recovery options (not normal access)', () => {
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.data.code, 'account_deleted_recovery');
      assert.ok(r.data.recovery && r.data.recovery.recoveryToken);
      assert.ok(r.data.recovery.deletedAt);
      recoveryToken = r.data.recovery.recoveryToken;
    });

    // 5) Recover old account restores correct previous data/state
    r = await api('POST', '/api/auth/account/recover', { email: 'recoverme@example.com', recoveryToken, deviceId: 'ss-device-0001' });
    let recoveredToken;
    await check('recover old account restores account and SaaS data', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.recovered, true);
      assert.strictEqual(r.data.clearLocalData, false);
      assert.strictEqual(r.data.account.id, accountId);
      assert.strictEqual(r.data.account.email, 'recoverme@example.com');
      assert.strictEqual(r.data.subscription.planId, 'pro'); // previous subscription preserved
      assert.ok((r.data.usage && r.data.usage.bills && r.data.usage.bills.used) >= 1); // prior usage preserved in current period
      recoveredToken = r.data.token;
      assert.ok(recoveredToken);
    });

    r = await api('GET', '/api/auth/me', undefined, recoveredToken);
    await check('recovered account can access normally', () => { assert.strictEqual(r.status, 200); assert.strictEqual(r.data.account.id, accountId); });

    // 6) Delete again, then Start Fresh
    r = await api('POST', '/api/auth/account/delete', { password: 'Passw0rd!', confirm: 'DELETE' }, recoveredToken);
    assert.strictEqual(r.status, 200);

    r = await api('POST', '/api/auth/login', { email: 'recoverme@example.com', password: 'Passw0rd!' });
    await check('recovery screen appears again after re-deletion', () => { assert.strictEqual(r.status, 403); assert.strictEqual(r.data.code, 'account_deleted_recovery'); recoveryToken = r.data.recovery.recoveryToken; });

    r = await api('POST', '/api/auth/account/start-fresh', { email: 'recoverme@example.com', recoveryToken, deviceId: 'ss-device-0001' });
    let freshToken, freshId;
    await check('start fresh creates a clean account with same email and signals local data clear', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.freshStart, true);
      assert.strictEqual(r.data.clearLocalData, true);
      assert.strictEqual(r.data.account.email, 'recoverme@example.com');
      assert.notStrictEqual(r.data.account.id, accountId);
      assert.strictEqual(r.data.plan.id, 'free');
      assert.strictEqual(r.data.usage.bills.used, 0);
      freshToken = r.data.token; freshId = r.data.account.id;
    });

    r = await api('GET', '/api/auth/me', undefined, freshToken);
    await check('fresh account works normally', () => { assert.strictEqual(r.status, 200); assert.strictEqual(r.data.account.id, freshId); });

    // 7) Old and new data never mix (SaaS store)
    r = await api('GET', '/api/super-admin/v1/users/' + encodeURIComponent(freshId), undefined, saToken);
    await check('fresh account has clean SaaS history', () => {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.account.id, freshId);
      assert.strictEqual(r.data.subscription.planId, 'free');
      assert.ok((r.data.usageLedger || []).length === 0);
    });

    r = await api('GET', '/api/super-admin/v1/users?q=recoverme@example.com&pageSize=50', undefined, saToken);
    await check('old archived account and fresh account are separated (no duplicate active)', () => {
      assert.strictEqual(r.status, 200);
      const items = r.data.items || [];
      const actives = items.filter(i => (i.email === 'recoverme@example.com') && (i.status === 'active' || !i.status));
      assert.strictEqual(actives.length, 1);
      assert.strictEqual(actives[0].id, freshId);
      // archived/deleted old record may or may not appear depending on filters; ensure no active duplicate
    });

    // 8) Existing auth flows still work
    r = await api('POST', '/api/auth/signup', { email: 'normal@example.com', password: 'Passw0rd!', name: 'Normal', storeName: 'Normal Store' });
    await check('normal signup still works', () => { assert.strictEqual(r.status, 201); assert.ok(r.data.token); });
    r = await api('POST', '/api/auth/login', { email: 'normal@example.com', password: 'Passw0rd!' });
    await check('normal login still works', () => { assert.strictEqual(r.status, 200); assert.ok(r.data.token); assert.strictEqual(r.data.account.email, 'normal@example.com'); });

  } catch (err) {
    if (!failed) fail('unexpected error', err);
    if (serverLog.trim()) console.error('\n--- server log (tail) ---\n' + serverLog.trim().slice(-6000) + '\n--------------------------');
  } finally {
    stop();
    await sleep(500);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n' + passed + ' failed? no -> ' + failed + ' failed, ' + passed + ' passed\n');
  process.exit(failed ? 1 : 0);
}

main();
