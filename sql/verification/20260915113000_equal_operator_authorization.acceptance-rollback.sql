-- Synthetic equal-operator authorization acceptance. Always rolls back; sends no email/push.
-- Run only after both 20260915102000 and 20260915113000 are present.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:equal-operator:acceptance',0));

do $fixtures$
declare
  v_admin constant uuid:='00000000-0000-4000-8000-000000001101';
  v_admin2 constant uuid:='00000000-0000-4000-8000-000000001102';
  v_coach constant uuid:='00000000-0000-4000-8000-000000001103';
begin
  if exists(select 1 from public.project_auth_memberships) then raise exception 'Acceptance requires no production unified memberships'; end if;
  if exists(select 1 from auth.users where id in(v_admin,v_admin2,v_coach)) then raise exception 'Synthetic fixture collision'; end if;
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
   ('00000000-0000-0000-0000-000000000000',v_admin,'authenticated','authenticated','operator-admin-1@invalid.invalid',extensions.crypt('synthetic-not-real',extensions.gen_salt('bf')),clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}'),
   ('00000000-0000-0000-0000-000000000000',v_admin2,'authenticated','authenticated','operator-admin-2@invalid.invalid',extensions.crypt('synthetic-not-real',extensions.gen_salt('bf')),clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}'),
   ('00000000-0000-0000-0000-000000000000',v_coach,'authenticated','authenticated','operator-coach@invalid.invalid',extensions.crypt('synthetic-not-real',extensions.gen_salt('bf')),clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
  insert into public.project_auth_memberships(project_id,auth_user_id,role,coach_id,status,invited_at,accepted_at) values
   ('ab9d8da3-762f-466c-b7ce-fa05088f03cd',v_admin,'club_admin',null,'active',clock_timestamp(),clock_timestamp()),
   ('ab9d8da3-762f-466c-b7ce-fa05088f03cd',v_admin2,'club_admin',null,'active',clock_timestamp(),clock_timestamp()),
   ('ab9d8da3-762f-466c-b7ce-fa05088f03cd',v_coach,'coach','coach_tian_ye','active',clock_timestamp(),clock_timestamp());
end $fixtures$;

-- Both labels see the identical full Club calendar, not an own-Coach partition.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000001101","role":"authenticated","aal":"aal1"}',true);
create temporary table admin_result as select booking_id from public.operator_calendar(5000);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000001103","role":"authenticated","aal":"aal1"}',true);
create temporary table coach_result as select booking_id from public.operator_calendar(5000);
do $equal_reads$ begin
 if exists((select * from admin_result except select * from coach_result) union all (select * from coach_result except select * from admin_result)) then raise exception 'Role labels received different Club calendars'; end if;
 if (select count(*) from coach_result)=0 then raise exception 'Full Club calendar fixture unexpectedly empty'; end if;
end $equal_reads$;

-- AAL1 may read but may not perform sensitive/destructive/financial-capable mutations.
do $aal1$ begin
 begin perform public.operator_mutate_project_row('create','activity_logs',null,'{"status":"test","email":"must-not-audit@invalid.invalid"}',null,gen_random_uuid()); raise exception 'AAL1 mutation unexpectedly succeeded';
 exception when others then if sqlerrm not like '%AAL2 required%' then raise; end if; end;
end $aal1$;

-- AAL2 succeeds and audit attribution/redaction is exact.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000001103","role":"authenticated","aal":"aal2"}',true);
select * from public.operator_mutate_project_row('create','activity_logs',null,'{"status":"test","email":"must-not-audit@invalid.invalid","phone":"555","password":"secret","parentNote":"private"}',null,
 '00000000-0000-4000-8000-000000001201');
do $audit$
begin
 if not exists(select 1 from public.project_auth_audit_events e join public.project_auth_memberships m on m.membership_id=e.actor_membership_id where e.actor_auth_user_id='00000000-0000-4000-8000-000000001103' and e.actor_role='coach' and m.auth_user_id=e.actor_auth_user_id and e.request_id='00000000-0000-4000-8000-000000001201') then raise exception 'auth.uid actor attribution missing'; end if;
 if exists(select 1 from public.project_auth_audit_events e where e.semantic_before ?| array['email','phone','password','token','note','payment'] or e.semantic_after ?| array['email','phone','password','token','note','payment']) then raise exception 'Private audit field leaked'; end if;
 begin perform public.operator_mutate_project_row('create','activity_logs',null,'{"status":"duplicate"}',null,'00000000-0000-4000-8000-000000001201'); raise exception 'Duplicate request id unexpectedly succeeded'; exception when unique_violation then null; end;
end $audit$;

-- Coach label has the same membership/account controls as Club Admin.
select public.operator_request_auth_account_action('send_recovery',(select membership_id from public.project_auth_memberships where auth_user_id='00000000-0000-4000-8000-000000001101'),null,'00000000-0000-4000-8000-000000001202');

-- Self-lockout, final-admin and immutable binding safety.
do $guards$
declare v_self uuid; v_admin uuid;
begin
 select membership_id into v_self from public.project_auth_memberships where auth_user_id='00000000-0000-4000-8000-000000001103';
 begin perform public.operator_change_membership_status(v_self,'suspended',gen_random_uuid()); raise exception 'Self suspension unexpectedly succeeded'; exception when others then if sqlerrm not like '%own active membership%' then raise; end if; end;
 begin update public.project_auth_memberships set auth_user_id='00000000-0000-4000-8000-000000001102' where membership_id=v_self; raise exception 'Binding mutation unexpectedly succeeded'; exception when others then if sqlerrm not like '%identity is immutable%' then raise; end if; end;
 -- Simulate a concurrent winning suspension under the same project lock, then prove the last admin is protected.
 select membership_id into v_admin from public.project_auth_memberships where auth_user_id='00000000-0000-4000-8000-000000001102';
 update public.project_auth_memberships set status='suspended',suspended_at=clock_timestamp() where membership_id=v_admin;
 select membership_id into v_admin from public.project_auth_memberships where auth_user_id='00000000-0000-4000-8000-000000001101';
 begin update public.project_auth_memberships set status='suspended',suspended_at=clock_timestamp() where membership_id=v_admin; raise exception 'Final admin suspension unexpectedly succeeded'; exception when others then if sqlerrm not like '%final active Club Admin%' then raise; end if; end;
end $guards$;

-- Unbound and anonymous callers receive no private data; browser table grants stay closed.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000001199","role":"authenticated","aal":"aal2"}',true);
do $ineligible$ begin
 begin perform * from public.operator_calendar(10); raise exception 'Unbound user unexpectedly authorized'; exception when others then if sqlerrm not like '%Active Club operator membership required%' then raise; end if; end;
 if has_table_privilege('anon','public.project_auth_memberships','select') or has_table_privilege('authenticated','public.project_auth_audit_events','select') or has_table_privilege('authenticated','public.project_auth_account_requests','select') then raise exception 'Private table leak'; end if;
end $ineligible$;
rollback;
