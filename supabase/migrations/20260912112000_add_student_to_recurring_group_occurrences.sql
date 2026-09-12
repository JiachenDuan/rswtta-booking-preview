-- Add one existing student account to one or future recurring group occurrences atomically.
do $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_accounts_table_id uuid;
  v_activity_table_id uuid;
  v_count bigint;
begin
  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into strict v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  select id into strict v_activity_table_id from public.project_tables where project_id = v_project_id and slug = 'activity_logs';

  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id;
  if v_count <> 1998 then raise exception 'Group enrollment booking-count guard failed: expected 1998, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_accounts_table_id;
  if v_count <> 73 then raise exception 'Group enrollment account-count guard failed: expected 73, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_activity_table_id;
  if v_count <> 53 then raise exception 'Group enrollment activity-count guard failed: expected 53, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id and values->>'program' = 'Group class';
  if v_count <> 141 then raise exception 'Group enrollment block-count guard failed: expected 141, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id and coalesce(values->>'groupClassId', '') <> '';
  if v_count <> 162 then raise exception 'Group enrollment linked-row guard failed: expected 162, found %', v_count; end if;
  if exists (
    select 1 from public.project_rows r where r.project_table_id = v_bookings_table_id and r.values->>'program' = 'Group class'
      and (coalesce(r.values->>'groupClassId', '') = '' or coalesce(r.values->>'seriesId', '') = ''
        or coalesce(r.values->>'recurrenceOccurrenceId', '') = '' or coalesce(r.values->>'recurrenceOriginalStartsAt', '') = ''
        or coalesce(r.values->>'startsAt', '') = '')
  ) then raise exception 'Group enrollment identity guard found malformed group blocks'; end if;
  if exists (
    select 1 from public.project_rows r
    where r.project_table_id = v_bookings_table_id and r.values->>'program' = 'Group enrollment'
      and coalesce(r.values->>'status', '') <> 'cancelled' and coalesce(r.values->>'studentAccountId', '') <> ''
    group by r.values->>'groupClassId', r.values->>'studentAccountId' having count(*) > 1
  ) then raise exception 'Group enrollment guard found active duplicate memberships'; end if;
  if to_regprocedure('public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text)') is null
    or position('v_series_offset' in pg_get_functiondef(to_regprocedure('public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text)'))) = 0 then
    raise exception 'Group enrollment requires the current recurring group management function';
  end if;
  if to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)') is not null then
    raise exception 'Group enrollment RPC already exists';
  end if;
end;
$$;

create unique index project_rows_active_group_membership_unique
  on public.project_rows(project_table_id, (values->>'groupClassId'), (values->>'studentAccountId'))
  where values->>'program' = 'Group enrollment'
    and coalesce(values->>'status', '') <> 'cancelled'
    and coalesce(values->>'groupClassId', '') <> ''
    and coalesce(values->>'studentAccountId', '') <> '';

create unique index project_rows_group_add_idempotency_unique
  on public.project_rows(project_table_id, (values->>'idempotencyKey'))
  where values->>'action' = 'group_student_added' and coalesce(values->>'idempotencyKey', '') <> '';

create or replace function public.add_student_to_group_occurrences(
  p_selected_block_id uuid,
  p_scope text,
  p_student_account_id uuid,
  p_expected_series_id text,
  p_expected_occurrence_id text,
  p_expected_original_starts_at text,
  p_expected_occurrence_count integer,
  p_expected_blocks jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_accounts_table_id uuid;
  v_activity_table_id uuid;
  v_selected public.project_rows%rowtype;
  v_account public.project_rows%rowtype;
  v_existing_activity public.project_rows%rowtype;
  v_actual public.project_rows%rowtype;
  v_expected jsonb;
  v_block public.project_rows%rowtype;
  v_target_block_ids uuid[] := '{}';
  v_group_ids text[] := '{}';
  v_inserted_ids uuid[] := '{}';
  v_occurrence_count integer;
  v_group_id text;
  v_capacity integer;
  v_roster_count integer;
  v_price_cents integer := 7500;
  v_duplicate_dates text;
  v_conflict_dates text;
  v_capacity_dates text;
  v_date_range text;
  v_new_id uuid;
  v_coach text;
  v_enrollment_values jsonb;
  v_existing_ids jsonb;
begin
  if p_scope not in ('single', 'future') then raise exception 'Invalid group enrollment scope'; end if;
  if p_expected_occurrence_count < 1 then raise exception 'Expected group occurrence count must be positive'; end if;
  if p_idempotency_key is null then raise exception 'Group enrollment idempotency key is required'; end if;
  if jsonb_typeof(p_expected_blocks) <> 'array' or jsonb_array_length(p_expected_blocks) <> p_expected_occurrence_count then
    raise exception 'Expected group block scope is incomplete';
  end if;

  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into strict v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  select id into strict v_activity_table_id from public.project_tables where project_id = v_project_id and slug = 'activity_logs';

  perform pg_advisory_xact_lock(hashtextextended('group-add-idempotency:' || p_idempotency_key::text, 0));
  select * into v_existing_activity from public.project_rows r
  where r.project_table_id = v_activity_table_id and r.values->>'action' = 'group_student_added'
    and r.values->>'idempotencyKey' = p_idempotency_key::text;
  if found then
    if v_existing_activity.values->>'studentAccountId' <> p_student_account_id::text
      or v_existing_activity.values->>'selectedOccurrenceId' <> p_expected_occurrence_id
      or v_existing_activity.values->>'scope' <> p_scope then
      raise exception 'Group enrollment idempotency key was reused for a different request';
    end if;
    v_existing_ids := v_existing_activity.values->'enrollmentIds';
    if jsonb_typeof(v_existing_ids) <> 'array' or jsonb_array_length(v_existing_ids) <> (v_existing_activity.values->>'count')::integer then
      raise exception 'Stored group enrollment idempotency result is incomplete';
    end if;
    return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb)
      from public.project_rows r where r.project_table_id = v_bookings_table_id
        and r.id in (select value::text::uuid from jsonb_array_elements_text(v_existing_ids)));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-request:student:' || p_student_account_id::text, 0));
  select * into strict v_account from public.project_rows r
  where r.id = p_student_account_id and r.project_table_id = v_accounts_table_id for update;
  if btrim(coalesce(v_account.values->>'studentName', '')) = '' then raise exception 'Student account identity is incomplete'; end if;

  select * into strict v_selected from public.project_rows r
  where r.id = p_selected_block_id and r.project_table_id = v_bookings_table_id for update;
  if v_selected.values->>'program' <> 'Group class' or lower(btrim(v_selected.values->>'studentName')) <> 'group class' then
    raise exception 'Selected row is not a group class block';
  end if;
  if coalesce(v_selected.values->>'status', '') in ('cancelled', 'coach_confirmed')
    or (v_selected.values->>'startsAt')::timestamptz <= clock_timestamp() then
    raise exception 'Only a future active group class can receive a student';
  end if;
  if coalesce(v_selected.values->>'seriesId', '') <> coalesce(p_expected_series_id, '')
    or coalesce(v_selected.values->>'recurrenceOccurrenceId', '') <> coalesce(p_expected_occurrence_id, '')
    or coalesce(v_selected.values->>'recurrenceOriginalStartsAt', '') <> coalesce(p_expected_original_starts_at, '') then
    raise exception 'Selected group occurrence changed while adding the student';
  end if;
  if coalesce(p_expected_series_id, '') = '' or coalesce(p_expected_occurrence_id, '') = ''
    or coalesce(p_expected_original_starts_at, '') = '' or coalesce(v_selected.values->>'groupClassId', '') = '' then
    raise exception 'Selected group occurrence identity is incomplete';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group-series:' || p_expected_series_id, 0));
  if p_scope = 'single' then
    v_target_block_ids := array[p_selected_block_id];
  else
    select coalesce(array_agg(r.id order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz, r.id), '{}') into v_target_block_ids
    from public.project_rows r where r.project_table_id = v_bookings_table_id
      and r.values->>'program' = 'Group class' and r.values->>'seriesId' = p_expected_series_id
      and (r.values->>'recurrenceOriginalStartsAt')::timestamptz >= p_expected_original_starts_at::timestamptz
      and (r.values->>'startsAt')::timestamptz > clock_timestamp()
      and coalesce(r.values->>'status', '') not in ('cancelled', 'coach_confirmed');
  end if;
  v_occurrence_count := coalesce(array_length(v_target_block_ids, 1), 0);
  if v_occurrence_count = 0 or not (p_selected_block_id = any(v_target_block_ids)) then raise exception 'Group enrollment target is empty'; end if;
  if v_occurrence_count <> p_expected_occurrence_count then
    raise exception 'Group occurrence count changed: expected %, found %', p_expected_occurrence_count, v_occurrence_count;
  end if;

  select array_agg(r.values->>'groupClassId' order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz, r.id)
  into v_group_ids from public.project_rows r where r.id = any(v_target_block_ids);
  foreach v_group_id in array v_group_ids loop
    perform pg_advisory_xact_lock(hashtextextended('group-class:' || v_group_id, 0));
  end loop;
  perform 1 from public.project_rows r where r.id = any(v_target_block_ids) order by r.id for update;

  for v_expected in select value from jsonb_array_elements(p_expected_blocks) loop
    if nullif(v_expected->>'id', '') is null or not ((v_expected->>'id')::uuid = any(v_target_block_ids)) then
      raise exception 'Expected group block scope contains a missing row';
    end if;
    select * into strict v_actual from public.project_rows r
    where r.id = (v_expected->>'id')::uuid and r.project_table_id = v_bookings_table_id;
    if coalesce(v_actual.values->>'groupClassId', '') <> coalesce(v_expected->>'groupClassId', '')
      or coalesce(v_actual.values->>'seriesId', '') <> coalesce(v_expected->>'seriesId', '')
      or coalesce(v_actual.values->>'recurrenceOccurrenceId', '') <> coalesce(v_expected->>'recurrenceOccurrenceId', '')
      or coalesce(v_actual.values->>'recurrenceOriginalStartsAt', '') <> coalesce(v_expected->>'recurrenceOriginalStartsAt', '')
      or coalesce(v_actual.values->>'startsAt', '') <> coalesce(v_expected->>'startsAt', '')
      or coalesce(v_actual.values->>'status', '') <> coalesce(v_expected->>'status', '')
      or v_actual.updated_at <> (v_expected->>'updatedAt')::timestamptz then
      raise exception 'Group block changed while adding the student: %', v_actual.id;
    end if;
  end loop;
  if exists (select 1 from unnest(v_target_block_ids) id where not exists (
    select 1 from jsonb_array_elements(p_expected_blocks) e where (e->>'id')::uuid = id
  )) then raise exception 'Expected group block scope omitted a row'; end if;
  if exists (select 1 from public.project_rows r where r.id = any(v_target_block_ids)
    and (r.values->>'program' <> 'Group class' or coalesce(r.values->>'status', '') in ('cancelled', 'coach_confirmed')
      or (r.values->>'startsAt')::timestamptz <= clock_timestamp())) then
    raise exception 'Target scope contains a past, cancelled, completed, or invalid group block';
  end if;

  select string_agg(r.values->>'dateLabel', ', ' order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz)
  into v_duplicate_dates from public.project_rows r where r.id = any(v_target_block_ids) and exists (
    select 1 from public.project_rows e where e.project_table_id = v_bookings_table_id
      and e.values->>'program' = 'Group enrollment' and e.values->>'groupClassId' = r.values->>'groupClassId'
      and e.values->>'studentAccountId' = p_student_account_id::text
  );
  if v_duplicate_dates is not null then raise exception 'Student is already a member on: %', v_duplicate_dates; end if;

  select string_agg(r.values->>'dateLabel', ', ' order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz)
  into v_conflict_dates from public.project_rows r where r.id = any(v_target_block_ids) and exists (
    select 1 from public.project_rows e where e.project_table_id = v_bookings_table_id
      and e.values->>'studentAccountId' = p_student_account_id::text and coalesce(e.values->>'status', '') <> 'cancelled'
      and (e.values->>'startsAt')::timestamptz < public.rswtta_booking_ends_at(r.values)
      and public.rswtta_booking_ends_at(e.values) > (r.values->>'startsAt')::timestamptz
  );
  if v_conflict_dates is not null then raise exception 'Student has a conflicting class on: %', v_conflict_dates; end if;

  for v_block in select * from public.project_rows r where r.id = any(v_target_block_ids) order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz, r.id loop
    if coalesce(v_block.values->>'capacity', v_block.values->>'maxCapacity', '') <> '' then
      begin
        v_capacity := coalesce(nullif(v_block.values->>'capacity', '')::integer, nullif(v_block.values->>'maxCapacity', '')::integer);
      exception when invalid_text_representation then
        raise exception 'Invalid group capacity on %', v_block.values->>'dateLabel';
      end;
      if v_capacity is null or v_capacity < 1 then raise exception 'Invalid group capacity on %', v_block.values->>'dateLabel'; end if;
      select count(*) into v_roster_count from public.project_rows e where e.project_table_id = v_bookings_table_id
        and e.values->>'program' = 'Group enrollment' and e.values->>'groupClassId' = v_block.values->>'groupClassId'
        and coalesce(e.values->>'status', '') <> 'cancelled';
      if v_roster_count >= v_capacity then
        v_capacity_dates := concat_ws(', ', nullif(v_capacity_dates, ''), v_block.values->>'dateLabel');
      end if;
    end if;
  end loop;
  if v_capacity_dates is not null then raise exception 'Group capacity is full on: %', v_capacity_dates; end if;

  select coalesce((r.values->>'priceCents')::integer, 7500) into v_price_cents from public.project_rows r
  where r.project_table_id = v_bookings_table_id and r.values->>'program' = 'Group enrollment'
    and r.values->>'groupClassId' = any(v_group_ids) and coalesce((r.values->>'priceCents')::integer, 0) > 0
  order by r.created_at desc limit 1;
  v_price_cents := coalesce(v_price_cents, 7500);

  for v_block in select * from public.project_rows r where r.id = any(v_target_block_ids) order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz, r.id loop
    v_new_id := gen_random_uuid();
    v_coach := coalesce(nullif(v_block.values->>'assignedCoach', ''), v_block.values->>'requestedCoach', '');
    v_enrollment_values := jsonb_build_object(
      'studentAccountId', p_student_account_id::text,
      'seriesId', v_block.values->>'seriesId',
      'recurrenceOccurrenceId', (v_block.values->>'recurrenceOccurrenceId') || ':student:' || p_student_account_id::text,
      'recurrenceOriginalStartsAt', v_block.values->>'recurrenceOriginalStartsAt',
      'groupClassId', v_block.values->>'groupClassId',
      'studentName', v_account.values->>'studentName',
      'familyName', v_account.values->>'studentName',
      'studentEmail', coalesce(v_account.values->>'email', ''),
      'phone', coalesce(v_account.values->>'phone', ''),
      'requestedCoach', v_coach,
      'assignedCoach', v_coach,
      'program', 'Group enrollment',
      'dateLabel', v_block.values->>'dateLabel',
      'timeLabel', v_block.values->>'timeLabel',
      'startsAt', v_block.values->>'startsAt',
      'priceCents', v_price_cents,
      'status', 'club_confirmed',
      'parentNote', 'Added to recurring group class by club.'
    );
    insert into public.project_rows(id, project_table_id, values) values (v_new_id, v_bookings_table_id, v_enrollment_values);
    v_inserted_ids := array_append(v_inserted_ids, v_new_id);
  end loop;

  select case when min(r.values->>'dateLabel') = max(r.values->>'dateLabel') then min(r.values->>'dateLabel')
    else (array_agg(r.values->>'dateLabel' order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz))[1] || ' through ' ||
      (array_agg(r.values->>'dateLabel' order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz desc))[1] end
  into v_date_range from public.project_rows r where r.id = any(v_target_block_ids);

  insert into public.project_rows(project_table_id, values) values (v_activity_table_id, jsonb_build_object(
    'action', 'group_student_added',
    'message', format('Added %s to %s group class%s (%s), scope=%s.', v_account.values->>'studentName', v_occurrence_count,
      case when v_occurrence_count = 1 then '' else 'es' end, v_date_range, p_scope),
    'studentAccountId', p_student_account_id::text,
    'studentName', v_account.values->>'studentName',
    'coach', coalesce(nullif(v_selected.values->>'assignedCoach', ''), v_selected.values->>'requestedCoach', ''),
    'dateLabel', v_date_range,
    'timeLabel', v_selected.values->>'timeLabel',
    'count', v_occurrence_count,
    'scope', p_scope,
    'selectedOccurrenceId', p_expected_occurrence_id,
    'idempotencyKey', p_idempotency_key::text,
    'enrollmentIds', to_jsonb(v_inserted_ids)
  ));

  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb)
    from public.project_rows r where r.id = any(v_inserted_ids));
exception
  when unique_violation then raise exception 'Student membership changed concurrently; no enrollments were added: %', sqlerrm;
  when invalid_text_representation or datetime_field_overflow then raise exception 'Invalid group enrollment identity or schedule';
end
$$;

revoke all on function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) from public;
grant execute on function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) to anon, authenticated;
