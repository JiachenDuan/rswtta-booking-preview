-- Emergency rollback for 20260912123000_class_package_hours_ledger.sql.
-- Stop rather than destroy audit data if any package credit exists.

begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:class-package-ledger:migration', 0));

do $$
declare v_entries bigint;
begin
  if to_regclass('public.class_package_hours_ledger') is null then
    raise notice 'class_package_hours_ledger is already absent';
    return;
  end if;
  execute 'select count(*) from public.class_package_hours_ledger' into v_entries;
  if v_entries <> 0 then
    raise exception 'Rollback guard failed: ledger contains % immutable entries; preserve data and roll forward instead', v_entries;
  end if;
end;
$$;

drop function if exists public.add_class_package_hours(uuid, integer, text, text, uuid);
drop function if exists public.list_class_package_balances();
drop table if exists public.class_package_hours_ledger;
drop function if exists public.reject_class_package_ledger_mutation();

commit;
