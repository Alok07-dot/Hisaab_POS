# Hisaab POS — Chat Summary (saved 2026-11-07)

## Work completed in this project (`Hisaab-POS`)

### 1) Billing: Paid / Unpaid / Due / Advance
- Checkout shows a live payment-status panel: **Paid / Partially Paid / Unpaid**, with Bill total, Advance used, Amount received, and Balance due.
- Customer advance credit is auto-applied; overpayment can be kept as advance (checkbox). **Credit** method records an unpaid due (requires a selected customer).
- Sale records now store `paymentStatus/status`, `amountPaid`, `balanceDue`, `advanceUsed`, `advanceCredit`, `change`, and `ts` (timestamp).
- Status shown on: receipt (title/color + Paid/Due/Advance lines), Sales History (badges + "Due ₹x" + **Outstanding Due** stat, CSV includes Paid/Due/Advance), Customers (Due/Advance/Nil), and WhatsApp text/PDF invoice (PDF has a colored status strip).
- Fixes: rounded money to 2 decimals; Today's Sales/Revenue now detect "today" correctly via `ts`/date fallback. Automated test data was cleaned up.

### 2) POS "Customer not found" → Add Customer popup
- When a 10-digit phone lookup finds no customer, the redesigned **Customer** modal opens (phone prefilled), matching the provided UI (tabs: General Details/Address/Bank Details/Documents; fields for type, auto Customer ID, name, GSTIN+Verify, +91 phone, email, Due/Advance, Credit Limit, profile photo upload ≤1MB, Draft/Next/Save).
- **Save** validates, creates the customer, and selects them in POS immediately (Advance stored as credit). Customers page **+ Add Customer** uses the same modal.

### 3) Supabase cloud sync (connected in code; you must finish setup)
- App now syncs products, customers, sales, damages, returns, invoice counter, cash drawer, and WhatsApp settings to Supabase while keeping localStorage/offline support.
- **You must do 3 steps** (see `SUPABASE-SETUP.md`): create a free Supabase project → run `supabase-schema.sql` in SQL Editor → paste your Project URL + **anon public** key into `config.js` → refresh. A green "Cloud: connected" pill appears bottom-right when working.
- ⚠️ Use the **anon/public** key only — never the `service_role` key.

## Key files
- `app.js`, `index.html`, `style.css` — main app (billing status, quick-add customer modal, cloud sync).
- `config.js` — **edit this**: add your Supabase URL + anon key.
- `supabase-schema.sql` — run once in Supabase SQL Editor.
- `supabaseClient.js` — Supabase client init.
- `SUPABASE-SETUP.md` — step-by-step Supabase setup guide.
- `server.js` — WhatsApp proxy (`/api/whatsapp/verify`, `/send`, `/send-document`); ports 3000/3443.

## Notes
- Repo has no git history/commits in this workspace; changes are on disk.
- Pre-existing: `config.js` MIME warning was due to 404 before — resolved now that `config.js` exists (with placeholders until you add keys).
- To reset cloud: restore placeholders in `config.js` and refresh.