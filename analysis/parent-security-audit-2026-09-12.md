# Parent security production audit — 2026-09-12

All evidence below is aggregate or cryptographic; no personal data is included.

## Frozen production baseline

- Remote base: `origin/main` at `b178a86ca265f77d01ccfd18761e4afe6256ce10`.
- Anonymous publishable-key audit fetched `project_rows` in 100-row pages to exhaustion: 22 pages total, including 1 account page (65 rows) and 20 booking pages (1,978 rows).
- Parent accounts: 65 unique IDs; 65 confirmed; 38 profile-setup-required; 38 missing email; 39 missing phone; 0 missing password hash or salt.
- Parent account ID SHA-256: `5ac42d21ab1b8fe42f774340f321027b7c7640433134e6e41feec216b13ec36b`.
- Parent account ordered-row SHA-256: `d8ab24b0b9ca618cc34bc16f97d612540ca4cb888a29626645b56977b5845f13`.
- Username audit: one duplicate normalized `studentName` group in the independent paginated audit; the database aggregate audit found two collision groups across all accepted login-name forms, involving four accounts, maximum collision size two. No identifiers are reported.
- Household audit: no shared-email group; two shared-phone groups involving four accounts. Shared-email-safe account grouping is still required for future households.
- Credentials: all 65 hashes are 44-character base64 and all 65 salts are 24-character base64, consistent with the current client PBKDF2-SHA256/100,000 format. One duplicate-hash family covers 31 preregistered accounts; one duplicate-salt family is present. This is expected from the current shared preregistration seed implementation but increases compromise blast radius.
- Supabase Auth: 2 users; 2 account rows match an Auth email; there is no immutable Parent binding table. The other 63 Parent accounts are not represented by verified Supabase identities.
- Bookings: 1,978 unique IDs: 1,737 `club_confirmed`, 211 `cancelled`, 30 `coach_confirmed`; 1,783 recurring rows; 262 rows without a student account ID (system/group/legacy rows included).
- Booking ID SHA-256: `165c6a83bcd7ecfda9046ecb39c84eeea8bf62108529ef8894f7e142ff3fa679`.
- Booking ordered-row SHA-256: `5ff0defbec0a2363dd37347887814f7416bc3156877f5ec8d9feb1093c939c99`.
- Eddie verification set: 53 rows; ordered-row SHA-256 `8d8d0c9a60b4896b139a25cfacbf3f410c0a9b5ebfb1e2adc536a6020e9de772`.
- Bills: 0. Activity logs: 65.

## Production catalog and authorization audit

- Transaction mode for catalog audit: `read only`.
- RLS exists but is ineffective for the shared project tables: public-role policies use unconditional `true` predicates.
- `anon` and `authenticated` both have direct SELECT/INSERT/UPDATE/DELETE table privileges on `projects`, `project_tables`, `project_columns`, and `project_rows`.
- Anonymous callers can read all 65 Parent credential hashes and salts.
- Anonymous callers can execute privileged/mutating contracts including `cancel_booking_as_club`, `cancel_booking_as_parent`, `request_booking_as_parent`, `rename_student_account`, recurring/group management, and class-package mutation functions.
- `cancel_booking_as_parent` accepts a caller-supplied student account ID. It does not derive identity from a verified principal or opaque server session.
- `cancel_booking_as_club` is `SECURITY DEFINER` and executable by `anon`.
- Five relevant production triggers are active, including cancellation, recurring identity, student identity, seed duplication, and timestamp guards; none supplies caller authentication.
- The browser client stores Parent identity as a JSON object in localStorage, stores Club authentication as a localStorage boolean, verifies legacy password hashes in browser JavaScript, and contains the Club credential check client-side.
- Parent reads are performed by anonymously listing all accounts/bookings and filtering by the localStorage account ID. Parent profile/request/cancel calls trust caller account IDs.
- Club reads and writes use the same anonymous direct-table/RPC backend. Therefore any browser can bypass Parent authorization by calling the Club/direct-table paths.

## Protected scoped backup

Created only after the frozen baseline and a byte-exact rollback-only proof.

- Private schema: `private_migration_backups` (no `USAGE` for `anon` or `authenticated`).
- Tables: `parent_auth_accounts_20260913_0418`, `parent_auth_booking_metadata_20260913_0418`, `parent_auth_auth_metadata_20260913_0418`, and manifest of the same timestamp.
- Account backup: 65 complete affected account rows; MD5 `1f7fef6ec34d997a9ec71510fa767ff2`.
- Booking backup: 1,978 rows containing only authorization/cancellation identity, status, timing, series, group, note, and row timestamps; MD5 `817b0851941cec5b19e63f9aeedcf5b0`.
- Auth metadata backup: 2 matching Auth-user metadata rows, email represented only by digest.
- Exact committed backup script SHA-256: `17727c03159e7cf1a462e864072daf487a3849089a0265753ead9ad20d395576`.
- Rollback-only script SHA-256: `27143a1c464460098b74e2c86f8d554784575d3885ece7b4b87469cf15219bac`; all four objects were absent after rollback.
- Post-backup source guards remained 65 accounts / 1,978 bookings with ID MD5s `ac68c3093d962c32c2b70167779caa31` and `f27734c3f7a8c2843992bc41b252af4e`.

## Deployment conflict and required gate

Safe Parent authorization cannot be activated while the existing anonymous Club backend remains unchanged: direct table privileges and anonymous Club RPCs bypass every Parent-specific check. Deploying only a secure Parent login would create a false sense of security.

The minimum Club change can preserve Club UI/UX and workflows exactly, but it is an internal authorization change that requires explicit approval before activation:

1. Verify the existing Club username/password on the server, not in browser JavaScript.
2. Issue a short-lived, opaque, revocable Club session bound to a server-side staff principal.
3. Route existing Club reads/writes through that session-bound API/RPC surface without changing screens or workflows.
4. Revoke anonymous direct-table CRUD and anonymous execution of all Club/privileged legacy RPCs in the same atomic activation.

Until that plumbing is approved and activated atomically with the Parent restrictions, production deployment is blocked. Staged shadow-mode code must not be described as providing production authorization.

## Staged implementation and final gates

- Parent client and SQL contracts are staged in the isolated worktree. Parent identity is represented only by opaque access/refresh tokens; refresh rotates both tokens and binds them to a per-tab client key. Server functions select the account from private immutable bindings.
- The shadow migration copies all 65 legacy PBKDF2 credentials into a private schema but deliberately leaves the public legacy values and all existing grants unchanged. It adds no browser grants, so applying it alone would not claim to secure production or break the current client.
- The separately staged activation removes browser-readable credential keys, rejects future public credential material, revokes direct project-table access and all known anonymous legacy Parent/Club RPCs, then grants only opaque-session functions.
- Parent cancellation is a single server transaction for either selected-only or selected-and-future scope. It locks the selected row and complete candidate set, checks active status, a strict server-time `>12h` cutoff, expected version/count, immutable series/original-slot boundary, ownership, group/system exclusions, nonce consumption, and idempotency payload. The same transaction writes the cancellation activity record.
- Exact shadow migration SHA-256: `a67bd1911eaae6e15e66dd890a11bb89293b2f1ee0c69b67d119a9d8cf7af3f7`.
- Exact activation migration SHA-256: `ccd83a7abe0a80cf0e5d7b9e5c30f9e892b4c9deb4f7c5bea29a4a2875b4a5a2`.
- Production rollback-only acceptance used the exact shadow migration with only terminal `commit` changed to `rollback`; rollback script SHA-256 `2cce2e0cefe79a974df59f46617e39470857f7298166f9f1b293cf3d278634e8` and editor content hash matched byte-for-byte.
- Post-rollback proof: `rswtta_private`, staged login, and staged cancellation function all absent; protected backup still present; account count/hash stayed 65 / `5ac42d21ab1b8fe42f774340f321027b7c7640433134e6e41feec216b13ec36b`; booking count/hash stayed 1,978 / `165c6a83bcd7ecfda9046ecb39c84eeea8bf62108529ef8894f7e142ff3fa679`.
- Strict TypeScript passed; Next production build passed; full Playwright suite passed 98/98; frontend-to-SQL RPC contract tests passed 2/2; diff check and secret-pattern scan passed.
- Responsive Parent login evidence captured in English and Chinese at 1440×1000 and 390×844 under `analysis/ui-verification/`; no clipping or overflow observed. No real account was used.

## Unmet activation prerequisites (deployment blockers)

1. Club currently has no server-verified identity. The activation migration stages generic opaque Club session RPCs, but the existing Club client still uses its legacy browser credential/localStorage path. A separately reviewed, no-UI-change Club client adapter and masked Club credential bootstrap are required before activation.
2. Ambiguous normalized login aliases are intentionally omitted rather than guessed. The affected collision groups require independently verified alias resolution before those accounts can use opaque login.
3. No transactional email outbox/worker exists for password reset delivery. The staged endpoint returns an honest `queued: false`, and the Parent UI directs users to the club assistant. Reset delivery must be implemented and verified before claiming online reset compatibility.
4. Production has no shared-email household, so shared-household login could not be proven on live metadata. The private schema supports household/account bindings, but a disposable multi-account household acceptance and an explicit server-validated account-selection experience are still required before enabling that future case.
5. Because activation was not applied, live unauthorized/direct-table denial tests are expected to fail today; the audit instead proves the bypass. Activation denial, race, stale, idempotency, partial-failure, refresh/logout, and all-Parent-feature tests must run against a disposable post-activation database before deployment.

No application or database activation was deployed, no branch was pushed, and no live class was cancelled.
