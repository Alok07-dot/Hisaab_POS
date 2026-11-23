'use strict';

const ROLES = {
  owner: { key: 'owner', name: 'Super Admin / Owner' },
  admin: { key: 'admin', name: 'Admin' },
  developer: { key: 'developer', name: 'Developer' },
  support: { key: 'support', name: 'Customer Support' },
  finance: { key: 'finance', name: 'Finance Manager' },
  operations: { key: 'operations', name: 'Operations Manager' }
};

// Granular permission catalog (server-enforced). "*" reserved for owner.
const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: [
    'overview.view',
    'users.view','users.edit','users.suspend','users.reactivate','users.block','users.delete','users.purge_data',
    'businesses.view',
    'subscriptions.view','subscriptions.modify',
    'plans.view','plans.create','plans.edit','plans.archive','plans.activate','plans.change_pricing','plans.manage_features','plans.manage_limits','plans.view_history',
    'payments.view','payments.export',
    'communication.view','communication.manage','communication.publish',
    'maintenance.view','maintenance.schedule',
    'notifications.view','notifications.manage',
    'team.view','team.invite',
    'system.view','system.logs.view',
    'audit.view',
    'support.view','support.manage','support.assign',
    'reports.view','reports.export',
    'settings.view','settings.manage'
  ],
  developer: ['overview.view','plans.view','plans.view_history','system.view','system.logs.view','audit.view'],
  support: ['overview.view','users.view','businesses.view','subscriptions.view','payments.view','support.view','support.manage','support.assign'],
  finance: ['overview.view','subscriptions.view','payments.view','payments.view_sensitive','payments.export','payments.refund_mark','plans.view','plans.change_pricing','plans.view_history','reports.view','reports.export','audit.view'],
  operations: ['overview.view','users.view','businesses.view','subscriptions.view','communication.view','communication.manage','communication.publish','maintenance.view','maintenance.control','maintenance.schedule','notifications.view','notifications.manage','support.view','reports.view','system.view','plans.view']
};

function hasPermission(roleKey, permission) {
  if (!roleKey) return false;
  if (roleKey === 'owner') return true;
  const perms = ROLE_PERMISSIONS[roleKey] || [];
  return perms.includes('*') || perms.includes(permission);
}

function permissionsForRole(roleKey) {
  if (roleKey === 'owner') return ['*'];
  return (ROLE_PERMISSIONS[roleKey] || []).slice();
}

function normalizeRole(account) {
  if (!account) return null;
  // Existing SaaS store uses role 'admin' for seeded/admin accounts.
  if (account.role === 'admin' && account.email && /owner/i.test(account.name || '')) return 'owner';
  if (account.role === 'admin') return 'admin';
  return account.adminRole || account.role || null;
}

module.exports = { ROLES, ROLE_PERMISSIONS, hasPermission, permissionsForRole, normalizeRole };
