-- Restore private-class requests only from Parent Calendar. My Classes remains
-- read-only. The RPC serializes coach and student availability checks with the
-- insert so concurrent requests cannot both claim an overlapping interval.

do $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_count bigint;
begin
  select count(*) into v_count from public.projects where slug = 'rswtta-booking';
  if v_count <> 1 then raise exception 'Parent request project baseline guard failed: expected 1, found %', v_count; end if;
  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';

  select count(*) into v_count from public.project_tables where project_id = v_project_id and slug = 'bookings';
  if v_count <> 1 then raise exception 'Parent request bookings-table baseline guard failed: expected 1, found %', v_count; end if;
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';

  select count(*) into v_count from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  if v_count <> 1 then raise exception 'Parent request accounts-table baseline guard failed: expected 1, found %', v_count; end if;

  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id;
  if v_count <> 1985 then raise exception 'Parent request booking-count baseline guard failed: expected 1985, found %', v_count; end if;

  select count(*) into v_count
  from public.project_rows r
  where r.project_table_id = v_bookings_table_id
    and coalesce(r.values->>'status', '') <> 'cancelled'
    and (
      coalesce(r.values->>'startsAt', '') = ''
      or btrim(split_part(coalesce(r.values->>'timeLabel', ''), ' - ', 2)) !~* '^([0-9]{1,2})(:([0-9]{2}))? (AM|PM)$'
    );
  if v_count <> 0 then raise exception 'Parent request interval baseline guard failed: expected 0 malformed active rows, found %', v_count; end if;

  if to_regprocedure('public.request_booking_as_parent(uuid,text,jsonb)') is not null
    or to_regprocedure('public.rswtta_canonical_coach_id(text)') is not null
    or to_regprocedure('public.rswtta_booking_ends_at(jsonb)') is not null
  then raise exception 'Parent request function baseline guard failed: functions already exist'; end if;
end;
$$;

create or replace function public.rswtta_canonical_coach_id(p_coach text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case lower(regexp_replace(btrim(p_coach), '\s+', ' ', 'g'))
    when 'coach tian ye' then 'coach_tian_ye'
    when 'tian ye' then 'coach_tian_ye'
    when 'coach tian' then 'coach_tian_ye'
    when 'head coach tian' then 'coach_tian_ye'
    when 'coach jorden' then 'coach_jorden'
    when 'jorden' then 'coach_jorden'
    when 'coach wang' then 'coach_jorden'
    when 'wang' then 'coach_jorden'
    when 'national a' then 'coach_debolina'
    when 'debolina' then 'coach_debolina'
    when 'national b' then 'coach_diren'
    when 'diren' then 'coach_diren'
    else 'coach:' || lower(regexp_replace(btrim(p_coach), '\s+', ' ', 'g'))
  end;
$$;

create or replace function public.rswtta_booking_ends_at(p_values jsonb)
returns timestamptz
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end_label text;
  v_match text[];
  v_start_minutes integer;
  v_end_minutes integer;
begin
  v_start := nullif(p_values->>'startsAt', '')::timestamptz;
  v_end_label := btrim(split_part(coalesce(p_values->>'timeLabel', ''), ' - ', 2));
  v_match := regexp_match(v_end_label, '^([0-9]{1,2})(:([0-9]{2}))? (AM|PM)$', 'i');
  if v_match is null then return v_start + interval '1 hour'; end if;

  v_start_minutes := extract(hour from v_start at time zone 'America/Los_Angeles')::integer * 60
    + extract(minute from v_start at time zone 'America/Los_Angeles')::integer;
  v_end_minutes := (case
    when upper(v_match[4]) = 'AM' and v_match[1]::integer = 12 then 0
    when upper(v_match[4]) = 'PM' and v_match[1]::integer <> 12 then v_match[1]::integer + 12
    else v_match[1]::integer
  end) * 60 + coalesce(v_match[3], '0')::integer;
  if v_end_minutes <= v_start_minutes then v_end_minutes := v_end_minutes + 24 * 60; end if;
  return v_start + make_interval(mins => v_end_minutes - v_start_minutes);
exception when others then
  return null;
end;
$$;

create or replace function public.request_booking_as_parent(
  p_request_id uuid,
  p_student_account_id text,
  p_values jsonb
)
returns public.project_rows
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_accounts_table_id uuid;
  v_account_id uuid;
  v_account public.project_rows%rowtype;
  v_existing public.project_rows%rowtype;
  v_inserted public.project_rows%rowtype;
  v_coach text;
  v_coach_id text;
  v_start timestamptz;
  v_end timestamptz;
  v_values jsonb;
begin
  if p_request_id is null then raise exception 'A unique booking identity is required'; end if;
  begin
    v_account_id := nullif(btrim(p_student_account_id), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A signed-in student account is required to request this class';
  end;
  if v_account_id is null then raise exception 'A signed-in student account is required to request this class'; end if;

  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into strict v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  select * into strict v_account from public.project_rows where id = v_account_id and project_table_id = v_accounts_table_id;

  if coalesce(p_values->>'studentAccountId', '') <> v_account_id::text then
    raise exception 'Student identity does not match the signed-in account';
  end if;
  v_coach := btrim(coalesce(nullif(p_values->>'assignedCoach', ''), p_values->>'requestedCoach', ''));
  if v_coach = '' or public.rswtta_canonical_coach_id(v_coach) <> public.rswtta_canonical_coach_id(coalesce(p_values->>'requestedCoach', '')) then
    raise exception 'A single valid coach is required';
  end if;
  v_coach_id := public.rswtta_canonical_coach_id(v_coach);
  if v_coach_id = 'coach_tian_ye' then
    raise exception 'Coach Tian Ye’s classes cannot be booked directly through this app. Please email info@rswtta.com or contact Coach Tian Ye or the club assistant.';
  end if;
  if coalesce(p_values->>'program', '') not in ('Private lesson', 'Group lesson') then
    raise exception 'Parent Calendar can only request a student class';
  end if;

  if btrim(split_part(coalesce(p_values->>'timeLabel', ''), ' - ', 2)) !~* '^([0-9]{1,2})(:([0-9]{2}))? (AM|PM)$' then
    raise exception 'A valid class interval is required';
  end if;
  begin
    v_start := nullif(p_values->>'startsAt', '')::timestamptz;
    v_end := public.rswtta_booking_ends_at(p_values);
  exception when others then
    raise exception 'A valid class interval is required';
  end;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'A valid class interval is required'; end if;
  if v_end - v_start < interval '30 minutes'
    or v_end - v_start > interval '12 hours'
    or mod(extract(epoch from (v_end - v_start))::integer, 1800) <> 0
  then raise exception 'Class intervals must use 30-minute increments between 30 minutes and 12 hours'; end if;

  -- Every caller takes locks in this order. Equal coach or student keys serialize,
  -- making the half-open overlap checks and insert one atomic reservation.
  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-request:coach:' || v_coach_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-request:student:' || v_account_id::text, 0));
  if v_start <= clock_timestamp() then raise exception 'Past times cannot be requested'; end if;

  select * into v_existing from public.project_rows where id = p_request_id for update;
  if found then
    if v_existing.project_table_id = v_bookings_table_id
      and coalesce(v_existing.values->>'studentAccountId', '') = v_account_id::text
      and public.rswtta_canonical_coach_id(coalesce(nullif(v_existing.values->>'assignedCoach', ''), v_existing.values->>'requestedCoach', '')) = v_coach_id
      and (v_existing.values->>'startsAt')::timestamptz = v_start
    then return v_existing;
    end if;
    raise exception 'Booking identity is already in use';
  end if;

  select * into v_existing
  from public.project_rows r
  where r.project_table_id = v_bookings_table_id
    and coalesce(r.values->>'status', '') <> 'cancelled'
    and r.values->>'studentAccountId' = v_account_id::text
    and public.rswtta_canonical_coach_id(coalesce(nullif(r.values->>'assignedCoach', ''), r.values->>'requestedCoach', '')) = v_coach_id
    and (r.values->>'startsAt')::timestamptz = v_start
  limit 1 for update;
  if found then return v_existing; end if;

  if exists (
    select 1 from public.project_rows r
    where r.project_table_id = v_bookings_table_id
      and coalesce(r.values->>'status', '') <> 'cancelled'
      and (
        public.rswtta_canonical_coach_id(coalesce(nullif(r.values->>'assignedCoach', ''), r.values->>'requestedCoach', '')) = v_coach_id
        or r.values->>'studentAccountId' = v_account_id::text
      )
      and (r.values->>'startsAt')::timestamptz < v_end
      and v_start < public.rswtta_booking_ends_at(r.values)
  ) then raise exception 'The full class interval is no longer available'; end if;

  v_values := (p_values - 'id' - 'status' - 'createdAt' - 'updatedAt') || jsonb_build_object(
    'studentAccountId', v_account_id::text,
    'studentName', coalesce(v_account.values->>'studentName', ''),
    'familyName', coalesce(v_account.values->>'studentName', ''),
    'studentEmail', coalesce(v_account.values->>'email', p_values->>'studentEmail', ''),
    'phone', coalesce(v_account.values->>'phone', p_values->>'phone', ''),
    'status', 'requested'
  );
  insert into public.project_rows(id, project_table_id, values)
  values (p_request_id, v_bookings_table_id, v_values)
  returning * into v_inserted;
  return v_inserted;
exception when no_data_found then
  raise exception 'Parent request baseline is missing the project, bookings table, or student account';
end;
$$;

revoke all on function public.request_booking_as_parent(uuid, text, jsonb) from public;
grant execute on function public.request_booking_as_parent(uuid, text, jsonb) to anon, authenticated;
