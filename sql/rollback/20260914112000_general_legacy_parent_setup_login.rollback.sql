begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:legacy-parent-setup-alias-backfill:v1',0));

do $guard$
begin
  if to_regclass('rswtta_private.legacy_parent_setup_alias_backup_20260914112000') is null or to_regclass('rswtta_private.legacy_parent_setup_function_backup_20260914112000') is null then raise exception 'Rollback backup is absent'; end if;
  if (select count(*) from rswtta_private.club_preregistration_aliases)<>35 then raise exception 'Rollback refused: alias post-state changed'; end if;
  if (select count(*) from rswtta_private.legacy_parent_setup_alias_backup_20260914112000)<>1 or (select count(*) from rswtta_private.legacy_parent_setup_function_backup_20260914112000)<>2 then raise exception 'Rollback backup mismatch'; end if;
  if (select count(*) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid)<>67 then raise exception 'Rollback refused: account count changed'; end if;
end $guard$;

do $restore_functions$
declare v_definition text;
begin
  for v_definition in select b.definition from rswtta_private.legacy_parent_setup_function_backup_20260914112000 b order by b.signature loop execute v_definition; end loop;
end $restore_functions$;

delete from rswtta_private.club_preregistration_aliases a
where not exists(select 1 from rswtta_private.legacy_parent_setup_alias_backup_20260914112000 b where b.normalized_alias=a.normalized_alias and b.account_id=a.account_id)
  and exists(
    select 1 from public.project_rows r
    where r.id=a.account_id and r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
      and coalesce((r.values->>'profileSetupRequired')::boolean,false)
      and a.normalized_alias=rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))
  );

do $verify$
declare v_count bigint; v_hash text;
begin
  select count(*),encode(extensions.digest(coalesce(string_agg(a.normalized_alias||':'||a.account_id::text,E'\n' order by a.normalized_alias),''),'sha256'),'hex') into v_count,v_hash from rswtta_private.club_preregistration_aliases a;
  if v_count<>1 or v_hash<>'6b6b9166f3908e067b5f9ef4c3444ee1c6849cfaba066400caefd6d469d6045a' then raise exception 'Alias rollback mismatch'; end if;
  if encode(extensions.digest(convert_to(pg_get_functiondef('public.parent_legacy_setup_login(text,text,text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'e9ebbe34e0a10ba687ad155430229ada5beb0849bbffd3fce474c08816ca8bc4' then raise exception 'Setup login rollback mismatch'; end if;
  if encode(extensions.digest(convert_to(pg_get_functiondef('public.parent_legacy_complete_setup(text,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex')<>'e85ee0087d8963f777cc8eace1326e7b0b43e1002fae81fd2b85ae527cd9fea3' then raise exception 'Setup completion rollback mismatch'; end if;
end $verify$;

drop table rswtta_private.legacy_parent_setup_function_backup_20260914112000;
drop table rswtta_private.legacy_parent_setup_alias_backup_20260914112000;
commit;
