-- Category/unit-aware Club package keys, append-only ledger, and pure consumption resolver.
-- Production audit 2026-09-12: 1,978 bookings; no immutable coach ID fields are currently populated.
-- This migration performs no historical inference and never debits a package.
-- Client-page MD5 evidence (500-row pages):
-- accounts: 889ef52e232d48fec0a2da04bf33992a
-- bookings: cb9afd75e44d3e82472df227e20906b4, 39d959e808832d51416426eb12e4a92f,
--           0b91e1fc9c8c0eaf07843eaf688af463, b7481b76c02d0031443cf41335b17e5b
-- bills: empty; activity: c4e86cb519690b3fc148265ac0d80a73

begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:manage-class-packages:migration', 0));
create extension if not exists pgcrypto;

do $$
declare
  v_project_id uuid; v_accounts_table_id uuid; v_bookings_table_id uuid;
  v_bills_table_id uuid; v_activity_table_id uuid; v_count bigint; v_duplicate_ella_ids uuid[];
begin
  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  if v_project_id <> 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid then raise exception 'Manage-packages guard failed: project ID changed'; end if;
  select id into strict v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  if v_accounts_table_id <> '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid then raise exception 'Manage-packages guard failed: account table ID changed'; end if;
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
  select array_agg(id order by id) into v_duplicate_ella_ids from public.project_rows
    where project_table_id = v_accounts_table_id and lower(trim(values->>'studentName')) = 'ella';
  if v_duplicate_ella_ids is distinct from array['3a6d38c0-a343-42fe-b373-e1649928041d'::uuid,'b8433b38-75f0-4e37-8792-3b952d26c74d'::uuid]
    then raise exception 'Manage-packages guard failed: duplicate Ella identity set changed'; end if;
  if to_regclass('public.class_package_hours_ledger') is null then raise exception 'Manage-packages guard failed: deployed legacy ledger is absent'; end if;
  execute 'select count(*) from public.class_package_hours_ledger' into v_count;
  if v_count <> 0 then raise exception 'Manage-packages guard failed: expected zero legacy package rows, found %; stop rather than infer a category', v_count; end if;
  if to_regprocedure('public.add_class_package_hours(uuid,integer,text,text,uuid)') is null or to_regprocedure('public.list_class_package_balances()') is null
    then raise exception 'Manage-packages guard failed: deployed legacy RPC signatures changed'; end if;
end; $$;

create table public.class_package_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  student_account_id uuid not null references public.project_rows(id) on delete restrict,
  category text not null,
  unit_basis text not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint class_package_keys_category_unit check (
    (category in ('coach_director_private','national_coach_private') and unit_basis = 'hours') or
    (category = 'group_class' and unit_basis = 'class_credit')
  ),
  constraint class_package_keys_identity unique (id, project_id, category, unit_basis),
  constraint class_package_keys_account_category unique (project_id, student_account_id, category)
);

create table public.class_package_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null,
  project_id uuid not null references public.projects(id) on delete restrict,
  category text not null,
  unit_basis text not null,
  constraint class_package_events_key_identity foreign key (package_id, project_id, category, unit_basis)
    references public.class_package_keys(id, project_id, category, unit_basis) on delete restrict,
  event_type text not null check (event_type in ('opening_set','adjustment','usage')),
  amount_base_units integer not null,
  old_opening_amount_base_units integer,
  new_opening_amount_base_units integer,
  version bigint not null check (version > 0),
  expected_version bigint,
  note text not null default '' check (char_length(note) <= 500),
  reference text not null default '' check (char_length(reference) <= 120),
  actor_kind text not null check (actor_kind in ('legacy_club_session_unverified','service_role')),
  idempotency_key uuid not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint class_package_events_unit_increment check (unit_basis = 'class_credit' or amount_base_units % 30 = 0),
  constraint class_package_events_shape check (
    (event_type = 'opening_set' and old_opening_amount_base_units is not null and old_opening_amount_base_units >= 0
      and new_opening_amount_base_units is not null and new_opening_amount_base_units >= 0
      and ((unit_basis = 'hours' and new_opening_amount_base_units <= 30000 and new_opening_amount_base_units % 30 = 0)
        or (unit_basis = 'class_credit' and new_opening_amount_base_units <= 10000))
      and amount_base_units = new_opening_amount_base_units - old_opening_amount_base_units and expected_version = version - 1)
    or (event_type = 'adjustment' and amount_base_units <> 0 and old_opening_amount_base_units is null and new_opening_amount_base_units is null and expected_version is null)
    or (event_type = 'usage' and amount_base_units < 0 and old_opening_amount_base_units is null and new_opening_amount_base_units is null and expected_version is null)
  ),
  constraint class_package_events_package_version unique (package_id, version),
  constraint class_package_events_idempotency unique (project_id, idempotency_key)
);
comment on table public.class_package_keys is 'One immutable key per exact student account, canonical category, and enforced unit basis.';
comment on table public.class_package_events is 'Append-only base-unit events: minutes for hours, one integer credit per group occurrence. No automatic debit exists.';
create index class_package_events_package_created_idx on public.class_package_events(package_id, created_at desc, id desc);
alter table public.class_package_keys enable row level security;
alter table public.class_package_events enable row level security;
revoke all on public.class_package_keys, public.class_package_events from public, anon, authenticated;
grant select, insert on public.class_package_keys, public.class_package_events to service_role;

create or replace function public.reject_class_package_v2_mutation() returns trigger
language plpgsql set search_path = public, pg_temp as $$ begin raise exception 'Class-package keys and events are immutable'; end; $$;
create trigger class_package_keys_immutable before update or delete on public.class_package_keys for each row execute function public.reject_class_package_v2_mutation();
create trigger class_package_events_immutable before update or delete on public.class_package_events for each row execute function public.reject_class_package_v2_mutation();
revoke all on function public.reject_class_package_v2_mutation() from public, anon, authenticated;

-- Authoritative pure resolver. It returns classification/eligibility only and has no ledger access or writes.
create or replace function public.resolve_class_package_consumption(p_booking jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_program text := lower(regexp_replace(trim(coalesce(p_booking->>'program','')), '\s+', ' ', 'g'));
  v_group_id text := nullif(trim(coalesce(p_booking->>'groupClassId','')), '');
  v_occurrence_id text := coalesce(nullif(trim(coalesce(p_booking->>'recurrenceOccurrenceId','')), ''), v_group_id, nullif(trim(coalesce(p_booking->>'id','')), ''));
  v_status text := coalesce(p_booking->>'status','');
  v_eligible boolean := v_status = 'coach_confirmed';
  v_coach_id text := coalesce(nullif(trim(coalesce(p_booking->>'assignedCoachId','')), ''), nullif(trim(coalesce(p_booking->>'coachId','')), ''), nullif(trim(coalesce(p_booking->>'requestedCoachId','')), ''));
  v_coach_name text := coalesce(nullif(trim(coalesce(p_booking->>'assignedCoach','')), ''), nullif(trim(coalesce(p_booking->>'requestedCoach','')), ''));
  v_alias text;
  v_label text := trim(coalesce(p_booking->>'timeLabel',''));
  v_parts text[];
  v_start_hour integer;
  v_start_minute integer;
  v_end_hour integer;
  v_end_minute integer;
  v_start_clock_minutes integer;
  v_end_clock_minutes integer;
  v_duration_minutes integer;
  v_hours numeric;
  v_category text;
begin
  -- Immutable group identity and explicit programs win before any coach logic. “Group lesson” alone is intentionally private.
  if v_group_id is not null or v_program in ('group class','group enrollment') then
    return jsonb_build_object('eligible',v_eligible,'reason',case when v_eligible then 'eligible' else 'ineligible_status' end,
      'category','group_class','unit_basis','class_credit','consumption_amount',1,'amount_base_units',1,'stable_occurrence_id',v_occurrence_id);
  end if;
  if nullif(trim(coalesce(p_booking->>'startsAt','')), '') is null then
    return jsonb_build_object('eligible',false,'reason','missing_starts_at','category',null,'unit_basis',null,'consumption_amount',0,'amount_base_units',0,'stable_occurrence_id',v_occurrence_id);
  end if;
  begin perform (p_booking->>'startsAt')::timestamptz; exception when others then
    return jsonb_build_object('eligible',false,'reason','missing_starts_at','category',null,'unit_basis',null,'consumption_amount',0,'amount_base_units',0,'stable_occurrence_id',v_occurrence_id);
  end;
  if v_coach_id is null and v_coach_name is null then
    return jsonb_build_object('eligible',false,'reason','missing_coach','category',null,'unit_basis',null,'consumption_amount',0,'amount_base_units',0,'stable_occurrence_id',v_occurrence_id);
  end if;
  -- Live bookings store a 12-hour clock range such as “3:30 PM - 4:30 PM”.
  -- Reject malformed, zero-length, and overnight-like ranges rather than inventing a duration.
  v_parts := regexp_match(v_label, '^\s*([0-9]{1,2})(?::([0-9]{2}))?\s*(AM|PM)\s*-\s*([0-9]{1,2})(?::([0-9]{2}))?\s*(AM|PM)\s*$', 'i');
  if v_parts is null then
    return jsonb_build_object('eligible',false,'reason','invalid_duration','category',null,'unit_basis',null,'consumption_amount',0,'amount_base_units',0,'stable_occurrence_id',v_occurrence_id);
  end if;
  v_start_hour := v_parts[1]::integer; v_start_minute := coalesce(v_parts[2]::integer, 0);
  v_end_hour := v_parts[4]::integer; v_end_minute := coalesce(v_parts[5]::integer, 0);
  if v_start_hour not between 1 and 12 or v_end_hour not between 1 and 12
     or v_start_minute not between 0 and 59 or v_end_minute not between 0 and 59 then
    return jsonb_build_object('eligible',false,'reason','invalid_duration','category',null,'unit_basis',null,'consumption_amount',0,'amount_base_units',0,'stable_occurrence_id',v_occurrence_id);
  end if;
  v_start_clock_minutes := (v_start_hour % 12) * 60 + v_start_minute + case when upper(v_parts[3]) = 'PM' then 720 else 0 end;
  v_end_clock_minutes := (v_end_hour % 12) * 60 + v_end_minute + case when upper(v_parts[6]) = 'PM' then 720 else 0 end;
  v_duration_minutes := v_end_clock_minutes - v_start_clock_minutes;
  if v_duration_minutes <= 0 then
    return jsonb_build_object('eligible',false,'reason','invalid_duration','category',null,'unit_basis',null,'consumption_amount',0,'amount_base_units',0,'stable_occurrence_id',v_occurrence_id);
  end if;
  v_hours := v_duration_minutes::numeric / 60;
  if v_coach_id is not null then
    v_category := case when v_coach_id = 'coach_tian_ye' then 'coach_director_private' else 'national_coach_private' end;
  else
    v_alias := regexp_replace(lower(v_coach_name), '[^a-z0-9]+', '', 'g');
    v_category := case when v_alias in ('coachtianye','tianye','coachtian','headcoachtian') then 'coach_director_private' else 'national_coach_private' end;
  end if;
  return jsonb_build_object('eligible',v_eligible,'reason',case when v_eligible then 'eligible' else 'ineligible_status' end,
    'category',v_category,'unit_basis','hours','consumption_amount',v_hours,'amount_base_units',v_duration_minutes,'stable_occurrence_id',v_occurrence_id);
end; $$;
comment on function public.resolve_class_package_consumption(jsonb) is 'Authoritative immutable classification contract. Uses current startsAt/timeLabel and stable occurrence identity; never debits.';
revoke all on function public.resolve_class_package_consumption(jsonb) from public, anon, authenticated;
grant execute on function public.resolve_class_package_consumption(jsonb) to service_role;

create or replace function public.list_class_package_balances_v2()
returns table (package_id uuid, student_account_id uuid, category text, unit_basis text, opening_amount_base_units bigint,
  adjustment_amount_base_units bigint, usage_amount_base_units bigint, remaining_amount_base_units bigint, version bigint, last_event_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with categories(category,unit_basis) as (values ('coach_director_private'::text,'hours'::text),('national_coach_private','hours'),('group_class','class_credit')),
  totals as (select e.package_id,
    coalesce(sum(e.amount_base_units) filter (where e.event_type='opening_set'),0)::bigint opening_amount_base_units,
    coalesce(sum(e.amount_base_units) filter (where e.event_type='adjustment'),0)::bigint adjustment_amount_base_units,
    coalesce(-sum(e.amount_base_units) filter (where e.event_type='usage'),0)::bigint usage_amount_base_units,
    coalesce(sum(e.amount_base_units),0)::bigint remaining_amount_base_units, coalesce(max(e.version),0)::bigint version, max(e.created_at) last_event_at
    from public.class_package_events e group by e.package_id)
  select k.id, account.id, c.category, c.unit_basis, coalesce(t.opening_amount_base_units,0), coalesce(t.adjustment_amount_base_units,0),
    coalesce(t.usage_amount_base_units,0), coalesce(t.remaining_amount_base_units,0), coalesce(t.version,0), t.last_event_at
  from public.project_rows account cross join categories c left join public.class_package_keys k
    on k.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and k.student_account_id=account.id and k.category=c.category and k.unit_basis=c.unit_basis
  left join totals t on t.package_id=k.id where account.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid order by account.id,c.category $$;

create or replace function public.list_class_package_history(p_student_account_id uuid,p_category text)
returns table (event_id uuid,package_id uuid,student_account_id uuid,category text,unit_basis text,event_type text,amount_base_units integer,
 old_opening_amount_base_units integer,new_opening_amount_base_units integer,version bigint,note text,reference text,actor_kind text,created_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_category not in ('coach_director_private','national_coach_private','group_class') or p_category is null then raise exception 'invalid package category'; end if;
 if not exists(select 1 from public.project_rows where id=p_student_account_id and project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid) then raise exception 'student account does not belong to rswtta-booking'; end if;
 return query select e.id,k.id,k.student_account_id,k.category,k.unit_basis,e.event_type,e.amount_base_units,e.old_opening_amount_base_units,e.new_opening_amount_base_units,e.version,e.note,e.reference,e.actor_kind,e.created_at
 from public.class_package_keys k join public.class_package_events e on e.package_id=k.id where k.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and k.student_account_id=p_student_account_id and k.category=p_category order by e.version desc;
end; $$;

create or replace function public.set_class_package_opening(p_student_account_id uuid,p_category text,p_unit_basis text,p_new_opening_amount_base_units integer,
 p_expected_opening_amount_base_units integer,p_expected_version bigint,p_note text,p_reference text,p_idempotency_key uuid)
returns table(event_id uuid,package_id uuid,student_account_id uuid,category text,unit_basis text,old_opening_amount_base_units bigint,new_opening_amount_base_units bigint,
 old_remaining_amount_base_units bigint,new_remaining_amount_base_units bigint,old_version bigint,new_version bigint,created_at timestamptz,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_project constant uuid:='ab9d8da3-762f-466c-b7ce-fa05088f03cd'; v_accounts constant uuid:='8236c8f8-0fab-400c-bedc-143fd5930707';
 v_package public.class_package_keys; v_existing public.class_package_events; v_event public.class_package_events; v_opening bigint; v_remaining bigint; v_version bigint; v_expected_basis text;
begin
 v_expected_basis:=case when p_category in ('coach_director_private','national_coach_private') then 'hours' when p_category='group_class' then 'class_credit' end;
 if v_expected_basis is null or p_unit_basis is distinct from v_expected_basis then raise exception 'category/unit basis mismatch'; end if;
 if p_student_account_id is null or p_idempotency_key is null then raise exception 'account and idempotency key are required'; end if;
 if p_new_opening_amount_base_units is null or p_new_opening_amount_base_units<0 or (p_unit_basis='hours' and (p_new_opening_amount_base_units>30000 or p_new_opening_amount_base_units%30<>0)) or (p_unit_basis='class_credit' and p_new_opening_amount_base_units>10000) then raise exception 'invalid opening amount for unit basis'; end if;
 if p_expected_opening_amount_base_units is null or p_expected_opening_amount_base_units<0 or p_expected_version is null or p_expected_version<0 then raise exception 'invalid expected opening/version'; end if;
 if char_length(coalesce(p_note,''))>500 or char_length(coalesce(p_reference,''))>120 then raise exception 'note/reference too long'; end if;
 if not exists(select 1 from public.project_rows where id=p_student_account_id and project_table_id=v_accounts) then raise exception 'student account does not belong to rswtta-booking'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rswtta:package:v2:idempotency:'||p_idempotency_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('rswtta:package:v2:account-category:'||p_student_account_id::text||':'||p_category,0));
 select * into v_existing from public.class_package_events where project_id=v_project and idempotency_key=p_idempotency_key;
 if found then
  select * into strict v_package from public.class_package_keys where id=v_existing.package_id;
  if v_package.student_account_id<>p_student_account_id or v_package.category<>p_category or v_package.unit_basis<>p_unit_basis or v_existing.event_type<>'opening_set' or v_existing.new_opening_amount_base_units<>p_new_opening_amount_base_units or v_existing.old_opening_amount_base_units<>p_expected_opening_amount_base_units or v_existing.expected_version<>p_expected_version or v_existing.note<>coalesce(p_note,'') or v_existing.reference<>coalesce(p_reference,'') then raise exception 'idempotency key was already used with different input'; end if;
  select coalesce(sum(e.amount_base_units),0)-v_existing.amount_base_units into v_remaining from public.class_package_events e where e.package_id=v_package.id and e.version<=v_existing.version;
  return query select v_existing.id,v_package.id,v_package.student_account_id,v_package.category,v_package.unit_basis,v_existing.old_opening_amount_base_units::bigint,v_existing.new_opening_amount_base_units::bigint,v_remaining,v_remaining+v_existing.amount_base_units,v_existing.version-1,v_existing.version,v_existing.created_at,true; return;
 end if;
 insert into public.class_package_keys(project_id,student_account_id,category,unit_basis) values(v_project,p_student_account_id,p_category,p_unit_basis) on conflict on constraint class_package_keys_account_category do nothing;
 select k.* into strict v_package from public.class_package_keys k where k.project_id=v_project and k.student_account_id=p_student_account_id and k.category=p_category;
 if v_package.unit_basis<>p_unit_basis then raise exception 'stored category/unit basis mismatch'; end if;
 select coalesce(sum(e.amount_base_units) filter(where e.event_type='opening_set'),0),coalesce(sum(e.amount_base_units),0),coalesce(max(e.version),0) into v_opening,v_remaining,v_version from public.class_package_events e where e.package_id=v_package.id;
 if v_opening<>p_expected_opening_amount_base_units or v_version<>p_expected_version then raise exception 'stale package opening: expected opening/version %/%, current %/%',p_expected_opening_amount_base_units,p_expected_version,v_opening,v_version; end if;
 insert into public.class_package_events(package_id,project_id,category,unit_basis,event_type,amount_base_units,old_opening_amount_base_units,new_opening_amount_base_units,version,expected_version,note,reference,actor_kind,idempotency_key)
 values(v_package.id,v_project,p_category,p_unit_basis,'opening_set',p_new_opening_amount_base_units-v_opening,v_opening,p_new_opening_amount_base_units,v_version+1,v_version,coalesce(p_note,''),coalesce(p_reference,''),'legacy_club_session_unverified',p_idempotency_key) returning * into v_event;
 return query select v_event.id,v_package.id,v_package.student_account_id,v_package.category,v_package.unit_basis,v_opening,p_new_opening_amount_base_units::bigint,v_remaining,v_remaining+v_event.amount_base_units,v_version,v_event.version,v_event.created_at,false;
end; $$;

revoke execute on function public.list_class_package_balances() from anon,authenticated;
revoke execute on function public.add_class_package_hours(uuid,integer,text,text,uuid) from anon,authenticated;
revoke all on function public.list_class_package_balances_v2() from public;
revoke all on function public.list_class_package_history(uuid,text) from public;
revoke all on function public.set_class_package_opening(uuid,text,text,integer,integer,bigint,text,text,uuid) from public;
grant execute on function public.list_class_package_balances_v2() to anon,authenticated;
grant execute on function public.list_class_package_history(uuid,text) to anon,authenticated;
grant execute on function public.set_class_package_opening(uuid,text,text,integer,integer,bigint,text,text,uuid) to anon,authenticated;

do $$ declare v_bad bigint; begin
 select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname in ('list_class_package_balances_v2','list_class_package_history','set_class_package_opening') and r.rolname<>'postgres';
 if v_bad<>0 then raise exception 'Manage-packages guard failed: SECURITY DEFINER owner is not postgres'; end if;
end; $$;
commit;
