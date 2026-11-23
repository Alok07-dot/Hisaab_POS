import { renderPageHeader } from '../../layout/page-header.js';
import { formatINR, formatNumber, formatDateTime, escapeHtml } from '../../core/formatters.js';
import { adminApi } from '../../services/admin-api.js';
import { showToast } from '../../components/feedback/toast.js';
import { openModal } from '../../components/overlays/modal.js';

function kpiCard(label, value, meta, trendLabel='') {
  return `
    <div class="card stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(String(value ?? '—'))}</div>
      <div class="stat-meta">
        ${trendLabel ? `<span class="trend">${escapeHtml(trendLabel)}</span>` : ''}
        <span>${escapeHtml(meta || '')}</span>
      </div>
    </div>
  `;
}

function activityBadge(type) {
  const map = { registration: 'badge-info', subscription: 'badge-success', payment: 'badge-success', cancellation: 'badge-warning', alert: 'badge-danger' };
  const cls = map[type] || 'badge-neutral';
  const label = (type || 'event').replace(/^\w/, c => c.toUpperCase());
  return `<span class="badge ${cls}"><span class="dot"></span>${label}</span>`;
}

export function renderOverviewPage() {
  const actions = `
    <button class="btn" id="overviewRefresh">Refresh</button>
  `;
  return `
    ${renderPageHeader({ breadcrumbs: ['Super Admin', 'Overview'], title: 'Platform Overview', subtitle: 'Live platform health and business performance (aggregated from connected stores).', actions })}
    <div id="overviewBanner"></div>
    <section class="section"><div class="grid grid-4 kpi-grid" id="overviewKpis"><div class="state"><div class="state-title">Loading KPIs…</div></div></div></section>
    <section class="dashboard-grid-2">
      <div class="card chart-card"><div class="card-head"><div><h3 class="card-title">Charts & trends</h3><p class="card-sub">Time-series aggregation</p></div><span class="badge badge-warning">Partial</span></div><div class="card-body"><div class="banner banner-warn"><div><div class="banner-title">Chart series pending deeper rollups</div><div class="banner-text">Live KPIs and recent activity are connected. Historical chart series (growth/revenue/subscription trends) require additive event rollup aggregation over SaaS and Supabase data.</div></div></div></div></div>
      <div class="card"><div class="card-head"><div><h3 class="card-title">System notes</h3><p class="card-sub">Integration status</p></div></div><div class="card-body"><div class="activity-list"><div class="activity-item"><div class="activity-icon">i</div><div class="activity-main"><div class="activity-title">Live sources</div><div class="activity-meta">SaaS JSON store (accounts, subscriptions, payments, orders), additive admin stores (audit, maintenance, announcements, team), optional Supabase server-side enrichment when configured.</div></div></div><div class="activity-item"><div class="activity-icon">s</div><div class="activity-main"><div class="activity-title">Security</div><div class="activity-meta">Server-enforced RBAC, audited privileged actions, tenant RLS preserved (no client-side bypass).</div></div></div></div></div></div>
    </section>
    <section class="section">
      <div class="card">
        <div class="card-head"><div><h3 class="card-title">Recent activity</h3><p class="card-sub">Recent registrations and payment events</p></div><button class="btn btn-ghost btn-sm" id="viewAllActivity">View details</button></div>
        <div class="card-body" style="padding-top:8px"><div class="activity-list" id="overviewActivity"><div class="state"><div class="state-title">Loading activity…</div></div></div></div>
      </div>
    </section>
  `;
}

renderOverviewPage.mount = (root) => {
  async function load() {
    const banner = root.querySelector('#overviewBanner');
    const kpisEl = root.querySelector('#overviewKpis');
    const actEl = root.querySelector('#overviewActivity');
    try {
      const data = await adminApi.overview();
      const k = data.kpis || {};
      const partial = data.meta?.partial;
      banner.innerHTML = `<div class="banner ${partial?'banner-warn':'banner-info'} notice-inline"><div><div class="banner-title">${partial?'Live (partial aggregation)':'Live overview'}</div><div class="banner-text">${escapeHtml(data.meta?.note || 'KPIs and activity from connected backend stores.')} Source: <span class="mono">${escapeHtml(data.meta?.source||'api')}</span></div></div></div>`;
      const cards = [
        ['Total users', formatNumber(k.totalUsers||0), 'SaaS accounts'],
        ['Businesses', formatNumber(k.totalBusinesses||0), 'Registered'],
        ['Active paid subscriptions', formatNumber(k.activeSubscriptions||0), 'Non-free active'],
        ['Free users', formatNumber(k.freeUsers||0), 'Free tier'],
        ['Paid users', formatNumber(k.paidUsers||0), 'Active paid'],
        ['Total revenue', formatINR((Number(k.totalRevenuePaise||0))/100), 'Captured payments'],
        ['Revenue (30d)', formatINR((Number(k.revenue30dPaise||0))/100), 'Last 30 days'],
        ['New registrations (30d)', formatNumber(k.newRegistrations30d||0), 'Last 30 days'],
        ['Failed payments/orders', formatNumber(k.failedPayments||0), 'Needs review'],
        ['Total payments', formatNumber(k.totalPayments||0), 'Records'],
        ['Orders', formatNumber(k.orders||0), 'Records'],
        ['MRR / ARR', '—', 'Rollup pending']
      ];
      kpisEl.innerHTML = cards.map(c => kpiCard(c[0], c[1], c[2])).join('');
      const activity = data.activity || [];
      if (!activity.length) {
        actEl.innerHTML = `<div class="state"><div class="state-title">No recent activity</div><div class="state-text">Activity will appear as registrations and payments occur.</div></div>`;
      } else {
        actEl.innerHTML = activity.map(a => `
          <div class="activity-item">
            <div class="activity-icon">${escapeHtml((a.type||'e')[0].toUpperCase())}</div>
            <div class="activity-main">
              <div class="row gap-2" style="flex-wrap:wrap;margin-bottom:2px">
                <div class="activity-title">${escapeHtml(a.title||'Activity')}</div>
                ${activityBadge(a.type)}
              </div>
              <div class="activity-meta">${escapeHtml(a.meta||'')}</div>
            </div>
            <div class="activity-time">${a.time ? formatDateTime(a.time) : ''}</div>
          </div>`).join('');
      }
    } catch (e) {
      banner.innerHTML = `<div class="banner banner-warn notice-inline"><div><div class="banner-title">Unable to load overview</div><div class="banner-text">${escapeHtml(e.message||'Error')} ${e.status===404 ? '(Restart server to load STEP 7 routes.)' : ''}</div></div></div>`;
      kpisEl.innerHTML = ''; actEl.innerHTML = '';
    }
  }
  root.querySelector('#overviewRefresh')?.addEventListener('click', () => { showToast({title:'Refreshing', message:'Fetching latest overview.', tone:'info'}); load(); });
  root.querySelector('#viewAllActivity')?.addEventListener('click', () => openModal({ title:'Recent activity', subtitle:'Live feed from available stores', body:`<p style="margin:0;color:var(--text-secondary)">This view shows recent payment and registration events aggregated from the SaaS store. A full filterable activity feed can be added with additive audit/event endpoints.</p>`, footer:`<button class="btn" data-modal-close>Close</button>` }));
  load();
};
export const mount = renderOverviewPage.mount;
export default { render: renderOverviewPage, mount: renderOverviewPage.mount };
