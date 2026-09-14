-- Read-only, redacted audit. Returns names and short IDs only; never emits contact or credential material.
with
account_rows as (
  select r.id, r.values, r.created_at, r.updated_at,
    rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) normalized_name
  from public.project_rows r
  where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
),
name_counts as (
  select a.normalized_name,count(*) count,array_agg(left(a.id::text,8) order by a.id) short_ids
  from account_rows a where a.normalized_name<>'' group by a.normalized_name
),
account_audit as (
  select jsonb_agg(jsonb_build_object(
    'shortId',left(a.id::text,8),
    'normalizedFullName',a.normalized_name,
    'profileSetupRequired',coalesce((a.values->>'profileSetupRequired')::boolean,false),
    'clubPreregistered',coalesce((a.values->>'clubPreregistered')::boolean,false),
    'confirmed',coalesce((a.values->>'confirmed')::boolean,false),
    'credentialPresent',coalesce(a.values->>'passwordHash','')<>'' and coalesce(a.values->>'passwordSalt','')<>'',
    'credentialFormatValid',octet_length(decode(coalesce(a.values->>'passwordHash',''),'base64'))=32 and octet_length(decode(coalesce(a.values->>'passwordSalt',''),'base64'))=16,
    'accountAliasFieldPresent',btrim(coalesce(a.values->>'loginAlias',''))<>'',
    'privateAliasBound',pa.account_id=a.id,
    'privateAliasEqualsFullName',pa.normalized_alias=a.normalized_name,
    'exactNormalizedNameCount',nc.count,
    'createdAt',a.created_at,
    'updatedAt',a.updated_at
  ) order by a.id) result
  from account_rows a
  join name_counts nc on nc.normalized_name=a.normalized_name
  left join rswtta_private.club_preregistration_aliases pa on pa.account_id=a.id
),
function_audit as (
  select jsonb_agg(jsonb_build_object(
    'signature',p.oid::regprocedure::text,
    'owner',pg_get_userbyid(p.proowner),
    'securityDefiner',p.prosecdef,
    'definitionSha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
    'acl',coalesce(p.proacl::text,'default')
  ) order by p.oid::regprocedure::text) result
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('parent_legacy_setup_login','parent_legacy_complete_setup')
),
table_hashes as (
  select jsonb_object_agg(t.slug,jsonb_build_object('id',t.id,'count',x.count,'sha256',x.sha256) order by t.slug) result
  from public.project_tables t
  join public.projects p on p.id=t.project_id and p.id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and p.slug='rswtta-booking'
  cross join lateral (
    select count(*) count,encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') sha256
    from public.project_rows r where r.project_table_id=t.id
  ) x
  where t.slug in('parent_accounts','bookings','activity_logs','bill_notifications')
),
package_hashes as (
  select jsonb_build_object(
    'class_package_hours_ledger',jsonb_build_object('count',(select count(*) from public.class_package_hours_ledger),'sha256',(select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') from public.class_package_hours_ledger x)),
    'class_package_keys',jsonb_build_object('count',(select count(*) from public.class_package_keys),'sha256',(select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') from public.class_package_keys x)),
    'class_package_events',jsonb_build_object('count',(select count(*) from public.class_package_events),'sha256',(select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') from public.class_package_events x))
  ) result
)
select jsonb_build_object(
  'project',jsonb_build_object('id','ab9d8da3-762f-466c-b7ce-fa05088f03cd','slug','rswtta-booking'),
  'tables',(select result from table_hashes),
  'packages',(select result from package_hashes),
  'accounts',jsonb_build_object(
    'count',(select count(*) from account_rows),
    'setupRequired',(select count(*) from account_rows a where coalesce((a.values->>'profileSetupRequired')::boolean,false)),
    'legacySetupRequired',(select count(*) from account_rows a where coalesce((a.values->>'profileSetupRequired')::boolean,false) and not coalesce((a.values->>'clubPreregistered')::boolean,false)),
    'privateAliasCount',(select count(*) from rswtta_private.club_preregistration_aliases),
    'setupPrivateAliasCoverage',(select count(*) from account_rows a join rswtta_private.club_preregistration_aliases pa on pa.account_id=a.id where coalesce((a.values->>'profileSetupRequired')::boolean,false)),
    'duplicateNormalizedNames',(select coalesce(jsonb_agg(jsonb_build_object('normalizedFullName',n.normalized_name,'count',n.count,'shortIds',n.short_ids) order by n.normalized_name),'[]') from name_counts n where n.count>1),
    'rows',(select result from account_audit)
  ),
  'setupObjects',jsonb_build_object(
    'functions',(select result from function_audit),
    'aliasesRls',(select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='rswtta_private' and c.relname='club_preregistration_aliases'),
    'anonAliasSelect',has_table_privilege('anon','rswtta_private.club_preregistration_aliases','select'),
    'authenticatedAliasSelect',has_table_privilege('authenticated','rswtta_private.club_preregistration_aliases','select'),
    'anonProjectRowsSelect',has_table_privilege('anon','public.project_rows','select'),
    'anonProjectRowsUpdate',has_table_privilege('anon','public.project_rows','update')
  )
) as redacted_audit;
