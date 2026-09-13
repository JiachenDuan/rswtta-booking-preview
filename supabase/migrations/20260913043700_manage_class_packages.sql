-- Category-aware Club package keys and append-only event ledger.
-- Production baseline audited 2026-09-12. This script performs no historical booking inference.
-- Client-page MD5 evidence (500-row pages, exact audit representation):
-- accounts: 889ef52e232d48fec0a2da04bf33992a
-- bookings: cb9afd75e44d3e82472df227e20906b4, 39d959e808832d51416426eb12e4a92f,
--           0b91e1fc9c8c0eaf07843eaf688af463, b7481b76c02d0031443cf41335b17e5b
-- bills: empty; activity: c4e86cb519690b3fc148265ac0d80a73

begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:manage-class-packages:migration', 0));

create extension if not exists pgcrypto;

do $$
declare
  v_project_id uuid;
  v_accounts_table_id uuid;
  v_bookings_table_id uuid;
  v_bills_table_id uuid;
  v_activity_table_id uuid;
  v_count bigint;
  v_duplicate_ella_ids uuid[];
begin
  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  if v_project_id <> 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid then
    raise exception 'Manage-packages guard failed: project ID changed';
  end if;

  select id into strict v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  if v_accounts_table_id <> '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid then
    raise exception 'Manage-packages guard failed: account table ID changed';
  end if;
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';
  select id into strict v_bills_table_id from public.project_tables where project_id = v_project_id and slug = 'bill_notifications';
  select id into strict v_activity_table_id from public.project_tables where project_id = v_project_id and slug = 'activity_logs';

  select count(*) into v_count from public.project_rows where project_table_id = v_accounts_table_id;
  if v_count <> 65 then raise exception 'Manage-packages guard failed: expected 65 accounts, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_bookings_table_id;
  if v_count <> 1978 then raise exception 'Manage-packages guard failed: expected 1978 bookings, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_bills_table_id;
  if v_count <> 0 then raise exception 'Manage-packages guard failed: expected 0 bills, found %', v_count; end if;
  select count(*) into v_count from public.project_rows where project_table_id = v_activity_table_id;
  if v_count <> 65 then raise exception 'Manage-packages guard failed: expected 65 activity rows, found %', v_count; end if;

  select array_agg(id order by id) into v_duplicate_ella_ids
  from public.project_rows
  where project_table_id = v_accounts_table_id and lower(trim(values->>'studentName')) = 'ella';
  if v_duplicate_ella_ids is distinct from array[
    '3a6d38c0-a343-42fe-b373-e1649928041d'::uuid,
    'b8433b38-75f0-4e37-8792-3b952d26c74d'::uuid
  ] then raise exception 'Manage-packages guard failed: duplicate Ella identity set changed'; end if;

  if to_regclass('public.class_package_hours_ledger') is null then
    raise exception 'Manage-packages guard failed: deployed legacy ledger is absent';
  end if;
  execute 'select count(*) from public.class_package_hours_ledger' into v_count;
  if v_count <> 0 then
    raise exception 'Manage-packages guard failed: expected zero legacy package rows, found %; stop rather than infer a category', v_count;
  end if;

  if to_regprocedure('public.add_class_package_hours(uuid,integer,text,text,uuid)') is null
     or to_regprocedure('public.list_class_package_balances()') is null then
    raise exception 'Manage-packages guard failed: deployed legacy RPC signatures changed';
  end if;
end;
$$;

create table if not exists public.class_package_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  student_account_id uuid not null references public.project_rows(id) on delete restrict,
  category text not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint class_package_keys_category check (category in ('coach_director', 'national_coach', 'group_class')),
  constraint class_package_keys_id_project unique (id, project_id),
  constraint class_package_keys_account_category unique (project_id, student_account_id, category)
);

create table if not exists public.class_package_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null,
  project_id uuid not null references public.projects(id) on delete restrict,
  constraint class_package_events_key_project foreign key (package_id, project_id)
    references public.class_package_keys(id, project_id) on delete restrict,
  event_type text not null,
  amount_minutes integer not null,
  old_opening_minutes integer,
  new_opening_minutes integer,
  version bigint not null,
  expected_version bigint,
  note text not null default '',
  reference text not null default '',
  actor_kind text not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint class_package_events_type check (event_type in ('opening_set', 'adjustment', 'usage')),
  constraint class_package_events_increment check (amount_minutes % 30 = 0),
  constraint class_package_events_shape check (
    (event_type = 'opening_set' and old_opening_minutes is not null and old_opening_minutes >= 0
      and new_opening_minutes is not null and new_opening_minutes between 0 and 30000
      and amount_minutes = new_opening_minutes - old_opening_minutes and expected_version = version - 1)
    or (event_type = 'adjustment' and amount_minutes <> 0 and old_opening_minutes is null
      and new_opening_minutes is null and expected_version is null)
    or (event_type = 'usage' and amount_minutes < 0 and old_opening_minutes is null
      and new_opening_minutes is null and expected_version is null)
  ),
  constraint class_package_events_version_positive check (version > 0),
  constraint class_package_events_actor check (actor_kind in ('legacy_club_session_unverified', 'service_role')),
  constraint class_package_events_note_length check (char_length(note) <= 500),
  constraint class_package_events_reference_length check (char_length(reference) <= 120),
  constraint class_package_events_package_version unique (package_id, version),
  constraint class_package_events_idempotency unique (project_id, idempotency_key)
);

comment on table public.class_package_keys is 'One immutable key per exact student account and explicit package category.';
comment on table public.class_package_events is 'Append-only package events. Opening edits store old and new values; usage must be explicit and is never inferred from bookings.';

create index if not exists class_package_events_package_created_idx on public.class_package_events(package_id, created_at desc, id desc);
alter table public.class_package_keys enable row level security;
alter table public.class_package_events enable row level security;
revoke all on public.class_package_keys, public.class_package_events from public, anon, authenticated;
grant select, insert on public.class_package_keys, public.class_package_events to service_role;

drop policy if exists class_package_keys_public on public.class_package_keys;
drop policy if exists class_package_events_public on public.class_package_events;

create or replace function public.reject_class_package_v2_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'Class-package keys and events are immutable'; end;
$$;

drop trigger if exists class_package_keys_immutable on public.class_package_keys;
create trigger class_package_keys_immutable before update or delete on public.class_package_keys
for each row execute function public.reject_class_package_v2_mutation();
drop trigger if exists class_package_events_immutable on public.class_package_events;
create trigger class_package_events_immutable before update or delete on public.class_package_events
for each row execute function public.reject_class_package_v2_mutation();
revoke all on function public.reject_class_package_v2_mutation() from public, anon, authenticated;

create or replace function public.list_class_package_balances_v2()
returns table (
  package_id uuid, student_account_id uuid, category text, opening_minutes bigint,
  adjustment_minutes bigint, usage_minutes bigint, remaining_minutes bigint,
  version bigint, last_event_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with categories(category) as (values ('coach_director'::text), ('national_coach'), ('group_class')),
  totals as (
    select e.package_id,
      coalesce(sum(e.amount_minutes) filter (where e.event_type = 'opening_set'), 0)::bigint as opening_minutes,
      coalesce(sum(e.amount_minutes) filter (where e.event_type = 'adjustment'), 0)::bigint as adjustment_minutes,
      coalesce(-sum(e.amount_minutes) filter (where e.event_type = 'usage'), 0)::bigint as usage_minutes,
      coalesce(sum(e.amount_minutes), 0)::bigint as remaining_minutes,
      coalesce(max(e.version), 0)::bigint as version,
      max(e.created_at) as last_event_at
    from public.class_package_events e group by e.package_id
  )
  select k.id, account.id, c.category,
    coalesce(t.opening_minutes, 0), coalesce(t.adjustment_minutes, 0), coalesce(t.usage_minutes, 0),
    coalesce(t.remaining_minutes, 0), coalesce(t.version, 0), t.last_event_at
  from public.project_rows account cross join categories c
  left join public.class_package_keys k
    on k.project_id = 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
   and k.student_account_id = account.id and k.category = c.category
  left join totals t on t.package_id = k.id
  where account.project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
  order by account.id, c.category
$$;

create or replace function public.list_class_package_history(p_student_account_id uuid, p_category text)
returns table (
  event_id uuid, package_id uuid, student_account_id uuid, category text, event_type text,
  amount_minutes integer, old_opening_minutes integer, new_opening_minutes integer,
  version bigint, note text, reference text, actor_kind text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_category is null or p_category not in ('coach_director', 'national_coach', 'group_class') then
    raise exception 'invalid package category';
  end if;
  if not exists (select 1 from public.project_rows where id = p_student_account_id
    and project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid) then
    raise exception 'student account does not belong to rswtta-booking';
  end if;
  return query
    select e.id, k.id, k.student_account_id, k.category, e.event_type, e.amount_minutes,
      e.old_opening_minutes, e.new_opening_minutes, e.version, e.note, e.reference, e.actor_kind, e.created_at
    from public.class_package_keys k join public.class_package_events e on e.package_id = k.id
    where k.project_id = 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
      and k.student_account_id = p_student_account_id and k.category = p_category
    order by e.version desc;
end;
$$;

create or replace function public.set_class_package_opening(
  p_student_account_id uuid,
  p_category text,
  p_new_opening_minutes integer,
  p_expected_opening_minutes integer,
  p_expected_version bigint,
  p_note text,
  p_reference text,
  p_idempotency_key uuid
) returns table (
  event_id uuid, package_id uuid, student_account_id uuid, category text,
  old_opening_minutes bigint, new_opening_minutes bigint,
  old_remaining_minutes bigint, new_remaining_minutes bigint,
  old_version bigint, new_version bigint, created_at timestamptz, replayed boolean
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project_id constant uuid := 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid;
  v_accounts_table_id constant uuid := '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  v_package public.class_package_keys;
  v_existing public.class_package_events;
  v_event public.class_package_events;
  v_opening bigint;
  v_remaining bigint;
  v_version bigint;
begin
  if p_student_account_id is null then raise exception 'student account ID is required'; end if;
  if p_category is null or p_category not in ('coach_director', 'national_coach', 'group_class') then raise exception 'invalid package category'; end if;
  if p_new_opening_minutes is null or p_new_opening_minutes < 0 or p_new_opening_minutes > 30000 or p_new_opening_minutes % 30 <> 0 then raise exception 'opening hours must be 0-500 in 30-minute increments'; end if;
  if p_expected_opening_minutes is null or p_expected_opening_minutes < 0 or p_expected_opening_minutes > 30000 or p_expected_opening_minutes % 30 <> 0 then raise exception 'expected opening is invalid'; end if;
  if p_expected_version is null or p_expected_version < 0 then raise exception 'expected version is invalid'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key is required'; end if;
  if char_length(coalesce(p_note, '')) > 500 or char_length(coalesce(p_reference, '')) > 120 then raise exception 'note/reference too long'; end if;
  if not exists (select 1 from public.project_rows where id = p_student_account_id and project_table_id = v_accounts_table_id) then raise exception 'student account does not belong to rswtta-booking'; end if;

  perform pg_advisory_xact_lock(hashtextextended('rswtta:package:v2:idempotency:' || p_idempotency_key::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('rswtta:package:v2:account-category:' || p_student_account_id::text || ':' || p_category, 0));

  select e.* into v_existing from public.class_package_events e
  where e.project_id = v_project_id and e.idempotency_key = p_idempotency_key;
  if found then
    select * into strict v_package from public.class_package_keys where id = v_existing.package_id;
    if v_package.student_account_id <> p_student_account_id or v_package.category <> p_category
      or v_existing.event_type <> 'opening_set' or v_existing.new_opening_minutes <> p_new_opening_minutes
      or v_existing.old_opening_minutes <> p_expected_opening_minutes or v_existing.expected_version <> p_expected_version
      or v_existing.note <> coalesce(p_note, '') or v_existing.reference <> coalesce(p_reference, '') then
      raise exception 'idempotency key was already used with different input';
    end if;
    select coalesce(sum(amount_minutes), 0) - v_existing.amount_minutes into v_remaining
      from public.class_package_events where package_id = v_package.id and version <= v_existing.version;
    return query select v_existing.id, v_package.id, v_package.student_account_id, v_package.category,
      v_existing.old_opening_minutes::bigint, v_existing.new_opening_minutes::bigint,
      v_remaining, v_remaining + v_existing.amount_minutes, v_existing.version - 1, v_existing.version,
      v_existing.created_at, true;
    return;
  end if;

  insert into public.class_package_keys(project_id, student_account_id, category)
  values (v_project_id, p_student_account_id, p_category)
  on conflict (project_id, student_account_id, category) do nothing;
  select * into strict v_package from public.class_package_keys
    where project_id = v_project_id and student_account_id = p_student_account_id and category = p_category;

  select coalesce(sum(amount_minutes) filter (where event_type = 'opening_set'), 0),
    coalesce(sum(amount_minutes), 0), coalesce(max(version), 0)
  into v_opening, v_remaining, v_version from public.class_package_events where package_id = v_package.id;
  if v_opening <> p_expected_opening_minutes or v_version <> p_expected_version then
    raise exception 'stale package opening: expected opening/version %/%, current %/%', p_expected_opening_minutes, p_expected_version, v_opening, v_version;
  end if;

  insert into public.class_package_events(package_id, project_id, event_type, amount_minutes,
    old_opening_minutes, new_opening_minutes, version, expected_version, note, reference, actor_kind, idempotency_key)
  values (v_package.id, v_project_id, 'opening_set', p_new_opening_minutes - v_opening,
    v_opening, p_new_opening_minutes, v_version + 1, v_version, coalesce(p_note, ''), coalesce(p_reference, ''),
    'legacy_club_session_unverified', p_idempotency_key)
  returning * into v_event;

  return query select v_event.id, v_package.id, v_package.student_account_id, v_package.category,
    v_opening, p_new_opening_minutes::bigint, v_remaining,
    v_remaining + v_event.amount_minutes, v_version, v_event.version, v_event.created_at, false;
end;
$$;

-- Disable the old undifferentiated surface without deleting its empty, audited table.
revoke execute on function public.list_class_package_balances() from anon, authenticated;
revoke execute on function public.add_class_package_hours(uuid, integer, text, text, uuid) from anon, authenticated;
revoke all on function public.list_class_package_balances_v2() from public;
revoke all on function public.list_class_package_history(uuid, text) from public;
revoke all on function public.set_class_package_opening(uuid, text, integer, integer, bigint, text, text, uuid) from public;
grant execute on function public.list_class_package_balances_v2() to anon, authenticated;
grant execute on function public.list_class_package_history(uuid, text) to anon, authenticated;
grant execute on function public.set_class_package_opening(uuid, text, integer, integer, bigint, text, text, uuid) to anon, authenticated;

-- SECURITY DEFINER ownership must remain postgres; stop if the execution context differs.
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname in ('list_class_package_balances_v2', 'list_class_package_history', 'set_class_package_opening')
    and r.rolname <> 'postgres';
  if v_bad <> 0 then raise exception 'Manage-packages guard failed: SECURITY DEFINER owner is not postgres'; end if;
end;
$$;

commit;
