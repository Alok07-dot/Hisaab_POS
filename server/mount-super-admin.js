'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Additive mount for the separate Super Admin SPA.
 * - Serves static assets under /super-admin
 * - SPA fallback for client-side routes
 * Does not modify Customer POS routes or static behavior.
 */
module.exports = function mountSuperAdmin(app, rootDir) {
  const adminDir = path.join(rootDir, 'super-admin');
  const indexFile = path.join(adminDir, 'index.html');

  app.get(['/super-admin', '/super-admin/*splat'], (req, res, next) => {
    // Let existing static/file handling win if a specific asset is requested and exists.
    const rel = req.path.replace(/^\/super-admin\/?/, '');
    if (rel) {
      const candidate = path.join(adminDir, rel);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return next();
    }
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
    return next();
  });

  console.log('[SUPER-ADMIN] SPA mount ready at /super-admin');
};
