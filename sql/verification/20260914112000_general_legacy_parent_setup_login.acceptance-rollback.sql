-- Disposable acceptance only. Every fixture and mutation rolls back.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:legacy-parent-setup-acceptance:v1',0));
do $acceptance$
declare
  v_accounts constant uuid:='8236c8f8-0fab-400c-bedc-143fd5930707';
  v_bookings constant uuid:='a7a8a308-2305-4ab6-ad20-5ce174558035';
  v_legacy constant uuid:='00000000-0000-4000-8000-000000001141';
  v_duplicate_a constant uuid:='00000000-0000-4000-8000-000000001142';
  v_duplicate_b constant uuid:='00000000-0000-4000-8000-000000001143';
  v_club constant uuid:='00000000-0000-4000-8000-000000001144';
  v_completed constant uuid:='00000000-0000-4000-8000-000000001145';
  v_own_booking constant uuid:='10000000-0000-4000-8000-000000001141';
  v_other_booking constant uuid:='10000000-0000-4000-8000-000000001142';
  v_client text:='rollback-only-client-20260914112000';
  v_old_password text:='rollback-only-old-credential';
  v_club_password text:='rollback-only-temporary-credential';
  v_new_password text:='rollback-only-new-credential';
  v_salt bytea:=decode('00112233445566778899aabbccddeeff','hex');
  v_new_salt bytea:=decode('ffeeddccbbaa99887766554433221100','hex');
  v_login jsonb; v_club_login jsonb; v_completed_login jsonb; v_complete jsonb;
  v_accounts_hash text; v_bookings_hash text; v_activity_hash text; v_bills_hash text; v_package_hash text;
begin
  if exists(select 1 from public.project_rows r where r.id in(v_legacy,v_duplicate_a,v_duplicate_b,v_club,v_completed,v_own_booking,v_other_booking)) then raise exception 'Fixture IDs are not disposable'; end if;
  select encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_accounts_hash from public.project_rows r where r.project_table_id=v_accounts;
  select encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_bookings_hash from public.project_rows r where r.project_table_id=v_bookings;
  select encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_activity_hash from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908';
  select encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_bills_hash from public.project_rows r where r.project_table_id='47f053f4-af24-4e6c-a3ea-984f6bd36943';
  select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') into v_package_hash from public.class_package_events x;
  perform set_config('rswtta.club_preregister_internal','on',true);
  insert into public.project_rows(id,project_table_id,values) values
   (v_legacy,v_accounts,jsonb_build_object('studentName','Rollback Unique Legacy','parentName','','email','','phone','','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_old_password,v_salt,100000),'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true,'clubPreregistered',false,'credentialVersion',1)),
   (v_duplicate_a,v_accounts,jsonb_build_object('studentName','Rollback Duplicate','parentName','','email','','phone','','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_old_password,v_salt,100000),'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true,'clubPreregistered',false,'credentialVersion',1)),
   (v_duplicate_b,v_accounts,jsonb_build_object('studentName','Ｒｏｌｌｂａｃｋ  Duplicate','parentName','','email','','phone','','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_old_password,v_salt,100000),'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true,'clubPreregistered',false,'credentialVersion',1)),
   (v_club,v_accounts,jsonb_build_object('studentName','Rollback Club Setup','preregisteredName','Rollback Club Setup','parentName','','email','','phone','','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_club_password,v_salt,100000),'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1)),
   (v_completed,v_accounts,jsonb_build_object('studentName','Rollback Completed','parentName','Fixture','email','rollback-completed@example.invalid','phone','6505550199','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_old_password,v_salt,100000),'base64'),'passwordSalt',encode(v_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',false,'clubPreregistered',false,'credentialVersion',1));
  insert into rswtta_private.club_preregistration_aliases(normalized_alias,account_id) values('rollback unique legacy',v_legacy),('rollback club alias',v_club);
  insert into public.project_rows(id,project_table_id,values) values
   (v_own_booking,v_bookings,jsonb_build_object('studentAccountId',v_completed,'studentName','Rollback Completed','familyName','Rollback Completed','studentEmail','rollback-completed@example.invalid','phone','6505550199','requestedCoach','National A','assignedCoach','National A','program','Private lesson','dateLabel','Mon, Sep 21, 2026','timeLabel','9 AM - 10 AM','startsAt','2026-09-21T16:00:00.000Z','priceCents',10000,'status','requested','parentNote','own fixture note')),
   (v_other_booking,v_bookings,jsonb_build_object('studentAccountId',v_legacy,'studentName','Rollback Unique Legacy','familyName','Rollback Unique Legacy','studentEmail','','phone','','requestedCoach','National B','assignedCoach','National B','program','Private lesson','dateLabel','Mon, Sep 21, 2026','timeLabel','10 AM - 11 AM','startsAt','2026-09-21T17:00:00.000Z','priceCents',10000,'status','requested','parentNote','private other fixture note'));

  begin perform public.parent_legacy_setup_login('rollback unique legacy','wrong-rollback-only',v_client); raise exception 'wrong credential accepted'; exception when others then if sqlerrm='wrong credential accepted' then raise; end if; end;
  begin perform public.parent_legacy_setup_login('rollback unique',v_old_password,v_client); raise exception 'prefix accepted'; exception when others then if sqlerrm='prefix accepted' then raise; end if; end;
  begin perform public.parent_legacy_setup_login('rollback duplicate',v_old_password,v_client); raise exception 'duplicate full name accepted'; exception when others then if sqlerrm='duplicate full name accepted' then raise; end if; end;

  v_login:=public.parent_legacy_setup_login('  ＲＯＬＬＢＡＣＫ   UNIQUE LEGACY  ',v_old_password,v_client);
  if v_login->>'setupOnly'<>'true' or v_login#>>'{account,id}'<>v_legacy::text or coalesce(v_login#>>'{account,passwordHash}','')<>'' then raise exception 'Unique legacy setup login contract failed'; end if;
  v_club_login:=public.parent_legacy_setup_login('rollback club alias',v_club_password,v_client);
  if v_club_login#>>'{account,id}'<>v_club::text then raise exception 'Existing alias setup login failed'; end if;
  begin perform public.parent_legacy_complete_setup(v_login->>'sessionToken',v_client,jsonb_build_object('studentName','Rollback Unique Legacy','parentName','Fixture','email','','phone','','password',v_new_password,'passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_new_password,v_new_salt,100000),'base64'),'passwordSalt',encode(v_new_salt,'base64'))); raise exception 'legacy contact omission accepted'; exception when others then if sqlerrm='legacy contact omission accepted' then raise; end if; end;
  begin perform public.parent_legacy_complete_setup(v_login->>'sessionToken',v_client,jsonb_build_object('studentName','Rollback Unique Legacy','parentName','Fixture','email','rollback-legacy@example.invalid','phone','6505550188','password',v_old_password,'passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_old_password,v_new_salt,100000),'base64'),'passwordSalt',encode(v_new_salt,'base64'))); raise exception 'same password accepted'; exception when others then if sqlerrm='same password accepted' then raise; end if; end;
  v_complete:=public.parent_legacy_complete_setup(v_login->>'sessionToken',v_client,jsonb_build_object('studentName','Rollback Unique Legacy','parentName','Fixture','email','rollback-legacy@example.invalid','phone','6505550188','password',v_new_password,'passwordHash',encode(rswtta_private.club_preregistration_pbkdf2(v_new_password,v_new_salt,100000),'base64'),'passwordSalt',encode(v_new_salt,'base64')));
  if v_complete->>'setupOnly'<>'false' or v_complete->>'temporaryCredentialInvalidated'<>'true' or (select coalesce((r.values->>'profileSetupRequired')::boolean,true) from public.project_rows r where r.id=v_legacy) then raise exception 'Setup completion failed'; end if;
  begin perform public.parent_legacy_setup_login('rollback unique legacy',v_old_password,v_client); raise exception 'old credential remained valid'; exception when others then if sqlerrm='old credential remained valid' then raise; end if; end;

  v_completed_login:=public.parent_legacy_session_login('rollback-completed@example.invalid',v_old_password,v_client);
  if v_completed_login#>>'{account,id}'<>v_completed::text or jsonb_array_length(v_completed_login->'bookings')<>1 then raise exception 'Completed email login changed'; end if;
  if exists(select 1 from jsonb_array_elements(v_completed_login->'calendarBookings') b where b->>'id'=v_other_booking::text and (coalesce(b->>'parentNote','')<>'' or coalesce(b->>'studentName','')<>'')) then raise exception 'Other-family dashboard data was not redacted'; end if;
  if (public.parent_legacy_session_resume(v_completed_login->>'sessionToken',v_client)#>>'{account,id}')<>v_completed::text then raise exception 'Completed dashboard reload failed'; end if;

  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.parent_legacy_setup_login(text,text,text)'::regprocedure))=0 or position($needle$interval '15 minutes'$needle$ in pg_get_functiondef('public.parent_legacy_setup_login(text,text,text)'::regprocedure))=0 then raise exception 'Rate-limit/concurrency guards missing'; end if;
  if (select count(*) from public.project_rows r where r.id in(v_legacy,v_duplicate_a,v_duplicate_b,v_club,v_completed,v_own_booking,v_other_booking))<>7 then raise exception 'Unexpected fixture mutation'; end if;
  if (select encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908')<>v_activity_hash then raise exception 'Activity changed'; end if;
  if (select encode(extensions.digest(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''),'sha256'),'hex') from public.project_rows r where r.project_table_id='47f053f4-af24-4e6c-a3ea-984f6bd36943')<>v_bills_hash then raise exception 'Bills changed'; end if;
  if (select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') from public.class_package_events x)<>v_package_hash then raise exception 'Packages changed'; end if;
end $acceptance$;
rollback;
