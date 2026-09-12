-- Correct future group updates after an earlier single-occurrence move.
-- Future targets are rebuilt from immutable original occurrence slots plus the selected target offset.
do $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_count bigint;
  v_definition text;
begin
  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id;
  if v_count <> 1997 then raise exception 'Group future-update repair booking-count guard failed: expected 1997, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id and values->>'program' = 'Group class';
  if v_count <> 141 then raise exception 'Group future-update repair block-count guard failed: expected 141, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id and coalesce(values->>'groupClassId', '') <> '';
  if v_count <> 162 then raise exception 'Group future-update repair linked-row guard failed: expected 162, found %', v_count; end if;
  if to_regprocedure('public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text)') is null then
    raise exception 'Group future-update repair function is missing';
  end if;
  select pg_get_functiondef(to_regprocedure('public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text)')) into strict v_definition;
  if position('v_delta := v_new_selected - v_old_selected' in v_definition) = 0
    or position('v_series_offset' in v_definition) > 0 then
    raise exception 'Group future-update repair function-definition guard failed';
  end if;
end;
$$;

create or replace function public.manage_group_occurrences(
  p_selected_block_id uuid,
  p_action text,
  p_scope text,
  p_expected_series_id text,
  p_expected_occurrence_id text,
  p_expected_original_starts_at text,
  p_expected_selected_starts_at text,
  p_expected_occurrence_count integer,
  p_expected_row_count integer,
  p_expected_rows jsonb,
  p_new_starts_at text default null,
  p_new_date_label text default null,
  p_new_time_label text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_activity_table_id uuid;
  v_selected public.project_rows%rowtype;
  v_expected jsonb;
  v_actual public.project_rows%rowtype;
  v_target_block_ids uuid[] := '{}';
  v_target_ids uuid[] := '{}';
  v_group_ids text[] := '{}';
  v_occurrence_count integer;
  v_row_count integer;
  v_group_id text;
  v_old_selected timestamptz;
  v_new_selected timestamptz;
  v_series_offset interval;
  v_new_end timestamptz;
  v_duration interval;
  v_computed_date_label text;
  v_start_match text[];
  v_end_match text[];
  v_start_minutes integer;
  v_actual_start_minutes integer;
  v_block public.project_rows%rowtype;
  v_other public.project_rows%rowtype;
  v_block_new_start timestamptz;
  v_block_new_end timestamptz;
  v_other_new_start timestamptz;
  v_other_new_end timestamptz;
  v_message text;
begin
  if p_action not in ('update', 'cancel') then raise exception 'Invalid group occurrence action'; end if;
  if p_scope not in ('single', 'future') then raise exception 'Invalid group occurrence scope'; end if;
  if p_expected_occurrence_count < 1 or p_expected_row_count < 1 then raise exception 'Expected counts must be positive'; end if;
  if jsonb_typeof(p_expected_rows) <> 'array' or jsonb_array_length(p_expected_rows) <> p_expected_row_count then
    raise exception 'Expected group membership is incomplete';
  end if;

  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into strict v_activity_table_id from public.project_tables where project_id = v_project_id and slug = 'activity_logs';

  select * into strict v_selected from public.project_rows
  where id = p_selected_block_id and project_table_id = v_bookings_table_id
  for update;
  if v_selected.values->>'program' <> 'Group class' or lower(btrim(v_selected.values->>'studentName')) <> 'group class' then
    raise exception 'Selected row is not a group class block';
  end if;
  if coalesce(v_selected.values->>'status', '') in ('cancelled', 'coach_confirmed')
    or (v_selected.values->>'startsAt')::timestamptz <= clock_timestamp() then
    raise exception 'Only a future active group class can be managed';
  end if;
  if coalesce(v_selected.values->>'seriesId', '') <> coalesce(p_expected_series_id, '')
    or coalesce(v_selected.values->>'recurrenceOccurrenceId', '') <> coalesce(p_expected_occurrence_id, '')
    or coalesce(v_selected.values->>'recurrenceOriginalStartsAt', '') <> coalesce(p_expected_original_starts_at, '')
    or coalesce(v_selected.values->>'startsAt', '') <> coalesce(p_expected_selected_starts_at, '') then
    raise exception 'Selected group occurrence changed while it was being managed';
  end if;
  if coalesce(p_expected_series_id, '') = '' or coalesce(p_expected_occurrence_id, '') = ''
    or coalesce(p_expected_original_starts_at, '') = '' or coalesce(v_selected.values->>'groupClassId', '') = '' then
    raise exception 'Selected group occurrence identity is incomplete';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('group-series:' || p_expected_series_id, 0));

  if p_scope = 'single' then
    v_target_block_ids := array[p_selected_block_id];
  else
    select coalesce(array_agg(r.id order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz, r.id), '{}')
    into v_target_block_ids
    from public.project_rows r
    where r.project_table_id = v_bookings_table_id
      and r.values->>'program' = 'Group class'
      and r.values->>'seriesId' = p_expected_series_id
      and (r.values->>'recurrenceOriginalStartsAt')::timestamptz >= p_expected_original_starts_at::timestamptz
      and (r.values->>'startsAt')::timestamptz > clock_timestamp()
      and coalesce(r.values->>'status', '') not in ('cancelled', 'coach_confirmed');
  end if;
  v_occurrence_count := coalesce(array_length(v_target_block_ids, 1), 0);
  if v_occurrence_count = 0 or not (p_selected_block_id = any(v_target_block_ids)) then raise exception 'Group occurrence target is empty'; end if;
  if v_occurrence_count <> p_expected_occurrence_count then
    raise exception 'Group occurrence count changed: expected %, found %', p_expected_occurrence_count, v_occurrence_count;
  end if;

  select array_agg(distinct r.values->>'groupClassId' order by r.values->>'groupClassId')
  into v_group_ids from public.project_rows r where r.id = any(v_target_block_ids);
  foreach v_group_id in array v_group_ids loop
    perform pg_advisory_xact_lock(hashtextextended('group-class:' || v_group_id, 0));
  end loop;

  perform 1 from public.project_rows r
  where r.project_table_id = v_bookings_table_id and r.values->>'groupClassId' = any(v_group_ids)
  order by r.id for update;

  select coalesce(array_agg(r.id order by r.id), '{}'), count(*)
  into v_target_ids, v_row_count
  from public.project_rows r
  where r.project_table_id = v_bookings_table_id and r.values->>'groupClassId' = any(v_group_ids);
  if v_row_count = 0 or v_row_count <> p_expected_row_count then
    raise exception 'Group row count changed: expected %, found %', p_expected_row_count, v_row_count;
  end if;
  if exists (
    select 1 from unnest(v_group_ids) group_id
    where (select count(*) from public.project_rows r where r.project_table_id = v_bookings_table_id
      and r.values->>'groupClassId' = group_id and r.values->>'program' = 'Group class') <> 1
  ) then raise exception 'Complete group membership requires exactly one block per occurrence'; end if;
  if exists (
    select 1 from public.project_rows r where r.id = any(v_target_ids)
      and ((r.values->>'startsAt')::timestamptz <= clock_timestamp() or coalesce(r.values->>'status', '') = 'coach_confirmed')
  ) then raise exception 'Past or completed group rows cannot be changed'; end if;

  for v_expected in select value from jsonb_array_elements(p_expected_rows) loop
    if nullif(v_expected->>'id', '') is null or not ((v_expected->>'id')::uuid = any(v_target_ids)) then
      raise exception 'Expected group membership contains a missing row';
    end if;
    select * into strict v_actual from public.project_rows where id = (v_expected->>'id')::uuid and project_table_id = v_bookings_table_id;
    if coalesce(v_actual.values->>'groupClassId', '') <> coalesce(v_expected->>'groupClassId', '')
      or coalesce(v_actual.values->>'seriesId', '') <> coalesce(v_expected->>'seriesId', '')
      or coalesce(v_actual.values->>'recurrenceOccurrenceId', '') <> coalesce(v_expected->>'recurrenceOccurrenceId', '')
      or coalesce(v_actual.values->>'recurrenceOriginalStartsAt', '') <> coalesce(v_expected->>'recurrenceOriginalStartsAt', '')
      or coalesce(v_actual.values->>'startsAt', '') <> coalesce(v_expected->>'startsAt', '')
      or coalesce(v_actual.values->>'status', '') <> coalesce(v_expected->>'status', '')
      or coalesce(v_actual.values->>'program', '') <> coalesce(v_expected->>'program', '')
      or coalesce(v_actual.values->>'studentAccountId', '') <> coalesce(v_expected->>'studentAccountId', '')
      or v_actual.updated_at <> (v_expected->>'updatedAt')::timestamptz then
      raise exception 'Group row changed while it was being managed: %', v_actual.id;
    end if;
  end loop;
  if exists (
    select 1 from unnest(v_target_ids) id
    where not exists (select 1 from jsonb_array_elements(p_expected_rows) e where (e->>'id')::uuid = id)
  ) then raise exception 'Expected group membership omitted a row'; end if;

  if p_action = 'update' then
    if coalesce(p_new_starts_at, '') = '' or coalesce(p_new_date_label, '') = '' or coalesce(p_new_time_label, '') = '' then
      raise exception 'A complete new group schedule is required';
    end if;
    v_old_selected := (v_selected.values->>'startsAt')::timestamptz;
    v_new_selected := p_new_starts_at::timestamptz;
    if v_new_selected <= clock_timestamp() then raise exception 'A group occurrence cannot move into the past'; end if;
    v_computed_date_label := to_char(v_new_selected at time zone 'America/Los_Angeles', 'Dy, Mon FMDD, YYYY');
    if v_computed_date_label <> p_new_date_label then raise exception 'New date label does not match the new start'; end if;
    v_start_match := regexp_match(btrim(split_part(p_new_time_label, ' - ', 1)), '^([0-9]{1,2})(:([0-9]{2}))? (AM|PM)$', 'i');
    v_end_match := regexp_match(btrim(split_part(p_new_time_label, ' - ', 2)), '^([0-9]{1,2})(:([0-9]{2}))? (AM|PM)$', 'i');
    if v_start_match is null or v_end_match is null
      or v_start_match[1]::integer not between 1 and 12 or coalesce(v_start_match[3], '0')::integer not between 0 and 59
      or v_end_match[1]::integer not between 1 and 12 or coalesce(v_end_match[3], '0')::integer not between 0 and 59 then
      raise exception 'A valid group time range is required';
    end if;
    v_start_minutes := (case
      when upper(v_start_match[4]) = 'AM' and v_start_match[1]::integer = 12 then 0
      when upper(v_start_match[4]) = 'PM' and v_start_match[1]::integer <> 12 then v_start_match[1]::integer + 12
      else v_start_match[1]::integer
    end) * 60 + coalesce(v_start_match[3], '0')::integer;
    v_actual_start_minutes := extract(hour from v_new_selected at time zone 'America/Los_Angeles')::integer * 60
      + extract(minute from v_new_selected at time zone 'America/Los_Angeles')::integer;
    if v_start_minutes <> v_actual_start_minutes then raise exception 'New time label does not match the new start'; end if;
    v_new_end := public.rswtta_booking_ends_at(jsonb_build_object('startsAt', p_new_starts_at, 'timeLabel', p_new_time_label));
    v_duration := v_new_end - v_new_selected;
    if v_duration < interval '30 minutes' or v_duration > interval '12 hours'
      or mod(extract(epoch from v_duration)::integer, 1800) <> 0 then
      raise exception 'Group intervals must use 30-minute increments between 30 minutes and 12 hours';
    end if;
    v_series_offset := v_new_selected - p_expected_original_starts_at::timestamptz;
    if not exists (
      select 1 from public.project_rows r where r.id = any(v_target_block_ids)
        and ((r.values->>'startsAt')::timestamptz <> (r.values->>'recurrenceOriginalStartsAt')::timestamptz + v_series_offset
          or coalesce(r.values->>'timeLabel', '') <> p_new_time_label)
    ) then raise exception 'The new group schedule must be different'; end if;

    for v_block in select * from public.project_rows r where r.id = any(v_target_block_ids) order by r.id loop
      v_block_new_start := (v_block.values->>'recurrenceOriginalStartsAt')::timestamptz + v_series_offset;
      v_block_new_end := v_block_new_start + v_duration;
      if v_block_new_start <= clock_timestamp() then raise exception 'A future group occurrence would move into the past'; end if;
      if exists (
        select 1 from public.project_rows r
        where r.project_table_id = v_bookings_table_id and not (r.id = any(v_target_ids))
          and coalesce(r.values->>'status', '') <> 'cancelled'
          and public.rswtta_canonical_coach_id(coalesce(nullif(r.values->>'assignedCoach', ''), r.values->>'requestedCoach')) =
              public.rswtta_canonical_coach_id(coalesce(nullif(v_block.values->>'assignedCoach', ''), v_block.values->>'requestedCoach'))
          and (r.values->>'startsAt')::timestamptz < v_block_new_end
          and public.rswtta_booking_ends_at(r.values) > v_block_new_start
      ) then raise exception 'A moved group occurrence conflicts with another coach booking or unavailable block'; end if;
    end loop;

    for v_block in select * from public.project_rows r where r.id = any(v_target_block_ids) order by r.id loop
      for v_other in select * from public.project_rows r where r.id = any(v_target_block_ids) and r.id > v_block.id order by r.id loop
        if public.rswtta_canonical_coach_id(coalesce(nullif(v_block.values->>'assignedCoach', ''), v_block.values->>'requestedCoach')) =
           public.rswtta_canonical_coach_id(coalesce(nullif(v_other.values->>'assignedCoach', ''), v_other.values->>'requestedCoach')) then
          v_block_new_start := (v_block.values->>'recurrenceOriginalStartsAt')::timestamptz + v_series_offset;
          v_block_new_end := v_block_new_start + v_duration;
          v_other_new_start := (v_other.values->>'recurrenceOriginalStartsAt')::timestamptz + v_series_offset;
          v_other_new_end := v_other_new_start + v_duration;
          if v_block_new_start < v_other_new_end and v_other_new_start < v_block_new_end then
            raise exception 'Moved group occurrences overlap each other';
          end if;
        end if;
      end loop;
    end loop;

    update public.project_rows r set values = r.values || jsonb_build_object(
      'startsAt', to_char(((b.values->>'recurrenceOriginalStartsAt')::timestamptz + v_series_offset) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'dateLabel', to_char(((b.values->>'recurrenceOriginalStartsAt')::timestamptz + v_series_offset) at time zone 'America/Los_Angeles', 'Dy, Mon FMDD, YYYY'),
      'timeLabel', p_new_time_label
    )
    from public.project_rows b
    where r.id = any(v_target_ids) and b.id = any(v_target_block_ids)
      and r.values->>'groupClassId' = b.values->>'groupClassId';
    v_message := format('Updated %s group occurrence%s (%s rows), scope=%s: %s -> %s.', v_occurrence_count,
      case when v_occurrence_count = 1 then '' else 's' end, v_row_count, p_scope, p_expected_selected_starts_at, p_new_starts_at);
  else
    perform set_config('rswtta.cancellation_actor', 'club', true);
    update public.project_rows r set values = r.values || jsonb_build_object('status', 'cancelled')
    where r.id = any(v_target_ids);
    v_message := format('Cancelled %s group occurrence%s (%s rows), scope=%s, selected=%s.', v_occurrence_count,
      case when v_occurrence_count = 1 then '' else 's' end, v_row_count, p_scope, p_expected_selected_starts_at);
  end if;

  insert into public.project_rows(project_table_id, values) values (v_activity_table_id, jsonb_build_object(
    'action', case when p_action = 'update' then 'group_occurrence_updated' else 'group_occurrence_cancelled' end,
    'message', v_message,
    'studentName', 'Group class',
    'coach', coalesce(nullif(v_selected.values->>'assignedCoach', ''), v_selected.values->>'requestedCoach', ''),
    'dateLabel', coalesce(v_selected.values->>'dateLabel', ''),
    'timeLabel', case when p_action = 'update' then coalesce(v_selected.values->>'timeLabel', '') || ' -> ' || p_new_time_label else coalesce(v_selected.values->>'timeLabel', '') end,
    'count', v_row_count,
    'scope', p_scope,
    'occurrenceCount', v_occurrence_count,
    'selectedOccurrenceId', p_expected_occurrence_id,
    'oldStartsAt', p_expected_selected_starts_at,
    'newStartsAt', case when p_action = 'update' then p_new_starts_at else null end
  ));

  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb)
    from public.project_rows r where r.id = any(v_target_ids));
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'Invalid group occurrence identity or schedule';
end
$$;

revoke all on function public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text) from public;
grant execute on function public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text) to anon, authenticated;
