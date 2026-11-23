import { createModule } from '../module-factory.js';
import { badge, statusBadge } from '../../components/ui.js';
import { formatDateTime, escapeHtml } from '../../core/formatters.js';
import { adminApi } from '../../services/admin-api.js';
import { openModal } from '../../components/overlays/modal.js';
import { showToast } from '../../components/feedback/toast.js';

function mapAnn(a) {
  return {
    id: a.id,
    title: a.title || '(untitled)',
    category: a.category || 'General Announcement',
    audience: a.audienceType === 'all' ? 'All users' : (a.audienceType || '—'),
    status: a.status || 'draft',
    publishAt: a.publishAt || a.createdAt || null,
    expiresAt: a.expiresAt || null,
    delivery: a.delivery || 0,
    read: a.read || 0,
    readRate: a.readRate || '0%',
    body: a.body || '',
    raw: a
  };
}

const mod = createModule({
  breadcrumbs:['Super Admin','Communication Center'], title:'Communication Center',
  subtitle:'Live announcements store (additive). Publishing/delivery to POS is integrated additively and audited.',
  searchPlaceholder:'Search title, category, audience...', searchKeys:['id','title','category','audience','status'],
  load: async () => { const r = await adminApi.announcements(); return { items: (r.items||[]).map(mapAnn), meta: r.meta, total: r.total }; },
  kpis:(rows)=>[
    {label:'Total',value:String(rows.length),meta:'Live'},
    {label:'Published',value:String(rows.filter(r=>r.status==='published').length),meta:'Live'},
    {label:'Draft/Scheduled',value:String(rows.filter(r=>['draft','scheduled'].includes(r.status)).length),meta:'Live'},
    {label:'Archived',value:String(rows.filter(r=>r.status==='archived').length),meta:'Live'}
  ],
  filters:[{key:'status',allLabel:'All statuses',options:['draft','scheduled','published','expired','archived'].map(s=>({value:s,label:s}))}],
  table:{searchKeys:['id','title','category','audience','status'], sortGetters:{publishAt:r=>r.publishAt?new Date(r.publishAt).getTime():0}},
  columns:[
    {label:'Announcement',sortKey:'title',render:r=>`<div class="cell-main">${escapeHtml(r.title)}</div><div class="cell-sub mono">${escapeHtml(r.id)}</div>`},
    {label:'Category',render:r=>badge(r.category, String(r.category).includes('Emergency')?'danger':String(r.category).includes('Maintenance')?'warning':'info')},
    {label:'Audience',render:r=>escapeHtml(String(r.audience))},
    {label:'Status',sortKey:'status',render:r=>statusBadge(String(r.status).replace(/^./,c=>c.toUpperCase()))},
    {label:'Publish / Expiry',sortKey:'publishAt',render:r=>`<div>${r.publishAt?formatDateTime(r.publishAt):'—'}</div><div class="cell-sub">${r.expiresAt?formatDateTime(r.expiresAt):'—'}</div>`},
    {label:'Actions',render:r=>`<div class="table-actions"><button class="btn btn-sm" data-action="view" data-id="${r.id}">View</button><button class="btn btn-sm" data-action="publish" data-id="${r.id}" ${r.status==='published'?'disabled':''}>Publish</button></div>`}
  ],
  defaultSortKey:'publishAt', defaultSortDir:'desc', minWidth:1050,
  tableTitle:'Announcements', tableSubtitle:'Live announcement records from additive admin store.',
  actions:()=>`<button class="btn btn-primary" data-action="create">Create announcement</button>`,
  detail:(r)=>`<div class="card section"><div class="card-head"><div><h3 class="card-title">${escapeHtml(r.title)}</h3><p class="card-sub">${escapeHtml(r.category)} • ${escapeHtml(String(r.audience))}</p></div>${statusBadge(String(r.status).replace(/^./,c=>c.toUpperCase()))}</div>
    <div class="card-body"><div class="mini-metric"><div class="label">Body</div><div class="cell-sub" style="white-space:pre-wrap">${escapeHtml(r.body||'—')}</div></div></div></div>`,
  onAction:(action,id,ctx)=>{
    const row=ctx.getData().find(x=>x.id===id);
    if (action==='create' || action==='view') {
      openModal({
        title: action==='create' ? 'Create announcement' : (row?.title||'Announcement'),
        subtitle: action==='create' ? 'Creates draft in live store (audited).' : `${row?.id||''} • ${row?.status||''}`,
        body: action==='create' ? `<div class="form-grid"><div class="field span-2"><label>Title</label><input class="input" id="anTitle"/></div><div class="field"><label>Category</label><select class="select" id="anCat"><option>General Announcement</option><option>New Feature Update</option><option>Scheduled Maintenance</option><option>Important Update</option><option>Emergency Alert</option><option>Payment-related Announcement</option></select></div><div class="field"><label>Audience</label><select class="select" id="anAud"><option value="all">All users</option><option value="free">Free plan users</option><option value="paid">Paid plan users</option></select></div><div class="field span-2"><label>Message</label><textarea class="input" id="anBody"></textarea></div></div><div id="anErr" class="banner banner-warn" style="display:none;margin-top:10px"><div><div class="banner-text"></div></div></div>` : `<div class="mini-metric"><div class="label">Body</div><div class="cell-sub" style="white-space:pre-wrap">${escapeHtml(row?.body||'—')}</div></div>`,
        footer: action==='create' ? `<button class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" id="saveAnn">Save draft</button>` : `<button class="btn" data-modal-close>Close</button>`
      });
      if (action==='create') setTimeout(()=>{ const b=document.getElementById('saveAnn'); if(b) b.onclick=async()=>{ b.disabled=true; try{ await adminApi.createAnnouncement({ title: document.getElementById('anTitle').value, category: document.getElementById('anCat').value, audienceType: document.getElementById('anAud').value, body: document.getElementById('anBody').value, status:'draft' }); showToast({title:'Created',message:'Announcement draft saved (audited).',tone:'success'}); document.querySelector('[data-modal-close]')?.click(); ctx.reload&&ctx.reload(); } catch(e){ const el=document.getElementById('anErr'); if(el){el.style.display='flex'; el.querySelector('.banner-text').textContent=e.message||'Failed';} } finally{b.disabled=false;} }; },0);
    } else if (action==='publish' && row) {
      adminApi.publishAnnouncement(row.id).then(()=>{ showToast({title:'Published',message:'Announcement published (audited).',tone:'success'}); ctx.reload&&ctx.reload(); }).catch(e=>showToast({title:'Failed',message:e.message||'Publish failed',tone:'danger'}));
    }
  }
});
export function renderCommunicationPage(){return mod.render();}
renderCommunicationPage.mount=mod.mount; export const mount=mod.mount; export default mod;
