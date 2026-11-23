import { renderPageHeader } from '../layout/page-header.js';
import { sampleDataBanner } from '../components/display/sample-banner.js';
import { badge } from '../components/ui.js';
import { applyTableState } from '../core/table-controller.js';
import { openModal, confirmDialog } from '../components/overlays/modal.js';
import { showToast } from '../components/feedback/toast.js';
import { escapeHtml } from '../core/formatters.js';

export function createModule(config) {
  const state = {
    search: '', filters: {}, sortKey: config.defaultSortKey || '', sortDir: config.defaultSortDir || 'asc', page: 1, pageSize: config.pageSize || 10,
    selectedId: null, data: Array.isArray(config.data) ? config.data : (typeof config.data === 'function' ? [] : []),
    loading: !!config.load, error: null, meta: config.meta || { mode: Array.isArray(config.data) ? 'sample' : 'live' }
  };

  function getData() { return Array.isArray(state.data) ? state.data : (Array.isArray(config.data) ? config.data : []); }

  function renderControls() {
    const search = config.searchKeys ? `<input class="input search" data-role="search" placeholder="${escapeHtml(config.searchPlaceholder || 'Search...')}" value="${escapeHtml(state.search)}" />` : '';
    const filters = (config.filters || []).map(f => {
      const opts = [`<option value="all">${escapeHtml(f.allLabel || 'All')}</option>`]
        .concat((f.options || []).map(o => `<option value="${escapeHtml(o.value)}" ${state.filters[f.key] === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)).join('');
      return `<select class="select" data-role="filter" data-key="${escapeHtml(f.key)}">${opts}</select>`;
    }).join('');
    return `<div class="row-between" style="gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div class="filter-bar" style="margin-bottom:0">${search}${filters}</div>
      <div class="row gap-2" style="flex-wrap:wrap">${config.headerControls ? config.headerControls(state) : ''}<span class="tag" data-role="count"></span></div>
    </div>`;
  }

  function modeBanner() {
    const mode = state.meta?.source || state.meta?.mode || (config.load ? 'live' : 'sample');
    if (mode === 'sample') return sampleDataBanner(config.sampleNote || 'Records shown are sample data.');
    const partial = state.meta?.partial || state.meta?.source === 'pending_step7' || state.meta?.source === 'supabase_pending';
    const label = partial ? 'Partial / integration data' : 'Live data';
    const tone = partial ? 'banner-warn' : 'banner-info';
    const note = state.meta?.note || (partial ? 'Connected to available backend sources; some fields/modules are pending full Supabase aggregation (STEP 7 follow-up).' : 'Connected to backend APIs.');
    return `<div class="banner ${tone} notice-inline" role="status"><div><div class="banner-title">${label}</div><div class="banner-text">${escapeHtml(note)} Source: <span class="mono">${escapeHtml(String(state.meta?.source || 'api'))}</span></div></div><span class="badge ${partial?'badge-warning':'badge-success'}"><span class="dot"></span>${partial?'Partial':'Live'}</span></div>`;
  }

  function renderKpis() {
    if (!config.kpis) return '';
    const items = typeof config.kpis === 'function' ? config.kpis(getData(), state) : config.kpis;
    if (!items || !items.length) return '';
    return `<div class="grid grid-4 section">${items.map(k => `
      <div class="card stat-card"><div class="stat-label">${escapeHtml(k.label)}</div><div class="stat-value" style="${k.small?'font-size:20px':''}">${escapeHtml(String(k.value ?? '—'))}</div><div class="stat-meta">${escapeHtml(k.meta || (state.meta?.source ? state.meta.source : ''))}</div></div>
    `).join('')}</div>`;
  }

  function renderTableArea(root) {
    if (state.loading) return `<div class="state"><div class="state-title">Loading data…</div><div class="state-text">Fetching from backend API.</div></div>`;
    if (state.error) return `<div class="state state-error"><div class="state-icon">!</div><div class="state-title">Unable to load data</div><div class="state-text">${escapeHtml(state.error)}</div><div style="margin-top:12px"><button class="btn btn-sm" data-action="retry-load">Retry</button></div></div>`;
    const computed = applyTableState(getData(), state, config.table || {});
    const countEl = root.querySelector('[data-role="count"]');
    if (countEl) countEl.textContent = `${computed.total} records`;
    const thead = (config.columns || []).map(c => {
      const sortable = c.sortKey ? 'sortable' : '';
      return `<th class="${sortable}" data-sort="${escapeHtml(c.sortKey || '')}">${escapeHtml(c.label)}${state.sortKey===c.sortKey ? (state.sortDir==='asc'?' ↑':' ↓') : (c.sortKey?' ↕':'')}</th>`;
    }).join('');
    const rows = computed.rows.map(r => ({ ...r, __id: config.rowId ? config.rowId(r) : r.id }));
    const tbody = rows.length ? rows.map(r => {
      const id = escapeHtml(r.__id ?? '');
      return `<tr class="row-clickable" data-id="${id}">${(config.columns || []).map(c => `<td>${typeof c.render === 'function' ? c.render(r) : escapeHtml(r[c.key] ?? '—')}</td>`).join('')}</tr>`;
    }).join('') : `<tr><td colspan="${(config.columns||[]).length}"><div class="state"><div class="state-title">No records found</div><div class="state-text">${state.meta?.source === 'supabase_pending' || state.meta?.source === 'pending_step7' ? 'No data available from this integration source yet.' : 'Try adjusting search or filters.'}</div></div></td></tr>`;
    const pages = Math.max(1, computed.pages);
    const mode = state.meta?.source || (config.load ? 'live' : 'sample');
    return `
      <div class="table-wrap"><table class="table" style="min-width:${config.minWidth || 1000}px"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>
      <div class="pagination">
        <div>Showing <strong>${computed.total ? ((computed.page-1)*computed.pageSize + 1) : 0}-${Math.min(computed.page*computed.pageSize, computed.total)}</strong> of <strong>${computed.total}</strong> <span class="tag">${escapeHtml(String(mode))}</span></div>
        <div class="page-controls">
          <button class="btn btn-sm" data-page="prev" ${computed.page<=1?'disabled':''}>Previous</button>
          <span class="tag">Page ${computed.page} / ${pages}</span>
          <button class="btn btn-sm" data-page="next" ${computed.page>=pages?'disabled':''}>Next</button>
        </div>
      </div>`;
  }

  function renderDetail(root) {
    const data = getData();
    const id = state.selectedId || (data[0] && (config.rowId ? config.rowId(data[0]) : data[0].id));
    const row = data.find(r => (config.rowId ? config.rowId(r) : r.id) == id) || data[0];
    if (!row || !config.detail) return '';
    return config.detail(row);
  }

  function html() {
    const actions = config.actions ? config.actions() : '';
    const badgeInfo = config.tableBadge || (config.load ? { label: 'Live API', tone: 'success' } : { label: 'Sample', tone: 'info' });
    return `
      ${renderPageHeader({ breadcrumbs: config.breadcrumbs, title: config.title, subtitle: config.subtitle, actions })}
      ${modeBanner()}
      ${renderKpis()}
      <div class="card section" data-module="table-card">
        <div class="card-head"><div><h3 class="card-title">${escapeHtml(config.tableTitle || config.title)}</h3>${config.tableSubtitle ? `<p class="card-sub">${escapeHtml(config.tableSubtitle)}</p>` : ''}</div>${badge(badgeInfo.label, badgeInfo.tone)}</div>
        <div class="card-body" style="padding-bottom:0" data-role="controls">${renderControls()}</div>
        <div data-role="table-area"></div>
      </div>
      <div data-role="detail-area"></div>
      ${config.extra ? config.extra() : ''}
    `;
  }

  function mount(root) {
    const tableArea = root.querySelector('[data-role="table-area"]');
    const detailArea = root.querySelector('[data-role="detail-area"]');
    const controls = root.querySelector('[data-role="controls"]');

    function rerenderTable() {
      if (tableArea) tableArea.innerHTML = renderTableArea(root);
      bindTableEvents();
    }
    function rerenderDetail() {
      if (detailArea) detailArea.innerHTML = renderDetail(root);
      bindDetailEvents();
    }
    function rerenderControls() {
      if (controls) controls.innerHTML = renderControls();
      bindControlEvents();
    }

    function bindControlEvents() {
      const search = root.querySelector('[data-role="search"]');
      if (search) search.addEventListener('input', (e) => { state.search = e.target.value; state.page = 1; rerenderTable(); });
      root.querySelectorAll('[data-role="filter"]').forEach(sel => sel.addEventListener('change', (e) => {
        state.filters[e.target.dataset.key] = e.target.value; state.page = 1; rerenderTable(); rerenderDetail();
      }));
      root.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id, root)));
    }

    function bindTableEvents() {
      root.querySelectorAll('th.sortable[data-sort]').forEach(th => th.addEventListener('click', () => {
        const key = th.dataset.sort; if (!key) return;
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortKey = key; state.sortDir = 'asc'; }
        rerenderTable();
      }));
      root.querySelectorAll('tr.row-clickable[data-id]').forEach(tr => tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        state.selectedId = tr.dataset.id; rerenderDetail();
        root.querySelectorAll('tr.row-clickable').forEach(x => x.style.background = '');
        tr.style.background = 'var(--bg-active)';
      }));
      root.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => {
        const computed = applyTableState(getData(), state, config.table || {});
        if (btn.dataset.page === 'prev' && state.page > 1) state.page--; 
        if (btn.dataset.page === 'next' && state.page < computed.pages) state.page++;
        rerenderTable();
      }));
      root.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation(); handleAction(btn.dataset.action, btn.dataset.id, root);
      }));
    }

    function bindDetailEvents() {
      root.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id, root)));
      root.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        root.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === tab));
        root.querySelectorAll('[data-tab-panel]').forEach(p => p.hidden = p.dataset.tabPanel !== name);
      }));
    }

    async function loadData() {
      if (!config.load) return;
      state.loading = true; state.error = null;
      rerenderTable();
      try {
        const result = await config.load();
        if (Array.isArray(result)) { state.data = result; state.meta = { mode: 'live', source: 'api' }; }
        else { state.data = result.items || result.data || []; state.meta = Object.assign({ mode: 'live', source: 'api' }, result.meta || {}); if (result.kpis) state.kpis = result.kpis; }
      } catch (e) {
        state.error = e?.message || 'Failed to load data';
      } finally {
        state.loading = false;
        rerenderControls(); rerenderTable(); rerenderDetail();
      }
    }

    function handleAction(action, id, rootEl) {
      if (action === 'retry-load') return loadData();
      if (config.onAction) return config.onAction(action, id, { state, rerenderTable, rerenderDetail, rerenderControls, root: rootEl, getData, reload: loadData });
      showToast({ title: 'Action', message: `${action} triggered for ${id || 'item'}.`, tone: 'info' });
    }

    rerenderControls(); rerenderTable(); rerenderDetail();
    loadData();
  }

  return { render: html, mount };
}
