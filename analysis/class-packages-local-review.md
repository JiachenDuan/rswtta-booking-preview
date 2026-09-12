# Class packages / 课时包 — persistent production design

## Existing-solutions preflight

This version stays on the repository's maintained Next.js, Supabase/Postgres, `projectStore`, and Playwright stack. It adds no dependency or paid service. A dedicated normalized ledger plus two narrow RPCs avoids a mutable balance field and avoids routing package writes through generic `project_rows` mutations.

## Application behavior

- The bilingual section remains Club-only; the Parent surface never mounts it.
- Every current student account is identified by permanent account UUID. Setup-required and profile-complete accounts are included; duplicate names receive a safe short UUID suffix. No contacts render in the directory.
- `list_class_package_balances()` left-joins all account rows and derives `coalesce(sum(delta_minutes), 0)`. It never seeds credits or infers them from historical bookings.
- `Add hours / 增加课时` starts at 0 and requires staff to explicitly enter a positive amount in 0.5-hour increments, up to 500 hours. Confirmation shows permanent identity, current balance, addition, and result. The server returns transactional old/new balances.
- Phase 1 supports positive package purchases only. It has no automatic deductions, dollar handling, refunds, corrections, arbitrary balance sets, or direct update/delete path.

## Migration and rollback

- Migration: `supabase/migrations/20260912123000_class_package_hours_ledger.sql`
- Emergency rollback: `sql/rollback/20260912123000_class_package_hours_ledger.rollback.sql`

The migration takes a transaction-scoped advisory lock and stops unless production still has the exact reviewed project UUID, account-table UUID, 73 account IDs, and ordered identity SHA-256. It creates an append-only ledger with server UUID/timestamp, positive integer 30-minute deltas, a 30,000-minute maximum, project/account ownership validation, global project idempotency, and mutation-rejection trigger. The add RPC serializes idempotency and per-account balance computation with advisory locks, rejects replay payload mismatches, and returns the ledger ID, added minutes, old/new balances, server timestamp, and replay flag.

The table grants no direct access. Only the balance-list and positive-add RPCs are executable by the current browser roles. The rollback is safe only before any credit exists; it refuses to destroy a nonempty immutable ledger.

## Accepted security limitation

**Production still uses a bypassable, client-controlled legacy Club session. Anyone who bypasses that UI gate can call the positive-credit RPC until server-verified Club authentication and Club-only RLS/RPC authorization ship.** The accepted interim schema does not fabricate an authenticated actor: each entry records `actor_kind = 'legacy_club_session_unverified'`.

Required follow-up: replace anon RPC execution with server-verified Club identities and authorization, revoke anon execute, and bind audit actor identity to the verified server identity.

## Review artifacts

The checked-in local screenshots document the approved layout. After deployment they must be replaced or supplemented with production captures:

- `artifacts/class-packages/class-packages-desktop.png`
- `artifacts/class-packages/class-packages-mobile.png`
- `artifacts/class-packages/class-packages-mobile-add-hours.png`
- `scripts/capture-class-packages.mjs` captures the deployed shared-ledger surface and seeds no account or package data.
