# Class packages / 课时包 — local review v1

## Existing-solutions preflight

The repository already has the needed maintained building blocks: React/Next.js UI, Supabase/Postgres, `projectStore`, Playwright, and the existing identity-safe `parent_accounts` records. This version reuses them and adds no dependency or paid service. The proposed production design uses a dedicated normalized Postgres ledger and one guarded Supabase RPC rather than adding a mutable balance to JSON project rows.

## Implemented locally

- A Club-only `Class packages / 课时包` navigation section; the Parent surface never mounts the panel.
- All current student accounts are included by permanent account ID, including setup-required and profile-complete records. Duplicate display names get a safe six-character ID suffix. Search uses name or account ID; no contact details render in this directory.
- Remaining hours are derived only by summing integer minute deltas; no entries means exactly `0 hours / 0课时`. No ledger rows are seeded and no credits are inferred from booking history. Last package update is the latest ledger timestamp.
- `Add hours / 增加课时` starts at 0 so staff must explicitly enter a positive value (for example, 10 after receiving a 10-hour package payment). It permits 0.5-hour increments from 0.5–500 hours, previews account identity/current/add/result balances, disables during submit, uses an idempotency key, and surfaces errors.
- Phase 1 intentionally excludes automatic lesson deductions, payment-dollar handling, refunds, and arbitrary balance edits. Corrections remain compensating ledger entries, not edits.
- For review only, UI writes use the isolated browser's localStorage ledger. No Supabase package write is attempted by this code.

## Schema / RPC proposal

`sql/proposals/class-package-hours-ledger.sql` is deliberately outside `supabase/migrations` and begins with `DO NOT APPLY`. It proposes:

- immutable `class_package_hours_ledger` rows with UUID student account, nonzero integer `delta_minutes`, operation type, authenticated actor, note/reference, idempotency UUID, and server timestamp;
- unique `(actor_id, idempotency_key)`, project/table ownership checks, length and package-increment bounds;
- a security-definer RPC that rechecks server-controlled Club authorization, account ownership, validation, and replay behavior in one transaction;
- RLS read access for Club staff only, no direct insert/update/delete grants, and a trigger rejecting update/delete;
- a derived balance view using `coalesce(sum(delta_minutes), 0)`.

## Production security gate

**Publication is blocked.** Before exposing or connecting this feature to Supabase, replace the known bypassable hard-coded Club login/session with Supabase Auth (or equivalent server-verified identities) and a server-controlled `club_staff` authorization source. Then review and test RLS/RPC policies in staging so:

1. only authenticated Club staff can list all student balances and execute the add-hours RPC;
2. Parent/anonymous clients cannot discover the route/data or read/insert/update/delete ledger rows;
3. actor identity comes from `auth.uid()` rather than client input;
4. account ownership, idempotency, immutable history, concurrent replay, and denial cases pass database integration tests.

Only after that gate should the proposal be converted into a timestamped migration and applied through the normal reviewed release process.

## Local review artifacts

- `artifacts/class-packages/class-packages-desktop.png` — 1440 × 980
- `artifacts/class-packages/class-packages-mobile.png` — 390 × 844
- `artifacts/class-packages/class-packages-mobile-add-hours.png` — 390 × 844, showing the explicit zero-default add form
- `scripts/capture-class-packages.mjs` — deterministic local capture helper; seeds review-only accounts but deliberately no package-ledger rows
