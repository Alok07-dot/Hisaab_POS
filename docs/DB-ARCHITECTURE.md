# Hisaab — Database Architecture

Multi-tenant SaaS on Supabase (Postgres + Auth + RLS).
Schema: [`supabase/migrations/0001_core_tenancy.sql`](../supabase/migrations/0001_core_tenancy.sql)

---

## 1. Tenancy model

```
auth.users ──1:1── profiles
    │
    └── org_members ──N:1── organizations (the tenant)
                                 │
                                 ├── stores
                                 ├── subscriptions ── plans
                                 ├── payments
                                 ├── usage_counters
                                 ├── categories ── products ── product_variants
                                 ├── stock_movements
                                 ├── customers
                                 ├── sales ── sale_items
                                 ├── damages
                                 ├── returns
                                 └── payment_methods
```

- One **organization** = one business (Business A, B, C).
- A user can belong to more than one organization through `org_members`, with a role: `owner`, `admin`, `staff`.
- A **store** is a physical shop inside an organization (multi-store is a Pro feature; V1 uses the default store).
- Every business row carries `org_id`. There is no cross-org relationship anywhere, so a query can only ever return one tenant's data.

## 2. Module → tables

| Module | Tables | Wired to the UI |
|---|---|---|
| Authentication | `auth.users` (Supabase), `profiles` | **Yes — this phase** |
| Company | `organizations`, `org_members`, `stores` | **Yes — this phase** |
| SaaS | `plans`, `subscriptions`, `payments`, `usage_counters` | Read-only in this phase |
| Products | `categories`, `products`, `product_variants` | No (next phase) |
| Inventory | `stock_movements`, `products.stock` | No |
| Customers | `customers` | No |
| POS / Billing | `sales`, `sale_items` | No |
| Returns / Damages | `returns`, `damages` | No |
| Payments | `payment_methods`, `payments` | No |

The tables for later modules exist so the schema does not change shape halfway through, but **only authentication and company onboarding are connected to the frontend right now**, as requested.

## 3. RLS — how isolation is enforced

Three `SECURITY DEFINER` helpers do the work (defined with a fixed `search_path` so they cannot be hijacked):

| Function | Meaning |
|---|---|
| `is_org_member(org_id)` | caller has an `active` row in `org_members` for this org |
| `is_org_admin(org_id)` | same, and role is `owner` or `admin` |
| `create_organization(...)` | creates org + owner membership + first store + free subscription atomically |

Policy summary:

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `profiles` | own row | trigger only | own row | — |
| `organizations` | member | **denied** (RPC only) | admin | denied |
| `org_members` | own + same org | admin | admin | admin (last owner protected) |
| `stores` | member | admin | admin | admin |
| `plans` | public (anon + auth) | — | — | — |
| `subscriptions`, `payments`, `usage_counters` | member | **denied** (service role only) | denied | denied |
| `products`, `categories`, `product_variants`, `stock_movements`, `customers`, `payment_methods` | member | member | member | member |
| `sales` | member | member | **admin** (void) | **admin** |
| `sale_items` | member | member | none (immutable) | via cascade only |
| `damages`, `returns` | member | member | — | admin |

Anything not covered by a policy is denied. The browser only ever holds the `anon` key plus a user JWT, so a forged `org_id` in a request simply returns zero rows.

## 4. Deliberate design decisions

- **Sales = invoices.** A POS sale *is* the invoice. `sales` is the header and `sale_items` the lines. A second `invoices` table would duplicate every column and create a sync bug.
- **Stores act as warehouses in V1.** Stock lives on `products.stock`; `stock_movements` is the append-only ledger. When multi-store stock lands, add `stock_levels (org_id, store_id, product_id, qty)` — nothing else has to change.
- **Invoice lines are snapshots.** `sale_items` copies name, barcode, unit, price, tax and discount. Editing a product later can never rewrite history.
- **Invoice numbers are per store** (`unique (store_id, invoice_no)`), matching the `INV-0001` format.
- **Monthly usage is a table**, not a counter on the org: `usage_counters (org_id, period, kind, count)` gives an auditable per-month ledger and makes “void does not restore quota” trivial.
- **Money is stored as `numeric(12,2)`** in the database, while the platform catalogue (`plans`) keeps paise as integers to match the payment gateway.
- **Two kinds of “starter” no longer collide**: the Free plan's badge is `Free forever`; `starter` is only ever the paid plan id.

## 5. What runs where

```
Browser (anon key + user JWT)
  ├── Supabase Auth        → sign up / sign in / session
  ├── Supabase Postgres    → RLS-protected reads & writes
  └── Express (this repo)  → payment verification, webhooks, service-role jobs
```

The Express server keeps the payment gateway secrets. Anything that must not be trusted to the browser (order creation, signature verification, subscription activation) stays on the server and writes with the `service_role` key, bypassing RLS by design.

## 6. Migration path from today's localStorage app

1. **This phase** — Supabase Auth + organization/store onboarding. Local data still drives the POS.
2. Next — push `products` / `categories` and read them back, org-scoped.
3. Then — `customers`, `sales` + `sale_items`, `stock_movements`, invoice numbering from the server.
4. Finally — subscription/usage writes move from `data/saas.json` to the `subscriptions` / `usage_counters` tables via the service role.

Each step is reversible: the app keeps localStorage as a cache, so a network failure never blocks billing.
