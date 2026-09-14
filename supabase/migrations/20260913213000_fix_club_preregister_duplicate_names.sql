-- Follow-up: new accounts must not claim legacy seed names; duplicate display names remain separate UUIDs.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:club-unverified-legacy-preregistration:v1',0));
do $guard$ begin
 if to_regprocedure('public.club_preregister_student(text,text,text,uuid,jsonb,text)') is null then raise exception 'Base preregistration function missing'; end if;
 if exists(select 1 from rswtta_private.club_preregistration_requests) then raise exception 'Refuse function replacement with active preregistration rows'; end if;
end $guard$;
create or replace function public.club_preregister_student(p_club_identifier text,p_club_proof text,p_client_key text,p_request_key uuid,p_input jsonb,p_duplicate_snapshot_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_safe jsonb; v_request_hash bytea; v_existing rswtta_private.club_preregistration_requests%rowtype; v_preview jsonb; v_account uuid:=extensions.gen_random_uuid(); v_activity uuid:=extensions.gen_random_uuid(); v_alias text; v_base_alias text; v_credential rswtta_private.club_preregistration_temp_credential%rowtype; v_result jsonb;
begin
 perform rswtta_private.club_preregistration_verify_legacy_club(p_club_identifier,p_club_proof,p_client_key);
 if p_request_key is null then raise exception 'Unique request key required'; end if;
 v_safe:=rswtta_private.club_preregistration_normalize(p_input); v_request_hash:=extensions.digest(convert_to(v_safe::text,'UTF8'),'sha256');
 perform pg_advisory_xact_lock(hashtextextended('club-preregister-key:'||p_request_key::text,0));
 select q.* into v_existing from rswtta_private.club_preregistration_requests q where q.request_key=p_request_key;
 if found then if v_existing.request_hash<>v_request_hash then raise exception 'Idempotency key payload mismatch'; end if; return v_existing.result||jsonb_build_object('replayed',true); end if;
 perform pg_advisory_xact_lock(hashtextextended('club-preregister-name:'||rswtta_private.club_preregistration_alias(v_safe->>'studentName'),0));
 perform pg_advisory_xact_lock(hashtextextended('club-preregister-email:'||coalesce(v_safe->>'email',''),0));
 v_preview:=rswtta_private.club_preregistration_preview(v_safe);
 if v_preview->>'snapshotHash' is distinct from p_duplicate_snapshot_hash then raise exception 'Duplicate preview is stale'; end if;
 if exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'email') then raise exception 'Email already belongs to an account'; end if;
 v_base_alias:=rswtta_private.club_preregistration_alias(v_safe->>'studentName'); v_alias:=v_base_alias;
 if exists(select 1 from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))=v_base_alias) or exists(select 1 from rswtta_private.club_preregistration_aliases a where a.normalized_alias=v_alias) then v_alias:=v_base_alias||'-'||left(v_account::text,8); end if;
 while exists(select 1 from rswtta_private.club_preregistration_aliases a where a.normalized_alias=v_alias) loop v_account:=extensions.gen_random_uuid(); v_alias:=v_base_alias||'-'||left(v_account::text,8); end loop;
 select c.* into strict v_credential from rswtta_private.club_preregistration_temp_credential c where c.singleton;
 perform set_config('rswtta.club_preregister_internal','on',true);
 insert into public.project_rows(id,project_table_id,values) values(v_account,'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,jsonb_build_object('studentName',v_safe->>'studentName','parentName','','email',v_safe->>'email','phone',v_safe->>'phone','loginAlias',v_alias,'passwordHash',encode(v_credential.password_hash,'base64'),'passwordSalt',encode(v_credential.salt,'base64'),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1));
 insert into rswtta_private.club_preregistration_aliases(normalized_alias,account_id) values(v_alias,v_account);
 insert into public.project_rows(id,project_table_id,values) values(v_activity,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid,jsonb_build_object('action','student_preregistered','message','One pending student preregistration was created.','studentName','','coach','','dateLabel','','timeLabel','','count',1,'accountId',v_account,'actor','club_unverified_legacy'));
 v_result:=jsonb_build_object('accountId',v_account,'activityId',v_activity,'loginAlias',v_alias,'replayed',false,'profileSetupRequired',true,'confirmed',false,'authority','club_unverified_legacy');
 insert into rswtta_private.club_preregistration_requests(actor,request_key,request_hash,account_id,activity_id,result) values('club_unverified_legacy',p_request_key,v_request_hash,v_account,v_activity,v_result);
 return v_result;
end $$;
revoke all on function public.club_preregister_student(text,text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.club_preregister_student(text,text,text,uuid,jsonb,text) to anon,authenticated;
commit;
