-- REVIEWED ONE-TIME REPAIR for five verified blank duplicate accounts.
-- Run only after the 1,632-row conservative backfill commits successfully.
-- Alex Ma, Dan, and Dan Rosenthal are explicitly protected as distinct students.
begin;

create temp table verified_duplicate_repairs (
  real_account_id uuid not null,
  duplicate_account_id uuid not null,
  preregistered_name text not null,
  current_name text not null,
  expected_current_name_bookings integer not null,
  expected_legacy_name_bookings integer not null
) on commit drop;

insert into verified_duplicate_repairs values
  ('bdaac62c-8f13-4426-bca1-fc8ac7d2a7f9', '6934d2c2-2857-4696-a92c-724bad486204', 'Kyson', 'Kyson Duan', 109, 1),
  ('d33b45ca-34bc-4df9-a830-b38ea32cd12e', '182fa89c-49d7-4266-ac20-f659e4561050', 'Eddie', 'Eddie Chai', 53, 0),
  ('9f04c65b-d514-4d17-b407-d57b043964e8', '34f99fa1-582c-4daa-a298-c4324172079f', 'Luke', 'Luke Xu', 53, 0),
  ('9bed3c27-3e60-4a78-be48-fbb40430cf0c', '8808e4fa-1040-45ee-b81f-34d33da4a7fe', 'Alex', 'Alex Li', 53, 0),
  ('9bed3c27-3e60-4a78-be48-fbb40430cf0c', 'a54fb9ad-118b-4124-8fbf-98e046ff2dfe', 'Alex', 'Alex Li', 53, 0);

create temp table protected_identity_snapshot on commit drop as
select r.id, r.values
from public.project_rows r
where r.id in (
  '7a43bdfb-2640-4795-a040-0e77395c8983'::uuid, -- Alex Ma
  '4a1684a8-15dc-4fe8-9e5c-ca522b35eae9'::uuid, -- Dan
  '360caf3a-924b-4817-b5cf-09c6bd519d19'::uuid  -- Dan Rosenthal
)
or (
  r.project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid
  and lower(btrim(coalesce(r.values->>'studentName', ''))) in ('alex ma', 'dan', 'dan rosenthal')
);

do $$
declare
  repair record;
  real_account public.project_rows;
  duplicate_account public.project_rows;
  current_count integer;
  legacy_count integer;
  linked_count integer;
begin
  if (select count(*) from public.project_rows where project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid) <> 70
    or (select count(*) from public.project_rows where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid) <> 1882
    or (select count(*) from public.project_rows where project_table_id = '47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid) <> 0
    or (select count(*) from public.project_rows where project_table_id = '133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid) <> 33
  then raise exception 'Verified duplicate repair baseline counts changed';
  end if;

  select count(*) into linked_count
  from public.project_rows
  where project_table_id in ('a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid, '47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid)
    and coalesce(values->>'studentAccountId', '') <> '';
  if linked_count <> 1632 then raise exception 'Expected 1632 linked references after backfill, found %', linked_count; end if;

  for repair in select * from verified_duplicate_repairs loop
    select * into real_account from public.project_rows
    where id = repair.real_account_id and project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
    for update;
    if not found
      or real_account.values->>'studentName' <> repair.current_name
      or coalesce(real_account.values->>'email', '') = ''
      or coalesce(real_account.values->>'phone', '') = ''
      or coalesce((real_account.values->>'profileSetupRequired')::boolean, true) is not false
    then raise exception 'Real account guard failed for %', repair.current_name;
    end if;

    select * into duplicate_account from public.project_rows
    where id = repair.duplicate_account_id and project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
    for update;
    if not found
      or duplicate_account.values->>'studentName' <> repair.preregistered_name
      or coalesce(duplicate_account.values->>'email', '') <> ''
      or coalesce(duplicate_account.values->>'phone', '') <> ''
      or coalesce((duplicate_account.values->>'profileSetupRequired')::boolean, false) is not true
    then raise exception 'Blank duplicate guard failed for % / %', repair.preregistered_name, repair.duplicate_account_id;
    end if;

    select count(*) into current_count from public.project_rows
    where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid
      and lower(btrim(coalesce(values->>'studentName', ''))) = lower(repair.current_name);
    select count(*) into legacy_count from public.project_rows
    where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid
      and lower(btrim(coalesce(values->>'studentName', ''))) = lower(repair.preregistered_name);
    if current_count <> repair.expected_current_name_bookings or legacy_count <> repair.expected_legacy_name_bookings then
      raise exception 'Booking count guard failed for %: current %, legacy %', repair.current_name, current_count, legacy_count;
    end if;
  end loop;

  if (select values->>'studentName' from public.project_rows where id = '7a43bdfb-2640-4795-a040-0e77395c8983'::uuid) <> 'Alex Ma'
    or (select count(*) from public.project_rows where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and lower(btrim(coalesce(values->>'studentName', ''))) = 'alex ma') <> 26
    or (select count(*) from public.project_rows where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and lower(btrim(coalesce(values->>'studentName', ''))) = 'dan') <> 17
    or (select count(*) from public.project_rows where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and lower(btrim(coalesce(values->>'studentName', ''))) = 'dan rosenthal') <> 18
  then raise exception 'Protected Alex Ma / Dan identity guard failed';
  end if;
end $$;

-- Store immutable seed claims on the four completed accounts.
update public.project_rows account
set values = account.values || jsonb_build_object('preregisteredName', repair.preregistered_name)
from (select distinct real_account_id, preregistered_name from verified_duplicate_repairs) repair
where account.id = repair.real_account_id
  and account.project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;

-- The one separately verified stale Kyson row is the only formerly ambiguous reference repaired here.
update public.project_rows
set values = values || jsonb_build_object(
  'studentAccountId', 'bdaac62c-8f13-4426-bca1-fc8ac7d2a7f9',
  'studentName', 'Kyson Duan',
  'familyName', 'Kyson Duan'
)
where id = '7b5a9331-2cce-44d2-947d-a63878328305'::uuid
  and project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid
  and lower(btrim(coalesce(values->>'studentName', ''))) = 'kyson'
  and coalesce(values->>'studentAccountId', '') = '';

-- Remove exactly the five reviewed blank accounts and no others.
delete from public.project_rows target
using verified_duplicate_repairs repair
where target.id = repair.duplicate_account_id
  and target.project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;

do $$
declare
  linked_count integer;
begin
  if (select count(*) from public.project_rows where project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid) <> 65
    or (select count(*) from public.project_rows where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid) <> 1882
    or (select count(*) from public.project_rows where project_table_id = '47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid) <> 0
    or (select count(*) from public.project_rows where project_table_id = '133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid) <> 33
  then raise exception 'Verified duplicate repair post-count guard failed';
  end if;

  if exists (
    select 1 from protected_identity_snapshot snapshot
    join public.project_rows target on target.id = snapshot.id
    where target.values is distinct from snapshot.values
  ) then raise exception 'Protected Alex Ma / Dan records changed';
  end if;

  if exists (
    select 1 from verified_duplicate_repairs repair
    join public.project_rows target on target.id = repair.duplicate_account_id
  ) then raise exception 'A verified duplicate account was not removed';
  end if;

  if not exists (
    select 1 from public.project_rows
    where id = '7b5a9331-2cce-44d2-947d-a63878328305'::uuid
      and values->>'studentAccountId' = 'bdaac62c-8f13-4426-bca1-fc8ac7d2a7f9'
      and values->>'studentName' = 'Kyson Duan'
  ) then raise exception 'Stale Kyson booking repair failed';
  end if;

  select count(*) into linked_count
  from public.project_rows
  where project_table_id in ('a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid, '47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid)
    and coalesce(values->>'studentAccountId', '') <> '';
  if linked_count <> 1633 then raise exception 'Expected 1633 linked references after repair, found %', linked_count; end if;
end $$;

commit;
