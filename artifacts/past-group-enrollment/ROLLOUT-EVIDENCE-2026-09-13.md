# Past group enrollment guarded rollout — 2026-09-13

Status: **Completed**.

- Base: fresh `origin/main` `80fc5c5a5b465fff931c93e0cb3de97859f5de73`.
- Reviewed rollout commit: `e670c8b90d6dd5ab61dbdf9f1f89505365048333`.
- Production: `https://rswtta-booking-preview.vercel.app/club`.
- Vercel deployment: `https://vercel.com/jiachenduans-projects/rswtta-booking-preview/6aLHq9VxGBmk1CL1uifPoTPPj5v4` (success).
- Production project: `ab9d8da3-762f-466c-b7ce-fa05088f03cd`.
- Tables: bookings `a7a8a308-2305-4ab6-ad20-5ce174558035`; accounts `8236c8f8-0fab-400c-bedc-143fd5930707`; activity `133ad2fa-44b2-4aab-ab5d-b79c563ab908`.

## Fixture regression and local gates

The former stop was engineering-only: the private-lesson conflict fixture omitted `seriesId`, so the existing recurrence trigger rejected it before RPC acceptance. The corrected fixture supplies `seriesId`, `recurrenceOccurrenceId`, and `recurrenceOriginalStartsAt`; a pre-insert SQL assertion and a focused regression now mirror the production recurrence contract. Runtime guards were not weakened.

- Focused enrollment tests: 13 passed.
- Full Playwright regression suite: 108 passed.
- Strict TypeScript: passed.
- Next.js production build: passed.
- `git diff --check`: passed.
- Secret scan: no credential material found (one source-code `service_role` marker is test data, not a secret).
- Repository `npm run lint` remains unavailable because Next.js 16 treats the legacy `next lint` script as a project path and the repository has no ESLint 9 flat config; no lint configuration was changed in this scoped rollout.

## Backup and rollback proof

- Fresh backup: `private_migration_backups.past_group_*_20260913_0952`.
- Backup SQL SHA-256: `8a8782a7b54e1cc856008d4d945ddd02e76e6a137e2c2ddfb87b67ad6c19c814`.
- Source and backup match: accounts 65 / `5e2e529f06612f9b87e1139f7d13346f`; activity 66 / `3ec14dd76ff56032197c0d4450db5d32`; bookings 1,993 / `5a08c9fbd96e204e43c8a9ab515db65d`.
- All five backup tables have RLS enabled; `anon` and `authenticated` have no backup-schema usage.
- Migration SHA-256: `ea128eda8124d298129f7bb44d113f524859bc7937e80d7ea97c2137c72d90a7`.
- Terminal-rollback variant SHA-256: `91c39a8f1b932ad343b9c5f4caecbcf152ac64e38c2574a34ab9e273b39ef197`; it differed only by terminal `commit` → `rollback`.
- Fresh rollback proof restored prior RPC MD5 `b28acdc236e69be7122547beaf5af2a7` and every protected count/hash.

## Migration and rollback-only acceptance

The committed migration applied and read-only verification proved the RPC remains security-invoker with intended grants and unchanged protected data. Rollback-only production acceptance passed before its terminal rollback, including the former private-lesson conflict, past confirmed/completed success, future-series compatibility, immutable snapshots, missing/incomplete identity, cancelled block, stale payload, capacity, cancelled-history duplicate, idempotent replay, changed-key payload rejection, one activity row, billing/CSV reconciliation, and package neutrality.

- Acceptance SQL SHA-256: `1ebc5650e8014a030497aaf6da5e0d3c564db7bc87b1e871fb08ae19e79ad83b`.
- Acceptance result: `passed before rollback`; fixture accounts 2; fixture blocks 8; package keys/events 0/0.
- Final RPC definition MD5: `de97c6f604552edf8e23b07fe5e86ec4`.
- Final protected counts/hashes exactly equal the backup.
- Retained fixture rows: 0; fixture activity rows: 0.

## Production Club verification (no real mutation)

Desktop and iPhone-width Club flows were inspected in English and Chinese. A real past canonical Group block exposed only the one-occurrence existing-student flow. Duplicate-name results were disambiguated by short account ID, with no email/phone. The confirmation displayed historical date/time, coach, $75.00, derived status, +1 billing/CSV, current roster, backdating warning, and no automatic package deduction. The final confirmation was never clicked; request logs contained zero calls to `add_student_to_group_occurrences`.

Two independent fresh profiles were also loaded after deployment. Their startup traffic contained reads plus the read-only authoritative-clock RPC, with no `project_rows` mutation. A delayed database reconciliation remained unchanged.

Local private evidence: `artifacts/past-group-enrollment/retry-20260913/` (SQL editor captures and four bilingual desktop/mobile screenshots). Parent-auth and package auto-debit were explicitly out of scope.
