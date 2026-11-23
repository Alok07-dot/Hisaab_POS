# Barcode Printing — Plan-Based Access Control

Implementation report for HISAAB POS. All code changes are already saved to disk; this file
is the written record of the change.

## Summary

Barcode Printing is now a plan-controlled feature:

- Super Admin → Pricing & Subscription → edit plan → **Features & entitlements** shows a
  **Barcode Printing** checkbox per plan.
- The POS checks the active plan before opening the barcode dialog and again, against the
  server, before rendering labels.
- The server rejects every barcode print request made by a plan without the feature.

No new plan system, no schema redesign, no unrelated UI or API changes.

## Files modified

| File | Change |
| --- | --- |
| `saas/plans/catalog.service.js` | `barcode_printing` added to the feature registry (`Barcode Printing`, `implemented: true`), added to the seeded Free/Pro/Starter feature lists, plus a one-time idempotent rollout (`ROLLOUT_FEATURES` + `ensureFeatureRollouts()`) that preserves printing for catalogue versions that predate the feature. |
| `saas/index.js` | `POST /api/usage/consume` accepts `kind: 'barcode_print'`; returns `402 feature_locked` (`feature: 'barcode_printing'`) when the effective plan lacks the feature. |
| `saas/plans.js` | Human-readable label for `barcode_printing`; existing catalogue→POS mapping preserved. |
| `saas.js` | `canPrintBarcodes()` UI gate, `authorizeBarcodePrint()` server-authoritative check, `FEATURE_NAMES.barcode_printing`, both exported, and a "View pricing & plans" action in the existing upgrade dialog that opens the existing Pricing & Subscription view. |
| `app.js` | Plan gate at the product action-menu entry (`printBarcodeForProduct`); awaited entitlement check in `printBarcodeLabels()` before rendering any label, with a busy latch that disables the Print button during the check. |
| `index.html` | Asset cache-busting only (`app.js?v=20261114g`, `saas.js?v=20261114g`). |
| `test/barcode-entitlement.test.js` | New self-contained entitlement test suite (temporary data dir, own port). |
| `data/plans-catalog.json` | Runtime catalogue updated by the rollout (see below). |

The Super Admin plan editor itself needed no change: it already renders every `implemented`
registry feature as a checkbox per plan.

## Data changes

- No new tables, no SQL migrations, no changes to the subscription record shape.
- `plans-catalog.json` gained:
  - the `barcode_printing` registry entry;
  - the feature key on the plan versions that existed at rollout time (so current customers
    keep printing);
  - `featureRollouts.barcode_printing.appliedVersionIds`, which makes the backfill
    idempotent and makes a per-plan disable permanent.
- Versions created after the rollout start without the key until an admin enables it.
- `data/saas.json` (accounts/subscriptions) was not written. The test asserts that plan
  edits never rewrite a subscription's `currentPeriodEnd` or `planId`.

## Enforcement

Frontend:

- The product action-menu entry consults the cached plan. If the plan lacks Barcode
  Printing, the existing upgrade dialog opens (plan cards plus a "View pricing & plans"
  link to the existing subscription page). The barcode dialog does not open.
- Printing re-checks with the server before rendering labels. A denial aborts the print,
  leaves the print area empty, and re-enables the button.

Backend:

- `POST /api/usage/consume` with `kind: 'barcode_print'` validates the authenticated
  account's effective plan on every request.
- Unauthenticated → `401 unauthenticated`.
- Feature missing → `402 feature_locked` with `feature: 'barcode_printing'`.
- Client-supplied `planId` / `features` / `plan` fields are ignored.
- Local, offline and signed-out devices keep working (same degradation rule as billing);
  there is no server session to enforce in that case.

Barcode rules are unchanged:

- No barcode is generated at print time.
- A missing barcode shows the existing warning, disables Print, and never contacts the
  server.
- Variants use their own barcode; a variant without one falls back to the product barcode
  with the existing note.

## Verification

`node test/barcode-entitlement.test.js` → 25 passed, 0 failed.

1. Plan with Barcode Printing enabled → print allowed.
2. Plan without it (or feature disabled on a live plan) → `402 feature_locked`.
3. Upgrade to a plan with access → allowed again.
4. Feature disabled by Super Admin → subscriber blocked; re-enable → allowed.
5. Direct API requests: unauthenticated → 401; spoofed plan/feature payload → still 402.
6. Other behaviour intact: subscription not rewritten, `returns` gating, product limits,
   billing metering, unknown usage kinds.

Browser checks:

- Unlocked: dialog opens, 1 label rendered, print styles applied.
- Locked: menu action blocked, barcode dialog stays closed, upgrade dialog opens, and the
  "View pricing & plans" link navigates to the existing subscription view.
- Simulated server denial: 0 labels, no print call, button re-enabled.
- Local mode: printing still works.
- No-barcode product: warning shown, Print disabled, no server request.
- Variants: option list and product-barcode fallback behave as before.
- No console errors.

`test/saas.test.js` is unchanged (0 barcode references) and still fails at its pre-existing
stale expectation about plan order (`free/starter/pro` vs. seeded `free/pro/starter`). That
failure predates this change.

## Usage

1. Super Admin → Pricing & Subscription → edit a plan → Features & entitlements → toggle
   **Barcode Printing** → save (creates a new plan version, as other feature edits do).
2. POS: hard-refresh once (`Ctrl+F5`) so `app.js` / `saas.js` update.
3. Existing subscribers keep printing until an admin disables the feature for their plan.
