import { createModule } from '../module-factory.js';
import { badge, statusBadge } from '../../components/ui.js';
import { formatDateTime, escapeHtml } from '../../core/formatters.js';
import { adminApi } from '../../services/admin-api.js';
import { openModal } from '../../components/overlays/modal.js';

const mod = createModule({
  breadcrumbs:['Super Admin','Notification Management'], title:'Notification Management',
  subtitle:'In-app notification store (live/connected). Persistent store and delivery pipeline can be added additively.',
  searchPlaceholder:'Search title, category, audience...', searchKeys:['id','title','category','audience','status','channel'],
  load: () => adminApi.notifications(),
  kpis:(rows)=>[
    {label:'Total',value:String(rows.length),meta:'Live'},
    {label:'Published',value:String(rows.filter(r=>r.status==='Published'||r.status==='published').length),meta:'Live'},
    {label:'Scheduled',value:String(rows.filter(r=>r.status==='Scheduled'||r.status==='scheduled').length),meta:'Live'},
    {label:'Store',value: rows.length ? 'Active' : 'Empty', meta:'Integration'}
  ],
  filters:[],
  table:{searchKeys:['id','title','category','audience','status','channel'], sortGetters:{delivered:r=>Number(r.delivered||0)}},
  columns:[
    {label:'Notification',render:r=>`<div class="cell-main">${escapeHtml(r.title||r.id||'—')}</div><div class="cell-sub mono">${escapeHtml(r.id||'—')} • ${escapeHtml(r.channel||'in-app')}</div>`},
    {label:'Category',render:r=>badge(r.category||'—','info')},
    {label:'Audience',render:r=>escapeHtml(r.audience||'—')},
    {label:'Status',sortKey:'status',render:r=>statusBadge(String(r.status||'—'))},
    {label:'Delivery / Read',sortKey:'delivered',render:r=>`<div>${Number(r.delivered||0).toLocaleString('en-IN')} delivered</div><div class="cell-sub">${Number(r.read||0).toLocaleString('en-IN')} read</div>`},
    {label:'Actions',render:r=>`<div class="table-actions"><button class="btn btn-sm" data-action="view" data-id="${r.id}">View</button></div>`}
  ],
  minWidth:1000, tableTitle:'Notification history', tableSubtitle:'Connected endpoint; returns empty until notification persistence is provisioned.',
  actions:()=>``,
  onAction:(action,id,ctx)=>{ const row=ctx.getData().find(x=>x.id===id); if(action==='view'&&row) openModal({title:row.title||row.id, subtitle:String(row.channel||'in-app'), body:`<p style="margin:0;color:var(--text-secondary)">${escapeHtml(JSON.stringify(row.raw||row))}</p>`, footer:`<button class="btn" data-modal-close>Close</button>`}); }
});
export function renderNotificationsPage(){return mod.render();}
renderNotificationsPage.mount=mod.mount; export const mount=mod.mount; export default mod;
