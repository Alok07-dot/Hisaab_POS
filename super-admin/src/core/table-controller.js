export function normalize(str) { return String(str ?? '').toLowerCase(); }

export function applyTableState(data, state, config) {
  let rows = Array.isArray(data) ? [...data] : [];
  const { search = '', filters = {}, sortKey = '', sortDir = 'asc', page = 1, pageSize = 10 } = state || {};

  // search
  const q = normalize(search).trim();
  if (q) {
    const keys = config.searchKeys || [];
    rows = rows.filter(r => keys.some(k => normalize(getVal(r, k)).includes(q)));
  }
  // filters
  Object.entries(filters || {}).forEach(([key, val]) => {
    if (!val || val === 'all' || val === 'All') return;
    const fn = (config.filterFns || {})[key];
    if (typeof fn === 'function') rows = rows.filter(r => fn(r, val));
    else rows = rows.filter(r => normalize(getVal(r, key)) === normalize(val));
  });
  // sort
  if (sortKey) {
    const getter = (config.sortGetters || {})[sortKey] || ((r) => getVal(r, sortKey));
    rows.sort((a,b) => {
      const av = getter(a), bv = getter(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize);
  return { rows: paged, total, page: p, pages, pageSize };
}

function getVal(obj, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((o,k)=> (o ? o[k] : undefined), obj);
}
