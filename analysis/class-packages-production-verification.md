# Class packages / 课时包 — production verification

Verified 2026-09-12 after deploying application commit `3ee1fede57ee08bffdaada7afd7d7d15198a8197`.

## Accepted security limitation

**Club access still uses a bypassable client-controlled legacy session. Anyone who bypasses it can reach the positive-credit RPC until server-verified Club authentication and Club-only RLS/RPC authorization replace the interim grants.** Ledger audit rows truthfully use `legacy_club_session_unverified`; no authenticated actor is fabricated.

## Backup and migration

- Guarded private backup: `private_migration_backups.class_package_parent_accounts_20260912_0518`
- Backup verification: 73 account rows, ordered account-ID MD5 `19168f54f5be602beadf72e3246adca8`
- Production migration: `supabase/migrations/20260912123000_class_package_hours_ledger.sql`
- Executed migration SHA-256: `b750115d38c3b44b5e87332ed32838a33542a600c3c10e18ce7a355f5a1f4adc`
- The exact migration was first executed with its final `commit` changed to `rollback`; the balance RPC remained absent afterward, proving the transaction rolled back.
- The production baseline was rechecked immediately before application: 73 accounts, 47 setup-required, 26 complete, identity SHA-256 `637b4155619fc30b668faacb14550ca2ff0d58698fbb3678d424654ef6f725c1`.

## Isolated acceptance

A temporary account UUID `00000000-0000-4000-8000-000000000073` was created solely for acceptance, then removed with its one test ledger entry in a guarded superuser transaction. No real student received a balance change.

- Two concurrent calls using one idempotency UUID returned the same server ledger UUID.
- Replay flags were exactly one `false` and one `true`.
- Both responses returned old balance 0 and new balance 30 minutes.
- Zero, 31-minute, and over-limit requests were rejected.
- Reusing the idempotency key with different input was rejected.
- Direct select, update, and delete attempts through the browser client role were denied.
- Final state: 73 accounts, 73 zero balances, no fixture row, identity SHA-256 unchanged.

## Application and deployment

- Vercel status: success
- Deployment: `https://vercel.com/jiachenduans-projects/rswtta-booking-preview/8WXQhPjW5zfVjtkyHdk2vfj3Y558`
- Production: `https://rswtta-booking-preview.vercel.app/club`
- Production UI: 73 of 73 accounts, all zero with no ledger entries, no contacts rendered, Add hours defaults to 0 with invalid submit disabled, and Parent App has no package surface.
- Focused tests: 9 passed
- Full regression suite: 83 passed
- TypeScript and production build: passed
- Secret and diff checks: passed

## Production screenshots

- `artifacts/class-packages/production-20260912/class-packages-desktop.png`
- `artifacts/class-packages/production-20260912/class-packages-mobile.png`
- `artifacts/class-packages/production-20260912/class-packages-mobile-add-hours.png`
