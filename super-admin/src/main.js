import { renderSidebar } from './layout/sidebar.js';
import { renderTopbar } from './layout/topbar.js';
import { getPage } from './pages/registry.js';
import { getRouteIdFromHash, navigateTo, onRouteChange } from './router.js';
import { ROUTES } from './constants/routes.js';
import { appStore, setSession, clearSession } from './core/store.js';
import { icon } from './core/icons.js';
import { authApi, setToken } from './core/api.js';
import { renderLoginPage, mountLoginPage } from './pages/auth/login.js';

const root = document.getElementById('app-root');
let routeListenerBound = false;

function currentRoute() {
  const id = getRouteIdFromHash();
  return ROUTES.find(r => r.id === id) || ROUTES[0];
}

function renderApp() {
  const route = currentRoute();
  const page = getPage(route.id);
  const pageHtml = typeof page === 'function' ? page() : (page && typeof page.render === 'function' ? page.render() : '');

  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar(route.id)}
      <div class="app-main">
        ${renderTopbar(route.label)}
        <main class="content-wrap">
          <div class="content-inner" id="page-content">
            ${pageHtml}
          </div>
        </main>
      </div>
    </div>
  `;

  bindEvents();
  const content = root.querySelector('#page-content');
  if (page && typeof page.mount === 'function' && content) page.mount(content);
}

function ensureRouteListener() {
  if (routeListenerBound) return;
  routeListenerBound = true;
  onRouteChange(() => {
    if (!appStore.session.authenticated) { renderLogin(); return; }
    renderApp();
  });
}

function renderLogin() {
  root.innerHTML = renderLoginPage();
  mountLoginPage(root, () => {
    if (!window.location.hash || window.location.hash === '#/login') navigateTo('/overview');
    ensureRouteListener();
    renderApp();
  });
}

function bindEvents() {
  root.querySelectorAll('.nav-item[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true') return;
      const path = btn.getAttribute('data-route');
      if (path) navigateTo(path);
    });
  });

  const themeBtn = root.querySelector('#themeToggleBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      appStore.ui.theme = next;
      themeBtn.innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
      themeBtn.setAttribute('title', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`);
    });
  }

  const logoutBtn = root.querySelector('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await authApi.logout(); } catch {}
      setToken('');
      clearSession();
      window.location.hash = '#/login';
      renderLogin();
    });
  }
}

async function bootstrap() {
  try {
    const me = await authApi.me();
    const user = me.user || me;
    setSession(user, me.permissions || []);
  } catch {
    clearSession();
  }

  if (!appStore.session.authenticated) {
    window.location.hash = '#/login';
    renderLogin();
    return;
  }

  if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#/login') {
    navigateTo('/overview');
  }
  ensureRouteListener();
  renderApp();
}

bootstrap();
