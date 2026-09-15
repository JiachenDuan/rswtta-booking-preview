# Individual Club operator provisioning (server/operator only)

This document supersedes the Phase 0 Coach-only procedure. The final authorization model is in [club-operator-authorization.md](./club-operator-authorization.md).

There are exactly two display labels, `club_admin` and `coach`, and both have the same full Club-operator permission set. `coach_id` is optional scheduling/display metadata independent of authorization; never infer it or an Auth identity from a name. Every person uses an individual Supabase Auth account. Never use the legacy shared Club password and never place a service-role key in browser code, repository files, or `project_rows`.

Real provisioning is intentionally not automated by these migrations. After explicit approval of the exact email, role label, and optional canonical `coach_id`:

1. Create/invite the Auth user through the Supabase Auth Admin API from a trusted service only.
2. In one transaction, verify the exact `auth.users.id`, project ID, and optional canonical coach row, then insert one `public.project_auth_memberships` row. Use `status='active'`; acceptance remains null until the user opens their one-time link.
3. The user sets an individual password and calls `operator_accept_invitation(<request UUID>)`. Confirm exactly one redacted immutable audit event attributed to `auth.uid()` and the membership ID.
4. Require MFA enrollment and an `aal2` session before sensitive account/member, destructive, or financial actions.
5. Verify an unbound user, a suspended membership, and anonymous access are rejected. Verify both role labels can perform the same operator RPCs.

Authentication-account administration uses `operator_request_auth_account_action(...)`. It atomically creates a private outbox request and redacted audit event. A separately deployed trusted worker claims the request with `service_role`, executes the Auth Admin operation idempotently, and records completion/failure. The database guards reject self suspension/deletion and loss of the final active Club Admin before a request can enter the outbox.

Suspension/reactivation must use `operator_change_membership_status(...)`; direct browser table access is denied. Membership rows and audit events are never deleted or rebound. No email, Auth account, membership, or push is created by the additive migration itself.
