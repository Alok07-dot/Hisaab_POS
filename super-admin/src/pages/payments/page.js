import { createModule } from '../module-factory.js';
import { badge, statusBadge } from '../../components/ui.js';
import { formatDateTime, formatINR, escapeHtml } from '../../core/formatters.js';
import { adminApi } from '../../services/admin-api.js';
import { openModal } from '../../components/overlays/modal.js';
import { showToast } from '../../components/feedback/toast.js';

const mod = createModule({
  breadcrumbs:['Super Admin','Payment & Revenue Management'], title:'Payment & Revenue',
  subtitle:'Live transactions from SaaS payment store (server-verified events where applicable).',
  searchPlaceholder:'Search payment, account, gateway ref...', searchKeys:['id','customer','gatewayRef','invoice','status','gateway'],
  load: () => adminApi.payments(),
  kpis:(rows)=> {
    const success = rows.filter(r=>String(r.status).toLowerCase()==='success').length;
    const failed = rows.filter(r=>['failed','pending'].includes(String(r.status).toLowerCase())).length;
    const total = rows.reduce((s,r)=>s + (Number(r.amount)||0), 0);
    return [
      {label:'Transactions',value:String(rows.length),meta:'Live'},
      {label:'Total (visible)',value:formatINR(total),meta:'Sum of listed'},
      {label:'Successful',value:String(success),meta:'Captured/success'},
      {label:'Failed/Pending',value:String(failed),meta:'Needs review'}
    ];
  },
  filters:[{key:'status',allLabel:'All statuses',options:['Success','Failed','Pending','Refunded','created','captured'].map(s=>({value:s,label:s}))}],
  table:{searchKeys:['id','customer','gatewayRef','invoice','status','gateway'], sortGetters:{amount:r=>Number(r.amount||0), date:r=>r.date?new Date(r.date).getTime():0}},
  columns:[
    {label:'Payment / Order',sortKey:'id',render:r=>`<div class="cell-main mono">${escapeHtml(r.id)}</div><div class="cell-sub">${escapeHtml(r.invoice||'—')} • ${escapeHtml(r.type||'')}</div>`},
    {label:'Account',render:r=>`<div class="mono">${escapeHtml(r.customer)}</div><div class="cell-sub">${escapeHtml(r.business||'—')}</div>`},
    {label:'Amount',sortKey:'amount',render:r=>formatINR(r.amount||0)},
    {label:'Status',sortKey:'status',render:r=>statusBadge(String(r.status||'—'))},
    {label:'Gateway',render:r=>`<div>${escapeHtml(r.gateway||'—')}</div><div class="cell-sub mono">${escapeHtml(r.gatewayRef||'—')}</div>`},
    {label:'Verification',render:r=>badge(r.verified||'—', String(r.verified||'').includes('Webhook')?'success':'neutral')},
    {label:'Date',sortKey:'date',render:r=>r.date?formatDateTime(r.date):'—'},
    {label:'Actions',render:r=>`<div class="table-actions"><button class="btn btn-sm" data-action="view" data-id="${r.id}">View</button></div>`}
  ],
  defaultSortKey:'date', defaultSortDir:'desc', minWidth:1150,
  tableTitle:'All transactions', tableSubtitle:'Live payment records from SaaS store.', tableBadge:{label:'Live',tone:'success'},
  actions:()=>`<button class="btn" data-action="export">Export CSV</button>`,
  detail:(r)=>`<div class="card section"><div class="card-head"><div><h3 class="card-title">Transaction ${escapeHtml(r.id)}</h3><p class="card-sub">${escapeHtml(r.invoice||'—')} • ${escapeHtml(r.customer)}</p></div>${statusBadge(String(r.status||'—'))}</div>
    <div class="card-body"><div class="grid grid-3">
      <div class="mini-metric"><div class="label">Amount</div><div class="value">${formatINR(r.amount||0)}</div><div class="cell-sub">${escapeHtml(r.type||'—')}</div></div>
      <div class="mini-metric"><div class="label">Gateway</div><div class="value" style="font-size:15px">${escapeHtml(r.gateway||'—')}</div><div class="cell-sub mono">${escapeHtml(r.gatewayRef||'—')}</div></div>
      <div class="mini-metric"><div class="label">Verification</div><div class="value" style="font-size:15px">${escapeHtml(r.verified||'—')}</div><div class="cell-sub">Server-truth policy</div></div>
    </div></div></div>`,
  onAction:(action,id,ctx)=>{
    const row=ctx.getData().find(x=>x.id===id)||ctx.getData()[0]; if(!row) return;
    if(action==='view') openModal({title:`Payment ${row.id}`, subtitle:`${row.invoice||''}`, body:`<div class="grid grid-2">${[['Account',row.customer],['Amount',formatINR(row.amount||0)],['Status',String(row.status)],['Gateway',String(row.gateway||'—')],['Reference',String(row.gatewayRef||'—')],['Verification',String(row.verified||'—')],['Date',row.date?formatDateTime(row.date):'—']].map(([k,v])=>`<div class="mini-metric"><div class="label">${escapeHtml(k)}</div><div class="value" style="font-size:14px">${escapeHtml(String(v))}</div></div>`).join('')}</div>`, footer:`<button class="btn" data-modal-close>Close</button>`});
    else showToast({title:'Action', message:'Server-generated export/report can be added as follow-up.', tone:'info'});
  }
});
export function renderPaymentsPage(){return mod.render();}
renderPaymentsPage.mount=mod.mount; export const mount=mod.mount; export default mod;
