import { ROUTES, ROUTE_GROUP_ORDER } from '../constants/routes.js';
import { icon } from '../core/icons.js';
import { can } from '../constants/permissions.js';
import { appStore } from '../core/store.js';

export function renderSidebar(activeId = 'overview') {
  const role = appStore.session?.user?.role || 'admin';
  const groups = ROUTE_GROUP_ORDER.map(group => {
    const items = ROUTES.filter(r => r.group === group);
    if (!items.length) return '';
    const links = items.map(r => {
      const allowed = can(r.permission, role);
      const active = r.id === activeId ? 'active' : '';
      const disabled = allowed ? '' : 'disabled';
      const title = allowed ? '' : 'title="Permission required (server-enforced in live mode)"';
      return `
        <button class="nav-item ${active} ${disabled}" data-route="${r.path}" data-route-id="${r.id}" ${allowed ? '' : 'aria-disabled="true"'} ${title}>
          <span class="nav-icon">${icon(r.icon)}</span>
          <span class="nav-text">${r.label}</span>
        </button>`;
    }).join('');
    return `<div class="nav-group"><div class="nav-label">${group}</div>${links}</div>`;
  }).join('');

  return `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="brand-mark">H</div>
        <div class="brand-meta">
          <div class="brand-name">Hisaab Admin</div>
          <div class="brand-sub">Super Admin Panel</div>
        </div>
      </div>
      <nav class="sidebar-nav" aria-label="Primary">${groups}</nav>
      <div class="sidebar-footer">
        <div>Internal control center</div>
        <div class="subtle">v1 architecture • /super-admin</div>
      </div>
    </aside>
  `;
}
