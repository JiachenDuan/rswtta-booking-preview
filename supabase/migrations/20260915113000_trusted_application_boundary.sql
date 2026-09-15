-- Additive trusted Parent and equal-permission Club operator boundary.
-- No Auth users, memberships, invitations, emails, pushes, or deployments are created here.
-- The separately staged closure must not be applied until compatible clients are healthy.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:trusted-application-boundary:v2', 0));
create extension if not exists pgcrypto;
create schema if not exists rswtta_private;
revoke all on schema rswtta_private from public,anon,authenticated;

create table public.project_auth_memberships (
  membership_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check(role in ('club_admin','coach')),
  coach_id text references public.coaches(coach_id) on delete restrict,
  status text not null default 'active' check(status in ('active','suspended')),
  invited_by uuid references auth.users(id) on delete restrict,
  invited_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique(project_id,auth_user_id),
  constraint project_auth_membership_status_shape check(
    (status='active' and suspended_at is null) or (status='suspended' and suspended_at is not null)
  ),
  constraint project_auth_membership_acceptance_order check(accepted_at is null or accepted_at>=invited_at),
  constraint project_auth_membership_role_coach_shape check((role='club_admin' and coach_id is null) or (role='coach' and coach_id is not null)),
  constraint project_auth_membership_coach_project foreign key(project_id,coach_id)
    references public.coaches(project_id,coach_id) on delete restrict
);
create unique index project_auth_membership_coach_identity
  on public.project_auth_memberships(project_id,coach_id) where coach_id is not null;
create index project_auth_membership_actor on public.project_auth_memberships(auth_user_id,project_id,status);

create table public.project_auth_invitation_requests (
  invitation_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  requested_email text not null check(requested_email=lower(btrim(requested_email)) and requested_email like '%@%'),
  requested_role text not null check(requested_role in ('club_admin','coach')),
  coach_id text references public.coaches(coach_id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  status text not null default 'pending' check(status in ('pending','fulfilled','cancelled')),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique(project_id,requested_by,request_id)
);
create unique index project_auth_invitation_pending_email
  on public.project_auth_invitation_requests(project_id,requested_email) where status='pending';

-- A trusted server/Edge worker may claim these requests with service_role and call the
-- Supabase Auth Admin API. Browser roles can neither read nor write this outbox.
create table public.project_auth_account_requests (
  account_request_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  actor_membership_id uuid not null references public.project_auth_memberships(membership_id) on delete restrict,
  actor_auth_user_id uuid not null references auth.users(id) on delete restrict,
  target_membership_id uuid references public.project_auth_memberships(membership_id) on delete restrict,
  operation text not null check(operation in ('create','send_recovery','suspend','reactivate','delete')),
  request_id uuid not null,
  requested_email text check(requested_email is null or requested_email=lower(btrim(requested_email))),
  status text not null default 'pending' check(status in ('pending','processing','completed','failed','cancelled')),
  created_at timestamptz not null default transaction_timestamp(),
  completed_at timestamptz,
  unique(actor_auth_user_id,request_id)
);

create table public.parent_auth_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  parent_account_row_id uuid not null references public.project_rows(id) on delete restrict,
  verified_at timestamptz not null,
  created_at timestamptz not null default transaction_timestamp(),
  unique(project_id,auth_user_id),unique(project_id,parent_account_row_id)
);

create table public.project_auth_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  actor_auth_user_id uuid not null references auth.users(id) on delete restrict,
  actor_membership_id uuid not null references public.project_auth_memberships(membership_id) on delete restrict,
  actor_role text not null check(actor_role in ('club_admin','coach')),
  action text not null check(length(action) between 1 and 80),
  request_id uuid not null,
  target_kind text not null check(length(target_kind) between 1 and 40),
  target_id text,
  semantic_before jsonb not null default '{}'::jsonb check(jsonb_typeof(semantic_before)='object'),
  semantic_after jsonb not null default '{}'::jsonb check(jsonb_typeof(semantic_after)='object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique(actor_auth_user_id,request_id,action)
);

alter table public.project_auth_memberships enable row level security;
alter table public.project_auth_invitation_requests enable row level security;
alter table public.project_auth_account_requests enable row level security;
alter table public.parent_auth_bindings enable row level security;
alter table public.project_auth_audit_events enable row level security;
revoke all on public.project_auth_memberships,public.project_auth_invitation_requests,public.project_auth_account_requests,public.parent_auth_bindings,public.project_auth_audit_events from public,anon,authenticated;
grant select,insert,update on public.project_auth_memberships,public.project_auth_invitation_requests,public.project_auth_account_requests,public.parent_auth_bindings to service_role;
grant select,insert on public.project_auth_audit_events to service_role;

create or replace function rswtta_private.require_aal2() returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'AAL2 required'; end if;
  return v_uid;
end $$;

-- This is the only operator authorization predicate. Role is deliberately not checked:
-- active accepted club_admin and coach memberships have one identical permission set.
create or replace function rswtta_private.require_operator(p_sensitive boolean default false)
returns public.project_auth_memberships
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_member public.project_auth_memberships%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_sensitive then perform rswtta_private.require_aal2(); end if;
  select m.* into strict v_member from public.project_auth_memberships m
   where m.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
     and m.auth_user_id=v_uid and m.role in ('club_admin','coach')
     and m.status='active' and m.accepted_at is not null;
  return v_member;
exception when no_data_found then raise exception 'Active Club operator membership required';
end $$;

-- Audit data is semantic and allowlisted. Contact, credential, note, token, payment,
-- and arbitrary project-row values can never be copied into immutable audit history.
create or replace function rswtta_private.redact_semantic(p_value jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(coalesce(p_value,'{}'::jsonb)) e
   where e.key in ('status','role','coach_id','table_slug','operation','program','date_label','time_label','starts_at','category','unit_basis')),'{}'::jsonb)
$$;

create or replace function rswtta_private.append_operator_audit(
  p_actor public.project_auth_memberships,p_action text,p_request_id uuid,p_target_kind text,p_target_id text,p_before jsonb,p_after jsonb
) returns void language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
begin
  if p_request_id is null then raise exception 'request_id required'; end if;
  insert into public.project_auth_audit_events(project_id,actor_auth_user_id,actor_membership_id,actor_role,action,request_id,target_kind,target_id,semantic_before,semantic_after)
  values(p_actor.project_id,auth.uid(),p_actor.membership_id,p_actor.role,p_action,p_request_id,p_target_kind,p_target_id,
    rswtta_private.redact_semantic(p_before),rswtta_private.redact_semantic(p_after));
end $$;

create or replace function rswtta_private.guard_project_membership() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Project memberships are immutable and cannot be deleted'; end if;
  if new.membership_id<>old.membership_id or new.project_id<>old.project_id or new.auth_user_id<>old.auth_user_id or
     new.role<>old.role or new.coach_id is distinct from old.coach_id or new.invited_by is distinct from old.invited_by or new.invited_at<>old.invited_at then
    raise exception 'Project membership identity is immutable';
  end if;
  if old.status='active' and new.status='suspended' then
    perform pg_advisory_xact_lock(hashtextextended('rswtta:membership-lockout:'||new.project_id::text,0));
    if new.auth_user_id=auth.uid() then raise exception 'Cannot suspend own active membership'; end if;
    if old.role='club_admin' and not exists(
      select 1 from public.project_auth_memberships m where m.project_id=new.project_id and m.role='club_admin'
       and m.status='active' and m.accepted_at is not null and m.membership_id<>new.membership_id
    ) then raise exception 'Cannot suspend the final active Club Admin'; end if;
  end if;
  new.updated_at:=transaction_timestamp(); return new;
end $$;
create or replace function rswtta_private.reject_auth_audit_mutation() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$ begin raise exception 'Authorization audit events are immutable'; end $$;

drop trigger if exists project_auth_membership_guard on public.project_auth_memberships;
create trigger project_auth_membership_guard before update or delete on public.project_auth_memberships for each row execute function rswtta_private.guard_project_membership();
drop trigger if exists project_auth_audit_immutable on public.project_auth_audit_events;
create trigger project_auth_audit_immutable before update or delete on public.project_auth_audit_events for each row execute function rswtta_private.reject_auth_audit_mutation();

create or replace function public.operator_accept_invitation(p_request_id uuid)
returns table(membership_id uuid,role text,coach_id text,status text,accepted_at timestamptz)
language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype; v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select m.* into strict v_actor from public.project_auth_memberships m
   where m.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and m.auth_user_id=v_uid and m.status='active' for update;
  if v_actor.accepted_at is null then
    update public.project_auth_memberships set accepted_at=clock_timestamp() where project_auth_memberships.membership_id=v_actor.membership_id returning * into v_actor;
    perform rswtta_private.append_operator_audit(v_actor,'membership_accepted',p_request_id,'membership',v_actor.membership_id::text,'{}',jsonb_build_object('status','active','role',v_actor.role,'coach_id',v_actor.coach_id));
  end if;
  return query select v_actor.membership_id,v_actor.role,v_actor.coach_id,v_actor.status,v_actor.accepted_at;
exception when no_data_found then raise exception 'Eligible Club operator membership required';
end $$;

create or replace function public.app_my_membership()
returns table(membership_id uuid,role text,coach_id text,status text,accepted_at timestamptz,display_name text,email text)
language plpgsql stable security definer set search_path=public,rswtta_private,auth,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype;
begin
 v_actor:=rswtta_private.require_operator(false);
 return query select v_actor.membership_id,v_actor.role,v_actor.coach_id,v_actor.status,v_actor.accepted_at,
   coalesce((select c.display_name from public.coaches c where c.project_id=v_actor.project_id and c.coach_id=v_actor.coach_id),u.email,'Club operator'),u.email
 from auth.users u where u.id=v_actor.auth_user_id;
end $$;

create or replace function public.operator_list_memberships()
returns table(membership_id uuid,auth_user_id uuid,role text,coach_id text,status text,invited_at timestamptz,accepted_at timestamptz)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype;
begin v_actor:=rswtta_private.require_operator(false); return query select m.membership_id,m.auth_user_id,m.role,m.coach_id,m.status,m.invited_at,m.accepted_at from public.project_auth_memberships m where m.project_id=v_actor.project_id order by m.role,m.created_at,m.membership_id; end $$;

create or replace function public.operator_request_invitation(p_email text,p_role text,p_coach_id text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype; v_id uuid; v_email text:=lower(btrim(coalesce(p_email,'')));
begin
  v_actor:=rswtta_private.require_operator(true);
  if p_role not in ('club_admin','coach') then raise exception 'Invalid member label'; end if;
  if (p_role='club_admin' and p_coach_id is not null) or (p_role='coach' and p_coach_id is null) then raise exception 'Invalid role/coach identity shape'; end if;
  if v_email='' or v_email not like '%@%' then raise exception 'Invalid invitation email'; end if;
  if p_coach_id is not null and not exists(select 1 from public.coaches c where c.project_id=v_actor.project_id and c.coach_id=p_coach_id) then raise exception 'Invalid coach identity'; end if;
  insert into public.project_auth_invitation_requests(project_id,requested_email,requested_role,coach_id,requested_by,request_id)
   values(v_actor.project_id,v_email,p_role,p_coach_id,auth.uid(),p_request_id) returning invitation_id into v_id;
  perform rswtta_private.append_operator_audit(v_actor,'invitation_requested',p_request_id,'invitation',v_id::text,'{}',jsonb_build_object('role',p_role,'coach_id',p_coach_id));
  return v_id;
end $$;

create or replace function public.operator_change_membership_status(p_membership_id uuid,p_status text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype; v_target public.project_auth_memberships%rowtype;
begin
  v_actor:=rswtta_private.require_operator(true);
  if p_status not in ('active','suspended') then raise exception 'Invalid membership status'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rswtta:membership-lockout:'||v_actor.project_id::text,0));
  select m.* into strict v_target from public.project_auth_memberships m where m.membership_id=p_membership_id and m.project_id=v_actor.project_id for update;
  update public.project_auth_memberships set status=p_status,suspended_at=case when p_status='suspended' then clock_timestamp() else null end where membership_id=v_target.membership_id;
  perform rswtta_private.append_operator_audit(v_actor,'membership_status_changed',p_request_id,'membership',v_target.membership_id::text,
    jsonb_build_object('status',v_target.status,'role',v_target.role,'coach_id',v_target.coach_id),jsonb_build_object('status',p_status,'role',v_target.role,'coach_id',v_target.coach_id));
end $$;

create or replace function public.operator_request_auth_account_action(p_operation text,p_target_membership_id uuid,p_email text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype; v_target public.project_auth_memberships%rowtype; v_id uuid;
begin
  v_actor:=rswtta_private.require_operator(true);
  if p_operation not in ('create','send_recovery','suspend','reactivate','delete') then raise exception 'Invalid account operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rswtta:membership-lockout:'||v_actor.project_id::text,0));
  if p_operation<>'create' then select * into strict v_target from public.project_auth_memberships where membership_id=p_target_membership_id and project_id=v_actor.project_id for update; end if;
  if p_operation in ('suspend','delete') and v_target.membership_id=v_actor.membership_id then raise exception 'Cannot suspend or delete own active membership'; end if;
  if p_operation in ('suspend','delete') and v_target.role='club_admin' and v_target.status='active' and not exists(select 1 from public.project_auth_memberships m where m.project_id=v_actor.project_id and m.role='club_admin' and m.status='active' and m.accepted_at is not null and m.membership_id<>v_target.membership_id) then raise exception 'Cannot suspend or delete the final active Club Admin'; end if;
  insert into public.project_auth_account_requests(project_id,actor_membership_id,actor_auth_user_id,target_membership_id,operation,request_id,requested_email)
   values(v_actor.project_id,v_actor.membership_id,auth.uid(),p_target_membership_id,p_operation,p_request_id,case when p_email is null then null else lower(btrim(p_email)) end) returning account_request_id into v_id;
  perform rswtta_private.append_operator_audit(v_actor,'auth_account_action_requested',p_request_id,'auth_account_request',v_id::text,'{}',jsonb_build_object('operation',p_operation));
  return v_id;
end $$;

create or replace function public.operator_calendar(p_limit integer default 1000)
returns table(booking_id uuid,assigned_coach_id text,requested_coach_id text,starts_at timestamptz,date_label text,time_label text,program text,status text,student_display_identifier text)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype;
begin v_actor:=rswtta_private.require_operator(false); if p_limit is null or p_limit<1 or p_limit>5000 then raise exception 'Invalid calendar limit'; end if;
 return query select r.id,(select a.coach_id from public.booking_coach_assignments a where a.booking_row_id=r.id and a.assignment_kind='assigned'),(select a.coach_id from public.booking_coach_assignments a where a.booking_row_id=r.id and a.assignment_kind='requested'),(r.values->>'startsAt')::timestamptz,coalesce(r.values->>'dateLabel',''),coalesce(r.values->>'timeLabel',''),coalesce(r.values->>'program',''),coalesce(r.values->>'status',''),coalesce(nullif(r.values->>'studentName',''),left(r.id::text,8)) from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid order by (r.values->>'startsAt')::timestamptz desc,r.id limit p_limit;
end $$;

-- Explicit per-family projections. Parent credentials and setup secrets are never projected.
create or replace function public.operator_list_parent_accounts(p_limit integer default 5000)
returns table(id uuid,project_table_id uuid,values jsonb,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype;
begin v_actor:=rswtta_private.require_operator(false); if p_limit not between 1 and 10000 then raise exception 'Invalid row limit'; end if;
 return query select r.id,r.project_table_id,jsonb_build_object('preregisteredName',r.values->>'preregisteredName','studentName',r.values->>'studentName','parentName',r.values->>'parentName','email',r.values->>'email','phone',r.values->>'phone','loginAlias',r.values->>'loginAlias','clubPreregistered',coalesce((r.values->>'clubPreregistered')::boolean,false),'confirmed',coalesce((r.values->>'confirmed')::boolean,false),'profileSetupRequired',coalesce((r.values->>'profileSetupRequired')::boolean,false)),r.created_at,r.updated_at from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid order by r.id limit p_limit; end $$;
create or replace function public.operator_list_bookings(p_limit integer default 10000)
returns table(id uuid,project_table_id uuid,values jsonb,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$ declare v_actor public.project_auth_memberships%rowtype; begin v_actor:=rswtta_private.require_operator(false); if p_limit not between 1 and 10000 then raise exception 'Invalid row limit'; end if; return query select r.id,r.project_table_id,r.values,r.created_at,r.updated_at from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid order by r.id limit p_limit; end $$;
create or replace function public.operator_list_bill_notifications(p_limit integer default 5000)
returns table(id uuid,project_table_id uuid,values jsonb,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$ declare v_actor public.project_auth_memberships%rowtype; begin v_actor:=rswtta_private.require_operator(false); if p_limit not between 1 and 10000 then raise exception 'Invalid row limit'; end if; return query select r.id,r.project_table_id,r.values,r.created_at,r.updated_at from public.project_rows r where r.project_table_id='47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid order by r.id limit p_limit; end $$;
create or replace function public.operator_list_activity_logs(p_limit integer default 5000)
returns table(id uuid,project_table_id uuid,values jsonb,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$ declare v_actor public.project_auth_memberships%rowtype; begin v_actor:=rswtta_private.require_operator(false); if p_limit not between 1 and 10000 then raise exception 'Invalid row limit'; end if; return query select r.id,r.project_table_id,r.values,r.created_at,r.updated_at from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid order by r.id limit p_limit; end $$;

-- Narrow row-family writes preserve the current table triggers and constraints; there is no caller-selected table.
create or replace function rswtta_private.operator_insert_family(p_actor public.project_auth_memberships,p_table_id uuid,p_values jsonb,p_kind text,p_request_id uuid) returns public.project_rows
language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare v_row public.project_rows%rowtype; begin insert into public.project_rows(project_table_id,values) values(p_table_id,p_values) returning * into v_row; perform rswtta_private.append_operator_audit(p_actor,p_kind||'_created',p_request_id,p_kind,v_row.id::text,'{}',jsonb_build_object('status',v_row.values->>'status','program',v_row.values->>'program')); return v_row; end $$;
create or replace function rswtta_private.operator_update_booking_row(p_actor public.project_auth_memberships,p_id uuid,p_values jsonb,p_request_id uuid) returns public.project_rows
language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare v_before public.project_rows%rowtype; v_after public.project_rows%rowtype; begin select * into strict v_before from public.project_rows where id=p_id and project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid for update; if p_values->>'studentAccountId' is distinct from v_before.values->>'studentAccountId' then raise exception 'Student identity cannot be changed through a class update'; end if; update public.project_rows set values=p_values where id=p_id returning * into v_after; perform rswtta_private.append_operator_audit(p_actor,'booking_updated',p_request_id,'booking',p_id::text,jsonb_build_object('status',v_before.values->>'status','program',v_before.values->>'program','starts_at',v_before.values->>'startsAt'),jsonb_build_object('status',v_after.values->>'status','program',v_after.values->>'program','starts_at',v_after.values->>'startsAt')); return v_after; end $$;
create or replace function public.operator_create_booking(p_values jsonb,p_request_id uuid) returns public.project_rows language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; begin a:=rswtta_private.require_operator(true); return rswtta_private.operator_insert_family(a,'a7a8a308-2305-4ab6-ad20-5ce174558035',p_values,'booking',p_request_id); end $$;
create or replace function public.operator_update_booking(p_booking_id uuid,p_values jsonb,p_request_id uuid) returns public.project_rows language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; begin a:=rswtta_private.require_operator(true); return rswtta_private.operator_update_booking_row(a,p_booking_id,p_values,p_request_id); end $$;
create or replace function public.operator_create_bill_notification(p_values jsonb,p_request_id uuid) returns public.project_rows language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; begin a:=rswtta_private.require_operator(true); return rswtta_private.operator_insert_family(a,'47f053f4-af24-4e6c-a3ea-984f6bd36943',p_values,'bill_notification',p_request_id); end $$;
create or replace function public.operator_create_activity_log(p_values jsonb,p_request_id uuid) returns public.project_rows language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; begin a:=rswtta_private.require_operator(true); return rswtta_private.operator_insert_family(a,'133ad2fa-44b2-4aab-ab5d-b79c563ab908',p_values,'activity_log',p_request_id); end $$;

create or replace function public.operator_cancel_booking(p_booking_id uuid,p_request_id uuid) returns public.project_rows language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; r public.project_rows%rowtype; begin a:=rswtta_private.require_operator(true); select * into strict r from public.cancel_booking_as_club(p_booking_id); perform rswtta_private.append_operator_audit(a,'booking_cancelled',p_request_id,'booking',p_booking_id::text,'{}',jsonb_build_object('status','cancelled')); return r; end $$;
create or replace function public.operator_search_students(p_query text) returns jsonb language plpgsql stable security definer set search_path=rswtta_private,public,pg_temp as $$ begin perform rswtta_private.require_operator(false); return rswtta_private.club_search_students_snapshot(p_query); end $$;
create or replace function public.operator_preview_student_preregistration(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql stable security definer set search_path=rswtta_private,public,pg_temp as $$ begin perform rswtta_private.require_operator(false); return rswtta_private.club_preregistration_preview_v2(p_input,p_request_id); end $$;
-- Purpose-specific adapters keep the established transactional implementations authoritative.
create or replace function public.operator_reschedule_booking_occurrences(p_changes jsonb,p_scope text,p_series_id text,p_boundary text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; r jsonb; begin a:=rswtta_private.require_operator(true); r:=public.reschedule_booking_occurrences(p_changes,p_scope,p_series_id,p_boundary); perform rswtta_private.append_operator_audit(a,'booking_occurrences_rescheduled',p_request_id,'booking_series',p_series_id,'{}',jsonb_build_object('operation','reschedule')); return r; end $$;
create or replace function public.operator_manage_group_occurrences(p_selected_block_id uuid,p_action text,p_scope text,p_expected_series_id text,p_expected_occurrence_id text,p_expected_original_starts_at text,p_expected_selected_starts_at text,p_expected_occurrence_count integer,p_expected_row_count integer,p_expected_rows jsonb,p_new_starts_at text,p_new_date_label text,p_new_time_label text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; r jsonb; begin a:=rswtta_private.require_operator(true); r:=public.manage_group_occurrences(p_selected_block_id,p_action,p_scope,p_expected_series_id,p_expected_occurrence_id,p_expected_original_starts_at,p_expected_selected_starts_at,p_expected_occurrence_count,p_expected_row_count,p_expected_rows,p_new_starts_at,p_new_date_label,p_new_time_label); perform rswtta_private.append_operator_audit(a,'group_occurrences_managed',p_request_id,'group_booking',p_selected_block_id::text,'{}',jsonb_build_object('operation',p_action)); return r; end $$;
create or replace function public.operator_add_student_to_group_occurrences(p_selected_block_id uuid,p_scope text,p_student_account_id uuid,p_expected_series_id text,p_expected_occurrence_id text,p_expected_original_starts_at text,p_expected_occurrence_count integer,p_expected_blocks jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; r jsonb; begin a:=rswtta_private.require_operator(true); r:=public.add_student_to_group_occurrences(p_selected_block_id,p_scope,p_student_account_id,p_expected_series_id,p_expected_occurrence_id,p_expected_original_starts_at,p_expected_occurrence_count,p_expected_blocks,p_idempotency_key); perform rswtta_private.append_operator_audit(a,'group_student_added',p_idempotency_key,'group_booking',p_selected_block_id::text,'{}',jsonb_build_object('operation','add_student')); return r; end $$;
create or replace function public.operator_rename_student_account(p_account_id uuid,p_values jsonb,p_request_id uuid)
returns public.project_rows language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$ declare a public.project_auth_memberships%rowtype; r public.project_rows%rowtype; begin a:=rswtta_private.require_operator(true); select * into strict r from public.rename_student_account(p_account_id,p_values); perform rswtta_private.append_operator_audit(a,'student_account_renamed',p_request_id,'parent_account',p_account_id::text,'{}','{}'); return r; end $$;
create or replace function public.operator_list_class_package_balances()
returns table(package_id uuid,student_account_id uuid,category text,unit_basis text,opening_amount_base_units bigint,adjustment_amount_base_units bigint,usage_amount_base_units bigint,remaining_amount_base_units bigint,version bigint,last_event_at timestamptz)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$ begin perform rswtta_private.require_operator(false); return query select * from public.list_class_package_balances_v2(); end $$;
create or replace function public.operator_list_class_package_history(p_student_account_id uuid,p_category text)
returns table(event_id uuid,package_id uuid,student_account_id uuid,category text,unit_basis text,event_type text,amount_base_units integer,old_opening_amount_base_units integer,new_opening_amount_base_units integer,version bigint,note text,reference text,actor_kind text,created_at timestamptz)
language plpgsql stable security definer set search_path=public,rswtta_private,pg_temp as $$ begin perform rswtta_private.require_operator(false); return query select * from public.list_class_package_history(p_student_account_id,p_category); end $$;

-- Financial writes retain the package ledger's version/idempotency checks and add
-- operator AAL2 attribution. The underlying legacy grant is revoked by staged closure.
create or replace function public.operator_set_class_package_opening(
 p_student_account_id uuid,p_category text,p_unit_basis text,p_new_opening_amount_base_units integer,
 p_expected_opening_amount_base_units integer,p_expected_version bigint,p_note text,p_reference text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_actor public.project_auth_memberships%rowtype; v_result jsonb;
begin
 v_actor:=rswtta_private.require_operator(true);
 select to_jsonb(x) into strict v_result from public.set_class_package_opening(p_student_account_id,p_category,p_unit_basis,p_new_opening_amount_base_units,p_expected_opening_amount_base_units,p_expected_version,p_note,p_reference,p_idempotency_key) x;
 perform rswtta_private.append_operator_audit(v_actor,'class_package_opening_set',p_idempotency_key,'class_package',p_student_account_id::text,
  jsonb_build_object('category',p_category,'unit_basis',p_unit_basis),jsonb_build_object('category',p_category,'unit_basis',p_unit_basis));
 return v_result;
end $$;

create or replace function public.parent_my_dashboard() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_account uuid; v_result jsonb;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 select b.parent_account_row_id into strict v_account from public.parent_auth_bindings b where b.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and b.auth_user_id=v_uid and b.verified_at is not null;
 select jsonb_build_object('account',jsonb_build_object('id',a.id,'studentName',a.values->>'studentName','parentName',a.values->>'parentName','email',a.values->>'email','phone',a.values->>'phone','confirmed',a.values->'confirmed'),'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'studentAccountId',r.values->>'studentAccountId','studentName',r.values->>'studentName','requestedCoach',r.values->>'requestedCoach','assignedCoach',r.values->>'assignedCoach','program',r.values->>'program','dateLabel',r.values->>'dateLabel','timeLabel',r.values->>'timeLabel','startsAt',r.values->>'startsAt','status',r.values->>'status','createdAt',r.created_at,'updatedAt',r.updated_at) order by (r.values->>'startsAt')::timestamptz) from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and r.values->>'studentAccountId'=v_account::text),'[]')) into v_result from public.project_rows a where a.id=v_account and a.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
 return v_result;
exception when no_data_found then raise exception 'Verified Parent session ownership required'; end $$;

-- Push/inbox fan-out is assignment-based, never role/operator-wide.
create or replace function rswtta_private.booking_notification_auth_users(p_booking_id uuid)
returns table(auth_user_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
 select distinct m.auth_user_id from public.booking_coach_assignments a join public.project_auth_memberships m on m.project_id=a.project_id and m.coach_id=a.coach_id and m.status='active' and m.accepted_at is not null
 where a.booking_row_id=p_booking_id and a.assignment_kind in ('assigned','requested')
$$;

revoke all on all functions in schema rswtta_private from public,anon,authenticated;
revoke all on function public.operator_accept_invitation(uuid),public.app_my_membership(),public.operator_list_memberships(),public.operator_request_invitation(text,text,text,uuid),public.operator_change_membership_status(uuid,text,uuid),public.operator_request_auth_account_action(text,uuid,text,uuid),public.operator_calendar(integer),public.operator_list_parent_accounts(integer),public.operator_list_bookings(integer),public.operator_list_bill_notifications(integer),public.operator_list_activity_logs(integer),public.operator_create_booking(jsonb,uuid),public.operator_update_booking(uuid,jsonb,uuid),public.operator_create_bill_notification(jsonb,uuid),public.operator_create_activity_log(jsonb,uuid),public.operator_cancel_booking(uuid,uuid),public.operator_search_students(text),public.operator_preview_student_preregistration(jsonb,uuid),public.operator_reschedule_booking_occurrences(jsonb,text,text,text,uuid),public.operator_manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text,uuid),public.operator_add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid),public.operator_rename_student_account(uuid,jsonb,uuid),public.operator_list_class_package_balances(),public.operator_list_class_package_history(uuid,text),public.operator_set_class_package_opening(uuid,text,text,integer,integer,bigint,text,text,uuid),public.parent_my_dashboard() from public,anon,authenticated;
grant execute on function public.operator_accept_invitation(uuid),public.app_my_membership(),public.operator_list_memberships(),public.operator_request_invitation(text,text,text,uuid),public.operator_change_membership_status(uuid,text,uuid),public.operator_request_auth_account_action(text,uuid,text,uuid),public.operator_calendar(integer),public.operator_list_parent_accounts(integer),public.operator_list_bookings(integer),public.operator_list_bill_notifications(integer),public.operator_list_activity_logs(integer),public.operator_create_booking(jsonb,uuid),public.operator_update_booking(uuid,jsonb,uuid),public.operator_create_bill_notification(jsonb,uuid),public.operator_create_activity_log(jsonb,uuid),public.operator_cancel_booking(uuid,uuid),public.operator_search_students(text),public.operator_preview_student_preregistration(jsonb,uuid),public.operator_reschedule_booking_occurrences(jsonb,text,text,text,uuid),public.operator_manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text,uuid),public.operator_add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid),public.operator_rename_student_account(uuid,jsonb,uuid),public.operator_list_class_package_balances(),public.operator_list_class_package_history(uuid,text),public.operator_set_class_package_opening(uuid,text,text,integer,integer,bigint,text,text,uuid),public.parent_my_dashboard() to authenticated;

do $verify$
begin
 if exists(select 1 from public.project_auth_memberships) or exists(select 1 from public.project_auth_invitation_requests) or exists(select 1 from public.project_auth_account_requests) or exists(select 1 from public.parent_auth_bindings) or exists(select 1 from public.project_auth_audit_events) then raise exception 'Additive boundary must not provision identities or requests'; end if;
 if has_table_privilege('anon','public.project_auth_memberships','select') or has_table_privilege('authenticated','public.project_auth_memberships','select') or has_table_privilege('anon','public.project_auth_audit_events','select') or has_table_privilege('authenticated','public.project_auth_audit_events','select') then raise exception 'Private authorization tables exposed'; end if;
 if has_function_privilege('anon','public.operator_list_bookings(integer)','execute') or not has_function_privilege('authenticated','public.operator_list_bookings(integer)','execute') then raise exception 'Operator projection RPC grant mismatch'; end if;
end $verify$;
commit;
