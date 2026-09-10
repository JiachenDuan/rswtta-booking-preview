-- Guarded cleanup for four blank seeds recreated by a stale client during the 2026-09-10 rollout.
-- Run only after prevent_duplicate_student_account_seed is installed.
begin;

create temp table recreated_seed_cleanup (
  duplicate_account_id uuid primary key,
  expected_name text not null
) on commit drop;

insert into recreated_seed_cleanup values
  ('33b2f2fb-1be6-4bd5-94ca-af351038f845', 'Kyson'),
  ('518e3e6d-a4f9-4871-b3e0-e55075b99399', 'Eddie'),
  ('b6e55947-4d4a-4315-80dd-8ef27646c581', 'Alex'),
  ('db18db86-3483-412b-8b66-7c5afacb067b', 'Luke');

do $$
declare
  expected record;
  duplicate public.project_rows;
  v_linked integer;
begin
  if not exists (select 1 from pg_trigger where tgname = 'prevent_duplicate_student_account_seed' and not tgisinternal) then
    raise exception 'Duplicate seed prevention trigger is not installed';
  end if;
  if (select count(*) from public.project_rows where project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid) <> 69
    or (select count(*) from public.project_rows where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid) <> 1882
    or (select count(*) from public.project_rows where project_table_id = '47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid) <> 0
    or (select count(*) from public.project_rows where project_table_id = '133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid) <> 33
  then raise exception 'Recreated seed cleanup baseline changed';
  end if;

  select count(*) into v_linked from public.project_rows
  where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid
    and coalesce(values->>'studentAccountId', '') <> '';
  if v_linked <> 1633 then raise exception 'Expected 1633 linked bookings, found %', v_linked; end if;

  for expected in select * from recreated_seed_cleanup loop
    select * into duplicate from public.project_rows
    where id = expected.duplicate_account_id
      and project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
    for update;
    if not found
      or duplicate.values->>'studentName' <> expected.expected_name
      or coalesce(duplicate.values->>'email', '') <> ''
      or coalesce(duplicate.values->>'phone', '') <> ''
      or coalesce((duplicate.values->>'profileSetupRequired')::boolean, false) is not true
      or duplicate.created_at < '2026-09-10T13:58:45Z'::timestamptz
      or duplicate.created_at >= '2026-09-10T13:58:46Z'::timestamptz
      or exists (select 1 from public.project_rows booking where booking.values->>'studentAccountId' = expected.duplicate_account_id::text)
    then raise exception 'Recreated seed guard failed for %', expected.duplicate_account_id;
    end if;
  end loop;

  if (select values->>'preregisteredName' from public.project_rows where id = 'bdaac62c-8f13-4426-bca1-fc8ac7d2a7f9'::uuid) <> 'Kyson'
    or (select values->>'preregisteredName' from public.project_rows where id = 'd33b45ca-34bc-4df9-a830-b38ea32cd12e'::uuid) <> 'Eddie'
    or (select values->>'preregisteredName' from public.project_rows where id = '9f04c65b-d514-4d17-b407-d57b043964e8'::uuid) <> 'Luke'
    or (select values->>'preregisteredName' from public.project_rows where id = '9bed3c27-3e60-4a78-be48-fbb40430cf0c'::uuid) <> 'Alex'
  then raise exception 'Canonical preregistered claims are missing';
  end if;
end $$;

delete from public.project_rows target
using recreated_seed_cleanup cleanup
where target.id = cleanup.duplicate_account_id
  and target.project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;

do $$
begin
  if (select count(*) from public.project_rows where project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid) <> 65 then
    raise exception 'Recreated seed cleanup post-count failed';
  end if;
  if exists (select 1 from recreated_seed_cleanup cleanup join public.project_rows target on target.id = cleanup.duplicate_account_id) then
    raise exception 'A recreated seed was not removed';
  end if;
end $$;

commit;
