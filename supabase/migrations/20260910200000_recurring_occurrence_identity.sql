-- Guarded rollout for stable recurring occurrence and group-class identity.
-- This file is intentionally not deployed by the application build.

-- Hold this lock for the surrounding migration transaction so the verified
-- counts and backfill cannot race a concurrent booking write.
lock table public.project_rows in share row exclusive mode;

do $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_count integer;
begin
  if to_regclass('public.project_rows') is null then
    raise notice 'project_rows is absent; recurring occurrence migration skipped';
    return;
  end if;

  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id
  from public.project_tables where project_id = v_project_id and slug = 'bookings';

  -- Snapshot guards from the verified 2026-09-10 production backup. Any live
  -- drift must be reviewed and backed up again instead of silently broadening
  -- this migration.
  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id;
  if v_count <> 1883 then raise exception 'Booking-count guard failed: expected 1883, found %', v_count; end if;
  select count(*) into v_count from public.project_rows
  where project_table_id = v_bookings_table_id
    and lower(coalesce(values->>'parentNote', '')) like '%recurring class%'
    and coalesce(values->>'studentAccountId', '') <> '';
  if v_count <> 1530 then raise exception 'Imported recurring-row guard failed: expected 1530, found %', v_count; end if;
  select count(*) into v_count from public.project_rows
  where project_table_id = v_bookings_table_id and values->>'program' = 'Group class';
  if v_count <> 141 then raise exception 'Group-block guard failed: expected 141, found %', v_count; end if;
  select count(*) into v_count from public.project_rows
  where project_table_id = v_bookings_table_id and values->>'program' = 'Group enrollment';
  if v_count <> 21 then raise exception 'Group-enrollment guard failed: expected 21, found %', v_count; end if;
  select count(*) into v_count from public.project_rows
  where project_table_id = v_bookings_table_id
    and (coalesce(values->>'seriesId', '') <> ''
      or coalesce(values->>'recurrenceOccurrenceId', '') <> ''
      or coalesce(values->>'recurrenceOriginalStartsAt', '') <> ''
      or coalesce(values->>'groupClassId', '') <> '');
  if v_count <> 0 then raise exception 'Identity-field guard failed: expected 0 preexisting rows, found %', v_count; end if;

  -- Backfill every audited imported recurring row. The account, coach, and source
  -- cell form the stable series; moving startsAt later cannot change its original slot.
  with target as (
    select r.id,
      'import:' ||
      replace(replace(replace(replace(lower(btrim(coalesce(r.values->>'assignedCoach', r.values->>'requestedCoach', ''))), '%', '%25'), ' ', '%20'), '/', '%2F'), ':', '%3A') || ':' ||
      replace(replace(replace(replace(lower(btrim(r.values->>'studentAccountId')), '%', '%25'), ' ', '%20'), '/', '%2F'), ':', '%3A') || ':' ||
      replace(replace(replace(replace(lower(btrim(substring((r.values->>'parentNote') from '\(([^)]+)\)'))), '%', '%25'), ' ', '%20'), '/', '%2F'), ':', '%3A') as series_id
    from public.project_rows r
    where r.project_table_id = v_bookings_table_id
      and lower(coalesce(r.values->>'parentNote', '')) like '%recurring class%'
      and coalesce(r.values->>'studentAccountId', '') <> ''
      and coalesce(r.values->>'startsAt', '') <> ''
  )
  update public.project_rows r
  set values = r.values || jsonb_build_object(
    'seriesId', target.series_id,
    'recurrenceOriginalStartsAt', r.values->>'startsAt',
    'recurrenceOccurrenceId', target.series_id || '@' || (r.values->>'startsAt')
  )
  from target
  where r.id = target.id
    and coalesce(r.values->>'recurrenceOccurrenceId', '') = '';

  -- Give every known recurring group block stable series/original-occurrence
  -- identity plus a permanent group ID, then propagate the group ID to every
  -- enrollment at that block's coach/original time.
  if exists (
    select 1
    from public.project_rows block
    where block.project_table_id = v_bookings_table_id
      and block.values->>'program' = 'Group class'
    group by coalesce(block.values->>'assignedCoach', block.values->>'requestedCoach'), block.values->>'startsAt'
    having count(*) > 1
  ) then raise exception 'Ambiguous duplicate group blocks must be repaired before migration'; end if;

  with blocks as (
    select block.id,
      'import:' ||
      replace(replace(replace(lower(btrim(coalesce(block.values->>'assignedCoach', block.values->>'requestedCoach', ''))), '%', '%25'), ' ', '%20'), ':', '%3A') || ':' ||
      'group%20class' || ':' ||
      replace(replace(replace(replace(lower(btrim(substring((block.values->>'parentNote') from '\(([^)]+)\)'))), '%', '%25'), ' ', '%20'), '/', '%2F'), ':', '%3A') as series_id,
      coalesce(nullif(block.values->>'groupClassId', ''), 'group:legacy:' || block.id::text) as group_id
    from public.project_rows block
    where block.project_table_id = v_bookings_table_id
      and block.values->>'program' = 'Group class'
      and lower(coalesce(block.values->>'parentNote', '')) like '%recurring%'
      and lower(coalesce(block.values->>'parentNote', '')) like '%class%'
  )
  update public.project_rows r set values = r.values || jsonb_build_object(
    'seriesId', blocks.series_id,
    'recurrenceOriginalStartsAt', r.values->>'startsAt',
    'recurrenceOccurrenceId', blocks.series_id || '@' || (r.values->>'startsAt'),
    'groupClassId', blocks.group_id
  )
  from blocks
  where r.id = blocks.id;

  with blocks as (
    select block.id,
      coalesce(block.values->>'assignedCoach', block.values->>'requestedCoach') as coach,
      block.values->>'startsAt' as starts_at,
      block.values->>'groupClassId' as group_id
    from public.project_rows block
    where block.project_table_id = v_bookings_table_id and block.values->>'program' = 'Group class'
  )
  update public.project_rows enrollment
  set values = enrollment.values || jsonb_build_object('groupClassId', blocks.group_id)
  from blocks
  where enrollment.project_table_id = v_bookings_table_id
    and coalesce(enrollment.values->>'assignedCoach', enrollment.values->>'requestedCoach') = blocks.coach
    and enrollment.values->>'startsAt' = blocks.starts_at
    and enrollment.values->>'program' = 'Group enrollment';

  select count(*) into v_count from public.project_rows
  where project_table_id = v_bookings_table_id
    and lower(coalesce(values->>'parentNote', '')) like '%recurring class%'
    and coalesce(values->>'studentAccountId', '') <> ''
    and coalesce(values->>'seriesId', '') <> ''
    and coalesce(values->>'recurrenceOccurrenceId', '') <> '';
  if v_count <> 1530 then raise exception 'Imported recurring postcondition failed: expected 1530, found %', v_count; end if;
  select count(*) into v_count from public.project_rows
  where project_table_id = v_bookings_table_id and values->>'program' = 'Group enrollment'
    and coalesce(values->>'groupClassId', '') <> '';
  if v_count <> 21 then raise exception 'Group-link postcondition failed: expected 21, found %', v_count; end if;
  select count(*) into v_count from public.project_rows
  where project_table_id = v_bookings_table_id and values->>'program' = 'Group class'
    and coalesce(values->>'seriesId', '') <> '' and coalesce(values->>'recurrenceOccurrenceId', '') <> '';
  if v_count <> 141 then raise exception 'Group-series postcondition failed: expected 141, found %', v_count; end if;
end
$$;

create unique index if not exists project_rows_recurrence_occurrence_uidx
on public.project_rows (project_table_id, (values->>'recurrenceOccurrenceId'))
where coalesce(values->>'recurrenceOccurrenceId', '') <> '';

create index if not exists project_rows_series_idx
on public.project_rows ((values->>'seriesId'))
where coalesce(values->>'seriesId', '') <> '';

create index if not exists project_rows_group_class_idx
on public.project_rows ((values->>'groupClassId'))
where coalesce(values->>'groupClassId', '') <> '';

create or replace function public.enforce_recurring_occurrence_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(new.values->>'seriesId', '') <> '' and
     (coalesce(new.values->>'recurrenceOccurrenceId', '') = '' or coalesce(new.values->>'recurrenceOriginalStartsAt', '') = '') then
    raise exception 'Recurring rows require complete occurrence identity';
  end if;
  if coalesce(new.values->>'recurrenceOccurrenceId', '') <> '' and coalesce(new.values->>'seriesId', '') = '' then
    raise exception 'Occurrence identity requires seriesId';
  end if;
  if tg_op = 'UPDATE' then
    if coalesce(old.values->>'seriesId', '') <> coalesce(new.values->>'seriesId', '') or
       coalesce(old.values->>'recurrenceOccurrenceId', '') <> coalesce(new.values->>'recurrenceOccurrenceId', '') or
       coalesce(old.values->>'recurrenceOriginalStartsAt', '') <> coalesce(new.values->>'recurrenceOriginalStartsAt', '') or
       coalesce(old.values->>'groupClassId', '') <> coalesce(new.values->>'groupClassId', '') then
      raise exception 'Series, occurrence, original-slot, and group-class identities are immutable';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists enforce_recurring_occurrence_identity on public.project_rows;
create trigger enforce_recurring_occurrence_identity
before insert or update of values on public.project_rows
for each row execute function public.enforce_recurring_occurrence_identity();

create or replace function public.reschedule_booking_occurrences(
  p_changes jsonb,
  p_scope text default 'single',
  p_series_id text default null,
  p_boundary text default null
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
  v_change jsonb;
  v_row public.project_rows%rowtype;
  v_values jsonb;
  v_ids uuid[] := '{}';
  v_occurrence_ids text[] := '{}';
  v_group_id text;
  v_count integer;
  v_schedule_changes text;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'At least one reschedule change is required';
  end if;
  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into strict v_activity_table_id from public.project_tables where project_id = v_project_id and slug = 'activity_logs';

  -- Validate and lock every persisted target before changing anything.
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_values := v_change->'values';
    if coalesce(v_values->>'startsAt', '') <> coalesce(v_change->>'newStartsAt', '') then
      raise exception 'New schedule does not match row values';
    end if;
    if coalesce(v_values->>'recurrenceOccurrenceId', '') <> '' then
      v_occurrence_ids := array_append(v_occurrence_ids, v_values->>'recurrenceOccurrenceId');
    end if;
    if nullif(v_change->>'id', '') is not null then
      select * into strict v_row from public.project_rows
      where id = (v_change->>'id')::uuid and project_table_id = v_bookings_table_id
      for update;
      if coalesce(v_row.values->>'startsAt', '') <> coalesce(v_change->>'oldStartsAt', '') then
        raise exception 'Booking changed while it was being rescheduled';
      end if;
      if coalesce(v_row.values->>'studentAccountId', '') <> coalesce(v_values->>'studentAccountId', '') then
        raise exception 'Student identity cannot change during reschedule';
      end if;
      v_ids := array_append(v_ids, v_row.id);
    end if;
  end loop;

  if p_scope not in ('single', 'future', 'all') then raise exception 'Invalid recurrence scope'; end if;
  if p_scope in ('future', 'all') then
    if coalesce(p_series_id, '') = '' then raise exception 'Bulk reschedule requires seriesId'; end if;
    if exists (
      select 1 from public.project_rows r
      where r.project_table_id = v_bookings_table_id
        and r.values->>'seriesId' = p_series_id
        and coalesce(r.values->>'status', '') not in ('cancelled', 'coach_confirmed')
        and (p_scope = 'all' or (r.values->>'recurrenceOriginalStartsAt')::timestamptz >= p_boundary::timestamptz)
        and not (r.id = any(v_ids))
        and not (coalesce(r.values->>'recurrenceOccurrenceId', '') = any(v_occurrence_ids))
    ) then raise exception 'Bulk reschedule must include every occurrence in scope'; end if;
  end if;

  -- A group block and every enrollment are one permanent unit.
  for v_group_id in
    select distinct value->'values'->>'groupClassId' from jsonb_array_elements(p_changes)
    where coalesce(value->'values'->>'groupClassId', '') <> ''
  loop
    if exists (
      select 1 from public.project_rows r
      where r.project_table_id = v_bookings_table_id and r.values->>'groupClassId' = v_group_id
        and not (r.id = any(v_ids))
        and not (coalesce(r.values->>'recurrenceOccurrenceId', '') = any(v_occurrence_ids))
    ) then raise exception 'Every group block and enrollment must move together'; end if;
  end loop;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_values := (v_change->'values') - 'id' - 'createdAt' - 'updatedAt';
    if nullif(v_change->>'id', '') is null then
      insert into public.project_rows(project_table_id, values)
      values (v_bookings_table_id, v_values)
      returning id into v_row.id;
      v_ids := array_append(v_ids, v_row.id);
    else
      update public.project_rows set values = v_values
      where id = (v_change->>'id')::uuid and project_table_id = v_bookings_table_id;
    end if;
  end loop;

  v_count := jsonb_array_length(p_changes);
  v_change := p_changes->0;
  select string_agg(format('%s -> %s', value->>'oldStartsAt', value->>'newStartsAt'), '; ' order by ordinality)
  into v_schedule_changes
  from jsonb_array_elements(p_changes) with ordinality;
  insert into public.project_rows(project_table_id, values)
  values (v_activity_table_id, jsonb_build_object(
    'action', 'updated',
    'message', format('Rescheduled %s class%s: %s.', v_count, case when v_count = 1 then '' else 'es' end, v_schedule_changes),
    'studentName', coalesce(v_change->'values'->>'studentName', ''),
    'coach', coalesce(v_change->'values'->>'assignedCoach', v_change->'values'->>'requestedCoach', ''),
    'dateLabel', coalesce(v_change->'values'->>'dateLabel', ''),
    'timeLabel', v_schedule_changes,
    'count', v_count
  ));

  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
          from public.project_rows r where r.id = any(v_ids));
end
$$;
