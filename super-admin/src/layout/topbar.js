import { icon } from '../core/icons.js';
import { appStore } from '../core/store.js';
import { initials, escapeHtml } from '../core/formatters.js';
import { ROLE_LABELS } from '../constants/permissions.js';

export function renderTopbar(title = 'Overview') {
  const user = appStore.session?.user || { name: 'Admin', email: '', role: 'admin' };
  const roleLabel = ROLE_LABELS[user.role] || user.role || 'Admin';
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-search" role="search">
          <span class="search-icon">${icon('search')}</span>
          <input type="search" placeholder="Search users, businesses, tickets…" aria-label="Global search" disabled title="Global search wiring in later steps" />
        </div>
        <span class="env-pill" title="Environment indicator">Internal</span>
        <span class="env-pill warn" title="Maintenance state indicator (sample)">Maintenance: Off</span>
      </div>
      <div class="topbar-right">
        <button class="icon-btn" id="themeToggleBtn" title="Toggle light/dark theme" aria-label="Toggle theme">${icon(theme === 'dark' ? 'sun' : 'moon')}</button>
        <button class="icon-btn" title="Admin notifications (sample)" aria-label="Notifications">${icon('bell')}</button>
        <div class="user-chip" title="${escapeHtml(user.email || '')}">
          <div class="avatar">${initials(user.name || user.email || 'A')}</div>
          <div class="user-meta">
            <div class="user-name">${escapeHtml(user.name || 'Admin')}</div>
            <div class="user-role">${escapeHtml(roleLabel)}</div>
          </div>
        </div>
        <button class="btn btn-sm" id="logoutBtn" title="Sign out">Logout</button>
      </div>
    </header>
  `;
}
