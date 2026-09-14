-- General legacy Parent setup-login repair.
-- Adds private exact aliases only; account/profile/credential rows are not changed by this migration.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:legacy-parent-setup-alias-backfill:v1',0));

do $guard$
declare v_count bigint; v_hash text; v_alias_count bigint; v_alias_hash text; v_old_login text; v_old_complete text;
begin
  perform 1 from public.projects p where p.id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and p.slug='rswtta-booking'; if not found then raise exception 'Project guard failed'; end if;
  if not exists(select 1 from public.project_tables t where t.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and t.id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and t.slug='parent_accounts') then raise exception 'Account table guard failed'; end if;
  if not exists(select 1 from public.project_tables t where t.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and t.id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and t.slug='bookings') then raise exception 'Booking table guard failed'; end if;
  if not exists(select 1 from public.project_tables t where t.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and t.id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid and t.slug='activity_logs') then raise exception 'Activity table guard failed'; end if;
  if not exists(select 1 from public.project_tables t where t.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and t.id='47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid and t.slug='bill_notifications') then raise exception 'Bill table guard failed'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  if v_count<>67 or v_hash<>'d396f350b80f618777e38fea03da7e4edd8178c2fdb8e709505cb37f17e3c970' then raise exception 'Account baseline changed'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid;
  if v_count<>2031 or v_hash<>'81190bcabe9f56c7e88307f29d23235ffef92d62e08ab8e898f96a5ee1f1f1f7' then raise exception 'Booking baseline changed'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid;
  if v_count<>81 or v_hash<>'2c7789642ba9671c3077f6f8694ec843e56be1aeaa524408f7108a48f46585a0' then raise exception 'Activity baseline changed'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id='47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid;
  if v_count<>0 or v_hash<>'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' then raise exception 'Bill baseline changed'; end if;
  if (select count(*) from public.class_package_hours_ledger)<>0 or (select count(*) from public.class_package_keys)<>0 or (select count(*) from public.class_package_events)<>0 then raise exception 'Package baseline changed'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(a.normalized_alias||':'||a.account_id::text,E'\n' order by a.normalized_alias),''),'sha256'),'hex') into v_alias_count,v_alias_hash from rswtta_private.club_preregistration_aliases a;
  if not ((v_alias_count=1 and v_alias_hash='6b6b9166f3908e067b5f9ef4c3444ee1c6849cfaba066400caefd6d469d6045a') or v_alias_count=35) then raise exception 'Alias baseline is neither exact pre-state nor complete post-state'; end if;
  select encode(extensions.digest(convert_to(pg_get_functiondef('public.parent_legacy_setup_login(text,text,text)'::regprocedure),'UTF8'),'sha256'),'hex') into v_old_login;
  select encode(extensions.digest(convert_to(pg_get_functiondef('public.parent_legacy_complete_setup(text,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') into v_old_complete;
  if v_alias_count=1 and (v_old_login<>'e9ebbe34e0a10ba687ad155430229ada5beb0849bbffd3fce474c08816ca8bc4' or v_old_complete<>'e85ee0087d8963f777cc8eace1326e7b0b43e1002fae81fd2b85ae527cd9fea3') then raise exception 'Setup RPC baseline changed'; end if;
  if (select count(*) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and coalesce((r.values->>'profileSetupRequired')::boolean,false))<>37 then raise exception 'Setup population changed'; end if;
  if (select count(*) from (select rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) n from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid group by 1 having count(*)>1) d)<>1 then raise exception 'Duplicate normalized-name groups changed'; end if;
end $guard$;

create table if not exists rswtta_private.legacy_parent_setup_alias_backup_20260914112000 as select a.* from rswtta_private.club_preregistration_aliases a order by a.normalized_alias;
alter table rswtta_private.legacy_parent_setup_alias_backup_20260914112000 enable row level security;
revoke all on rswtta_private.legacy_parent_setup_alias_backup_20260914112000 from public,anon,authenticated;
comment on table rswtta_private.legacy_parent_setup_alias_backup_20260914112000 is 'Exact private alias pre-state for legacy Parent setup repair rollback.';
create table if not exists rswtta_private.legacy_parent_setup_function_backup_20260914112000 as select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') definition_sha256 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('parent_legacy_setup_login','parent_legacy_complete_setup') order by 1;
alter table rswtta_private.legacy_parent_setup_function_backup_20260914112000 enable row level security;
revoke all on rswtta_private.legacy_parent_setup_function_backup_20260914112000 from public,anon,authenticated;
comment on table rswtta_private.legacy_parent_setup_function_backup_20260914112000 is 'Exact setup RPC pre-state for legacy Parent setup repair rollback.';
do $backup_guard$ begin if (select count(*) from rswtta_private.legacy_parent_setup_alias_backup_20260914112000)<>1 or (select count(*) from rswtta_private.legacy_parent_setup_function_backup_20260914112000)<>2 then raise exception 'Backup mismatch'; end if; if has_table_privilege('anon','rswtta_private.legacy_parent_setup_alias_backup_20260914112000','select') or has_table_privilege('authenticated','rswtta_private.legacy_parent_setup_alias_backup_20260914112000','select') or has_table_privilege('anon','rswtta_private.legacy_parent_setup_function_backup_20260914112000','select') or has_table_privilege('authenticated','rswtta_private.legacy_parent_setup_function_backup_20260914112000','select') then raise exception 'Backup browser access was not denied'; end if; end $backup_guard$;

with all_accounts as (
  select r.id,rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) normalized_name,coalesce((r.values->>'profileSetupRequired')::boolean,false) setup_required,count(*) over(partition by rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))) name_count
  from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
), eligible as (select a.normalized_name,a.id from all_accounts a where a.setup_required and a.normalized_name<>'' and a.name_count=1)
insert into rswtta_private.club_preregistration_aliases(normalized_alias,account_id)
select e.normalized_name,e.id from eligible e
where not exists(select 1 from rswtta_private.club_preregistration_aliases x where x.normalized_alias=e.normalized_name and x.account_id<>e.id)
  and not exists(select 1 from rswtta_private.club_preregistration_aliases x where x.account_id=e.id and x.normalized_alias<>e.normalized_name)
on conflict do nothing;

create or replace function public.parent_legacy_setup_login(p_identifier text,p_password text,p_client_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_alias text:=rswtta_private.club_preregistration_alias(coalesce(p_identifier,'')); v_identifier bytea:=rswtta_private.club_preregistration_digest(v_alias); v_client bytea:=rswtta_private.club_preregistration_digest(coalesce(p_client_key,'')); v_account uuid; v_row public.project_rows%rowtype; v_ok boolean; v_token text; v_version bigint;
begin
 if length(v_alias) not between 1 and 160 or length(coalesce(p_password,'')) not between 1 and 1024 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid login'; end if;
 perform pg_advisory_xact_lock(hashtextextended('parent-legacy-setup-login:'||encode(v_identifier,'hex')||':'||encode(v_client,'hex'),0));
 delete from rswtta_private.club_preregistration_login_attempts where attempted_at<clock_timestamp()-interval '1 day';
 if (select count(*) from rswtta_private.club_preregistration_login_attempts a where a.scope='parent_setup' and a.attempted_at>clock_timestamp()-interval '15 minutes' and (a.identifier_digest=v_identifier or a.client_digest=v_client) and not a.succeeded)>=8 then raise exception 'Invalid login'; end if;
 select a.account_id into v_account from rswtta_private.club_preregistration_aliases a where a.normalized_alias=v_alias;
 if v_account is null then perform rswtta_private.club_preregistration_pbkdf2(p_password,decode('000102030405060708090a0b0c0d0e0f','hex'),100000); insert into rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,succeeded) values('parent_setup',v_identifier,v_client,false); raise exception 'Invalid login'; end if;
 select r.* into strict v_row from public.project_rows r where r.id=v_account and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid for update;
 if not coalesce((v_row.values->>'profileSetupRequired')::boolean,false) then raise exception 'Invalid login'; end if;
 v_ok:=rswtta_private.club_preregistration_pbkdf2(p_password,decode(v_row.values->>'passwordSalt','base64'),100000)=decode(v_row.values->>'passwordHash','base64');
 insert into rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,succeeded) values('parent_setup',v_identifier,v_client,v_ok); if not v_ok then raise exception 'Invalid login'; end if;
 v_token:=encode(extensions.gen_random_bytes(32),'hex'); v_version:=coalesce((v_row.values->>'credentialVersion')::bigint,1);
 insert into rswtta_private.club_preregistration_sessions(token_hash,account_id,credential_version,client_digest,expires_at) values(rswtta_private.club_preregistration_digest(v_token),v_account,v_version,v_client,clock_timestamp()+interval '15 minutes');
 return jsonb_build_object('sessionToken',v_token,'account',(v_row.values-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',v_row.id,'createdAt',v_row.created_at),'setupOnly',true);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid login'; end $$;

create or replace function public.parent_legacy_complete_setup(p_session_token text,p_client_key text,p_profile jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_session rswtta_private.club_preregistration_sessions%rowtype; v_row public.project_rows%rowtype; v_name text; v_email text; v_phone text; v_parent text; v_password text; v_salt bytea; v_hash bytea; v_old_hash bytea; v_old_candidate bytea;
begin
 select s.* into strict v_session from rswtta_private.club_preregistration_sessions s where s.token_hash=rswtta_private.club_preregistration_digest(p_session_token) and s.revoked_at is null and s.expires_at>clock_timestamp() and s.client_digest=rswtta_private.club_preregistration_digest(p_client_key) for update;
 select r.* into strict v_row from public.project_rows r where r.id=v_session.account_id and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid for update;
 if not coalesce((v_row.values->>'profileSetupRequired')::boolean,false) or coalesce((v_row.values->>'credentialVersion')::bigint,1)<>v_session.credential_version then raise exception 'Invalid setup session'; end if;
 v_name:=normalize(regexp_replace(btrim(coalesce(p_profile->>'studentName','')),'\s+',' ','g'),NFKC); v_parent:=normalize(btrim(coalesce(p_profile->>'parentName','')),NFKC); v_email:=lower(normalize(btrim(coalesce(p_profile->>'email','')),NFKC)); v_phone:=regexp_replace(normalize(btrim(coalesce(p_profile->>'phone','')),NFKC),'[\s().-]+','','g'); v_password:=coalesce(p_profile->>'password','');
 if char_length(v_name) not between 1 and 120 or char_length(v_password)<6 or (v_email<>'' and v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or (v_phone<>'' and v_phone!~'^\+?[0-9]{7,20}$') then raise exception 'Student name and a different password are required'; end if;
 if not coalesce((v_row.values->>'clubPreregistered')::boolean,false) and (v_email='' or v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or v_phone!~'^\+?[0-9]{7,20}$') then raise exception 'Student name, email, phone, and a different password are required'; end if;
 if v_email<>'' and exists(select 1 from public.project_rows r where r.project_table_id=v_row.project_table_id and r.id<>v_row.id and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_email) then raise exception 'Email already belongs to an account'; end if;
 v_old_hash:=decode(v_row.values->>'passwordHash','base64'); v_hash:=decode(coalesce(p_profile->>'passwordHash',''),'base64'); v_salt:=decode(coalesce(p_profile->>'passwordSalt',''),'base64'); if octet_length(v_hash)<>32 or octet_length(v_salt)<>16 then raise exception 'Invalid replacement credential'; end if; v_old_candidate:=rswtta_private.club_preregistration_pbkdf2(v_password,decode(v_row.values->>'passwordSalt','base64'),100000); if v_old_candidate=v_old_hash then raise exception 'A different password is required'; end if;
 perform set_config('rswtta.club_preregister_internal','on',true);
 update public.project_rows r set values=r.values||jsonb_build_object('studentName',v_name,'parentName',v_parent,'email',v_email,'phone',v_phone,'passwordHash',encode(v_hash,'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmed',true,'profileSetupRequired',false,'credentialVersion',v_session.credential_version+1) where r.id=v_row.id returning * into v_row;
 update rswtta_private.club_preregistration_sessions s set revoked_at=clock_timestamp() where s.account_id=v_row.id and s.revoked_at is null;
 return jsonb_build_object('account',(v_row.values-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',v_row.id,'createdAt',v_row.created_at),'setupOnly',false,'temporaryCredentialInvalidated',true);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid setup session'; end $$;
revoke all on function public.parent_legacy_setup_login(text,text,text) from public,anon,authenticated;
revoke all on function public.parent_legacy_complete_setup(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.parent_legacy_setup_login(text,text,text) to anon,authenticated;
grant execute on function public.parent_legacy_complete_setup(text,text,jsonb) to anon,authenticated;
revoke all on schema rswtta_private from public,anon,authenticated;
revoke all on all tables in schema rswtta_private from public,anon,authenticated;

do $verify$
declare v_count bigint; v_hash text;
begin
  if (select count(*) from rswtta_private.club_preregistration_aliases)<>35 then raise exception 'Expected 35 total private aliases'; end if;
  if (select count(*) from public.project_rows r join rswtta_private.club_preregistration_aliases a on a.account_id=r.id where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and coalesce((r.values->>'profileSetupRequired')::boolean,false))<>35 then raise exception 'Expected 35 setup accounts with private aliases'; end if;
  if (select count(*) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and coalesce((r.values->>'profileSetupRequired')::boolean,false) and not exists(select 1 from rswtta_private.club_preregistration_aliases a where a.account_id=r.id))<>2 then raise exception 'Expected exactly two unresolved duplicate-name setup accounts'; end if;
  if (select array_agg(left(r.id::text,8) order by r.id) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and coalesce((r.values->>'profileSetupRequired')::boolean,false) and not exists(select 1 from rswtta_private.club_preregistration_aliases a where a.account_id=r.id))<>array['3a6d38c0','b8433b38']::text[] then raise exception 'Unresolved setup identities changed'; end if;
  if exists(select 1 from public.project_rows r join rswtta_private.club_preregistration_aliases a on a.account_id=r.id where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and coalesce((r.values->>'profileSetupRequired')::boolean,false) and a.normalized_alias<>rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))) then raise exception 'Setup alias binding mismatch'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid; if v_count<>67 or v_hash<>'d396f350b80f618777e38fea03da7e4edd8178c2fdb8e709505cb37f17e3c970' then raise exception 'Account rows mutated'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid; if v_count<>2031 or v_hash<>'81190bcabe9f56c7e88307f29d23235ffef92d62e08ab8e898f96a5ee1f1f1f7' then raise exception 'Bookings mutated'; end if;
  if has_table_privilege('anon','rswtta_private.club_preregistration_aliases','select') or has_table_privilege('authenticated','rswtta_private.club_preregistration_aliases','select') then raise exception 'Private aliases became browser-readable'; end if;
end $verify$;
commit;
