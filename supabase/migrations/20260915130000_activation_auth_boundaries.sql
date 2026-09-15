-- Complete the activation boundary without applying the separately staged legacy closure.
-- No users, memberships, invitations, credentials, messages, or deployments are created.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:activation-auth-boundaries:v1',0));

create or replace function rswtta_private.parent_verified_account(p_session_token text,p_client_key text)
returns uuid language plpgsql stable security definer set search_path=rswtta_private,pg_temp as $$
declare v_account uuid;
begin
  select account_id into strict v_account from rswtta_private.valid_parent_legacy_session(p_session_token,p_client_key);
  return v_account;
exception when no_data_found then raise exception 'Invalid or expired Parent session'; end $$;

create or replace function public.parent_verified_update_profile(p_session_token text,p_client_key text,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_account uuid; v_values jsonb;
begin
  v_account:=rswtta_private.parent_verified_account(p_session_token,p_client_key);
  v_values:=jsonb_build_object('studentName',btrim(coalesce(p_profile->>'studentName','')),'parentName',btrim(coalesce(p_profile->>'parentName','')),'email',lower(btrim(coalesce(p_profile->>'email',''))),'phone',btrim(coalesce(p_profile->>'phone','')));
  if length(v_values->>'studentName') not between 1 and 120 or (v_values->>'email') not like '%@%' or length(v_values->>'phone')<7 then raise exception 'Student name, email, and phone are required'; end if;
  perform public.rename_student_account(v_account,v_values);
  return rswtta_private.parent_legacy_dashboard(v_account);
end $$;

create or replace function public.parent_verified_request_private_booking(p_session_token text,p_client_key text,p_request_id uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_account uuid; v_row public.project_rows%rowtype;
begin
  v_account:=rswtta_private.parent_verified_account(p_session_token,p_client_key);
  if coalesce(p_values->>'groupClassId','')<>'' or p_values->>'program' not in ('Private lesson','Group lesson') then raise exception 'Private class request required'; end if;
  select * into strict v_row from public.request_booking_as_parent(p_request_id,v_account::text,p_values||jsonb_build_object('studentAccountId',v_account::text));
  return rswtta_private.parent_legacy_dashboard(v_account)||jsonb_build_object('changedBooking',rswtta_private.parent_legacy_row_json(v_row));
end $$;

create or replace function public.parent_verified_request_group_class(p_session_token text,p_client_key text,p_request_id uuid,p_group_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_account uuid; v_account_row public.project_rows%rowtype; v_group public.project_rows%rowtype; v_row public.project_rows%rowtype; v_bookings constant uuid:='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid; v_group_id text;
begin
  if p_request_id is null or p_group_booking_id is null then raise exception 'Complete group request identity is required'; end if;
  v_account:=rswtta_private.parent_verified_account(p_session_token,p_client_key);
  select * into strict v_account_row from public.project_rows where id=v_account and project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  select * into strict v_group from public.project_rows where id=p_group_booking_id and project_table_id=v_bookings for share;
  if v_group.values->>'program'<>'Group class' or coalesce(v_group.values->>'status','')='cancelled' or (v_group.values->>'startsAt')::timestamptz<=clock_timestamp() then raise exception 'This group class is not available'; end if;
  v_group_id:=coalesce(nullif(v_group.values->>'groupClassId',''),v_group.id::text);
  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-group:'||v_group.id::text,0));
  select * into v_row from public.project_rows r where r.project_table_id=v_bookings and r.values->>'studentAccountId'=v_account::text and coalesce(r.values->>'status','')<>'cancelled' and coalesce(nullif(r.values->>'groupClassId',''),r.id::text)=v_group_id and (r.values->>'startsAt')::timestamptz=(v_group.values->>'startsAt')::timestamptz limit 1 for update;
  if not found then
    if exists(select 1 from public.project_rows r where r.id=p_request_id) then raise exception 'Booking identity is already in use'; end if;
    insert into public.project_rows(id,project_table_id,values) values(p_request_id,v_bookings,jsonb_build_object(
      'studentAccountId',v_account::text,'studentName',coalesce(v_account_row.values->>'studentName',''),'familyName',coalesce(v_account_row.values->>'studentName',''),'studentEmail',coalesce(v_account_row.values->>'email',''),'phone',coalesce(v_account_row.values->>'phone',''),
      'requestedCoach',v_group.values->>'requestedCoach','assignedCoach',v_group.values->>'assignedCoach','program','Group enrollment','groupClassId',v_group_id,'dateLabel',v_group.values->>'dateLabel','timeLabel',v_group.values->>'timeLabel','startsAt',v_group.values->>'startsAt','priceCents',7500,'status','requested','parentNote','Parent requested to join group class.')) returning * into v_row;
  end if;
  return rswtta_private.parent_legacy_dashboard(v_account)||jsonb_build_object('changedBooking',rswtta_private.parent_legacy_row_json(v_row));
exception when no_data_found then raise exception 'Parent session or group class is invalid'; end $$;

create or replace function public.parent_verified_cancel_booking(p_session_token text,p_client_key text,p_booking_id uuid,p_virtual_values jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_account uuid; v_row public.project_rows%rowtype;
begin
  v_account:=rswtta_private.parent_verified_account(p_session_token,p_client_key);
  if p_booking_id is null and coalesce(p_virtual_values->>'studentAccountId','')<>v_account::text then raise exception 'Virtual class does not belong to this Parent session'; end if;
  select * into strict v_row from public.cancel_booking_as_parent(p_booking_id,v_account::text,case when p_booking_id is null then p_virtual_values||jsonb_build_object('studentAccountId',v_account::text) else null end);
  return rswtta_private.parent_legacy_dashboard(v_account)||jsonb_build_object('changedBooking',rswtta_private.parent_legacy_row_json(v_row));
end $$;

create or replace function public.parent_verified_complete_booking(p_session_token text,p_client_key text,p_booking_id uuid,p_virtual_values jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,rswtta_private,pg_temp as $$
declare v_account uuid; v_row public.project_rows%rowtype; v_values jsonb; v_bookings constant uuid:='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid;
begin
  v_account:=rswtta_private.parent_verified_account(p_session_token,p_client_key);
  if p_booking_id is null then
    if coalesce(p_virtual_values->>'studentAccountId','')<>v_account::text then raise exception 'Virtual class does not belong to this Parent session'; end if;
    v_values:=(p_virtual_values-'id'-'createdAt'-'updatedAt')||jsonb_build_object('studentAccountId',v_account::text);
  else select * into strict v_row from public.project_rows where id=p_booking_id and project_table_id=v_bookings for update; v_values:=v_row.values; end if;
  if v_values->>'studentAccountId'<>v_account::text then raise exception 'This class does not belong to this Parent session'; end if;
  if coalesce(v_values->>'status','requested') not in ('requested','club_confirmed') or public.rswtta_booking_ends_at(v_values)>clock_timestamp() then raise exception 'This class cannot be completed yet'; end if;
  v_values:=v_values||jsonb_build_object('status','coach_confirmed','parentNote',btrim(coalesce(v_values->>'parentNote','')||' Marked complete by student.'));
  if p_booking_id is null then insert into public.project_rows(project_table_id,values) values(v_bookings,v_values) returning * into v_row; else update public.project_rows set values=v_values where id=p_booking_id returning * into v_row; end if;
  return rswtta_private.parent_legacy_dashboard(v_account)||jsonb_build_object('changedBooking',rswtta_private.parent_legacy_row_json(v_row));
exception when no_data_found then raise exception 'Parent session or booking is invalid'; end $$;

-- Authenticated operator preregistration retains the v3 search/preview hashes,
-- deterministic account ID, idempotency record, alias, and temporary credential semantics.
alter table rswtta_private.club_preregistration_requests drop constraint club_preregistration_requests_actor_check;
alter table rswtta_private.club_preregistration_requests add constraint club_preregistration_requests_actor_check check(actor in ('club_unverified_legacy','trusted_operator'));
create or replace function public.operator_create_student_preregistration(p_request_id uuid,p_search_query text,p_search_snapshot_hash text,p_input jsonb,p_duplicate_snapshot_hash text,p_reviewed_same_name boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare a public.project_auth_memberships%rowtype; v_safe jsonb; v_request_hash bytea; v_existing rswtta_private.club_preregistration_requests%rowtype; v_search jsonb; v_preview jsonb; v_account uuid; v_activity uuid:=extensions.gen_random_uuid(); v_alias text; v_name text; v_result jsonb; v_credential rswtta_private.club_preregistration_temp_credential%rowtype; v_exact_name boolean; v_has_differentiator boolean;
begin
 a:=rswtta_private.require_operator(true); if p_request_id is null or btrim(coalesce(p_search_query,''))='' then raise exception 'Completed search required'; end if;
 v_safe:=rswtta_private.club_preregistration_normalize_v2(p_input); v_name:=rswtta_private.club_preregistration_alias(v_safe->>'studentName'); v_account:=rswtta_private.club_preregistration_proposed_id(p_request_id);
 v_request_hash:=extensions.digest(convert_to(jsonb_build_object('input',v_safe,'searchQuery',rswtta_private.club_preregistration_alias(p_search_query),'sameNameReviewed',coalesce(p_reviewed_same_name,false))::text,'UTF8'),'sha256');
 perform pg_advisory_xact_lock(hashtextextended('club-preregister-key:'||p_request_id::text,0)); select q.* into v_existing from rswtta_private.club_preregistration_requests q where q.request_key=p_request_id;
 if found then if v_existing.request_hash<>v_request_hash then raise exception 'Idempotency key payload mismatch'; end if; return v_existing.result||jsonb_build_object('replayed',true); end if;
 perform pg_advisory_xact_lock(hashtextextended('club-preregister-search:'||rswtta_private.club_preregistration_alias(p_search_query),0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-name:'||v_name,0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-email:'||coalesce(v_safe->>'email',''),0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-phone:'||coalesce(v_safe->>'phone',''),0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-alias:'||coalesce(v_safe->>'loginAlias',''),0));
 v_search:=rswtta_private.club_search_students_snapshot(p_search_query); if v_search->>'snapshotHash' is distinct from p_search_snapshot_hash then raise exception 'Student search is stale'; end if;
 v_preview:=rswtta_private.club_preregistration_preview_v2(v_safe,p_request_id); if v_preview->>'snapshotHash' is distinct from p_duplicate_snapshot_hash then raise exception 'Duplicate preview is stale'; end if;
 if exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'email') then raise exception 'Email already belongs to an account'; end if;
 if exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'login_alias') then raise exception 'Login alias already belongs to an account'; end if;
 if exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'exact_name' and c->'kinds' ? 'phone') then raise exception 'Exact name and contact belong to an account'; end if;
 v_exact_name:=exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'exact_name'); v_has_differentiator:=(v_safe->>'loginAlias'<>'' or v_safe->>'email'<>'' or v_safe->>'phone'<>'');
 if v_exact_name and not v_has_differentiator then raise exception 'Exact name requires a unique alias or differentiator'; end if; if v_exact_name and not coalesce(p_reviewed_same_name,false) then raise exception 'Explicit same-name confirmation required'; end if;
 v_alias:=coalesce(nullif(v_safe->>'loginAlias',''),v_name); if v_exact_name or exists(select 1 from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and rswtta_private.club_preregistration_alias(coalesce(r.values->>'loginAlias',''))=v_alias) then v_alias:=case when v_safe->>'loginAlias'<>'' then v_safe->>'loginAlias' else v_name||'-'||left(v_account::text,8) end; end if;
 select c.* into strict v_credential from rswtta_private.club_preregistration_temp_credential c where c.singleton; perform set_config('rswtta.club_preregister_internal','on',true);
 insert into public.project_rows(id,project_table_id,values) values(v_account,'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,jsonb_build_object('studentName',v_safe->>'studentName','preregisteredName',v_safe->>'studentName','parentName','','email',v_safe->>'email','phone',v_safe->>'phone','loginAlias',v_alias,'passwordHash',encode(v_credential.password_hash,'base64'),'passwordSalt',encode(v_credential.salt,'base64'),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1));
 insert into rswtta_private.club_preregistration_aliases(normalized_alias,account_id) values(v_alias,v_account);
 insert into public.project_rows(id,project_table_id,values) values(v_activity,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid,jsonb_build_object('action','student_preregistered','message','One pending student preregistration was created.','studentName','','coach','','dateLabel','','timeLabel','','count',1,'accountId',v_account,'actor','trusted_operator'));
 v_result:=jsonb_build_object('accountId',v_account,'activityId',v_activity,'loginAlias',v_alias,'replayed',false,'profileSetupRequired',true,'confirmed',false,'authority','trusted_operator'); insert into rswtta_private.club_preregistration_requests(actor,request_key,request_hash,account_id,activity_id,result) values('trusted_operator',p_request_id,v_request_hash,v_account,v_activity,v_result);
 perform rswtta_private.append_operator_audit(a,'student_preregistered',p_request_id,'parent_account',v_account::text,'{}','{}'); return v_result;
end $$;

revoke all on all functions in schema rswtta_private from public,anon,authenticated;
revoke all on function public.parent_verified_update_profile(text,text,jsonb),public.parent_verified_request_private_booking(text,text,uuid,jsonb),public.parent_verified_request_group_class(text,text,uuid,uuid),public.parent_verified_cancel_booking(text,text,uuid,jsonb),public.parent_verified_complete_booking(text,text,uuid,jsonb),public.operator_create_student_preregistration(uuid,text,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.parent_verified_update_profile(text,text,jsonb),public.parent_verified_request_private_booking(text,text,uuid,jsonb),public.parent_verified_request_group_class(text,text,uuid,uuid),public.parent_verified_cancel_booking(text,text,uuid,jsonb),public.parent_verified_complete_booking(text,text,uuid,jsonb) to anon,authenticated;
grant execute on function public.operator_create_student_preregistration(uuid,text,text,jsonb,text,boolean) to authenticated;
commit;
