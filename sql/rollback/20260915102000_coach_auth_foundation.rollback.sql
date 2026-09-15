-- Guarded rollback for Phase 0 Coach auth foundation. Stops if any real membership exists.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:coach-auth-foundation:migration',0));
set local lock_timeout='15s';
-- Supabase's ensure_rls event trigger scans unrelated schemas after each DDL
-- command and can deadlock with live project_rows readers. The transaction
-- restores it automatically on failure; explicitly re-enable before commit.
alter event trigger ensure_rls disable;
lock table public.project_rows in access exclusive mode;
do $guard$ begin
 if to_regclass('public.project_coach_memberships') is null then raise exception 'Coach membership table is absent'; end if;
 if exists(select 1 from public.project_coach_memberships) then raise exception 'Stop: Coach memberships exist; do not roll back identity bindings automatically'; end if;
 if exists(select 1 from public.coach_auth_audit_events) then raise exception 'Stop: Coach auth audit events exist; do not erase immutable history automatically'; end if;
 if (select count(*) from rswtta_private.coach_auth_source_backup_20260915102000)<>2046 then raise exception 'Coach source backup count mismatch'; end if;
end $guard$;
drop trigger if exists sync_booking_coach_assignments on public.project_rows;
drop function if exists public.coach_my_schedule(integer);
drop function if exists public.coach_my_profile();
drop function if exists public.coach_accept_invitation();
drop function if exists rswtta_private.sync_booking_coach_assignments();
drop table if exists public.booking_coach_assignments;
drop table if exists public.coach_auth_audit_events;
drop table if exists public.project_coach_memberships;
drop table if exists public.coaches;
drop function if exists rswtta_private.audit_coach_membership_state();
drop function if exists rswtta_private.reject_coach_audit_mutation();
drop function if exists rswtta_private.guard_membership_identity();
drop function if exists rswtta_private.guard_coach_identity();
drop function if exists rswtta_private.canonical_coach_id(text);
alter event trigger ensure_rls enable;
do $verify$ declare v_count bigint; v_hash text; begin
 select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid;
 if v_count<>2046 or v_hash<>'3f83ceecd49e9a27f78e853bee87ebf842755d26f5e6c30973e84784c0e8b878' then raise exception 'Coach rollback source mismatch % %',v_count,v_hash; end if;
 if to_regclass('public.coaches') is not null or to_regprocedure('public.coach_my_schedule(integer)') is not null then raise exception 'Coach rollback left public objects'; end if;
end $verify$;
commit;
