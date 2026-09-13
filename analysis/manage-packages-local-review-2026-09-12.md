# Club Manage Packages — local implementation review

Prepared 2026-09-12 from a clean isolated branch whose base was freshly fetched `origin/main` at `b178a86ca265f77d01ccfd18761e4afe6256ce10`. The separate Parent-auth branch was not merged, modified, deployed, or pushed.

## Scope and semantics

- Exact categories only: `coach_director`, `national_coach`, and `group_class`, with the selected English/Chinese labels.
- One immutable key per project + permanent student account ID + category.
- Append-only events: opening changes store old → new; adjustments are signed; explicit usage is negative. Remaining is opening + adjustments − explicit usage.
- Opening accepts 0–500 hours in 0.5-hour increments. Zero is valid.
- No booking is inspected to infer package category or usage. Existing legacy package rows must be exactly zero; otherwise migration stops rather than reclassifying anything.
- The old undifferentiated add RPC is disabled for browser roles, but its empty ledger and functions remain intact for audit and rollback.
- Browser roles receive only the category list/history/opening RPCs. Key/event tables use RLS with no browser policies or direct grants. The service role retains direct select/insert; immutable triggers reject update/delete.
- The accepted legacy Club-session risk remains explicit: browser writes record `legacy_club_session_unverified`. No verified actor is fabricated.

## Production baseline frozen in artifacts

- Project `ab9d8da3-762f-466c-b7ce-fa05088f03cd`
- Account table `8236c8f8-0fab-400c-bedc-143fd5930707`
- 65 accounts; client-page MD5 `889ef52e232d48fec0a2da04bf33992a`
- Duplicate Ella IDs `3a6d38c0-a343-42fe-b373-e1649928041d` and `b8433b38-75f0-4e37-8792-3b952d26c74d`
- 1,978 bookings; 500/500/500/478 page MD5s `cb9afd75e44d3e82472df227e20906b4`, `39d959e808832d51416426eb12e4a92f`, `0b91e1fc9c8c0eaf07843eaf688af463`, `b7481b76c02d0031443cf41335b17e5b`
- 0 bills
- 65 activity rows; page MD5 `c4e86cb519690b3fc148265ac0d80a73`
- 0 legacy package-ledger rows and 65 zero balances

The SQL guards IDs, counts, duplicate identity, deployed legacy signatures, and the zero legacy ledger. The external page hashes are retained byte-for-byte in migration comments and the private backup manifest because they were calculated from the audited client-page representation, not a newly invented SQL serialization.

## Artifacts and hashes

- Private backup: `sql/backups/20260913043700_manage_class_packages.private-backup.sql`
- Migration: `supabase/migrations/20260913043700_manage_class_packages.sql`
- Emergency rollback: `sql/rollback/20260913043700_manage_class_packages.rollback.sql`
- Disposable rollback proof runner: `scripts/prove-manage-packages-rollback.sh`
- Read-only postverification: `sql/verification/20260913043700_manage_class_packages.verify.sql`

Reviewed SHA-256 values:

- Private backup: `b80763065bf8e2fc0cd52e09d8b63965a8db501d45fd4a5d576a9c21e1e6d0d7`
- Migration: `a4f1c8da1024e5ca0287522b7064741051dcbc2061c3144ae050549102d53e00`
- Rollback-only migration variant (only terminal `commit;` → `rollback;`): `8d58f8277c3c9e48efea3a316096eeb185aa34e2cca46ac576c5e5e36678b6bf`
- Emergency rollback: `cb4b34edf4a4ee6b63e2274906eac3d5a785a71aa6174986065b8b8a173951a6`
- Read-only postverification: `9b3bd51639996b211684ac51bfd9c1ef87467a5668888119e2fd124a9f0b5274`
- Disposable proof runner: `4562de89f056ab2209678c77a797e2f74d715e7fcb978349a1d1b0fbfc226fa5`

## Approval-gated production sequence

Nothing below has been executed.

1. **Fresh read-only freeze:** fetch `origin` again; prove the reviewed base is still an ancestor; rerun fully paginated production reads and require every ID/count/page hash and zero-ledger guard above to match.
2. **Approve backup only:** separately approve execution of the exact committed private-backup SQL. Load it into the authenticated SQL editor, read it back, and match its local SHA-256 before Run. Verify 65 copied account rows, source/backup digest equality, zero copied ledger rows, two catalog rows, RLS enabled, and no `anon`/`authenticated` schema usage.
3. **Approve rollback-only proof:** separately approve executing the exact migration with only its single terminal `commit;` changed to `rollback;`. Verify the derived text/hash before Run. Then run read-only catalog checks proving both v2 tables, all three v2 RPCs, and the v2 immutable trigger function remain absent; rerun the complete baseline.
4. **Approve migration:** separately approve the byte-identical committed migration. Verify the SQL editor content SHA-256 equals the reported migration hash. Run once; do not retry after a timeout or unknown outcome until read-only reconciliation proves pre-state or complete post-state.
5. **Postverify before any client deployment:** execute the read-only verification SQL. Require 195 account/category balance rows, all zero before any approved opening edit; zero legacy rows; postgres-owned fixed-search-path SECURITY DEFINER RPCs; RLS on/no browser policies; no browser table privileges; old add/list execute revoked; new narrow execute grants only as reviewed.
6. **Disposable acceptance only:** in an approved disposable database/account, test all categories, duplicate names/IDs, same-account category isolation, opening up/down with usage, zero/invalid values, stale version, concurrent duplicate submit, replay mismatch, and direct-table denial. Do not mutate a real student.
7. **Approve compatible client push/deploy:** only after the database is verified, fetch origin again, rerun focused/full tests, strict TypeScript, build, diff and secret scans, then separately approve pushing the exact reviewed commit and deploying it. Parent-auth remains a separate effort and must not be combined.
8. **Read-only UI verification:** verify Club exact-account/category selection, bilingual desktop/mobile layout, metrics/history, and invalid-submit behavior. Verify Parent has no Manage Packages surface and activity/export/billing behavior is unchanged. Recheck all database counts and hashes after the client settles.

## Local limitations

No `psql`, Supabase CLI, Docker runtime, or configured disposable database was available in this worktree, so no SQL was executed. SQL received static transaction/dollar-quote checks; the guarded rollback runner is ready for an approved disposable environment. No production write, migration, deployment, or push occurred.
