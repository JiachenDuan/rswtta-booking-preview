# Coach authentication provisioning (server/operator only)

Phase 0 deliberately exposes no invitation control in the Club UI. The current Club credential is browser-side and is not an administrative security boundary. Never place a Supabase service-role key in this repository, a browser environment variable, or `project_rows`.

## Feature gate

`COACH_AUTH_ENABLED` must remain unset/`false` until all broad prototype `projects`, `project_tables`, `project_columns`, `project_members`, and `project_rows` policies and overlapping anonymous RPCs are replaced with compatible Parent/Club server-authorized projections and mutations. Phase 0 routes fail closed while the flag is off.

Before enabling, configure these server/deployment variables:

- `NEXT_PUBLIC_SUPABASE_URL=https://xtewfpzsyjeaqgkdttij.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the public project key)
- `COACH_AUTH_SITE_URL=https://rswtta-booking-preview-jiachenduans-projects.vercel.app/`
- `COACH_AUTH_ENABLED=true` only after the isolation gate above passes

The current Supabase Auth allow list already includes the canonical Vercel project URL with `/**`; re-audit it immediately before real invitations.

## Real invitation procedure (requires a later explicit approved coach/email list)

1. Confirm the approved email and canonical `coach_id` out of band. Never infer either from a display name.
2. In Supabase Dashboard → Authentication → Users, use **Invite user** and set the redirect to `https://rswtta-booking-preview-jiachenduans-projects.vercel.app/coach/confirm`. Do not use public signup.
3. Copy the newly created Auth user UUID. Do not copy the invitation token or email into SQL evidence.
4. In the SQL editor, bind the exact UUID and canonical coach ID in one transaction:

```sql
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:coach-invite:<AUTH_USER_UUID>', 0));

-- Inspect these rows before inserting; both must be exact and unique.
select id, email_confirmed_at, invited_at from auth.users where id = '<AUTH_USER_UUID>'::uuid;
select coach_id, project_id from public.coaches
where project_id = 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
  and coach_id = '<CANONICAL_COACH_ID>';

insert into public.project_coach_memberships
  (project_id, coach_id, auth_user_id, role, status, invited_at)
values
  ('ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid,
   '<CANONICAL_COACH_ID>', '<AUTH_USER_UUID>'::uuid, 'coach', 'active', clock_timestamp());

-- The trigger must have emitted exactly one redacted invited event.
select count(*) from public.coach_auth_audit_events
where auth_user_id = '<AUTH_USER_UUID>'::uuid and event_type = 'invited';
commit;
```

5. The coach opens the one-time link, sets a password, and `coach_accept_invitation()` binds acceptance to `auth.uid()`. Confirm one `accepted` audit event and no PII in audit metadata.
6. Verify another coach, an unbound Auth user, anonymous access, and a suspended membership cannot use Coach RPCs before expanding access.

If the binding transaction fails after the Dashboard invitation is sent, suspend/delete only that exact unaccepted Auth fixture after explicit review; never retry with a guessed UUID.

## Suspension/reactivation

Suspension is immediate at the membership/RPC boundary and is also the future push-eligibility boundary:

```sql
update public.project_coach_memberships
set status = 'suspended', suspended_at = clock_timestamp()
where project_id = 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
  and auth_user_id = '<AUTH_USER_UUID>'::uuid;
```

Reactivation uses `status='active', suspended_at=null`. The membership trigger appends redacted `suspended`/`reactivated` events. Do not delete memberships, coaches, or audit history.

## No-email acceptance testing

Use only `sql/verification/20260915102000_coach_auth_foundation.acceptance-rollback.sql`. It creates a synthetic `.invalid` Auth user inside one transaction, exercises invite/accept/replay/suspend/unbound isolation, and always rolls back. It calls no mail or Auth Admin API.
