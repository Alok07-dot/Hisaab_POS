# Hisaab Super Admin Panel (STEP 2)

Separate internal administration application for the Hisaab SaaS POS platform.

- **Route (dev):** `/super-admin/` (served as a static SPA; hash routing `#/overview` etc.)
- **Stack:** Vanilla JavaScript, HTML, CSS (no framework/build step)
- **Status:** STEP 2 — main dashboard and reusable design system with **clearly labeled sample data** (not live backend data)
- **Isolation:** No imports from Customer POS UI/components; existing POS files are untouched.

## Structure
- `index.html` — app entry/shell mount
- `styles/` — design tokens, themes (light default/dark), layout, components
- `src/core/` — formatters, sample data, store, icons
- `src/layout/` — sidebar, topbar, page header
- `src/charts/` — lightweight SVG chart helpers
- `src/pages/` — module pages (Overview implemented, others scaffolded placeholders)
- `src/router.js`, `src/main.js` — hash router and bootstrap

## Notes
- Data shown in STEP 2 is **sample/illustrative only** and marked in-UI.
- Auth, RBAC enforcement, live APIs, and backend integrations are implemented in later steps per the approved STEP 1 architecture.
- Do not implement customer impersonation (V1 constraint). All privileged actions must be server-enforced when wired.