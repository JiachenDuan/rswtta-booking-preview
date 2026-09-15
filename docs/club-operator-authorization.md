# Club operator authorization foundation

## Current status

The additive boundary supports individual Club operator Auth, route-scoped membership verification, MFA, immutable actor audit, verified Parent mutation wrappers, and authenticated Club preregistration. During the transition, `/club` accepts both individual operator accounts and the established shared Club login; the shared path retains its existing reload behavior. Do not apply the separately staged generic-storage closure or revoke the shared login until a later explicitly approved cutover.

## Final model

`club_admin` and `coach` are the only membership labels. Both labels call the same `rswtta_private.require_operator(...)` predicate and receive the same full Club-operator capabilities: calendar and data reads; create, edit, reschedule, confirm, cancel, complete; student, billing, package, coach/member, invitation, and authentication-account management. A role label never grants or removes a capability. `coach_id` is immutable identity metadata used only for display, scheduling assignment, and affected-coach notification routing.

Each new operator signs in with an individual Supabase Auth account. While `NEXT_PUBLIC_TRUSTED_OPERATOR_AUTH_ENABLED=true`, the legacy shared Club login remains available as a temporary compatibility path; individual operator authorization and audit derive identity exclusively from `auth.uid()`.

Sensitive member/account, destructive, and financial writes require a JWT with `aal=aal2`. Reads may use AAL1. Authentication-account operations are written to the private `project_auth_account_requests` outbox; a separately deployed trusted worker must claim them with `service_role` and call the Supabase Auth Admin API. It must preserve the request ID and mark the row completed or failed. Browser code never receives an admin key.

Every mutation takes a caller-generated UUID request ID and atomically appends an immutable audit event with actor Auth user ID, actor membership ID, role label, timestamp, request ID, target, and allowlisted semantic before/after fields. Arbitrary row values, contact details, credentials, notes, tokens, and payment details are excluded. Actor names are never identity.

Parent legacy sessions remain scoped and available during rollout. Push/inbox fan-out remains limited to active accepted memberships whose immutable `coach_id` is assigned or requested on the affected booking; it never broadcasts to all operators.

## Lockout invariants

- Membership identity, role label, Auth user binding, and `coach_id` cannot be changed or deleted.
- An operator cannot suspend or request deletion/suspension of their own active membership.
- The final active accepted `club_admin` cannot be suspended or requested for deletion.
- Advisory locks plus row locks serialize concurrent membership changes; request IDs provide mutation idempotency.

## Activation sequence

1. Apply `20260915102000_coach_auth_foundation.sql`, then the additive `20260915113000_trusted_application_boundary.sql`. Do not apply the staged closure.
2. Provision individual Auth users and exact memberships through a separately approved operator procedure. Start with at least two active accepted Club Admin memberships. Never infer identity from a name and never use the shared password.
3. Configure MFA and verify AAL2 JWTs. Deploy the trusted Auth-account outbox worker and prove request-ID idempotency without sending real mail in acceptance tests.
4. Deploy the compatible RPC-only client with `COACH_AUTH_ENABLED=true` and `NEXT_PUBLIC_TRUSTED_OPERATOR_AUTH_ENABLED=true`. Keep Parent legacy-session flags enabled.
5. In a rollback transaction, run the operator acceptance SQL. Verify both labels have identical CRUD/control outcomes, AAL1 sensitive rejection, AAL2 success, actor attribution/redaction, concurrency, lockout guards, immutable binding, and assignment-only notification recipients.
6. Observe the secure client. Confirm unauthenticated browsers issue no generic table reads or realtime subscriptions and direct table/RLS access fails closed.
7. Separately review exact production function signatures, then apply `sql/staged/20260915120000_close_legacy_project_rows.sql`. This forward-only closure revokes generic storage and overlapping legacy operator RPC access. Keep the Parent legacy-session revokes commented until every Parent has a verified Auth binding.

No migration, deployment, Auth provisioning, email, push, or external change was performed by this repository change.
