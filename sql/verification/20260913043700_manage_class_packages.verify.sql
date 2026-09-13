-- Read-only post-migration verification. Safe only after the reviewed migration.
begin read only;

select 'legacy_ledger_rows' check_name,count(*)::text actual,'0' expected from public.class_package_hours_ledger
union all select 'package_keys',count(*)::text,'0 before first approved opening edit' from public.class_package_keys
union all select 'package_events',count(*)::text,'0 before first approved opening edit' from public.class_package_events
union all select 'balance_rows',count(*)::text,'195' from public.list_class_package_balances_v2()
union all select 'zero_balances',count(*) filter(where opening_amount_base_units=0 and adjustment_amount_base_units=0 and usage_amount_base_units=0 and remaining_amount_base_units=0)::text,'195' from public.list_class_package_balances_v2();

select category,unit_basis,count(*) from public.list_class_package_balances_v2() group by category,unit_basis order by category;
-- Expected exactly 65 each: coach_director_private/hours, national_coach_private/hours, group_class/class_credit.

select public.resolve_class_package_consumption('{"id":"verify-private","assignedCoachId":"coach_tian_ye","assignedCoach":"wrong display","program":"Private lesson","startsAt":"2026-09-20T16:00:00Z","timeLabel":"1.5h","status":"coach_confirmed"}'::jsonb) as immutable_id_private,
 public.resolve_class_package_consumption('{"id":"verify-group","groupClassId":"group-1","assignedCoachId":"coach_tian_ye","program":"Group lesson","startsAt":"2026-09-20T16:00:00Z","timeLabel":"2h","status":"coach_confirmed"}'::jsonb) as group_precedence;

select n.nspname schema_name,c.relname,c.relrowsecurity rls_enabled,owner.rolname owner,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles owner on owner.oid=c.relowner
where n.nspname='public' and c.relname in ('class_package_keys','class_package_events') order by c.relname;

select p.proname,pg_get_function_identity_arguments(p.oid) arguments,owner.rolname owner,p.prosecdef security_definer,
 p.provolatile volatility,p.proconfig settings,p.proacl acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles owner on owner.oid=p.proowner
where n.nspname='public' and p.proname in ('list_class_package_balances','add_class_package_hours','list_class_package_balances_v2','list_class_package_history','set_class_package_opening','resolve_class_package_consumption')
order by p.proname,arguments;
-- Resolver must show volatility i (IMMUTABLE), invoker security, and service_role-only EXECUTE.

select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('class_package_keys','class_package_events') order by table_name,grantee,privilege_type;
rollback;
