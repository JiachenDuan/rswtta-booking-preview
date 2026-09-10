-- Parent class history and schedules are read-only. Only the club workflow may
-- transition a booking to cancelled, including calls from stale parent clients.

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
  if coalesce(v_actor, '') <> 'club' then
    raise exception 'Parent cancellation is not available. Please contact the club assistant.';
  end if;
  return new;
end;
$$;

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
begin
  raise exception 'Parent cancellation is not available. Please contact the club assistant.';
end;
$$;

revoke all on function public.cancel_booking_as_parent(uuid, text, jsonb) from public;
grant execute on function public.cancel_booking_as_parent(uuid, text, jsonb) to anon, authenticated;
