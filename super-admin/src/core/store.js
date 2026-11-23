export const appStore = {
  session: {
    authenticated: false,
    user: null,
    permissions: []
  },
  ui: {
    theme: 'light',
    sidebarCollapsed: false
  },
  meta: {
    dataMode: 'sample' // STEP 7 switches modules to live where integrated
  }
};

export function setSession(user, permissions = []) {
  appStore.session = { authenticated: !!user, user: user || null, permissions: permissions || [] };
}
export function clearSession() {
  appStore.session = { authenticated: false, user: null, permissions: [] };
}
export function setState(patch) { Object.assign(appStore, patch); }
