# Past single-occurrence group enrollment — completed review

Completed 2026-09-13 from fresh `origin/main` `80fc5c5a5b465fff931c93e0cb3de97859f5de73`.

## Frozen scope

Club staff may add exactly one existing account to exactly one canonical, non-cancelled past `Group class` block. Past enrollment exposes neither new-student mode nor future scope. Parent-auth, Coach, private lessons, enrollment rows, package auto-debit, and recurring-management behavior are unchanged.

The picker searches canonical student name or stable account ID and displays name plus short account ID only. Email and phone are not search keys or result content. A separate bilingual confirmation shows student, historical schedule, coach, established price, derived status, +1 billing/CSV, backdating, current roster, and package-neutral warnings. One RPC call uses an exact immutable block snapshot and a retry-stable idempotency key.

## Engineering stop-gate correction

The first attempt stopped because its disposable private-lesson conflict fixture supplied `recurrenceOccurrenceId` without the required `seriesId`. Production correctly rejected it through `enforce_recurring_occurrence_identity`; the RPC was not defective. The retry stages a valid immutable `seriesId`, `recurrenceOccurrenceId`, and `recurrenceOriginalStartsAt`, verifies that contract before insertion, and includes regressions for each missing immutable group field and the acceptance fixture contract. Production guards were not weakened.

## Verification

- Focused enrollment tests: 13 passed.
- Full suite: 108 passed.
- Strict TypeScript and production build: passed.
- Fresh baseline and private backup matched exactly.
- Exact migration terminal-rollback proof passed.
- Committed migration applied and passed read-only verification.
- Rollback-only acceptance passed before rollback; no fixture committed.
- Vercel deployment succeeded.
- Bilingual desktop/mobile Club verification reached final confirmation but did not click it; zero enrollment RPC calls occurred.
- Two independent fresh clients produced no `project_rows` mutation.

## Final production state

- Accounts: 65; ordered MD5 `5e2e529f06612f9b87e1139f7d13346f`.
- Activity: 66; ordered MD5 `3ec14dd76ff56032197c0d4450db5d32`.
- Bookings: 1,993; ordered MD5 `5a08c9fbd96e204e43c8a9ab515db65d`.
- Package keys/events: 0/0.
- Retained fixture rows/activity: 0/0.
- Final RPC definition MD5: `de97c6f604552edf8e23b07fe5e86ec4`.

See `artifacts/past-group-enrollment/ROLLOUT-EVIDENCE-2026-09-13.md` for URLs, hashes, and evidence paths.
