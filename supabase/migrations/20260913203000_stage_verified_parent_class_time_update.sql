-- PRODUCTION ROLLOUT. Owner explicitly accepts the pre-existing hobby-project
-- baseline in which anon/authenticated can still UPDATE public.project_rows
-- directly. That legacy path can bypass this RPC. This migration does not make
-- the overall system secure, revoke that legacy access, or add broad grants.
-- The new update-time UI path itself uses a random, expiring, client-bound,
-- revocable parent_legacy_session and derives the immutable account ID server-side.

begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:20260913203000:parent-class-time',0));

do $guard$
declare v_count bigint; v_hash text;
begin
  if to_regprocedure('rswtta_private.club_preregistration_pbkdf2(text,bytea,integer)') is null
    or to_regprocedure('rswtta_private.club_preregistration_digest(text)') is null
    or to_regprocedure('public.rswtta_booking_ends_at(jsonb)') is null
    or to_regprocedure('public.rswtta_canonical_coach_id(text)') is null then
    raise exception 'Reviewed legacy credential or schedule dependencies are absent';
  end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash
    from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035';
  if v_count<>2031 or v_hash<>'24600168527f67767eb244338a7a6c05cbf9daaa09cc236938aa1c5e5e04592a' then raise exception 'Booking freeze changed'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash
    from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707';
  if v_count<>67 or v_hash<>'c21ab2679d1173ee1e9b808d1cb8062689a6d62a4aad9ecb76d3dfc047b731c1' then raise exception 'Account freeze changed'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash
    from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908';
  if v_count<>81 or v_hash<>'6e5939718e28b176c8e88ac006cda910878ed10a1c5af421aef145d35fb64391' then raise exception 'Activity freeze changed'; end if;
  if to_regprocedure('public.parent_legacy_session_login(text,text,text)') is not null
    or to_regprocedure('public.parent_update_booking_time(text,text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text)') is not null then
    raise exception 'Parent legacy session or class-time RPC already exists';
  end if;
end $guard$;

-- Private, rollback-only snapshots. These include every real family whose
-- neutrality is asserted, plus the pre-existing setup session/alias state.
create table rswtta_private.backup_parent_time_bookings_20260913203000 as select * from public.project_rows where project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035';
create table rswtta_private.backup_parent_time_accounts_20260913203000 as select * from public.project_rows where project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707';
create table rswtta_private.backup_parent_time_activity_20260913203000 as select * from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908';
create table rswtta_private.backup_parent_time_bills_20260913203000 as select * from public.project_rows where project_table_id='47f053f4-af24-4e6c-a3ea-984f6bd36943';
create table rswtta_private.backup_parent_time_setup_sessions_20260913203000 as select * from rswtta_private.club_preregistration_sessions;
create table rswtta_private.backup_parent_time_setup_aliases_20260913203000 as select * from rswtta_private.club_preregistration_aliases;
create table rswtta_private.backup_parent_time_package_ledger_20260913203000 as select * from public.class_package_hours_ledger;
create table rswtta_private.backup_parent_time_package_keys_20260913203000 as select * from public.class_package_keys;
create table rswtta_private.backup_parent_time_package_events_20260913203000 as select * from public.class_package_events;

do $backup_acl$
declare v_name text;
begin
  foreach v_name in array array[
    'backup_parent_time_bookings_20260913203000','backup_parent_time_accounts_20260913203000','backup_parent_time_activity_20260913203000',
    'backup_parent_time_bills_20260913203000','backup_parent_time_setup_sessions_20260913203000','backup_parent_time_setup_aliases_20260913203000',
    'backup_parent_time_package_ledger_20260913203000','backup_parent_time_package_keys_20260913203000','backup_parent_time_package_events_20260913203000'] loop
    execute format('alter table rswtta_private.%I enable row level security',v_name);
    execute format('revoke all on rswtta_private.%I from public,anon,authenticated',v_name);
  end loop;
end $backup_acl$;

do $backup_verify$
declare v_count bigint; v_hash text;
begin
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') into v_count,v_hash from rswtta_private.backup_parent_time_bookings_20260913203000;
  if v_count<>2031 or v_hash<>'24600168527f67767eb244338a7a6c05cbf9daaa09cc236938aa1c5e5e04592a' then raise exception 'Booking backup mismatch'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') into v_count,v_hash from rswtta_private.backup_parent_time_accounts_20260913203000;
  if v_count<>67 or v_hash<>'c21ab2679d1173ee1e9b808d1cb8062689a6d62a4aad9ecb76d3dfc047b731c1' then raise exception 'Account backup mismatch'; end if;
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') into v_count,v_hash from rswtta_private.backup_parent_time_activity_20260913203000;
  if v_count<>81 or v_hash<>'6e5939718e28b176c8e88ac006cda910878ed10a1c5af421aef145d35fb64391' then raise exception 'Activity backup mismatch'; end if;
  if (select count(*) from rswtta_private.backup_parent_time_setup_sessions_20260913203000)<>0
    or (select count(*) from rswtta_private.backup_parent_time_setup_aliases_20260913203000)<>1
    or (select count(*) from rswtta_private.backup_parent_time_package_ledger_20260913203000)<>0
    or (select count(*) from rswtta_private.backup_parent_time_package_keys_20260913203000)<>0
    or (select count(*) from rswtta_private.backup_parent_time_package_events_20260913203000)<>0
    or (select count(*) from rswtta_private.backup_parent_time_bills_20260913203000)<>0 then raise exception 'Neutral-family backup mismatch'; end if;
end $backup_verify$;

create table rswtta_private.parent_legacy_sessions(
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash bytea not null unique check(octet_length(token_hash)=32),
  account_id uuid not null references public.project_rows(id) on delete restrict,
  client_digest bytea not null check(octet_length(client_digest)=32),
  credential_fingerprint bytea not null check(octet_length(credential_fingerprint)=32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz
);
create index parent_legacy_sessions_account_active_idx on rswtta_private.parent_legacy_sessions(account_id,expires_at) where revoked_at is null;
create table rswtta_private.parent_class_time_nonces(
  nonce_hash bytea primary key check(octet_length(nonce_hash)=32),
  session_id uuid not null references rswtta_private.parent_legacy_sessions(id) on delete cascade,
  operation text not null check(operation='update_booking_time'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.parent_class_time_idempotency(
  account_id uuid not null references public.project_rows(id) on delete restrict,
  operation text not null check(operation='update_booking_time'),
  idempotency_key uuid not null,
  request_hash bytea not null check(octet_length(request_hash)=32),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(account_id,operation,idempotency_key)
);
alter table rswtta_private.parent_legacy_sessions enable row level security;
alter table rswtta_private.parent_class_time_nonces enable row level security;
alter table rswtta_private.parent_class_time_idempotency enable row level security;
revoke all on rswtta_private.parent_legacy_sessions,rswtta_private.parent_class_time_nonces,rswtta_private.parent_class_time_idempotency from public,anon,authenticated;

create function rswtta_private.parent_legacy_credential_fingerprint(p_values jsonb)
returns bytea language sql immutable strict set search_path=pg_catalog,extensions as $$
 select extensions.digest(convert_to(coalesce(p_values->>'passwordHash','')||'|'||coalesce(p_values->>'passwordSalt',''),'UTF8'),'sha256')
$$;

create function rswtta_private.valid_parent_legacy_session(p_token text,p_client_key text)
returns table(session_id uuid,account_id uuid) language sql security definer
set search_path=pg_catalog,public,extensions,rswtta_private as $$
 select s.id,s.account_id from rswtta_private.parent_legacy_sessions s
 join public.project_rows a on a.id=s.account_id and a.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'
 where s.token_hash=rswtta_private.club_preregistration_digest(p_token)
 and s.client_digest=rswtta_private.club_preregistration_digest(p_client_key)
 and s.revoked_at is null and s.expires_at>clock_timestamp()
 and not coalesce((a.values->>'profileSetupRequired')::boolean,true)
 and coalesce((a.values->>'confirmed')::boolean,false)
 and s.credential_fingerprint=rswtta_private.parent_legacy_credential_fingerprint(a.values)
$$;

create function rswtta_private.parent_legacy_row_json(p_row public.project_rows)
returns jsonb language sql immutable strict set search_path=pg_catalog as $$
 select (coalesce(p_row.values,'{}'::jsonb)-'passwordHash'-'passwordSalt'-'confirmationCode')||jsonb_build_object('id',p_row.id,'createdAt',p_row.created_at,'updatedAt',p_row.updated_at)
$$;

create function rswtta_private.parent_legacy_dashboard(p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,rswtta_private as $$
declare v_account public.project_rows%rowtype; v_own jsonb; v_calendar jsonb;
begin
 select a.* into strict v_account from public.project_rows a where a.id=p_account_id and a.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'
   and not coalesce((a.values->>'profileSetupRequired')::boolean,true) and coalesce((a.values->>'confirmed')::boolean,false);
 select coalesce(jsonb_agg(rswtta_private.parent_legacy_row_json(r) order by r.values->>'startsAt',r.id),'[]'::jsonb) into v_own
 from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035' and r.values->>'studentAccountId'=p_account_id::text;
 select coalesce(jsonb_agg(case when r.values->>'studentAccountId'=p_account_id::text then rswtta_private.parent_legacy_row_json(r)
 else (rswtta_private.parent_legacy_row_json(r)-'studentAccountId'-'studentEmail'-'phone'-'parentNote')||jsonb_build_object('studentName','','familyName','') end order by r.values->>'startsAt',r.id),'[]'::jsonb) into v_calendar
 from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035';
 return jsonb_build_object('account',rswtta_private.parent_legacy_row_json(v_account),'bookings',v_own,'calendarBookings',v_calendar,'serverNow',clock_timestamp());
end $$;

create function public.parent_legacy_session_login(p_identifier text,p_password text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_identifier text:=lower(normalize(btrim(coalesce(p_identifier,'')),NFKC)); v_client bytea; v_matches uuid[]; v_account public.project_rows%rowtype; v_ok boolean; v_token text; v_expiry timestamptz;
begin
 if position('@' in v_identifier)=0 or length(v_identifier) not between 3 and 320 or length(coalesce(p_password,'')) not between 1 and 1024 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid login'; end if;
 v_client:=rswtta_private.club_preregistration_digest(p_client_key);
 perform pg_advisory_xact_lock(hashtextextended('parent-legacy-login:'||encode(rswtta_private.club_preregistration_digest(v_identifier),'hex')||':'||encode(v_client,'hex'),0));
 select array_agg(a.id order by a.id) into v_matches from public.project_rows a where a.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'
   and lower(normalize(btrim(coalesce(a.values->>'email','')),NFKC))=v_identifier
   and not coalesce((a.values->>'profileSetupRequired')::boolean,true) and coalesce((a.values->>'confirmed')::boolean,false);
 if coalesce(cardinality(v_matches),0)<>1 then perform rswtta_private.club_preregistration_pbkdf2(p_password,decode('000102030405060708090a0b0c0d0e0f','hex'),100000); raise exception 'Invalid login'; end if;
 select a.* into strict v_account from public.project_rows a where a.id=v_matches[1] for update;
 v_ok:=rswtta_private.club_preregistration_pbkdf2(p_password,decode(v_account.values->>'passwordSalt','base64'),100000)=decode(v_account.values->>'passwordHash','base64');
 if not v_ok then raise exception 'Invalid login'; end if;
 delete from rswtta_private.parent_legacy_sessions where expires_at<clock_timestamp()-interval '1 day';
 v_token:=encode(extensions.gen_random_bytes(32),'hex'); v_expiry:=clock_timestamp()+interval '12 hours';
 insert into rswtta_private.parent_legacy_sessions(token_hash,account_id,client_digest,credential_fingerprint,expires_at)
 values(rswtta_private.club_preregistration_digest(v_token),v_account.id,v_client,rswtta_private.parent_legacy_credential_fingerprint(v_account.values),v_expiry);
 return jsonb_build_object('sessionToken',v_token,'expiresAt',v_expiry)||rswtta_private.parent_legacy_dashboard(v_account.id);
exception when no_data_found or invalid_text_representation then raise exception 'Invalid login'; end $$;

create function public.parent_legacy_session_resume(p_session_token text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,rswtta_private as $$
declare v_session uuid; v_account uuid;
begin
 select session_id,account_id into strict v_session,v_account from rswtta_private.valid_parent_legacy_session(p_session_token,p_client_key);
 update rswtta_private.parent_legacy_sessions set last_seen_at=clock_timestamp() where id=v_session;
 return rswtta_private.parent_legacy_dashboard(v_account);
exception when no_data_found then raise exception 'Invalid or expired Parent session'; end $$;

create function public.parent_legacy_session_logout(p_session_token text,p_client_key text)
returns void language plpgsql security definer set search_path=pg_catalog,rswtta_private as $$
begin
 update rswtta_private.parent_legacy_sessions set revoked_at=coalesce(revoked_at,clock_timestamp())
 where token_hash=rswtta_private.club_preregistration_digest(p_session_token)
 and client_digest=rswtta_private.club_preregistration_digest(p_client_key);
end $$;

create function public.parent_issue_class_time_update_nonce(p_session_token text,p_client_key text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_session uuid; v_nonce text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  select session_id into strict v_session from rswtta_private.valid_parent_legacy_session(p_session_token,p_client_key);
  delete from rswtta_private.parent_class_time_nonces where expires_at<clock_timestamp();
  insert into rswtta_private.parent_class_time_nonces(nonce_hash,session_id,operation,expires_at)
  values(rswtta_private.club_preregistration_digest(v_nonce),v_session,'update_booking_time',clock_timestamp()+interval '5 minutes');
  return jsonb_build_object('operationNonce',v_nonce,'expiresAt',clock_timestamp()+interval '5 minutes');
exception when no_data_found then raise exception 'Invalid Parent session'; end $$;

create function public.parent_update_booking_time(
  p_session_token text,
  p_client_key text,
  p_operation_nonce text,
  p_selected_booking_id uuid,
  p_idempotency_key uuid,
  p_expected_updated_at timestamptz,
  p_expected_status text,
  p_expected_starts_at timestamptz,
  p_expected_series_id text,
  p_expected_occurrence_id text,
  p_expected_original_starts_at timestamptz,
  p_target_starts_at timestamptz,
  p_target_date_label text,
  p_target_time_label text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare
  v_session uuid; v_account uuid; v_nonce_hash bytea;
  v_project uuid; v_bookings uuid; v_activity uuid; v_selected public.project_rows%rowtype;
  v_now timestamptz:=clock_timestamp(); v_old_end timestamptz; v_duration interval; v_target_end timestamptz;
  v_coach text; v_expected_date text; v_expected_time text; v_start_label text; v_end_label text;
  v_result_status text; v_request_hash bytea; v_existing rswtta_private.parent_class_time_idempotency%rowtype;
  v_updated public.project_rows%rowtype; v_result jsonb;
begin
  if p_idempotency_key is null or p_selected_booking_id is null then raise exception 'Complete request identity is required'; end if;
  select session_id,account_id into strict v_session,v_account from rswtta_private.valid_parent_legacy_session(p_session_token,p_client_key);
  v_request_hash:=extensions.digest(convert_to(concat_ws('|',p_selected_booking_id,p_expected_updated_at,p_expected_status,
    p_expected_starts_at,coalesce(p_expected_series_id,''),coalesce(p_expected_occurrence_id,''),
    coalesce(p_expected_original_starts_at::text,''),p_target_starts_at,p_target_date_label,p_target_time_label),'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended('parent-time-idempotency:'||v_account::text||':'||p_idempotency_key::text,0));
  select * into v_existing from rswtta_private.parent_class_time_idempotency where account_id=v_account
    and operation='update_booking_time' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>v_request_hash then raise exception 'Idempotency key was reused for a different class-time update'; end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;

  v_nonce_hash:=rswtta_private.club_preregistration_digest(p_operation_nonce);
  update rswtta_private.parent_class_time_nonces set consumed_at=v_now where nonce_hash=v_nonce_hash and session_id=v_session
    and operation='update_booking_time' and consumed_at is null and expires_at>v_now;
  if not found then raise exception 'Invalid or expired class-time authorization'; end if;

  select id into strict v_project from public.projects where slug='rswtta-booking';
  select id into strict v_bookings from public.project_tables where project_id=v_project and slug='bookings';
  select id into strict v_activity from public.project_tables where project_id=v_project and slug='activity_logs';
  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-time:global',0));
  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-time:account:'||v_account::text,0));
  select * into strict v_selected from public.project_rows where id=p_selected_booking_id and project_table_id=v_bookings for update;

  if v_selected.values->>'studentAccountId'<>v_account::text then raise exception 'Selected class does not belong to this Parent session'; end if;
  if v_selected.values->>'program' not in ('Private lesson','Group lesson')
    or coalesce(v_selected.values->>'groupClassId','')<>''
    or v_selected.values->>'parentNote' like '%Parent requested to join group class%'
    or v_selected.values->>'parentNote' like '%Added to group class by club%' then
    raise exception 'Only an existing private-class occurrence can be updated';
  end if;
  if v_selected.values->>'status' not in ('requested','change_requested','club_confirmed') then raise exception 'This class is completed, cancelled, or no longer active'; end if;
  if (v_selected.values->>'startsAt')::timestamptz<=v_now+interval '12 hours' then raise exception 'Class time must be strictly more than 12 hours away; contact the Club assistant'; end if;
  if p_target_starts_at<=v_now+interval '12 hours' then raise exception 'New class time must be strictly more than 12 hours away; contact the Club assistant'; end if;
  if extract(second from p_target_starts_at)<>0 or mod(extract(minute from p_target_starts_at)::integer,30)<>0 then raise exception 'Class starts must use 30-minute increments'; end if;

  if v_selected.updated_at<>p_expected_updated_at
    or v_selected.values->>'status'<>p_expected_status
    or (v_selected.values->>'startsAt')::timestamptz<>p_expected_starts_at
    or coalesce(v_selected.values->>'seriesId','')<>coalesce(p_expected_series_id,'')
    or coalesce(v_selected.values->>'recurrenceOccurrenceId','')<>coalesce(p_expected_occurrence_id,'')
    or coalesce(nullif(v_selected.values->>'recurrenceOriginalStartsAt','')::timestamptz,'epoch'::timestamptz)<>coalesce(p_expected_original_starts_at,'epoch'::timestamptz) then
    raise exception 'Selected occurrence changed; reload before updating';
  end if;
  if (coalesce(v_selected.values->>'seriesId','')='')<>(coalesce(v_selected.values->>'recurrenceOccurrenceId','')='')
    or (coalesce(v_selected.values->>'seriesId','')='')<>(coalesce(v_selected.values->>'recurrenceOriginalStartsAt','')='') then
    raise exception 'Selected occurrence has incomplete recurrence identity';
  end if;

  v_old_end:=public.rswtta_booking_ends_at(v_selected.values); v_duration:=v_old_end-p_expected_starts_at;
  if v_duration<interval '30 minutes' or v_duration>interval '12 hours' or mod(extract(epoch from v_duration)::integer,1800)<>0 then raise exception 'Class duration is invalid'; end if;
  v_target_end:=p_target_starts_at+v_duration;
  v_expected_date:=to_char(p_target_starts_at at time zone 'America/Los_Angeles','Dy, Mon FMDD, YYYY');
  v_start_label:=to_char(p_target_starts_at at time zone 'America/Los_Angeles','FMHH12')||case when extract(minute from p_target_starts_at at time zone 'America/Los_Angeles')=0 then '' else to_char(p_target_starts_at at time zone 'America/Los_Angeles',':MI') end||to_char(p_target_starts_at at time zone 'America/Los_Angeles',' AM');
  v_end_label:=to_char(v_target_end at time zone 'America/Los_Angeles','FMHH12')||case when extract(minute from v_target_end at time zone 'America/Los_Angeles')=0 then '' else to_char(v_target_end at time zone 'America/Los_Angeles',':MI') end||to_char(v_target_end at time zone 'America/Los_Angeles',' AM');
  v_expected_time:=v_start_label||' - '||v_end_label;
  if p_target_date_label<>v_expected_date or p_target_time_label<>v_expected_time then raise exception 'Target date/time labels do not match the schedule'; end if;
  if p_target_starts_at=p_expected_starts_at then raise exception 'New class time must differ from the current time'; end if;

  v_coach:=public.rswtta_canonical_coach_id(coalesce(nullif(v_selected.values->>'assignedCoach',''),v_selected.values->>'requestedCoach'));
  perform pg_advisory_xact_lock(hashtextextended('rswtta:parent-time:coach:'||v_coach,0));
  perform 1 from public.project_rows r where r.project_table_id=v_bookings and r.id<>p_selected_booking_id
    and coalesce(r.values->>'status','')<>'cancelled'
    and (public.rswtta_canonical_coach_id(coalesce(nullif(r.values->>'assignedCoach',''),r.values->>'requestedCoach'))=v_coach
      or r.values->>'studentAccountId'=v_account::text)
    order by r.id for update;
  if exists(select 1 from public.project_rows r where r.project_table_id=v_bookings and r.id<>p_selected_booking_id
    and coalesce(r.values->>'status','')<>'cancelled'
    and (public.rswtta_canonical_coach_id(coalesce(nullif(r.values->>'assignedCoach',''),r.values->>'requestedCoach'))=v_coach
      or r.values->>'studentAccountId'=v_account::text)
    and (r.values->>'startsAt')::timestamptz<v_target_end and public.rswtta_booking_ends_at(r.values)>p_target_starts_at)
  then raise exception 'New class time overlaps coach availability or another student class'; end if;

  v_result_status:=case when v_selected.values->>'status'='club_confirmed' then 'change_requested' else v_selected.values->>'status' end;
  update public.project_rows set values=values||jsonb_build_object(
    'startsAt',to_char(p_target_starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'dateLabel',p_target_date_label,'timeLabel',p_target_time_label,'status',v_result_status)
  where id=p_selected_booking_id and project_table_id=v_bookings returning * into strict v_updated;

  -- Production has 81 valid activity rows and all 81 carry no recurrence tuple,
  -- including recurring group-update actions. Keep activity on that convention;
  -- the selected booking retains its complete immutable recurrence identity.
  insert into public.project_rows(project_table_id,values) values(v_activity,jsonb_build_object(
    'action','parent_class_time_updated','message','Parent/student updated one selected private-class occurrence.',
    'studentName','','coach',coalesce(nullif(v_selected.values->>'assignedCoach',''),v_selected.values->>'requestedCoach',''),
    'dateLabel',p_target_date_label,'timeLabel',p_expected_starts_at::text||' -> '||p_target_starts_at::text,'count',1,
    'bookingId',p_selected_booking_id::text,
    'oldStartsAt',p_expected_starts_at,'newStartsAt',p_target_starts_at,
    'oldStatus',p_expected_status,'newStatus',v_result_status,'idempotencyKey',p_idempotency_key::text,'packageDeduction',false));

  v_result:=rswtta_private.parent_legacy_dashboard(v_account)||jsonb_build_object(
    'updatedBooking',rswtta_private.parent_legacy_row_json(v_updated),'replayed',false);
  insert into rswtta_private.parent_class_time_idempotency(account_id,operation,idempotency_key,request_hash,result)
    values(v_account,'update_booking_time',p_idempotency_key,v_request_hash,v_result);
  return v_result;
exception
  when no_data_found then raise exception 'Invalid Parent session or booking';
  when invalid_text_representation or datetime_field_overflow then raise exception 'Invalid class-time request';
end $$;

revoke all on function public.parent_legacy_session_login(text,text,text) from public,anon,authenticated;
revoke all on function public.parent_legacy_session_resume(text,text) from public,anon,authenticated;
revoke all on function public.parent_legacy_session_logout(text,text) from public,anon,authenticated;
revoke all on function public.parent_issue_class_time_update_nonce(text,text) from public,anon,authenticated;
revoke all on function public.parent_update_booking_time(text,text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.parent_legacy_session_login(text,text,text) to anon,authenticated;
grant execute on function public.parent_legacy_session_resume(text,text) to anon,authenticated;
grant execute on function public.parent_legacy_session_logout(text,text) to anon,authenticated;
grant execute on function public.parent_issue_class_time_update_nonce(text,text) to anon,authenticated;
grant execute on function public.parent_update_booking_time(text,text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text) to anon,authenticated;
commit;
