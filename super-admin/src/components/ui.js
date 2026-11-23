import { escapeHtml } from '../core/formatters.js';

export function badge(label, tone = 'neutral') {
  const cls = {
    success: 'badge-success', warning: 'badge-warning', danger: 'badge-danger',
    info: 'badge-info', neutral: 'badge-neutral', brand: 'badge-brand'
  }[tone] || 'badge-neutral';
  return `<span class="badge ${cls}"><span class="dot"></span>${escapeHtml(label)}</span>`;
}

export function statusBadge(status) {
  const s = String(status || '').toLowerCase();
  if (['active', 'success', 'healthy', 'connected', 'completed', 'published', 'paid', 'resolved', 'closed'].includes(s)) return badge(status, 'success');
  if (['trial', 'pending', 'scheduled', 'in progress', 'waiting for customer', 'degraded', 'investigating', 'invited'].includes(s)) return badge(status, 'warning');
  if (['suspended', 'blocked', 'failed', 'expired', 'cancelled', 'critical', 'open'].includes(s)) return badge(status, 'danger');
  if (['draft', 'free', 'refunded'].includes(s)) return badge(status, 'info');
  return badge(status || 'Unknown', 'neutral');
}

export function table({ columns = [], rows = [], minWidth = 720, empty = 'No records found.' }) {
  const head = columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.length ? rows.map(r => `<tr>${columns.map(c => `<td>${typeof c.render === 'function' ? c.render(r) : escapeHtml(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}"><div class="state"><div class="state-title">No data</div><div class="state-text">${escapeHtml(empty)}</div></div></td></tr>`;
  return `
    <div class="table-wrap">
      <table class="table" style="min-width:${minWidth}px">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

export function filterBar(filtersHtml = '', rightHtml = '') {
  return `<div class="row-between" style="gap:12px;flex-wrap:wrap;margin-bottom:12px">
    <div class="filter-bar" style="margin-bottom:0">${filtersHtml}</div>
    <div class="row gap-2" style="flex-wrap:wrap">${rightHtml}</div>
  </div>`;
}

export function pagination(total = 0, page = 1, pageSize = 10) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
  return `<div class="pagination">
    <div>Showing <strong>${total ? 1 : 0}-${Math.min(page * pageSize, total)}</strong> of <strong>${total}</strong> (sample)</div>
    <div class="page-controls">
      <button class="btn btn-sm" disabled>Previous</button>
      <span class="tag">Page ${page} / ${pages}</span>
      <button class="btn btn-sm" disabled>Next</button>
    </div>
  </div>`;
}

export function cardSection(title, subtitle, bodyHtml, actions = '', foot = '') {
  return `<div class="card section">
    <div class="card-head"><div><h3 class="card-title">${escapeHtml(title)}</h3>${subtitle ? `<p class="card-sub">${escapeHtml(subtitle)}</p>` : ''}</div>${actions ? `<div class="row gap-2">${actions}</div>` : ''}</div>
    <div class="card-body">${bodyHtml}</div>
    ${foot ? `<div class="card-foot">${foot}</div>` : ''}
  </div>`;
}
