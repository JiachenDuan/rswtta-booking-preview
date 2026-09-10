-- Make account UUID the only identity key for creation, deduplication, and rename propagation.

create or replace function public.rename_student_account(p_account_id uuid, p_values jsonb)
returns public.project_rows
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_accounts_table_id uuid;
  v_bookings_table_id uuid;
  v_bills_table_id uuid;
  v_account public.project_rows;
  v_updated_account public.project_rows;
  v_old_name text;
  v_new_name text;
  v_new_email text;
begin
  select id into v_project_id from public.projects where slug = 'rswtta-booking';
  if v_project_id is null then raise exception 'Project not found'; end if;

  select id into v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  select id into v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into v_bills_table_id from public.project_tables where project_id = v_project_id and slug = 'bill_notifications';

  select * into v_account
  from public.project_rows
  where id = p_account_id and project_table_id = v_accounts_table_id
  for update;
  if not found then raise exception 'Account not found'; end if;

  v_old_name := btrim(coalesce(v_account.values->>'studentName', ''));
  v_new_name := btrim(coalesce(p_values->>'studentName', ''));
  v_new_email := lower(btrim(coalesce(p_values->>'email', '')));
  if v_new_name = '' then raise exception 'Student name is required'; end if;

  if v_new_email <> '' and exists (
    select 1 from public.project_rows
    where project_table_id = v_accounts_table_id
      and id <> p_account_id
      and lower(btrim(coalesce(values->>'email', ''))) = v_new_email
  ) then raise exception 'Email already used by another student'; end if;

  update public.project_rows
  set values = values || p_values || jsonb_build_object(
    'preregisteredName', coalesce(nullif(values->>'preregisteredName', ''), v_old_name)
  )
  where id = p_account_id and project_table_id = v_accounts_table_id
  returning * into v_updated_account;

  update public.project_rows
  set values = values || jsonb_build_object(
    'studentAccountId', p_account_id::text,
    'studentName', v_new_name,
    'familyName', v_new_name,
    'studentEmail', coalesce(p_values->>'email', values->>'studentEmail', ''),
    'phone', coalesce(p_values->>'phone', values->>'phone', '')
  )
  where project_table_id = v_bookings_table_id
    and values->>'studentAccountId' = p_account_id::text;

  update public.project_rows
  set values = values || jsonb_build_object(
    'studentAccountId', p_account_id::text,
    'studentName', v_new_name,
    'familyName', v_new_name,
    'message', v_new_name || ': ' || coalesce(values->>'classCount', '0') || ' completed classes ready to bill'
  )
  where project_table_id = v_bills_table_id
    and values->>'studentAccountId' = p_account_id::text;

  return v_updated_account;
end;
$$;

grant execute on function public.rename_student_account(uuid, jsonb) to anon, authenticated;

-- Only legacy preregistration seeds carry preregisteredName. Club-created
-- accounts may share display names or family phones without being merged.
create or replace function public.prevent_duplicate_student_account_seed()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_accounts_table_id uuid;
  v_preregistered_name text;
  v_is_legacy_seed boolean;
begin
  select pt.id into v_accounts_table_id
  from public.project_tables pt
  join public.projects p on p.id = pt.project_id
  where p.slug = 'rswtta-booking' and pt.slug = 'parent_accounts';

  if v_accounts_table_id is null or new.project_table_id <> v_accounts_table_id then return new; end if;

  v_preregistered_name := lower(regexp_replace(btrim(coalesce(new.values->>'preregisteredName', '')), '\s+', ' ', 'g'));
  v_is_legacy_seed :=
    v_preregistered_name <> ''
    and coalesce(new.values->>'email', '') = ''
    and coalesce(new.values->>'phone', '') = ''
    and coalesce((new.values->>'profileSetupRequired')::boolean, false) is true;

  if v_is_legacy_seed and exists (
    select 1
    from public.project_rows existing
    where existing.project_table_id = v_accounts_table_id
      and existing.id <> new.id
      and lower(regexp_replace(btrim(coalesce(existing.values->>'preregisteredName', '')), '\s+', ' ', 'g')) = v_preregistered_name
  ) then
    raise exception 'Preregistered roster entry already has an account';
  end if;

  return new;
end;
$$;

-- Replace the old display-name natural key with stable account identity.
drop index if exists public.project_rows_rswtta_bookings_unique_active;
create unique index project_rows_rswtta_bookings_unique_active
on public.project_rows (
  project_table_id,
  btrim(values->>'studentAccountId'),
  lower(btrim(coalesce(nullif(values->>'assignedCoach', ''), values->>'requestedCoach', ''))),
  btrim(values->>'startsAt')
)
where
  project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'
  and coalesce(values->>'status', '') <> 'cancelled'
  and coalesce(btrim(values->>'studentAccountId'), '') <> '';
