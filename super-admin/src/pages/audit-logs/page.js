import { createModule } from '../module-factory.js';
import { badge } from '../../components/ui.js';
import { formatDateTime, escapeHtml } from '../../core/formatters.js';
import { adminApi } from '../../services/admin-api.js';
import { openModal } from '../../components/overlays/modal.js';
import { showToast } from '../../components/feedback/toast.js';

function mapAudit(e) {
  return {
    id: e.id,
    time: e.occurredAt || e.time || null,
    actor: e.actorEmail || e.actorAdminId || e.actor || '—',
    actorRole: e.actorRole || '',
    action: e.action || '—',
    entity: e.entityLabel || (e.entityType ? (e.entityType + (e.entityId?(':'+e.entityId):'')) : '—'),
    before: e.before == null ? '—' : (typeof e.before === 'string' ? e.before : JSON.stringify(e.before)),
    after: e.after == null ? '—' : (typeof e.after === 'string' ? e.after : JSON.stringify(e.after)),
    ip: e.ip || '—',
    severity: e.severity || 'info',
    raw: e
  };
}

const mod = createModule({
  breadcrumbs:['Super Admin','Audit Logs & Activity History'], title:'Audit Logs',
  subtitle:'Protected, append-oriented history of administrative actions and security-relevant events (live).',
  searchPlaceholder:'Search actor, action, entity...', searchKeys:['id','actor','action','entity','before','after','ip'],
  load: async () => { const r = await adminApi.audit({ limit: 200 }); return { items: (r.items||[]).map(mapAudit), meta: r.meta, total: r.total }; },
  kpis:(rows)=>[
    {label:'Events loaded',value:String(rows.length),meta:'Live'},
    {label:'Source',value:'Audit store',meta:'Append-only', small:true},
    {label:'Integrity',value:'Protected',meta:'Server-side', small:true},
    {label:'Export',value:'Gated',meta:'Permission required', small:true}
  ],
  filters:[],
  table:{searchKeys:['id','actor','action','entity','before','after','ip'], sortGetters:{time:r=>r.time?new Date(r.time).getTime():0}},
  columns:[
    {label:'Time',sortKey:'time',render:r=>r.time?formatDateTime(r.time):'—'},
    {label:'Actor',render:r=>`<div class="cell-main">${escapeHtml(r.actor)}</div><div class="cell-sub">${escapeHtml(r.actorRole||'')} ${r.ip&&r.ip!=='—' ? '• IP: '+escapeHtml(r.ip):''}</div>`},
    {label:'Action',render:r=>`<span class="mono text-xs">${escapeHtml(r.action)}</span>`},
    {label:'Entity',render:r=>escapeHtml(r.entity)},
    {label:'Severity',render:r=>badge(String(r.severity||'info'), r.severity==='critical'?'danger':r.severity==='warning'?'warning':'neutral')},
    {label:'Details',render:r=>`<button class="btn btn-sm" data-action="view" data-id="${r.id}">View</button>`}
  ],
  defaultSortKey:'time', defaultSortDir:'desc', minWidth:1050,
  tableTitle:'Activity log explorer', tableSubtitle:'Live audit events from super-admin audit store.', tableBadge:{label:'Live',tone:'success'},
  actions:()=>`<button class="btn" data-action="export">Export (permission-gated)</button>`,
  detail:(r)=>`<div class="card section"><div class="card-head"><div><h3 class="card-title">Audit event ${escapeHtml(r.id)}</h3><p class="card-sub mono">${escapeHtml(r.action)}</p></div>${badge('Protected record','warning')}</div><div class="card-body"><div class="grid grid-2"><div class="mini-metric"><div class="label">Actor</div><div class="value" style="font-size:14px">${escapeHtml(r.actor)}</div><div class="cell-sub">${escapeHtml(r.actorRole||'')} • IP: ${escapeHtml(r.ip)}</div></div><div class="mini-metric"><div class="label">Time</div><div class="value" style="font-size:14px">${r.time?formatDateTime(r.time):'—'}</div></div><div class="mini-metric"><div class="label">Entity</div><div class="value" style="font-size:14px">${escapeHtml(r.entity)}</div></div><div class="mini-metric"><div class="label">Severity</div><div class="value" style="font-size:14px">${escapeHtml(String(r.severity))}</div></div></div><div class="divider"></div><div class="grid grid-2"><div class="mini-metric"><div class="label">Before</div><div class="cell-sub" style="white-space:pre-wrap;word-break:break-word">${escapeHtml(String(r.before))}</div></div><div class="mini-metric"><div class="label">After</div><div class="cell-sub" style="white-space:pre-wrap;word-break:break-word">${escapeHtml(String(r.after))}</div></div></div></div></div>`,
  onAction:(action,id,ctx)=>{ const row=ctx.getData().find(x=>x.id===id)||ctx.getData()[0]; if(!row) return; if(action==='view') openModal({title:`Audit ${row.id}`, subtitle:row.action, body:`<div class="grid grid-2">${[['Time',row.time?formatDateTime(row.time):'—'],['Actor',row.actor],['Role',row.actorRole||'—'],['Entity',row.entity],['IP',row.ip],['Severity',String(row.severity)]].map(([k,v])=>`<div class="mini-metric"><div class="label">${escapeHtml(k)}</div><div class="value" style="font-size:14px">${escapeHtml(String(v))}</div></div>`).join('')}</div><div class="divider"></div><div class="field"><label>Before</label><pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px">${escapeHtml(String(row.before))}</pre></div><div class="field"><label>After</label><pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px">${escapeHtml(String(row.after))}</pre></div>`, footer:`<button class="btn" data-modal-close>Close</button>`}); else if(action==='export') showToast({title:'Export',message:'Audit export is permission-gated and audited (additive endpoint).',tone:'info'}); }
});
export function renderAuditLogsPage(){return mod.render();}
renderAuditLogsPage.mount=mod.mount; export const mount=mod.mount; export default mod;
