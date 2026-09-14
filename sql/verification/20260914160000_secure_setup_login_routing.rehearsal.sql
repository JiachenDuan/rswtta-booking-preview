begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:20260914160000:secure-setup-login-routing',0));

create schema if not exists rswtta_private;
revoke all on schema rswtta_private from public,anon,authenticated;

do $guard$
declare
  v_count bigint;
  v_hash text;
  v_setup bigint;
  v_temp bigint;
  v_custom bigint;
  v_legacy bigint;
  v_current bigint;
  v_missing bigint;
  v_incompatible bigint;
begin
  select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'table',r.project_table_id,'values',r.values,'created',r.created_at,'updated',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex')
    into v_count,v_hash
  from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  if v_count<>67 or v_hash<>'137ce3f1eded3d35cebfa47a0dfcbe731c3febf035f617f69bd36ec9742cd2c4' then raise exception 'Account baseline changed'; end if;
  select count(*),
    count(*) filter(where exists(select 1 from rswtta_private.club_preregistration_temp_credential c where decode(r.values->>'passwordHash','base64')=c.password_hash and decode(r.values->>'passwordSalt','base64')=c.salt)),
    count(*) filter(where not exists(select 1 from rswtta_private.club_preregistration_temp_credential c where decode(r.values->>'passwordHash','base64')=c.password_hash and decode(r.values->>'passwordSalt','base64')=c.salt)),
    count(*) filter(where not coalesce((r.values->>'clubPreregistered')::boolean,false)),
    count(*) filter(where coalesce((r.values->>'clubPreregistered')::boolean,false)),
    count(*) filter(where coalesce(r.values->>'passwordHash','')='' or coalesce(r.values->>'passwordSalt','')=''),
    count(*) filter(where octet_length(decode(coalesce(r.values->>'passwordHash',''),'base64'))<>32 or octet_length(decode(coalesce(r.values->>'passwordSalt',''),'base64'))<>16)
    into v_setup,v_temp,v_custom,v_legacy,v_current,v_missing,v_incompatible
  from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and coalesce((r.values->>'profileSetupRequired')::boolean,false);
  if (v_setup,v_temp,v_custom,v_legacy,v_current,v_missing,v_incompatible)<>(37,30,7,36,1,0,0) then raise exception 'Setup-account partition changed'; end if;
  if (select count(*) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex ma')<>1
     or (select count(*) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex li')<>1
     or (select count(distinct r.id) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) in('alex ma','alex li'))<>2 then raise exception 'Alex immutable binding baseline changed'; end if;
  if to_regprocedure('public.parent_legacy_setup_login(text,text,text)') is null
     or to_regprocedure('public.parent_legacy_complete_setup(text,text,jsonb)') is null
     or to_regprocedure('rswtta_private.club_preregistration_verify_legacy_club(text,text,text)') is null
     or to_regprocedure('rswtta_private.parent_legacy_dashboard(uuid)') is null
     or to_regprocedure('rswtta_private.parent_legacy_credential_fingerprint(jsonb)') is null
     or to_regclass('rswtta_private.parent_legacy_sessions') is null then raise exception 'Required auth contracts missing'; end if;
  if encode(extensions.digest(convert_to(pg_get_functiondef('public.parent_legacy_setup_login(text,text,text)'::regprocedure),'UTF8'),'sha256'),'hex') not in ('e9ebbe34e0a10ba687ad155430229ada5beb0849bbffd3fce474c08816ca8bc4')
     and to_regclass('rswtta_private.secure_setup_login_rollout_20260914160000') is null then raise exception 'Setup login contract changed'; end if;
  if encode(extensions.digest(convert_to(pg_get_functiondef('public.parent_legacy_complete_setup(text,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') not in ('e85ee0087d8963f777cc8eace1326e7b0b43e1002fae81fd2b85ae527cd9fea3')
     and to_regclass('rswtta_private.secure_setup_login_rollout_20260914160000') is null then raise exception 'Setup completion contract changed'; end if;
end $guard$;

create table if not exists rswtta_private.backup_secure_setup_accounts_20260914160000 as
select * from public.project_rows where project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
create table if not exists rswtta_private.backup_secure_setup_sessions_20260914160000 as select * from rswtta_private.club_preregistration_sessions;
create table if not exists rswtta_private.backup_secure_setup_aliases_20260914160000 as select * from rswtta_private.club_preregistration_aliases;
create table if not exists rswtta_private.backup_secure_setup_attempts_20260914160000 as select * from rswtta_private.club_preregistration_login_attempts;
create table if not exists rswtta_private.backup_secure_setup_contracts_20260914160000 as
select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in('parent_legacy_setup_login','parent_legacy_complete_setup');
create table if not exists rswtta_private.backup_secure_setup_policies_20260914160000 as
select * from pg_policies where schemaname='public' and tablename='project_rows';
create table if not exists rswtta_private.secure_setup_login_rollout_20260914160000(applied_at timestamptz not null default clock_timestamp(), migration_sha256 text);

do $backup_acl$
declare v_name text;
begin
  foreach v_name in array array['backup_secure_setup_accounts_20260914160000','backup_secure_setup_sessions_20260914160000','backup_secure_setup_aliases_20260914160000','backup_secure_setup_attempts_20260914160000','backup_secure_setup_contracts_20260914160000','backup_secure_setup_policies_20260914160000','secure_setup_login_rollout_20260914160000'] loop
    execute format('alter table rswtta_private.%I enable row level security',v_name);
    execute format('revoke all on rswtta_private.%I from public,anon,authenticated',v_name);
  end loop;
end $backup_acl$;

do $backup_verify$
declare v_count bigint; v_hash text;
begin
  select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'table',r.project_table_id,'values',r.values,'created',r.created_at,'updated',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from rswtta_private.backup_secure_setup_accounts_20260914160000 r;
  if v_count<>67 or v_hash<>'137ce3f1eded3d35cebfa47a0dfcbe731c3febf035f617f69bd36ec9742cd2c4' then raise exception 'Account backup mismatch'; end if;
  if (select count(*) from rswtta_private.backup_secure_setup_contracts_20260914160000)<>2 then raise exception 'Contract backup mismatch'; end if;
  if has_table_privilege('anon','rswtta_private.backup_secure_setup_accounts_20260914160000','select') or has_table_privilege('authenticated','rswtta_private.backup_secure_setup_accounts_20260914160000','select') then raise exception 'Backup browser access not denied'; end if;
end $backup_verify$;

create or replace function rswtta_private.parent_setup_identifier_resolution(p_identifier text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,rswtta_private as $$
declare v_identifier text:=rswtta_private.club_preregistration_alias(coalesce(p_identifier,'')); v_first text; v_exact_ids uuid[]; v_first_ids uuid[]; v_status text; v_account uuid;
begin
  if length(v_identifier) not between 1 and 160 or position('@' in v_identifier)>0 then return jsonb_build_object('status','no_match','firstNameCollision',false); end if;
  v_first:=split_part(v_identifier,' ',1);
  with all_accounts as (
    select r.id,r.values,rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) student_name,
      rswtta_private.club_preregistration_alias(coalesce(r.values->>'loginAlias','')) login_alias
    from public.project_rows r
    where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
  ), candidates as (
    select a.* from all_accounts a
    where coalesce((a.values->>'profileSetupRequired')::boolean,false)
      and octet_length(decode(coalesce(a.values->>'passwordHash',''),'base64'))=32
      and octet_length(decode(coalesce(a.values->>'passwordSalt',''),'base64'))=16
  )
  select (select array_agg(distinct c.id order by c.id) from candidates c where c.student_name=v_identifier or c.login_alias=v_identifier or exists(select 1 from rswtta_private.club_preregistration_aliases x where x.account_id=c.id and x.normalized_alias=v_identifier)),
         (select array_agg(distinct a.id order by a.id) from all_accounts a where split_part(a.student_name,' ',1)=v_first)
    into v_exact_ids,v_first_ids;
  if coalesce(cardinality(v_exact_ids),0)=1 then v_status:='unique_exact'; v_account:=v_exact_ids[1];
  elsif coalesce(cardinality(v_exact_ids),0)>1 then v_status:='ambiguous';
  elsif coalesce(cardinality(v_first_ids),0)=1 then v_status:='unique_first_name'; v_account:=v_first_ids[1];
  elsif coalesce(cardinality(v_first_ids),0)>1 then v_status:='ambiguous';
  else v_status:='no_match'; end if;
  return jsonb_build_object('status',v_status,'firstNameCollision',coalesce(cardinality(v_first_ids),0)>1,'accountId',v_account);
exception when invalid_text_representation then return jsonb_build_object('status','no_match','firstNameCollision',false); end $$;

create or replace function public.parent_legacy_setup_identifier_status(p_identifier text)
returns jsonb language sql stable security definer set search_path=pg_catalog,rswtta_private as $$
  select rswtta_private.parent_setup_identifier_resolution(p_identifier)-'accountId'
$$;

create or replace function public.parent_legacy_setup_login(p_identifier text,p_password text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_alias text:=rswtta_private.club_preregistration_alias(coalesce(p_identifier,'')); v_identifier bytea:=rswtta_private.club_preregistration_digest(v_alias); v_client bytea:=rswtta_private.club_preregistration_digest(coalesce(p_client_key,'')); v_resolution jsonb; v_account uuid; v_row public.project_rows%rowtype; v_ok boolean; v_token text; v_version bigint;
begin
 if length(v_alias) not between 1 and 160 or length(coalesce(p_password,'')) not between 1 and 1024 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid login'; end if;
 perform pg_advisory_xact_lock(hashtextextended('parent-legacy-setup-login:'||encode(v_identifier,'hex')||':'||encode(v_client,'hex'),0));
 delete from rswtta_private.club_preregistration_login_attempts where attempted_at<clock_timestamp()-interval '1 day';
 if (select count(*) from rswtta_private.club_preregistration_login_attempts a where a.scope='parent_setup' and a.attempted_at>clock_timestamp()-interval '15 minutes' and (a.identifier_digest=v_identifier or a.client_digest=v_client) and not a.succeeded)>=8 then raise exception 'Invalid login'; end if;
 v_resolution:=rswtta_private.parent_setup_identifier_resolution(v_alias);
 if v_resolution->>'status' not in('unique_exact','unique_first_name') then perform rswtta_private.club_preregistration_pbkdf2(p_password,decode('000102030405060708090a0b0c0d0e0f','hex'),100000); insert into rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,succeeded) values('parent_setup',v_identifier,v_client,false); raise exception 'Invalid login'; end if;
 v_account:=(v_resolution->>'accountId')::uuid;
 select r.* into strict v_row from public.project_rows r where r.id=v_account and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid for update;
 if not coalesce((v_row.values->>'profileSetupRequired')::boolean,false) then raise exception 'Invalid login'; end if;
 v_ok:=rswtta_private.club_preregistration_pbkdf2(p_password,decode(v_row.values->>'passwordSalt','base64'),100000)=decode(v_row.values->>'passwordHash','base64');
 insert into rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,succeeded) values('parent_setup',v_identifier,v_client,v_ok); if not v_ok then raise exception 'Invalid login'; end if;
 v_token:=encode(extensions.gen_random_bytes(32),'hex'); v_version:=coalesce((v_row.values->>'credentialVersion')::bigint,1);
 insert into rswtta_private.club_preregistration_sessions(token_hash,account_id,credential_version,client_digest,expires_at) values(rswtta_private.club_preregistration_digest(v_token),v_account,v_version,v_client,clock_timestamp()+interval '15 minutes');
 return jsonb_build_object('sessionToken',v_token,'account',(v_row.values-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',v_row.id,'createdAt',v_row.created_at),'setupOnly',true);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid login'; end $$;

create or replace function public.parent_legacy_complete_setup(p_session_token text,p_client_key text,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_session rswtta_private.club_preregistration_sessions%rowtype; v_row public.project_rows%rowtype; v_name text; v_email text; v_phone text; v_parent text; v_password text; v_salt bytea; v_hash bytea; v_old_hash bytea; v_old_candidate bytea; v_is_current_shape boolean; v_parent_token text; v_parent_expiry timestamptz; v_client_digest bytea;
begin
 select s.* into strict v_session from rswtta_private.club_preregistration_sessions s where s.token_hash=rswtta_private.club_preregistration_digest(p_session_token) and s.revoked_at is null and s.expires_at>clock_timestamp() and s.client_digest=rswtta_private.club_preregistration_digest(p_client_key) for update;
 select r.* into strict v_row from public.project_rows r where r.id=v_session.account_id and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid for update;
 if not coalesce((v_row.values->>'profileSetupRequired')::boolean,false) or coalesce((v_row.values->>'credentialVersion')::bigint,1)<>v_session.credential_version then raise exception 'Invalid setup session'; end if;
 v_is_current_shape:=coalesce((v_row.values->>'clubPreregistered')::boolean,false);
 v_name:=normalize(regexp_replace(btrim(coalesce(p_profile->>'studentName','')),'\s+',' ','g'),NFKC); v_parent:=normalize(btrim(coalesce(p_profile->>'parentName','')),NFKC); v_email:=lower(normalize(btrim(coalesce(p_profile->>'email','')),NFKC)); v_phone:=regexp_replace(normalize(btrim(coalesce(p_profile->>'phone','')),NFKC),'[\s().-]+','','g'); v_password:=coalesce(p_profile->>'password','');
 if char_length(v_name) not between 1 and 120 or char_length(v_password)<6 or (v_email<>'' and v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or (v_phone<>'' and v_phone!~'^\+?[0-9]{7,20}$') or (not v_is_current_shape and (v_email='' or v_phone='')) then raise exception 'Student name, required contact fields, and a different password are required'; end if;
 if v_email<>'' and exists(select 1 from public.project_rows r where r.project_table_id=v_row.project_table_id and r.id<>v_row.id and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_email) then raise exception 'Email already belongs to an account'; end if;
 v_old_hash:=decode(v_row.values->>'passwordHash','base64'); v_hash:=decode(coalesce(p_profile->>'passwordHash',''),'base64'); v_salt:=decode(coalesce(p_profile->>'passwordSalt',''),'base64'); if octet_length(v_hash)<>32 or octet_length(v_salt)<>16 then raise exception 'Invalid replacement credential'; end if; v_old_candidate:=rswtta_private.club_preregistration_pbkdf2(v_password,decode(v_row.values->>'passwordSalt','base64'),100000); if v_old_candidate=v_old_hash then raise exception 'A different password is required'; end if;
 perform set_config('rswtta.club_preregister_internal','on',true);
 update public.project_rows r set values=r.values||jsonb_build_object('studentName',v_name,'parentName',v_parent,'email',v_email,'phone',v_phone,'passwordHash',encode(v_hash,'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmed',true,'profileSetupRequired',false,'credentialVersion',v_session.credential_version+1) where r.id=v_row.id returning * into v_row;
 update rswtta_private.club_preregistration_sessions s set revoked_at=clock_timestamp() where s.account_id=v_row.id and s.revoked_at is null;
 v_parent_token:=encode(extensions.gen_random_bytes(32),'hex'); v_parent_expiry:=clock_timestamp()+interval '12 hours'; v_client_digest:=rswtta_private.club_preregistration_digest(p_client_key);
 delete from rswtta_private.parent_legacy_sessions where expires_at<clock_timestamp()-interval '1 day';
 insert into rswtta_private.parent_legacy_sessions(token_hash,account_id,client_digest,credential_fingerprint,expires_at) values(rswtta_private.club_preregistration_digest(v_parent_token),v_row.id,v_client_digest,rswtta_private.parent_legacy_credential_fingerprint(v_row.values),v_parent_expiry);
 return jsonb_build_object('sessionToken',v_parent_token,'expiresAt',v_parent_expiry,'setupOnly',false,'previousCredentialInvalidated',true)||rswtta_private.parent_legacy_dashboard(v_row.id);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid setup session'; end $$;

create or replace function public.club_legacy_list_parent_accounts(p_club_identifier text,p_club_proof text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,rswtta_private as $$
declare v_result jsonb;
begin
 perform rswtta_private.club_preregistration_verify_legacy_club(p_club_identifier,p_club_proof,p_client_key);
 select coalesce(jsonb_agg((r.values-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',r.id,'createdAt',r.created_at) order by r.values->>'studentName',r.id),'[]'::jsonb) into v_result from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
 return v_result;
end $$;

create or replace function public.parent_sync_authenticated_password(p_password_hash text,p_password_salt text)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_email text; v_ids uuid[];
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 v_email:=lower(normalize(btrim(coalesce(auth.jwt()->>'email','')),NFKC));
 if v_email='' or octet_length(decode(coalesce(p_password_hash,''),'base64'))<>32 or octet_length(decode(coalesce(p_password_salt,''),'base64'))<>16 then raise exception 'Invalid authenticated password update'; end if;
 select array_agg(r.id order by r.id) into v_ids from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_email and not coalesce((r.values->>'profileSetupRequired')::boolean,true);
 if coalesce(cardinality(v_ids),0)<>1 then raise exception 'Invalid authenticated password update'; end if;
 update public.project_rows r set values=r.values||jsonb_build_object('passwordHash',p_password_hash,'passwordSalt',p_password_salt,'confirmed',true,'profileSetupRequired',false) where r.id=v_ids[1];
end $$;

create or replace function rswtta_private.club_preregistration_protect_account() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if current_setting('rswtta.club_preregister_internal',true)='on' then return coalesce(new,old); end if;
 if (tg_op in('UPDATE','DELETE') and (coalesce((old.values->>'clubPreregistered')::boolean,false) or coalesce((old.values->>'profileSetupRequired')::boolean,false))) or (tg_op in('INSERT','UPDATE') and (coalesce((new.values->>'clubPreregistered')::boolean,false) or coalesce((new.values->>'profileSetupRequired')::boolean,false))) then raise exception 'Protected setup-required account requires setup RPC'; end if;
 return coalesce(new,old);
end $$;

drop policy if exists "prototype public read project_rows" on public.project_rows;
drop policy if exists "prototype public insert project_rows" on public.project_rows;
drop policy if exists "prototype public update project_rows" on public.project_rows;
drop policy if exists "public read non-account project rows" on public.project_rows;
drop policy if exists "public insert non-account project rows" on public.project_rows;
drop policy if exists "public update non-account project rows" on public.project_rows;
create policy "public read non-account project rows" on public.project_rows for select to public using(project_table_id<>'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid);
create policy "public insert non-account project rows" on public.project_rows for insert to public with check(project_table_id<>'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid);
create policy "public update non-account project rows" on public.project_rows for update to public using(project_table_id<>'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid) with check(project_table_id<>'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid);

revoke all on function rswtta_private.parent_setup_identifier_resolution(text) from public,anon,authenticated;
revoke all on function public.parent_legacy_setup_identifier_status(text) from public,anon,authenticated;
revoke all on function public.parent_legacy_setup_login(text,text,text) from public,anon,authenticated;
revoke all on function public.parent_legacy_complete_setup(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.club_legacy_list_parent_accounts(text,text,text) from public,anon,authenticated;
revoke all on function public.parent_sync_authenticated_password(text,text) from public,anon,authenticated;
grant execute on function public.parent_legacy_setup_identifier_status(text) to anon,authenticated;
grant execute on function public.parent_legacy_setup_login(text,text,text) to anon,authenticated;
grant execute on function public.parent_legacy_complete_setup(text,text,jsonb) to anon,authenticated;
grant execute on function public.club_legacy_list_parent_accounts(text,text,text) to anon,authenticated;
grant execute on function public.parent_sync_authenticated_password(text,text) to authenticated;
revoke all on all functions in schema rswtta_private from public,anon,authenticated;
revoke all on all tables in schema rswtta_private from public,anon,authenticated;
insert into rswtta_private.secure_setup_login_rollout_20260914160000(migration_sha256) select null where not exists(select 1 from rswtta_private.secure_setup_login_rollout_20260914160000);

rollback;
