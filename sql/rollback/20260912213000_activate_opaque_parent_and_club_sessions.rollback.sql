-- Fail-closed rollback for activation. It removes browser execution of both old
-- and new mutation paths and DOES NOT restore prototype direct-table grants.
-- Restore service only by deploying the reviewed secure client/RPC pair; never
-- restore anonymous project_rows access or caller-supplied identity RPCs.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:20260912213000:activate-opaque-auth',0));
revoke all on function public.parent_session_login(text,text,text) from anon,authenticated;
revoke all on function public.parent_session_refresh(text,text,text) from anon,authenticated;
revoke all on function public.parent_session_logout(text) from anon,authenticated;
revoke all on function public.parent_issue_operation_nonce(text,text) from anon,authenticated;
revoke all on function public.parent_update_profile(text,jsonb) from anon,authenticated;
revoke all on function public.parent_complete_profile(text,jsonb) from anon,authenticated;
revoke all on function public.parent_request_password_reset(text) from anon,authenticated;
revoke all on function public.parent_request_booking(text,uuid,jsonb) from anon,authenticated;
revoke all on function public.parent_request_group_class(text,uuid,uuid) from anon,authenticated;
revoke all on function public.parent_complete_booking(text,uuid,timestamptz,uuid) from anon,authenticated;
revoke all on function public.parent_cancel_booking_occurrences(text,text,uuid,text,uuid,timestamptz,text,timestamptz,integer) from anon,authenticated;
revoke all on function public.club_login(text,text,text) from anon,authenticated;
revoke all on function public.club_refresh_session(text,text) from anon,authenticated;
revoke all on function public.club_logout(text) from anon,authenticated;
revoke all on function public.club_list_rows(text,text) from anon,authenticated;
revoke all on function public.club_insert_row(text,text,uuid,jsonb) from anon,authenticated;
revoke all on function public.club_update_row(text,text,uuid,timestamptz,jsonb) from anon,authenticated;
revoke all on function public.club_delete_row(text,text,uuid,timestamptz) from anon,authenticated;
revoke all on table public.projects,public.project_members,public.project_tables,public.project_columns,public.project_rows from anon,authenticated;
commit;
