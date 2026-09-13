-- Atomically soft-cancel a finite, fully enumerated recurring scope.
-- This migration defines only a new RPC; it does not update booking data.

create or replace function public.cancel_recurring_booking_occurrences(
  p_selected_booking_id uuid,
  p_selected_values jsonb,
  p_actor text,
  p_student_account_id text,
  p_scope text,
  p_expected_series_id text,
  p_expected_occurrence_id text,
  p_expected_original_starts_at text,
  p_expected_occurrence_count integer,
  p_expected_row_count integer,
  p_expected_rows jsonb,
  p_activity_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_activity_table_id uuid;
  v_selected public.project_rows%rowtype;
  v_selected_values jsonb;
  v_expected jsonb;
  v_row public.project_rows%rowtype;
  v_values jsonb;
  v_changed jsonb := '[]'::jsonb;
  v_expected_ids uuid[] := '{}';
  v_expected_occurrence_ids text[] := '{}';
  v_expected_persisted_count integer := 0;
  v_database_scope_count integer;
  v_current_time timestamptz := clock_timestamp();
  v_cutoff timestamptz;
  v_boundary timestamptz;
  v_selected_account_id text;
  v_selected_program text;
  v_selected_coach text;
  v_first_date_label text;
  v_first_time_label text;
begin
  if p_actor not in ('parent', 'club') then raise exception 'Invalid cancellation actor'; end if;
  if p_scope not in ('future', 'all') then raise exception 'Invalid recurring cancellation scope'; end if;
  if nullif(btrim(p_student_account_id), '') is null then raise exception 'Student account identity is required'; end if;
  if nullif(btrim(p_expected_series_id), '') is null
    or nullif(btrim(p_expected_occurrence_id), '') is null
    or nullif(btrim(p_expected_original_starts_at), '') is null
  then raise exception 'Recurring class identity is incomplete'; end if;
  if coalesce(jsonb_typeof(p_expected_rows), 'null') <> 'array'
    or coalesce(jsonb_array_length(p_expected_rows), 0) = 0
    or coalesce(jsonb_array_length(p_expected_rows), -1) <> p_expected_occurrence_count
    or p_expected_occurrence_count <> p_expected_row_count
  then raise exception 'Recurring cancellation expected counts are invalid'; end if;
  if nullif(btrim(p_activity_message), '') is null or length(p_activity_message) > 1000 then
    raise exception 'Cancellation activity message is invalid';
  end if;

  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id
  from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into strict v_activity_table_id
  from public.project_tables where project_id = v_project_id and slug = 'activity_logs';

  -- Freeze membership while the complete client snapshot is checked and applied.
  lock table public.project_rows in share row exclusive mode;
  perform pg_advisory_xact_lock(hashtextextended(p_expected_series_id || '|' || btrim(p_student_account_id), 0));

  if p_selected_booking_id is null then
    if p_selected_values is null then raise exception 'Virtual selected occurrence values are required'; end if;
    v_selected_values := p_selected_values;
  else
    select * into strict v_selected
    from public.project_rows
    where id = p_selected_booking_id and project_table_id = v_bookings_table_id
    for update;
    v_selected_values := v_selected.values;
  end if;

  if coalesce(v_selected_values->>'seriesId', '') <> p_expected_series_id
    or coalesce(v_selected_values->>'recurrenceOccurrenceId', '') <> p_expected_occurrence_id
    or coalesce(v_selected_values->>'recurrenceOriginalStartsAt', '') <> p_expected_original_starts_at
  then raise exception 'Selected recurring occurrence changed'; end if;

  v_selected_account_id := coalesce(v_selected_values->>'studentAccountId', '');
  v_selected_program := coalesce(v_selected_values->>'program', '');
  v_selected_coach := coalesce(v_selected_values->>'assignedCoach', v_selected_values->>'requestedCoach', '');
  if v_selected_account_id <> btrim(p_student_account_id) then raise exception 'Selected class belongs to another student account'; end if;
  if coalesce(v_selected_values->>'groupClassId', '') <> ''
    or v_selected_program in ('Group class', 'Group enrollment')
  then raise exception 'Group classes and enrollments require group occurrence management'; end if;

  begin
    v_boundary := p_expected_original_starts_at::timestamptz;
  exception when others then
    raise exception 'Selected original slot is invalid';
  end;
  v_cutoff := v_current_time + case when p_actor = 'parent' then interval '12 hours' else interval '0 hours' end;
  if p_actor = 'parent' and (
    coalesce(v_selected_values->>'status', '') not in ('requested', 'club_confirmed')
    or (v_selected_values->>'startsAt')::timestamptz <= v_cutoff
  ) then
    raise exception 'Parent recurring cancellation requires an active selected class more than 12 hours away';
  end if;

  -- Validate and lock every persisted target in deterministic original-slot order.
  for v_expected in
    select value
    from jsonb_array_elements(p_expected_rows)
    order by value->>'recurrenceOriginalStartsAt', coalesce(value->>'id', ''), value->>'recurrenceOccurrenceId'
  loop
    if coalesce(v_expected->>'studentAccountId', '') <> v_selected_account_id
      or coalesce(v_expected->>'seriesId', '') <> p_expected_series_id
      or nullif(v_expected->>'recurrenceOccurrenceId', '') is null
      or nullif(v_expected->>'recurrenceOriginalStartsAt', '') is null
    then raise exception 'Recurring target identity does not match the selected student series'; end if;
    if coalesce(v_expected->>'groupClassId', '') <> ''
      or coalesce(v_expected->>'program', '') in ('Group class', 'Group enrollment')
    then raise exception 'Group rows cannot be recurring cancellation targets'; end if;
    if (p_actor = 'parent' and coalesce(v_expected->>'status', '') not in ('requested', 'club_confirmed'))
      or (p_actor = 'club' and coalesce(v_expected->>'status', '') not in ('requested', 'change_requested', 'club_confirmed'))
    then
      raise exception 'Row status is not cancellable by this actor';
    end if;
    if (v_expected->>'startsAt')::timestamptz <= v_cutoff then
      raise exception 'Past or cutoff-protected rows cannot be recurring cancellation targets';
    end if;
    if p_scope = 'future' and (v_expected->>'recurrenceOriginalStartsAt')::timestamptz < v_boundary then
      raise exception 'Recurring target precedes the immutable original-slot boundary';
    end if;
    if coalesce(v_expected->>'recurrenceOccurrenceId', '') = any(v_expected_occurrence_ids) then
      raise exception 'Recurring cancellation contains a duplicate occurrence';
    end if;
    v_expected_occurrence_ids := array_append(v_expected_occurrence_ids, v_expected->>'recurrenceOccurrenceId');

    if nullif(v_expected->>'id', '') is null then
      if jsonb_typeof(v_expected->'values') <> 'object' then raise exception 'Virtual target values are required'; end if;
      if coalesce(v_expected->'values'->>'studentAccountId', '') <> coalesce(v_expected->>'studentAccountId', '')
        or coalesce(v_expected->'values'->>'seriesId', '') <> coalesce(v_expected->>'seriesId', '')
        or coalesce(v_expected->'values'->>'recurrenceOccurrenceId', '') <> coalesce(v_expected->>'recurrenceOccurrenceId', '')
        or coalesce(v_expected->'values'->>'recurrenceOriginalStartsAt', '') <> coalesce(v_expected->>'recurrenceOriginalStartsAt', '')
        or coalesce(v_expected->'values'->>'groupClassId', '') <> coalesce(v_expected->>'groupClassId', '')
        or coalesce(v_expected->'values'->>'startsAt', '') <> coalesce(v_expected->>'startsAt', '')
        or coalesce(v_expected->'values'->>'status', '') <> coalesce(v_expected->>'status', '')
        or coalesce(v_expected->'values'->>'program', '') <> coalesce(v_expected->>'program', '')
        or coalesce(v_expected->'values'->>'assignedCoach', v_expected->'values'->>'requestedCoach', '') <> coalesce(v_expected->>'coach', '')
      then raise exception 'Virtual target values do not match their immutable snapshot'; end if;
      if exists (
        select 1 from public.project_rows r
        where r.project_table_id = v_bookings_table_id
          and r.values->>'recurrenceOccurrenceId' = v_expected->>'recurrenceOccurrenceId'
      ) then raise exception 'A virtual recurring target was materialized while cancellation was being confirmed'; end if;
    else
      select * into strict v_row
      from public.project_rows
      where id = (v_expected->>'id')::uuid and project_table_id = v_bookings_table_id
      for update;
      if coalesce(v_row.values->>'studentAccountId', '') is distinct from coalesce(v_expected->>'studentAccountId', '')
        or coalesce(v_row.values->>'seriesId', '') is distinct from coalesce(v_expected->>'seriesId', '')
        or coalesce(v_row.values->>'recurrenceOccurrenceId', '') is distinct from coalesce(v_expected->>'recurrenceOccurrenceId', '')
        or coalesce(v_row.values->>'recurrenceOriginalStartsAt', '') is distinct from coalesce(v_expected->>'recurrenceOriginalStartsAt', '')
        or coalesce(v_row.values->>'groupClassId', '') is distinct from coalesce(v_expected->>'groupClassId', '')
        or coalesce(v_row.values->>'startsAt', '') is distinct from coalesce(v_expected->>'startsAt', '')
        or coalesce(v_row.values->>'status', '') is distinct from coalesce(v_expected->>'status', '')
        or coalesce(v_row.values->>'program', '') is distinct from coalesce(v_expected->>'program', '')
        or coalesce(v_row.values->>'assignedCoach', v_row.values->>'requestedCoach', '') is distinct from coalesce(v_expected->>'coach', '')
        or v_row.updated_at is distinct from (v_expected->>'updatedAt')::timestamptz
      then raise exception 'Recurring row changed while cancellation was being confirmed'; end if;
      if v_row.id = any(v_expected_ids) then raise exception 'Recurring cancellation contains a duplicate row'; end if;
      v_expected_ids := array_append(v_expected_ids, v_row.id);
      v_expected_persisted_count := v_expected_persisted_count + 1;
    end if;
  end loop;

  -- Reject partial membership: every currently persisted active row in the exact
  -- immutable account/series scope must be present in the expected snapshot.
  select count(*) into v_database_scope_count
  from public.project_rows r
  where r.project_table_id = v_bookings_table_id
    and r.values->>'studentAccountId' = v_selected_account_id
    and r.values->>'seriesId' = p_expected_series_id
    and coalesce(r.values->>'groupClassId', '') = ''
    and coalesce(r.values->>'program', '') not in ('Group class', 'Group enrollment')
    and ((p_actor = 'parent' and coalesce(r.values->>'status', '') in ('requested', 'club_confirmed'))
      or (p_actor = 'club' and coalesce(r.values->>'status', '') in ('requested', 'change_requested', 'club_confirmed')))
    and (r.values->>'startsAt')::timestamptz > v_cutoff
    and (p_scope = 'all' or (r.values->>'recurrenceOriginalStartsAt')::timestamptz >= v_boundary);
  if v_database_scope_count <> v_expected_persisted_count then
    raise exception 'Recurring cancellation membership changed';
  end if;

  perform set_config('rswtta.cancellation_actor', p_actor, true);
  for v_expected in
    select value
    from jsonb_array_elements(p_expected_rows)
    order by value->>'recurrenceOriginalStartsAt', coalesce(value->>'id', ''), value->>'recurrenceOccurrenceId'
  loop
    if nullif(v_expected->>'id', '') is null then
      v_values := (v_expected->'values') || jsonb_build_object(
        'status', 'cancelled',
        'parentNote', btrim(coalesce(v_expected->'values'->>'parentNote', '') ||
          case when p_actor = 'parent' then ' Cancelled by parent/student.' else ' Cancelled by club.' end)
      );
      insert into public.project_rows(project_table_id, values)
      values (v_bookings_table_id, v_values)
      returning * into v_row;
    else
      update public.project_rows
      set values = values || jsonb_build_object(
        'status', 'cancelled',
        'parentNote', btrim(coalesce(values->>'parentNote', '') ||
          case when p_actor = 'parent' then ' Cancelled by parent/student.' else ' Cancelled by club.' end)
      )
      where id = (v_expected->>'id')::uuid and project_table_id = v_bookings_table_id
      returning * into strict v_row;
    end if;
    if v_first_date_label is null then
      v_first_date_label := v_row.values->>'dateLabel';
      v_first_time_label := v_row.values->>'timeLabel';
    end if;
    v_changed := v_changed || jsonb_build_array(to_jsonb(v_row));
  end loop;

  insert into public.project_rows(project_table_id, values)
  values (v_activity_table_id, jsonb_build_object(
    'action', 'cancelled',
    'message', p_activity_message,
    'studentName', v_selected_values->>'studentName',
    'coach', v_selected_coach,
    'dateLabel', coalesce(v_first_date_label, v_selected_values->>'dateLabel'),
    'timeLabel', coalesce(v_first_time_label, v_selected_values->>'timeLabel'),
    'count', p_expected_row_count
  ));

  return v_changed;
exception
  when no_data_found then
    raise exception 'Recurring booking or project dependency was not found';
end;
$$;

revoke all on function public.cancel_recurring_booking_occurrences(uuid, jsonb, text, text, text, text, text, text, integer, integer, jsonb, text) from public;
grant execute on function public.cancel_recurring_booking_occurrences(uuid, jsonb, text, text, text, text, text, text, integer, integer, jsonb, text) to anon, authenticated;

-- Rollback (no booking rows are changed by migration application):
-- drop function if exists public.cancel_recurring_booking_occurrences(uuid, jsonb, text, text, text, text, text, text, integer, integer, jsonb, text);
