'use strict';

const { hasPermission, normalizeRole, permissionsForRole } = require('./permissions');

function requirePermission(permission) {
  return function (req, res, next) {
    const account = req.account;
    if (!account) {
      return res.status(401).json({ ok: false, error: 'Authentication required.', code: 'unauthenticated' });
    }
    const role = normalizeRole(account) || account.role;
    // Backward compatibility: existing admin role in saas store grants admin-level access for legacy routes.
    const effectiveRole = (account.role === 'admin' && !account.adminRole) ? (role === 'owner' ? 'owner' : 'admin') : role;
    if (!hasPermission(effectiveRole, permission)) {
      return res.status(403).json({ ok: false, error: 'Insufficient permissions.', code: 'forbidden', permission });
    }
    req.adminRole = effectiveRole;
    req.adminPermissions = permissionsForRole(effectiveRole);
    next();
  };
}

module.exports = { requirePermission };
