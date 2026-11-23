export const ROLE_LABELS = {
  owner: 'Super Admin / Owner',
  admin: 'Admin',
  developer: 'Developer',
  support: 'Customer Support',
  finance: 'Finance Manager',
  operations: 'Operations Manager'
};

// UI-only permission hints; server remains source of truth. Updated for STEP 6 roles.
export const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: [
    'overview.view','users.view','users.edit','users.suspend','users.reactivate','users.block','users.delete','users.purge_data','businesses.view','subscriptions.view','subscriptions.modify','plans.view','plans.create','plans.edit','plans.archive','plans.activate','plans.change_pricing','plans.manage_features','plans.manage_limits','plans.view_history','payments.view','payments.export','communication.view','communication.manage','communication.publish','maintenance.view','maintenance.schedule','notifications.view','notifications.manage','team.view','team.invite','system.view','system.logs.view','audit.view','support.view','support.manage','support.assign','reports.view','reports.export','settings.view','settings.manage'
  ],
  developer: ['overview.view','plans.view','plans.view_history','system.view','system.logs.view','audit.view'],
  support: ['overview.view','users.view','businesses.view','subscriptions.view','payments.view','support.view','support.manage','support.assign'],
  finance: ['overview.view','subscriptions.view','payments.view','payments.view_sensitive','payments.export','payments.refund_mark','plans.view','plans.change_pricing','plans.view_history','reports.view','reports.export','audit.view'],
  operations: ['overview.view','users.view','businesses.view','subscriptions.view','communication.view','communication.manage','communication.publish','maintenance.view','maintenance.control','maintenance.schedule','notifications.view','notifications.manage','support.view','reports.view','system.view','plans.view']
};

import { appStore } from '../core/store.js';

export function can(permission, role = null) {
  const sessionPerms = appStore?.session?.permissions;
  if (Array.isArray(sessionPerms) && sessionPerms.length) {
    return sessionPerms.includes('*') || sessionPerms.includes(permission);
  }
  const r = role || appStore?.session?.user?.role || 'admin';
  const perms = ROLE_PERMISSIONS[r] || [];
  return perms.includes('*') || perms.includes(permission);
}
