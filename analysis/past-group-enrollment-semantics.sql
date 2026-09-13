with ids as (
  select p.id project_id,
    max(t.id::text) filter (where t.slug='bookings')::uuid bookings_id,
    max(t.id::text) filter (where t.slug='parent_accounts')::uuid accounts_id,
    max(t.id::text) filter (where t.slug='activity_logs')::uuid activity_id,
    max(t.id::text) filter (where t.slug='bill_notifications')::uuid bills_id
  from public.projects p join public.project_tables t on t.project_id=p.id
  where p.slug='rswtta-booking' group by p.id
), blocks as (
 select r.* from public.project_rows r cross join ids i
 where r.project_table_id=i.bookings_id and r.values->>'program'='Group class'
), enrollments as (
 select r.* from public.project_rows r cross join ids i
 where r.project_table_id=i.bookings_id and r.values->>'program'='Group enrollment'
), past as (
 select b.id block_id,b.values->>'groupClassId' group_class_id,b.values->>'seriesId' series_id,
   b.values->>'recurrenceOccurrenceId' occurrence_id,b.values->>'recurrenceOriginalStartsAt' original_starts_at,
   b.values->>'startsAt' starts_at,b.values->>'dateLabel' date_label,b.values->>'timeLabel' time_label,
   coalesce(nullif(b.values->>'assignedCoach',''),b.values->>'requestedCoach') coach,
   b.values->>'status' block_status,
   count(e.*) enrollment_count,
   count(*) filter(where e.values->>'status'='cancelled') cancelled_count,
   count(*) filter(where e.values->>'status'='club_confirmed') confirmed_count,
   count(*) filter(where e.values->>'status'='coach_confirmed') attended_count,
   array_agg(distinct e.values->>'priceCents') filter(where e.id is not null) prices
 from blocks b left join enrollments e on e.values->>'groupClassId'=b.values->>'groupClassId'
 where (b.values->>'startsAt')::timestamptz<=clock_timestamp()
 group by b.id,b.values order by (b.values->>'startsAt')::timestamptz,b.id
), hashes as (
 select 'bookings' kind,count(*) count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) hash
 from public.project_rows r cross join ids i where r.project_table_id=i.bookings_id
 union all
 select 'accounts',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),''))
 from public.project_rows r cross join ids i where r.project_table_id=i.accounts_id
 union all
 select 'activity',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),''))
 from public.project_rows r cross join ids i where r.project_table_id=i.activity_id
 union all
 select 'bills',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),''))
 from public.project_rows r cross join ids i where r.project_table_id=i.bills_id
 union all
 select 'package_keys',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from public.class_package_keys r
 union all
 select 'package_events',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from public.class_package_events r
), duplicates as (
 select e.values->>'groupClassId' group_class_id,e.values->>'studentAccountId' student_account_id,
   count(*) count,array_agg(e.id order by e.id) row_ids,array_agg(e.values->>'status' order by e.id) statuses
 from enrollments e group by 1,2 having count(*)>1
)
select jsonb_pretty(jsonb_build_object(
 'timestamp',clock_timestamp(),
 'hashes',(select jsonb_agg(to_jsonb(hashes) order by kind) from hashes),
 'past_blocks',(select jsonb_agg(to_jsonb(past) order by starts_at,block_id) from past),
 'historical_duplicates',(select jsonb_agg(to_jsonb(duplicates) order by group_class_id,student_account_id) from duplicates),
 'status_semantics',jsonb_build_object(
   'report_eligible_statuses',array['club_confirmed','coach_confirmed'],
   'package_eligible_status','coach_confirmed',
   'package_resolver_volatility',(select p.provolatile from pg_proc p where p.oid=to_regprocedure('public.resolve_class_package_consumption(jsonb)')),
   'package_resolver_definition_md5',(select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid=to_regprocedure('public.resolve_class_package_consumption(jsonb)')),
   'package_writer_references',(select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.oid<>to_regprocedure('public.resolve_class_package_consumption(jsonb)') and pg_get_functiondef(p.oid) ilike '%class_package_events%')
 ),
 'rpc_grants',jsonb_build_object(
   'anon',has_function_privilege('anon','public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)','execute'),
   'authenticated',has_function_privilege('authenticated','public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)','execute'),
   'service_role',has_function_privilege('service_role','public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)','execute')
 )
)) evidence;
