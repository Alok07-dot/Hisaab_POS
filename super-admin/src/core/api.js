const TOKEN_KEY = 'hisaab_super_admin_token';

export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
export function setToken(token) { try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch {} }

export async function api(path, options = {}) {
  const token = getToken();
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, Object.assign({}, options, { headers, credentials: 'include' }));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { ok: false, error: text || 'Invalid response' }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

export const authApi = {
  login: (email, password) => api('/api/super-admin/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => api('/api/super-admin/v1/auth/me'),
  logout: () => api('/api/super-admin/v1/auth/logout', { method: 'POST', body: '{}' })
};
