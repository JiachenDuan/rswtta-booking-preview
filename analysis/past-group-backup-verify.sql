select jsonb_pretty(jsonb_build_object(
 'bookings_table',to_regclass('private_migration_backups.past_group_bookings_20260913_0952')::text,
 'accounts_table',to_regclass('private_migration_backups.past_group_accounts_20260913_0952')::text,
 'activity_table',to_regclass('private_migration_backups.past_group_activity_20260913_0952')::text,
 'rpc_table',to_regclass('private_migration_backups.past_group_rpc_20260913_0952')::text,
 'manifest_table',to_regclass('private_migration_backups.past_group_manifest_20260913_0952')::text,
 'manifest',(select jsonb_agg(to_jsonb(m) order by kind) from private_migration_backups.past_group_manifest_20260913_0952 m),
 'source_hashes',(
   with ids as (select max(t.id::text) filter(where t.slug='bookings')::uuid bookings,max(t.id::text) filter(where t.slug='parent_accounts')::uuid accounts,max(t.id::text) filter(where t.slug='activity_logs')::uuid activity from public.projects p join public.project_tables t on t.project_id=p.id where p.slug='rswtta-booking')
   select jsonb_agg(to_jsonb(x) order by kind) from (
     select 'bookings' kind,count(*) row_count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) ordered_md5 from public.project_rows r cross join ids i where r.project_table_id=i.bookings
     union all select 'accounts',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from public.project_rows r cross join ids i where r.project_table_id=i.accounts
     union all select 'activity',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from public.project_rows r cross join ids i where r.project_table_id=i.activity
   ) x
 ),
 'rpc_rows',(select count(*) from private_migration_backups.past_group_rpc_20260913_0952),
 'anon_schema_usage',has_schema_privilege('anon','private_migration_backups','usage'),
 'authenticated_schema_usage',has_schema_privilege('authenticated','private_migration_backups','usage'),
 'rls',(select jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private_migration_backups' and c.relname like 'past_group_%_20260913_0952')
)) backup_verification;
