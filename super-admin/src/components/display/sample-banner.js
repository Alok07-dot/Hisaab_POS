import { sampleMeta } from '../../core/sample-data.js';

export function sampleDataBanner(extra = '') {
  return `
    <div class="banner banner-info notice-inline" role="status" aria-label="Sample data notice">
      <div>
        <div class="banner-title">${sampleMeta.label} — STEP 2 design preview</div>
        <div class="banner-text">${sampleMeta.note} ${extra || ''}</div>
      </div>
      <span class="badge badge-info"><span class="dot"></span>Not live</span>
    </div>
  `;
}

export function stateBlock({ type = 'empty', title = 'Nothing to show', text = 'There is no data available for this view yet.', action = '' }) {
  const label = type === 'error' ? 'Error' : type === 'loading' ? 'Loading' : type === 'forbidden' ? 'Access restricted' : 'Info';
  return `
    <div class="state state-${type}">
      <div class="state-icon" aria-hidden="true">${label[0]}</div>
      <div class="state-title">${title}</div>
      <div class="state-text">${text}</div>
      ${action ? `<div style="margin-top:12px">${action}</div>` : ''}
    </div>
  `;
}
