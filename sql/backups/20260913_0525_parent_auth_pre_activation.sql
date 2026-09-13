begin;
select pg_advisory_xact_lock(hashtextextended('rswtta-parent-auth-rollout',0));
lock table public.project_rows in share mode;
lock table auth.users in share mode;

do $guard$
declare
  v_project uuid;
  v_account_table uuid;
  v_booking_table uuid;
  v_account_count bigint;
  v_booking_count bigint;
  v_account_hash text;
  v_booking_hash text;
begin
  select id into strict v_project from public.projects where slug='rswtta-booking';
  if v_project <> 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid then raise exception 'project identity drift'; end if;
  select id into strict v_account_table from public.project_tables where project_id=v_project and slug='parent_accounts';
  select id into strict v_booking_table from public.project_tables where project_id=v_project and slug='bookings';
  if v_account_table <> '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid or v_booking_table <> 'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid then raise exception 'table identity drift'; end if;
  select count(*), md5(coalesce(string_agg(id::text||':'||md5(values::text),'|' order by id),'')) into v_account_count,v_account_hash from public.project_rows where project_table_id=v_account_table;
  select count(*), md5(coalesce(string_agg(id::text||':'||md5(values::text),'|' order by id),'')) into v_booking_count,v_booking_hash from public.project_rows where project_table_id=v_booking_table;
  if v_account_count<>65 or v_account_hash<>'b9afa3221a6642c979e81f379fd64a0d' then raise exception 'account baseline drift: % %',v_account_count,v_account_hash; end if;
  if v_booking_count<>1978 or v_booking_hash<>'afb33cf39feb8723785dee69e925b7f1' then raise exception 'booking baseline drift: % %',v_booking_count,v_booking_hash; end if;
  if to_regclass('private_migration_backups.parent_auth_accounts_20260913_0525') is not null
     or to_regclass('private_migration_backups.parent_auth_booking_metadata_20260913_0525') is not null
     or to_regclass('private_migration_backups.parent_auth_auth_metadata_20260913_0525') is not null
     or to_regclass('private_migration_backups.parent_auth_manifest_20260913_0525') is not null then
    raise exception 'backup timestamp already exists';
  end if;
end $guard$;

create table private_migration_backups.parent_auth_accounts_20260913_0525 as
select id,project_table_id,values,created_at,updated_at
from public.project_rows where project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid order by id;

create table private_migration_backups.parent_auth_booking_metadata_20260913_0525 as
select id,project_table_id,
  jsonb_build_object(
    'studentAccountId',values->'studentAccountId','status',values->'status','startsAt',values->'startsAt',
    'seriesId',values->'seriesId','recurrenceOccurrenceId',values->'recurrenceOccurrenceId',
    'recurrenceOriginalStartsAt',values->'recurrenceOriginalStartsAt','groupClassId',values->'groupClassId',
    'parentNote',values->'parentNote'
  ) as values,created_at,updated_at
from public.project_rows where project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid order by id;

create table private_migration_backups.parent_auth_auth_metadata_20260913_0525 as
select id,md5(lower(coalesce(email,''))) as email_md5,created_at,updated_at,email_confirmed_at,last_sign_in_at,banned_until,deleted_at
from auth.users order by id;

create table private_migration_backups.parent_auth_manifest_20260913_0525 as
select clock_timestamp() captured_at,
  (select count(*) from private_migration_backups.parent_auth_accounts_20260913_0525)::bigint account_count,
  (select md5(coalesce(string_agg(id::text||':'||md5(values::text),'|' order by id),'')) from private_migration_backups.parent_auth_accounts_20260913_0525) account_hash,
  (select count(*) from private_migration_backups.parent_auth_booking_metadata_20260913_0525)::bigint booking_count,
  (select md5(coalesce(string_agg(id::text||':'||md5(values::text),'|' order by id),'')) from private_migration_backups.parent_auth_booking_metadata_20260913_0525) booking_hash,
  (select count(*) from private_migration_backups.parent_auth_auth_metadata_20260913_0525)::bigint auth_user_count,
  (select md5(coalesce(string_agg(id::text||':'||email_md5,'|' order by id),'')) from private_migration_backups.parent_auth_auth_metadata_20260913_0525) auth_hash;

alter table private_migration_backups.parent_auth_accounts_20260913_0525 enable row level security;
alter table private_migration_backups.parent_auth_booking_metadata_20260913_0525 enable row level security;
alter table private_migration_backups.parent_auth_auth_metadata_20260913_0525 enable row level security;
alter table private_migration_backups.parent_auth_manifest_20260913_0525 enable row level security;
revoke all on schema private_migration_backups from public,anon,authenticated;
revoke all on all tables in schema private_migration_backups from public,anon,authenticated;

do $verify$
declare v_source_projection text; v_backup_projection text;
begin
  if (select count(*) from private_migration_backups.parent_auth_accounts_20260913_0525)<>65
     or (select count(*) from private_migration_backups.parent_auth_booking_metadata_20260913_0525)<>1978
     or (select count(*) from private_migration_backups.parent_auth_auth_metadata_20260913_0525)<>2
     or (select count(*) from private_migration_backups.parent_auth_manifest_20260913_0525)<>1 then raise exception 'backup count mismatch'; end if;
  if (select account_hash from private_migration_backups.parent_auth_manifest_20260913_0525)<>'b9afa3221a6642c979e81f379fd64a0d' then raise exception 'account backup hash mismatch'; end if;
  select md5(coalesce(string_agg(id::text||':'||md5(jsonb_build_object(
    'studentAccountId',values->'studentAccountId','status',values->'status','startsAt',values->'startsAt',
    'seriesId',values->'seriesId','recurrenceOccurrenceId',values->'recurrenceOccurrenceId',
    'recurrenceOriginalStartsAt',values->'recurrenceOriginalStartsAt','groupClassId',values->'groupClassId',
    'parentNote',values->'parentNote')::text),'|' order by id),'')) into v_source_projection
  from public.project_rows where project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid;
  select booking_hash into v_backup_projection from private_migration_backups.parent_auth_manifest_20260913_0525;
  if v_source_projection<>v_backup_projection then raise exception 'booking backup projection hash mismatch'; end if;
  if has_schema_privilege('anon','private_migration_backups','usage') or has_schema_privilege('authenticated','private_migration_backups','usage') then raise exception 'backup schema exposed'; end if;
end $verify$;
commit;
