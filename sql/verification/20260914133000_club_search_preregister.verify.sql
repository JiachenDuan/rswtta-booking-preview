with stats as (
 select r.project_table_id,count(*) row_count,encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') id_hash
 from public.project_rows r where r.project_table_id in('8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,'a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid,'47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid) group by r.project_table_id
), backup as (
 select count(*) row_count,encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.project_table_id,r.id),''),'sha256'),'hex') row_hash from rswtta_private.club_search_preregister_backup_20260914133000 r
)
select jsonb_build_object(
 'stats',(select jsonb_agg(to_jsonb(s) order by s.project_table_id) from stats s),
 'backup',(select to_jsonb(b) from backup b),
 'objects',jsonb_build_object('search',to_regprocedure('public.club_search_students(text,text,text,text)'),'preview',to_regprocedure('public.club_preview_student_preregistration_v2(text,text,text,uuid,jsonb)'),'create',to_regprocedure('public.club_preregister_student_v3(text,text,text,uuid,text,text,jsonb,text,boolean)'),'emailIndex',to_regclass('public.project_rows_unique_parent_email_claim'),'aliasIndex',to_regclass('public.project_rows_unique_parent_login_alias_claim')),
 'grants',jsonb_build_object('v3Anon',has_function_privilege('anon','public.club_preregister_student_v3(text,text,text,uuid,text,text,jsonb,text,boolean)','execute'),'v3Auth',has_function_privilege('authenticated','public.club_preregister_student_v3(text,text,text,uuid,text,text,jsonb,text,boolean)','execute'),'v2Anon',has_function_privilege('anon','public.club_preregister_student_v2(text,text,text,uuid,jsonb,text)','execute')),
 'backupBrowserReadable',has_table_privilege('anon','rswtta_private.club_search_preregister_backup_20260914133000','select') or has_table_privilege('authenticated','rswtta_private.club_search_preregister_backup_20260914133000','select'),
 'requestCount',(select count(*) from rswtta_private.club_preregistration_requests),
 'fixtureCount',(select count(*) from public.project_rows r where r.id::text like '00000000-0000-4000-8000-0000000019%')
) verification;
