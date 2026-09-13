-- Emergency rollback: restore the exact pre-migration RPC only when no enrollment write occurred.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:past-group-enrollment:migration',0));
do $$ declare v_bookings uuid; v_activity uuid; v_definition text; v_owner text; begin
 select t.id into strict v_bookings from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings';
 select t.id into strict v_activity from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='activity_logs';
 if (select count(*) from public.project_rows where project_table_id=v_bookings)<>1993 or (select count(*) from public.project_rows where project_table_id=v_activity)<>66 then raise exception 'Rollback refused: post-migration rows exist; preserve history and roll forward'; end if;
 select definition,owner_name into strict v_definition,v_owner from private_migration_backups.past_group_rpc_20260913_0930;
 execute v_definition;
 execute format('alter function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) owner to %I',v_owner);
end $$;
revoke all on function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) from public;
grant execute on function public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid) to anon,authenticated;
commit;
