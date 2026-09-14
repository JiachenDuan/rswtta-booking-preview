# Parent/Student “Update class time” — review and activation stop

## 2026-09-13 23:41 PDT corrected attempt: rolled back and stopped

Production remains unchanged and the feature remains undeployed. A fresh read-only audit of the live recurrence trigger and all 81 valid activity rows proved the established activity convention is **no recurrence tuple**: 81 rows had none of `seriesId`, `recurrenceOccurrenceId`, or `recurrenceOriginalStartsAt`; zero had a complete or incomplete tuple. The corrected RPC now follows that convention while the selected booking retains its complete immutable tuple and original slot.

The corrected migration SHA-256 `69f039264e97b1de441a10ac5a5ceeef7b3e0029d9f50a70a9b543c620ebd8d1` passed terminal-rollback rehearsal and pre-feature fixture admissibility, applied from the unchanged exact baseline, and passed post-apply backup/catalog/grant verification. Rollback-only acceptance then stopped before feature assertions on a new test-harness defect: its atomic-state hash ordered `parent_legacy_sessions` by nonexistent `session_id` rather than `id`. PostgreSQL rolled the acceptance transaction back atomically. Read-only reconciliation proved zero exact fixtures, sessions, nonces, or idempotency rows and unchanged real families.

Per the explicit stop rule, acceptance was not retried. The reviewed rollback `5d68a2b7eed486c24fd8894ab66491bc5da15b1427c0034661ce132622f9f7c5` completed. Final read-only reconciliation at `2026-09-14T06:41:30.651404+00:00` proved all feature objects and backups absent, zero exact fixtures, and unchanged counts/hashes (2,031 bookings, 67 accounts, 81 activity rows, 0 bills). Final exhaustive GET-only audit SHA-256: `0a57fec54b3fb777c5e448a450b6a021d20bd048c989cf7e0cced59b9e78fda1`.

The local acceptance source is corrected to use `id`, but remains unexecuted. Nothing was committed, pushed, merged, or deployed. The accepted residual risk remains prominent: anon/authenticated direct `project_rows UPDATE` can bypass the RPC, so the overall system is not secure. Evidence: `artifacts/parent-update-class-time/corrected-attempt-stop-and-rollback-20260914.md`.

## 2026-09-13 23:27 PDT rollout attempt: rolled back and stopped

**Production is unchanged and the feature is not deployed.** The preserved worktree was safely rebased from `41e7dfa` onto refreshed `origin/main` / `6cd618869ff86f3f5f3b23eae66908c72f5c1ffa`; the unrelated preregistration/session/alias work remained intact and the full Parent-auth branch remained unmerged.

Yishu’s exception was applied exactly as requested: the candidate migration prominently states that pre-existing `anon` and `authenticated` direct `public.project_rows UPDATE` remains available and can bypass the new RPC. No broad grant was added, no existing project-row authority was revoked, and this rollout must not be described as making the overall system secure.

A stronger compatible candidate path was built around `parent_legacy_session`: server-side PBKDF2 verification of the exact unique completed-profile account email, random 12-hour token, client binding, immutable account-ID binding, credential-fingerprint invalidation, logout/revocation, server-derived dashboard, private nonce/idempotency state, and narrow grants for five exact RPC signatures. `profileSetupRequired` accounts were denied this dashboard/mutation session and left on the existing setup-only RPC path.

The exact migration (`e16518879c8514192f52efd01f41e677d3d222fc99c42efb46f5db329418dc59`) passed a terminal-rollback rehearsal (`4f799285035c523d2c127662adfc27c3552103f417767f8367eedba0798c4b1a`) and absence proof. The pre-existing-schema fixture setup also passed. The production refreeze remained 2,031 bookings / 67 accounts / 81 activity rows / 0 bill rows.

The byte-identical migration was then applied, catalog/backups/grants verified, and rollback-only acceptance started. Acceptance correctly failed on the first valid recurring-occurrence update: the existing `enforce_recurring_occurrence_identity()` trigger rejected the new activity row because it copied `seriesId` and `recurrenceOccurrenceId` without `recurrenceOriginalStartsAt`. PostgreSQL exception atomicity rolled back that entire acceptance transaction, including the selected booking update, activity insert, sessions, nonces, idempotency rows, and all five fixture rows.

Per the non-excepted gate rule, the rollout was immediately rolled back with reviewed rollback SHA-256 `5d68a2b7eed486c24fd8894ab66491bc5da15b1427c0034661ce132622f9f7c5` and stopped. Read-only reconciliation at server time `2026-09-14T06:27:07.365296+00:00` proved all feature functions/tables/backups absent, zero fixtures, setup aliases/sessions unchanged (1/0), package ledger/keys/events unchanged (0/0/0), and the accepted legacy direct-update grants still present. Final exhaustive REST proof SHA-256 `c2bf5a138f1a4582a8074c429f1bab8f7754bb28d054542655543f338a697cd6` matched the pre-apply canonical hashes exactly for bookings, accounts, activity, and bills.

Evidence:

- `artifacts/parent-update-class-time/production-refreeze-20260914T062152Z.json`
- `artifacts/parent-update-class-time/migration-terminal-rollback-rehearsal-20260914T0630Z.txt`
- `artifacts/parent-update-class-time/migration-terminal-rollback-absence-proof-20260914T0621Z.txt`
- `artifacts/parent-update-class-time/preexisting-schema-fixture-admissibility-20260914T0622Z.txt`
- `artifacts/parent-update-class-time/migration-apply-20260914T0623Z.txt`
- `artifacts/parent-update-class-time/post-apply-catalog-backup-proof-20260914T0625Z.txt`
- `artifacts/parent-update-class-time/rollback-only-acceptance-20260914T0628Z.txt`
- `artifacts/parent-update-class-time/rollback-after-acceptance-failure-20260914T0631Z.txt`
- `artifacts/parent-update-class-time/postrollback-readonly-reconciliation-20260914T0632Z.txt`
- `artifacts/parent-update-class-time/production-postrollback-audit-20260914T062719Z.json`

No commit was created, nothing was pushed, and no Vercel deployment was started because database acceptance did not pass.

## Earlier decision

Implementation is review-ready but **not active and not deployed**. Production remained read-only. The mutation migration creates its private backup and staged RPCs only after the verified opaque Parent-session dependencies exist, and it grants neither `anon` nor `authenticated` execution. The current production Parent identity is caller-controlled and unsafe, so enabling this operation would permit cross-account attempts.

Branch base was verified before work: `HEAD == origin/main == fc8bae423ef893b5e79c4e82349acf8f9edcd137`. No Parent-auth or preregistration branch was merged or cherry-picked.

## Read-only production freeze

The mandatory initial audit completed before source edits at server time `2026-09-13T20:03:14.000Z`. The final candidate predicate was then refreshed read-only at server time `2026-09-13T20:17:14.000Z`; its strict 12-hour boundary was `2026-09-14T08:17:14.000Z`. Table counts and hashes were unchanged.

Artifact: `artifacts/parent-update-class-time/production-readonly-audit-20260913T201715Z.json`

- Artifact SHA-256: `e68ee2c6f5c62300454158934a3def4e69c284c93479e8bb561646d2ee9a8687`
- Bookings: 2,018 rows / 2,018 unique IDs / 5 pages (500, 500, 500, 500, 18); ordered-ID SHA-256 `5e2d3235ad49474a70a7ba4c5b9cc113e8f89c6c66a3151f2c8837bda37a91bb`; canonical-row SHA-256 `a1218acaf1bfe24682fc276138232527e48b7b90c2f0f83454172934854479d9`.
- Parent accounts: 66 rows / 66 unique IDs / 1 page; ordered-ID SHA-256 `a2f9a370d89a8597bcbb03b1587bec229e65e38a702150a088d2bebca4f98043`; canonical-row SHA-256 `d0f52b0fa8c15d75d65063019be29a60858c62153eaa818c01450afe0b29e55d`.
- Activity: 76 rows / 76 unique IDs / 1 page; ordered-ID SHA-256 `89f9eb9046b5e572e4344d51b3455cd74f1f59ff8e3fc25c1c2db18b876d9092`; canonical-row SHA-256 `b03b685ee5018f45ffb05b139448eb7a451226925ee150767fa165ec92dadfe8`.
- HTTP method used: GET only. Mutations: 0. Deployments: 0.
- The artifact contains exact IDs, counts, hashes, and page metadata only. It contains no row values, names, contacts, notes, credentials, keys, or tokens.

Booking partitions:

- Statuses: 0 `requested`, 0 `change_requested`, 1,755 `club_confirmed`, 31 `coach_confirmed`, 232 `cancelled`.
- `club_confirmed`: 150 past/current, 10 future but at-or-within 12h, 1,595 beyond 12h.
- `coach_confirmed`: 31 past/current.
- `cancelled`: 66 past/current, 6 future at-or-within 12h, 160 beyond 12h.
- Programs: 975 `Private lesson`, 748 `Group lesson`, 141 `Group class`, 34 `Group enrollment`, 120 `Unavailable`.
- Exact UI/server candidate family (persisted account-linked private scheduling rows, including repository-defined non-enrollment `Group lesson`, active status, start beyond cutoff): 1,343 rows; exact IDs are in the artifact.
- Recurrence: 195 one-off, 1,823 recurring, 1,823 with complete series/occurrence/original-start identity, 0 incomplete, 107 series, 0 duplicate occurrence IDs.
- Relationships: 1,756 booking rows with account ID, 262 system/unlinked rows, 0 orphan account IDs, one same-name cross-account group (therefore names cannot authorize).
- Activity actions: 28 created, 41 cancelled, 3 updated, 2 group occurrence updated, 2 group student added.

Privileged production catalog credentials were unavailable in this worktree, so live `pg_proc` ACL, RLS policy, trigger definition, package-ledger hash, bill-notification hash, and transaction rehearsal could not be independently queried. This is an activation blocker, not a reason to weaken the function. Repository SQL shows legacy broad direct-table/RPC authority; the read-only inspected Parent-auth branch documents that production activation was stopped.

## Source/action matrix

| Surface / row | Current action | Update-time result |
| --- | --- | --- |
| Parent Calendar, own persisted private scheduling row (`Private lesson` or non-enrollment `Group lesson`), `requested`, start > server+12h | existing class modal | button shown; selected row only; status remains `requested` |
| Same, `change_requested` | existing class modal | button shown; status remains `change_requested` |
| Same, `club_confirmed` | cancel / mark complete | button shown; update transitions to established `change_requested` approval state |
| Parent row at/past/current/exactly <=12h | contact-Club cancellation warning where applicable | no update button; server rejects both old and target boundary |
| `coach_confirmed` / `cancelled` | completion/history state | no update button; server rejects |
| Group block / Group enrollment / enrollment-note `Group lesson` / Unavailable | existing group or read-only behavior | excluded in UI and RPC |
| Virtual synthesized occurrence | may render calendar identity | excluded; no unsafe materialization |
| Other account, including same display name | privacy view or different account | no authority; server derives account from verified principal binding |
| Club surface | existing single/future/all tools | unchanged |
| My Classes list | read-only | unchanged |

The existing Club confirmation flow already recognizes `change_requested`; no status was invented. The update keeps coach, duration, program, price, billing identity, row ID, account ID, recurrence identity, original slot, created history, and every unrelated JSON field. It changes only `startsAt`, schedule labels, established status, `updated_at`, and appends a fixed history note.

## Server contract

`parent_update_booking_time` is one PostgreSQL transaction and one selected persisted row:

- validates a short-lived nonce issued only to `rswtta_private.valid_session(..., 'parent')`;
- derives account identity through immutable principal/account binding;
- serializes idempotency by principal/key and rejects a changed request fingerprint;
- locks account/coach scopes and the selected row;
- checks the complete stale snapshot: row ID, version, status, current start, series ID, occurrence ID, and original start;
- validates strict old and target `server clock + 12h`, 30-minute starts, preserved 30-minute duration increments, date/time labels, ownership, private-only program, active status, recurrence completeness, coach availability, and student overlap;
- updates only the selected row, writes exactly one redacted activity row, writes no package event, and returns the verified Parent dashboard;
- relies on PostgreSQL exception atomicity: nonce consumption, row change, activity, and idempotency result all roll back together on any failure.

No local fallback, caller-provided account, caller-provided resulting status/price, delete, update loop, or virtual materialization exists.

## Read-only Parent-auth compatibility inspection

Inspected `origin/openclaw/parent-auth-recurring-cancel` at `2ea1335a32ab4ddc72dd1a0ac29b3ba72749b00a` using `git show` only. It supplies the intended `rswtta_private.valid_session`, immutable principal/account binding, operation nonces, idempotency results, `parent_dashboard`, and opaque `sessionStorage` token contract. It was not merged.

That branch is not deployable as-is against this freeze: its documented guards are 65 accounts / 1,978 bookings, while the current exhaustive freeze is 66 / 2,018. Its own activation-stop document also records unresolved contactless/shared-credential/collision and delivery-provider blockers.

## Local verification

- `npm ci --ignore-scripts` — 361 packages installed from lockfile; 0 vulnerabilities.
- `npx --no-install playwright test tests/parentClassTimeUpdate.spec.ts tests/parentBookingModal.spec.ts tests/parentCancellationMutation.spec.ts tests/parentClassRequest.spec.ts --workers=1` — 29 passed.
- `npx --no-install playwright test tests/parentClassTimeUpdate.spec.ts --workers=1` — 14 passed after the final RPC-contract assertion.
- `npx --no-install playwright test --workers=1` — 122 passed after all source changes.
- `npx --no-install tsc --noEmit --pretty false --incremental false` — passed.
- `npm run build` — passed; `/`, `/club`, and `/parent` statically generated.
- `git diff --check` — passed.
- Diff-only secret scan — 0 added secret-pattern matches. The repository's pre-existing browser-exposed Club password remains an auth activation blocker and was not modified.

Privileged SQL execution/rollback/concurrency acceptance was not run because no privileged production or disposable database credentials/tools were available. Production remained read-only; the migration is intentionally staged and fully revoked.

## Local UI evidence

Synthetic local-only fixtures were used with the Supabase URL pointed at an unreachable loopback port; no production row was rendered or changed.

- Desktop English final confirmation: `artifacts/parent-update-class-time/parent-update-time-desktop-en.png`, SHA-256 `fb7a04966402cc5bf8a1fcde325cf94ef802f70490fcd73b98bfc6c0a43f595e`.
- Mobile 390px Chinese final confirmation: `artifacts/parent-update-class-time/parent-update-time-mobile-zh.png`, SHA-256 `e8204fcb9d06057864538a0048ee6637da3e1284473e1f31a383478a7c1e10a7`.
- Both show old → new schedule, coach, fixed duration, resulting approval status, selected-occurrence wording, and a separate final confirmation. Visual inspection found no clipping or production data.

## Precise activation dependency

1. Resolve and independently accept the opaque Parent-auth blockers (verified reset delivery, fresh masked Club credential, safe first-login distribution, and collision resolution). Rebase/re-audit that work against current production; do not reuse its stale 65/1,978 guards.
2. Integrate its verified server dashboard/session client contract with this branch manually after review. Parent-visible bookings must come from `parent_dashboard`, not legacy direct reads or a stored account object.
3. Re-run exhaustive read-only pagination immediately before staging and replace all exact migration guards. Run the exact migration with final `commit` changed to `rollback`, compare booking/account/activity/package/billing hashes, then stage it still fully revoked.
4. In the reviewed opaque-auth activation allowlist, grant only these exact additional signatures to browser roles: `parent_issue_class_time_update_nonce(text)` and `parent_update_booking_time(text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text)`. Never restore generic table authority or broad function execution.
5. Run disposable SQL acceptance for exact boundaries, ownership/same-name isolation, one-off and recurring selected-only identity, state transitions, conflicts, stale/idempotent/concurrent calls, rollback, exactly one activity, and unchanged billing/package hashes. Then deploy the compatible client and perform bilingual desktop/mobile acceptance. No production action is authorized by this branch.
