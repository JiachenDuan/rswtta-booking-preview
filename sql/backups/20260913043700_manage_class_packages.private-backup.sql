-- Run and verify this private backup BEFORE the manage-packages migration.
-- It intentionally fails if this timestamped backup already exists.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:manage-class-packages:migration', 0));

create schema if not exists private_migration_backups;
revoke all on schema private_migration_backups from public, anon, authenticated;

create table private_migration_backups.club_package_accounts_20260913_0437 as
select r.* from public.project_rows r
where r.project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
order by r.id;

create table private_migration_backups.club_package_legacy_ledger_20260913_0437 as
select * from public.class_package_hours_ledger order by id;

create table private_migration_backups.club_package_catalog_20260913_0437 as
select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_functiondef(p.oid) as definition, r.rolname as owner, p.prosecdef as security_definer,
  p.proconfig as settings, p.proacl as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
where n.nspname = 'public' and p.proname in ('list_class_package_balances', 'add_class_package_hours')
order by p.proname, identity_arguments;

create table private_migration_backups.club_package_manifest_20260913_0437 (
  key text primary key,
  value text not null
);
insert into private_migration_backups.club_package_manifest_20260913_0437(key, value) values
  ('project_id', 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'),
  ('account_table_id', '8236c8f8-0fab-400c-bedc-143fd5930707'),
  ('account_count', '65'),
  ('account_client_page_md5_500', '889ef52e232d48fec0a2da04bf33992a'),
  ('duplicate_ella_ids', '3a6d38c0-a343-42fe-b373-e1649928041d,b8433b38-75f0-4e37-8792-3b952d26c74d'),
  ('booking_count', '1978'),
  ('booking_client_page_1_md5_500', 'cb9afd75e44d3e82472df227e20906b4'),
  ('booking_client_page_2_md5_500', '39d959e808832d51416426eb12e4a92f'),
  ('booking_client_page_3_md5_500', '0b91e1fc9c8c0eaf07843eaf688af463'),
  ('booking_client_page_4_md5_478', 'b7481b76c02d0031443cf41335b17e5b'),
  ('bill_count', '0'),
  ('activity_count', '65'),
  ('activity_client_page_md5_500', 'c4e86cb519690b3fc148265ac0d80a73'),
  ('legacy_ledger_count', '0'),
  ('category_key_count', '0'),
  ('category_event_count', '0'),
  ('audit_timestamp', '2026-09-12T21:36:00-07:00');

alter table private_migration_backups.club_package_accounts_20260913_0437 enable row level security;
alter table private_migration_backups.club_package_legacy_ledger_20260913_0437 enable row level security;
alter table private_migration_backups.club_package_catalog_20260913_0437 enable row level security;
alter table private_migration_backups.club_package_manifest_20260913_0437 enable row level security;
revoke all on all tables in schema private_migration_backups from public, anon, authenticated;

do $$
declare
  v_accounts bigint;
  v_legacy bigint;
  v_source_hash text;
  v_backup_hash text;
  v_catalog bigint;
begin
  select count(*), md5(coalesce(string_agg(md5(row_to_json(r)::text), '' order by id), ''))
  into v_accounts, v_backup_hash
  from private_migration_backups.club_package_accounts_20260913_0437 r;
  select md5(coalesce(string_agg(md5(row_to_json(r)::text), '' order by id), ''))
  into v_source_hash from public.project_rows r
  where project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  if v_accounts <> 65 or v_backup_hash is distinct from v_source_hash then
    raise exception 'Private backup account verification failed: count %, source/backup digest %/%', v_accounts, v_source_hash, v_backup_hash;
  end if;
  select count(*) into v_legacy from private_migration_backups.club_package_legacy_ledger_20260913_0437;
  if v_legacy <> 0 then raise exception 'Private backup expected zero legacy ledger rows, found %', v_legacy; end if;
  select count(*) into v_catalog from private_migration_backups.club_package_catalog_20260913_0437;
  if v_catalog <> 2 then raise exception 'Private backup expected two legacy RPC definitions, found %', v_catalog; end if;
  if has_schema_privilege('anon', 'private_migration_backups', 'usage')
    or has_schema_privilege('authenticated', 'private_migration_backups', 'usage') then
    raise exception 'Private backup schema is reachable by browser roles';
  end if;
end;
$$;

commit;
