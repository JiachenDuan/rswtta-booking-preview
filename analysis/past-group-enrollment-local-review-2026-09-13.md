# Past single-occurrence group enrollment — local review

Prepared 2026-09-13 in the isolated worktree. Nothing was deployed, pushed, committed, or written to production.

## Frozen scope

Club staff may add exactly one existing account to exactly one canonical, non-cancelled past `Group class` block. Past enrollment exposes neither new-student mode nor future scope. Parent, Coach, private lessons, enrollment rows, and recurring management behavior are unchanged.

The picker searches canonical student name or stable account ID and displays name plus short ID only. Email and phone are not search keys or result content. Client preflight reports active or cancelled historical membership, schedule overlap, and capacity fields when present. The RPC repeats every check under deterministic transaction locks.

## Confirmation contract

The separate bilingual confirmation shows student + short account ID, historical date/time, coach, established same-group price (default product price $75.00), block-derived status, exactly one billing/CSV-eligible row, a backdating warning, and explicit no automatic package deduction. Confirmation sends one RPC call with one idempotency key reused for retries.

Status is `coach_confirmed` only when the canonical block is `coach_confirmed`; otherwise it is `club_confirmed`. Both are supported by the existing billing/CSV path. This migration does not write package keys/events and the current package resolver remains classification-only.

## Production baseline supplied by audit

- 1,993 bookings; 65 accounts; 66 activity rows.
- 141 group blocks; 15 past; every past block `club_confirmed`.
- 33 group enrollments; 17 past: 7 cancelled, 4 `club_confirmed`, 6 `coach_confirmed`.
- Every observed group enrollment price is 7,500 cents.
- No capacity-like field is currently present.
- No active duplicate; one historical duplicate pair includes cancelled history.
- Package keys/events: 0/0.

The timestamped private backup captures complete ordered hashes of bookings, accounts, and activity plus the exact pre-migration RPC catalog. The migration refuses to run unless live global hashes still match that committed backup.

## Rollout stop gates

1. Re-run the exhaustive audit and require the supplied counts/semantics to match.
2. Separately approve and run the private backup; record the returned ordered hashes.
3. Run `scripts/prove-past-group-enrollment-rollback.sh` only against an approved disposable database. A missing PostgreSQL fixture environment is a blocker, not permission to use production.
4. Apply the migration only after separate authorization. Unknown outcomes require read-only reconciliation before retry.
5. Execute rollback-only acceptance for past success, future unchanged, historical/active duplicate, conflict, capacity, stale/missing snapshot, cancelled/noncanonical block, concurrent same/different-key retry, exact replay IDs, one activity, +1 billing/CSV, and unchanged package rows.
6. Run verification SQL, then separately authorize compatible client deployment. Capture bilingual desktop/mobile proof and excluded surfaces.

## Local evidence

- Focused enrollment tests: 12 passed.
- Full regression suite: 107 passed.
- Strict TypeScript: passed.
- Next.js production build: passed.
- Migration compiled and applied during the guarded attempt below, then was restored after the acceptance stop gate.

## Guarded rollout attempt — stopped and rolled back

The fully paginated production refresh at 2026-09-13 09:37 PDT matched the frozen baseline. The private backup committed and was reconciled after the editor's first response was ambiguous:

- Backup SQL SHA-256: `cb5c7a05d2b4e5be271f13304c2f714ed66a26d7285fef5c29e7e6b017ef6fe6`.
- Source and backup ordered MD5s matched exactly: accounts `5e2e529f06612f9b87e1139f7d13346f` (65), activity `3ec14dd76ff56032197c0d4450db5d32` (66), bookings `5a08c9fbd96e204e43c8a9ab515db65d` (1,993).
- All five backup tables have RLS enabled; `anon` and `authenticated` have no schema usage.

The exact migration SHA-256 was `cbb24fd6e21bba605344c51f40d99cc933afa8b922980a6e45b078737686680e`. Its terminal-rollback variant differed only by `commit` → `rollback`; afterward the original RPC MD5 remained `b28acdc236e69be7122547beaf5af2a7` and every protected hash remained unchanged. The committed migration then applied and passed read-only contract/hash verification.

Rollback-only acceptance stopped before feature assertions because the disposable private-lesson conflict fixture supplied `recurrenceOccurrenceId` without the mandatory `seriesId`, and the existing `enforce_recurring_occurrence_identity` trigger rejected it. No fixture committed. Per the requested stop rule, the prior RPC was restored immediately and the client was not pushed or deployed.

Final post-rollback proof:

- RPC definition MD5 restored exactly to `b28acdc236e69be7122547beaf5af2a7`.
- Accounts/activity/bookings counts and ordered hashes remain byte-for-byte equal to the private backup.
- Package keys/events remain 0/0.
- Zero fixture rows remain (also implied by the exact global row counts and hashes).

The local acceptance fixture now includes complete recurrence identity for a future reviewed attempt, but it has not been rerun against production. Production application, client push, Vercel deployment, and screenshots were intentionally not performed after the gate failure.
