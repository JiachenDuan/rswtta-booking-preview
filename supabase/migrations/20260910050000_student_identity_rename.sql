-- Atomically rename one student account and references already linked by stable identity.
-- Unlinked legacy rows are handled only by the separately reviewed conservative backfill.
-- Historical activity-log messages intentionally remain immutable audit snapshots.
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

  if exists (
    select 1 from public.project_rows
    where project_table_id = v_accounts_table_id
      and id <> p_account_id
      and lower(btrim(coalesce(values->>'studentName', ''))) = lower(v_new_name)
  ) then raise exception 'Student name already has an account'; end if;

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
