-- Prevent stale clients from recreating a blank preregistered account after its identity was claimed.
create or replace function public.prevent_duplicate_student_account_seed()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_accounts_table_id uuid;
  v_name text;
  v_is_blank_seed boolean;
begin
  select pt.id into v_accounts_table_id
  from public.project_tables pt
  join public.projects p on p.id = pt.project_id
  where p.slug = 'rswtta-booking' and pt.slug = 'parent_accounts';

  if v_accounts_table_id is null or new.project_table_id <> v_accounts_table_id then return new; end if;

  v_name := lower(regexp_replace(btrim(coalesce(new.values->>'studentName', '')), '\s+', ' ', 'g'));
  if v_name = '' then return new; end if;

  v_is_blank_seed :=
    coalesce(new.values->>'email', '') = ''
    and coalesce(new.values->>'phone', '') = ''
    and coalesce((new.values->>'profileSetupRequired')::boolean, false) is true;

  if v_is_blank_seed and exists (
    select 1
    from public.project_rows existing
    where existing.project_table_id = v_accounts_table_id
      and existing.id <> new.id
      and (
        lower(regexp_replace(btrim(coalesce(existing.values->>'studentName', '')), '\s+', ' ', 'g')) = v_name
        or lower(regexp_replace(btrim(coalesce(existing.values->>'preregisteredName', '')), '\s+', ' ', 'g')) = v_name
      )
  ) then
    raise exception 'Preregistered student identity already has an account';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_student_account_seed on public.project_rows;
create trigger prevent_duplicate_student_account_seed
before insert or update of project_table_id, values on public.project_rows
for each row
execute function public.prevent_duplicate_student_account_seed();
