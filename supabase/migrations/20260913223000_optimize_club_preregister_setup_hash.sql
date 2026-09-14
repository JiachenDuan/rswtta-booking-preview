-- Accept a WebCrypto-derived PBKDF2 replacement while the server verifies the new plaintext differs from the temporary credential.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:club-unverified-legacy-preregistration:v1',0));
do $guard$ begin
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.parent_legacy_complete_setup(text,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') <> 'aade435cc3a4278ef4f831d1fb8e09792004f031df238be5b0b028d90f6a91e6' then raise exception 'Setup RPC changed'; end if;
 if exists(select 1 from rswtta_private.club_preregistration_requests) then raise exception 'Refuse setup RPC transition with active preregistration rows'; end if;
end $guard$;
create or replace function public.parent_legacy_complete_setup(p_session_token text,p_client_key text,p_profile jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_session rswtta_private.club_preregistration_sessions%rowtype; v_row public.project_rows%rowtype; v_name text; v_email text; v_phone text; v_parent text; v_password text; v_salt bytea; v_hash bytea; v_old_hash bytea; v_old_candidate bytea;
begin
 select s.* into strict v_session from rswtta_private.club_preregistration_sessions s where s.token_hash=rswtta_private.club_preregistration_digest(p_session_token) and s.revoked_at is null and s.expires_at>clock_timestamp() and s.client_digest=rswtta_private.club_preregistration_digest(p_client_key) for update;
 select r.* into strict v_row from public.project_rows r where r.id=v_session.account_id and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid for update;
 if not coalesce((v_row.values->>'clubPreregistered')::boolean,false) or not coalesce((v_row.values->>'profileSetupRequired')::boolean,false) or coalesce((v_row.values->>'credentialVersion')::bigint,1)<>v_session.credential_version then raise exception 'Invalid setup session'; end if;
 v_name:=normalize(regexp_replace(btrim(coalesce(p_profile->>'studentName','')),'\s+',' ','g'),NFKC); v_parent:=normalize(btrim(coalesce(p_profile->>'parentName','')),NFKC); v_email:=lower(normalize(btrim(coalesce(p_profile->>'email','')),NFKC)); v_phone:=regexp_replace(normalize(btrim(coalesce(p_profile->>'phone','')),NFKC),'[\s().-]+','','g'); v_password:=coalesce(p_profile->>'password','');
 if char_length(v_name) not between 1 and 120 or char_length(v_password)<6 or (v_email<>'' and v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or (v_phone<>'' and v_phone!~'^\+?[0-9]{7,20}$') then raise exception 'Student name and a different password are required'; end if;
 if v_email<>'' and exists(select 1 from public.project_rows r where r.project_table_id=v_row.project_table_id and r.id<>v_row.id and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_email) then raise exception 'Email already belongs to an account'; end if;
 v_old_hash:=decode(v_row.values->>'passwordHash','base64'); v_hash:=decode(coalesce(p_profile->>'passwordHash',''),'base64'); v_salt:=decode(coalesce(p_profile->>'passwordSalt',''),'base64'); if octet_length(v_hash)<>32 or octet_length(v_salt)<>16 then raise exception 'Invalid replacement credential'; end if; v_old_candidate:=rswtta_private.club_preregistration_pbkdf2(v_password,decode(v_row.values->>'passwordSalt','base64'),100000); if v_old_candidate=v_old_hash then raise exception 'A different password is required'; end if;
 perform set_config('rswtta.club_preregister_internal','on',true);
 update public.project_rows r set values=r.values||jsonb_build_object('studentName',v_name,'parentName',v_parent,'email',v_email,'phone',v_phone,'passwordHash',encode(v_hash,'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmed',true,'profileSetupRequired',false,'credentialVersion',v_session.credential_version+1) where r.id=v_row.id returning * into v_row;
 update rswtta_private.club_preregistration_sessions s set revoked_at=clock_timestamp() where s.account_id=v_row.id and s.revoked_at is null;
 return jsonb_build_object('account',(v_row.values-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',v_row.id,'createdAt',v_row.created_at),'setupOnly',false,'temporaryCredentialInvalidated',true);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid setup session'; end $$;
revoke all on function public.parent_legacy_complete_setup(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.parent_legacy_complete_setup(text,text,jsonb) to anon,authenticated;
commit;
