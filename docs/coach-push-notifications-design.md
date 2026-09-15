# Coach push notifications — read-only design plan

> Authorization update (2026-09-15): any earlier Coach-own-schedule or Club-Admin-only operational assumption in this historical design is superseded by `docs/club-operator-authorization.md`. Active `club_admin` and `coach` memberships have one identical full Club-operator permission set. Assignment identity remains relevant only to scheduling, display, and targeted push/inbox recipients.

Prepared: 2026-09-15 (America/Los_Angeles)

Scope: design/audit only; no implementation, migration, commit, deployment, or production write was performed.

## Executive decision

**Recommend standards-based Web Push with one stable VAPID keypair, the maintained Node `web-push` package, a durable Supabase inbox/outbox, and a small authenticated Vercel Node worker.** Every authoritative booking mutation must become a server RPC that writes the booking revision, immutable notification event, coach inbox row(s), and push outbox row(s) in one database transaction. A Supabase Database Webhook may wake the worker after an outbox insert; a scheduled sweeper must also drain retries so correctness does not depend on webhook delivery.

The durable, authenticated Coach inbox and unread count are the source of truth. Push is a best-effort hint only. The lock-screen payload is generic and privacy-safe; clicking opens an opaque notification ID, requires Coach authentication, and then fetches authorized detail.

**Do not enable push in the current security model.** `origin/main` has no separately authenticated Coach App, coach identity is mostly mutable display text, and the original prototype RLS policies permit public reads/inserts/updates on generic project storage. Several client paths also write bookings in two operations or write activity logs only after the mutation. Push must not amplify forgeable events or leak student data.

## Audited baseline (not changed)

- Audited remote branch: `origin/main` at `cbf329d98f251ac94c054b3c06874c7babf937fb`.
- `git ls-remote origin main` returned the same SHA, so the local remote-tracking ref was current at audit time.
- The checked-out local `main` was 25 commits behind that ref and already contained unrelated untracked analysis/scripts. They were not modified or removed.
- Stack: Next.js 16.3.3, React 19.2.8, TypeScript 6.0.3, `@supabase/supabase-js` 2.112.4; npm with `package-lock.json`; hosted production is Vercel at `https://rswtta-booking-preview.vercel.app` and Supabase is the database/realtime backend.
- No `web-push`, Firebase, OneSignal, PWA, manifest, or service-worker dependency/file exists on `origin/main`.
- Live checks returned 404 for `/manifest.webmanifest` and `/sw.js`; the production `/club` route returned the shared Parent/Club login UI.
- `/`, `/parent`, and `/club` all render the same client component (`components/ClubApp.tsx`). There is no `/coach` route or `CoachApp` component.
- The “coach” work queue and completion controls are currently inside the authenticated Club dashboard, not a separately authenticated coach principal.

## Live registered-account count

Observed at **2026-09-15 09:01:56 PDT** using only production Supabase `SELECT` operations through the published client boundary:

| Measure | Count | Definition |
|---|---:|---|
| Total registered Parent/student account rows | **67** | Every row in the production `parent_accounts` logical table |
| Profile-complete | **33** | `profileSetupRequired = false` |
| Setup-required | **34** | `profileSetupRequired = true` |
| Unknown profile flag | **0** | Missing/non-boolean flag |
| Confirmed | **66** | `confirmed = true` |
| Unconfirmed | **1** | `confirmed = false` |

Pagination proof:

- Ordered by immutable row UUID.
- Page size: 100.
- Pages fetched: 1.
- Terminal page: 67 rows (strictly less than page size), proving exhaustion rather than assuming a first-page count.
- Total fetched: 67.
- SHA-256 of sorted account UUIDs: `c21ab2679d1173ee1e9b808d1cb8062689a6d62a4aad9ecb76d3dfc047b731c1`.
- No names, contact fields, passwords, salts, confirmation codes, session tokens, or keys are included in this report.

These are application account rows, not Supabase Auth user counts. A later migration to Supabase Auth must reconcile the two populations without treating names as identity.

## Current architecture and gaps

### Application/auth/state

- `app/page.tsx`, `app/parent/page.tsx`, `app/club/page.tsx` — aliases to one `ClubApp`; no Coach route.
- `components/ClubApp.tsx` — Parent and Club state, calendars, requests, confirmations, completion, cancellation, recurring/group controls, EN/Chinese copy, and a Supabase Realtime subscription to every `project_rows` change.
- `lib/parentLegacySession.ts`, `lib/parentLegacyDashboard.ts`, `lib/parentClassTimeClient.ts` — opaque verified Parent session RPC flow exists for newer Parent operations.
- Club access still uses client-side legacy/preset credentials and local-storage state in `ClubApp.tsx`; this is not adequate as an authorization boundary for push subscription or coach data.
- No immutable authenticated coach principal is wired into route/state. `project_members` has a `coach` role in the initial schema but is not the active identity boundary.

### Booking identity and coach assignment

- `lib/types.ts` already reserves optional `coachId`, `assignedCoachId`, and `requestedCoachId`, but current snapshots are documented as having none.
- Active behavior resolves coach by mutable `assignedCoach || requestedCoach` display text.
- `lib/projectStore.ts::normalizeCoachName` and database `public.rswtta_canonical_coach_id(text)` normalize legacy aliases, but names remain identity inputs.
- Recurrence has stronger immutable identifiers: `seriesId`, `recurrenceOccurrenceId`, and `recurrenceOriginalStartsAt`.
- Group occurrences additionally use `groupClassId`; canonical group blocks and enrollment rows share it.
- Student linkage increasingly uses immutable `studentAccountId`; legacy rows can still be unresolved.

### Mutation paths that must be covered

Actual likely integration functions on `origin/main`, all **not changed**:

- Parent private request: `components/ClubApp.tsx::requestBooking` → `lib/projectStore.ts::requestBookingAsParent` → `public.request_booking_as_parent`.
- Parent group join request: `requestGroupClass` → generic `createBooking` (currently a direct row insert).
- Parent cancellation: `cancelParentClass` → `cancelBookingAsParent` → `public.cancel_booking_as_parent`.
- Parent verified class-time edit: `lib/parentClassTimeClient.ts::updateParentClassTime` → nonce + `public.parent_update_booking_time`.
- Club add private/recurring class: `addClubClass` → `createBooking`, then `updateStoredBooking` to `club_confirmed` (two database writes).
- Club create student + add class: `addClubNewStudentClass` → account creation plus the same two-step booking writes.
- Club add group enrollment, one/future occurrence: `addGroupDropIn` → `addStudentToGroupOccurrencesAtomically` → `public.add_student_to_group_occurrences`.
- Club direct status/coach/schedule update and confirm/reject/complete: local `updateBooking` → direct generic update, except cancellation.
- Club private/recurring reschedule: `updateClassTime` → `rescheduleBookingsAtomically` → `public.reschedule_booking_occurrences`.
- Club private/recurring cancellation, including virtual occurrence materialization: `cancelClubClass` → optional `createBooking` → `public.cancel_booking_as_club`, often once per occurrence.
- Group occurrence single/future update or cancellation: `manageGroupOccurrence` → `manageGroupOccurrencesAtomically` → `public.manage_group_occurrences`.
- Parent/student or Club marking a class complete: direct generic create/update paths.
- Coach time blocks use booking rows with program `Unavailable`; they are coach-schedule events but not student classes. Recommended default: include them in the Coach inbox under schedule events, with an independently configurable push flag.

### Activity, RPC, and notification state

- `activity_logs` and `bill_notifications` are logical tables stored in generic `project_rows`; neither is a coach notification system.
- `recordClassActivity` is best-effort client work performed after many mutations and deliberately cannot block the calendar change.
- Some newer RPCs atomically add activity rows, notably group enrollment and verified Parent time update, but conventions differ.
- No push subscription, Coach inbox, event/outbox, delivery-attempt, retry, or dead-letter schema exists.
- No existing RPC can guarantee that every booking revision and notification event commit together.
- A generic `project_rows` trigger is the wrong primary solution: two-step creates would produce false duplicates, unrelated JSON updates are hard to classify, and series/group operations update many rows that should be semantically aggregated.

### RLS, grants, and secret boundary

- `supabase/migrations/20260830230000_project_rows.sql` explicitly labels its policies “Prototype” and says to tighten them before production.
- Current migration history retains `using (true)` public `SELECT` on projects/members/tables/columns/rows and public `INSERT`; `project_rows` also has public `UPDATE`.
- Many security-definer booking/package RPCs are executable by `anon, authenticated`; several rely on caller-supplied legacy identity or club proof rather than `auth.uid()` coach/parent membership.
- Private schemas and newer session/idempotency tables are better protected, but they do not repair the generic public row policies.
- `NEXT_PUBLIC_*` Supabase URL/publishable key is correctly public. VAPID private key, worker shared secret, and any service-role key must never be bundled into client code or stored in `project_rows`.
- A Web Push endpoint plus `p256dh`/`auth` values is a bearer capability and must be treated as secret operational data even though it is not a user password.

## Recommended target architecture

```text
Parent / Student / Club-admin / Coach UI
                 |
                 | authenticated semantic command + request_id
                 v
     Supabase security-definer mutation RPC
     - authorize actor via auth/session + immutable IDs
     - lock booking/series/group scope
     - reject stale expected revision
     - compute semantic before/after diff
     - update booking(s), revision += 1
     - write immutable notification_event(s)
     - upsert idempotent coach_inbox row(s)
     - insert aggregated push_outbox row(s)
                 |
                 | one PostgreSQL transaction
                 v
  Coach inbox + unread count (authoritative, RLS-protected)
                 |
       outbox INSERT wake-up (best effort)
                 v
 Supabase DB Webhook/pg_net ---> Vercel Node push worker
                                (`web-push` + server-only VAPID key)
                                      |
                         browser push services (Apple/Google/Mozilla)
                                      |
                  Coach PWA service worker shows generic notification
                                      |
                 click /coach/notifications/<opaque-inbox-id>
                                      |
                    authenticate, RLS-check, fetch current details

 Scheduled outbox sweeper ---> retries/backoff/dead-letter
 Metrics/logs <------------- redacted delivery outcomes and lag
```

Why the Vercel Node worker is the default:

- It fits the current Next/Vercel production stack and the maintained Node `web-push` package directly.
- Supabase Database Webhooks are asynchronous (`pg_net`) and can wake it without blocking booking commits.
- A sweeper makes the durable outbox, not the webhook, responsible for eventual attempts.
- A Supabase Edge Function is viable only after a runtime spike proves the selected Web Push sender and Node-compatibility behavior; do not assume every Node crypto/network dependency behaves identically in Deno Edge.
- The repository's optional GitHub Pages static export cannot host this API worker. If that deployment becomes production, move the worker to Supabase Edge or another server runtime while keeping the same database contracts.

## Immutable-ID data model

Use normalized tables, not new `project_rows` JSON documents.

### `coaches` / membership linkage

- `coach_id uuid primary key` — immutable; preferably the UUID of an authenticated project member or a stable FK to it.
- `auth_user_id uuid unique not null` → `auth.users(id)`.
- Display names and localized labels are mutable presentation only.
- Backfill `requested_coach_id` and `assigned_coach_id` on every booking. Preserve legacy display snapshots for compatibility, but never route notifications by name.
- Block rollout on ambiguous or unmapped legacy coach aliases.

### Booking revision

- Add/maintain `booking_revision bigint not null default 0` on each materialized booking.
- Increment exactly once per accepted semantic mutation.
- Series operations still create one event per affected immutable occurrence; attach a shared `batch_id` for UI/push aggregation.
- Virtual recurring instances must have deterministic immutable occurrence IDs before mutation and must be materialized/changed inside the same RPC transaction.

### `notification_events` (immutable audit event)

Suggested fields:

- `event_id uuid primary key`, `project_id`, `batch_id uuid`, `booking_id`, `series_id`, `occurrence_id`, `group_class_id`.
- `booking_revision bigint`, `event_type`, `scope` (`single`, `future`, `series`), `actor_kind`, `actor_id` where authorized.
- `old_coach_id`, `new_coach_id`, `occurred_at`, `locale-neutral template_key`.
- Minimal semantic diff (time/program/status/coach IDs), not a full booking/student snapshot.
- `idempotency_key text unique not null` and `payload_hash`.
- Append-only: deny update/delete to app roles.

### `coach_notification_inbox` (source of truth)

- `inbox_id uuid primary key`, `event_id`, `coach_id`, `batch_id`, `created_at`, `read_at`, optional `archived_at`.
- `template_key`, privacy-safe `summary_args`, `booking_id`/`occurrence_id` references.
- Unique `(event_id, coach_id)`; insert with `ON CONFLICT DO NOTHING`.
- Unread count is `read_at is null`, scoped by authenticated `coach_id`.
- Detailed student/class information is fetched at click/view time under authorization, rather than copied into long-lived notification rows.

### `coach_push_subscriptions`

- `subscription_id uuid`, `coach_id`, encrypted endpoint/key material, `endpoint_hash unique`, `vapid_key_version`.
- `locale` (`en`/`zh`), device label (user supplied), coarse browser/platform only if needed, `created_at`, `last_seen_at`, `disabled_at`, `failure_count`, `last_failure_code`.
- Multiple devices per coach are supported; subscriptions are origin/browser/profile/device-specific.
- Registration, refresh, test, disable, and delete go through authenticated server RPC/routes. A coach can only manage their own subscriptions.
- Do not log endpoint, `p256dh`, `auth`, session tokens, or payload plaintext.

### `coach_push_outbox` and attempts

- `outbox_id uuid`, `batch_id`, `coach_id`, `event_ids uuid[]` or relation table, `status`, `available_at`, `attempt_count`, `locked_at`, `last_error_class`, `sent_at`, `dead_lettered_at`.
- Unique send idempotency key such as `push:<batch_id>:<coach_id>:<payload_version>`.
- Worker claims rows with `FOR UPDATE SKIP LOCKED`, a short lease, and bounded batch size.
- Optional append-only `coach_push_delivery_attempts` records status code class, latency, timestamp, retry decision, and provider host—never secrets or full payload.

### Idempotency rule

- Client supplies a unique mutation `request_id`; RPC stores request fingerprint and result as newer RPCs already do.
- Canonical event key: `<booking_id>:<booking_revision>:<event_type>:<recipient_coach_id>`.
- Series/group batch key adds the semantic command `request_id`, but each occurrence retains its own event/revision.
- Replaying the same request returns the original mutation result and creates no second event/inbox/outbox.
- Reusing a request ID with a different fingerprint fails.
- A semantic no-op does not increment revision and emits nothing.

## Exact event matrix

“Push” below means one best-effort aggregated push per recipient coach and mutation batch; “inbox” means immutable per-occurrence events grouped by `batch_id` in the UI.

| Mutation | Recipient/event | Scope and dedupe behavior |
|---|---|---|
| Parent creates private-class request | Requested coach: `class.requested` | One occurrence; inbox + push after commit. |
| Parent requests group enrollment | Assigned coach: `group.join_requested` | One event for the canonical group occurrence, not one generic row-change event. No student name on lock screen. |
| Club adds private class | Assigned coach: `class.assigned` | Current two-write create/confirm must become one RPC and one revision/event. |
| Club adds weekly private series | Assigned coach: `class.assigned` | One event/inbox item per occurrence; one push “N classes added” per coach/batch. |
| Club adds existing/new student to group | Assigned coach: `group.roster_added` | One per affected occurrence; one aggregated push. Account creation alone emits no coach event. |
| Date/time or duration edit | Current assigned coach: `class.time_changed` | Include old/new timestamps in authorized inbox data. Single/future/series semantics preserved. |
| Program/type edit | Current assigned coach: `class.program_changed` | Emit only if canonical program/type differs. |
| Relevant note/detail edit | Current assigned coach: `class.details_changed` | Only coach-visible semantic fields; never notify for bookkeeping-only JSON reserialization. |
| Status `requested/change_requested` | Current requested/assigned coach: `class.change_requested` | Distinguish request from applied update. |
| Admin confirms request | Assigned coach: `class.confirmed` | Notify after authoritative status change. |
| Coach confirms own request | Same coach inbox: `class.confirmed`; default suppress push to the initiating device | Preserve audit/unread semantics; avoid self-notification noise. Push to the coach’s other devices is an open product choice. |
| Status to `coach_confirmed`/complete | Assigned coach: `class.completed` | Admin/parent action pushes; default suppress self-push when the same coach performed it. |
| Parent/Club cancels or rejects | Current assigned/requested coach: `class.cancelled` or `class.rejected` | Notify even if class was only requested. Soft-cancel preserves identity/history. |
| Coach reassignment A → B | Old coach A: `class.unassigned`; new coach B: `class.assigned` | Both events share one batch/revision. If time/program also changed, each recipient sees the relevant final semantic summary. |
| Coach field A → A after alias normalization | None | Canonical no-op: no revision/event/push. |
| Add assigned coach where previously none | New coach: `class.assigned` | No old-recipient event. |
| Remove coach without replacement | Old coach: `class.unassigned` | Mutation should require explicit authorization/reason. |
| Single recurring occurrence edit/cancel | Affected coach: ordinary event with `scope=single` | Only selected immutable occurrence. |
| “This and future” edit/cancel | Each affected occurrence event; one aggregated push per coach/batch | Boundary is `recurrenceOriginalStartsAt`, not current moved time. |
| Whole-series creation/import | Per occurrence event; one aggregated push | Large imports should allow `push_suppressed_reason=administrative_import` only by explicit approved flag; inbox remains complete. |
| Group block update/cancel | Assigned coach: `group.time_changed` / `group.cancelled` | One canonical occurrence event; do not multiply by roster row count. |
| Group enrollment confirm/reject/cancel | Assigned coach: `group.roster_confirmed/rejected/removed` | Roster event on the matching immutable group occurrence. |
| Coach unavailable block add/edit/remove | Coach: `schedule.blocked/changed/unblocked` | Inbox on by default; push controlled by `push_coach_blocks` flag. No student event. |
| Retry/realtime replay/duplicate webhook | None new | Existing inbox/outbox key wins; worker may attempt at least once, but UI event remains singular. |
| Any failed/rolled-back mutation | None | Booking, event, inbox, and outbox all roll back together. |

Default aggregation window is the database transaction/batch only—do not delay a single class notification merely to combine unrelated later actions.

## Atomic mutation contract

1. Authenticate and authorize the actor; resolve immutable project, student, booking, and coach IDs server-side.
2. Acquire deterministic locks for the booking, coach schedule, series, or group occurrence scope.
3. Check request idempotency and the caller’s expected booking revision/timestamp.
4. Derive the authoritative target set server-side; never trust a client-provided row list without exact-scope verification.
5. Compute canonical semantic before/after values, including normalized coach IDs.
6. Return the existing result for a valid replay; return success/no event for a true no-op; reject stale/conflicting input.
7. Apply all booking changes and increment each changed booking revision once.
8. Insert immutable events, idempotent inbox rows, and aggregated outbox rows in the same transaction.
9. Add activity/audit rows atomically or derive the human activity feed from notification events; remove the best-effort post-mutation dependency.
10. Commit. Network sending happens only afterward.

All existing direct booking insert/update paths must move behind semantic RPCs before enforcement. Then revoke generic app-role writes to booking rows and make triggers reject bypasses. Do not rely on a trigger to infer high-level intent from arbitrary JSON.

## Push delivery behavior

- Worker receives only an authenticated wake-up and claims eligible outbox rows itself; never trust webhook payload recipient/payload data directly.
- `web-push` sends RFC 8291-encrypted payloads authenticated with RFC 8292 VAPID.
- Use one stable VAPID keypair; public key can reach the client, private key remains only in server secret storage. Support `vapid_key_version` for deliberate rotation.
- Payload contains only: generic localized title/body, `inbox_id`, collapse/topic key, event category, and unread badge count if safe.
- Example lock screen: **“Class schedule updated” / “Open Coach App for details.”** Chinese: **“课程安排已更新” / “打开教练端查看详情。”** No student/parent name, contact, note, balance, credential, or secret.
- Service worker always calls `registration.showNotification()`; no silent push.
- Click uses `/coach/notifications/<opaque-inbox-id>` with no PII/query-string details. If unauthenticated, redirect to Coach login and resume only after authorization.
- Use short TTL for time-sensitive changes (recommended 24 hours), normal urgency by default, high only for near-term cancellations/reassignments, and provider topic/collapse keys only as transport optimization.
- Mark `sent` only for accepted push-service responses; acceptance is not device-display proof.

### Retry and cleanup

- Retry transient network failures, 408, 429 (honor `Retry-After`), and 5xx with exponential backoff plus jitter: e.g. 1m, 5m, 20m, 1h, 4h, then bounded repeats.
- Dead-letter after 10 attempts or 24 hours, whichever comes first; inbox remains available.
- On 404/410, atomically disable/delete the expired subscription and do not retry it.
- Treat permanent malformed-subscription/authorization errors as terminal and flag operator action.
- A failed device must not block other devices for the same coach.
- A periodic sweeper recovers lost webhook wake-ups and expired worker leases.

## Coach App experience

### Authentication and routes

Recommended new boundaries (planned, **not changed**):

- `app/coach/page.tsx` — authenticated schedule/work queue.
- `app/coach/notifications/page.tsx` — inbox and unread/all filter.
- `app/coach/notifications/[inboxId]/page.tsx` — authorized detail/click target.
- `app/api/coach/push-subscriptions/route.ts` — authenticated register/refresh/delete/test boundary.
- `app/api/internal/push-worker/route.ts` — server-only worker, Node runtime.
- `public/manifest.webmanifest`, `public/sw.js`, and suitable maskable icons.
- Focused client modules/components rather than expanding the already-large `components/ClubApp.tsx`.

Use Supabase Auth for Coach users linked to immutable project membership. Do not reuse the client-side Club preset password/local-storage boolean as Coach identity.

### Inbox and unread count

- Header badge reads server/RLS-protected unread count; Realtime can refresh it, but page reload/query is authoritative.
- Mark-read is an idempotent authenticated RPC. Support mark-one and mark-all-before-time.
- Offline UI may cache already-authorized minimal inbox data, but must not expose data after logout/account change.
- Push-disabled/denied/offline coaches still receive every inbox event and unread count when they next open the app.

### Permission onboarding/settings/test

- Never show the browser prompt on page load. Explain the benefit first, then request permission from an explicit **Enable notifications / 开启通知** button.
- iPhone/iPad flow: detect capability, explain **Add to Home Screen → open installed Coach App → tap Enable**. A normal Safari/third-party browser tab is not enough.
- Settings show unsupported/not installed/not asked/granted/denied/expired states, per-device registration, disable/remove, privacy copy, and **Send test notification / 发送测试通知**.
- A test creates a test-only inbox/outbox event scoped to the signed-in coach, rate-limited, clearly labeled, and excluded from booking/activity analytics.
- If permission is denied, do not repeatedly prompt; show OS/browser instructions and keep inbox functional.
- EN/Chinese strings should be template keys rendered by locale, not duplicated mutable free text in events.

## Security, privacy, and abuse controls

- Coach, parent, and club/admin authorization must be server-enforced. Prefer `auth.uid()` plus membership; where legacy Parent sessions remain, validate opaque server-side sessions and bind them to one account.
- RLS:
  - Coach selects/marks read only their inbox and subscriptions.
  - Club admins can view delivery health, not raw subscription secrets.
  - Parents cannot read coach inbox/subscriptions/outbox.
  - App roles cannot directly insert events/outbox or mutate immutable events.
  - Worker/service role gets the narrow tables/actions it needs; no key reaches browser code.
- Revoke prototype-wide direct booking/account reads and writes, replacing them with least-privilege views/RPCs. This is a prerequisite, not deferred hardening.
- Encrypt subscription capability material at rest with a server-managed key; hash normalized endpoint for uniqueness. Never return another device’s secret material.
- Rate-limit subscription registration, test pushes, login, mark-all, and worker wake-ups. Bound devices per coach (recommended 10) and payload size.
- Validate endpoint scheme/host shape without relying on a fixed provider allowlist; browsers can change push services.
- Audit actor ID, command/request ID, event ID, booking revision, recipient coach ID, worker outcome class, and timestamps. Avoid names/contact fields in operational logs.
- Retention defaults: inbox/events 13 months for operational history; detailed delivery attempts 30 days; dead letters 90 days; disabled subscription secrets purged after 30 days. Confirm against club policy.
- CSP/connect-src and worker scope must allow only required app/Supabase/push behavior. No third-party analytics in the service worker.

## Failure behavior and observability

User-visible behavior:

- Booking mutation success means booking + inbox/outbox committed, regardless of immediate push availability.
- If the atomic notification write fails, the booking mutation fails and rolls back; do not silently create an unnotified class.
- If push sending fails, show no mutation error to the parent/admin. Coach sees the event in inbox; operators see delivery degradation.
- If Coach auth/authorization fails on click, reveal no event existence or details.

Minimum metrics/alerts:

- Outbox pending count and oldest age; p50/p95 event-to-send latency.
- Attempts/success/transient/permanent/dead-letter by browser/provider host and event type.
- Active/disabled subscriptions by coach (aggregate only), permission onboarding conversion, 404/410 cleanup rate.
- Inbox events with no outbox when push should be enabled; outbox with no inbox; duplicate-key conflicts; stale worker leases.
- Mutation count vs notification-event count by semantic path, with expected suppressions/no-ops.
- Alert defaults: oldest ready outbox >5 minutes, any dead letter, event/inbox invariant violation, sudden 404/410 spike, worker authentication failures.
- Structured logs carry opaque IDs and error classes only; dashboards must not expose endpoints or student PII.

## Existing-solutions preflight and alternatives

Sources checked 2026-09-15:

- W3C Push API: https://w3c.github.io/push-api/
- RFC 8030 Web Push, RFC 8291 encryption, RFC 8292 VAPID: https://www.rfc-editor.org/info/rfc8030, https://www.rfc-editor.org/info/rfc8291, https://www.rfc-editor.org/info/rfc8292
- WebKit iOS/iPadOS Web Push: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Node `web-push`: https://github.com/web-push-libs/web-push (latest observed 3.6.7; Node 16+; MPL-2.0)
- Supabase Database Webhooks: https://supabase.com/docs/guides/database/webhooks
- Supabase push examples: https://supabase.com/docs/guides/functions/examples/push-notifications
- FCM Web: https://firebase.google.com/docs/cloud-messaging/web/get-started
- OneSignal pricing: https://onesignal.com/pricing

Official browser constraints:

- HTTPS, a service worker, Push API, Notifications API, and user permission are required.
- iOS/iPadOS Web Push requires 16.4+, installation to the Home Screen, launch as a Home Screen web app (normally manifest `display: standalone`/`fullscreen`), and a permission request caused by direct user interaction.
- iOS/iPadOS does not require Apple Developer Program membership for standards Web Push.
- Android and desktop generally do not require installation, but still require HTTPS, support, permission, and service-worker registration.
- Push can be delayed by OS/browser/network policies; it is not a guaranteed real-time channel.

### Alternative 1 — Firebase Cloud Messaging

- Pros: no-cost messaging service, mature SDK/console, familiar token lifecycle, good Android integration, Supabase documents an Edge Function + webhook pattern.
- Cons: extra Firebase project/service-account secret and SDK alongside Supabase; web delivery still uses browser Push API/service workers/VAPID and does not remove iOS Home Screen friction; more vendor coupling and identity/token concepts than this small PWA needs.
- Choose if native Android/iOS apps or Firebase analytics/campaign infrastructure are planned soon.

### Alternative 2 — OneSignal

- Pros: fastest hosted setup, dashboard, segmentation/analytics, subscription management, free plan currently advertises web push up to 10,000 subscribers per send.
- Cons: third party receives device/subscription and messaging metadata; pricing/limits can change; SDK/console lock-in; less control over minimization, retries, and event invariants; still cannot bypass Apple’s Home Screen and user-permission rules.
- Choose only if speed and non-engineer campaign tooling outweigh privacy/control, after vendor/privacy review.

The direct standards approach is the best fit: lowest recurring cost, no extra messaging vendor, portable browser protocol, and full control over the club’s small-volume operational notifications.

## Phased rollout and rollback boundaries

### Phase 0 — security and identity gate

- Introduce real Coach auth/project membership and immutable coach IDs.
- Backfill coach IDs with a reviewed alias map; quarantine ambiguous rows.
- Inventory every booking writer and prove no bypass path remains.
- Tighten RLS/grants and replace generic direct writes with authorized RPCs.
- Feature flags remain off.

Rollback: restore prior grants/functions only from captured definitions if absolutely necessary; push remains off. Do not roll back immutable ID data by deleting it.

### Phase 1 — additive schema and shadow events

- Idempotent migration creates revision, event, inbox, subscription, outbox, attempt, and flag tables plus indexes/RLS.
- Capture schema/function/grant definitions, row counts, sorted-ID hashes, and encrypted backups before production migration.
- Convert one low-risk semantic RPC at a time. In shadow mode, events/inbox are generated for test/admin coaches only; no external push.
- Add invariant reports comparing mutations, revisions, events, inbox, and outbox.

Rollback: disable enqueue/event feature flag and revert RPC wrappers; retain append-only data for diagnosis. Additive columns/tables need not be dropped under pressure.

### Phase 2 — Coach inbox

- Add `/coach` auth boundary, inbox, unread count, EN/Chinese templates, Realtime refresh, and authenticated detail click-through.
- Roll out to one internal coach, then all coaches. Inbox remains useful without push.

Rollback: disable Coach inbox route flag; booking RPCs and recorded events remain valid.

### Phase 3 — PWA and subscriptions

- Add manifest/icons/service worker, install guidance, permission settings, subscription lifecycle, and rate-limited test event.
- Test each supported platform before enabling sender traffic.

Rollback: disable subscription registration; existing subscriptions remain encrypted/disabled until purged.

### Phase 4 — push canary and expansion

- Enable worker for one coach/device and selected event types, then cancellations/reassignments, then all class events.
- Observe lag, duplicates, 404/410, dead letters, and lock-screen privacy.
- Expand by server-side coach/event flags, not client releases.

Rollback order: `coach_push_send_enabled=false` (stop external sends) → `coach_push_enqueue_enabled=false` (stop new outbox) → leave inbox enabled. Never roll back a successful booking because later push delivery failed.

### Phase 5 — enforcement and cleanup

- Enforce all booking changes through semantic RPCs; reject direct mutation.
- Remove legacy name-routing and two-step write code only after compatibility telemetry is clean.
- Rotate test secrets, purge fixtures/subscriptions, finalize runbooks.

## Test matrix

### Mutation/event coverage

- Parent private request, Parent group join, Parent verified time edit, Parent cancellation.
- Club add existing/new student; single/recurring private; group block; group enrollment single/future; confirm/reject/complete.
- Club private reschedule/cancel single/future; group update/cancel single/future.
- Every status transition, program change, date/time/duration change, note/detail change, and blocked-time change.
- Reassign A→B proves old-coach unassigned + new-coach assigned; alias A→A proves zero event.
- Multi-field mutation proves one revision and correct combined recipient summary.
- No-op, stale revision, replayed request ID, reused ID with different fingerprint, concurrent edits, and transaction rollback.

### Recurrence/group identity

- Single occurrence leaves siblings unchanged.
- Future scope uses immutable original occurrence boundary after prior moves.
- One event per occurrence, one push per coach/batch; group roster rows do not multiply canonical occurrence pushes.
- Virtual occurrence materialization, cancelled history, mixed old/new coach in a future scope, partial legacy identity, and ambiguous coach mapping.

### Delivery reliability

- Duplicate database webhook, concurrent workers, expired lease, worker crash before/after provider acceptance, retry exhaustion, manual replay.
- 408/429 with `Retry-After`, 5xx, timeout, malformed response, 404/410 subscription expiry, one bad device among several.
- Offline device, delayed delivery, expired TTL, out-of-order pushes, push accepted but never displayed.
- Inbox remains singular and authoritative under at-least-once attempts.

### Permissions/platforms

- Permission default/granted/denied, unsupported browser, private/incognito behavior, OS notifications disabled, subscription refresh/change.
- iPhone and iPad on supported iOS/iPadOS: browser-tab blocked guidance; Add to Home Screen; launch installed app; user-gesture permission; background notification; badge; Focus; authenticated click.
- Android Chrome/Edge PWA and ordinary supported browser; desktop Chrome/Edge/Firefox; macOS Safari.
- Origin changes (`www`, non-`www`, preview deployments) do not reuse subscriptions.
- App/service-worker update, stale cache, logout/account switch, multiple coaches on one device, multiple devices for one coach.

### Privacy/security

- Lockscreen and payload inspection contain no student/parent names, contact data, notes, balances, credentials, tokens, endpoints, or VAPID private key.
- Parent/anonymous/other coach cannot enumerate inbox IDs, unread counts, subscriptions, event details, or delivery logs.
- Authenticated click to another coach’s opaque ID is indistinguishable from not found.
- Client bundles/source maps/environment contain only the VAPID public key and Supabase publishable key.
- Rate limits, device cap, CSRF/origin checks where applicable, webhook/worker secret validation, service-role isolation, log redaction.

### Migration/production acceptance

- Test migration twice on a restored production-shaped database; second run is idempotent.
- Verify pre/post row counts, sorted immutable-ID hashes, object definitions, RLS, grants, indexes, and backup manifests.
- Production fixtures use unique opaque test IDs and test-only coaches; record before hashes/counts.
- Execute acceptance mutations inside rollback transactions when possible. For external test push, create the minimum committed test-only event/subscription, then delete through the audited cleanup path.
- Prove fixture cleanup with zero matching rows across booking/event/inbox/outbox/attempt/subscription tables and unchanged non-fixture hashes.
- Run focused tests, full test suite, strict typecheck, lint, production build, service-worker static checks, and browser automation without installing unpinned tools.

## Effort estimate (engineering effort, not a calendar promise)

| Phase | Estimate |
|---|---:|
| Security/auth and immutable coach-ID prerequisite | 6–10 engineer-days |
| Additive schema, RPC consolidation, event matrix, backfill | 7–11 engineer-days |
| Coach inbox/unread/authenticated routes and EN/Chinese UI | 4–7 engineer-days |
| PWA/service worker/subscription settings | 3–5 engineer-days |
| Node worker, webhook/sweeper, retries, observability | 4–7 engineer-days |
| Cross-platform tests, guarded rollout, runbooks | 5–8 engineer-days |
| **Total** | **29–48 engineer-days** |

The wide range is driven by current public generic-table access, absence of Coach auth, legacy coach-name mapping, and the number of non-atomic booking writers—not by Web Push encryption itself.

## Risks and open decisions — recommended defaults

1. **Coach identity/auth:** approve Supabase Auth + immutable project membership. Do not extend the Club preset credential.
2. **Security sequencing:** approve RLS/RPC consolidation as a hard prerequisite to push enablement.
3. **Sender runtime:** approve Vercel Node + `web-push`; permit a short Supabase Edge compatibility spike only as an optimization, not the critical path.
4. **Reassignment:** notify both old and new coaches; one batch, distinct immutable inbox events.
5. **Series/group noise:** per-occurrence inbox history, one aggregated push per coach/transaction.
6. **Self-actions:** retain inbox audit; suppress push to the initiating coach’s current device by default. Decide whether other devices should receive it.
7. **Message privacy:** generic lock-screen text always; reveal authorized detail only after app open/login.
8. **Blocked-time notifications:** inbox enabled, push disabled by default unless coaches ask for it.
9. **Retention:** events/inbox 13 months, attempts 30 days, dead letters 90 days, disabled subscription secrets 30 days.
10. **Support floor:** iOS/iPadOS 16.4+ installed Home Screen app; graceful inbox-only fallback everywhere else.
11. **VAPID ownership:** one production keypair and contact URI owned by the club, with documented escrow/rotation; never per deployment.
12. **Production account interpretation:** treat 67 as application Parent/student accounts; do not conflate it with future Supabase Auth users.

## Acceptance criteria

Yishu can accept the feature only when:

- Every mutation path in the matrix is server-authoritative and atomically writes booking revision + event + inbox + outbox, or is explicitly documented as non-class/suppressed.
- No semantic no-op, replay, generic row trigger, group roster fan-out, or two-step client write creates duplicate Coach events.
- Old/new coach reassignment and single/future recurrence behavior match the matrix using immutable IDs.
- Coach inbox/unread works with push denied, offline, delayed, duplicated, or permanently failed.
- Coach auth/RLS prevents anonymous, Parent, Club-without-role, and other-coach access; generic prototype policies no longer expose booking/account data or writes.
- Push payload, lock screen, URLs, logs, and metrics contain no prohibited PII or credentials.
- iOS/iPadOS installed-PWA onboarding and user-gesture permission are proven on physical devices; Android, desktop, and macOS paths pass.
- Retries/backoff, 404/410 cleanup, dead-lettering, sweeper recovery, and redacted observability pass fault injection.
- Migrations are additive/idempotent, backups and hashes verify, rollback flags are tested, and production fixtures are fully cleaned with final hashes/counts.
- Push can be stopped independently without disabling the durable Coach inbox or rolling back class mutations.
