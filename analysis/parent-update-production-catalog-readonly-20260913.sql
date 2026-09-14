-- Read-only production catalog and aggregate data proof for Parent update-time rollout.
-- No DDL/DML. No raw account, booking, alias, credential, token, or contact values returned.
with
project_ids as (
  select p.id project_id,
         min(t.id::text) filter(where t.slug='bookings')::uuid bookings_id,
         min(t.id::text) filter(where t.slug='parent_accounts')::uuid accounts_id,
         min(t.id::text) filter(where t.slug='activity_logs')::uuid activity_id,
         min(t.id::text) filter(where t.slug='bill_notifications')::uuid bills_id
  from public.projects p join public.project_tables t on t.project_id=p.id
  where p.slug='rswtta-booking' group by p.id
),
row_families as (
  select t.slug,
         count(*) row_count,
         count(distinct r.id) unique_id_count,
         encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') ordered_id_sha256,
         encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') canonical_row_sha256
  from public.project_tables t left join public.project_rows r on r.project_table_id=t.id
  join public.projects p on p.id=t.project_id
  where p.slug='rswtta-booking' and t.slug in('bookings','parent_accounts','activity_logs','bill_notifications')
  group by t.slug
),
account_partitions as (
  select jsonb_build_object(
    'total',count(*),
    'confirmed',count(*) filter(where coalesce((r.values->>'confirmed')::boolean,false)),
    'profileSetupRequired',count(*) filter(where coalesce((r.values->>'profileSetupRequired')::boolean,false)),
    'clubPreregistered',count(*) filter(where coalesce((r.values->>'clubPreregistered')::boolean,false)),
    'loginAliasPresent',count(*) filter(where coalesce(r.values->>'loginAlias','')<>''),
    'credentialVersionPresent',count(*) filter(where r.values ? 'credentialVersion'),
    'credentialMissing',count(*) filter(where coalesce(r.values->>'passwordHash','')='' or coalesce(r.values->>'passwordSalt','')=''),
    'credentialShapeFamilies',(
      select coalesce(jsonb_agg(jsonb_build_object('hashLength',x.hash_len,'saltLength',x.salt_len,'count',x.n) order by x.hash_len,x.salt_len),'[]'::jsonb)
      from (select length(coalesce(a.values->>'passwordHash','')) hash_len,length(coalesce(a.values->>'passwordSalt','')) salt_len,count(*) n
            from public.project_rows a,project_ids i where a.project_table_id=i.accounts_id group by 1,2) x
    ),
    'sharedCredentialFamilies',(
      select coalesce(jsonb_agg(jsonb_build_object('familyDigest',x.family_digest,'count',x.n) order by x.family_digest),'[]'::jsonb)
      from (select encode(extensions.digest(convert_to(coalesce(a.values->>'passwordHash','')||'|'||coalesce(a.values->>'passwordSalt',''),'UTF8'),'sha256'),'hex') family_digest,count(*) n
            from public.project_rows a,project_ids i where a.project_table_id=i.accounts_id group by 1 having count(*)>1) x
    ),
    'normalizedAliasDuplicateGroups',(
      select count(*) from (select rswtta_private.club_preregistration_alias(coalesce(a.values->>'loginAlias','')) k
      from public.project_rows a,project_ids i where a.project_table_id=i.accounts_id and coalesce(a.values->>'loginAlias','')<>'' group by 1 having count(*)>1) q
    ),
    'normalizedEmailDuplicateGroups',(
      select count(*) from (select lower(normalize(btrim(coalesce(a.values->>'email','')),NFKC)) k
      from public.project_rows a,project_ids i where a.project_table_id=i.accounts_id and coalesce(a.values->>'email','')<>'' group by 1 having count(*)>1) q
    ),
    'normalizedDisplayNameDuplicateGroups',(
      select count(*) from (select rswtta_private.club_preregistration_alias(coalesce(a.values->>'studentName','')) k
      from public.project_rows a,project_ids i where a.project_table_id=i.accounts_id and coalesce(a.values->>'studentName','')<>'' group by 1 having count(*)>1) q
    )
  ) value from public.project_rows r,project_ids i where r.project_table_id=i.accounts_id
),
private_tables as (
  select n.nspname schema_name,c.relname table_name,c.relrowsecurity rls_enabled,c.relforcerowsecurity force_rls,
         pg_get_userbyid(c.relowner) owner,c.relacl::text acl,
         coalesce((select count(*) from pg_catalog.pg_policy p where p.polrelid=c.oid),0) policy_count,
         coalesce((select jsonb_agg(jsonb_build_object('name',con.conname,'definition',pg_get_constraintdef(con.oid,true)) order by con.conname) from pg_constraint con where con.conrelid=c.oid),'[]'::jsonb) constraints,
         coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb) columns
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in('r','p') and (
    (n.nspname='rswtta_private' and (c.relname like 'club_preregistration_%' or c.relname like 'backup_%' or c.relname like '%session%' or c.relname like '%alias%' or c.relname like '%idempotency%' or c.relname like '%nonce%'))
    or (n.nspname='public' and (c.relname like 'class_package%' or c.relname='project_rows'))
  )
),
functions as (
  select n.nspname schema_name,p.proname function_name,pg_get_function_identity_arguments(p.oid) identity_arguments,
         pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,p.provolatile volatility,p.proacl::text acl,
         pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and (p.proname like 'parent_legacy_%' or p.proname like 'club_preregister%' or p.proname in('rswtta_server_now','rswtta_booking_ends_at','rswtta_canonical_coach_id','parent_update_booking_time','parent_issue_class_time_update_nonce')))
     or (n.nspname='rswtta_private' and (p.proname like 'club_preregistration_%' or p.proname like '%session%' or p.proname like '%alias%' or p.proname like '%token%' or p.proname like '%parent%'))
),
policies as (
  select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
  where (schemaname='rswtta_private' and (tablename like 'club_preregistration_%' or tablename like '%session%' or tablename like '%alias%' or tablename like '%idempotency%' or tablename like '%nonce%'))
     or (schemaname='public' and (tablename='project_rows' or tablename like 'class_package%'))
),
triggers as (
 select n.nspname schema_name,c.relname table_name,t.tgname trigger_name,pg_get_triggerdef(t.oid,true) definition
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where not t.tgisinternal and ((n.nspname='public' and c.relname='project_rows') or n.nspname='rswtta_private')
),
routine_grants as (
 select routine_schema,routine_name,specific_name,grantee,privilege_type from information_schema.routine_privileges
 where grantee in('anon','authenticated','PUBLIC') and (routine_name like 'parent_legacy_%' or routine_name like 'club_preregister%' or routine_name in('rswtta_server_now','rswtta_booking_ends_at','rswtta_canonical_coach_id','parent_update_booking_time','parent_issue_class_time_update_nonce'))
),
table_grants as (
 select table_schema,table_name,grantee,privilege_type from information_schema.table_privileges
 where grantee in('anon','authenticated','PUBLIC') and ((table_schema='public' and (table_name='project_rows' or table_name like 'class_package%')) or table_schema='rswtta_private')
),
private_counts as (
  select jsonb_build_object(
    'aliases',jsonb_build_object('count',(select count(*) from rswtta_private.club_preregistration_aliases),'hash',(select encode(extensions.digest(coalesce(string_agg(jsonb_build_object('normalized_alias_digest',encode(extensions.digest(convert_to(a.normalized_alias,'UTF8'),'sha256'),'hex'),'account_id',a.account_id,'created_at',a.created_at)::text,E'\n' order by a.account_id),''),'sha256'),'hex') from rswtta_private.club_preregistration_aliases a)),
    'sessions',jsonb_build_object('count',(select count(*) from rswtta_private.club_preregistration_sessions),'active',(select count(*) from rswtta_private.club_preregistration_sessions s where s.revoked_at is null and s.expires_at>clock_timestamp()),'hash',(select encode(extensions.digest(coalesce(string_agg(jsonb_build_object('token_digest',encode(extensions.digest(s.token_hash,'sha256'),'hex'),'account_id',s.account_id,'credential_version',s.credential_version,'client_digest_digest',encode(extensions.digest(s.client_digest,'sha256'),'hex'),'expires_at',s.expires_at,'revoked_at',s.revoked_at,'created_at',s.created_at)::text,E'\n' order by s.account_id,s.created_at),''),'sha256'),'hex') from rswtta_private.club_preregistration_sessions s)),
    'requests',jsonb_build_object('count',(select count(*) from rswtta_private.club_preregistration_requests)),
    'loginAttempts',jsonb_build_object('count',(select count(*) from rswtta_private.club_preregistration_login_attempts)),
    'packageLegacyLedger',jsonb_build_object('count',(select count(*) from public.class_package_hours_ledger),'hash',(select encode(extensions.digest(coalesce(string_agg(to_jsonb(l)::text,E'\n' order by l.id),''),'sha256'),'hex') from public.class_package_hours_ledger l)),
    'packageKeys',jsonb_build_object('count',(select count(*) from public.class_package_keys),'hash',(select encode(extensions.digest(coalesce(string_agg(to_jsonb(k)::text,E'\n' order by k.id),''),'sha256'),'hex') from public.class_package_keys k)),
    'packageEvents',jsonb_build_object('count',(select count(*) from public.class_package_events),'hash',(select encode(extensions.digest(coalesce(string_agg(to_jsonb(e)::text,E'\n' order by e.id),''),'sha256'),'hex') from public.class_package_events e))
  ) value
),
backup_catalog as (
  select n.nspname schema_name,c.relname table_name,c.relrowsecurity rls_enabled,c.relacl::text acl,
         pg_total_relation_size(c.oid) bytes
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in('rswtta_private','private_migration_backups') and c.relkind='r' and c.relname like '%backup%'
)
select jsonb_pretty(jsonb_build_object(
  'serverNow',clock_timestamp(),
  'currentDatabase',current_database(),
  'currentUser',current_user,
  'ids',(select to_jsonb(i) from project_ids i),
  'rowFamilies',(select coalesce(jsonb_agg(to_jsonb(r) order by r.slug),'[]'::jsonb) from row_families r),
  'accountPartitions',(select value from account_partitions),
  'privateCounts',(select value from private_counts),
  'tables',(select coalesce(jsonb_agg(to_jsonb(t) order by t.schema_name,t.table_name),'[]'::jsonb) from private_tables t),
  'functions',(select coalesce(jsonb_agg(to_jsonb(f) order by f.schema_name,f.function_name,f.identity_arguments),'[]'::jsonb) from functions f),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]'::jsonb) from policies p),
  'triggers',(select coalesce(jsonb_agg(to_jsonb(t) order by t.schema_name,t.table_name,t.trigger_name),'[]'::jsonb) from triggers t),
  'routineGrants',(select coalesce(jsonb_agg(to_jsonb(g) order by g.routine_schema,g.routine_name,g.grantee),'[]'::jsonb) from routine_grants g),
  'tableGrants',(select coalesce(jsonb_agg(to_jsonb(g) order by g.table_schema,g.table_name,g.grantee,g.privilege_type),'[]'::jsonb) from table_grants g),
  'backupCatalog',(select coalesce(jsonb_agg(to_jsonb(b) order by b.schema_name,b.table_name),'[]'::jsonb) from backup_catalog b)
));
