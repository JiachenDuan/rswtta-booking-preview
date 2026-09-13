-- Permit an existing student to be backdated onto one canonical past group block.
-- Future single/future behavior and the public RPC signature remain unchanged.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:past-group-enrollment:migration', 0));

do $$
declare
  v_project uuid; v_bookings uuid; v_accounts uuid; v_activity uuid; v_count bigint;
begin
  select id into strict v_project from public.projects where slug='rswtta-booking';
  if v_project <> 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid then raise exception 'Past enrollment guard: project ID changed'; end if;
  select id into strict v_bookings from public.project_tables where project_id=v_project and slug='bookings';
  select id into strict v_accounts from public.project_tables where project_id=v_project and slug='parent_accounts';
  select id into strict v_activity from public.project_tables where project_id=v_project and slug='activity_logs';
  if v_accounts <> '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid then raise exception 'Past enrollment guard: account table ID changed'; end if;
  select count(*) into v_count from public.project_rows where project_table_id=v_bookings;
  if v_count<>1993 then raise exception 'Past enrollment guard: expected 1993 bookings, found %',v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id=v_accounts;
  if v_count<>65 then raise exception 'Past enrollment guard: expected 65 accounts, found %',v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id=v_activity;
  if v_count<>66 then raise exception 'Past enrollment guard: expected 66 activity rows, found %',v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id=v_bookings and values->>'program'='Group class';
  if v_count<>141 then raise exception 'Past enrollment guard: expected 141 group blocks, found %',v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id=v_bookings and values->>'program'='Group enrollment';
  if v_count<>33 then raise exception 'Past enrollment guard: expected 33 group enrollments, found %',v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id=v_bookings and values->>'program'='Group class' and (values->>'startsAt')::timestamptz<=clock_timestamp();
  if v_count<>15 then raise exception 'Past enrollment guard: expected 15 past group blocks, found %',v_count; end if;
  if exists(select 1 from public.project_rows where project_table_id=v_bookings and values->>'program'='Group class' and (values->>'startsAt')::timestamptz<=clock_timestamp() and values->>'status'<>'club_confirmed') then raise exception 'Past enrollment guard: past block lifecycle changed'; end if;
  if to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)') is null then raise exception 'Past enrollment guard: baseline RPC missing'; end if;
  if (select prosecdef from pg_proc where oid=to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)')) then raise exception 'Past enrollment guard: baseline RPC must remain security invoker'; end if;
  if (select count(*) from public.class_package_keys)<>0 or (select count(*) from public.class_package_events)<>0 then raise exception 'Past enrollment guard: package state is no longer empty'; end if;
  if to_regclass('private_migration_backups.past_group_manifest_20260913_0930') is null then raise exception 'Past enrollment guard: verified private backup is required'; end if;
  if (select ordered_md5 from private_migration_backups.past_group_manifest_20260913_0930 where kind='bookings') is distinct from (select md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by id),'')) from public.project_rows r where project_table_id=v_bookings) then raise exception 'Past enrollment guard: booking ordered hash changed after backup'; end if;
  if (select ordered_md5 from private_migration_backups.past_group_manifest_20260913_0930 where kind='accounts') is distinct from (select md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by id),'')) from public.project_rows r where project_table_id=v_accounts) then raise exception 'Past enrollment guard: account ordered hash changed after backup'; end if;
  if (select ordered_md5 from private_migration_backups.past_group_manifest_20260913_0930 where kind='activity') is distinct from (select md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by id),'')) from public.project_rows r where project_table_id=v_activity) then raise exception 'Past enrollment guard: activity ordered hash changed after backup'; end if;
end $$;

create or replace function public.add_student_to_group_occurrences(
  p_selected_block_id uuid, p_scope text, p_student_account_id uuid,
  p_expected_series_id text, p_expected_occurrence_id text, p_expected_original_starts_at text,
  p_expected_occurrence_count integer, p_expected_blocks jsonb, p_idempotency_key uuid
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_project uuid; v_bookings uuid; v_accounts uuid; v_activity uuid;
  v_selected public.project_rows%rowtype; v_account public.project_rows%rowtype; v_existing public.project_rows%rowtype;
  v_actual public.project_rows%rowtype; v_expected jsonb; v_block public.project_rows%rowtype;
  v_target_ids uuid[]:='{}'; v_group_ids text[]:='{}'; v_inserted uuid[]:='{}';
  v_count integer; v_capacity integer; v_roster integer; v_new_id uuid;
  v_duplicate_dates text; v_conflict_dates text; v_capacity_dates text; v_price integer:=7500;
  v_is_past boolean; v_status text; v_coach text; v_ids jsonb; v_values jsonb;
  v_request_fingerprint text;
begin
  if p_scope not in ('single','future') then raise exception 'Invalid group enrollment scope'; end if;
  if p_expected_occurrence_count<1 or jsonb_typeof(p_expected_blocks)<>'array' or jsonb_array_length(p_expected_blocks)<>p_expected_occurrence_count then raise exception 'Expected group block scope is incomplete'; end if;
  if p_idempotency_key is null then raise exception 'Group enrollment idempotency key is required'; end if;
  select id into strict v_project from public.projects where slug='rswtta-booking';
  select id into strict v_bookings from public.project_tables where project_id=v_project and slug='bookings';
  select id into strict v_accounts from public.project_tables where project_id=v_project and slug='parent_accounts';
  select id into strict v_activity from public.project_tables where project_id=v_project and slug='activity_logs';
  v_request_fingerprint:=md5(jsonb_build_object(
    'selectedBlockId',p_selected_block_id,'scope',p_scope,'studentAccountId',p_student_account_id,
    'seriesId',p_expected_series_id,'occurrenceId',p_expected_occurrence_id,
    'originalStartsAt',p_expected_original_starts_at,'occurrenceCount',p_expected_occurrence_count,
    'blocks',p_expected_blocks
  )::text);

  perform pg_advisory_xact_lock(hashtextextended('group-add-idempotency:'||p_idempotency_key::text,0));
  select * into v_existing from public.project_rows where project_table_id=v_activity and values->>'action'='group_student_added' and values->>'idempotencyKey'=p_idempotency_key::text;
  if found then
    if coalesce(v_existing.values->>'requestFingerprint','')<>'' then
      if v_existing.values->>'requestFingerprint'<>v_request_fingerprint then raise exception 'Group enrollment idempotency key was reused for a different request'; end if;
    elsif v_existing.values->>'studentAccountId'<>p_student_account_id::text
      or v_existing.values->>'selectedOccurrenceId'<>p_expected_occurrence_id
      or v_existing.values->>'scope'<>p_scope then
      raise exception 'Group enrollment idempotency key was reused for a different request';
    end if;
    v_ids:=v_existing.values->'enrollmentIds';
    if jsonb_typeof(v_ids)<>'array' or jsonb_array_length(v_ids)<>(v_existing.values->>'count')::integer then raise exception 'Stored group enrollment idempotency result is incomplete'; end if;
    return (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.project_rows r where r.project_table_id=v_bookings and r.id in(select value::text::uuid from jsonb_array_elements_text(v_ids)));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-request:student:'||p_student_account_id::text,0));
  select * into strict v_account from public.project_rows where id=p_student_account_id and project_table_id=v_accounts for update;
  if btrim(coalesce(v_account.values->>'studentName',''))='' then raise exception 'Student account identity is incomplete'; end if;
  select * into strict v_selected from public.project_rows where id=p_selected_block_id and project_table_id=v_bookings for update;
  if v_selected.values->>'program'<>'Group class' or lower(btrim(v_selected.values->>'studentName'))<>'group class'
    or coalesce(v_selected.values->>'status','') not in ('club_confirmed','coach_confirmed') then
    raise exception 'Selected row is not a canonical active or completed group class block';
  end if;
  if coalesce(v_selected.values->>'groupClassId','')='' or coalesce(v_selected.values->>'seriesId','')='' or coalesce(v_selected.values->>'recurrenceOccurrenceId','')='' or coalesce(v_selected.values->>'recurrenceOriginalStartsAt','')='' then raise exception 'Selected group occurrence identity is incomplete'; end if;
  if v_selected.values->>'seriesId'<>p_expected_series_id or v_selected.values->>'recurrenceOccurrenceId'<>p_expected_occurrence_id or v_selected.values->>'recurrenceOriginalStartsAt'<>p_expected_original_starts_at then raise exception 'Selected group occurrence changed while adding the student'; end if;
  v_is_past := (v_selected.values->>'startsAt')::timestamptz<=clock_timestamp();
  if v_is_past and p_scope<>'single' then raise exception 'Past group enrollment is limited to one occurrence'; end if;
  if not v_is_past and v_selected.values->>'status'='coach_confirmed' then raise exception 'Only an active future group class can receive a student'; end if;

  perform pg_advisory_xact_lock(hashtextextended('group-series:'||p_expected_series_id,0));
  if p_scope='single' then v_target_ids:=array[p_selected_block_id]; else
    select coalesce(array_agg(id order by (values->>'recurrenceOriginalStartsAt')::timestamptz,id),'{}') into v_target_ids from public.project_rows
      where project_table_id=v_bookings and values->>'program'='Group class' and values->>'seriesId'=p_expected_series_id
      and (values->>'recurrenceOriginalStartsAt')::timestamptz>=p_expected_original_starts_at::timestamptz
      and (values->>'startsAt')::timestamptz>clock_timestamp() and coalesce(values->>'status','') not in ('cancelled','coach_confirmed');
  end if;
  v_count:=coalesce(array_length(v_target_ids,1),0);
  if v_count<>p_expected_occurrence_count or not(p_selected_block_id=any(v_target_ids)) then raise exception 'Group occurrence count changed: expected %, found %',p_expected_occurrence_count,v_count; end if;
  if exists(select 1 from public.project_rows target where target.id=any(v_target_ids) and (select count(*) from public.project_rows canonical where canonical.project_table_id=v_bookings and canonical.values->>'program'='Group class' and canonical.values->>'groupClassId'=target.values->>'groupClassId')<>1) then raise exception 'Each target occurrence must have exactly one canonical group block'; end if;
  select array_agg(values->>'groupClassId' order by values->>'groupClassId') into v_group_ids from public.project_rows where id=any(v_target_ids);
  for v_coach in select unnest(v_group_ids) order by 1 loop perform pg_advisory_xact_lock(hashtextextended('group-class:'||v_coach,0)); end loop;
  perform 1 from public.project_rows where id=any(v_target_ids) order by id for update;

  for v_expected in select value from jsonb_array_elements(p_expected_blocks) loop
    if nullif(v_expected->>'id','') is null or not((v_expected->>'id')::uuid=any(v_target_ids)) then raise exception 'Expected group block scope contains a missing row'; end if;
    select * into strict v_actual from public.project_rows where id=(v_expected->>'id')::uuid and project_table_id=v_bookings;
    if v_actual.values->>'groupClassId' is distinct from v_expected->>'groupClassId' or v_actual.values->>'seriesId' is distinct from v_expected->>'seriesId' or v_actual.values->>'recurrenceOccurrenceId' is distinct from v_expected->>'recurrenceOccurrenceId' or v_actual.values->>'recurrenceOriginalStartsAt' is distinct from v_expected->>'recurrenceOriginalStartsAt' or v_actual.values->>'startsAt' is distinct from v_expected->>'startsAt' or v_actual.values->>'status' is distinct from v_expected->>'status' or v_actual.updated_at is distinct from (v_expected->>'updatedAt')::timestamptz then raise exception 'Group block changed while adding the student: %',v_actual.id; end if;
  end loop;
  if exists(select 1 from unnest(v_target_ids) id where not exists(select 1 from jsonb_array_elements(p_expected_blocks) e where (e->>'id')::uuid=id)) then raise exception 'Expected group block scope omitted a row'; end if;

  select string_agg(r.values->>'dateLabel',', ' order by r.values->>'startsAt') into v_duplicate_dates from public.project_rows r where r.id=any(v_target_ids) and exists(select 1 from public.project_rows e where e.project_table_id=v_bookings and e.values->>'program'='Group enrollment' and e.values->>'groupClassId'=r.values->>'groupClassId' and e.values->>'studentAccountId'=p_student_account_id::text);
  if v_duplicate_dates is not null then raise exception 'Student has active or cancelled enrollment history on: %',v_duplicate_dates; end if;
  select string_agg(r.values->>'dateLabel',', ' order by r.values->>'startsAt') into v_conflict_dates from public.project_rows r where r.id=any(v_target_ids) and exists(select 1 from public.project_rows e where e.project_table_id=v_bookings and e.values->>'studentAccountId'=p_student_account_id::text and coalesce(e.values->>'status','')<>'cancelled' and (e.values->>'startsAt')::timestamptz<public.rswtta_booking_ends_at(r.values) and public.rswtta_booking_ends_at(e.values)>(r.values->>'startsAt')::timestamptz);
  if v_conflict_dates is not null then raise exception 'Student has a conflicting class on: %',v_conflict_dates; end if;

  for v_block in select * from public.project_rows where id=any(v_target_ids) order by id loop
    if coalesce(v_block.values->>'capacity',v_block.values->>'maxCapacity','')<>'' then
      begin v_capacity:=coalesce(nullif(v_block.values->>'capacity','')::integer,nullif(v_block.values->>'maxCapacity','')::integer); exception when invalid_text_representation then raise exception 'Invalid group capacity on %',v_block.values->>'dateLabel'; end;
      if v_capacity is null or v_capacity<1 then raise exception 'Invalid group capacity on %',v_block.values->>'dateLabel'; end if;
      select count(*) into v_roster from public.project_rows where project_table_id=v_bookings and values->>'program'='Group enrollment' and values->>'groupClassId'=v_block.values->>'groupClassId' and coalesce(values->>'status','')<>'cancelled';
      if v_roster>=v_capacity then v_capacity_dates:=concat_ws(', ',nullif(v_capacity_dates,''),v_block.values->>'dateLabel'); end if;
    end if;
  end loop;
  if v_capacity_dates is not null then raise exception 'Group capacity is full on: %',v_capacity_dates; end if;
  select (values->>'priceCents')::integer into v_price from public.project_rows where project_table_id=v_bookings and values->>'program'='Group enrollment' and values->>'groupClassId'=any(v_group_ids) and (values->>'priceCents')::integer>0 order by created_at desc,id limit 1;
  v_price:=coalesce(v_price,7500);

  for v_block in select * from public.project_rows where id=any(v_target_ids) order by (values->>'recurrenceOriginalStartsAt')::timestamptz,id loop
    v_new_id:=gen_random_uuid(); v_coach:=coalesce(nullif(v_block.values->>'assignedCoach',''),v_block.values->>'requestedCoach',''); v_status:=case when v_block.values->>'status'='coach_confirmed' then 'coach_confirmed' else 'club_confirmed' end;
    v_values:=jsonb_build_object('studentAccountId',p_student_account_id::text,'seriesId',v_block.values->>'seriesId','recurrenceOccurrenceId',(v_block.values->>'recurrenceOccurrenceId')||':student:'||p_student_account_id::text,'recurrenceOriginalStartsAt',v_block.values->>'recurrenceOriginalStartsAt','groupClassId',v_block.values->>'groupClassId','studentName',v_account.values->>'studentName','familyName',v_account.values->>'studentName','studentEmail',coalesce(v_account.values->>'email',''),'phone',coalesce(v_account.values->>'phone',''),'requestedCoach',v_coach,'assignedCoach',v_coach,'program','Group enrollment','dateLabel',v_block.values->>'dateLabel','timeLabel',v_block.values->>'timeLabel','startsAt',v_block.values->>'startsAt','priceCents',v_price,'status',v_status,'parentNote','Added to group class by club; package deduction not automatic.');
    insert into public.project_rows(id,project_table_id,values) values(v_new_id,v_bookings,v_values); v_inserted:=array_append(v_inserted,v_new_id);
  end loop;
  insert into public.project_rows(project_table_id,values) values(v_activity,jsonb_build_object('action','group_student_added','message',format('Added %s to %s group class occurrence(s), scope=%s.',v_account.values->>'studentName',v_count,p_scope),'studentAccountId',p_student_account_id::text,'studentName',v_account.values->>'studentName','coach',coalesce(v_selected.values->>'assignedCoach',v_selected.values->>'requestedCoach',''),'dateLabel',v_selected.values->>'dateLabel','timeLabel',v_selected.values->>'timeLabel','count',v_count,'scope',p_scope,'selectedBlockId',p_selected_block_id::text,'selectedOccurrenceId',p_expected_occurrence_id,'idempotencyKey',p_idempotency_key::text,'requestFingerprint',v_request_fingerprint,'enrollmentIds',to_jsonb(v_inserted),'backdated',v_is_past,'packageDeduction',false));
  return(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.project_rows r where r.id=any(v_inserted));
exception when unique_violation then raise exception 'Student membership changed concurrently; no enrollments were added: %',sqlerrm; when invalid_text_representation or datetime_field_overflow then raise exception 'Invalid group enrollment identity or schedule';
end $$;

revoke all on function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) from public;
grant execute on function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) to anon, authenticated;
commit;
