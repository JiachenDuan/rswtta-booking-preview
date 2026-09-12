-- A completed account's immutable preregisteredName claim satisfies the legacy seed.
-- Display names remain non-unique, and existing rows (including Felix) are not changed.
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
      and coalesce((existing.values->>'profileSetupRequired')::boolean, true) is false
  ) then
    raise exception 'Preregistered roster entry already has a completed account';
  end if;

  return new;
end;
$$;

-- Keep the existing trigger binding explicit for stale clients.
drop trigger if exists prevent_duplicate_student_account_seed on public.project_rows;
create trigger prevent_duplicate_student_account_seed
before insert or update of project_table_id, values on public.project_rows
for each row
execute function public.prevent_duplicate_student_account_seed();
