-- Enforce parent cancellation against the database clock and force all booking
-- cancellation transitions through an explicit parent or club workflow.

create or replace function public.authoritative_current_time()
returns timestamptz
language sql
security invoker
set search_path = public, pg_temp
as $$
  select clock_timestamp();
$$;

revoke all on function public.authoritative_current_time() from public;
grant execute on function public.authoritative_current_time() to anon, authenticated;

create or replace function public.guard_booking_cancellation_transition()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bookings_table_id uuid;
  v_actor text;
begin
  if coalesce(old.values->>'status', '') = 'cancelled'
    or coalesce(new.values->>'status', '') <> 'cancelled'
  then
    return new;
  end if;

  select t.id into v_bookings_table_id
  from public.project_tables t
  join public.projects p on p.id = t.project_id
  where p.slug = 'rswtta-booking' and t.slug = 'bookings';

  if new.project_table_id <> v_bookings_table_id then return new; end if;

  v_actor := current_setting('rswtta.cancellation_actor', true);
  if coalesce(v_actor, '') not in ('parent', 'club') then
    raise exception 'Booking cancellations must use the parent or club cancellation workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_booking_cancellation_transition on public.project_rows;
create trigger guard_booking_cancellation_transition
before update of values on public.project_rows
for each row
execute function public.guard_booking_cancellation_transition();

create or replace function public.cancel_booking_as_parent(
  p_booking_id uuid,
  p_student_account_id text,
  p_virtual_values jsonb default null
)
returns public.project_rows
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bookings_table_id uuid;
  v_row public.project_rows%rowtype;
  v_values jsonb;
  v_starts_at timestamptz;
  v_current_time timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_student_account_id), '') is null then
    raise exception 'A signed-in student account is required to cancel this class';
  end if;

  select t.id into strict v_bookings_table_id
  from public.project_tables t
  join public.projects p on p.id = t.project_id
  where p.slug = 'rswtta-booking' and t.slug = 'bookings';

  if p_booking_id is null then
    if p_virtual_values is null then raise exception 'Virtual booking values are required'; end if;
    v_values := p_virtual_values;
  else
    select * into strict v_row
    from public.project_rows
    where id = p_booking_id and project_table_id = v_bookings_table_id
    for update;
    v_values := v_row.values;
  end if;

  if coalesce(v_values->>'studentAccountId', '') <> btrim(p_student_account_id) then
    raise exception 'This class does not belong to the signed-in student';
  end if;

  begin
    v_starts_at := nullif(v_values->>'startsAt', '')::timestamptz;
  exception when others then
    raise exception 'This class time is unavailable, so it cannot be cancelled online. Please contact the club assistant.';
  end;
  if v_starts_at is null then
    raise exception 'This class time is unavailable, so it cannot be cancelled online. Please contact the club assistant.';
  end if;
  if v_starts_at <= v_current_time then
    raise exception 'This class has already started and can no longer be cancelled online. Please contact the club assistant.';
  end if;
  if v_starts_at <= v_current_time + interval '12 hours' then
    raise exception 'This class starts within 12 hours and can no longer be cancelled online. Please contact the club assistant.';
  end if;

  if coalesce(v_values->>'status', '') not in ('requested', 'club_confirmed') then
    raise exception 'This class can no longer be cancelled online.';
  end if;

  perform set_config('rswtta.cancellation_actor', 'parent', true);
  v_values := v_values || jsonb_build_object(
    'status', 'cancelled',
    'parentNote', btrim(coalesce(v_values->>'parentNote', '') || ' Cancelled by parent/student.')
  );

  if p_booking_id is null then
    insert into public.project_rows(project_table_id, values)
    values (v_bookings_table_id, v_values)
    returning * into v_row;
  else
    update public.project_rows
    set values = v_values
    where id = p_booking_id and project_table_id = v_bookings_table_id
    returning * into v_row;
  end if;

  return v_row;
exception
  when no_data_found then
    raise exception 'Booking not found in shared club view';
end;
$$;

create or replace function public.cancel_booking_as_club(p_booking_id uuid)
returns public.project_rows
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bookings_table_id uuid;
  v_row public.project_rows%rowtype;
begin
  select t.id into strict v_bookings_table_id
  from public.project_tables t
  join public.projects p on p.id = t.project_id
  where p.slug = 'rswtta-booking' and t.slug = 'bookings';

  perform set_config('rswtta.cancellation_actor', 'club', true);
  update public.project_rows
  set values = values || jsonb_build_object('status', 'cancelled')
  where id = p_booking_id and project_table_id = v_bookings_table_id
  returning * into strict v_row;
  return v_row;
exception
  when no_data_found then
    raise exception 'Booking not found in shared club view';
end;
$$;

revoke all on function public.cancel_booking_as_parent(uuid, text, jsonb) from public;
revoke all on function public.cancel_booking_as_club(uuid) from public;
grant execute on function public.cancel_booking_as_parent(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.cancel_booking_as_club(uuid) to anon, authenticated;
