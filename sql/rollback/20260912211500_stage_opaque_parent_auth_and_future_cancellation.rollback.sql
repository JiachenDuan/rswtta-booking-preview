-- Emergency rollback for 20260912211500. Run only before activation or after its
-- fail-closed rollback. This preserves non-credential profile changes and restores
-- only the three credential keys from the verified private backup.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:20260912211500:opaque-auth',0));

do $guard$
declare v_accounts uuid; v_live bigint; v_backup bigint; v_live_hash text; v_backup_hash text;
begin
  select t.id into strict v_accounts from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='parent_accounts';
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,',' order by id),''),'sha256'),'hex') into v_live,v_live_hash from public.project_rows where project_table_id=v_accounts;
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,',' order by id),''),'sha256'),'hex') into v_backup,v_backup_hash from rswtta_private.backup_parent_accounts_20260912211500;
  if v_live<>v_backup or v_live_hash<>v_backup_hash then raise exception 'Rollback refused: account identity set changed'; end if;
end $guard$;

-- Shadow staging never removes public credentials. If this follows the separate
-- fail-closed activation rollback, restore them from the verified backup.
drop trigger if exists reject_public_parent_credentials on public.project_rows;
update public.project_rows live set values=live.values||jsonb_strip_nulls(jsonb_build_object(
  'passwordHash',backup.values->'passwordHash','passwordSalt',backup.values->'passwordSalt','confirmationCode',backup.values->'confirmationCode'))
from rswtta_private.backup_parent_accounts_20260912211500 backup
where live.id=backup.id and live.project_table_id=backup.project_table_id
  and not (live.values ? 'passwordHash' and live.values ? 'passwordSalt');

drop function if exists public.parent_cancel_booking_occurrences(text,text,uuid,text,uuid,timestamptz,text,timestamptz,integer);
drop function if exists public.parent_complete_booking(text,uuid,timestamptz,uuid);
drop function if exists public.parent_request_group_class(text,uuid,uuid);
drop function if exists public.parent_request_booking(text,uuid,jsonb);
drop function if exists public.parent_request_password_reset(text);
drop function if exists public.parent_complete_profile(text,jsonb);
drop function if exists public.parent_update_profile(text,jsonb);
drop function if exists public.parent_issue_operation_nonce(text,text);
drop function if exists public.parent_session_logout(text);
drop function if exists public.parent_session_refresh(text,text,text);
drop function if exists public.parent_session_login(text,text,text);
drop schema rswtta_private cascade;
commit;
