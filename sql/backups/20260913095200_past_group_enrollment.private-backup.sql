-- Run and commit before the migration. This is a private, complete, ordered-hash baseline.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:past-group-enrollment:migration',0));
create schema if not exists private_migration_backups;
revoke all on schema private_migration_backups from public,anon,authenticated;
create table private_migration_backups.past_group_bookings_20260913_0952 as select r.* from public.project_rows r join public.project_tables t on t.id=r.project_table_id join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings' order by r.id;
create table private_migration_backups.past_group_accounts_20260913_0952 as select r.* from public.project_rows r join public.project_tables t on t.id=r.project_table_id join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='parent_accounts' order by r.id;
create table private_migration_backups.past_group_activity_20260913_0952 as select r.* from public.project_rows r join public.project_tables t on t.id=r.project_table_id join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='activity_logs' order by r.id;
create table private_migration_backups.past_group_rpc_20260913_0952 as select pg_get_functiondef(p.oid) definition,r.rolname owner_name,p.proacl acl,p.prosecdef security_definer,p.proconfig settings from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)');
create table private_migration_backups.past_group_manifest_20260913_0952 as
select 'bookings' kind,count(*) row_count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by id),'')) ordered_md5 from private_migration_backups.past_group_bookings_20260913_0952 r union all
select 'accounts',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by id),'')) from private_migration_backups.past_group_accounts_20260913_0952 r union all
select 'activity',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by id),'')) from private_migration_backups.past_group_activity_20260913_0952 r;
alter table private_migration_backups.past_group_bookings_20260913_0952 enable row level security;
alter table private_migration_backups.past_group_accounts_20260913_0952 enable row level security;
alter table private_migration_backups.past_group_activity_20260913_0952 enable row level security;
alter table private_migration_backups.past_group_rpc_20260913_0952 enable row level security;
alter table private_migration_backups.past_group_manifest_20260913_0952 enable row level security;
revoke all on all tables in schema private_migration_backups from public,anon,authenticated;
do $$ declare v_counts bigint[]; begin
 select array_agg(row_count order by kind) into v_counts from private_migration_backups.past_group_manifest_20260913_0952;
 if v_counts<>array[65,66,1993]::bigint[] then raise exception 'Private backup count verification failed: %',v_counts; end if;
 if (select count(*) from private_migration_backups.past_group_rpc_20260913_0952)<>1 then raise exception 'Private backup RPC catalog verification failed'; end if;
 if has_schema_privilege('anon','private_migration_backups','usage') or has_schema_privilege('authenticated','private_migration_backups','usage') then raise exception 'Private backup is browser-accessible'; end if;
end $$;
commit;
