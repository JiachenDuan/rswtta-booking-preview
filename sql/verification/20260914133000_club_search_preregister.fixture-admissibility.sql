begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:club-search-preregister:fixture-admissibility',0));
do $fixture$
declare v_account constant uuid:='00000000-0000-4000-8000-000000001914'; v_activity constant uuid:='00000000-0000-4000-8000-000000001915';
begin
 if exists(select 1 from public.project_rows r where r.id in(v_account,v_activity)) then raise exception 'Fixture IDs are not disposable'; end if;
 perform set_config('rswtta.club_preregister_internal','on',true);
 insert into public.project_rows(id,project_table_id,values) values(v_account,'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,jsonb_build_object('studentName','ROLLBACK ONLY FIXTURE','preregisteredName','ROLLBACK ONLY FIXTURE','parentName','','email','','phone','','loginAlias','rollback-only-fixture-1914','passwordHash',repeat('A',44),'passwordSalt',repeat('A',24),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1));
 insert into public.project_rows(id,project_table_id,values) values(v_activity,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid,jsonb_build_object('action','student_preregistered','message','Rollback-only fixture.','studentName','','coach','','dateLabel','','timeLabel','','count',1,'accountId',v_account,'actor','club_unverified_legacy'));
 if (select count(*) from public.project_rows r where r.id in(v_account,v_activity))<>2 then raise exception 'Fixture setup incomplete'; end if;
end $fixture$;
rollback;
