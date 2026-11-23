'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.HISAAB_DATA_DIR
  ? path.resolve(process.env.HISAAB_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const AUDIT_FILE = path.join(DATA_DIR, 'super-admin-audit.json');
const MAX_EVENTS = 50000;

function ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function readAll() {
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : (parsed.events || []);
    }
  } catch (e) {}
  return [];
}
function writeAll(events) {
  ensureDir();
  const tmp = AUDIT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(events.slice(-MAX_EVENTS)), 'utf8');
  try { fs.renameSync(tmp, AUDIT_FILE); } catch (e) { fs.rmSync(AUDIT_FILE, { force: true }); fs.renameSync(tmp, AUDIT_FILE); }
}

function append(event) {
  const events = readAll();
  const row = {
    id: 'aud_' + crypto.randomBytes(8).toString('hex'),
    occurredAt: new Date().toISOString(),
    actorAdminId: event.actorAdminId || null,
    actorEmail: event.actorEmail || null,
    actorRole: event.actorRole || null,
    action: event.action || 'unknown',
    entityType: event.entityType || null,
    entityId: event.entityId || null,
    entityLabel: event.entityLabel || null,
    before: event.before || null,
    after: event.after || null,
    ip: event.ip || null,
    userAgent: event.userAgent || null,
    requestId: event.requestId || null,
    severity: event.severity || 'info',
    metadata: event.metadata || {}
  };
  events.push(row);
  writeAll(events);
  return row;
}

function query({ limit = 100, offset = 0, action, actor, entityType, entityId, q } = {}) {
  let events = readAll().slice().reverse();
  if (action) events = events.filter(e => String(e.action).includes(action));
  if (actor) events = events.filter(e => String(e.actorEmail || '').toLowerCase().includes(String(actor).toLowerCase()) || String(e.actorAdminId||'').includes(actor));
  if (entityType) events = events.filter(e => e.entityType === entityType);
  if (entityId) events = events.filter(e => String(e.entityId || '') === String(entityId));
  if (q) {
    const s = String(q).toLowerCase();
    events = events.filter(e => JSON.stringify(e).toLowerCase().includes(s));
  }
  const total = events.length;
  const items = events.slice(Number(offset)||0, (Number(offset)||0) + Math.max(1, Math.min(500, Number(limit)||100)));
  return { items, total };
}

module.exports = { append, query, AUDIT_FILE };
