import { renderPageHeader } from '../../layout/page-header.js';
import { adminApi } from '../../services/admin-api.js';
import { table, statusBadge, badge } from '../../components/ui.js';
import { formatDateTime, escapeHtml } from '../../core/formatters.js';
import { confirmDialog } from '../../components/overlays/modal.js';
import { showToast } from '../../components/feedback/toast.js';

export function renderMaintenancePage() { return '<div id="maintenance-root"></div>'; }

renderMaintenancePage.mount = async (root) => {
  const target = root.querySelector('#maintenance-root') || root;
  let state = null;
  function render() {
    const c = (state && state.current) || { mode:'off', message:'', adminBypass:true };
    const history = (state && state.history) || [];
    const cols = [
      { label:'Event', render:r=>`<div class="cell-main">${escapeHtml(r.type||'update')}</div><div class="cell-sub mono">${escapeHtml(r.id||'')}</div>` },
      { label:'Time', render:r=>formatDateTime(r.at) },
      { label:'Actor', render:r=>escapeHtml(r.actor||'—') },
      { label:'Mode/After', render:r=>escapeHtml((r.after && (r.after.mode||r.after.id)) || JSON.stringify(r.after||'—').slice(0,60)) }
    ];
    target.innerHTML = `
      ${renderPageHeader({ breadcrumbs:['Super Admin','Maintenance Control'], title:'Maintenance Control', subtitle:'Live, backend-enforced maintenance state with audited changes.', actions:`<select class="select" id="mntMode"><option value="off" ${c.mode==='off'?'selected':''}>Off</option><option value="scheduled" ${c.mode==='scheduled'?'selected':''}>Scheduled</option><option value="active" ${c.mode==='active'?'selected':''}>Active</option><option value="emergency" ${c.mode==='emergency'?'selected':''}>Emergency</option></select><button class="btn btn-primary" id="applyMnt">Apply</button>` })}
      <div class="banner banner-info notice-inline"><div><div class="banner-title">Live maintenance control</div><div class="banner-text">State is read/written via server APIs; changes are audited. Enforcement for POS traffic is additive and must preserve webhooks/critical allowlists.</div></div></div>
      <div class="grid grid-3 section">
        <div class="card stat-card"><div class="stat-label">Current mode</div><div class="stat-value">${escapeHtml(String(c.mode||'off'))}</div><div class="stat-meta">${badge('Admin bypass: ' + (c.adminBypass!==false?'On':'Off'), c.adminBypass!==false?'success':'warning')}</div></div>
        <div class="card stat-card"><div class="stat-label">Message</div><div class="stat-value" style="font-size:15px">${escapeHtml(c.message||'—')}</div><div class="stat-meta">Customer-facing notice</div></div>
        <div class="card stat-card"><div class="stat-label">Schedule</div><div class="stat-value" style="font-size:15px">${state && state.schedule ? escapeHtml((state.schedule.startsAt||'')+' → '+(state.schedule.endsAt||'')) : '—'}</div><div class="stat-meta">Configured window</div></div>
      </div>
      <div class="card section"><div class="card-head"><div><h3 class="card-title">Maintenance configuration</h3><p class="card-sub">Permission-gated and audited.</p></div>${statusBadge(c.mode==='off'?'Active':'Warning')}</div>
        <div class="card-body"><div class="form-grid">
          <div class="field"><label>Mode</label><select class="select" id="cfgMode"><option value="off" ${c.mode==='off'?'selected':''}>Off</option><option value="scheduled" ${c.mode==='scheduled'?'selected':''}>Scheduled</option><option value="active" ${c.mode==='active'?'selected':''}>Active</option><option value="emergency" ${c.mode==='emergency'?'selected':''}>Emergency</option></select></div>
          <div class="field"><label>Admin bypass</label><select class="select" id="cfgBypass"><option value="true" ${c.adminBypass!==false?'selected':''}>Enabled</option><option value="false" ${c.adminBypass===false?'selected':''}>Disabled</option></select></div>
          <div class="field span-2"><label>Customer message</label><textarea class="input" id="cfgMsg">${escapeHtml(c.message||'')}</textarea></div>
        </div><div class="row gap-2" style="margin-top:12px"><button class="btn btn-primary" id="saveCfg">Save configuration</button><button class="btn btn-danger" id="emergencyBtn">Trigger emergency</button></div></div>
      </div>
      <div class="card section"><div class="card-head"><div><h3 class="card-title">Maintenance history</h3><p class="card-sub">Recent audited changes/windows.</p></div></div>${history.length?table({columns:cols, rows:history.slice(0,20), minWidth:800}):'<div class="card-body"><div class="state"><div class="state-title">No history yet</div></div></div>'}</div>
    `;
    bind();
  }
  async function load() {
    try { const r = await adminApi.maintenance(); state = r.state || r; } catch(e){ state = { current:{mode:'off'}, history:[], error:e.message }; }
    render();
  }
  function bind() {
    target.querySelector('#applyMnt')?.addEventListener('click', async ()=>{ const mode = target.querySelector('#mntMode').value; try{ await adminApi.maintenanceUpdate({ mode }); showToast({title:'Updated', message:`Maintenance mode set to ${mode}.`, tone:'success'}); await load(); } catch(e){ showToast({title:'Failed', message:e.message||'Update failed', tone:'danger'});} });
    target.querySelector('#saveCfg')?.addEventListener('click', async ()=>{ try{ await adminApi.maintenanceUpdate({ mode: target.querySelector('#cfgMode').value, adminBypass: target.querySelector('#cfgBypass').value === 'true', message: target.querySelector('#cfgMsg').value }); showToast({title:'Saved', message:'Configuration saved (audited).', tone:'success'}); await load(); } catch(e){ showToast({title:'Failed', message:e.message||'Save failed', tone:'danger'});} });
    target.querySelector('#emergencyBtn')?.addEventListener('click', ()=> confirmDialog({title:'Enable emergency maintenance?', message:'Activates emergency mode (server-enforced, audited). Ensure allowlists/bypass policies remain correct.', confirmText:'Enable emergency', danger:true, onConfirm: async ()=>{ try{ await adminApi.maintenanceUpdate({ mode:'emergency', message: target.querySelector('#cfgMsg').value || 'Emergency maintenance in progress.' }); showToast({title:'Emergency enabled', message:'Maintenance mode set to emergency.', tone:'danger'}); await load(); } catch(e){ showToast({title:'Failed', message:e.message||'Failed', tone:'danger'});} }}));
  }
  await load();
};
export const mount = renderMaintenancePage.mount;
export default { render: renderMaintenancePage, mount: renderMaintenancePage.mount };
