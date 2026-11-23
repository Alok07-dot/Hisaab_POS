# Connect Hisaab to Supabase (multi-tenant setup)

Hisaab now uses **Supabase Auth + Postgres with Row Level Security** as its
real backend. Every business is an *organization*, and the database itself
refuses to return one organization's rows to another.

There are two schemas in this folder:

| File | Status |
|---|---|
| `supabase/migrations/0001_core_tenancy.sql` | **Use this one.** Full multi-tenant schema, RLS, RPCs. |
| `supabase-schema.sql` | Deprecated. Old flat/dev schema — do **not** run it. |

Total time: **about 10 minutes**. A free Supabase project is enough.

---

## Step 1 — Create the project (2 min)

1. Open **https://supabase.com** and sign in.
2. Click **New project**.
3. Fill in:
   - **Name:** `hisaab-pos`
   - **Database password:** choose a strong password and save it somewhere safe
   - **Region:** closest to you (e.g. Mumbai / Singapore)
4. Click **Create new project** and wait for provisioning to finish.

---

## Step 2 — Run the schema (2 min)

1. In the left sidebar open **SQL Editor** → **New query**.
2. Open **`supabase/migrations/0001_core_tenancy.sql`** from this repo.
3. Copy the whole file, paste it into the editor, and click **Run**.
4. You should see **“Success. No rows returned”**.

What this creates:

- `profiles`, `organizations`, `org_members`, `stores`
- `plans`, `subscriptions`, `payments`, `usage_counters`
- `categories`, `products`, `product_variants`, `stock_movements`
- `customers`, `sales`, `sale_items`, `damages`, `returns`, `payment_methods`
- RLS enabled on every table, plus helper functions
  `is_org_member()`, `is_org_admin()`, `create_organization()`
- The Free / Starter / Pro plan catalogue

The file is safe to re-run: it uses `IF NOT EXISTS` and recreates policies.

> Only authentication and company onboarding are wired to the frontend right
> now. The other tables exist so the schema does not change shape later.

---

## Step 3 — Turn on email auth (1 min)

1. Go to **Authentication → Providers → Email**.
2. Make sure **Enable Email provider** is on.
3. For the fastest first-run experience turn **Confirm email** **off**.
   (With it on, users must click a link in their inbox before signing in —
   the app handles that case, it is just slower to test.)
4. Under **Authentication → URL Configuration** set:
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** `http://localhost:3000/**`

---

## Step 4 — Give the app your keys (1 min)

1. Open **Project Settings → API** (or **Data API**).
2. Copy:
   - **Project URL** → `https://xxxxx.supabase.co`
   - **anon public** key → the long `eyJ...` string
3. Open **`config.js`** in this folder and replace the two placeholders:

```js
window.SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT_ID.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_PUBLIC_KEY'
};
```

4. Save the file and refresh the app.

> **Security:** the `anon` key is designed to be public. Never paste the
> `service_role` key into `config.js` or any frontend file — that key bypasses
> RLS. Payment gateway secrets also stay on the Express server (`.env`), not
> in the browser.

With valid keys the app switches to **cloud mode**:

- The POS is hidden behind a sign-in screen.
- New users sign up with email + password.
- After sign-up they create their business, which atomically creates the
  organization, the owner membership, the first store and a Free subscription.

If `config.js` still has placeholders, the app stays in **local mode** and
works exactly as before (no login, data in `localStorage`).

---

## Step 5 — Verify (2 min)

1. Refresh the app → the sign-in gate appears.
2. **Create account** with any email + an 8-character password.
3. Fill in the business form → **Create business**.
4. You land in the POS with your store name in Settings.
5. Open the **Subscription** view — the account card should say
   *“Signed in with Supabase”* and show your business and role.

### Prove tenant isolation (important)

1. Sign out (profile menu → **Sign out**).
2. Create a **second** account with a different email and a different business.
3. In the Supabase **Table Editor**, check `organizations`: there are two rows.
4. In the browser open the console and run:

```js
const sb = window.HisaabSupabase.client;
const { data } = await sb.from('products').select('*'); // empty, not an error
const { data: orgs } = await sb.from('organizations').select('*');
orgs.length; // 1 — only your own organization
```

Even if someone edits `org_id` in a request by hand, Postgres returns zero
rows. That is the guarantee the frontend cannot provide on its own.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Gate never appears and app stays local | `config.js` still has the placeholder URL/key. |
| “Database not initialised yet” | The migration has not been run. Paste `0001_core_tenancy.sql` into the SQL Editor and run it. |
| *Invalid API key* | You pasted the `service_role` key or a truncated key. Use the **anon public** key. |
| Sign-up returns “check your email” | *Confirm email* is on. Either click the link, or turn it off in Auth → Providers → Email. |
| Signed in but stuck on “Loading subscription” | The Express server is not running. Start it with `node server.js`. |
| `42501` / permission denied when creating a business | Make sure you ran the **whole** migration (the `create_organization` function and grants are at the end). |

---

## What is connected at this stage

| Area | Status |
|---|---|
| Sign up / sign in / sign out (Supabase Auth) | Connected |
| Company + store onboarding (`create_organization` RPC) | Connected |
| Profiles | Read/update only |
| Plans / subscription / payments / usage | Schema ready; billing still served by `saas/` until the next phase |
| Products, inventory, customers, sales | Tables + RLS ready, **not yet wired** |

Next phases connect one module at a time (catalogue → inventory → customers →
sales/invoices), so nothing is half-migrated.
