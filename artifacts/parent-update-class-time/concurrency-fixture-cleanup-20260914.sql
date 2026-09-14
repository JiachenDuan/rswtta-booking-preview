begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:parent-time:concurrency-fixture',0));
do $verify$ declare v_count bigint; v_replayed boolean; begin
 if (select count(*) from rswtta_private.parent_class_time_idempotency where account_id='f1000000-0000-4000-8000-000000000021' and idempotency_key='f4000000-0000-4000-8000-000000000021')<>1 then raise exception 'concurrency idempotency count mismatch'; end if;
 if (select count(*) from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908' and values->>'idempotencyKey'='f4000000-0000-4000-8000-000000000021')<>1 then raise exception 'concurrency activity count mismatch'; end if;
 if (select values->>'startsAt' from public.project_rows where id='f2000000-0000-4000-8000-000000000021')<>'2026-09-29T16:00:00.000Z' then raise exception 'concurrency booking result mismatch'; end if;
end $verify$;
delete from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908' and values->>'idempotencyKey'='f4000000-0000-4000-8000-000000000021';
delete from rswtta_private.parent_class_time_idempotency where account_id='f1000000-0000-4000-8000-000000000021';
delete from rswtta_private.parent_class_time_nonces where session_id in('f5000000-0000-4000-8000-000000000021','f5000000-0000-4000-8000-000000000022');
delete from rswtta_private.parent_legacy_sessions where id in('f5000000-0000-4000-8000-000000000021','f5000000-0000-4000-8000-000000000022');
delete from public.project_rows where id='f2000000-0000-4000-8000-000000000021';
delete from public.project_rows where id='f1000000-0000-4000-8000-000000000021';
commit;
select 'PASS: exact fixture removed after one-create/one-replay concurrency outcome' as cleanup_result;
