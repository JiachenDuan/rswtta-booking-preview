-- Synthetic, non-delivery Coach auth acceptance. Always rolls back; sends no email.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:coach-auth-foundation:acceptance',0));
do $fixture$
declare v_user_id constant uuid:='00000000-0000-4000-8000-000000000901'; begin
 if exists(select 1 from auth.users where id=v_user_id or email='coach-phase0-fixture@invalid.invalid') then raise exception 'Synthetic auth fixture already exists'; end if;
 if exists(select 1 from public.project_coach_memberships) then raise exception 'Acceptance requires no production Coach memberships'; end if;
 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-000000000000',v_user_id,'authenticated','authenticated','coach-phase0-fixture@invalid.invalid',extensions.crypt('synthetic-not-a-real-password',extensions.gen_salt('bf')),clock_timestamp(),clock_timestamp(),clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb);
 insert into public.project_coach_memberships(project_id,coach_id,auth_user_id,status,invited_at)
 values('ab9d8da3-762f-466c-b7ce-fa05088f03cd','coach_tian_ye',v_user_id,'active',clock_timestamp()-interval '1 minute');
 if (select count(*) from public.coach_auth_audit_events where auth_user_id=v_user_id and event_type='invited')<>1 then raise exception 'Invite audit event missing'; end if;
end $fixture$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $before_accept$ begin
 if exists(select 1 from public.coach_my_profile()) then raise exception 'Unaccepted membership exposed profile'; end if;
 begin perform * from public.coach_my_schedule(250); raise exception 'Unaccepted membership exposed schedule'; exception when others then if sqlerrm not like '%Coach membership required%' then raise; end if; end;
end $before_accept$;
select * from public.coach_accept_invitation();
select * from public.coach_accept_invitation();
do $accepted$ declare v_schedule_count bigint; begin
 if (select count(*) from public.coach_my_profile())<>1 then raise exception 'Accepted profile unavailable'; end if;
 select count(*) into v_schedule_count from public.coach_my_schedule(500);
 if v_schedule_count<>495 then raise exception 'Own schedule count mismatch %',v_schedule_count; end if;
 if exists(select 1 from public.coach_my_schedule(500) s where s.assignment_kind not in('assigned','requested')) then raise exception 'Schedule assignment kind invalid'; end if;
 if (select count(*) from public.coach_auth_audit_events where auth_user_id='00000000-0000-4000-8000-000000000901' and event_type='accepted')<>1 then raise exception 'Acceptance replay duplicated audit event'; end if;
end $accepted$;
update public.project_coach_memberships set status='suspended',suspended_at=clock_timestamp() where auth_user_id='00000000-0000-4000-8000-000000000901';
do $suspended$ begin
 if exists(select 1 from public.coach_my_profile()) then raise exception 'Suspended membership exposed profile'; end if;
 begin perform * from public.coach_my_schedule(250); raise exception 'Suspended membership exposed schedule'; exception when others then if sqlerrm not like '%Coach membership required%' then raise; end if; end;
 if (select count(*) from public.coach_auth_audit_events where auth_user_id='00000000-0000-4000-8000-000000000901' and event_type='suspended')<>1 then raise exception 'Suspension audit event missing'; end if;
end $suspended$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',true);
do $unbound$ begin
 begin perform * from public.coach_accept_invitation(); raise exception 'Unbound user accepted membership'; exception when others then if sqlerrm not like '%Coach membership required%' then raise; end if; end;
 begin perform * from public.coach_my_schedule(250); raise exception 'Unbound user exposed schedule'; exception when others then if sqlerrm not like '%Coach membership required%' then raise; end if; end;
end $unbound$;
do $privileges$ begin
 if has_table_privilege('anon','public.coaches','select') or has_table_privilege('authenticated','public.project_coach_memberships','select') or has_table_privilege('authenticated','public.coach_auth_audit_events','select') then raise exception 'Browser direct table privilege detected'; end if;
 if has_function_privilege('anon','public.coach_accept_invitation()','execute') or has_function_privilege('anon','public.coach_my_schedule(integer)','execute') then raise exception 'Anonymous Coach RPC privilege detected'; end if;
end $privileges$;
rollback;
