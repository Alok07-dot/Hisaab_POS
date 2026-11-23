export const ROUTES = [
  { id: 'overview', path: '/overview', label: 'Overview', icon: 'overview', group: 'Overview', permission: 'overview.view' },
  { id: 'users', path: '/users', label: 'User Management', icon: 'users', group: 'Management', permission: 'users.view' },
  { id: 'businesses', path: '/businesses', label: 'Business Management', icon: 'business', group: 'Management', permission: 'businesses.view' },
  { id: 'subscriptions', path: '/subscriptions', label: 'Subscription Management', icon: 'subscription', group: 'Management', permission: 'subscriptions.view' },
  { id: 'plans', path: '/plans', label: 'Plan & Pricing', icon: 'plans', group: 'Management', permission: 'plans.view' },
  { id: 'payments', path: '/payments', label: 'Payment & Revenue', icon: 'payments', group: 'Finance', permission: 'payments.view' },
  { id: 'communication', path: '/communication', label: 'Communication Center', icon: 'megaphone', group: 'Operations', permission: 'communication.view' },
  { id: 'help-tutorials', path: '/help-tutorials', label: 'Help & Tutorials', icon: 'help', group: 'Operations', permission: 'communication.view' },
  { id: 'maintenance', path: '/maintenance', label: 'Maintenance Control', icon: 'maintenance', group: 'Operations', permission: 'maintenance.view' },
  { id: 'notifications', path: '/notifications', label: 'Notification Management', icon: 'bell', group: 'Operations', permission: 'notifications.view' },
  { id: 'team', path: '/team', label: 'Developer Management', icon: 'team', group: 'Internal', permission: 'team.view' },
  { id: 'system-health', path: '/system-health', label: 'System Health', icon: 'health', group: 'Internal', permission: 'system.view' },
  { id: 'audit-logs', path: '/audit-logs', label: 'Audit Logs', icon: 'audit', group: 'Internal', permission: 'audit.view' },
  { id: 'support', path: '/support', label: 'Support & Issues', icon: 'support', group: 'Support', permission: 'support.view' },
  { id: 'reports', path: '/reports', label: 'Reports & Analytics', icon: 'reports', group: 'Insights', permission: 'reports.view' },
  { id: 'settings', path: '/settings', label: 'Settings', icon: 'settings', group: 'Platform', permission: 'settings.view' }
];

export const ROUTE_GROUP_ORDER = ['Overview', 'Management', 'Finance', 'Operations', 'Internal', 'Support', 'Insights', 'Platform'];
