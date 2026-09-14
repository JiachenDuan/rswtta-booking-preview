# Alex Ma setup-login security rollout — 2026-09-14

## Scope and privacy

- Production Supabase project: `rswtta-booking` (`xtewfpzsyjeaqgkdttij`).
- Read-only baseline completed before rollout; no real parent/student account was modified during diagnosis or acceptance.
- Runtime acceptance used synthetic transaction-scoped fixtures only and ended with `ROLLBACK`.
- Screenshots use synthetic names and credentials only.

## Production data preservation

- Initial `parent_accounts`: **67 rows**, **67 unique IDs**, canonical SHA-256 `137ce3f1eded3d35cebfa47a0dfcbe731c3febf035f617f69bd36ec9742cd2c4`.
- Private pre-change backup: **67 rows**, the same canonical SHA-256 `137ce3f1eded3d35cebfa47a0dfcbe731c3febf035f617f69bd36ec9742cd2c4`.
- Final `parent_accounts`: **67 rows**, **67 unique IDs**, the same canonical SHA-256 `137ce3f1eded3d35cebfa47a0dfcbe731c3febf035f617f69bd36ec9742cd2c4`.
- No production account row changed during the security rollout; the migration adds guarded server contracts, private backups, and RLS policy changes.
- `bookings`, `group_classes`, `class_packages`, `bill_notifications`, and `activity_logs` retained their guarded counts and canonical hashes.

## Security acceptance

- Anonymous direct REST query of `parent_accounts`: **0 rows returned**.
- Minimal identifier resolver for the exact `Alex Ma` username returned only `status` and `firstNameCollision`; no account ID, contact, hash, salt, token, or row body was exposed.
- Anonymous/authenticated direct table reads and writes are RLS-denied; no permissive public policies remain on the shared row table.
- Broad unauthenticated account loading/subscription was removed from startup.
- Exact normalized full username wins over first-name collision; first-name-only and duplicate exact identifiers remain ambiguous.
- Password verification is server-side and precedes setup-session issuance.
- Setup-only accounts cannot enter normal booking/profile state until a different password is accepted atomically; all setup sessions are then revoked.
- Wrong-password, stale-session, expired-session, replay, and concurrent-double-submit paths were exercised in rollback-only acceptance.

## Verification

- Production migration applied successfully and re-applied idempotently from the committed SQL (SHA-256 `ecf5c6ef9e7bd8ad9eda200a3cd2432f2a14e08afb91834f862cb65992ba3dbc`).
- Post-migration production verification: passed.
- Rollback rehearsal: passed and rolled back.
- Runtime acceptance: passed and rolled back.
- Playwright: **157/157 passed**.
- Strict TypeScript: passed.
- Production build: passed.
- UI acceptance: English desktop `1440×900`, Chinese mobile `390×844`, one Enter-triggered setup-login request, zero broad pre-auth `project_rows` requests.
- ESLint script is not configured in this repository (`npm run lint` reports a missing script).

## Evidence files

- Migration apply: `alex-login-corrected-migration-apply-result-20260914.txt`
- Post-migration verification: `alex-login-final-postmigration-verify-20260914.txt`
- Runtime acceptance: `alex-login-idempotent-runtime-acceptance-result-20260914.txt`
- Rollback rehearsal: `alex-login-idempotent-rollback-rehearsal-result-20260914.txt`
- Live anonymous proof: `alex-login-production-anon-proof-20260914.json`
- Browser network proof: `alex-login-ui-network-20260914.json`
- Desktop/mobile screenshots: `alex-login-en-desktop.png`, `alex-login-zh-mobile.png`
- Test/typecheck/build logs: `alex-login-final-full-test-20260914.log`, `alex-login-final-typecheck-20260914.log`, `alex-login-final-build-20260914.log`
