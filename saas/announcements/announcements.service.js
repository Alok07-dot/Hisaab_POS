'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.HISAAB_DATA_DIR
  ? path.resolve(process.env.HISAAB_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'super-admin-announcements.json');

function ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function readAll() {
  try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8')) || []; } catch (e) {}
  return [];
}
function writeAll(items) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
  try { fs.renameSync(tmp, FILE); } catch (e) { fs.rmSync(FILE, { force: true }); fs.renameSync(tmp, FILE); }
}

function list() { return readAll().slice().reverse(); }
function get(id) { return readAll().find(x => x.id === id) || null; }
function create(payload, actor) {
  const items = readAll();
  const now = new Date().toISOString();
  const row = Object.assign({
    id: 'ann_' + crypto.randomBytes(6).toString('hex'),
    title: '', body: '', category: 'General Announcement', status: 'draft',
    audienceType: 'all', audienceFilter: null, publishAt: null, expiresAt: null,
    delivery: 0, read: 0, readRate: '0%',
    createdAt: now, updatedAt: now, createdBy: actor || null
  }, payload || {});
  items.push(row); writeAll(items); return row;
}
function update(id, patch) {
  const items = readAll();
  const idx = items.findIndex(x => x.id === id);
  if (idx < 0) return null;
  items[idx] = Object.assign({}, items[idx], patch || {}, { updatedAt: new Date().toISOString() });
  writeAll(items); return items[idx];
}
function publish(id) { return update(id, { status: 'published', publishAt: new Date().toISOString() }); }
function archive(id) { return update(id, { status: 'archived' }); }

module.exports = { list, get, create, update, publish, archive, FILE };
