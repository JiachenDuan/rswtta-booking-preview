-- Read-only blocker proof. A verified update RPC cannot provide non-bypassable mutation authority
-- while browser roles retain unrestricted UPDATE of public.project_rows.values.
select jsonb_pretty(jsonb_build_object(
  'serverNow',clock_timestamp(),
  'projectRowsAcl',(select c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='project_rows'),
  'anonTableUpdate',has_table_privilege('anon','public.project_rows','UPDATE'),
  'authenticatedTableUpdate',has_table_privilege('authenticated','public.project_rows','UPDATE'),
  'anonValuesUpdate',has_column_privilege('anon','public.project_rows','values','UPDATE'),
  'authenticatedValuesUpdate',has_column_privilege('authenticated','public.project_rows','values','UPDATE'),
  'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,'roles',p.roles,'command',p.cmd,'using',p.qual,'withCheck',p.with_check) order by p.policyname),'[]'::jsonb) from pg_policies p where p.schemaname='public' and p.tablename='project_rows'),
  'scheduleGuardTriggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true)) order by t.tgname),'[]'::jsonb) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='project_rows' and not t.tgisinternal and (pg_get_triggerdef(t.oid,true) ilike '%startsAt%' or t.tgname ilike '%schedule%' or t.tgname ilike '%time%')),
  'bookings',(select jsonb_build_object('count',count(r.id),'orderedIdSha256',encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex')) from public.project_rows r where r.project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid),
  'accounts',(select jsonb_build_object('count',count(r.id),'orderedIdSha256',encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex')) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid),
  'activity',(select jsonb_build_object('count',count(r.id),'orderedIdSha256',encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex')) from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid)
));
