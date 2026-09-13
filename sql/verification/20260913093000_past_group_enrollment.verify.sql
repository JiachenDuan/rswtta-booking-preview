-- Read-only post-migration verification. Acceptance writes belong only in a rollback-only transaction.
with ids as (select p.id project_id,max(t.id::text) filter(where t.slug='bookings')::uuid bookings,max(t.id::text) filter(where t.slug='parent_accounts')::uuid accounts,max(t.id::text) filter(where t.slug='activity_logs')::uuid activity from public.projects p join public.project_tables t on t.project_id=p.id where p.slug='rswtta-booking' group by p.id), hashes as (select r.project_table_id,count(*) count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) ordered_md5 from public.project_rows r cross join ids i where r.project_table_id in(i.bookings,i.accounts,i.activity) group by r.project_table_id)
select jsonb_pretty(jsonb_build_object(
 'rpc',to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)')::text,
 'security_invoker',not(select prosecdef from pg_proc where oid=to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)')),
 'anon_execute',has_function_privilege('anon','public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)','execute'),
 'authenticated_execute',has_function_privilege('authenticated','public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)','execute'),
 'live_hashes',(select jsonb_agg(to_jsonb(hashes) order by project_table_id) from hashes),
 'backup_hashes',(select jsonb_agg(to_jsonb(m) order by kind) from private_migration_backups.past_group_manifest_20260913_0930 m),
 'active_duplicates',(select count(*) from(select values->>'groupClassId',values->>'studentAccountId' from public.project_rows r cross join ids i where r.project_table_id=i.bookings and values->>'program'='Group enrollment' and coalesce(values->>'status','')<>'cancelled' group by 1,2 having count(*)>1)x),
 'package_keys',(select count(*) from public.class_package_keys),'package_events',(select count(*) from public.class_package_events)
));
