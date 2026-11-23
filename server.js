/* ══════════════════════════════════════════════════════════════
   HISAAB POS – server.js
   Express + Socket.IO server for Connect Mobile Scanner
   
   Run: node server.js
   Access desktop POS: http://localhost:3000
   Access mobile scanner: http://<LAN-IP>:3000/scanner.html
══════════════════════════════════════════════════════════════ */

'use strict';

const runtimeConfig = require('./server/runtime-config');

const express   = require('express');
const http      = require('http');
const https     = require('https');
const fs        = require('fs');
const { Server } = require('socket.io');
const crypto    = require('crypto');
const path      = require('path');
const os        = require('os');

// ─── CONFIG ──────────────────────────────────────────────────
const PORT          = Number(process.env.PORT) || 3000;
// HTTPS listener for phones: getUserMedia (live camera) requires a secure
// context, which plain http://192.168.x.x is NOT. A self-signed cert in
// ./certs enables this. Same Socket.IO instance, so events cross servers.
const HTTPS_PORT    = Number(process.env.HTTPS_PORT) || 3443;
const TOKEN_TTL_MS  = 5 * 60 * 1000;   // pairing token expires after 5 minutes
const SESSION_TTL_MS = 60 * 60 * 1000; // active session lives up to 1 hour

// Validate required/sensitive runtime configuration in production before
// initializing services. (Development/test keep existing local defaults.)
try {
  runtimeConfig.validateForStartup();
} catch (err) {
  console.error(runtimeConfig.formatValidationError(err));
  process.exit(1);
}

// ─── APP SETUP ───────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 30000,
  pingInterval: 15000,
});

// ─── OPTIONAL HTTPS LISTENER ─────────────────────────────────
let httpsEnabled = false;

function initHttps() {
  const keyPath  = path.join(__dirname, 'certs', 'key.pem');
  const certPath = path.join(__dirname, 'certs', 'cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.log('[HTTPS] No certificate found in ./certs – phone must use Snap Photo mode.');
    return;
  }

  try {
    const secureServer = https.createServer({
      key:  fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    }, app);

    // Attach the SAME Socket.IO instance so desktop (http) and phone (https)
    // share rooms and can exchange events.
    io.attach(secureServer);

    secureServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      httpsEnabled = true;
      console.log('[HTTPS] Secure listener ready on port ' + HTTPS_PORT);
    });

    secureServer.on('error', (err) => {
      console.warn('[HTTPS] Disabled: ' + err.message);
    });
  } catch (err) {
    console.warn('[HTTPS] Disabled: ' + err.message);
  }
}

initHttps();

// ─── RUNTIME PUBLIC CLIENT CONFIG (env-driven, public values only) ─────
// Prefer environment-provided Supabase public config (URL + anon key) when set.
// The anon key is designed to be public when RLS policies are enforced; all
// private/service-role/database/payment secrets remain server-side env vars.
// Falls back to the existing static config.js for local development.
app.get('/config.js', (req, res, next) => {
  try {
    const pub = runtimeConfig.supabasePublicConfig();
    if (pub && pub.configured) {
      res.type('application/javascript');
      res.set('Cache-Control', 'no-store');
      const safe = { url: String(pub.url || ''), anonKey: String(pub.anonKey || '') };
      return res.send(
        'window.SUPABASE_CONFIG = Object.assign({}, window.SUPABASE_CONFIG || {}, ' +
        JSON.stringify(safe) + ');\n'
      );
    }
  } catch (e) {
    // Fall through to static/local config on unexpected errors.
  }
  return next();
});

// ─── STATIC FILES (public-only) ──────────────────────────────
// Serve project-root assets needed by the POS, but block sensitive/internal
// paths so data stores, server code, secrets, and credentials are never exposed.
// IMPORTANT: this must run before any broad static handler.
const BLOCKED_STATIC_PREFIXES = [
  '/data',
  '/saas',
  '/server',
  '/test',
  '/supabase',
  '/docs',
  '/certs',
  '/node_modules',
  '/.git',
  '/.env'
];
const BLOCKED_STATIC_FILES = new Set([
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/.gitignore',
  '/.env.example',
  '/supabase-schema.sql'
]);

app.use((req, res, next) => {
  try {
    const rawPath = decodeURIComponent(String(req.path || '/')).replace(/\\/g, '/');
    const lower = rawPath.toLowerCase();

    // Never serve dotfiles or dot-directories (e.g. /.env, /.git/*)
    if (/(^|\/)\.[^/]/.test(lower)) {
      return res.status(404).send('Not found');
    }

    if (BLOCKED_STATIC_FILES.has(lower)) {
      return res.status(404).send('Not found');
    }

    for (const prefix of BLOCKED_STATIC_PREFIXES) {
      if (lower === prefix || lower.startsWith(prefix + '/')) {
        return res.status(404).send('Not found');
      }
    }
  } catch (e) {
    // Malformed path encoding — fail closed.
    return res.status(400).send('Bad request');
  }
  next();
});

// Serve static files from project root (after sensitive-path block)
app.use(express.static(path.join(__dirname), { dotfiles: 'deny' }));

// ─── SAAS: plans, subscriptions, billing, usage & admin ───────
// Mounted before the global JSON parser because the payment
// webhook needs the raw request body for signature verification.
require('./saas/index.js')(app);

// ─── SUPER ADMIN (additive, isolated from POS UI) ───────────────
// Separate API routes under /super-admin/v1 and SPA at /super-admin.
// Does not modify any Customer POS routes or static behavior.
const superAdminRouter = express.Router();
superAdminRouter.use(express.json({ limit: '10mb' }));
require('./saas/routes/super-admin.routes.js')(superAdminRouter);
app.use('/api', superAdminRouter);

require('./server/mount-super-admin')(app, __dirname);

// 10 MB: WhatsApp PDF invoices are sent as base64 in the JSON body
app.use(express.json({ limit: '10mb' }));

// ─── SESSION STORE ───────────────────────────────────────────
// Map<token, SessionRecord>
const sessions = new Map();

function genToken() {
  return crypto.randomBytes(16).toString('hex'); // 32 hex chars
}

function createSession(desktopSocketId) {
  const token     = genToken();
  const sessionId = 'sess_' + genToken().slice(0, 12);
  const record    = {
    token,
    sessionId,
    desktopSocketId,
    mobileSocketId: null,
    createdAt: Date.now(),
    connectedAt: null,
    processedEvents: new Set(), // dedup barcode events
  };
  sessions.set(token, record);

  // Auto-expire token after TTL
  setTimeout(() => {
    const s = sessions.get(token);
    if (s && !s.mobileSocketId) {
      sessions.delete(token);
      console.log('[SESSION] Token expired: ' + token.slice(0, 8) + '...');
    }
  }, TOKEN_TTL_MS);

  return record;
}

function getSessionByToken(token) {
  return sessions.get(token) || null;
}

function getSessionByDesktopSocket(socketId) {
  for (const s of sessions.values()) {
    if (s.desktopSocketId === socketId) return s;
  }
  return null;
}

function getSessionByMobileSocket(socketId) {
  for (const s of sessions.values()) {
    if (s.mobileSocketId === socketId) return s;
  }
  return null;
}

function cleanupSession(session) {
  sessions.delete(session.token);
}

// ─── HTTP API ─────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, sessions: sessions.size, ts: Date.now() });
});

// LAN IP – lets the desktop POS build the correct QR URL for the phone
app.get('/api/lan-ip', (req, res) => {
  res.json({
    ip:          getLanIp(),
    port:        PORT,
    https:       httpsEnabled,
    securePort:  HTTPS_PORT,
  });
});

// Desktop requests a new pairing token
app.post('/api/create-pairing', (req, res) => {
  const { desktopSocketId } = req.body;
  if (!desktopSocketId) return res.status(400).json({ error: 'desktopSocketId required' });

  // Remove any previous session for this desktop socket
  const old = getSessionByDesktopSocket(desktopSocketId);
  if (old) cleanupSession(old);

  const session = createSession(desktopSocketId);
  console.log('[SESSION] Created: ' + session.sessionId + ', token: ' + session.token.slice(0, 8) + '...');

  res.json({
    token:     session.token,
    sessionId: session.sessionId,
    expiresIn: TOKEN_TTL_MS,
  });
});

// ─── WHATSAPP CLOUD API PROXY ────────────────────────────────
// Credentials are supplied per request and forwarded straight to Meta.
// They are never logged or stored on the server.
const WA_DEFAULT_VERSION = 'v21.0';

function waVersion(raw) {
  const v = String(raw || WA_DEFAULT_VERSION).trim();
  return /^v\d+(\.\d+)?$/.test(v) ? v : WA_DEFAULT_VERSION;
}

function waDigits(to) {
  return String(to || '').replace(/\D/g, '');
}

// Verify a Phone Number ID + access token against Meta
app.post('/api/whatsapp/verify', async (req, res) => {
  const { phoneNumberId, token, apiVersion } = req.body || {};
  if (!phoneNumberId || !token) {
    return res.status(400).json({ ok: false, error: 'Phone Number ID and Access Token are required.' });
  }

  try {
    const url = 'https://graph.facebook.com/' + waVersion(apiVersion) + '/' +
      encodeURIComponent(phoneNumberId) +
      '?fields=display_phone_number,verified_name,quality_rating';

    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || data.error) {
      return res.status(400).json({
        ok: false,
        error: (data.error && data.error.message) || ('Meta returned HTTP ' + r.status),
        code: data.error && data.error.code,
      });
    }

    res.json({
      ok: true,
      displayPhoneNumber: data.display_phone_number || null,
      verifiedName: data.verified_name || null,
      quality: data.quality_rating || null,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Could not reach Meta: ' + err.message });
  }
});

// Send an invoice text (or template) message
app.post('/api/whatsapp/send', async (req, res) => {
  const body = req.body || {};
  const { phoneNumberId, token, apiVersion, type, text, template, language } = body;
  const to = waDigits(body.to);

  if (!phoneNumberId || !token) {
    return res.status(400).json({ ok: false, error: 'WhatsApp is not connected. Add your Phone Number ID and Access Token.' });
  }
  if (!to || to.length < 8) {
    return res.status(400).json({ ok: false, error: 'A valid recipient WhatsApp number is required.' });
  }

  let payload;
  if (type === 'template') {
    if (!template) return res.status(400).json({ ok: false, error: 'Template name is required.' });
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: language || 'en' },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: (text || '').slice(0, 1024) }],
        }],
      },
    };
  } else {
    if (!text || !text.trim()) {
      return res.status(400).json({ ok: false, error: 'Message body is empty.' });
    }
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text.slice(0, 4096) },
    };
  }

  try {
    const url = 'https://graph.facebook.com/' + waVersion(apiVersion) + '/' +
      encodeURIComponent(phoneNumberId) + '/messages';

    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok || data.error) {
      const err = data.error || {};
      return res.status(400).json({
        ok: false,
        error: err.message || ('Meta returned HTTP ' + r.status),
        code: err.code,
        subcode: err.error_subcode,
        details: err.error_data && err.error_data.details,
      });
    }

    res.json({
      ok: true,
      messageId: (data.messages && data.messages[0] && data.messages[0].id) || null,
      waId: (data.contacts && data.contacts[0] && data.contacts[0].wa_id) || to,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Could not reach Meta: ' + err.message });
  }
});

// Send an invoice as a PDF document attachment.
// Flow: upload to /media (multipart) -> get media id -> send document message.
app.post('/api/whatsapp/send-document', async (req, res) => {
  const body = req.body || {};
  const { phoneNumberId, token, apiVersion, filename, caption, pdfBase64 } = body;
  const to = waDigits(body.to);

  if (!phoneNumberId || !token) {
    return res.status(400).json({ ok: false, error: 'WhatsApp is not connected. Add your Phone Number ID and Access Token.' });
  }
  if (!to || to.length < 8) {
    return res.status(400).json({ ok: false, error: 'A valid recipient WhatsApp number is required.' });
  }
  if (!pdfBase64) {
    return res.status(400).json({ ok: false, error: 'No PDF data received.' });
  }

  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(String(pdfBase64).replace(/^data:application\/pdf;base64,/, ''), 'base64');
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Could not decode the PDF.' });
  }
  if (pdfBuffer.length < 200 || pdfBuffer.slice(0, 4).toString() !== '%PDF') {
    return res.status(400).json({ ok: false, error: 'The generated file is not a valid PDF.' });
  }
  if (pdfBuffer.length > 100 * 1024 * 1024) {
    return res.status(400).json({ ok: false, error: 'PDF is larger than the 100 MB limit.' });
  }

  const base = 'https://graph.facebook.com/' + waVersion(apiVersion);
  const name = String(filename || 'invoice.pdf').replace(/["\r\n]/g, '').slice(0, 120);

  try {
    // 1) Upload media
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), name);

    const upRes = await fetch(base + '/' + encodeURIComponent(phoneNumberId) + '/media', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form,
    });
    const upData = await upRes.json().catch(() => ({}));

    if (!upRes.ok || !upData.id) {
      const err = upData.error || {};
      return res.status(400).json({
        ok: false,
        stage: 'upload',
        error: err.message || ('Media upload failed (HTTP ' + upRes.status + ')'),
        code: err.code,
      });
    }

    // 2) Send document message
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: {
        id: upData.id,
        filename: name,
        caption: String(caption || '').slice(0, 1024),
      },
    };

    const sendRes = await fetch(base + '/' + encodeURIComponent(phoneNumberId) + '/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const sendData = await sendRes.json().catch(() => ({}));

    if (!sendRes.ok || sendData.error) {
      const err = sendData.error || {};
      return res.status(400).json({
        ok: false,
        stage: 'send',
        error: err.message || ('Meta returned HTTP ' + sendRes.status),
        code: err.code,
        subcode: err.error_subcode,
      });
    }

    res.json({
      ok: true,
      messageId: (sendData.messages && sendData.messages[0] && sendData.messages[0].id) || null,
      waId: (sendData.contacts && sendData.contacts[0] && sendData.contacts[0].wa_id) || to,
      mediaId: upData.id,
      size: pdfBuffer.length,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Could not reach Meta: ' + err.message });
  }
});

// ─── INVOICE PDF LINKS (secure, public) ──────────────────────
// Stores generated invoice PDFs and serves them via unguessable tokens.
// No internal database IDs or sensitive info are exposed in the URL.
const INVOICE_DIR = path.join(__dirname, 'data', 'invoices');
const INVOICE_INDEX = path.join(__dirname, 'data', 'invoice-links.json');

function ensureInvoiceStorage() {
  try { fs.mkdirSync(INVOICE_DIR, { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(path.dirname(INVOICE_INDEX), { recursive: true }); } catch (e) {}
}

function readInvoiceIndex() {
  try {
    if (fs.existsSync(INVOICE_INDEX)) {
      return JSON.parse(fs.readFileSync(INVOICE_INDEX, 'utf8')) || {};
    }
  } catch (e) {}
  return {};
}

function writeInvoiceIndex(index) {
  try { fs.writeFileSync(INVOICE_INDEX, JSON.stringify(index, null, 2), 'utf8'); } catch (e) {}
}

// Upload a PDF and get a secure, shareable link (token-based)
app.post('/api/invoice-link', (req, res) => {
  try {
    const body = req.body || {};
    const pdfBase64 = String(body.pdfBase64 || '').replace(/^data:application\/pdf;base64,/, '');
    if (!pdfBase64) return res.status(400).json({ ok: false, error: 'No PDF data received.' });

    let pdfBuffer;
    try { pdfBuffer = Buffer.from(pdfBase64, 'base64'); }
    catch (e) { return res.status(400).json({ ok: false, error: 'Could not decode the PDF.' }); }

    if (pdfBuffer.length < 200 || pdfBuffer.slice(0, 4).toString() !== '%PDF') {
      return res.status(400).json({ ok: false, error: 'The generated file is not a valid PDF.' });
    }

    ensureInvoiceStorage();
    const token = crypto.randomBytes(24).toString('base64url');
    const filename = token + '.pdf';
    const filePath = path.join(INVOICE_DIR, filename);
    fs.writeFileSync(filePath, pdfBuffer);

    const index = readInvoiceIndex();
    index[token] = {
      file: filename,
      invNo: String(body.invNo || ''),
      createdAt: Date.now()
    };
    writeInvoiceIndex(index);

    const urlPath = '/i/' + token;
    res.json({ ok: true, token, url: urlPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not create invoice link: ' + err.message });
  }
});

// Public invoice PDF viewer (no login). Token is the only access key.
app.get('/i/:token', (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return res.status(404).send('Not found');

    const index = readInvoiceIndex();
    const entry = index[token];
    if (!entry || !entry.file) return res.status(404).send('Invoice not found');

    const filePath = path.join(INVOICE_DIR, path.basename(entry.file));
    if (!fs.existsSync(filePath)) return res.status(404).send('Invoice not found');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="invoice.pdf"');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).send('Could not load invoice');
  }
});

// ─── UTILITY ─────────────────────────────────────────────────
function getLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== 'IPv4' || net.internal) continue;
      // Skip link-local (169.254.x.x) – phones cannot route to those
      if (net.address.startsWith('169.254.')) continue;
      candidates.push(net.address);
    }
  }

  // Prefer real private LAN ranges (home/office Wi-Fi) over VPN/other adapters
  const isPrivate = ip =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);

  return candidates.find(isPrivate) || candidates[0] || 'localhost';
}

// ─── WEBSOCKET EVENTS ────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[WS] Connected: ' + socket.id);

  // DESKTOP: register socket as active desktop
  socket.on('desktop-register', () => {
    socket.data.role = 'desktop';
    console.log('[WS] Desktop registered: ' + socket.id);

    // Re-bind any session whose original desktop socket is gone (e.g. after a
    // network blip) so scans from a paired phone keep reaching the POS
    // instead of being silently dropped.
    for (const session of sessions.values()) {
      const oldSocket = io.sockets.sockets.get(session.desktopSocketId);
      if (!oldSocket || !oldSocket.connected) {
        session.desktopSocketId = socket.id;
        socket.join(session.sessionId);
        console.log('[SESSION] Re-bound to desktop ' + socket.id + ': ' + session.sessionId);
        if (session.mobileSocketId) {
          io.to(session.mobileSocketId).emit('session-rebound', { sessionId: session.sessionId });
        }
      }
    }
  });

  // MOBILE: join session via pairing token
  socket.on('mobile-join', ({ token }) => {
    if (!token) {
      socket.emit('join-error', { message: 'Token missing' });
      return;
    }

    const session = getSessionByToken(token);
    if (!session) {
      socket.emit('join-error', { message: 'Invalid or expired QR code. Please generate a new one.' });
      return;
    }

    if (session.mobileSocketId && session.mobileSocketId !== socket.id) {
      socket.emit('join-error', { message: 'Session already in use by another device.' });
      return;
    }

    // Bind mobile socket to session
    session.mobileSocketId = socket.id;
    session.connectedAt    = Date.now();
    socket.data.role       = 'mobile';
    socket.data.token      = token;

    const room = session.sessionId;
    socket.join(room);

    // Also add desktop to the room (if still connected)
    const desktopSocket = io.sockets.sockets.get(session.desktopSocketId);
    if (desktopSocket) {
      desktopSocket.join(room);
      io.to(session.desktopSocketId).emit('scanner-connected', {
        sessionId: session.sessionId,
        ts:        Date.now(),
      });
    }

    // Acknowledge to mobile
    socket.emit('join-success', {
      sessionId: session.sessionId,
      message:   'Connected to POS successfully!',
    });

    console.log('[WS] Mobile joined session: ' + session.sessionId);
  });

  // MOBILE: barcode scanned
  socket.on('barcode-scanned', ({ token, barcode, eventId }) => {
    if (!token || !barcode) return;

    const session = getSessionByToken(token);
    if (!session) {
      socket.emit('scan-error', { message: 'Session expired. Please reconnect.' });
      return;
    }

    if (session.mobileSocketId !== socket.id) {
      socket.emit('scan-error', { message: 'Unauthorized scanner.' });
      return;
    }

    // Deduplication: skip if this event was already processed
    const dedupeKey = eventId || (barcode + '_' + Math.floor(Date.now() / 1200));
    if (session.processedEvents.has(dedupeKey)) {
      console.log('[SCAN] Duplicate event skipped: ' + dedupeKey);
      return;
    }
    session.processedEvents.add(dedupeKey);
    // Trim old dedup keys to avoid memory growth
    if (session.processedEvents.size > 200) {
      const arr = [...session.processedEvents];
      session.processedEvents = new Set(arr.slice(-100));
    }

    console.log('[SCAN] Barcode: ' + barcode + ' -> session: ' + session.sessionId);

    // Forward to desktop
    io.to(session.desktopSocketId).emit('barcode-received', {
      barcode,
      eventId: dedupeKey,
      ts:      Date.now(),
    });
  });

  // DESKTOP: product lookup result -> relay to mobile
  socket.on('product-result', ({ token, product, found }) => {
    const session = getSessionByToken(token);
    if (!session || session.desktopSocketId !== socket.id) return;

    if (session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('product-result', { product, found });
    }
  });

  // DESKTOP: request disconnect
  socket.on('disconnect-scanner', ({ token }) => {
    const session = getSessionByToken(token);
    if (!session || session.desktopSocketId !== socket.id) return;

    if (session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('session-ended', {
        message: 'POS disconnected the scanner.',
      });
    }
    cleanupSession(session);
    socket.emit('scanner-disconnected', { reason: 'manual' });
    console.log('[SESSION] Manually disconnected: ' + session.sessionId);
  });

  // HANDLE DISCONNECTION
  socket.on('disconnect', () => {
    console.log('[WS] Disconnected: ' + socket.id + ' (role: ' + socket.data.role + ')');

    if (socket.data.role === 'mobile') {
      const session = getSessionByMobileSocket(socket.id);
      if (session) {
        session.mobileSocketId = null;
        io.to(session.desktopSocketId).emit('scanner-disconnected', { reason: 'mobile_disconnected' });
        console.log('[SESSION] Mobile disconnected from: ' + session.sessionId);
      }
    } else if (socket.data.role === 'desktop') {
      const session = getSessionByDesktopSocket(socket.id);
      if (session) {
        if (session.mobileSocketId) {
          io.to(session.mobileSocketId).emit('session-ended', {
            message: 'POS session closed.',
          });
        }
        cleanupSession(session);
        console.log('[SESSION] Desktop closed, session cleaned: ' + session.sessionId);
      }
    }
  });
});

// ─── PERIODIC CLEANUP ─────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      if (session.mobileSocketId) {
        io.to(session.mobileSocketId).emit('session-ended', { message: 'Session expired.' });
      }
      sessions.delete(token);
      console.log('[CLEANUP] Expired session: ' + session.sessionId);
    }
  }
}, 10 * 60 * 1000);

// ─── START SERVER ─────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLanIp();
  console.log('\n+-----------------------------------------------+');
  console.log('|      HISAAB POS - Server Running              |');
  console.log('+-----------------------------------------------+');
  console.log('|  Desktop POS : http://localhost:' + PORT + '           |');
  console.log('|  LAN Access  : http://' + lanIp + ':' + PORT + '  |');
  if (httpsEnabled) {
    console.log('|  Mobile URL  : https://' + lanIp + ':' + HTTPS_PORT + '/scanner.html |');
    console.log('|  (camera: accept the self-signed cert)        |');
  } else {
    console.log('|  Mobile URL  : http://' + lanIp + ':' + PORT + '/scanner.html |');
  }
  console.log('+-----------------------------------------------+\n');
});
