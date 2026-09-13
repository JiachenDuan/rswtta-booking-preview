-- Production-safe acceptance: every fixture and RPC write is enclosed by the terminal rollback.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:past-group-enrollment:acceptance',0));

create temporary table acceptance_baseline as
select
  (select count(*) from public.class_package_keys) package_key_count,
  (select count(*) from public.class_package_events) package_event_count,
  (select md5(coalesce(string_agg(md5(row_to_json(k)::text),'' order by k.id),'')) from public.class_package_keys k) package_key_hash,
  (select md5(coalesce(string_agg(md5(row_to_json(e)::text),'' order by e.id),'')) from public.class_package_events e) package_event_hash;

create or replace function pg_temp.expected_group_block(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id',r.id,'groupClassId',r.values->>'groupClassId','seriesId',r.values->>'seriesId',
    'recurrenceOccurrenceId',r.values->>'recurrenceOccurrenceId',
    'recurrenceOriginalStartsAt',r.values->>'recurrenceOriginalStartsAt',
    'startsAt',r.values->>'startsAt','status',r.values->>'status','updatedAt',r.updated_at
  ) from public.project_rows r where r.id=p_id
$$;

-- Two disposable canonical accounts.
insert into public.project_rows(id,project_table_id,values) values
('00000000-0000-4000-8000-000000009301',(select t.id from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='parent_accounts'),'{"studentName":"Acceptance Student A","parentName":"Fixture","email":"fixture-a@example.invalid","phone":"0000000001","confirmed":true,"profileSetupRequired":false}'::jsonb),
('00000000-0000-4000-8000-000000009302',(select t.id from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='parent_accounts'),'{"studentName":"Acceptance Student B","parentName":"Fixture","email":"fixture-b@example.invalid","phone":"0000000002","confirmed":true,"profileSetupRequired":false}'::jsonb);

-- Canonical block fixtures: confirmed past, completed past, conflict, capacity, cancelled, and two future blocks.
insert into public.project_rows(id,project_table_id,values) values
('10000000-0000-4000-8000-000000009301',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:confirmed","seriesId":"series:acceptance:confirmed","recurrenceOccurrenceId":"series:acceptance:confirmed@2026-08-01T17:00:00.000Z","recurrenceOriginalStartsAt":"2026-08-01T17:00:00.000Z","startsAt":"2026-08-01T17:00:00.000Z","dateLabel":"Sat, Aug 1, 2026","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb),
('10000000-0000-4000-8000-000000009302',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:completed","seriesId":"series:acceptance:completed","recurrenceOccurrenceId":"series:acceptance:completed@2026-08-02T17:00:00.000Z","recurrenceOriginalStartsAt":"2026-08-02T17:00:00.000Z","startsAt":"2026-08-02T17:00:00.000Z","dateLabel":"Sun, Aug 2, 2026","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"status":"coach_confirmed","parentNote":"acceptance"}'::jsonb),
('10000000-0000-4000-8000-000000009303',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:conflict","seriesId":"series:acceptance:conflict","recurrenceOccurrenceId":"series:acceptance:conflict@2026-08-03T17:00:00.000Z","recurrenceOriginalStartsAt":"2026-08-03T17:00:00.000Z","startsAt":"2026-08-03T17:00:00.000Z","dateLabel":"Mon, Aug 3, 2026","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb),
('10000000-0000-4000-8000-000000009304',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:capacity","seriesId":"series:acceptance:capacity","recurrenceOccurrenceId":"series:acceptance:capacity@2026-08-04T17:00:00.000Z","recurrenceOriginalStartsAt":"2026-08-04T17:00:00.000Z","startsAt":"2026-08-04T17:00:00.000Z","dateLabel":"Tue, Aug 4, 2026","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"capacity":1,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb),
('10000000-0000-4000-8000-000000009305',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:cancelled","seriesId":"series:acceptance:cancelled","recurrenceOccurrenceId":"series:acceptance:cancelled@2026-08-05T17:00:00.000Z","recurrenceOriginalStartsAt":"2026-08-05T17:00:00.000Z","startsAt":"2026-08-05T17:00:00.000Z","dateLabel":"Wed, Aug 5, 2026","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"status":"cancelled","parentNote":"acceptance"}'::jsonb),
('10000000-0000-4000-8000-000000009306',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:future1","seriesId":"series:acceptance:future","recurrenceOccurrenceId":"series:acceptance:future@2027-08-01T17:00:00.000Z","recurrenceOriginalStartsAt":"2027-08-01T17:00:00.000Z","startsAt":"2027-08-01T17:00:00.000Z","dateLabel":"Sun, Aug 1, 2027","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb),
('10000000-0000-4000-8000-000000009307',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:future2","seriesId":"series:acceptance:future","recurrenceOccurrenceId":"series:acceptance:future@2027-08-08T17:00:00.000Z","recurrenceOriginalStartsAt":"2027-08-08T17:00:00.000Z","startsAt":"2027-08-08T17:00:00.000Z","dateLabel":"Sun, Aug 8, 2027","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb),
('10000000-0000-4000-8000-000000009308',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentName":"Group class","familyName":"Group class","program":"Group class","groupClassId":"group:acceptance:missing-identity","startsAt":"2026-08-06T17:00:00.000Z","dateLabel":"Thu, Aug 6, 2026","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":0,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb);

-- Mirror the production recurrence trigger contract so a malformed engineering fixture
-- stops before insertion with a fixture-specific error instead of obscuring RPC results.
create temporary table acceptance_conflict_fixture(values jsonb not null);
insert into acceptance_conflict_fixture(values) values
('{"studentAccountId":"00000000-0000-4000-8000-000000009301","studentName":"Acceptance Student A","familyName":"Acceptance Student A","program":"Private lesson","seriesId":"series:acceptance:private-conflict","recurrenceOccurrenceId":"series:acceptance:private-conflict@2026-08-03T17:30:00.000Z","recurrenceOriginalStartsAt":"2026-08-03T17:30:00.000Z","startsAt":"2026-08-03T17:30:00.000Z","dateLabel":"Mon, Aug 3, 2026","timeLabel":"10:30 AM - 11:30 AM","requestedCoach":"National A","assignedCoach":"National A","priceCents":7500,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb);
do $$
begin
  if exists(select 1 from acceptance_conflict_fixture f where coalesce(f.values->>'seriesId','')='' or coalesce(f.values->>'recurrenceOccurrenceId','')='' or coalesce(f.values->>'recurrenceOriginalStartsAt','')='') then raise exception 'Acceptance fixture recurrence identity is incomplete'; end if;
  if not exists(select 1 from acceptance_conflict_fixture f where f.values->>'seriesId'='series:acceptance:private-conflict' and f.values->>'recurrenceOccurrenceId'='series:acceptance:private-conflict@2026-08-03T17:30:00.000Z' and f.values->>'recurrenceOriginalStartsAt'='2026-08-03T17:30:00.000Z') then raise exception 'Acceptance conflict fixture immutable recurrence identity changed'; end if;
end $$;

-- Supporting active roster and conflict rows.
insert into public.project_rows(id,project_table_id,values) values
('20000000-0000-4000-8000-000000009304',(select id from public.project_tables where slug='bookings' and project_id=(select id from public.projects where slug='rswtta-booking')),'{"studentAccountId":"00000000-0000-4000-8000-000000009302","studentName":"Acceptance Student B","familyName":"Acceptance Student B","program":"Group enrollment","groupClassId":"group:acceptance:capacity","seriesId":"series:acceptance:capacity","recurrenceOccurrenceId":"series:acceptance:capacity@2026-08-04T17:00:00.000Z:student:00000000-0000-4000-8000-000000009302","recurrenceOriginalStartsAt":"2026-08-04T17:00:00.000Z","startsAt":"2026-08-04T17:00:00.000Z","dateLabel":"Tue, Aug 4, 2026","timeLabel":"10 AM - 11 AM","requestedCoach":"Coach Jorden","assignedCoach":"Coach Jorden","priceCents":7500,"status":"club_confirmed","parentNote":"acceptance"}'::jsonb);
insert into public.project_rows(id,project_table_id,values)
select '20000000-0000-4000-8000-000000009303',t.id,f.values from acceptance_conflict_fixture f cross join public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings';

do $$
declare
  v_result jsonb; v_replay jsonb; v_enrollment_id uuid; v_activity_count bigint;
  v_before_eligible bigint; v_before_unresolved bigint; v_after_eligible bigint; v_after_unresolved bigint;
  v_bookings uuid := (select t.id from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings');
  v_activity uuid := (select t.id from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='activity_logs');
begin
  select count(*) filter(where values->>'status' in ('club_confirmed','coach_confirmed')),
         count(*) filter(where coalesce(values->>'studentAccountId','')='')
  into v_before_eligible,v_before_unresolved from public.project_rows where project_table_id=v_bookings and values->>'program'='Group enrollment';

  -- Persisted past uncompleted block: one confirmed enrollment, canonical snapshots, and exact replay.
  select public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009301','single','00000000-0000-4000-8000-000000009301','series:acceptance:confirmed','series:acceptance:confirmed@2026-08-01T17:00:00.000Z','2026-08-01T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009301')),'30000000-0000-4000-8000-000000009301') into v_result;
  if jsonb_array_length(v_result)<>1 or v_result->0->'values'->>'status'<>'club_confirmed' or v_result->0->'values'->>'studentName'<>'Acceptance Student A' or v_result->0->'values'->>'studentEmail'<>'fixture-a@example.invalid' or (v_result->0->'values'->>'priceCents')::integer<>7500 then raise exception 'Acceptance failed: past confirmed result'; end if;
  v_enrollment_id:=(v_result->0->>'id')::uuid;
  if v_result->0->'values'->>'recurrenceOccurrenceId'<>'series:acceptance:confirmed@2026-08-01T17:00:00.000Z:student:00000000-0000-4000-8000-000000009301' then raise exception 'Acceptance failed: stable enrollment occurrence identity'; end if;
  select public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009301','single','00000000-0000-4000-8000-000000009301','series:acceptance:confirmed','series:acceptance:confirmed@2026-08-01T17:00:00.000Z','2026-08-01T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009301')),'30000000-0000-4000-8000-000000009301') into v_replay;
  if (v_replay->0->>'id')::uuid<>v_enrollment_id then raise exception 'Acceptance failed: idempotent replay changed enrollment ID'; end if;
  select count(*) into v_activity_count from public.project_rows where project_table_id=v_activity and values->>'idempotencyKey'='30000000-0000-4000-8000-000000009301';
  if v_activity_count<>1 then raise exception 'Acceptance failed: replay activity cardinality %',v_activity_count; end if;

  -- Same key with changed payload must fail before another write.
  begin
    perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009301','single','00000000-0000-4000-8000-000000009301','series:acceptance:confirmed','series:acceptance:confirmed@2026-08-01T17:00:00.000Z','2026-08-01T17:00:00.000Z',2,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009301'),pg_temp.expected_group_block('10000000-0000-4000-8000-000000009301')),'30000000-0000-4000-8000-000000009301');
    raise exception 'Acceptance failed: changed idempotency payload accepted';
  exception when others then if sqlerrm not like '%different request%' then raise; end if; end;

  -- Explicitly completed historical block records attended status directly.
  select public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009302','single','00000000-0000-4000-8000-000000009302','series:acceptance:completed','series:acceptance:completed@2026-08-02T17:00:00.000Z','2026-08-02T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009302')),'30000000-0000-4000-8000-000000009302') into v_result;
  if v_result->0->'values'->>'status'<>'coach_confirmed' then raise exception 'Acceptance failed: completed status was not preserved'; end if;

  -- Future-series behavior remains two atomic enrollments.
  select public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009306','future','00000000-0000-4000-8000-000000009302','series:acceptance:future','series:acceptance:future@2027-08-01T17:00:00.000Z','2027-08-01T17:00:00.000Z',2,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009306'),pg_temp.expected_group_block('10000000-0000-4000-8000-000000009307')),'30000000-0000-4000-8000-000000009306') into v_result;
  if jsonb_array_length(v_result)<>2 then raise exception 'Acceptance failed: future scope changed'; end if;

  -- Past future scope, cancelled block, stale snapshot, missing block, conflict, and capacity all reject atomically.
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009301','future','00000000-0000-4000-8000-000000009302','series:acceptance:confirmed','series:acceptance:confirmed@2026-08-01T17:00:00.000Z','2026-08-01T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009301')),'30000000-0000-4000-8000-000000009311'); raise exception 'Acceptance failed: past future scope accepted'; exception when others then if sqlerrm not like '%limited to one occurrence%' then raise; end if; end;
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009305','single','00000000-0000-4000-8000-000000009301','series:acceptance:cancelled','series:acceptance:cancelled@2026-08-05T17:00:00.000Z','2026-08-05T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009305')),'30000000-0000-4000-8000-000000009312'); raise exception 'Acceptance failed: cancelled block accepted'; exception when others then if sqlerrm not like '%canonical active or completed%' then raise; end if; end;
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009303','single','00000000-0000-4000-8000-000000009301','series:acceptance:conflict','series:acceptance:conflict@2026-08-03T17:00:00.000Z','2026-08-03T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009303')),'30000000-0000-4000-8000-000000009313'); raise exception 'Acceptance failed: conflict accepted'; exception when others then if sqlerrm not like '%conflicting class%' then raise; end if; end;
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009304','single','00000000-0000-4000-8000-000000009301','series:acceptance:capacity','series:acceptance:capacity@2026-08-04T17:00:00.000Z','2026-08-04T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009304')),'30000000-0000-4000-8000-000000009314'); raise exception 'Acceptance failed: full capacity accepted'; exception when others then if sqlerrm not like '%capacity is full%' then raise; end if; end;
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009303','single','00000000-0000-4000-8000-000000009302','series:acceptance:conflict','series:acceptance:conflict@2026-08-03T17:00:00.000Z','2026-08-03T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009303')||'{"status":"requested"}'::jsonb),'30000000-0000-4000-8000-000000009315'); raise exception 'Acceptance failed: stale snapshot accepted'; exception when others then if sqlerrm not like '%changed while adding%' then raise; end if; end;
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009399','single','00000000-0000-4000-8000-000000009301','series:missing','occurrence:missing','2026-08-06T17:00:00.000Z',1,'[]'::jsonb,'30000000-0000-4000-8000-000000009316'); raise exception 'Acceptance failed: missing block accepted'; exception when others then if sqlerrm not like '%scope is incomplete%' and sqlerrm not like '%query returned no rows%' then raise; end if; end;
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009308','single','00000000-0000-4000-8000-000000009301','','','',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009308')),'30000000-0000-4000-8000-000000009318'); raise exception 'Acceptance failed: incomplete occurrence identity accepted'; exception when others then if sqlerrm not like '%occurrence identity is incomplete%' then raise; end if; end;

  -- Cancelled history is still duplicate evidence and cannot be silently restored.
  insert into public.project_rows(project_table_id,values) select v_bookings,(values||jsonb_build_object('studentAccountId','00000000-0000-4000-8000-000000009302','studentName','Acceptance Student B','familyName','Acceptance Student B','program','Group enrollment','recurrenceOccurrenceId',(values->>'recurrenceOccurrenceId')||':student:00000000-0000-4000-8000-000000009302','priceCents',7500,'status','cancelled')) from public.project_rows where id='10000000-0000-4000-8000-000000009303';
  begin perform public.add_student_to_group_occurrences('10000000-0000-4000-8000-000000009303','single','00000000-0000-4000-8000-000000009302','series:acceptance:conflict','series:acceptance:conflict@2026-08-03T17:00:00.000Z','2026-08-03T17:00:00.000Z',1,jsonb_build_array(pg_temp.expected_group_block('10000000-0000-4000-8000-000000009303')),'30000000-0000-4000-8000-000000009317'); raise exception 'Acceptance failed: cancelled history duplicated'; exception when others then if sqlerrm not like '%active or cancelled enrollment history%' then raise; end if; end;

  select count(*) filter(where values->>'status' in ('club_confirmed','coach_confirmed')),
         count(*) filter(where coalesce(values->>'studentAccountId','')='')
  into v_after_eligible,v_after_unresolved from public.project_rows where project_table_id=v_bookings and values->>'program'='Group enrollment';
  if v_after_eligible-v_before_eligible<>4 then raise exception 'Acceptance failed: eligible reconciliation expected +4 across accepted scenarios, found %',v_after_eligible-v_before_eligible; end if;
  if v_after_unresolved<>v_before_unresolved then raise exception 'Acceptance failed: unresolved rows changed'; end if;
  if (select package_key_count from acceptance_baseline)<>(select count(*) from public.class_package_keys)
    or (select package_event_count from acceptance_baseline)<>(select count(*) from public.class_package_events)
    or (select package_key_hash from acceptance_baseline) is distinct from (select md5(coalesce(string_agg(md5(row_to_json(k)::text),'' order by k.id),'')) from public.class_package_keys k)
    or (select package_event_hash from acceptance_baseline) is distinct from (select md5(coalesce(string_agg(md5(row_to_json(e)::text),'' order by e.id),'')) from public.class_package_events e) then
    raise exception 'Acceptance failed: package state changed';
  end if;
end $$;

select jsonb_pretty(jsonb_build_object(
 'acceptance','passed before rollback',
 'fixture_accounts',(select count(*) from public.project_rows where id in('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-000000009302')),
 'fixture_blocks',(select count(*) from public.project_rows where id::text like '10000000-0000-4000-8000-0000000093%'),
 'package_keys',(select count(*) from public.class_package_keys),
 'package_events',(select count(*) from public.class_package_events)
)) acceptance_result;
rollback;
