begin read only;
with accounts as (
 select count(*) row_count,count(distinct r.id) unique_id_count,
 encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') id_hash,
 encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'table',r.project_table_id,'values',r.values,'created',r.created_at,'updated',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') row_hash
 from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'
), setup as (
 select count(*) setup_required,
 count(*) filter(where exists(select 1 from rswtta_private.club_preregistration_temp_credential c where decode(r.values->>'passwordHash','base64')=c.password_hash and decode(r.values->>'passwordSalt','base64')=c.salt)) temp_family,
 count(*) filter(where not exists(select 1 from rswtta_private.club_preregistration_temp_credential c where decode(r.values->>'passwordHash','base64')=c.password_hash and decode(r.values->>'passwordSalt','base64')=c.salt)) custom_family
 from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707' and coalesce((r.values->>'profileSetupRequired')::boolean,false)
), contracts as (
 select p.oid::regprocedure::text signature,encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') definition_hash,p.proacl::text acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('parent_legacy_setup_identifier_status','parent_legacy_setup_login','parent_legacy_complete_setup','club_legacy_list_parent_accounts','parent_sync_authenticated_password')
), backups as (
 select c.relname,c.relrowsecurity,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='rswtta_private' and c.relname like 'backup_secure_setup_%_20260914160000'
), policies as (
 select policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' and tablename='project_rows'
), alex as (
 select jsonb_build_object(
  'exactAlexMaCount',count(*) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex ma'),
  'exactAlexLiCount',count(*) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex li'),
  'distinctImmutableIds',count(distinct r.id),
  'alexMaUsesSharedTemporaryCredential',bool_or(exists(select 1 from rswtta_private.club_preregistration_temp_credential c where decode(r.values->>'passwordHash','base64')=c.password_hash and decode(r.values->>'passwordSalt','base64')=c.salt)) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex ma'),
  'bindingDigest',encode(extensions.digest(coalesce(string_agg(r.id::text||':'||rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')),E'\n' order by r.id),''),'sha256'),'hex')
 ) value from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707' and rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) in('alex ma','alex li')
)
select jsonb_pretty(jsonb_build_object(
 'serverNow',clock_timestamp(),'accounts',(select to_jsonb(a) from accounts a),'setup',(select to_jsonb(s) from setup s),'alex',(select value from alex),
 'backupAccounts',(select jsonb_build_object('count',count(*),'rowHash',encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'table',r.project_table_id,'values',r.values,'created',r.created_at,'updated',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex')) from rswtta_private.backup_secure_setup_accounts_20260914160000 r),
 'backups',(select jsonb_agg(to_jsonb(b) order by relname) from backups b),'contracts',(select jsonb_agg(to_jsonb(c) order by signature) from contracts c),'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from policies p),
 'resolverAlexMa',public.parent_legacy_setup_identifier_status('alex ma'),
 'resolverAlexFirst',public.parent_legacy_setup_identifier_status('alex'),
 'fixtureRows',(select count(*) from public.project_rows r where r.id::text like 'f1000000-0000-4000-8000-%'),
 'browserFunctionGrants',jsonb_build_object(
   'anonStatus',has_function_privilege('anon','public.parent_legacy_setup_identifier_status(text)','execute'),
   'anonSetupLogin',has_function_privilege('anon','public.parent_legacy_setup_login(text,text,text)','execute'),
   'anonComplete',has_function_privilege('anon','public.parent_legacy_complete_setup(text,text,jsonb)','execute'),
   'anonClubList',has_function_privilege('anon','public.club_legacy_list_parent_accounts(text,text,text)','execute'),
   'anonPasswordSync',has_function_privilege('anon','public.parent_sync_authenticated_password(text,text)','execute'),
   'authenticatedPasswordSync',has_function_privilege('authenticated','public.parent_sync_authenticated_password(text,text)','execute')
 )
));
commit;
