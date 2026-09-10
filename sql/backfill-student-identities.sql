-- REVIEWED CONSERVATIVE ONE-TIME BACKFILL.
-- Apply after the general rename migration and BEFORE duplicate-account repairs so the
-- verified 1,632 resolved / 84 ambiguous / 1 unmatched partition cannot drift.
-- Historical activity_logs and non-student system calendar rows are intentionally excluded.
begin;

create temp table identity_accounts on commit drop as
select
  r.id as account_id,
  r.values,
  lower(regexp_replace(btrim(coalesce(r.values->>'studentName', '')), '\s+', ' ', 'g')) as current_name,
  lower(regexp_replace(btrim(coalesce(r.values->>'preregisteredName', '')), '\s+', ' ', 'g')) as claimed_name,
  split_part(lower(regexp_replace(btrim(coalesce(r.values->>'studentName', '')), '\s+', ' ', 'g')), ' ', 1) as current_first_name,
  split_part(lower(regexp_replace(btrim(coalesce(r.values->>'preregisteredName', '')), '\s+', ' ', 'g')), ' ', 1) as claimed_first_name,
  lower(btrim(coalesce(r.values->>'email', ''))) as email,
  btrim(coalesce(r.values->>'phone', '')) as phone
from public.project_rows r
join public.project_tables t on t.id = r.project_table_id
join public.projects p on p.id = t.project_id
where p.slug = 'rswtta-booking' and t.slug = 'parent_accounts';

create temp table identity_references on commit drop as
select
  r.id as reference_id,
  t.slug as reference_table,
  r.values,
  lower(regexp_replace(btrim(coalesce(r.values->>'studentName', '')), '\s+', ' ', 'g')) as reference_name,
  lower(btrim(coalesce(r.values->>'studentEmail', ''))) as email,
  btrim(coalesce(r.values->>'phone', '')) as phone
from public.project_rows r
join public.project_tables t on t.id = r.project_table_id
join public.projects p on p.id = t.project_id
where p.slug = 'rswtta-booking'
  and t.slug in ('bookings', 'bill_notifications')
  and coalesce(r.values->>'studentAccountId', '') = ''
  and not (t.slug = 'bookings' and coalesce(r.values->>'program', '') in ('Unavailable', 'Group class'));

create temp table identity_candidates on commit drop as
select distinct
  ref.reference_id,
  ref.reference_table,
  account.account_id,
  concat_ws(',',
    case when ref.email <> '' and account.email = ref.email then 'email' end,
    case when ref.phone <> '' and account.phone = ref.phone then 'phone' end,
    case when position(' ' in ref.reference_name) > 0 and ref.reference_name in (account.current_name, account.claimed_name) then 'exact-name' end,
    case when position(' ' in ref.reference_name) = 0 and ref.reference_name in (account.current_first_name, account.claimed_first_name) then 'first-name' end
  ) as evidence
from identity_references ref
join identity_accounts account on
  (ref.email <> '' and account.email = ref.email)
  or (ref.phone <> '' and account.phone = ref.phone)
  or (
    position(' ' in ref.reference_name) > 0
    and ref.reference_name in (account.current_name, account.claimed_name)
  )
  or (
    position(' ' in ref.reference_name) = 0
    and ref.reference_name in (account.current_first_name, account.claimed_first_name)
  );

create temp table identity_resolution on commit drop as
select
  ref.reference_id,
  ref.reference_table,
  ref.values,
  count(distinct candidate.account_id) as candidate_count,
  min(candidate.account_id::text)::uuid as account_id,
  coalesce(string_agg(distinct candidate.evidence, ',' order by candidate.evidence), '') as evidence
from identity_references ref
left join identity_candidates candidate
  on candidate.reference_id = ref.reference_id and candidate.reference_table = ref.reference_table
group by ref.reference_id, ref.reference_table, ref.values;

create temp table identity_unresolved_snapshot on commit drop as
select resolution.reference_id, resolution.reference_table, target.values
from identity_resolution resolution
join public.project_rows target on target.id = resolution.reference_id
where resolution.candidate_count <> 1;

-- Freeze the reviewed backup partition and table baselines before any update.
do $$
declare
  v_accounts integer;
  v_bookings integer;
  v_bills integer;
  v_activity integer;
  v_resolved integer;
  v_ambiguous integer;
  v_unmatched integer;
begin
  select count(*) into v_accounts from public.project_rows where project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  select count(*) into v_bookings from public.project_rows where project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid;
  select count(*) into v_bills from public.project_rows where project_table_id = '47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid;
  select count(*) into v_activity from public.project_rows where project_table_id = '133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid;
  select count(*) into v_resolved from identity_resolution where candidate_count = 1;
  select count(*) into v_ambiguous from identity_resolution where candidate_count > 1;
  select count(*) into v_unmatched from identity_resolution where candidate_count = 0;

  if (v_accounts, v_bookings, v_bills, v_activity) <> (70, 1882, 0, 33) then
    raise exception 'Backfill baseline guard failed: accounts %, bookings %, bills %, activity %', v_accounts, v_bookings, v_bills, v_activity;
  end if;
  if (v_resolved, v_ambiguous, v_unmatched) <> (1632, 84, 1) then
    raise exception 'Backfill partition guard failed: resolved %, ambiguous %, unmatched %', v_resolved, v_ambiguous, v_unmatched;
  end if;
end $$;

select reference_table, candidate_count, count(*) as reference_count
from identity_resolution
group by reference_table, candidate_count
order by reference_table, candidate_count;

select
  resolution.reference_table,
  resolution.reference_id,
  resolution.values->>'studentName' as legacy_student_name,
  resolution.values->>'studentEmail' as legacy_email,
  resolution.values->>'phone' as legacy_phone,
  resolution.candidate_count,
  resolution.evidence,
  coalesce(
    (select jsonb_agg(jsonb_build_object('accountId', candidate.account_id, 'studentName', account.values->>'studentName', 'evidence', candidate.evidence) order by account.values->>'studentName')
     from identity_candidates candidate
     join identity_accounts account on account.account_id = candidate.account_id
     where candidate.reference_id = resolution.reference_id and candidate.reference_table = resolution.reference_table),
    '[]'::jsonb
  ) as candidates
from identity_resolution resolution
where resolution.candidate_count <> 1
order by resolution.reference_table, legacy_student_name, resolution.reference_id;

-- Existing links must never point outside the account table.
do $$
begin
  if exists (
    select 1
    from public.project_rows r
    join public.project_tables t on t.id = r.project_table_id
    join public.projects p on p.id = t.project_id
    where p.slug = 'rswtta-booking'
      and t.slug in ('bookings', 'bill_notifications')
      and coalesce(r.values->>'studentAccountId', '') <> ''
      and not exists (select 1 from identity_accounts a where a.account_id::text = r.values->>'studentAccountId')
  ) then
    raise exception 'Backfill aborted: an existing studentAccountId does not identify a current account';
  end if;
end $$;

update public.project_rows target
set values = target.values || jsonb_build_object(
  'studentAccountId', account.account_id::text,
  'studentName', account.values->>'studentName',
  'familyName', account.values->>'studentName',
  'studentEmail', coalesce(account.values->>'email', target.values->>'studentEmail', ''),
  'phone', coalesce(account.values->>'phone', target.values->>'phone', '')
)
from identity_resolution resolution
join identity_accounts account on account.account_id = resolution.account_id
where resolution.candidate_count = 1
  and resolution.reference_table = 'bookings'
  and target.id = resolution.reference_id;

update public.project_rows target
set values = target.values || jsonb_build_object(
  'studentAccountId', account.account_id::text,
  'studentName', account.values->>'studentName',
  'familyName', account.values->>'studentName',
  'message', account.values->>'studentName' || ': ' || coalesce(target.values->>'classCount', '0') || ' completed classes ready to bill'
)
from identity_resolution resolution
join identity_accounts account on account.account_id = resolution.account_id
where resolution.candidate_count = 1
  and resolution.reference_table = 'bill_notifications'
  and target.id = resolution.reference_id;

-- All 84 ambiguous and the one unmatched row must remain byte-for-byte unchanged.
do $$
declare
  v_linked integer;
begin
  if exists (
    select 1
    from identity_unresolved_snapshot snapshot
    join public.project_rows target on target.id = snapshot.reference_id
    where target.values is distinct from snapshot.values
  ) then
    raise exception 'Backfill aborted: an unresolved reference was modified';
  end if;
  select count(*) into v_linked
  from identity_resolution resolution
  join public.project_rows target on target.id = resolution.reference_id
  where resolution.candidate_count = 1
    and target.values->>'studentAccountId' = resolution.account_id::text;
  if v_linked <> 1632 then
    raise exception 'Backfill verification failed: expected 1632 linked rows, found %', v_linked;
  end if;
end $$;

commit;
