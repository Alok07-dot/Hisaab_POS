import { escapeHtml } from '../../core/formatters.js';

let host;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'modal-host';
  document.body.appendChild(host);
  return host;
}

export function closeModal() {
  if (!host) return;
  host.innerHTML = '';
  document.body.style.overflow = '';
}

export function openModal({ title = '', subtitle = '', body = '', footer = '', size = '' } = {}) {
  const h = ensureHost();
  const modalClass = size === 'sm' ? 'modal modal-sm' : (size === 'lg' || size === 'wide' ? 'modal modal-lg' : 'modal');
  h.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="${modalClass}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">${escapeHtml(title)}</h3>
            ${subtitle ? `<p class="modal-sub">${escapeHtml(subtitle)}</p>` : ''}
          </div>
          <button class="icon-btn" data-modal-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    </div>
  `;
  document.body.style.overflow = 'hidden';
  h.querySelectorAll('[data-modal-close]').forEach(el => el.addEventListener('click', closeModal));
  const overlay = h.querySelector('#modalOverlay');
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', function esc(e){ if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); } }, { once: true });
  return h;
}

export function confirmDialog({ title = 'Confirm action', subtitle = 'This action is recorded in the audit log.', message = '', confirmText = 'Confirm', danger = false, onConfirm }) {
  openModal({
    title,
    subtitle,
    body: `<p style="margin:0;font-size:14px;color:var(--text-secondary)">${escapeHtml(message)}</p>`,
    footer: `
      <button class="btn" data-modal-close>Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOkBtn">${escapeHtml(confirmText)}</button>
    `,
    size: 'sm'
  });
  const btn = document.getElementById('confirmOkBtn');
  if (btn) btn.addEventListener('click', () => { closeModal(); if (typeof onConfirm === 'function') onConfirm(); });
}
