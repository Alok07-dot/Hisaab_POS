/**
 * ===============================================================
 * QRCode.toCanvas() shim
 * ---------------------------------------------------------------
 * Provide the small subset of the `qrcode` npm package API that
 * app.js uses (QRCode.toCanvas), backed by the dependency-free
 * `qrcode-generator` library (Kazuhiko Arase, MIT).
 *
 * Self-hosted so the POS works on a local LAN with no internet.
 * ===============================================================
 */
(function () {
  'use strict';

  if (typeof window.qrcode !== 'function') {
    console.warn('[QR shim] qrcode-generator not loaded');
    return;
  }

  function toCanvas(canvas, text, opts) {
    opts = opts || {};

    var targetWidth = opts.width || 200;
    var margin      = opts.margin == null ? 4 : opts.margin;
    var dark        = (opts.color && opts.color.dark)  || '#000000';
    var light       = (opts.color && opts.color.light) || '#ffffff';
    var ecLevel     = (opts.errorCorrectionLevel || 'M').toUpperCase();

    // typeNumber 0 = auto-detect smallest version that fits
    var qr = window.qrcode(0, ecLevel);
    qr.addData(String(text));
    qr.make();

    var count = qr.getModuleCount();
    var cell  = Math.max(1, Math.floor((targetWidth - margin * 2) / count));
    var size  = cell * count;

    canvas.width  = size;
    canvas.height = size;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = dark;
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(col * cell, row * cell, cell, cell);
        }
      }
    }

    return Promise.resolve(canvas);
  }

  window.QRCode = window.QRCode || {};
  if (typeof window.QRCode.toCanvas !== 'function') {
    window.QRCode.toCanvas = toCanvas;
  }
})();
