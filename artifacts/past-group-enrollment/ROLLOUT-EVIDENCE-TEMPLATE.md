# Past group enrollment rollout evidence

- Auditor / timestamp / commit:
- Production project, booking/account/activity table IDs:
- Preflight row counts and complete ordered hashes:
- Private backup transaction ID and source=backup hash proof:
- Backup schema ACL/RLS proof:
- Migration SHA-256 and authorization:
- Disposable rollback proof output:
- Applied migration result / unknown-outcome reconciliation:
- RPC owner, security-invoker, search path, anon/authenticated ACL:

## Rollback-only acceptance

Record fixture IDs and prove rollback removed all fixtures.

- [ ] Past canonical `club_confirmed` block + existing account -> one `club_confirmed` enrollment
- [ ] Past canonical `coach_confirmed` block -> one `coach_confirmed` enrollment
- [ ] Future single and future-series behavior unchanged
- [ ] Past `future` scope rejected
- [ ] New-student past path absent
- [ ] Cancelled/noncanonical/missing identity rejected
- [ ] Active and cancelled historical membership rejected
- [ ] Half-open overlap rejected; cancelled conflict non-blocking
- [ ] Valid capacity accepted below limit; full/invalid capacity rejected
- [ ] Stale count, IDs, status, startsAt, updatedAt rejected atomically
- [ ] Same-key replay returns exact enrollment ID and one activity row
- [ ] Same key/different payload rejected; concurrent different keys create at most one enrollment
- [ ] Canonical account identity/contact snapshots and established/default price verified
- [ ] Billing eligible +1; CSV linked +1; unresolved unchanged
- [ ] Package key/event counts and hashes unchanged; no automatic deduction
- [ ] Reschedule/cancel linkage preserves row/account/group/series identity

## Client evidence

- [ ] Club desktop EN / ZH screenshots
- [ ] Club mobile EN / ZH screenshots
- [ ] Name + short ID; duplicate names distinguishable
- [ ] No email/phone in picker or confirmation
- [ ] Preflight reasons appear before confirmation
- [ ] Historical date/time, coach, price, status, +1 billing/CSV, backdate and package warnings
- [ ] Parent, Coach, private lessons, enrollment rows: no control
- [ ] Future group new-student and scope behavior unchanged

## Final reconciliation

- Post counts/hashes:
- Inserted enrollment/activity IDs:
- Billing/CSV reconciliation:
- Package counts/hashes:
- Retained fixture count (must be zero):
- Rollback decision and evidence:
- Hosting/client version and smoke-test URLs:
