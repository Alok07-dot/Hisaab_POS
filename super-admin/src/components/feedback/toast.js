import { escapeHtml } from '../../core/formatters.js';

let host;
export function showToast({ title = 'Notice', message = '', tone = 'info', timeout = 2600 } = {}) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div>${message ? `<div class="toast-text">${escapeHtml(message)}</div>` : ''}`;
  host.appendChild(el);
  setTimeout(() => { el.remove(); }, timeout);
}
