-- Read-only post-migration verification. Safe to run only after the reviewed migration.
begin read only;

select 'legacy_ledger_rows' as check_name, count(*)::text as actual, '0' as expected
from public.class_package_hours_ledger
union all
select 'package_keys', count(*)::text, '0 before first approved opening edit' from public.class_package_keys
union all
select 'package_events', count(*)::text, '0 before first approved opening edit' from public.class_package_events
union all
select 'balance_rows', count(*)::text, '195' from public.list_class_package_balances_v2()
union all
select 'zero_balances', count(*) filter (where opening_minutes = 0 and adjustment_minutes = 0 and usage_minutes = 0 and remaining_minutes = 0)::text, '195'
from public.list_class_package_balances_v2();

select n.nspname as schema_name, c.relname, c.relrowsecurity as rls_enabled, owner.rolname as owner,
  c.relacl
from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_roles owner on owner.oid = c.relowner
where n.nspname = 'public' and c.relname in ('class_package_keys', 'class_package_events')
order by c.relname;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments, owner.rolname as owner,
  p.prosecdef as security_definer, p.proconfig as settings, p.proacl as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles owner on owner.oid = p.proowner
where n.nspname = 'public' and p.proname in (
  'list_class_package_balances', 'add_class_package_hours',
  'list_class_package_balances_v2', 'list_class_package_history', 'set_class_package_opening'
)
order by p.proname, arguments;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('class_package_keys', 'class_package_events')
order by table_name, grantee, privilege_type;

rollback;
