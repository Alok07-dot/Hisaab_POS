import { authApi, setToken } from '../../core/api.js';
import { appStore } from '../../core/store.js';
import { escapeHtml } from '../../core/formatters.js';

export function renderLoginPage() {
  return `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg-app)">
      <div class="card" style="width:min(420px,100%);box-shadow:var(--shadow-md)">
        <div class="card-body" style="padding:28px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
            <div class="brand-mark">H</div>
            <div>
              <div style="font-weight:700;font-size:18px;color:var(--text-primary)">Hisaab Super Admin</div>
              <div class="card-sub">Internal administration platform — sign in</div>
            </div>
          </div>
          <div id="loginError" class="banner banner-warn" style="display:none;margin-bottom:12px"><div><div class="banner-title">Sign-in failed</div><div class="banner-text" id="loginErrorText"></div></div></div>
          <form id="loginForm" class="stack-3">
            <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="username" required placeholder="owner@hisaab.local" /></div>
            <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••" /></div>
            <button class="btn btn-primary" type="submit" id="loginBtn" style="width:100%;height:38px">Sign in</button>
          </form>
          <div class="card-sub" style="margin-top:14px">Access is restricted to authorized internal roles. Sessions are server-validated and permission-controlled.</div>
        </div>
      </div>
    </div>
  `;
}

export function mountLoginPage(root, onSuccess) {
  const form = root.querySelector('#loginForm');
  const err = root.querySelector('#loginError');
  const errText = root.querySelector('#loginErrorText');
  const btn = root.querySelector('#loginBtn');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Signing in…';
    const email = root.querySelector('#email').value.trim();
    const password = root.querySelector('#password').value;
    try {
      const data = await authApi.login(email, password);
      if (data && data.token) setToken(data.token);
      appStore.session = { authenticated: true, user: data.user || { email, role: data.role || 'admin' }, permissions: data.permissions || [] };
      if (typeof onSuccess === 'function') onSuccess();
    } catch (ex) {
      err.style.display = 'flex';
      errText.textContent = (ex && ex.data && ex.data.error) || ex.message || 'Unable to sign in. Ensure the server is running and restarted for STEP 6 auth endpoints.';
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
}
