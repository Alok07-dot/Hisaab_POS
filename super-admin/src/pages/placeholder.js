import { renderPageHeader } from '../layout/page-header.js';
import { sampleDataBanner } from '../components/display/sample-banner.js';

export function renderPlaceholderPage({ breadcrumbs, title, subtitle, features = [], metrics = [] }) {
  const metricCards = metrics.length ? `
    <div class="grid grid-4 section">
      ${metrics.map(m => `
        <div class="card stat-card">
          <div class="stat-label">${m.label}</div>
          <div class="stat-value">${m.value}</div>
          <div class="stat-meta"><span>${m.meta || 'Sample'}</span></div>
        </div>
      `).join('')}
    </div>` : '';

  const featureCards = features.length ? `
    <div class="placeholder-grid section">
      ${features.map(f => `
        <div class="card">
          <div class="card-body">
            <div class="badge badge-neutral" style="margin-bottom:10px">Planned module area</div>
            <div class="card-title" style="margin-bottom:6px">${f.title}</div>
            <div class="card-sub">${f.text}</div>
          </div>
        </div>
      `).join('')}
    </div>` : '';

  return `
    ${renderPageHeader({ breadcrumbs, title, subtitle, actions: '<button class="btn" disabled title="Actions wired in STEP 4/5">Primary action</button>' })}
    ${sampleDataBanner('This module screen is scaffolded in STEP 2 with sample placeholders; detailed UI and live data are delivered in STEP 3–7.')}
    ${metricCards}
    ${featureCards}
    <div class="card section">
      <div class="card-head">
        <div>
          <h3 class="card-title">Module status</h3>
          <p class="card-sub">Scalable foundation prepared — separate route, layout, and permission-aware navigation.</p>
        </div>
        <span class="badge badge-info"><span class="dot"></span>Scaffolded</span>
      </div>
      <div class="card-body">
        <div class="metric-row">
          <div class="mini-metric"><div class="label">UI state</div><div class="value">Design system ready</div></div>
          <div class="mini-metric"><div class="label">Data mode</div><div class="value">Sample / Not live</div></div>
          <div class="mini-metric"><div class="label">Integration</div><div class="value">API points in STEP 5–7</div></div>
        </div>
      </div>
    </div>
  `;
}
