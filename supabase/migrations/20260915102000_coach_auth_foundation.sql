-- Phase 0 individual Coach authentication foundation.
-- Additive/backward-compatible: preserves display snapshots and existing Parent/Club contracts.
-- Coach UI remains server-disabled until the broad prototype project_rows policies are replaced.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:coach-auth-foundation:migration', 0));
create extension if not exists pgcrypto;
create schema if not exists rswtta_private;
revoke all on schema rswtta_private from public, anon, authenticated;

do $guard$
declare
  v_project_id uuid;
  v_bookings_table_id uuid;
  v_booking_count bigint;
  v_booking_hash text;
  v_identity_hash text;
  v_any_id_count bigint;
  v_unmapped_count bigint;
  v_different_count bigint;
begin
  select p.id into strict v_project_id from public.projects p where p.slug='rswtta-booking';
  if v_project_id <> 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid then raise exception 'Coach auth guard: project identity changed'; end if;
  select pt.id into strict v_bookings_table_id from public.project_tables pt where pt.project_id=v_project_id and pt.slug='bookings';
  if v_bookings_table_id <> 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid then raise exception 'Coach auth guard: bookings identity changed'; end if;
  select count(*),
    encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex'),
    encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'assignedCoach',r.values->>'assignedCoach','requestedCoach',r.values->>'requestedCoach','coachId',r.values->>'coachId','assignedCoachId',r.values->>'assignedCoachId','requestedCoachId',r.values->>'requestedCoachId')::text,E'\n' order by r.id),''),'sha256'),'hex'),
    count(*) filter(where nullif(r.values->>'coachId','') is not null or nullif(r.values->>'assignedCoachId','') is not null or nullif(r.values->>'requestedCoachId','') is not null)
  into v_booking_count,v_booking_hash,v_identity_hash,v_any_id_count
  from public.project_rows r where r.project_table_id=v_bookings_table_id;
  if v_booking_count <> 2046 then raise exception 'Coach auth guard: expected 2046 bookings, found %',v_booking_count; end if;
  if v_any_id_count=0 then
    if v_booking_hash <> '3f83ceecd49e9a27f78e853bee87ebf842755d26f5e6c30973e84784c0e8b878' then raise exception 'Coach auth guard: stale booking baseline %',v_booking_hash; end if;
    if v_identity_hash <> '197d7b50252b1ef811f3d68ee5a15dbf02f65a2c26a7cd564f3d5289b520b755' then raise exception 'Coach auth guard: coach identity source changed %',v_identity_hash; end if;
  elsif v_any_id_count<>v_booking_count then
    raise exception 'Coach auth guard: partial coach-ID backfill %/%',v_any_id_count,v_booking_count;
  end if;
  with normalized as (
    select regexp_replace(lower(btrim(coalesce(r.values->>'assignedCoach',''))),'[^a-z0-9]+','','g') assigned_alias,
      regexp_replace(lower(btrim(coalesce(r.values->>'requestedCoach',''))),'[^a-z0-9]+','','g') requested_alias
    from public.project_rows r where r.project_table_id=v_bookings_table_id
  )
  select count(*) filter(where assigned_alias not in ('coachtianye','tianye','coachtian','headcoachtian','coachjorden','jorden','coachwang','wang','nationala','debolina','coachdebolina','coacha','nationalb','diren','coachdiren','coachb')
      or requested_alias not in ('coachtianye','tianye','coachtian','headcoachtian','coachjorden','jorden','coachwang','wang','nationala','debolina','coachdebolina','coacha','nationalb','diren','coachdiren','coachb')),
    count(*) filter(where
      (case when assigned_alias in ('coachtianye','tianye','coachtian','headcoachtian') then 'coach_tian_ye' when assigned_alias in ('coachjorden','jorden','coachwang','wang') then 'coach_jorden' when assigned_alias in ('nationala','debolina','coachdebolina','coacha') then 'coach_debolina' else 'coach_diren' end)
      <>
      (case when requested_alias in ('coachtianye','tianye','coachtian','headcoachtian') then 'coach_tian_ye' when requested_alias in ('coachjorden','jorden','coachwang','wang') then 'coach_jorden' when requested_alias in ('nationala','debolina','coachdebolina','coacha') then 'coach_debolina' else 'coach_diren' end))
  into v_unmapped_count,v_different_count from normalized;
  if v_unmapped_count<>0 then raise exception 'Coach auth guard: unmapped aliases %',v_unmapped_count; end if;
  if v_different_count<>2 then raise exception 'Coach auth guard: expected two explicit assigned/requested transitions, found %',v_different_count; end if;
end $guard$;

create table if not exists rswtta_private.coach_auth_source_backup_20260915102000 (
  id uuid primary key,
  project_table_id uuid not null,
  values jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
alter table rswtta_private.coach_auth_source_backup_20260915102000 enable row level security;
revoke all on rswtta_private.coach_auth_source_backup_20260915102000 from public,anon,authenticated;
insert into rswtta_private.coach_auth_source_backup_20260915102000(id,project_table_id,values,created_at,updated_at)
select r.id,r.project_table_id,r.values,r.created_at,r.updated_at from public.project_rows r
where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid
on conflict(id) do nothing;
do $backup$
declare v_count bigint; v_hash text;
begin
 select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash
 from rswtta_private.coach_auth_source_backup_20260915102000 r;
 if v_count<>2046 or v_hash<>'3f83ceecd49e9a27f78e853bee87ebf842755d26f5e6c30973e84784c0e8b878' then raise exception 'Coach auth backup mismatch % %',v_count,v_hash; end if;
 if has_table_privilege('anon','rswtta_private.coach_auth_source_backup_20260915102000','select') or has_table_privilege('authenticated','rswtta_private.coach_auth_source_backup_20260915102000','select') then raise exception 'Coach auth backup browser access was not denied'; end if;
end $backup$;

create table if not exists public.coaches (
 coach_id text primary key check(coach_id ~ '^coach_[a-z0-9_]+$'),
 project_id uuid not null references public.projects(id) on delete restrict,
 display_name text not null check(length(btrim(display_name)) between 1 and 120),
 display_name_zh text not null default '' check(length(display_name_zh)<=120),
 created_at timestamptz not null default transaction_timestamp(),
 updated_at timestamptz not null default transaction_timestamp(),
 unique(project_id,coach_id)
);
create table if not exists public.project_coach_memberships (
 membership_id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete restrict,
 coach_id text not null references public.coaches(coach_id) on delete restrict,
 auth_user_id uuid not null references auth.users(id) on delete restrict,
 role text not null default 'coach' check(role='coach'),
 status text not null default 'active' check(status in ('active','suspended')),
 invited_at timestamptz not null,
 accepted_at timestamptz,
 suspended_at timestamptz,
 created_at timestamptz not null default transaction_timestamp(),
 updated_at timestamptz not null default transaction_timestamp(),
 unique(project_id,coach_id), unique(project_id,auth_user_id),
 constraint coach_membership_project_fk foreign key(project_id,coach_id) references public.coaches(project_id,coach_id) on delete restrict,
 constraint coach_membership_status_shape check((status='active' and suspended_at is null) or (status='suspended' and suspended_at is not null)),
 constraint coach_membership_acceptance_order check(accepted_at is null or accepted_at>=invited_at)
);
create table if not exists public.coach_auth_audit_events (
 event_id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete restrict,
 coach_id text not null references public.coaches(coach_id) on delete restrict,
 membership_id uuid references public.project_coach_memberships(membership_id) on delete restrict,
 auth_user_id uuid not null references auth.users(id) on delete restrict,
 event_type text not null check(event_type in ('invited','accepted','suspended','reactivated','device_ready')),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default transaction_timestamp()
);
create table if not exists public.booking_coach_assignments (
 booking_row_id uuid not null references public.project_rows(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete restrict,
 assignment_kind text not null check(assignment_kind in ('assigned','requested')),
 coach_id text not null references public.coaches(coach_id) on delete restrict,
 created_at timestamptz not null default transaction_timestamp(),
 updated_at timestamptz not null default transaction_timestamp(),
 primary key(booking_row_id,assignment_kind),
 constraint booking_coach_assignment_project_fk foreign key(project_id,coach_id) references public.coaches(project_id,coach_id) on delete restrict
);
create index if not exists coach_membership_actor_idx on public.project_coach_memberships(auth_user_id,project_id,status);
create index if not exists coach_audit_membership_idx on public.coach_auth_audit_events(membership_id,created_at,event_id);
create index if not exists booking_coach_assignments_coach_idx on public.booking_coach_assignments(project_id,coach_id,booking_row_id);
alter table public.coaches enable row level security;
alter table public.project_coach_memberships enable row level security;
alter table public.coach_auth_audit_events enable row level security;
alter table public.booking_coach_assignments enable row level security;
revoke all on public.coaches,public.project_coach_memberships,public.coach_auth_audit_events,public.booking_coach_assignments from public,anon,authenticated;
grant select,insert,update on public.coaches,public.project_coach_memberships to service_role;
grant select,insert on public.coach_auth_audit_events to service_role;
grant select,insert,update,delete on public.booking_coach_assignments to service_role;

create or replace function rswtta_private.canonical_coach_id(p_name text) returns text language sql immutable strict set search_path=pg_catalog as $$
 select case
  when regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','','g') in ('coachtianye','tianye','coachtian','headcoachtian') then 'coach_tian_ye'
  when regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','','g') in ('coachjorden','jorden','coachwang','wang') then 'coach_jorden'
  when regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','','g') in ('nationala','debolina','coachdebolina','coacha') then 'coach_debolina'
  when regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','','g') in ('nationalb','diren','coachdiren','coachb') then 'coach_diren'
  else null end
$$;
revoke all on function rswtta_private.canonical_coach_id(text) from public,anon,authenticated;

create or replace function rswtta_private.guard_coach_identity() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='UPDATE' and (new.coach_id<>old.coach_id or new.project_id<>old.project_id) then raise exception 'Coach identity is immutable'; end if;
 new.updated_at=transaction_timestamp(); return new;
end $$;
create or replace function rswtta_private.guard_membership_identity() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='UPDATE' and (new.membership_id<>old.membership_id or new.project_id<>old.project_id or new.coach_id<>old.coach_id or new.auth_user_id<>old.auth_user_id or new.role<>old.role or new.invited_at<>old.invited_at) then raise exception 'Coach membership identity is immutable'; end if;
 new.updated_at=transaction_timestamp(); return new;
end $$;
create or replace function rswtta_private.reject_coach_audit_mutation() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$ begin raise exception 'Coach auth audit events are immutable'; end $$;
create or replace function rswtta_private.audit_coach_membership_state() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then insert into public.coach_auth_audit_events(project_id,coach_id,membership_id,auth_user_id,event_type) values(new.project_id,new.coach_id,new.membership_id,new.auth_user_id,'invited'); end if;
 if tg_op='UPDATE' and old.accepted_at is null and new.accepted_at is not null then insert into public.coach_auth_audit_events(project_id,coach_id,membership_id,auth_user_id,event_type) values(new.project_id,new.coach_id,new.membership_id,new.auth_user_id,'accepted'); end if;
 if tg_op='UPDATE' and old.status<>new.status then insert into public.coach_auth_audit_events(project_id,coach_id,membership_id,auth_user_id,event_type) values(new.project_id,new.coach_id,new.membership_id,new.auth_user_id,case when new.status='suspended' then 'suspended' else 'reactivated' end); end if;
 return new;
end $$;
revoke all on function rswtta_private.guard_coach_identity(),rswtta_private.guard_membership_identity(),rswtta_private.reject_coach_audit_mutation(),rswtta_private.audit_coach_membership_state() from public,anon,authenticated;
drop trigger if exists coaches_identity_guard on public.coaches; create trigger coaches_identity_guard before update on public.coaches for each row execute function rswtta_private.guard_coach_identity();
drop trigger if exists coach_memberships_identity_guard on public.project_coach_memberships; create trigger coach_memberships_identity_guard before update on public.project_coach_memberships for each row execute function rswtta_private.guard_membership_identity();
drop trigger if exists coach_memberships_audit on public.project_coach_memberships; create trigger coach_memberships_audit after insert or update of status,accepted_at on public.project_coach_memberships for each row execute function rswtta_private.audit_coach_membership_state();
drop trigger if exists coach_auth_audit_immutable on public.coach_auth_audit_events; create trigger coach_auth_audit_immutable before update or delete on public.coach_auth_audit_events for each row execute function rswtta_private.reject_coach_audit_mutation();

insert into public.coaches(coach_id,project_id,display_name,display_name_zh) values
 ('coach_tian_ye','ab9d8da3-762f-466c-b7ce-fa05088f03cd','Coach Tian Ye','Tian Ye 教练'),
 ('coach_jorden','ab9d8da3-762f-466c-b7ce-fa05088f03cd','Coach Jorden','Jorden 教练'),
 ('coach_debolina','ab9d8da3-762f-466c-b7ce-fa05088f03cd','Coach Debolina','Debolina 教练'),
 ('coach_diren','ab9d8da3-762f-466c-b7ce-fa05088f03cd','Coach Diren','Diren 教练')
on conflict(coach_id) do nothing;

do $coaches$ begin
 if (select count(*) from public.coaches where project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd')<>4 then raise exception 'Coach canonical backfill count mismatch'; end if;
 if exists(select 1 from public.coaches where project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd' and coach_id not in('coach_tian_ye','coach_jorden','coach_debolina','coach_diren')) then raise exception 'Unexpected canonical coach identity'; end if;
end $coaches$;

create or replace function rswtta_private.sync_booking_coach_assignments() returns trigger language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_assigned text; v_requested text; v_project_id constant uuid:='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid;
begin
 if new.project_table_id<>'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid then return new; end if;
 v_assigned:=rswtta_private.canonical_coach_id(new.values->>'assignedCoach'); v_requested:=rswtta_private.canonical_coach_id(new.values->>'requestedCoach');
 if v_assigned is null or v_requested is null then raise exception 'Booking coach identity is unresolved'; end if;
 insert into public.booking_coach_assignments(booking_row_id,project_id,assignment_kind,coach_id)
 values(new.id,v_project_id,'assigned',v_assigned),(new.id,v_project_id,'requested',v_requested)
 on conflict(booking_row_id,assignment_kind) do update set coach_id=excluded.coach_id,updated_at=transaction_timestamp();
 return new;
end $$;
revoke all on function rswtta_private.sync_booking_coach_assignments() from public,anon,authenticated;
insert into public.booking_coach_assignments(booking_row_id,project_id,assignment_kind,coach_id)
select r.id,'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid,x.assignment_kind,
 rswtta_private.canonical_coach_id(case when x.assignment_kind='assigned' then r.values->>'assignedCoach' else r.values->>'requestedCoach' end)
from public.project_rows r cross join (values('assigned'::text),('requested'::text)) x(assignment_kind)
where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid
on conflict(booking_row_id,assignment_kind) do nothing;
drop trigger if exists sync_booking_coach_assignments on public.project_rows;
create trigger sync_booking_coach_assignments after insert or update of project_table_id,values on public.project_rows for each row execute function rswtta_private.sync_booking_coach_assignments();

create or replace function public.coach_accept_invitation() returns table(coach_id text,display_name text,display_name_zh text,status text,accepted_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_member public.project_coach_memberships%rowtype;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 select m.* into strict v_member from public.project_coach_memberships m where m.auth_user_id=v_uid and m.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid for update;
 if v_member.status<>'active' then raise exception 'Coach access suspended'; end if;
 if v_member.accepted_at is null then update public.project_coach_memberships m set accepted_at=clock_timestamp() where m.membership_id=v_member.membership_id returning m.* into v_member; end if;
 return query select c.coach_id,c.display_name,c.display_name_zh,v_member.status,v_member.accepted_at from public.coaches c where c.coach_id=v_member.coach_id and c.project_id=v_member.project_id;
exception when no_data_found then raise exception 'Coach membership required'; end $$;

create or replace function public.coach_my_profile() returns table(coach_id text,display_name text,display_name_zh text,status text,invited_at timestamptz,accepted_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.coach_id,c.display_name,c.display_name_zh,m.status,m.invited_at,m.accepted_at from public.project_coach_memberships m join public.coaches c on c.project_id=m.project_id and c.coach_id=m.coach_id
 where m.auth_user_id=auth.uid() and m.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and m.status='active' and m.accepted_at is not null
$$;

create or replace function public.coach_my_schedule(p_limit integer default 250) returns table(booking_id uuid,starts_at timestamptz,date_label text,time_label text,program text,status text,student_display_name text,assignment_kind text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_coach_id text;
begin
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid schedule limit'; end if;
 select m.coach_id into strict v_coach_id from public.project_coach_memberships m where m.auth_user_id=auth.uid() and m.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and m.status='active' and m.accepted_at is not null;
 return query select r.id,(r.values->>'startsAt')::timestamptz,coalesce(r.values->>'dateLabel',''),coalesce(r.values->>'timeLabel',''),coalesce(r.values->>'program',''),coalesce(r.values->>'status',''),coalesce(r.values->>'studentName',''),case when exists(select 1 from public.booking_coach_assignments a where a.booking_row_id=r.id and a.assignment_kind='assigned' and a.coach_id=v_coach_id) then 'assigned' else 'requested' end
 from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and exists(select 1 from public.booking_coach_assignments a where a.booking_row_id=r.id and a.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and a.coach_id=v_coach_id) order by (r.values->>'startsAt')::timestamptz desc,r.id limit p_limit;
exception when no_data_found then raise exception 'Coach membership required'; end $$;

revoke all on function public.coach_accept_invitation(),public.coach_my_profile(),public.coach_my_schedule(integer) from public,anon,authenticated;
grant execute on function public.coach_accept_invitation(),public.coach_my_profile(),public.coach_my_schedule(integer) to authenticated;

do $verify$
declare v_count bigint; v_wrong bigint;
begin
 select count(*) into v_count from public.booking_coach_assignments where project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid;
 if v_count<>4092 then raise exception 'Coach assignment backfill incomplete %',v_count; end if;
 select count(*) into v_wrong from public.booking_coach_assignments a join public.project_rows r on r.id=a.booking_row_id where a.coach_id<>rswtta_private.canonical_coach_id(case when a.assignment_kind='assigned' then r.values->>'assignedCoach' else r.values->>'requestedCoach' end);
 if v_wrong<>0 then raise exception 'Coach assignment backfill mismatch %',v_wrong; end if;
 if has_table_privilege('anon','public.coaches','select') or has_table_privilege('authenticated','public.coaches','select') or has_table_privilege('anon','public.project_coach_memberships','select') or has_table_privilege('authenticated','public.project_coach_memberships','select') or has_table_privilege('anon','public.coach_auth_audit_events','select') or has_table_privilege('authenticated','public.coach_auth_audit_events','select') or has_table_privilege('anon','public.booking_coach_assignments','select') or has_table_privilege('authenticated','public.booking_coach_assignments','select') then raise exception 'Coach security tables have browser privileges'; end if;
 if has_function_privilege('anon','public.coach_my_schedule(integer)','execute') or not has_function_privilege('authenticated','public.coach_my_schedule(integer)','execute') then raise exception 'Coach schedule RPC grants mismatch'; end if;
 if (select count(*) from public.project_coach_memberships)<>0 or (select count(*) from public.coach_auth_audit_events)<>0 then raise exception 'Coach auth migration must not create accounts, memberships, invites, or events'; end if;
end $verify$;
commit;
