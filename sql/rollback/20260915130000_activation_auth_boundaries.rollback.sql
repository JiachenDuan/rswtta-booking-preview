-- Roll back only the additive activation wrappers. No data is deleted.
begin;
do $$ begin
  if exists(select 1 from rswtta_private.club_preregistration_requests where actor='trusted_operator') then
    raise exception 'Refuse rollback while trusted operator preregistration records exist';
  end if;
end $$;
drop function if exists public.operator_create_student_preregistration(uuid,text,text,jsonb,text,boolean);
drop function if exists public.parent_verified_complete_booking(text,text,uuid,jsonb);
drop function if exists public.parent_verified_cancel_booking(text,text,uuid,jsonb);
drop function if exists public.parent_verified_request_group_class(text,text,uuid,uuid);
drop function if exists public.parent_verified_request_private_booking(text,text,uuid,jsonb);
drop function if exists public.parent_verified_update_profile(text,text,jsonb);
drop function if exists rswtta_private.parent_verified_account(text,text);
alter table rswtta_private.club_preregistration_requests drop constraint club_preregistration_requests_actor_check;
alter table rswtta_private.club_preregistration_requests add constraint club_preregistration_requests_actor_check check(actor='club_unverified_legacy');
commit;
