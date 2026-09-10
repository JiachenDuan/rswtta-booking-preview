-- Enforce stable student identity at the database boundary.
-- Existing unresolved legacy rows remain readable, but cannot be mutated until explicitly repaired.
create or replace function public.enforce_student_reference_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_accounts_table_id uuid;
  v_bookings_table_id uuid;
  v_bills_table_id uuid;
  v_account_id uuid;
  v_account_values jsonb;
  v_old_account_id text;
begin
  select id into v_project_id from public.projects where slug = 'rswtta-booking';
  if v_project_id is null then return new; end if;

  select id into v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  select id into v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into v_bills_table_id from public.project_tables where project_id = v_project_id and slug = 'bill_notifications';

  if new.project_table_id = v_bookings_table_id
    and coalesce(new.values->>'program', '') in ('Unavailable', 'Group class')
  then return new;
  end if;

  if new.project_table_id <> v_bookings_table_id and new.project_table_id <> v_bills_table_id then
    return new;
  end if;

  begin
    v_account_id := nullif(new.values->>'studentAccountId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Student class relationship requires a valid studentAccountId';
  end;
  if v_account_id is null then
    raise exception 'Student class relationship requires studentAccountId';
  end if;

  if tg_op = 'UPDATE' and old.project_table_id in (v_bookings_table_id, v_bills_table_id) then
    v_old_account_id := nullif(old.values->>'studentAccountId', '');
    if v_old_account_id is not null and v_old_account_id <> v_account_id::text then
      raise exception 'studentAccountId is immutable for an existing class relationship';
    end if;
  end if;

  select values into v_account_values
  from public.project_rows
  where id = v_account_id and project_table_id = v_accounts_table_id;
  if not found then raise exception 'Student account not found for class relationship'; end if;

  new.values := new.values || jsonb_build_object(
    'studentAccountId', v_account_id::text,
    'studentName', coalesce(v_account_values->>'studentName', ''),
    'familyName', coalesce(v_account_values->>'studentName', ''),
    'studentEmail', coalesce(v_account_values->>'email', new.values->>'studentEmail', ''),
    'phone', coalesce(v_account_values->>'phone', new.values->>'phone', '')
  );

  if new.project_table_id = v_bills_table_id then
    new.values := new.values || jsonb_build_object(
      'message', coalesce(v_account_values->>'studentName', '') || ': ' || coalesce(new.values->>'classCount', '0') || ' completed classes ready to bill'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_student_reference_identity on public.project_rows;
create trigger enforce_student_reference_identity
before insert or update of project_table_id, values on public.project_rows
for each row
execute function public.enforce_student_reference_identity();
