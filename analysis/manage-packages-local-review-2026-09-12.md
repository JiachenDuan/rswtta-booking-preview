# Club Manage Packages — canonical semantics revision

Prepared 2026-09-12 on the isolated `openclaw/club-manage-packages` branch, building on `ae03a6fd906c69a8b5ab9cd2a5ca53ee9cc7ef53`. Parent App/Parent-auth was not changed. Nothing was deployed, pushed, or written to production.

## Canonical contract

- `coach_director_private` / `hours`: private lessons assigned to canonical Tian Ye/Tianye. Prefer immutable `assignedCoachId`, `coachId`, then `requestedCoachId`; the reviewed fallback accepts only `Coach Tian Ye`, `Tian Ye`, `Tianye`, `Coach Tian`, and `Head Coach Tian` after punctuation/whitespace normalization. An explicit non-Tian ID overrides a Tian-like display name.
- `national_coach_private` / `hours`: every other private coach. Production names observed: Coach Jorden, National A, and National B.
- `group_class` / `class_credit`: any group class consumes exactly one integer credit, regardless of coach or duration. Group classification runs first. Immutable `groupClassId` wins; exact known programs `Group class` and `Group enrollment` are accepted. Ambiguous legacy `Group lesson` remains private unless `groupClassId` exists.
- Private consumption uses the current `startsAt` and strict current `timeLabel` duration. Live values are 12-hour clock ranges such as `6:30 PM - 7 PM`, `4 PM - 5 PM`, `7 PM - 8:30 PM`, and `10 AM - 12 PM`; their exact elapsed minutes parse to 0.5, 1, 1.5, and 2 hours. Missing/malformed/zero-length or overnight-like ranges are rejected rather than defaulted. `recurrenceOccurrenceId`, then `groupClassId`, then booking ID provides stable identity after moves.
- Only `coach_confirmed` is eligible. `cancelled`, `club_confirmed`, `requested`, and `change_requested` are ineligible. Resolution is classification-only and never debits.

`public.resolve_class_package_consumption(jsonb)` is the authoritative pure `IMMUTABLE` server resolver. It has a fixed restricted search path and service-role-only EXECUTE. `resolveClassPackageConsumption` in `lib/classPackages.ts` is a pure mirror for direct tests; persisted behavior must follow SQL.

## Ledger and UI

Keys and events store both canonical `category` and `unit_basis`, with a composite foreign key enforcing the pair. All event quantities are explicit integer `amount_base_units`: minutes for `hours`, credits for `class_credit`. Private openings accept nonnegative 0.5-hour increments; group openings accept nonnegative integer credits. Bilingual Club UI labels hours and class credits independently.

Append-only history, account/category isolation, stale-write checks, idempotent replay validation, and immutable triggers remain. No usage writer or automatic decrement is introduced. The old undifferentiated ledger must still contain exactly zero rows or migration stops rather than reclassifying history.

## Read-only production audit interpretation

- 1,978 bookings; all have `startsAt`.
- No `coachId`, `assignedCoachId`, `requestedCoachId`, or `coachRole` field appears in the audited rows, so current classification necessarily uses the narrow alias fallback.
- Exact production Tian identity is `Coach Tian Ye`: 480 private rows, including 9 `coach_confirmed` and 12 unavailable rows in the supplied audit interpretation.
- 159 rows have immutable `groupClassId`; 1,783 have `recurrenceOccurrenceId`.
- `Group lesson` occurs on cheaper private rows and is not sufficient group evidence.
- Production duration labels are clock ranges (44 observed variants), including half-hour, one-hour, 1.5-hour, and two-hour spans.

Real remaining ambiguity: current production lacks immutable coach IDs, so a future unrelated coach whose normalized full display name is exactly one reviewed Tian alias would be classified as Tian until immutable IDs are populated. The fallback intentionally does not use partial-name matching, and explicit immutable IDs take precedence as soon as present.

## Frozen guards

- Project `ab9d8da3-762f-466c-b7ce-fa05088f03cd`; account table `8236c8f8-0fab-400c-bedc-143fd5930707`
- 65 accounts; duplicate Ella IDs `3a6d38c0-a343-42fe-b373-e1649928041d`, `b8433b38-75f0-4e37-8792-3b952d26c74d`
- Account MD5 `889ef52e232d48fec0a2da04bf33992a`
- Booking page MD5s `cb9afd75e44d3e82472df227e20906b4`, `39d959e808832d51416426eb12e4a92f`, `0b91e1fc9c8c0eaf07843eaf688af463`, `b7481b76c02d0031443cf41335b17e5b`
- 0 bills; 65 activity rows, MD5 `c4e86cb519690b3fc148265ac0d80a73`; 0 legacy ledger rows

## Artifacts and reviewed SHA-256 manifest

Hashes below are regenerated after final verification and before commit.

<!-- HASH_MANIFEST_START -->
- `components/ClassPackagesPanel.tsx` — `47ed2476f19f9b0ed5c9b231b962f0aa770a195f3f7370324d525796674de4b3`
- `lib/classPackages.ts` — `09628647f6010ca972f3e04b10acb4a5f5fa0f348fdac02f19f830a4fdfc9a5c`
- `lib/coachPolicy.ts` — `6dd17fcbb6df16cbed3973c4a66962a25c9dc0da026f6a8bdc7e33cd1d2fb174`
- `lib/projectStore.ts` — `e56520431e24cd56cc156fdb8be67577a88ad12cc62c54bc7290d43eb54cdf71`
- `lib/types.ts` — `ad6d1a43a20c084a9ef842f99e86cbe04dba55261aa3ec44d5fda832670c9177`
- `scripts/prove-manage-packages-rollback.sh` — `c37c3b82712ca49900e4cc1de301ebf24db8c9b8d733a07994fce7b256b1a8e9`
- `sql/backups/20260913043700_manage_class_packages.private-backup.sql` — `bdca4b3aa41ef1947fea48b80111fdbcc7a1ca7301b972dfdd1135197854e037`
- `sql/rollback/20260913043700_manage_class_packages.rollback.sql` — `07285fe267d881ac9afbb69c42e382e37c6c677816e4448c2defe9cba8f1d5bd`
- `sql/verification/20260913043700_manage_class_packages.verify.sql` — `491df58a1b3eadc9f075677b6367981e155e1e4ae83c74163fbe7ca9283be1bc`
- `supabase/migrations/20260913043700_manage_class_packages.sql` — `333014581e24e2b004a13f8fedeedf7a05ab4584bb5159e93f4d8fd2ae4c636e`
- terminal-rollback migration variant — `7a1d383195d04eafaffef5d22569d19a5820778d9975dcdf007e111a2b1b127e`
- `tests/classPackages.spec.ts` — `ecb484f2796b72eb3f4f2da6bb22d4c96508d4e0619491a7e20710bbfab0e31c`

The review document itself is excluded from its embedded manifest to avoid a recursive self-hash.
<!-- HASH_MANIFEST_END -->

## Guarded rollout attempt — stopped and rolled back

The approved rollout began after the baseline matched. The timestamped private backup committed successfully with 65 account rows, zero legacy ledger rows, four RLS-enabled backup tables, no browser-role schema usage, and matching source/backup digest `5e2e529f06612f9b87e1139f7d13346f`. The rollback-only migration proof left every v2 object absent and all page hashes unchanged.

The first committed migration created empty v2 tables and passed read-only object/ACL/resolver verification, but disposable rollback-only acceptance exposed a PL/pgSQL output-column ambiguity in the opening RPC conflict target. The acceptance transaction aborted before any fixture or event committed. Per the stop gate, the emergency rollback restored the exact pre-migration schema and legacy grants. Post-rollback proof found zero fixture accounts, zero legacy package rows, 65 zero legacy balances, no v2 objects, and the protected backup intact. No client was pushed or deployed.

The local migration now uses the named unique constraint and fully qualified event/key columns; a static regression covers the ambiguity. This corrected migration has not been applied to production and requires a new guarded rollout authorization/attempt.

## Guarded future rollout (not executed)

1. Repeat the fully paginated read-only production audit and require every frozen ID/count/hash and the zero-ledger guard to match.
2. Separately approve and run the exact private backup; verify counts, digest, catalog, RLS, and inaccessible backup schema.
3. In an approved disposable database, run the exact migration with only terminal `commit;` changed to `rollback;`, then prove all v2 objects including the resolver are absent.
4. Separately approve the byte-identical migration. Reconcile unknown outcomes read-only before any retry.
5. Run the read-only postverification: 195 zero account/category balances, 65 rows per enforced category/unit pair, resolver samples, ownership/search path/volatility/ACL, RLS, and table privileges.
6. Only after database verification, separately approve a compatible client push/deploy. Verify Club bilingual desktop/mobile behavior and confirm Parent remains unchanged.

No `psql`, Supabase CLI, Docker runtime, or approved disposable database was available locally, so SQL was not executed. Static SQL checks and the disposable rollback proof script cover structure; a real PostgreSQL execution remains a rollout gate.
