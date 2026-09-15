-- STAGED ONLY — DO NOT APPLY with the additive foundation.
-- Apply only after the secure Parent/Club/Coach clients are deployed and observed healthy.
-- Forward-only closure of browser access to generic project storage.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:close-legacy-project-rows:v1',0));

-- Stop unauthenticated/authenticated table discovery and generic data access.
revoke all on public.projects,public.project_tables,public.project_columns,public.project_members,public.project_rows from public,anon,authenticated;

-- Remove every permissive browser policy instead of relying on privilege revocation alone.
do $drop_policies$
declare v_policy record;
begin
  for v_policy in
    select p.schemaname,p.tablename,p.policyname from pg_policies p
    where p.schemaname='public' and p.tablename in ('projects','project_tables','project_columns','project_members','project_rows')
  loop
    execute format('drop policy if exists %I on %I.%I',v_policy.policyname,v_policy.schemaname,v_policy.tablename);
  end loop;
end $drop_policies$;

-- Legacy anonymous mutations overlap the trusted boundary. These are exact
-- signatures from the repository catalog and a mismatch aborts application.
revoke execute on function public.club_preview_student_preregistration(text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.club_preregister_student(text,text,text,uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function public.club_preregister_student_v2(text,text,text,uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function public.club_search_students(text,text,text,text) from public,anon,authenticated;
revoke execute on function public.club_preview_student_preregistration_v2(text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.club_preregister_student_v3(text,text,text,uuid,text,text,jsonb,text,boolean) from public,anon,authenticated;
revoke execute on function public.rename_student_account(uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.request_booking_as_parent(uuid,text,jsonb) from public,anon,authenticated;
revoke execute on function public.cancel_booking_as_parent(uuid,text,jsonb) from public,anon,authenticated;
revoke execute on function public.reschedule_booking_occurrences(jsonb,text,text,text) from public,anon,authenticated;
revoke execute on function public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text) from public,anon,authenticated;
revoke execute on function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) from public,anon,authenticated;
revoke execute on function public.cancel_booking_as_club(uuid) from public,anon,authenticated;
revoke execute on function public.add_class_package_hours(uuid,integer,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.list_class_package_balances() from public,anon,authenticated;
revoke execute on function public.set_class_package_opening(uuid,text,text,integer,integer,bigint,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.list_class_package_balances_v2() from public,anon,authenticated;
revoke execute on function public.list_class_package_history(uuid,text) from public,anon,authenticated;
revoke execute on function public.coach_accept_invitation() from public,anon,authenticated;
revoke execute on function public.coach_my_schedule(integer) from public,anon,authenticated;
revoke execute on function public.coach_my_profile() from public,anon,authenticated;

-- Parent legacy-session RPCs stay callable only until every Parent has a verified
-- Supabase Auth binding. Review their exact production signatures immediately
-- before this final block is uncommented.
-- revoke execute on function public.parent_legacy_session_login(text,text,text) from public,anon,authenticated;
-- revoke execute on function public.parent_legacy_session_resume(text,text) from public,anon,authenticated;
-- revoke execute on function public.parent_legacy_session_logout(text,text) from public,anon,authenticated;
-- revoke execute on function public.parent_update_booking_time(text,text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text) from public,anon,authenticated;

-- Closure proof: browser roles cannot inspect or mutate storage directly while
-- authenticated callers retain only named trusted RPC contracts.
do $verify$
begin
  if has_table_privilege('anon','public.project_rows','select') or has_table_privilege('anon','public.project_rows','insert') or has_table_privilege('anon','public.project_rows','update') or
     has_table_privilege('authenticated','public.project_rows','select') or has_table_privilege('authenticated','public.project_rows','insert') or has_table_privilege('authenticated','public.project_rows','update') then
    raise exception 'project_rows direct browser access remains';
  end if;
  if exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename in ('projects','project_tables','project_columns','project_members','project_rows')) then
    raise exception 'Legacy generic-storage policies remain';
  end if;
  if not has_function_privilege('authenticated','public.operator_list_bookings(integer)','execute') or not has_function_privilege('authenticated','public.parent_my_dashboard()','execute') or not has_function_privilege('authenticated','public.operator_calendar(integer)','execute') then
    raise exception 'Trusted replacement contracts unavailable';
  end if;
end $verify$;
commit;
