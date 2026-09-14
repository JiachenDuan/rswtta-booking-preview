# Parent class-time acceptance schema/query matrix (2026-09-14 UTC)

Exact live pre-migration catalog evidence: `artifacts/parent-update-class-time/live-catalog-preexisting-exact-20260914.json` (query SHA-256 `321f6cdacce5fcac81c66371dca3691014479bcfb3eaef1fae21858b4f9f2b1d`). Exact rollback-rehearsed candidate evidence: `artifacts/parent-update-class-time/candidate-schema-matrix-rehearsal-exact-20260914.json` (script SHA-256 `52d9c0814775ce18dfcefed5c02e915a1f988b40733895df75fcdedbee208abc`).

## Relations referenced by migration or acceptance

- `public.project_rows` — pre/post; columns `id uuid` PK, `project_table_id uuid` FK, `values jsonb`, `created_at timestamptz`, `updated_at timestamptz`; deterministic order key `id`; anon/authenticated SELECT visible. Acceptance uses `id`, `project_table_id`, `values`, `updated_at`.
- `public.projects` — pre/post; columns `id uuid` PK, `slug text` UNIQUE, `name text`, `created_at timestamptz`; lookup key/order identity `slug`; anon/authenticated SELECT visible.
- `public.project_tables` — pre/post; columns `id uuid` PK, `project_id uuid` FK, `slug text`, `name text`, `created_at timestamptz`; UNIQUE `(project_id,slug)`; anon/authenticated SELECT visible.
- `public.class_package_events` — pre/post; columns `id uuid` PK, `package_id uuid`, `project_id uuid`, `category text`, `unit_basis text`, `event_type text`, `amount_base_units integer`, `old_opening_amount_base_units integer?`, `new_opening_amount_base_units integer?`, `version bigint`, `expected_version bigint?`, `note text`, `reference text`, `actor_kind text`, `idempotency_key uuid`, `created_at timestamptz`; deterministic acceptance order key `id`; browser SELECT denied.
- `public.class_package_hours_ledger` — pre/post; columns `id uuid` PK, `project_id uuid`, `student_account_id uuid`, `delta_minutes integer`, `old_balance_minutes bigint`, `new_balance_minutes bigint`, `operation_type text`, `actor_kind text`, `note text`, `reference text`, `idempotency_key uuid`, `created_at timestamptz`; browser SELECT denied.
- `public.class_package_keys` — pre/post; columns `id uuid` PK, `project_id uuid`, `student_account_id uuid`, `category text`, `unit_basis text`, `created_at timestamptz`; UNIQUE `(project_id,student_account_id,category)` and `(id,project_id,category,unit_basis)`; browser SELECT denied.
- `rswtta_private.club_preregistration_sessions` — pre/post; columns `token_hash bytea` PK, `account_id uuid` FK, `credential_version bigint`, `client_digest bytea`, `expires_at timestamptz`, `revoked_at timestamptz?`, `created_at timestamptz`; browser SELECT denied.
- `rswtta_private.club_preregistration_aliases` — pre/post; columns `normalized_alias text` PK, `account_id uuid` FK/UNIQUE, `created_at timestamptz`; browser SELECT denied.
- `rswtta_private.parent_legacy_sessions` — post only; columns `id uuid` PK, `token_hash bytea` UNIQUE, `account_id uuid` FK, `client_digest bytea`, `credential_fingerprint bytea`, `expires_at timestamptz`, `revoked_at timestamptz?`, `created_at timestamptz`, `last_seen_at timestamptz?`; deterministic atomic-state order key **`id`** (not `session_id`); browser SELECT denied.
- `rswtta_private.parent_class_time_nonces` — post only; columns `nonce_hash bytea` PK/order key, `session_id uuid` FK, `operation text`, `expires_at timestamptz`, `consumed_at timestamptz?`, `created_at timestamptz`; deterministic order expression `encode(nonce_hash,'hex')`; browser SELECT denied.
- `rswtta_private.parent_class_time_idempotency` — post only; columns `account_id uuid`, `operation text`, `idempotency_key uuid`, `request_hash bytea`, `result jsonb`, `created_at timestamptz`; PK/conflict identity `(account_id,operation,idempotency_key)`; deterministic acceptance order `(account_id,idempotency_key)`; browser SELECT denied.

Private backup tables are post-migration copies of the exact relations above, with RLS enabled and all privileges revoked from `public`, `anon`, and `authenticated`.

## Function/RPC resolution

Pre-existing dependencies resolve as `rswtta_private.club_preregistration_pbkdf2(text,bytea,integer) → bytea`, `rswtta_private.club_preregistration_digest(text) → bytea`, `public.rswtta_booking_ends_at(jsonb) → timestamptz`, and `public.rswtta_canonical_coach_id(text) → text`.

Post-migration private functions resolve exactly, including `valid_parent_legacy_session(text,text) → TABLE(session_id uuid, account_id uuid)`. Public RPCs resolve as login `(text,text,text) → jsonb`, resume `(text,text) → jsonb`, logout `(text,text) → void`, nonce `(text,text) → jsonb`, and update `(text,text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text) → jsonb`. Only these five public RPCs receive narrow `anon`/`authenticated` EXECUTE grants.

## Query/path preflight

`artifacts/parent-update-class-time/candidate-runtime-preflight-and-acceptance-20260914.sql` asserts every exact column array and key above, RPC signature, RETURN TABLE fields, primary/unique conflict targets, then PREPAREs and EXPLAINs every atomic-state/read assertion query before executing the exact rollback-only acceptance path. Exact API response evidence records PASS at SHA-256 `03d8f02b57c793b16235cc82e3a62e6259d8b784032027e86723e0c630bd91cb`. Static extraction records every migration/verification/rollback statement hash in `static-sql-preflight-20260914.json` and explicitly rejects `s.session_id` in the session atomic-state query.

**Accepted residual risk:** anon/authenticated still have the legacy direct `public.project_rows` UPDATE path. It can bypass the new RPC, so the overall system is not secure. This rollout neither revokes nor broadens that authority.
