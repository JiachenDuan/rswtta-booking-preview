-- Append after the candidate migration body in an always-rollback transaction.
do $fixture_admissibility$
declare v_custom_hash bytea; v_temp rswtta_private.club_preregistration_temp_credential%rowtype;
begin
  v_custom_hash:=rswtta_private.club_preregistration_pbkdf2('synthetic-custom-current',decode('00112233445566778899aabbccddeeff','hex'),100000);
  select * into strict v_temp from rswtta_private.club_preregistration_temp_credential;
  perform set_config('rswtta.club_preregister_internal','on',true);
  insert into public.project_rows(id,project_table_id,values) values
  ('f1000000-0000-4000-8000-000000000001','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','FixtureAlex Ma','parentName','Fixture Parent','email','fixture.ma@example.test','phone','+16505550101','loginAlias','fixture-alex-ma','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(decode('00112233445566778899aabbccddeeff','hex'),'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000002','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','FixtureAlex Li','parentName','Fixture Parent','email','fixture.li@example.test','phone','+16505550102','loginAlias','fixture-alex-li','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(decode('00112233445566778899aabbccddeeff','hex'),'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000003','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Fixture Duplicate','parentName','Fixture Parent','email','fixture.dup1@example.test','phone','+16505550103','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(decode('00112233445566778899aabbccddeeff','hex'),'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000004','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Ｆｉｘｔｕｒｅ  Duplicate','parentName','Fixture Parent','email','fixture.dup2@example.test','phone','+16505550104','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(decode('00112233445566778899aabbccddeeff','hex'),'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000005','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','FixtureTemp Current','parentName','','email','fixture.temp@example.test','phone','+16505550105','loginAlias','fixture-temp-current','passwordHash',encode(v_temp.password_hash,'base64'),'passwordSalt',encode(v_temp.salt,'base64'),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1));
  if (select count(*) from public.project_rows r where r.id::text like 'f1000000-0000-4000-8000-%')<>5 then raise exception 'Fixture count mismatch'; end if;
end $fixture_admissibility$;
rollback;
