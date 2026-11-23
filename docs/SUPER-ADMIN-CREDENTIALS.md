# Super Admin Credentials — Provisioning, Migration, and Password Reset

This project **does not use insecure default Super Admin credentials in production**. Default/fallback passwords (e.g. `Admin@12345`) are not created in production, and production startup is **fail-safe** for initial provisioning.

## Principles
- **No hardcoded/default production passwords.** Secrets must be supplied via environment variables or a secret manager (never committed).
- **No passwords/secrets in logs, frontend code, public config, or API responses.**
- **Existing legitimate Super Admin accounts are preserved** (id, email, role, status, history) — password rotation does not replace or delete accounts.
- **No unexpected lockout:** if a Super Admin owner already exists, the server can start without forcing a password env var (so authorized admins are not locked out on restart). If no owner exists in production, startup requires secure provisioning credentials.

## Production startup behavior
- **Initial provisioning (no existing Super Admin owner in the data store):** startup fails safely unless a strong `SUPER_ADMIN_PASSWORD` (or `ADMIN_PASSWORD`) is provided via environment. The owner is provisioned with that secret (value never logged).
- **Existing installation (Super Admin owner already exists):** startup is allowed to preserve access for the authorized administrator. If the account appears to use a known insecure/default password, a **warning** is logged with reset guidance (no secrets logged).
- **Explicit reset on startup (safe migration):** set a strong new secret and request a controlled rotation:
  - `SUPER_ADMIN_PASSWORD=<new-strong-secret>`
  - `RESET_SUPER_ADMIN_PASSWORD=true`
  - optional: `SUPER_ADMIN_EMAIL=<owner-email>` to target a specific owner account
  The existing account is preserved; only its password hash is rotated. The secret is never logged.

## Secure password reset procedure (existing installations)
Preferred (CLI, no UI changes):
```powershell
$env:APP_ENV='production'                  # recommended
$env:HISAAB_DATA_DIR='C:\path\to\data'     # target installation data directory
$env:SUPER_ADMIN_PASSWORD='NewStrongSecret!234'
# optional: $env:SUPER_ADMIN_EMAIL='owner@example.com'
node scripts/reset-super-admin-password.js
```
- Requires a strong password (production: minimum 12 chars with mixed character types). No defaults accepted.
- Rotates the existing owner password and verifies it; **does not** print or store the password.
- Preserves the existing account and access (use the new password to sign in).

Alternative: restart once with `RESET_SUPER_ADMIN_PASSWORD=true` and a strong `SUPER_ADMIN_PASSWORD` set in the environment.

## Development/test
- Local development may seed convenience accounts when not in production **only if** no production protections apply; do not use development defaults in production.
- Tests should supply explicit credentials via environment variables and isolated `HISAAB_DATA_DIR`.

## Notes
- Store new secrets in a secure environment/secret manager. Do not commit `.env` files or credentials.
- The Supabase anon key is a public client key when used with proper RLS (not a service-role secret); service-role/DB/payment secrets must remain server-side.