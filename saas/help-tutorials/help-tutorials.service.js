'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.HISAAB_DATA_DIR
  ? path.resolve(process.env.HISAAB_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'super-admin-help-tutorials.json');
const THUMB_DIR = path.join(DATA_DIR, 'help-tutorial-thumbnails');

const CATEGORIES = [
  'Getting Started', 'Products', 'Inventory', 'POS & Sales', 'Purchase',
  'Customers', 'Suppliers', 'Accounting', 'Reports', 'Settings'
];
const LANGUAGES = ['English', 'Hindi', 'Other'];
const STATUSES = ['draft', 'published'];
const MAX_THUMB_BYTES = 2 * 1024 * 1024; // 2 MB

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(THUMB_DIR, { recursive: true }); } catch (e) {}
}
function readAll() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {}
  return [];
}
function writeAll(items) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
  try { fs.renameSync(tmp, FILE); } catch (e) { fs.rmSync(FILE, { force: true }); fs.renameSync(tmp, FILE); }
}
function id() { return 'ht_' + crypto.randomBytes(6).toString('hex'); }
function nowIso() { return new Date().toISOString(); }
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }

function extractYouTubeVideoId(input) {
  const raw = str(input, 500);
  if (!raw) return '';
  // direct ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  let url;
  try { url = new URL(raw); } catch (e) { return ''; }
  const host = (url.hostname || '').toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  // youtu.be/<id>
  if (host === 'youtu.be') {
    const m = (url.pathname || '').replace(/^\/+/, '').split('/')[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(m) ? m : '';
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = (url.pathname || '').split('/').filter(Boolean);
    // /embed/<id>, /shorts/<id>, /v/<id>, /live/<id>
    if (parts.length >= 2 && ['embed', 'shorts', 'v', 'live'].includes(parts[0]) && /^[a-zA-Z0-9_-]{11}$/.test(parts[1])) return parts[1];
  }
  return '';
}

function youtubeThumbUrl(videoId) {
  return 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg';
}

function parseKeywords(v) {
  if (Array.isArray(v)) return v.map(x => str(x, 60)).filter(Boolean).slice(0, 30);
  if (typeof v === 'string') return v.split(',').map(x => str(x, 60)).filter(Boolean).slice(0, 30);
  return [];
}

function safeCategory(v) { const s = str(v, 60); return CATEGORIES.includes(s) ? s : 'Getting Started'; }
function safeLanguage(v) { const s = str(v, 40); return LANGUAGES.includes(s) ? s : 'English'; }
function safeStatus(v) { const s = str(v, 20).toLowerCase(); return STATUSES.includes(s) ? s : 'draft'; }

function sanitize(row) {
  if (!row) return null;
  const r = Object.assign({}, row);
  if (Array.isArray(r.keywords)) r.keywords = r.keywords.slice();
  return r;
}

function list() {
  return readAll().slice().sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}
function get(idVal) { return sanitize(readAll().find(x => x.id === idVal) || null); }

function saveCustomThumbnail(dataUrl, existingPath) {
  const raw = String(dataUrl || '');
  const m = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new Error('Invalid thumbnail image. Use JPG, PNG, or WebP.');
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!buf.length) throw new Error('Thumbnail image is empty.');
  if (buf.length > MAX_THUMB_BYTES) throw new Error('Thumbnail image is too large (max 2 MB).');
  ensureDir();
  const ext = mime === 'image/png' ? '.png' : (mime === 'image/webp' ? '.webp' : '.jpg');
  const fileName = 'ht_' + crypto.randomBytes(8).toString('hex') + ext;
  const abs = path.join(THUMB_DIR, fileName);
  fs.writeFileSync(abs, buf);
  // remove old custom file if different
  if (existingPath && typeof existingPath === 'string' && existingPath.startsWith('/api/help-tutorial-thumbnails/')) {
    const oldName = path.basename(existingPath);
    const oldAbs = path.join(THUMB_DIR, oldName);
    if (oldName && oldName !== fileName && fs.existsSync(oldAbs)) {
      try { fs.unlinkSync(oldAbs); } catch (e) {}
    }
  }
  return '/api/help-tutorial-thumbnails/' + fileName;
}

function removeCustomThumbnail(thumbUrl) {
  if (!thumbUrl || typeof thumbUrl !== 'string' || !thumbUrl.startsWith('/api/help-tutorial-thumbnails/')) return;
  const name = path.basename(thumbUrl);
  const abs = path.join(THUMB_DIR, name);
  if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch (e) {} }
}

function normalizePayload(payload, existing) {
  const p = payload || {};
  const ex = existing || {};
  const youtubeUrl = str(p.youtube_url != null ? p.youtube_url : ex.youtube_url, 500);
  const videoId = extractYouTubeVideoId(youtubeUrl);
  const thumbTypeReq = str(p.thumbnail_type || ex.thumbnail_type || 'youtube', 20).toLowerCase();
  let thumbnailType = thumbTypeReq === 'custom' ? 'custom' : 'youtube';
  let thumbnailUrl = ex.thumbnail_url || '';

  if (thumbnailType === 'youtube') {
    thumbnailUrl = videoId ? youtubeThumbUrl(videoId) : '';
  } else {
    // custom: keep existing unless new data provided
    if (p.thumbnail_data) {
      thumbnailUrl = saveCustomThumbnail(p.thumbnail_data, ex.thumbnail_type === 'custom' ? ex.thumbnail_url : null);
    } else if (ex.thumbnail_type === 'custom' && ex.thumbnail_url) {
      thumbnailUrl = ex.thumbnail_url;
    } else if (videoId) {
      // fallback to youtube thumb if no custom uploaded
      thumbnailType = 'youtube';
      thumbnailUrl = youtubeThumbUrl(videoId);
    } else {
      thumbnailUrl = '';
    }
  }

  // if switching from custom to youtube, clean up old file
  if (ex.thumbnail_type === 'custom' && thumbnailType === 'youtube' && ex.thumbnail_url) {
    removeCustomThumbnail(ex.thumbnail_url);
  }

  const out = {
    title: str(p.title != null ? p.title : ex.title, 200),
    description: str(p.description != null ? p.description : ex.description, 1000),
    youtube_url: youtubeUrl,
    youtube_video_id: videoId,
    thumbnail_url: thumbnailUrl,
    thumbnail_type: thumbnailType,
    category: safeCategory(p.category != null ? p.category : ex.category),
    language: safeLanguage(p.language != null ? p.language : ex.language),
    duration: str(p.duration != null ? p.duration : ex.duration, 40),
    keywords: parseKeywords(p.keywords != null ? p.keywords : ex.keywords),
    status: safeStatus(p.status != null ? p.status : ex.status),
    display_order: Number.isFinite(Number(p.display_order != null ? p.display_order : ex.display_order)) ? Number(p.display_order != null ? p.display_order : ex.display_order) : 0
  };
  return out;
}

function validate(row, { requireId = true } = {}) {
  const errors = [];
  if (!row.title) errors.push('Video title is required.');
  if (!row.youtube_url) errors.push('YouTube video URL is required.');
  if (!row.youtube_video_id) errors.push('A valid YouTube video URL/ID is required.');
  if (requireId && !row.youtube_video_id) errors.push('Could not extract a valid YouTube video ID.');
  if (row.thumbnail_type === 'custom' && !row.thumbnail_url) errors.push('Custom thumbnail is missing.');
  if (row.status === 'published' && !row.youtube_video_id) errors.push('Cannot publish without a valid YouTube video.');
  return errors;
}

function create(payload, actor) {
  const items = readAll();
  const now = nowIso();
  const norm = normalizePayload(payload, null);
  const errors = validate(norm);
  if (errors.length) { const e = new Error(errors[0]); e.code = 'validation_error'; e.details = errors; throw e; }
  const row = Object.assign({
    id: id(),
    created_at: now,
    updated_at: now,
    created_by: actor || null
  }, norm);
  items.push(row);
  writeAll(items);
  return sanitize(row);
}

function update(idVal, payload) {
  const items = readAll();
  const idx = items.findIndex(x => x.id === idVal);
  if (idx < 0) return null;
  const ex = items[idx];
  const norm = normalizePayload(payload, ex);
  // if caller did not send status, keep existing
  if (payload == null || payload.status == null) norm.status = ex.status || 'draft';
  const errors = validate(norm);
  if (errors.length) { const e = new Error(errors[0]); e.code = 'validation_error'; e.details = errors; throw e; }
  items[idx] = Object.assign({}, ex, norm, { id: ex.id, created_at: ex.created_at, created_by: ex.created_by, updated_at: nowIso() });
  writeAll(items);
  return sanitize(items[idx]);
}

function publish(idVal) {
  const items = readAll();
  const idx = items.findIndex(x => x.id === idVal);
  if (idx < 0) return null;
  if (!items[idx].youtube_video_id) { const e = new Error('Cannot publish without a valid YouTube video.'); e.code = 'validation_error'; throw e; }
  items[idx].status = 'published';
  items[idx].updated_at = nowIso();
  // ensure thumbnail for youtube type
  if (items[idx].thumbnail_type !== 'custom') {
    items[idx].thumbnail_type = 'youtube';
    items[idx].thumbnail_url = youtubeThumbUrl(items[idx].youtube_video_id);
  }
  writeAll(items);
  return sanitize(items[idx]);
}

function unpublish(idVal) {
  const items = readAll();
  const idx = items.findIndex(x => x.id === idVal);
  if (idx < 0) return null;
  items[idx].status = 'draft';
  items[idx].updated_at = nowIso();
  writeAll(items);
  return sanitize(items[idx]);
}

function remove(idVal) {
  const items = readAll();
  const idx = items.findIndex(x => x.id === idVal);
  if (idx < 0) return null;
  const row = items[idx];
  items.splice(idx, 1);
  writeAll(items);
  // cleanup custom thumbnail file if used
  removeCustomThumbnail(row.thumbnail_url);
  return sanitize(row);
}

function listPublished() {
  return readAll()
    .filter(x => x && x.status === 'published' && extractYouTubeVideoId(x.youtube_video_id || x.youtube_url))
    .map(x => {
      const vid = extractYouTubeVideoId(x.youtube_video_id || x.youtube_url);
      return {
        id: x.id,
        title: x.title || '',
        description: x.description || '',
        youtube_url: x.youtube_url || ('https://www.youtube.com/watch?v=' + vid),
        youtube_video_id: vid,
        thumbnail_url: x.thumbnail_type === 'custom' && x.thumbnail_url ? x.thumbnail_url : youtubeThumbUrl(vid),
        thumbnail_type: x.thumbnail_type === 'custom' ? 'custom' : 'youtube',
        category: x.category || 'Getting Started',
        language: x.language || 'English',
        duration: x.duration || '',
        keywords: Array.isArray(x.keywords) ? x.keywords : [],
        display_order: Number(x.display_order) || 0,
        updated_at: x.updated_at || x.created_at || null
      };
    })
    .sort((a, b) => (a.display_order - b.display_order) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

module.exports = {
  FILE, THUMB_DIR, CATEGORIES, LANGUAGES,
  list, get, create, update, publish, unpublish, remove,
  listPublished, extractYouTubeVideoId, youtubeThumbUrl, ensureDir
};
