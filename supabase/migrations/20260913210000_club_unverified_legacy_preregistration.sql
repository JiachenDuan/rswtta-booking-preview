-- Authorized narrow legacy exception for this friends-only hobby deployment.
-- SECURITY: this does not create verified Club authentication. Anyone who obtains the
-- browser-shipped legacy Club proof can reach these RPCs. Every audit actor is labeled
-- honestly as club_unverified_legacy. Existing unrelated prototype access is unchanged.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:club-unverified-legacy-preregistration:v1',0));
create extension if not exists pgcrypto;
create schema if not exists rswtta_private;
revoke all on schema rswtta_private from public,anon,authenticated;

do $guard$
declare
  v_project uuid; v_accounts uuid; v_bookings uuid; v_activity uuid; v_bills uuid;
  v_account_count bigint; v_account_hash text; v_booking_count bigint; v_booking_hash text;
  v_activity_count bigint; v_activity_hash text; v_bill_count bigint; v_bill_hash text;
begin
  select p.id into strict v_project from public.projects p where p.id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and p.slug='rswtta-booking';
  select t.id into strict v_accounts from public.project_tables t where t.project_id=v_project and t.id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and t.slug='parent_accounts';
  select t.id into strict v_bookings from public.project_tables t where t.project_id=v_project and t.id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and t.slug='bookings';
  select t.id into strict v_activity from public.project_tables t where t.project_id=v_project and t.id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid and t.slug='activity_logs';
  select t.id into strict v_bills from public.project_tables t where t.project_id=v_project and t.id='47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid and t.slug='bill_notifications';
  select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_account_count,v_account_hash from public.project_rows r where r.project_table_id=v_accounts;
  select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_booking_count,v_booking_hash from public.project_rows r where r.project_table_id=v_bookings;
  select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_activity_count,v_activity_hash from public.project_rows r where r.project_table_id=v_activity;
  select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_bill_count,v_bill_hash from public.project_rows r where r.project_table_id=v_bills;
  if v_account_count<>66 or v_account_hash<>'f6be7a9cb1f442846c2c3876523aadda46c3e532fd4c90843fb1f736b3465199' then raise exception 'Account baseline changed'; end if;
  if v_booking_count<>2030 or v_booking_hash<>'407e270e98895570f0f8949f08b787f7ec8174fc317807da49ba3e9ea384e78b' then raise exception 'Booking baseline changed'; end if;
  if v_activity_count<>78 or v_activity_hash<>'c958b40e4ab872dbdef890392fa3584fdd266dfed9f61cb5bb5f68769d8b12c0' then raise exception 'Activity baseline changed'; end if;
  if v_bill_count<>0 or v_bill_hash<>'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' then raise exception 'Bill baseline changed'; end if;
  if to_regclass('rswtta_private.club_preregistration_backup_20260913210000') is not null
     or to_regprocedure('public.club_preregister_student(text,text,text,uuid,jsonb,text)') is not null then raise exception 'Migration already partially present'; end if;
end $guard$;

-- The only rows the feature may mutate are account/activity rows; preserve both sets.
create table rswtta_private.club_preregistration_backup_20260913210000 as
select r.* from public.project_rows r where r.project_table_id in(
 '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid);
alter table rswtta_private.club_preregistration_backup_20260913210000 enable row level security;
revoke all on rswtta_private.club_preregistration_backup_20260913210000 from public,anon,authenticated;
comment on table rswtta_private.club_preregistration_backup_20260913210000 is 'Private rollback-only backup; includes account credential hashes and must never be browser-readable.';

create table rswtta_private.club_preregistration_temp_credential(
  singleton boolean primary key default true check(singleton),
  algorithm text not null check(algorithm='pbkdf2-sha256'), iterations integer not null check(iterations=100000),
  salt bytea not null check(octet_length(salt)=16), password_hash bytea not null check(octet_length(password_hash)=32)
);
insert into rswtta_private.club_preregistration_temp_credential(singleton,algorithm,iterations,salt,password_hash)
select true,'pbkdf2-sha256',100000,decode(x.password_salt,'base64'),decode(x.password_hash,'base64')
from (
 select r.values->>'passwordSalt' password_salt,r.values->>'passwordHash' password_hash,count(*) family_count
 from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
 and coalesce(r.values->>'passwordSalt','')<>'' and coalesce(r.values->>'passwordHash','')<>''
 group by 1,2 order by count(*) desc,1,2 limit 1
) x where x.family_count>=20 and octet_length(decode(x.password_salt,'base64'))=16 and octet_length(decode(x.password_hash,'base64'))=32;
do $temp_guard$ begin if (select count(*) from rswtta_private.club_preregistration_temp_credential)<>1 then raise exception 'Existing slow salted temporary credential family was not uniquely derivable'; end if; end $temp_guard$;

create table rswtta_private.club_preregistration_aliases(
  normalized_alias text primary key, account_id uuid not null unique references public.project_rows(id), created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.club_preregistration_requests(
  actor text not null check(actor='club_unverified_legacy'), request_key uuid primary key,
  request_hash bytea not null check(octet_length(request_hash)=32), account_id uuid not null unique references public.project_rows(id),
  activity_id uuid not null unique references public.project_rows(id), result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.club_preregistration_sessions(
  token_hash bytea primary key check(octet_length(token_hash)=32), account_id uuid not null references public.project_rows(id),
  credential_version bigint not null, client_digest bytea not null check(octet_length(client_digest)=32),
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.club_preregistration_login_attempts(
  scope text not null check(scope in('club','parent_setup')), identifier_digest bytea not null, client_digest bytea not null,
  attempted_at timestamptz not null default clock_timestamp(), succeeded boolean not null default false
);
create index club_preregistration_login_attempts_window on rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,attempted_at desc);

alter table rswtta_private.club_preregistration_temp_credential enable row level security;
alter table rswtta_private.club_preregistration_aliases enable row level security;
alter table rswtta_private.club_preregistration_requests enable row level security;
alter table rswtta_private.club_preregistration_sessions enable row level security;
alter table rswtta_private.club_preregistration_login_attempts enable row level security;
revoke all on all tables in schema rswtta_private from public,anon,authenticated;

create function rswtta_private.club_preregistration_digest(p_value text) returns bytea language sql immutable strict set search_path=pg_catalog,extensions as $$ select extensions.digest(convert_to(p_value,'UTF8'),'sha256') $$;
create function rswtta_private.club_preregistration_alias(p_value text) returns text language sql immutable strict set search_path=pg_catalog as $$ select lower(normalize(regexp_replace(btrim(p_value),'\s+',' ','g'),NFKC)) $$;
create function rswtta_private.club_preregistration_normalize(p_input jsonb) returns jsonb language plpgsql immutable strict set search_path=pg_catalog as $$
declare v_name text:=normalize(regexp_replace(btrim(coalesce(p_input->>'studentName','')),'\s+',' ','g'),NFKC); v_email text:=lower(normalize(btrim(coalesce(p_input->>'email','')),NFKC)); v_phone text:=regexp_replace(normalize(btrim(coalesce(p_input->>'phone','')),NFKC),'[\s().-]+','','g');
begin
 if char_length(v_name) not between 1 and 120 or v_name~'[[:cntrl:]]' then raise exception 'Invalid student name'; end if;
 if v_email<>'' and v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
 if v_phone<>'' and v_phone!~'^\+?[0-9]{7,20}$' then raise exception 'Invalid phone'; end if;
 return jsonb_build_object('studentName',v_name,'email',v_email,'phone',v_phone);
end $$;

create function rswtta_private.club_preregistration_bytea_xor(p_left bytea,p_right bytea) returns bytea language plpgsql immutable strict set search_path=pg_catalog as $$
declare v_out bytea:=p_left; v_i integer; begin if octet_length(p_left)<>octet_length(p_right) then raise exception 'XOR length mismatch'; end if; for v_i in 0..octet_length(p_left)-1 loop v_out:=set_byte(v_out,v_i,get_byte(p_left,v_i)#get_byte(p_right,v_i)); end loop; return v_out; end $$;
create function rswtta_private.club_preregistration_pbkdf2(p_password text,p_salt bytea,p_iterations integer) returns bytea language plpgsql immutable strict set search_path=pg_catalog,extensions,rswtta_private as $$
declare v_u bytea; v_t bytea; v_i integer; begin if p_iterations<>100000 then raise exception 'Unsupported credential'; end if; v_u:=extensions.hmac(p_salt||decode('00000001','hex'),convert_to(p_password,'UTF8'),'sha256'); v_t:=v_u; for v_i in 2..p_iterations loop v_u:=extensions.hmac(v_u,convert_to(p_password,'UTF8'),'sha256'); v_t:=rswtta_private.club_preregistration_bytea_xor(v_t,v_u); end loop; return v_t; end $$;

create function rswtta_private.club_preregistration_verify_legacy_club(p_identifier text,p_proof text,p_client_key text) returns void language plpgsql security definer set search_path=pg_catalog,extensions,rswtta_private as $$
declare v_identifier bytea:=rswtta_private.club_preregistration_digest(lower(btrim(coalesce(p_identifier,'')))); v_client bytea:=rswtta_private.club_preregistration_digest(coalesce(p_client_key,'')); v_ok boolean;
begin
 if length(coalesce(p_client_key,'')) not between 16 and 256 or length(coalesce(p_proof,'')) not between 1 and 256 then raise exception 'Invalid Club proof'; end if;
 perform pg_advisory_xact_lock(hashtextextended('club-prereg-proof:'||encode(v_identifier,'hex')||':'||encode(v_client,'hex'),0));
 delete from rswtta_private.club_preregistration_login_attempts where attempted_at<clock_timestamp()-interval '1 day';
 if (select count(*) from rswtta_private.club_preregistration_login_attempts a where a.scope='club' and a.attempted_at>clock_timestamp()-interval '15 minutes' and (a.identifier_digest=v_identifier or a.client_digest=v_client) and not a.succeeded)>=8 then raise exception 'Invalid Club proof'; end if;
 v_ok:=lower(btrim(coalesce(p_identifier,'')))='rswtta' and encode(rswtta_private.club_preregistration_digest(p_proof),'hex')='70e7b50f3a730d91a2140e659d4958919947f4e5f5e957c1f2caf11144a572c8';
 insert into rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,succeeded) values('club',v_identifier,v_client,v_ok);
 if not v_ok then raise exception 'Invalid Club proof'; end if;
end $$;

create function rswtta_private.club_preregistration_preview(p_input jsonb) returns jsonb language plpgsql stable strict security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_accounts constant uuid:='8236c8f8-0fab-400c-bedc-143fd5930707'; v_safe jsonb:=rswtta_private.club_preregistration_normalize(p_input); v_rows jsonb; v_version jsonb; v_hash text;
begin
 select coalesce(jsonb_agg(jsonb_build_object('accountId',r.id,'studentName',r.values->>'studentName','emailPresent',coalesce(r.values->>'email','')<>'','phonePresent',coalesce(r.values->>'phone','')<>'','kinds',array_remove(array[case when rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))=rswtta_private.club_preregistration_alias(v_safe->>'studentName') then 'display_name' end,case when v_safe->>'email'<>'' and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_safe->>'email' then 'email' end,case when v_safe->>'phone'<>'' and regexp_replace(normalize(btrim(coalesce(r.values->>'phone','')),NFKC),'[\s().-]+','','g')=v_safe->>'phone' then 'phone' end],null),'updatedAt',r.updated_at) order by r.id),'[]'::jsonb)
 into v_rows from public.project_rows r where r.project_table_id=v_accounts and (rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))=rswtta_private.club_preregistration_alias(v_safe->>'studentName') or (v_safe->>'email'<>'' and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_safe->>'email') or (v_safe->>'phone'<>'' and regexp_replace(normalize(btrim(coalesce(r.values->>'phone','')),NFKC),'[\s().-]+','','g')=v_safe->>'phone'));
 select jsonb_build_object('count',count(*),'maxUpdatedAt',max(r.updated_at),'idHash',encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex')) into v_version from public.project_rows r where r.project_table_id=v_accounts;
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('normalized',v_safe,'collisions',v_rows,'version',v_version)::text,'UTF8'),'sha256'),'hex');
 return jsonb_build_object('normalized',v_safe,'snapshotHash',v_hash,'collisionVersion',v_version,'collisions',v_rows);
end $$;

create function public.club_preview_student_preregistration(p_club_identifier text,p_club_proof text,p_client_key text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,rswtta_private as $$ begin perform rswtta_private.club_preregistration_verify_legacy_club(p_club_identifier,p_club_proof,p_client_key); return rswtta_private.club_preregistration_preview(p_input); end $$;
create function public.club_preregister_student(p_club_identifier text,p_club_proof text,p_client_key text,p_request_key uuid,p_input jsonb,p_duplicate_snapshot_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
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
 insert into public.project_rows(id,project_table_id,values) values(v_account,'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,jsonb_build_object('studentName',v_safe->>'studentName','preregisteredName',v_safe->>'studentName','parentName','','email',v_safe->>'email','phone',v_safe->>'phone','loginAlias',v_alias,'passwordHash',encode(v_credential.password_hash,'base64'),'passwordSalt',encode(v_credential.salt,'base64'),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1));
 insert into rswtta_private.club_preregistration_aliases(normalized_alias,account_id) values(v_alias,v_account);
 insert into public.project_rows(id,project_table_id,values) values(v_activity,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid,jsonb_build_object('action','student_preregistered','message','One pending student preregistration was created.','studentName','','coach','','dateLabel','','timeLabel','','count',1,'accountId',v_account,'actor','club_unverified_legacy'));
 v_result:=jsonb_build_object('accountId',v_account,'activityId',v_activity,'loginAlias',v_alias,'replayed',false,'profileSetupRequired',true,'confirmed',false,'authority','club_unverified_legacy');
 insert into rswtta_private.club_preregistration_requests(actor,request_key,request_hash,account_id,activity_id,result) values('club_unverified_legacy',p_request_key,v_request_hash,v_account,v_activity,v_result);
 return v_result;
end $$;

create function public.parent_legacy_setup_login(p_identifier text,p_password text,p_client_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_alias text:=rswtta_private.club_preregistration_alias(coalesce(p_identifier,'')); v_identifier bytea:=rswtta_private.club_preregistration_digest(v_alias); v_client bytea:=rswtta_private.club_preregistration_digest(coalesce(p_client_key,'')); v_account uuid; v_row public.project_rows%rowtype; v_ok boolean; v_token text; v_version bigint;
begin
 if length(v_alias) not between 1 and 160 or length(coalesce(p_password,'')) not between 1 and 1024 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid login'; end if;
 perform pg_advisory_xact_lock(hashtextextended('parent-legacy-setup-login:'||encode(v_identifier,'hex')||':'||encode(v_client,'hex'),0));
 delete from rswtta_private.club_preregistration_login_attempts where attempted_at<clock_timestamp()-interval '1 day';
 if (select count(*) from rswtta_private.club_preregistration_login_attempts a where a.scope='parent_setup' and a.attempted_at>clock_timestamp()-interval '15 minutes' and (a.identifier_digest=v_identifier or a.client_digest=v_client) and not a.succeeded)>=8 then raise exception 'Invalid login'; end if;
 select a.account_id into v_account from rswtta_private.club_preregistration_aliases a where a.normalized_alias=v_alias;
 if v_account is null then perform rswtta_private.club_preregistration_pbkdf2(p_password,decode('000102030405060708090a0b0c0d0e0f','hex'),100000); insert into rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,succeeded) values('parent_setup',v_identifier,v_client,false); raise exception 'Invalid login'; end if;
 select r.* into strict v_row from public.project_rows r where r.id=v_account and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid for update;
 if not coalesce((v_row.values->>'clubPreregistered')::boolean,false) or not coalesce((v_row.values->>'profileSetupRequired')::boolean,false) then raise exception 'Invalid login'; end if;
 v_ok:=rswtta_private.club_preregistration_pbkdf2(p_password,decode(v_row.values->>'passwordSalt','base64'),100000)=decode(v_row.values->>'passwordHash','base64');
 insert into rswtta_private.club_preregistration_login_attempts(scope,identifier_digest,client_digest,succeeded) values('parent_setup',v_identifier,v_client,v_ok); if not v_ok then raise exception 'Invalid login'; end if;
 v_token:=encode(extensions.gen_random_bytes(32),'hex'); v_version:=coalesce((v_row.values->>'credentialVersion')::bigint,1);
 insert into rswtta_private.club_preregistration_sessions(token_hash,account_id,credential_version,client_digest,expires_at) values(rswtta_private.club_preregistration_digest(v_token),v_account,v_version,v_client,clock_timestamp()+interval '15 minutes');
 return jsonb_build_object('sessionToken',v_token,'account',(v_row.values-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',v_row.id,'createdAt',v_row.created_at),'setupOnly',true);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid login'; end $$;

create function public.parent_legacy_complete_setup(p_session_token text,p_client_key text,p_profile jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_session rswtta_private.club_preregistration_sessions%rowtype; v_row public.project_rows%rowtype; v_name text; v_email text; v_phone text; v_parent text; v_password text; v_salt bytea:=extensions.gen_random_bytes(16); v_hash bytea; v_old_hash bytea;
begin
 select s.* into strict v_session from rswtta_private.club_preregistration_sessions s where s.token_hash=rswtta_private.club_preregistration_digest(p_session_token) and s.revoked_at is null and s.expires_at>clock_timestamp() and s.client_digest=rswtta_private.club_preregistration_digest(p_client_key) for update;
 select r.* into strict v_row from public.project_rows r where r.id=v_session.account_id and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid for update;
 if not coalesce((v_row.values->>'clubPreregistered')::boolean,false) or not coalesce((v_row.values->>'profileSetupRequired')::boolean,false) or coalesce((v_row.values->>'credentialVersion')::bigint,1)<>v_session.credential_version then raise exception 'Invalid setup session'; end if;
 v_name:=normalize(regexp_replace(btrim(coalesce(p_profile->>'studentName','')),'\s+',' ','g'),NFKC); v_parent:=normalize(btrim(coalesce(p_profile->>'parentName','')),NFKC); v_email:=lower(normalize(btrim(coalesce(p_profile->>'email','')),NFKC)); v_phone:=regexp_replace(normalize(btrim(coalesce(p_profile->>'phone','')),NFKC),'[\s().-]+','','g'); v_password:=coalesce(p_profile->>'password','');
 if char_length(v_name) not between 1 and 120 or char_length(v_password)<6 or (v_email<>'' and v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or (v_phone<>'' and v_phone!~'^\+?[0-9]{7,20}$') then raise exception 'Student name and a different password are required'; end if;
 if v_email<>'' and exists(select 1 from public.project_rows r where r.project_table_id=v_row.project_table_id and r.id<>v_row.id and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_email) then raise exception 'Email already belongs to an account'; end if;
 v_old_hash:=decode(v_row.values->>'passwordHash','base64'); v_hash:=rswtta_private.club_preregistration_pbkdf2(v_password,v_salt,100000); if v_hash=v_old_hash or rswtta_private.club_preregistration_pbkdf2(v_password,decode(v_row.values->>'passwordSalt','base64'),100000)=v_old_hash then raise exception 'A different password is required'; end if;
 perform set_config('rswtta.club_preregister_internal','on',true);
 update public.project_rows r set values=r.values||jsonb_build_object('studentName',v_name,'parentName',v_parent,'email',v_email,'phone',v_phone,'passwordHash',encode(v_hash,'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmed',true,'profileSetupRequired',false,'credentialVersion',v_session.credential_version+1) where r.id=v_row.id returning * into v_row;
 update rswtta_private.club_preregistration_sessions s set revoked_at=clock_timestamp() where s.account_id=v_row.id and s.revoked_at is null;
 return jsonb_build_object('account',(v_row.values-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',v_row.id,'createdAt',v_row.created_at),'setupOnly',false,'temporaryCredentialInvalidated',true);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid setup session'; end $$;

create function rswtta_private.club_preregistration_protect_account() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if current_setting('rswtta.club_preregister_internal',true)='on' then return coalesce(new,old); end if;
 if (tg_op in('UPDATE','DELETE') and coalesce((old.values->>'clubPreregistered')::boolean,false)) or (tg_op in('INSERT','UPDATE') and coalesce((new.values->>'clubPreregistered')::boolean,false)) then raise exception 'Protected preregistered account requires setup RPC'; end if;
 return coalesce(new,old);
end $$;
create trigger protect_club_preregistered_account before insert or update or delete on public.project_rows for each row execute function rswtta_private.club_preregistration_protect_account();

do $verify$
declare v_live_count bigint; v_backup_count bigint; v_live_hash text; v_backup_hash text;
begin
 select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.project_table_id,r.id),''),'sha256'),'hex') into v_live_count,v_live_hash from public.project_rows r where r.project_table_id in('8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid);
 select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.project_table_id,r.id),''),'sha256'),'hex') into v_backup_count,v_backup_hash from rswtta_private.club_preregistration_backup_20260913210000 r;
 if v_live_count<>v_backup_count or v_live_hash<>v_backup_hash then raise exception 'Private backup mismatch'; end if;
 if has_table_privilege('anon','rswtta_private.club_preregistration_backup_20260913210000','select') or has_table_privilege('authenticated','rswtta_private.club_preregistration_backup_20260913210000','select') then raise exception 'Backup browser access was not denied'; end if;
end $verify$;

revoke all on all functions in schema rswtta_private from public,anon,authenticated;
revoke all on function public.club_preview_student_preregistration(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.club_preregister_student(text,text,text,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.parent_legacy_setup_login(text,text,text) from public,anon,authenticated;
revoke all on function public.parent_legacy_complete_setup(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.club_preview_student_preregistration(text,text,text,jsonb) to anon,authenticated;
grant execute on function public.club_preregister_student(text,text,text,uuid,jsonb,text) to anon,authenticated;
grant execute on function public.parent_legacy_setup_login(text,text,text) to anon,authenticated;
grant execute on function public.parent_legacy_complete_setup(text,text,jsonb) to anon,authenticated;
revoke all on schema rswtta_private from public,anon,authenticated;
revoke all on all tables in schema rswtta_private from public,anon,authenticated;
commit;
