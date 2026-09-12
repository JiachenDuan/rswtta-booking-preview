begin;

select pg_advisory_xact_lock(hashtextextended('rswtta:lock-legacy-student-seed-claims', 0));

do $$
declare
  v_accounts_table_id uuid;
  v_account_count bigint;
  v_recreated_count bigint;
  v_protected_count bigint;
  v_account_id_sha256 text;
begin
  select pt.id into v_accounts_table_id
  from public.project_tables pt
  join public.projects p on p.id = pt.project_id
  where p.id = 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
    and p.slug = 'rswtta-booking'
    and pt.id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
    and pt.slug = 'parent_accounts';

  if v_accounts_table_id is null then
    raise exception 'RSWTTA parent_accounts identity mismatch';
  end if;

  select count(*), encode(digest(string_agg(id::text, E'\n' order by id), 'sha256'), 'hex')
  into v_account_count, v_account_id_sha256
  from public.project_rows
  where project_table_id = v_accounts_table_id;

  select count(*) into v_recreated_count
  from public.project_rows
  where project_table_id = v_accounts_table_id
    and id in (
      '46619dca-fc4e-484f-aca3-4ab4e6f26c53'::uuid,
      '6072e7f4-271c-474a-8a7d-56a20c0dd964'::uuid,
      '6d70b708-4e90-4e49-8606-e73c72ba1876'::uuid,
      '6f4a100d-cf83-4c56-9bca-bc8ae38d6ab3'::uuid,
      '9c18f8ae-7ba7-4bdb-a374-d176b8d04f4a'::uuid,
      'aa03cb32-94d8-4b50-8574-daea7639c239'::uuid
    );

  select count(*) into v_protected_count
  from public.project_rows
  where project_table_id = v_accounts_table_id
    and id in (
      '9bed3c27-3e60-4a78-be48-fbb40430cf0c'::uuid,
      'd33b45ca-34bc-4df9-a830-b38ea32cd12e'::uuid,
      '9f04c65b-d514-4d17-b407-d57b043964e8'::uuid,
      'bdaac62c-8f13-4426-bca1-fc8ac7d2a7f9'::uuid,
      '399ba93f-c2cb-4576-88c0-af732809e73e'::uuid,
      'b8433b38-75f0-4e37-8792-3b952d26c74d'::uuid,
      '3a6d38c0-a343-42fe-b373-e1649928041d'::uuid,
      'bf649094-a22b-469b-8232-7bc1de6ee70a'::uuid,
      '5ff0ff61-356e-4310-a3f8-9a00c8e9b66c'::uuid
    );

  if v_protected_count <> 9 then
    raise exception 'Protected account guard mismatch: %', v_protected_count;
  end if;

  if not (
    (v_account_count = 71 and v_recreated_count = 6 and v_account_id_sha256 = '2cc46667f56c607fc43eb8d07db5188a4fb79f780918681213700023d5a293c1')
    or
    (v_account_count = 65 and v_recreated_count = 0 and v_account_id_sha256 = '5ac42d21ab1b8fe42f774340f321027b7c7640433134e6e41feec216b13ec36b')
  ) then
    raise exception 'Account baseline guard mismatch: count %, recreated %, hash %', v_account_count, v_recreated_count, v_account_id_sha256;
  end if;

  if exists (select 1 from public.class_package_hours_ledger) then
    raise exception 'Package ledger changed before seed prevention rollout';
  end if;
end
$$;

create or replace function public.prevent_duplicate_student_account_seed()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_accounts_table_id constant uuid := '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  v_old_claim text;
  v_claim text;
  v_claim_label text;
  v_is_legacy_seed boolean;
begin
  if new.project_table_id <> v_accounts_table_id then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_claim := lower(regexp_replace(btrim(coalesce(old.values->>'preregisteredName', '')), '\s+', ' ', 'g'));
    v_claim := lower(regexp_replace(btrim(coalesce(new.values->>'preregisteredName', '')), '\s+', ' ', 'g'));
    if v_old_claim <> '' and v_claim is distinct from v_old_claim then
      raise exception 'Preregistered roster claim is immutable';
    end if;
    return new;
  end if;

  v_claim_label := regexp_replace(btrim(coalesce(nullif(new.values->>'preregisteredName', ''), new.values->>'studentName', '')), '\s+', ' ', 'g');
  v_claim := lower(v_claim_label);
  v_is_legacy_seed :=
    v_claim <> ''
    and btrim(coalesce(new.values->>'email', '')) = ''
    and btrim(coalesce(new.values->>'phone', '')) = ''
    and coalesce((new.values->>'profileSetupRequired')::boolean, false) is true;

  if not v_is_legacy_seed then
    return new;
  end if;

  -- Serialize every spelling claim before checking its immutable owner.
  perform pg_advisory_xact_lock(hashtextextended(v_accounts_table_id::text || ':' || v_claim, 0));

  if exists (
    select 1
    from public.project_rows existing
    where existing.project_table_id = v_accounts_table_id
      and lower(regexp_replace(btrim(coalesce(existing.values->>'preregisteredName', '')), '\s+', ' ', 'g')) = v_claim
      and coalesce((existing.values->>'profileSetupRequired')::boolean, true) is false
  ) then
    raise exception 'Preregistered roster entry already has a completed account';
  end if;

  -- Normalize stale seed payloads so the unique claim index also serializes
  -- clients that omit preregisteredName and send only studentName.
  new.values := jsonb_set(new.values, '{preregisteredName}', to_jsonb(v_claim_label), true);
  return new;
end;
$$;

drop trigger if exists prevent_duplicate_student_account_seed on public.project_rows;
create trigger prevent_duplicate_student_account_seed
before insert or update of project_table_id, values on public.project_rows
for each row
execute function public.prevent_duplicate_student_account_seed();

create unique index if not exists project_rows_unique_legacy_seed_claim
on public.project_rows (
  project_table_id,
  lower(regexp_replace(btrim(values->>'preregisteredName'), '\s+', ' ', 'g'))
)
where
  project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
  and btrim(coalesce(values->>'preregisteredName', '')) <> ''
  and btrim(coalesce(values->>'email', '')) = ''
  and btrim(coalesce(values->>'phone', '')) = ''
  and coalesce((values->>'profileSetupRequired')::boolean, false) is true;

commit;
