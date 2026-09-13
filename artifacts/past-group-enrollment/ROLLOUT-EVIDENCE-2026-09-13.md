# Past group enrollment guarded rollout — 2026-09-13

Status: **Stopped, database rolled back, client not deployed**.

- Origin/main and worktree base before rollout: `80fc5c5a5b465fff931c93e0cb3de97859f5de73`.
- Production project: `ab9d8da3-762f-466c-b7ce-fa05088f03cd`.
- Tables: bookings `a7a8a308-2305-4ab6-ad20-5ce174558035`; accounts `8236c8f8-0fab-400c-bedc-143fd5930707`; activity `133ad2fa-44b2-4aab-ab5d-b79c563ab908`.
- Backup: `private_migration_backups.past_group_*_20260913_0930`.
- Backup SQL SHA-256: `cb5c7a05d2b4e5be271f13304c2f714ed66a26d7285fef5c29e7e6b017ef6fe6`.
- Migration SHA-256: `cbb24fd6e21bba605344c51f40d99cc933afa8b922980a6e45b078737686680e`.
- Terminal-rollback variant SHA-256: `3e47577e442d720d01b3087a045b71538d7dd852f45da13baa09973a5deca165`.
- Emergency rollback SQL SHA-256: `ab7a3745fe28f2f336f60f62ff767cd5c44cb22c6e74fba15881b0fbe0912f69`.

## Exact protected baseline and final state

- Accounts: 65; ordered MD5 `5e2e529f06612f9b87e1139f7d13346f`.
- Activity: 66; ordered MD5 `3ec14dd76ff56032197c0d4450db5d32`.
- Bookings: 1,993; ordered MD5 `5a08c9fbd96e204e43c8a9ab515db65d`.
- Package keys/events: 0/0.
- Pre-migration and final RPC definition MD5: `b28acdc236e69be7122547beaf5af2a7`.
- Backup RLS: enabled on all five backup tables.
- Backup schema usage: denied to `anon` and `authenticated`.
- Retained fixtures: zero, proven by exact final counts and complete ordered hashes.

## Gate outcome

The terminal-rollback proof passed and the committed migration passed read-only postverification. Rollback-only acceptance then failed before feature assertions: its disposable private-lesson conflict fixture had an occurrence ID but omitted the recurrence trigger's required series ID. The entire fixture transaction aborted. The database migration was immediately rolled back to the exact saved function definition.

The local fixture has been corrected for a later reviewed attempt. Per the requested stop rule, it was not retried in production. No client commit was pushed; Vercel was not triggered; no production UI mutation or screenshot verification was performed.
