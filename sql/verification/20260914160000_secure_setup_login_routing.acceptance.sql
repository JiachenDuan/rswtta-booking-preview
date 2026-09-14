-- Runtime acceptance is self-contained and always rolls back synthetic fixtures.
begin;
do $acceptance$
declare
  v_custom_salt bytea:=decode('00112233445566778899aabbccddeeff','hex');
  v_next_salt bytea:=decode('ffeeddccbbaa99887766554433221100','hex');
  v_custom_hash bytea;
  v_next_hash bytea;
  v_temp rswtta_private.club_preregistration_temp_credential%rowtype;
  v_resolution jsonb;
  v_login jsonb;
  v_token text;
  v_before text;
  v_after text;
begin
  v_custom_hash:=rswtta_private.club_preregistration_pbkdf2('synthetic-custom-current',v_custom_salt,100000);
  v_next_hash:=rswtta_private.club_preregistration_pbkdf2('synthetic-custom-next',v_next_salt,100000);
  select * into strict v_temp from rswtta_private.club_preregistration_temp_credential;
  perform set_config('rswtta.club_preregister_internal','on',true);
  insert into public.project_rows(id,project_table_id,values) values
  ('f1000000-0000-4000-8000-000000000001','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','FixtureAlex Ma','parentName','Fixture Parent','email','fixture.ma@example.test','phone','+16505550101','loginAlias','fixture-alex-ma','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(v_custom_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000002','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','FixtureAlex Li','parentName','Fixture Parent','email','fixture.li@example.test','phone','+16505550102','loginAlias','fixture-alex-li','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(v_custom_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000003','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Fixture Duplicate','parentName','Fixture Parent','email','fixture.dup1@example.test','phone','+16505550103','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(v_custom_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000004','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Ｆｉｘｔｕｒｅ  Duplicate','parentName','Fixture Parent','email','fixture.dup2@example.test','phone','+16505550104','passwordHash',encode(v_custom_hash,'base64'),'passwordSalt',encode(v_custom_salt,'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true)),
  ('f1000000-0000-4000-8000-000000000005','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','FixtureTemp Current','parentName','','email','fixture.temp@example.test','phone','+16505550105','loginAlias','fixture-temp-current','passwordHash',encode(v_temp.password_hash,'base64'),'passwordSalt',encode(v_temp.salt,'base64'),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1));

  v_resolution:=rswtta_private.parent_setup_identifier_resolution(' ＦＩＸＴＵＲＥＡＬＥＸ   ma ');
  if v_resolution->>'status'<>'unique_exact' or not (v_resolution->>'firstNameCollision')::boolean or v_resolution->>'accountId'<>'f1000000-0000-4000-8000-000000000001' then raise exception 'Unique full-name collision routing failed'; end if;
  v_resolution:=rswtta_private.parent_setup_identifier_resolution('fixture-alex-ma');
  if v_resolution->>'status'<>'unique_exact' or v_resolution->>'accountId'<>'f1000000-0000-4000-8000-000000000001' then raise exception 'Unique alias routing failed'; end if;
  if rswtta_private.parent_setup_identifier_resolution('fixture duplicate')->>'status'<>'ambiguous' then raise exception 'Duplicate exact ambiguity failed'; end if;

  select encode(extensions.digest(convert_to(r.values::text,'UTF8'),'sha256'),'hex') into strict v_before from public.project_rows r where r.id='f1000000-0000-4000-8000-000000000001';
  begin
    perform public.parent_legacy_setup_login('fixture-alex-ma','synthetic-wrong-password','synthetic-client-key-0000000000000001');
    raise exception 'Wrong password unexpectedly authenticated';
  exception when others then
    if sqlerrm='Wrong password unexpectedly authenticated' then raise; end if;
  end;
  v_login:=public.parent_legacy_setup_login('fixture-alex-ma','synthetic-custom-current','synthetic-client-key-0000000000000001');
  if not (v_login->>'setupOnly')::boolean or v_login->'account'->>'id'<>'f1000000-0000-4000-8000-000000000001' or (v_login->'account' ?| array['passwordHash','passwordSalt','confirmationCode']) then raise exception 'Legacy custom setup login contract failed'; end if;
  v_token:=v_login->>'sessionToken';
  select encode(extensions.digest(convert_to(r.values::text,'UTF8'),'sha256'),'hex') into strict v_after from public.project_rows r where r.id='f1000000-0000-4000-8000-000000000001';
  if v_before<>v_after then raise exception 'Custom credential changed during login'; end if;

  begin
    perform public.parent_legacy_complete_setup(v_token,'synthetic-client-key-0000000000000001',jsonb_build_object('studentName','FixtureAlex Ma','parentName','Fixture Parent','email','fixture.ma@example.test','phone','+16505550101','password','synthetic-custom-current','passwordHash',encode(v_next_hash,'base64'),'passwordSalt',encode(v_next_salt,'base64')));
    raise exception 'Same password unexpectedly accepted';
  exception when others then
    if sqlerrm='Same password unexpectedly accepted' then raise; end if;
  end;
  perform public.parent_legacy_complete_setup(v_token,'synthetic-client-key-0000000000000001',jsonb_build_object('studentName','FixtureAlex Ma','parentName','Fixture Parent','email','fixture.ma@example.test','phone','+16505550101','password','synthetic-custom-next','passwordHash',encode(v_next_hash,'base64'),'passwordSalt',encode(v_next_salt,'base64')));
  if exists(select 1 from public.project_rows r where r.id='f1000000-0000-4000-8000-000000000001' and coalesce((r.values->>'profileSetupRequired')::boolean,true)) then raise exception 'Setup flag remained'; end if;
  if exists(select 1 from rswtta_private.club_preregistration_sessions s where s.account_id='f1000000-0000-4000-8000-000000000001' and s.revoked_at is null) then raise exception 'Setup session remained active'; end if;
  begin
    perform public.parent_legacy_setup_login('fixture-alex-ma','synthetic-custom-current','synthetic-client-key-0000000000000001');
    raise exception 'Previous credential unexpectedly accepted after change';
  exception when others then
    if sqlerrm='Previous credential unexpectedly accepted after change' then raise; end if;
  end;
  v_login:=public.parent_legacy_setup_login('fixture-temp-current','rswtta','synthetic-client-key-0000000000000002');
  if not (v_login->>'setupOnly')::boolean or v_login->'account'->>'id'<>'f1000000-0000-4000-8000-000000000005' then raise exception 'Current temporary setup login failed'; end if;
end $acceptance$;

set local role anon;
do $direct_table_denial$
declare v_count bigint;
begin
  select count(*) into v_count from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  if v_count<>0 then raise exception 'Anon could read account rows'; end if;
  begin
    insert into public.project_rows(id,project_table_id,values) values('f1000000-0000-4000-8000-000000000099','8236c8f8-0fab-400c-bedc-143fd5930707','{}');
    raise exception 'Anon account insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  if public.parent_legacy_setup_identifier_status('fixture-alex-ma') ? 'accountId' then raise exception 'Resolver leaked account ID'; end if;
end $direct_table_denial$;
reset role;

select 'PASS: fixture admissibility, exact/alias/ambiguity routing, legacy custom and current temporary setup-only login, wrong-password rejection, custom preservation, mandatory different password, post-change invalidation, no sensitive resolver fields, and direct account-table denial' acceptance_result;
rollback;
