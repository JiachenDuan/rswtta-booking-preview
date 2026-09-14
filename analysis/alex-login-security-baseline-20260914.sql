-- Read-only production baseline for setup-login routing/security. No credential, contact, alias, or account payload is returned.
with ids as (
  select max(t.id::text) filter (where t.slug='parent_accounts')::uuid accounts_id,
         max(t.id::text) filter (where t.slug='bookings')::uuid bookings_id,
         max(t.id::text) filter (where t.slug='activity_logs')::uuid activity_id,
         max(t.id::text) filter (where t.slug='bill_notifications')::uuid bills_id
  from public.projects p join public.project_tables t on t.project_id=p.id
  where p.slug='rswtta-booking'
), families as (
  select t.slug,count(r.*) row_count,count(distinct r.id) unique_id_count,
    encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') id_hash,
    encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'table',r.project_table_id,'values',r.values,'created',r.created_at,'updated',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') row_hash
  from public.project_tables t join public.projects p on p.id=t.project_id left join public.project_rows r on r.project_table_id=t.id
  where p.slug='rswtta-booking' and t.slug in('parent_accounts','bookings','activity_logs','bill_notifications') group by t.slug
), pages as (
  select slug,page,count(*) row_count,
    encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') id_hash
  from (
    select t.slug,r.id,((row_number() over(partition by t.slug order by r.id)-1)/500)::integer+1 page
    from public.project_tables t join public.projects p on p.id=t.project_id join public.project_rows r on r.project_table_id=t.id
    where p.slug='rswtta-booking' and t.slug in('parent_accounts','bookings','activity_logs','bill_notifications')
  ) q group by slug,page
), setup as (
 select jsonb_build_object(
  'total',count(*),
  'setupRequired',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false)),
  'setupTempFamily',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false) and exists(select 1 from rswtta_private.club_preregistration_temp_credential c where decode(r.values->>'passwordHash','base64')=c.password_hash and decode(r.values->>'passwordSalt','base64')=c.salt)),
  'setupCustom',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false) and not exists(select 1 from rswtta_private.club_preregistration_temp_credential c where decode(r.values->>'passwordHash','base64')=c.password_hash and decode(r.values->>'passwordSalt','base64')=c.salt)),
  'legacyShape',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false) and not coalesce((r.values->>'clubPreregistered')::boolean,false)),
  'preregShape',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false) and coalesce((r.values->>'clubPreregistered')::boolean,false)),
  'missingCredential',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false) and (coalesce(r.values->>'passwordHash','')='' or coalesce(r.values->>'passwordSalt','')='')),
  'incompatibleCredential',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false) and (octet_length(decode(coalesce(r.values->>'passwordHash',''),'base64'))<>32 or octet_length(decode(coalesce(r.values->>'passwordSalt',''),'base64'))<>16))
 ) value from public.project_rows r,ids i where r.project_table_id=i.accounts_id
), alex as (
 select jsonb_build_object(
  'exactAlexMaCount',count(*) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex ma'),
  'exactAlexLiCount',count(*) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex li'),
  'distinctImmutableIds',count(distinct r.id) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) in('alex ma','alex li')),
  'alexMaSetupRequired',bool_or(coalesce((r.values->>'profileSetupRequired')::boolean,false)) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex ma'),
  'alexMaClubPreregistered',bool_or(coalesce((r.values->>'clubPreregistered')::boolean,false)) filter(where rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))='alex ma'),
  'alexMaAliasBindingCount',(select count(*) from rswtta_private.club_preregistration_aliases a where a.account_id in(select x.id from public.project_rows x,ids j where x.project_table_id=j.accounts_id and rswtta_private.club_preregistration_alias(coalesce(x.values->>'studentName',''))='alex ma')),
  'bindingDigest',encode(extensions.digest(coalesce(string_agg((r.id::text||':'||rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))),E'\n' order by r.id),''),'sha256'),'hex')
 ) value from public.project_rows r,ids i where r.project_table_id=i.accounts_id and rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) in('alex ma','alex li')
), funcs as (
 select p.oid::regprocedure::text signature,p.prosecdef security_definer,p.proacl::text acl,
 encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') definition_hash
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('public','rswtta_private') and p.proname in('parent_legacy_setup_login','parent_legacy_complete_setup','parent_legacy_session_login','club_preregistration_alias')
), policies as (
 select policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' and tablename='project_rows'
), grants as (
 select grantee,privilege_type from information_schema.table_privileges where table_schema='public' and table_name='project_rows' and grantee in('PUBLIC','anon','authenticated')
)
select jsonb_pretty(jsonb_build_object(
 'serverNow',clock_timestamp(),'currentUser',current_user,'ids',(select to_jsonb(ids) from ids),
 'families',(select jsonb_agg(to_jsonb(f) order by slug) from families f),
 'pages',(select jsonb_agg(to_jsonb(p) order by slug,page) from pages p),
 'setup',(select value from setup),'alex',(select value from alex),
 'projectRowsAcl',(select c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='project_rows'),
 'rlsEnabled',(select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='project_rows'),
 'tablePrivileges',jsonb_build_object('anonSelect',has_table_privilege('anon','public.project_rows','select'),'anonInsert',has_table_privilege('anon','public.project_rows','insert'),'anonUpdate',has_table_privilege('anon','public.project_rows','update'),'anonDelete',has_table_privilege('anon','public.project_rows','delete'),'authenticatedSelect',has_table_privilege('authenticated','public.project_rows','select')),
 'functions',(select jsonb_agg(to_jsonb(f) order by signature) from funcs f),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by policyname),'[]'::jsonb) from policies p),
 'grants',(select coalesce(jsonb_agg(to_jsonb(g) order by grantee,privilege_type),'[]'::jsonb) from grants g)
));
