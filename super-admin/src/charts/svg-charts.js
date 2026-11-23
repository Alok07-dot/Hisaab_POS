function esc(n){ return Number.isFinite(n) ? n : 0; }

export function lineChart({ data = [], valueKey = 'value', labelKey = 'label', color = 'var(--chart-1)', height = 220, formatValue = (v)=>v }) {
  if (!data.length) return `<div class="chart-empty">No data available</div>`;
  const w = 720, h = height, pad = { l: 44, r: 12, t: 12, b: 28 };
  const vals = data.map(d => esc(d[valueKey]));
  const max = Math.max(...vals, 1);
  const min = 0;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i) => pad.l + (innerW * (data.length === 1 ? 0.5 : i / (data.length - 1)));
  const y = (v) => pad.t + innerH - ((esc(v) - min) / (max - min || 1)) * innerH;
  const pts = data.map((d,i) => `${x(i)},${y(d[valueKey])}`).join(' ');
  const area = `${x(0)},${pad.t + innerH} ${pts} ${x(data.length-1)},${pad.t + innerH}`;
  const grid = [0,1,2,3,4].map(i => {
    const gy = pad.t + (innerH/4)*i; const gv = Math.round(max - (max/4)*i);
    return `<line x1="${pad.l}" y1="${gy}" x2="${w-pad.r}" y2="${gy}" stroke="var(--chart-grid)" stroke-width="1" />
      <text x="${pad.l-8}" y="${gy+4}" text-anchor="end" font-size="10" fill="var(--chart-axis)">${formatValue(gv)}</text>`;
  }).join('');
  const labels = data.map((d,i)=>`<text x="${x(i)}" y="${h-8}" text-anchor="middle" font-size="10" fill="var(--chart-axis)">${d[labelKey]}</text>`).join('');
  const circles = data.map((d,i)=>`<circle cx="${x(i)}" cy="${y(d[valueKey])}" r="3.5" fill="${color}" />`).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Line chart">
    ${grid}
    <polygon points="${area}" fill="${color}" opacity="0.10"></polygon>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
    ${circles}
    ${labels}
  </svg>`;
}

export function barChart({ data = [], aKey = 'new', bKey = 'cancelled', labelKey = 'label', aLabel = 'New', bLabel = 'Cancelled', aColor='var(--chart-1)', bColor='var(--chart-5)', height = 220 }) {
  if (!data.length) return `<div class="chart-empty">No data available</div>`;
  const w = 720, h = height, pad = { l: 36, r: 12, t: 12, b: 28 };
  const max = Math.max(...data.map(d => Math.max(esc(d[aKey]), esc(d[bKey]))), 1);
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const groupW = innerW / data.length;
  const barW = Math.min(18, groupW * 0.22);
  const grid = [0,1,2,3,4].map(i => {
    const gy = pad.t + (innerH/4)*i; const gv = Math.round(max - (max/4)*i);
    return `<line x1="${pad.l}" y1="${gy}" x2="${w-pad.r}" y2="${gy}" stroke="var(--chart-grid)" stroke-width="1" />
      <text x="${pad.l-8}" y="${gy+4}" text-anchor="end" font-size="10" fill="var(--chart-axis)">${gv}</text>`;
  }).join('');
  const bars = data.map((d,i) => {
    const cx = pad.l + groupW * i + groupW/2;
    const ah = (esc(d[aKey]) / max) * innerH; const bh = (esc(d[bKey]) / max) * innerH;
    const ay = pad.t + innerH - ah; const by = pad.t + innerH - bh;
    return `<g>
      <rect x="${cx - barW - 2}" y="${ay}" width="${barW}" height="${ah}" rx="4" fill="${aColor}"></rect>
      <rect x="${cx + 2}" y="${by}" width="${barW}" height="${bh}" rx="4" fill="${bColor}"></rect>
      <text x="${cx}" y="${h-8}" text-anchor="middle" font-size="10" fill="var(--chart-axis)">${d[labelKey]}</text>
    </g>`;
  }).join('');
  return `<div>
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Bar chart">${grid}${bars}</svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:${aColor}"></span>${aLabel}</span>
      <span class="legend-item"><span class="legend-swatch" style="background:${bColor}"></span>${bLabel}</span>
    </div>
  </div>`;
}

export function donutChart({ data = [], valueKey = 'value', labelKey = 'label', height = 220 }) {
  if (!data.length) return `<div class="chart-empty">No data available</div>`;
  const total = data.reduce((s,d)=>s + esc(d[valueKey]), 0) || 1;
  const size = 220, cx = 110, cy = 110, r = 74, sw = 26;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = data.map((d) => {
    const val = esc(d[valueKey]);
    const frac = val / total;
    const dash = frac * circ;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color || 'var(--chart-1)'}" stroke-width="${sw}"
      stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    offset += dash;
    return seg;
  }).join('');
  const legend = `<div class="chart-legend">${data.map(d=>{
    const pct = ((esc(d[valueKey])/total)*100).toFixed(1);
    return `<span class="legend-item"><span class="legend-swatch" style="background:${d.color || 'var(--chart-1)'}"></span>${d[labelKey]}: <strong>${d[valueKey].toLocaleString('en-IN')}</strong> (${pct}%)</span>`;
  }).join('')}</div>`;
  return `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
    <svg class="chart-svg" viewBox="0 0 ${size} ${size}" style="width:220px;max-width:100%;height:auto" role="img" aria-label="Donut chart">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border-subtle)" stroke-width="${sw}"></circle>
      ${segs}
      <text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="12" fill="var(--text-muted)">Total</text>
      <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text-primary)">${total.toLocaleString('en-IN')}</text>
    </svg>
    <div style="flex:1;min-width:180px">${legend}</div>
  </div>`;
}
