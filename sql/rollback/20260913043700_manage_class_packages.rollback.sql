-- Emergency rollback for the category-aware package surface.
-- Safe only before any category key/event exists; otherwise preserve history and roll forward.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:manage-class-packages:migration', 0));

do $$
declare v_keys bigint := 0; v_events bigint := 0;
begin
  if to_regclass('public.class_package_keys') is not null then execute 'select count(*) from public.class_package_keys' into v_keys; end if;
  if to_regclass('public.class_package_events') is not null then execute 'select count(*) from public.class_package_events' into v_events; end if;
  if v_keys <> 0 or v_events <> 0 then
    raise exception 'Rollback guard failed: % package keys and % immutable events exist; preserve history and roll forward instead', v_keys, v_events;
  end if;
end;
$$;

drop function if exists public.set_class_package_opening(uuid, text, integer, integer, bigint, text, text, uuid);
drop function if exists public.list_class_package_history(uuid, text);
drop function if exists public.list_class_package_balances_v2();
drop table if exists public.class_package_events;
drop table if exists public.class_package_keys;
drop function if exists public.reject_class_package_v2_mutation();

-- Restore only the pre-migration legacy grants; its table is retained byte-for-byte.
grant execute on function public.list_class_package_balances() to anon, authenticated;
grant execute on function public.add_class_package_hours(uuid, integer, text, text, uuid) to anon, authenticated;

commit;
