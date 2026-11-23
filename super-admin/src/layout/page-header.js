import { escapeHtml } from '../core/formatters.js';

export function renderPageHeader({ breadcrumbs = ['Super Admin'], title = '', subtitle = '', actions = '' } = {}) {
  const crumbs = breadcrumbs.map((c, i) => {
    const sep = i < breadcrumbs.length - 1 ? '<span class="sep">/</span>' : '';
    return `<span>${escapeHtml(c)}</span>${sep}`;
  }).join('');
  return `
    <div class="page-head">
      <div class="breadcrumbs">${crumbs}</div>
      <div class="page-title-row">
        <div>
          <h1 class="page-title">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ''}
      </div>
    </div>
  `;
}
