with ids as (
  select p.id project_id,
    max(t.id::text) filter (where t.slug='bookings')::uuid bookings_id,
    max(t.id::text) filter (where t.slug='parent_accounts')::uuid accounts_id,
    max(t.id::text) filter (where t.slug='activity_logs')::uuid activity_id,
    max(t.id::text) filter (where t.slug='bill_notifications')::uuid bills_id
  from public.projects p join public.project_tables t on t.project_id=p.id
  where p.slug='rswtta-booking' group by p.id
), rows as (
  select r.*, case
    when r.project_table_id=i.bookings_id then 'bookings'
    when r.project_table_id=i.accounts_id then 'accounts'
    when r.project_table_id=i.activity_id then 'activity'
    when r.project_table_id=i.bills_id then 'bills' end kind
  from public.project_rows r cross join ids i
  where r.project_table_id in (i.bookings_id,i.accounts_id,i.activity_id,i.bills_id)
), page_hashes as (
  select kind, page, count(*) count,
    md5(coalesce(string_agg(md5(row_to_json(x)::text), '' order by id),'')) hash,
    min(id::text) first_id, max(id::text) last_id
  from (
    select rows.*, ((row_number() over(partition by kind order by id)-1)/500)::int+1 page from rows
  ) x group by kind,page
), bookings as (select * from rows where kind='bookings'),
blocks as (select * from bookings where values->>'program'='Group class'),
enrollments as (select * from bookings where values->>'program'='Group enrollment'),
accounts as (select * from rows where kind='accounts'),
activity as (select * from rows where kind='activity'),
function_info as (
 select jsonb_agg(jsonb_build_object(
   'signature',p.oid::regprocedure::text,'owner',o.rolname,'security_definer',p.prosecdef,
   'proconfig',p.proconfig,'acl',p.proacl,'definition_md5',md5(pg_get_functiondef(p.oid)),
   'definition',pg_get_functiondef(p.oid)
 ) order by p.oid::regprocedure::text) info
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles o on o.oid=p.proowner
 where n.nspname='public' and p.proname='add_student_to_group_occurrences'
), policy_info as (
 select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'cmd',cmd,'qual',qual,'with_check',with_check) order by tablename,policyname) info
 from pg_policies where schemaname='public' and tablename='project_rows'
)
select jsonb_pretty(jsonb_build_object(
 'audit_timestamp',clock_timestamp(),
 'ids',(select to_jsonb(ids) from ids),
 'totals',(select jsonb_object_agg(kind,c) from (select kind,count(*) c from rows group by kind) q),
 'page_hashes',(select jsonb_agg(to_jsonb(page_hashes) order by kind,page) from page_hashes),
 'booking_statuses',(select jsonb_object_agg(coalesce(status,'<null>'),c) from (select values->>'status' status,count(*) c from bookings group by 1) q),
 'program_statuses',(select jsonb_agg(to_jsonb(q) order by program,status) from (select values->>'program' program,values->>'status' status,count(*) c from bookings group by 1,2) q),
 'group_blocks',jsonb_build_object(
   'count',(select count(*) from blocks),
   'past',(select count(*) from blocks where (values->>'startsAt')::timestamptz<=clock_timestamp()),
   'future',(select count(*) from blocks where (values->>'startsAt')::timestamptz>clock_timestamp()),
   'past_by_status',(select jsonb_object_agg(coalesce(status,'<null>'),c) from (select values->>'status' status,count(*) c from blocks where (values->>'startsAt')::timestamptz<=clock_timestamp() group by 1) q),
   'malformed_identity',(select count(*) from blocks where coalesce(values->>'groupClassId','')='' or coalesce(values->>'seriesId','')='' or coalesce(values->>'recurrenceOccurrenceId','')='' or coalesce(values->>'recurrenceOriginalStartsAt','')='' or coalesce(values->>'startsAt','')=''),
   'noncanonical_group_ids',(select count(*) from (select values->>'groupClassId' gid from blocks group by 1 having count(*)<>1) q),
   'series_count',(select count(distinct values->>'seriesId') from blocks),
   'capacity_fields',(select jsonb_agg(to_jsonb(q) order by field) from (select key field,count(*) rows,count(distinct value) values from blocks cross join lateral jsonb_each_text(values) where lower(key) like '%capacity%' group by key) q)
 ),
 'enrollments',jsonb_build_object(
   'count',(select count(*) from enrollments),
   'past',(select count(*) from enrollments where (values->>'startsAt')::timestamptz<=clock_timestamp()),
   'statuses',(select jsonb_object_agg(coalesce(status,'<null>'),c) from (select values->>'status' status,count(*) c from enrollments group by 1) q),
   'past_statuses',(select jsonb_object_agg(coalesce(status,'<null>'),c) from (select values->>'status' status,count(*) c from enrollments where (values->>'startsAt')::timestamptz<=clock_timestamp() group by 1) q),
   'missing_account',(select count(*) from enrollments where coalesce(values->>'studentAccountId','')=''),
   'orphan_account',(select count(*) from enrollments e where coalesce(e.values->>'studentAccountId','')<>'' and not exists(select 1 from accounts a where a.id=(e.values->>'studentAccountId')::uuid)),
   'orphan_group',(select count(*) from enrollments e where not exists(select 1 from blocks b where b.values->>'groupClassId'=e.values->>'groupClassId')),
   'active_duplicate_groups',(select count(*) from (select values->>'groupClassId',values->>'studentAccountId' from enrollments where coalesce(values->>'status','')<>'cancelled' group by 1,2 having count(*)>1) q),
   'historical_duplicate_groups',(select count(*) from (select values->>'groupClassId',values->>'studentAccountId' from enrollments group by 1,2 having count(*)>1) q),
   'cancelled_rows',(select count(*) from enrollments where values->>'status'='cancelled'),
   'price_by_status',(select jsonb_agg(to_jsonb(q) order by status,price_cents) from (select values->>'status' status,values->>'priceCents' price_cents,count(*) c from enrollments group by 1,2) q)
 ),
 'past_block_lifecycle',(select jsonb_agg(to_jsonb(q) order by block_status,enrollment_status) from (
   select b.values->>'status' block_status,coalesce(e.values->>'status','<none>') enrollment_status,count(*) c
   from blocks b left join enrollments e on e.values->>'groupClassId'=b.values->>'groupClassId'
   where (b.values->>'startsAt')::timestamptz<=clock_timestamp()
   group by 1,2
 ) q),
 'activity_actions',(select jsonb_object_agg(coalesce(action,'<null>'),c) from (select values->>'action' action,count(*) c from activity group by 1) q),
 'group_add_activity',(select count(*) from activity where values->>'action'='group_student_added'),
 'function_info',(select info from function_info),
 'policies',(select info from policy_info),
 'privileges',jsonb_build_object(
   'anon_select',has_table_privilege('anon','public.project_rows','select'),
   'anon_insert',has_table_privilege('anon','public.project_rows','insert'),
   'anon_update',has_table_privilege('anon','public.project_rows','update'),
   'authenticated_select',has_table_privilege('authenticated','public.project_rows','select'),
   'authenticated_insert',has_table_privilege('authenticated','public.project_rows','insert'),
   'authenticated_update',has_table_privilege('authenticated','public.project_rows','update')
 ),
 'package_state',jsonb_build_object(
   'keys',(select count(*) from public.class_package_keys),
   'events',(select count(*) from public.class_package_events),
   'resolver',to_regprocedure('public.resolve_class_package_consumption(jsonb)')::text
 )
)) as audit;
