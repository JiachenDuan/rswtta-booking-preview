with ids as (
 select max(t.id::text) filter(where t.slug='bookings')::uuid bookings,
 max(t.id::text) filter(where t.slug='parent_accounts')::uuid accounts,
 max(t.id::text) filter(where t.slug='activity_logs')::uuid activity
 from public.projects p join public.project_tables t on t.project_id=p.id where p.slug='rswtta-booking'
), live as (
 select 'bookings' kind,count(*) row_count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) ordered_md5 from public.project_rows r cross join ids i where r.project_table_id=i.bookings
 union all select 'accounts',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from public.project_rows r cross join ids i where r.project_table_id=i.accounts
 union all select 'activity',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from public.project_rows r cross join ids i where r.project_table_id=i.activity
)
select jsonb_pretty(jsonb_build_object(
 'rpc_definition_md5',md5(pg_get_functiondef(to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)'))),
 'expected_pre_migration_rpc_md5','b28acdc236e69be7122547beaf5af2a7',
 'live',(select jsonb_agg(to_jsonb(live) order by kind) from live),
 'backup',(select jsonb_agg(to_jsonb(m) order by kind) from private_migration_backups.past_group_manifest_20260913_0952 m),
 'package_keys',(select count(*) from public.class_package_keys),
 'package_events',(select count(*) from public.class_package_events)
)) rollback_proof;
