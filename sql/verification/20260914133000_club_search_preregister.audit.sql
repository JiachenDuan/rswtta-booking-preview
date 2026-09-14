-- Read-only production audit for search-before-preregister rollout.
with tables as (
  select t.id,t.slug from public.project_tables t
  where t.project_id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
), row_stats as (
  select t.slug,t.id as table_id,count(r.*) as row_count,count(distinct r.id) as unique_id_count,
    encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') as ordered_id_hash,
    encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') as canonical_hash
  from tables t left join public.project_rows r on r.project_table_id=t.id
  where t.slug in ('parent_accounts','bookings','activity_logs','bill_notifications')
  group by t.slug,t.id
), function_audit as (
 select p.oid::regprocedure::text as signature, r.rolname as owner, p.prosecdef as security_definer,
   p.proacl::text as acl, encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') as definition_hash
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where n.nspname in ('public','rswtta_private') and p.proname in ('club_preview_student_preregistration','club_preregister_student','club_preregister_student_v2','club_preregistration_preview','club_preregistration_verify_legacy_club','parent_legacy_setup_login','parent_legacy_complete_setup')
), index_audit as (
 select schemaname,tablename,indexname,indexdef from pg_indexes
 where (schemaname='rswtta_private' and tablename like 'club_preregistration%')
    or (schemaname='public' and tablename='project_rows' and indexdef ilike '%preregister%')
 order by 1,2,3
), policy_audit as (
 select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
 where tablename in ('project_rows','club_preregistration_requests','club_preregistration_aliases') order by 1,2,3
), private_counts as (
 select jsonb_build_object(
  'requests',(select count(*) from rswtta_private.club_preregistration_requests),
  'aliases',(select count(*) from rswtta_private.club_preregistration_aliases),
  'sessions',(select count(*) from rswtta_private.club_preregistration_sessions),
  'backup',(select count(*) from rswtta_private.club_preregistration_backup_20260913210000)
 ) value
)
select jsonb_build_object(
 'serverNow',clock_timestamp(),
 'project',jsonb_build_object('id','ab9d8da3-762f-466c-b7ce-fa05088f03cd','slug','rswtta-booking'),
 'tables',(select jsonb_agg(to_jsonb(s) order by s.slug) from row_stats s),
 'functions',(select jsonb_agg(to_jsonb(f) order by f.signature) from function_audit f),
 'indexes',(select jsonb_agg(to_jsonb(i) order by i.schemaname,i.tablename,i.indexname) from index_audit i),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname) from policy_audit p),
 'browserPrivileges',jsonb_build_object(
   'anonProjectRowsInsert',has_table_privilege('anon','public.project_rows','insert'),
   'authenticatedProjectRowsInsert',has_table_privilege('authenticated','public.project_rows','insert'),
   'anonProjectRowsUpdate',has_table_privilege('anon','public.project_rows','update'),
   'authenticatedProjectRowsUpdate',has_table_privilege('authenticated','public.project_rows','update')
 ),
 'privateCounts',(select value from private_counts),
 'backupBrowserReadable',has_table_privilege('anon','rswtta_private.club_preregistration_backup_20260913210000','select') or has_table_privilege('authenticated','rswtta_private.club_preregistration_backup_20260913210000','select')
) as audit;
