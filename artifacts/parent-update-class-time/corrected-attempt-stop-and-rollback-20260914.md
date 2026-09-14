# Corrected Parent class-time rollout attempt — stopped and rolled back

- Live recurrence trigger definition SHA-256: `31a14c653973003be1a7f29b0dd7950d7c395cf5a431e08b8ea63c82df40e113`.
- Activity audit at `2026-09-14T06:32:26.493144+00:00`: 81/81 activity rows carried no recurrence identity; 0 complete and 0 incomplete tuples. The corrected RPC follows that established convention while preserving the selected booking's immutable tuple.
- Corrected migration SHA-256: `69f039264e97b1de441a10ac5a5ceeef7b3e0029d9f50a70a9b543c620ebd8d1`.
- Terminal-rollback rehearsal SHA-256: `b87a3b6ec8e22d769984f4b970301020235f89fe4b68c286fe94c42aa8e3de25`; completed successfully and left all feature objects absent.
- Pre-feature fixture-admissibility SHA-256: `6369c8f3eb409b9a46340182162789c20cd020fe5a5bc8e0556aa64cd4517922`; eight fixture rows inserted successfully inside a transaction that rolled back.
- Post-apply verification at `2026-09-14T06:38:20.436038+00:00` matched live and private backup counts/hashes: bookings 2,031 / `246001...4592a`; accounts 67 / `c21ab2...731c1`; activity 81 / `6e5939...4391`; bills 0 / `e3b0c4...b855`. Private sessions/nonces/idempotency and package families were zero; setup aliases/sessions were 1/0. Exact five RPC grants were present. Existing anon/authenticated direct `project_rows` UPDATE remained present.
- Rollback-only acceptance SHA-256 loaded: `b04acbae3b6565697c4b4b8f7feb8c3b8a2ef4c3c015b9e36fbce74068b30947`. It stopped before feature assertions because the new atomic-state hash ordered `parent_legacy_sessions` by nonexistent `session_id` instead of `id`. PostgreSQL rolled back the acceptance transaction; read-only reconciliation at `2026-09-14T06:40:10.931613+00:00` showed zero exact fixtures, sessions, nonces, and idempotency rows, with production families unchanged.
- Per the requested stop rule, no acceptance retry was attempted. The reviewed rollback SHA-256 `5d68a2b7eed486c24fd8894ab66491bc5da15b1427c0034661ce132622f9f7c5` completed successfully.
- Final read-only reconciliation at `2026-09-14T06:41:30.651404+00:00`: all feature functions/tables/backups absent; exact fixture count zero; bookings/accounts/activity/bills counts and ordered-ID hashes unchanged; accepted anon/authenticated direct-table bypass remained unchanged.
- Final exhaustive REST audit: `production-postrollback-corrected-attempt-20260914.json`, SHA-256 `0a57fec54b3fb777c5e448a450b6a021d20bd048c989cf7e0cced59b9e78fda1`; GET-only, 2,031/67/81/0 rows, no mutations or deployments.

The local acceptance source has been corrected to order sessions by `id`, but it has not been executed. No commit, push, merge, Vercel deployment, or production UI verification followed this stopped rollout.

**Accepted residual risk remains:** anon and authenticated clients can directly UPDATE `public.project_rows` and bypass the RPC. The overall system is not secure; this attempt did not revoke or broaden legacy authority.
