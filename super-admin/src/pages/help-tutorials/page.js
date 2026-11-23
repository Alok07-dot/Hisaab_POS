import { createModule } from '../module-factory.js';
import { badge, statusBadge } from '../../components/ui.js';
import { formatDateTime, escapeHtml } from '../../core/formatters.js';
import { adminApi } from '../../services/admin-api.js';
import { openModal, closeModal, confirmDialog } from '../../components/overlays/modal.js';
import { showToast } from '../../components/feedback/toast.js';

const CATEGORIES = ['Getting Started','Products','Inventory','POS & Sales','Purchase','Customers','Suppliers','Accounting','Reports','Settings'];
const LANGUAGES = ['English','Hindi','Other'];

function extractYouTubeVideoId(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = (url.hostname || '').toLowerCase().replace(/^www\./,'').replace(/^m\./,'');
    if (host === 'youtu.be') {
      const m = (url.pathname || '').replace(/^\/+/, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(m) ? m : '';
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = (url.pathname || '').split('/').filter(Boolean);
      if (parts.length >= 2 && ['embed','shorts','v','live'].includes(parts[0]) && /^[a-zA-Z0-9_-]{11}$/.test(parts[1])) return parts[1];
    }
  } catch (e) {}
  return '';
}
function ytThumb(id) { return id ? 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg' : ''; }

function mapTut(t) {
  const status = (t.status || 'draft').toLowerCase() === 'published' ? 'Published' : 'Draft';
  return {
    id: t.id,
    title: t.title || '(untitled)',
    description: t.description || '',
    youtube_url: t.youtube_url || '',
    youtube_video_id: t.youtube_video_id || '',
    thumbnail_url: t.thumbnail_url || (t.youtube_video_id ? ytThumb(t.youtube_video_id) : ''),
    thumbnail_type: t.thumbnail_type || 'youtube',
    category: t.category || 'Getting Started',
    language: t.language || 'English',
    duration: t.duration || '',
    keywords: Array.isArray(t.keywords) ? t.keywords : [],
    status,
    rawStatus: (t.status || 'draft').toLowerCase(),
    updated: t.updated_at || t.created_at || null,
    display_order: Number(t.display_order) || 0,
    raw: t
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read image file.'));
    r.readAsDataURL(file);
  });
}

function formBody(row, mode) {
  const r = row || {};
  const isEdit = mode === 'edit';
  const vid = r.youtube_video_id || extractYouTubeVideoId(r.youtube_url || '');
  const thumbUrl = r.thumbnail_type === 'custom' && r.thumbnail_url ? r.thumbnail_url : ytThumb(vid);
  const useCustom = r.thumbnail_type === 'custom';
  const keywords = Array.isArray(r.keywords) ? r.keywords.join(', ') : (r.keywords || '');
  return `
    <div class="form-grid ht-admin-form">
      <div class="field span-2"><label>Video Title <span style="color:#dc2626">*</span></label><input class="input" id="htTitle" value="${escapeHtml(r.title||'')}" placeholder="e.g. How to Add a Product" /></div>
      <div class="field span-2"><label>Short Description</label><textarea class="input" id="htDesc" rows="2" placeholder="Brief explanation of what users will learn">${escapeHtml(r.description||'')}</textarea></div>
      <div class="field span-2"><label>YouTube Video URL <span style="color:#dc2626">*</span></label><input class="input" id="htYoutubeUrl" value="${escapeHtml(r.youtube_url||'')}" placeholder="https://www.youtube.com/watch?v=..." />
        <div class="cell-sub" style="margin-top:4px">Extracted Video ID: <strong id="htExtractedId">${escapeHtml(vid || '—')}</strong></div>
      </div>

      <div class="field span-2"><label>Thumbnail</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
          <div style="width:220px;max-width:100%">
            <div id="htThumbPreview" style="aspect-ratio:16/9;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:12px">
              ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="Thumbnail preview" style="width:100%;height:100%;object-fit:cover;display:block" />` : 'No thumbnail'}
            </div>
          </div>
          <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="radio" name="htThumbType" id="htThumbYoutube" value="youtube" ${!useCustom ? 'checked' : ''}/> Use YouTube thumbnail (auto)</label>
            <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="radio" name="htThumbType" id="htThumbCustom" value="custom" ${useCustom ? 'checked' : ''}/> Upload custom thumbnail</label>
            <div id="htCustomWrap" style="${useCustom ? '' : 'display:none'}">
              <input type="file" id="htThumbFile" class="input" accept="image/png,image/jpeg,image/webp" />
              <div class="cell-sub" style="margin-top:4px">JPG, PNG or WebP, max 2 MB. 16:9 recommended.${isEdit && r.thumbnail_type==='custom' ? ' Leave empty to keep current thumbnail.' : ''}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="field"><label>Category</label><select class="select" id="htCategory">${CATEGORIES.map(c=>`<option value="${escapeHtml(c)}" ${r.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Language</label><select class="select" id="htLanguage">${LANGUAGES.map(l=>`<option value="${escapeHtml(l)}" ${r.language===l?'selected':''}>${escapeHtml(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Duration <span class="cell-sub">(optional)</span></label><input class="input" id="htDuration" value="${escapeHtml(r.duration||'')}" placeholder="e.g. 4:32" /></div>
      <div class="field"><label>Display Order</label><input class="input" id="htOrder" type="number" value="${escapeHtml(String(r.display_order ?? 0))}" /></div>
      <div class="field span-2"><label>Search Keywords <span class="cell-sub">(comma-separated, optional)</span></label><input class="input" id="htKeywords" value="${escapeHtml(keywords)}" placeholder="e.g. add product, inventory, barcode" /></div>

      <div class="field span-2"><label>Publishing</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="radio" name="htStatus" value="draft" ${r.rawStatus==='published'?'':'checked'}/> Save as Draft</label>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="radio" name="htStatus" value="published" ${r.rawStatus==='published'?'checked':''}/> Publish Now</label>
        </div>
      </div>
    </div>
    <div id="htFormError" class="banner banner-warn" style="display:none;margin-top:12px"><div><div class="banner-text"></div></div></div>
  `;
}

function wireForm(row) {
  let customDataUrl = null;
  const urlInput = document.getElementById('htYoutubeUrl');
  const idEl = document.getElementById('htExtractedId');
  const preview = document.getElementById('htThumbPreview');
  const radYt = document.getElementById('htThumbYoutube');
  const radCustom = document.getElementById('htThumbCustom');
  const customWrap = document.getElementById('htCustomWrap');
  const fileInput = document.getElementById('htThumbFile');

  function currentThumb() {
    if (radCustom && radCustom.checked && customDataUrl) return customDataUrl;
    if (radCustom && radCustom.checked && row && row.thumbnail_type === 'custom' && row.thumbnail_url) return row.thumbnail_url;
    const vid = extractYouTubeVideoId(urlInput ? urlInput.value : '');
    return vid ? ytThumb(vid) : '';
  }
  function updatePreview() {
    if (!preview) return;
    const src = currentThumb();
    preview.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="Thumbnail preview" style="width:100%;height:100%;object-fit:cover;display:block" />` : 'No thumbnail';
    if (idEl) idEl.textContent = extractYouTubeVideoId(urlInput ? urlInput.value : '') || '—';
  }
  if (urlInput) urlInput.addEventListener('input', updatePreview);
  if (radYt) radYt.addEventListener('change', () => { if (customWrap) customWrap.style.display = 'none'; updatePreview(); });
  if (radCustom) radCustom.addEventListener('change', () => { if (customWrap) customWrap.style.display = ''; updatePreview(); });
  if (fileInput) fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) { customDataUrl = null; updatePreview(); return; }
    const okTypes = ['image/jpeg','image/png','image/webp'];
    if (!okTypes.includes(f.type)) { showToast({ title: 'Invalid image', message: 'Use JPG, PNG, or WebP.', tone: 'danger' }); fileInput.value=''; return; }
    if (f.size > 2 * 1024 * 1024) { showToast({ title: 'Image too large', message: 'Maximum size is 2 MB.', tone: 'danger' }); fileInput.value=''; return; }
    try { customDataUrl = await readFileAsDataUrl(f); updatePreview(); } catch (e) { showToast({ title: 'Upload failed', message: e.message, tone: 'danger' }); }
  });
  updatePreview();
  return {
    getPayload() {
      const status = (document.querySelector('input[name="htStatus"]:checked') || {}).value || 'draft';
      const thumbType = (radCustom && radCustom.checked) ? 'custom' : 'youtube';
      const keywords = String((document.getElementById('htKeywords')||{}).value || '').split(',').map(s=>s.trim()).filter(Boolean);
      return {
        title: (document.getElementById('htTitle')||{}).value || '',
        description: (document.getElementById('htDesc')||{}).value || '',
        youtube_url: (document.getElementById('htYoutubeUrl')||{}).value || '',
        category: (document.getElementById('htCategory')||{}).value || 'Getting Started',
        language: (document.getElementById('htLanguage')||{}).value || 'English',
        duration: (document.getElementById('htDuration')||{}).value || '',
        display_order: Number((document.getElementById('htOrder')||{}).value || 0),
        keywords,
        status,
        thumbnail_type: thumbType,
        thumbnail_data: (thumbType === 'custom' && customDataUrl) ? customDataUrl : undefined
      };
    }
  };
}

function showError(msg) {
  const el = document.getElementById('htFormError');
  if (el) { el.style.display = 'flex'; const t = el.querySelector('.banner-text'); if (t) t.textContent = msg || 'Something went wrong.'; }
}

function openFormModal(mode, row, ctx) {
  const isEdit = mode === 'edit';
  openModal({
    title: isEdit ? 'Edit Tutorial' : 'Add New Tutorial',
    subtitle: isEdit ? `Update tutorial details for "${row.title}"` : 'Add a YouTube tutorial for Hisaab POS users.',
    body: formBody(row, mode),
    footer: `<button class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" id="htSaveBtn">${isEdit ? 'Save Changes' : 'Save Tutorial'}</button>`,
    size: 'lg'
  });
  setTimeout(() => {
    const form = wireForm(row);
    const btn = document.getElementById('htSaveBtn');
    if (!btn) return;
    btn.onclick = async () => {
      const payload = form.getPayload();
      if (!String(payload.title).trim()) return showError('Video title is required.');
      if (!String(payload.youtube_url).trim()) return showError('YouTube video URL is required.');
      if (!extractYouTubeVideoId(payload.youtube_url)) return showError('Please enter a valid YouTube video URL.');
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        if (isEdit) await adminApi.updateHelpTutorial(row.id, payload);
        else await adminApi.createHelpTutorial(payload);
        showToast({ title: isEdit ? 'Tutorial updated' : 'Tutorial saved', message: payload.status === 'published' ? 'Tutorial is published and visible to users.' : 'Tutorial saved as draft.', tone: 'success' });
        closeModal();
        if (ctx && ctx.reload) ctx.reload();
      } catch (e) { showError(e.message || 'Could not save tutorial.'); }
      finally { btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Save Tutorial'; }
    };
  }, 0);
}

function openPreviewModal(row) {
  const vid = row.youtube_video_id || extractYouTubeVideoId(row.youtube_url);
  const thumb = row.thumbnail_url || ytThumb(vid);
  openModal({
    title: row.title || 'Preview Tutorial',
    subtitle: `${row.category || ''}${row.language ? ' • ' + row.language : ''}${row.duration ? ' • ' + row.duration : ''}`,
    body: `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${vid ? `<div style="aspect-ratio:16/9;background:#111827;border-radius:12px;overflow:hidden"><iframe src="https://www.youtube.com/embed/${encodeURIComponent(vid)}" title="${escapeHtml(row.title||'Tutorial')}" style="width:100%;height:100%;border:0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
             : (thumb ? `<div style="aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#f3f4f6"><img src="${escapeHtml(thumb)}" alt="" style="width:100%;height:100%;object-fit:cover"/></div>` : '')}
        ${row.description ? `<p style="margin:0;font-size:14px;color:#4B5563;line-height:1.6">${escapeHtml(row.description)}</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:#6b7280"><span>Category: <strong>${escapeHtml(row.category||'—')}</strong></span><span>Language: <strong>${escapeHtml(row.language||'—')}</strong></span><span>Status: <strong>${escapeHtml(row.status||'—')}</strong></span></div>
        ${vid ? `<div><a class="btn btn-outline-purple" href="https://www.youtube.com/watch?v=${encodeURIComponent(vid)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a></div>` : ''}
      </div>
    `,
    footer: `<button class="btn" data-modal-close>Close</button>`,
    size: 'lg'
  });
}

const mod = createModule({
  breadcrumbs: ['Super Admin', 'Help & Tutorials'],
  title: 'Help & Tutorials',
  subtitle: 'Manage and publish video tutorials for Hisaab POS users.',
  searchPlaceholder: 'Search by video title...',
  searchKeys: ['title', 'description', 'category', 'language', 'youtube_video_id'],
  load: async () => {
    const r = await adminApi.helpTutorials();
    return { items: (r.items || []).map(mapTut), meta: r.meta, total: r.total };
  },
  kpis: (rows) => [
    { label: 'Total Tutorials', value: String(rows.length), meta: 'All records' },
    { label: 'Published Tutorials', value: String(rows.filter(r => r.rawStatus === 'published').length), meta: 'Visible to users' },
    { label: 'Draft/Inactive Tutorials', value: String(rows.filter(r => r.rawStatus !== 'published').length), meta: 'Not published' }
  ],
  filters: [
    { key: 'category', allLabel: 'All categories', options: CATEGORIES.map(c => ({ value: c, label: c })) },
    { key: 'rawStatus', allLabel: 'All statuses', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }] }
  ],
  table: { searchKeys: ['title','description','category','language','youtube_video_id'], sortGetters: { updated: r => r.updated ? new Date(r.updated).getTime() : 0, title: r => (r.title||'').toLowerCase() } },
  columns: [
    { label: 'Thumbnail', render: r => `<div style="width:72px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#f3f4f6;border:1px solid #e5e7eb">${r.thumbnail_url ? `<img src="${escapeHtml(r.thumbnail_url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>` : ''}</div>` },
    { label: 'Video Title', sortKey: 'title', render: r => `<div class="cell-main">${escapeHtml(r.title)}</div><div class="cell-sub">${escapeHtml((r.description||'').slice(0,70))}${(r.description||'').length>70?'…':''}</div>` },
    { label: 'Category', render: r => badge(r.category || '—', 'info') },
    { label: 'Language', render: r => escapeHtml(r.language || '—') },
    { label: 'YouTube ID', render: r => `<span class="mono">${escapeHtml(r.youtube_video_id || '—')}</span>` },
    { label: 'Status', sortKey: 'status', render: r => statusBadge(r.rawStatus === 'published' ? 'Published' : 'Draft') },
    { label: 'Last Updated', sortKey: 'updated', render: r => r.updated ? formatDateTime(r.updated) : '—' },
    { label: 'Actions', render: r => `
      <div class="table-actions">
        <button class="btn btn-sm" data-action="edit" data-id="${r.id}">Edit</button>
        <button class="btn btn-sm" data-action="preview" data-id="${r.id}">Preview</button>
        <button class="btn btn-sm" data-action="${r.rawStatus==='published'?'unpublish':'publish'}" data-id="${r.id}">${r.rawStatus==='published'?'Unpublish':'Publish'}</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${r.id}">Delete</button>
      </div>` }
  ],
  defaultSortKey: 'updated',
  defaultSortDir: 'desc',
  minWidth: 1100,
  tableTitle: 'Tutorial Library',
  tableSubtitle: 'Published tutorials appear in the Hisaab POS Help & Tutorials module.',
  actions: () => `<button class="btn btn-primary" data-action="create">+ Add New Tutorial</button>`,
  detail: (r) => `
    <div class="card section"><div class="card-head"><div><h3 class="card-title">${escapeHtml(r.title)}</h3><p class="card-sub">${escapeHtml(r.category)} • ${escapeHtml(r.language)}${r.duration ? ' • '+escapeHtml(r.duration) : ''}</p></div>${statusBadge(r.rawStatus === 'published' ? 'Published' : 'Draft')}</div>
    <div class="card-body" style="display:grid;grid-template-columns:220px 1fr;gap:14px;align-items:start">
      <div style="aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#f3f4f6;border:1px solid #e5e7eb">${r.thumbnail_url ? `<img src="${escapeHtml(r.thumbnail_url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>` : ''}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div class="cell-sub">${escapeHtml(r.description || 'No description.')}</div>
        <div class="mini-metric"><div class="label">YouTube</div><div class="mono">${escapeHtml(r.youtube_url || '—')}</div></div>
        <div class="mini-metric"><div class="label">Keywords</div><div class="cell-sub">${escapeHtml((r.keywords||[]).join(', ') || '—')}</div></div>
      </div>
    </div></div>`,
  onAction: (action, id, ctx) => {
    const row = ctx.getData().find(x => x.id === id);
    if (action === 'create') return openFormModal('create', null, ctx);
    if (action === 'edit' && row) return openFormModal('edit', row, ctx);
    if (action === 'preview' && row) return openPreviewModal(row);
    if (action === 'publish' && row) {
      adminApi.publishHelpTutorial(row.id).then(() => { showToast({ title: 'Published', message: 'Tutorial is now visible to Hisaab POS users.', tone: 'success' }); ctx.reload && ctx.reload(); }).catch(e => showToast({ title: 'Publish failed', message: e.message || 'Could not publish tutorial.', tone: 'danger' }));
      return;
    }
    if (action === 'unpublish' && row) {
      adminApi.unpublishHelpTutorial(row.id).then(() => { showToast({ title: 'Unpublished', message: 'Tutorial is hidden from users.', tone: 'info' }); ctx.reload && ctx.reload(); }).catch(e => showToast({ title: 'Update failed', message: e.message || 'Could not unpublish tutorial.', tone: 'danger' }));
      return;
    }
    if (action === 'delete' && row) {
      confirmDialog({
        title: 'Delete tutorial',
        message: `Delete "${row.title}"? It will be removed from the active tutorial library and will no longer appear to users.`,
        confirmText: 'Delete',
        danger: true,
        onConfirm: async () => {
          try { await adminApi.deleteHelpTutorial(row.id); showToast({ title: 'Deleted', message: 'Tutorial removed.', tone: 'success' }); ctx.reload && ctx.reload(); }
          catch (e) { showToast({ title: 'Delete failed', message: e.message || 'Could not delete tutorial.', tone: 'danger' }); }
        }
      });
      return;
    }
  }
});

export function renderHelpTutorialsPage() { return mod.render(); }
renderHelpTutorialsPage.mount = mod.mount;
export const mount = mod.mount;
export default mod;
