import { createModule } from '../module-factory.js';
import { badge, statusBadge } from '../../components/ui.js';
import { formatDateTime, formatNumber, escapeHtml } from '../../core/formatters.js';
import { adminApi } from '../../services/admin-api.js';
import { openModal } from '../../components/overlays/modal.js';
import { showToast } from '../../components/feedback/toast.js';

const mod = createModule({
  breadcrumbs: ['Super Admin', 'Business Management'],
  title: 'Business Management',
  subtitle: 'Live business/account view derived from SaaS data with optional server-side Supabase enrichment (RLS-safe).',
  searchPlaceholder: 'Search business, owner, email, ID...',
  searchKeys: ['name','owner','email','id','plan','status'],
  load: () => adminApi.businesses(),
  kpis: (rows) => ([
    { label: 'Total businesses', value: String(rows.length), meta: 'Live' },
    { label: 'Active', value: String(rows.filter(r=>String(r.status).toLowerCase()==='active').length), meta: 'Current view' },
    { label: 'Paid plans', value: String(rows.filter(r=>!['free'].includes(String(r.plan))).length), meta: 'Current view' },
    { label: 'Source', value: 'SaaS + Supabase?', meta: 'Server reconciled', small: true }
  ]),
  filters: [
    { key: 'status', allLabel: 'All statuses', options: [{value:'active',label:'Active'},{value:'suspended',label:'Suspended'}] },
    { key: 'plan', allLabel: 'All plans', options: [{value:'free',label:'Free'},{value:'starter',label:'Starter'},{value:'pro',label:'Pro'}] }
  ],
  table: {
    searchKeys: ['name','owner','email','id','plan','status'],
    sortGetters: { products: r => Number(r.products||0), joined: r => r.joined?new Date(r.joined).getTime():0, name: r => r.name }
  },
  columns: [
    { label: 'Business', sortKey: 'name', render: r => `<div class="cell-main">${escapeHtml(r.name)}</div><div class="cell-sub mono">${escapeHtml(r.id)}</div>` },
    { label: 'Owner / Contact', render: r => `<div>${escapeHtml(r.owner)}</div><div class="cell-sub">${escapeHtml(r.email)}</div>` },
    { label: 'Devices / Products', sortKey: 'products', render: r => `${formatNumber(r.devices||0)} / ${formatNumber(r.products||0)}` },
    { label: 'Subscription', render: r => `${badge(String(r.plan||'free'), ['pro'].includes(String(r.plan))?'brand':'neutral')} <div class="cell-sub">${escapeHtml(String(r.subscriptionStatus||''))}</div>` },
    { label: 'Status', sortKey: 'status', render: r => statusBadge(String(r.status||'active').replace(/^./,c=>c.toUpperCase())) },
    { label: 'Joined', sortKey: 'joined', render: r => r.joined?formatDateTime(r.joined):'—' },
    { label: 'Actions', render: r => `<div class="table-actions"><button class="btn btn-sm" data-action="view" data-id="${escapeHtml(r.id)}">View</button></div>` }
  ],
  defaultSortKey: 'joined', defaultSortDir: 'desc', minWidth: 1050,
  tableTitle: 'Business directory', tableSubtitle: 'Authorized, read-only inspection by default. No tenant RLS weakened.',
  tableBadge: { label: 'Live', tone: 'success' },
  actions: () => `<button class="btn" data-action="export">Export</button>`,
  detail: (r) => `<div class="card section"><div class="card-head"><div><h3 class="card-title">Business: ${escapeHtml(r.name)}</h3><p class="card-sub mono">${escapeHtml(r.id)}</p></div>${statusBadge(String(r.status||'active').replace(/^./,c=>c.toUpperCase()))}</div>
    <div class="card-body"><div class="grid grid-3">
      <div class="mini-metric"><div class="label">Owner</div><div class="value" style="font-size:15px">${escapeHtml(r.owner)}</div><div class="cell-sub">${escapeHtml(r.email)}</div></div>
      <div class="mini-metric"><div class="label">Plan</div><div class="value" style="font-size:15px">${escapeHtml(String(r.plan))}</div><div class="cell-sub">${escapeHtml(String(r.subscriptionStatus||''))}</div></div>
      <div class="mini-metric"><div class="label">Scale</div><div class="value" style="font-size:15px">${formatNumber(r.products||0)} products</div><div class="cell-sub">${formatNumber(r.devices||0)} devices</div></div>
    </div></div></div>`,
  onAction: (action, id, ctx) => {
    const row = ctx.getData().find(x=>x.id===id) || ctx.getData()[0]; if(!row) return;
    if (action === 'view') openModal({ title: row.name, subtitle: `${row.id} • Read-only inspection`, body: `<div class="grid grid-2">${[['Owner',row.owner],['Email',row.email],['Status',String(row.status)],['Plan',String(row.plan)],['Subscription',String(row.subscriptionStatus||'—')],['Products',formatNumber(row.products||0)],['Devices',formatNumber(row.devices||0)],['Joined',row.joined?formatDateTime(row.joined):'—']].map(([k,v])=>`<div class="mini-metric"><div class="label">${escapeHtml(k)}</div><div class="value" style="font-size:14px">${escapeHtml(String(v))}</div></div>`).join('')}</div>`, footer: `<button class="btn" data-modal-close>Close</button>` });
    else showToast({ title:'Action', message:'Permission-gated server export can be added as follow-up.', tone:'info' });
  }
});
export function renderBusinessesPage(){ return mod.render(); }
renderBusinessesPage.mount = mod.mount; export const mount = mod.mount; export default mod;
