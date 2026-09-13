# Parent authentication activation stop — 2026-09-12

## Decision

Production activation and client deployment were stopped. The refreshed protected backup is the only persistent production change. The reviewed branch remains based on `origin/main` `b178a86ca265f77d01ccfd18761e4afe6256ce10`; remote main had no drift when refreshed.

## Refreshed protected backup

- Script: `sql/backups/20260913_0525_parent_auth_pre_activation.sql`
- Script SHA-256: `a4fc71415a97c0cc50248247d471d23a75ce8e0a99d6c195eabbe7f3172b8694`
- Rollback-rehearsal SHA-256: `c9eb61f3458bbb7c713654f65d370d9a8f8fa8be6fa4888a2f2c63c35bc7549b`
- Private objects: `private_migration_backups.parent_auth_accounts_20260913_0525`, `parent_auth_booking_metadata_20260913_0525`, `parent_auth_auth_metadata_20260913_0525`, and `parent_auth_manifest_20260913_0525`.
- Counts: 65 accounts, 1,978 booking authorization records, 2 Auth metadata records, one manifest.
- Account content MD5: `b9afa3221a6642c979e81f379fd64a0d`.
- Booking authorization projection MD5: `25097383c9d44536f24ca5a30debc0ca`.
- `anon` and `authenticated`: no schema usage and no table select privilege.

The exact backup script was first executed with only terminal `commit` changed to `rollback`; all four objects were absent afterward and source hashes were unchanged. The committed script then passed its in-transaction source/count/hash/ACL assertions.

## Initial failed exact activation rehearsal

A combined execution of the shadow and activation migrations, using a disposable Club credential and a terminal rollback, initially failed before activation with SQLSTATE `42702`: `column reference "r.id" is ambiguous` in the login-alias seed block. PostgreSQL aborted the transaction automatically.

Fresh read-only post-failure proof:

- staged objects absent: true
- accounts: 65; ID SHA-256 `5ac42d21ab1b8fe42f774340f321027b7c7640433134e6e41feec216b13ec36b`; values MD5 `b9afa3221a6642c979e81f379fd64a0d`
- bookings: 1,978; ID SHA-256 `165c6a83bcd7ecfda9046ecb39c84eeea8bf62108529ef8894f7e142ff3fa679`; values MD5 `afb33cf39feb8723785dee69e925b7f1`
- Eddie: one account and 53 bookings; account/bookings values hashes unchanged

## Engineering remediation completed

The alias migration's PL/pgSQL loop record was renamed from `r` to `v_account_row`, removing the collision with SQL table aliases. A regression test now rejects reintroduction of that shadowing pattern.

The fixed stage migration was executed byte-for-byte in the authorized production SQL editor with only its terminal `commit;` changed to `rollback;`:

- fixed migration SHA-256: `c6e546046bbe3772ed03486e65df77be6a40f9300b480c690cf338c097ca327a`
- rollback rehearsal SHA-256: `1b0f0676a65e450a2a8f43f1602d9ff64693f6fc756756df2868e8767b0d4efd`
- result: completed without SQL error
- post-rollback `rswtta_private` schema: absent
- staged public functions: 0
- staged activation trigger: 0
- account, booking, and Eddie counts/hashes: unchanged
- protected backup counts and browser-role denial: unchanged
- anonymous exposure finding: deliberately unchanged (`anon` still has `project_rows` read and 65 credential-bearing rows remain until a separately approved activation)

No Club UI/client file changed during remediation. Git blob identities remained exactly equal to the prior reviewed checkpoint: `components/ClubApp.tsx` `378b47bd6aa31e98426bebce4e76ffaf959896ab`, `components/ClassPackagesPanel.tsx` `4da8589c844dea91d8667fe19d1197a7594c2e20`, and `lib/projectStore.ts` `90d538cf473845e2c9d05025d8071a0954a1d7ea`. Therefore Club-created Parent accounts retain the current credential behavior; no inaccessible generated credential path was introduced.

Password reset remains explicitly fail-closed: `parent_request_password_reset` returns `accepted: true`, `queued: false`, `delivery: unsupported`, and no reset outbox or delivery claim is staged.

Final local verification passed: 8/8 focused tests, 100/100 full Playwright tests, strict TypeScript, Next.js production build, `git diff --check`, and secret-pattern scan with zero hits. Club UI/client blobs were unchanged, so no new screenshots were needed for this non-UI remediation.

## Unavoidable credential and identity blockers

A read-only aggregate audit established:

- 38 accounts require first-time profile setup.
- All 38 have neither an email nor a phone in production.
- 31 accounts share a legacy credential pair; 28 of those accounts already have bookings.
- 34 profile-setup-required accounts have bookings.
- Four accounts are affected by normalized login-name collisions. Only one has a unique email/phone alternative; the other three have no contact route.
- The current Club password has been shipped in browser code and therefore cannot be considered a safe reusable server credential.

Transparent reuse is unsafe for the shared preregistration credential cohort: issuing a normal authorized session before an independently verified first-time reset would let anyone who knows the historical shared credential claim an account. Collision aliases also cannot be guessed or auto-merged without risking cross-household access.

## Missing delivery and acceptance gates

The reviewed repository has no deployed password-reset delivery worker, provider integration, scheduler, or server-side mail secret. The Supabase project currently has no custom Edge Function secrets and uses default Auth email configuration, which does not supply a delivery path for these custom legacy principals. An outbox alone is not delivery.

The rejected implementation draft also changed Club-visible copy, generated inaccessible random credentials for some Club-created Parent accounts, and did not resolve existing collisions/households. Its static suite passed 103 tests and built, but source-string tests did not prove runtime SQL semantics; the first exact rollback rehearsal failed. The draft was preserved outside the worktree for forensics and not committed.

## Minimum inputs before another activation attempt

1. A verified delivery provider/worker and masked server-side credentials, with a controlled delivery test.
2. A new Club credential entered through a masked server-side bootstrap; the browser-exposed historical password must not be reused.
3. A verified one-time credential/alias distribution plan for the 38 contactless setup accounts, including explicit resolution for the three collision accounts without a unique contact.
4. After those owner-controlled prerequisites exist, disposable multi-session race/idempotency/direct-access denial tests, full Parent and Club regression, DB-first/client-second deployment, and final hash/UI proof.
