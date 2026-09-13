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
  if exists(select 1 from public.project_rows where project_table_id=v_accounts and values ?| array['passwordHash','passwordSalt','confirmationCode']) then raise exception 'Rollback refused: public credential keys unexpectedly exist'; end if;
end $guard$;

drop trigger if exists reject_public_parent_credentials on public.project_rows;
update public.project_rows live set values=live.values||jsonb_strip_nulls(jsonb_build_object(
  'passwordHash',backup.values->'passwordHash','passwordSalt',backup.values->'passwordSalt','confirmationCode',backup.values->'confirmationCode'))
from rswtta_private.backup_parent_accounts_20260912211500 backup where live.id=backup.id and live.project_table_id=backup.project_table_id;

drop function if exists public.parent_request_booking_v2(text,text,uuid,jsonb);
drop function if exists public.parent_cancel_future_bookings(text,text,uuid,uuid,text,timestamptz,text,timestamptz,integer);
drop function if exists public.parent_complete_password_reset(text,text);
drop function if exists public.parent_begin_password_reset(text);
drop function if exists public.parent_change_password(text,text,text,text);
drop function if exists public.parent_update_account_v2(text,text,jsonb);
drop function if exists public.parent_list_bills(text);
drop function if exists public.parent_list_bookings(text);
drop function if exists public.parent_get_account(text);
drop function if exists public.parent_issue_operation_nonce(text,text);
drop function if exists public.parent_logout(text);
drop function if exists public.parent_refresh_session(text,text);
drop function if exists public.parent_login(text,text,text);
drop schema rswtta_private cascade;
commit;
