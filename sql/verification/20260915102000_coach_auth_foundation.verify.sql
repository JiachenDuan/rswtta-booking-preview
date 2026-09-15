-- Read-only verification for Phase 0 Coach auth foundation.
select jsonb_build_object(
 'coach_count',(select count(*) from public.coaches where project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'),
 'membership_count',(select count(*) from public.project_coach_memberships),
 'audit_event_count',(select count(*) from public.coach_auth_audit_events),
 'booking_count',(select count(*) from public.project_rows where project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'),
 'booking_assignment_count',(select count(*) from public.booking_coach_assignments where project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'),
 'booking_assignment_mismatches',(select count(*) from public.booking_coach_assignments a join public.project_rows r on r.id=a.booking_row_id where a.coach_id<>rswtta_private.canonical_coach_id(case when a.assignment_kind='assigned' then r.values->>'assignedCoach' else r.values->>'requestedCoach' end)),
 'backup_count',(select count(*) from rswtta_private.coach_auth_source_backup_20260915102000),
 'anon_coaches_select',has_table_privilege('anon','public.coaches','select'),
 'authenticated_memberships_select',has_table_privilege('authenticated','public.project_coach_memberships','select'),
 'authenticated_audit_select',has_table_privilege('authenticated','public.coach_auth_audit_events','select'),
 'anon_schedule_execute',has_function_privilege('anon','public.coach_my_schedule(integer)','execute'),
 'authenticated_schedule_execute',has_function_privilege('authenticated','public.coach_my_schedule(integer)','execute'),
 'function_hashes',(select jsonb_object_agg(p.oid::regprocedure::text,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex') order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('coach_accept_invitation','coach_my_profile','coach_my_schedule'))
) as verification;
