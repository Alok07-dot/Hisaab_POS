'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.HISAAB_DATA_DIR
  ? path.resolve(process.env.HISAAB_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'super-admin-maintenance.json');

function ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function readState() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {}
  return {
    current: { mode: 'off', message: '', startsAt: null, endsAt: null, countdownEnabled: false, adminBypass: true, allowlist: ['/api/billing/webhook', '/api/whatsapp', '/i/'] },
    schedule: null,
    history: [],
    updatedAt: null
  };
}
function writeState(state) {
  ensureDir();
  state.updatedAt = new Date().toISOString();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  try { fs.renameSync(tmp, FILE); } catch (e) { fs.rmSync(FILE, { force: true }); fs.renameSync(tmp, FILE); }
}

function getState() { return readState(); }

function setState(patch, actor) {
  const state = readState();
  const before = JSON.parse(JSON.stringify(state.current));
  state.current = Object.assign({}, state.current, patch || {});
  state.history.unshift({ id: 'mnt_' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), actor: actor || null, before, after: state.current, type: patch && patch.mode ? patch.mode : 'update' });
  state.history = state.history.slice(0, 200);
  writeState(state);
  return state;
}

function schedule(window, actor) {
  const state = readState();
  state.schedule = Object.assign({ id: 'sch_' + crypto.randomBytes(6).toString('hex') }, window || {}, { updatedAt: new Date().toISOString(), actor: actor || null });
  state.history.unshift({ id: 'mnt_' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), actor: actor || null, before: null, after: state.schedule, type: 'schedule' });
  state.history = state.history.slice(0, 200);
  writeState(state);
  return state;
}

function publicStatus() {
  const s = readState();
  const c = s.current || {};
  const active = c.mode === 'active' || c.mode === 'emergency';
  return { ok: true, maintenance: { active, mode: c.mode || 'off', message: c.message || '', startsAt: c.startsAt || null, endsAt: c.endsAt || null, countdownEnabled: !!c.countdownEnabled, schedule: s.schedule || null } };
}

function isBlockedPath(reqPath) {
  const s = readState().current || {};
  if (s.mode === 'off') return false;
  // allowlist: webhooks/essential ops always allowed
  const allow = Array.isArray(s.allowlist) ? s.allowlist : ['/api/billing/webhook'];
  return !allow.some(p => reqPath.startsWith(p));
}

module.exports = { getState, setState, schedule, publicStatus, isBlockedPath, FILE };
