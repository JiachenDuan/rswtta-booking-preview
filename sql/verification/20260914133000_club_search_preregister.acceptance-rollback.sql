-- The acceptance runner replaces only the dedicated v_proof SQL value in memory; it never logs or persists the proof.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:club-search-preregister:acceptance',0));
do $acceptance$
declare
 v_proof text:='__CLUB_ACCEPTANCE_PROOF_VALUE__'; v_client text:='rollback-only-client-20260914';
 v_fixture uuid:='00000000-0000-4000-8000-000000001924';
 v_key uuid:='00000000-0000-4000-8000-000000001925';
 v_same_key uuid:='00000000-0000-4000-8000-000000001926';
 v_collision_key uuid:='00000000-0000-4000-8000-000000001927';
 v_stale_search_key uuid:='00000000-0000-4000-8000-000000001928';
 v_stale_preview_key uuid:='00000000-0000-4000-8000-000000001929';
 v_search jsonb; v_preview jsonb; v_created jsonb; v_replayed jsonb;
 v_accounts_before bigint; v_activity_before bigint; v_requests_before bigint;
begin
 select count(*) into v_accounts_before from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
 select count(*) into v_activity_before from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid;
 select count(*) into v_requests_before from rswtta_private.club_preregistration_requests;
 if exists(select 1 from public.project_rows r where r.id=v_fixture) then raise exception 'Fixture ID retained'; end if;
 perform set_config('rswtta.club_preregister_internal','on',true);
 insert into public.project_rows(id,project_table_id,values) values(v_fixture,'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,jsonb_build_object('studentName','ROLLBACK ONLY EXISTING','preregisteredName','ROLLBACK ONLY EXISTING','parentName','','email','rollback-existing@example.invalid','phone','+16505550124','loginAlias','rollback-existing-1924','passwordHash',repeat('A',44),'passwordSalt',repeat('A',24),'confirmationCode','','confirmed',true,'profileSetupRequired',false,'clubPreregistered',false,'credentialVersion',1));
 v_search:=public.club_search_students('rswtta',v_proof,v_client,'rollback only existing');
 if v_search->>'normalizedQuery'<>'rollback only existing' then raise exception 'Club proof preflight did not authenticate disposable search RPC'; end if;
 if jsonb_array_length(v_search->'results')<>1 or v_search->'results'->0->>'maskedEmail'='rollback-existing@example.invalid' then raise exception 'Masked search failed'; end if;
 v_preview:=public.club_preview_student_preregistration_v2('rswtta',v_proof,v_client,v_key,jsonb_build_object('studentName','ROLLBACK ONLY NEW','email','','phone','','loginAlias','rollback-new-1925'));
 begin
  perform public.club_preregister_student_v3('rswtta',v_proof,v_client,v_stale_search_key,v_search->>'normalizedQuery',repeat('0',64),v_preview->'normalized',v_preview->>'snapshotHash',false);
  raise exception 'Stale search was accepted';
 exception when others then if sqlerrm not like '%Student search is stale%' then raise; end if; end;
 begin
  perform public.club_preregister_student_v3('rswtta',v_proof,v_client,v_stale_preview_key,v_search->>'normalizedQuery',v_search->>'snapshotHash',v_preview->'normalized',repeat('0',64),false);
  raise exception 'Stale duplicate preview was accepted';
 exception when others then if sqlerrm not like '%Duplicate preview is stale%' then raise; end if; end;
 v_created:=public.club_preregister_student_v3('rswtta',v_proof,v_client,v_key,v_search->>'normalizedQuery',v_search->>'snapshotHash',v_preview->'normalized',v_preview->>'snapshotHash',false);
 v_replayed:=public.club_preregister_student_v3('rswtta',v_proof,v_client,v_key,v_search->>'normalizedQuery',v_search->>'snapshotHash',v_preview->'normalized',v_preview->>'snapshotHash',false);
 if coalesce((v_created->>'replayed')::boolean,true) or not coalesce((v_replayed->>'replayed')::boolean,false) or v_created->>'accountId'<>v_replayed->>'accountId' then raise exception 'Idempotent replay failed'; end if;
 begin
  perform public.club_preregister_student_v3('rswtta',v_proof,v_client,v_key,v_search->>'normalizedQuery',v_search->>'snapshotHash',jsonb_build_object('studentName','MISMATCH','email','','phone','','loginAlias','mismatch'),v_preview->>'snapshotHash',false);
  raise exception 'Mismatch was accepted';
 exception when others then if sqlerrm not like '%Idempotency key payload mismatch%' then raise; end if; end;
 v_search:=public.club_search_students('rswtta',v_proof,v_client,'rollback-existing@example.invalid');
 v_preview:=public.club_preview_student_preregistration_v2('rswtta',v_proof,v_client,v_collision_key,jsonb_build_object('studentName','DIFFERENT','email','rollback-existing@example.invalid','phone','','loginAlias','different-alias'));
 begin
  perform public.club_preregister_student_v3('rswtta',v_proof,v_client,v_collision_key,v_search->>'normalizedQuery',v_search->>'snapshotHash',v_preview->'normalized',v_preview->>'snapshotHash',false);
  raise exception 'Exact email was accepted';
 exception when others then if sqlerrm not like '%Email already belongs%' then raise; end if; end;
 v_search:=public.club_search_students('rswtta',v_proof,v_client,'rollback only existing');
 v_preview:=public.club_preview_student_preregistration_v2('rswtta',v_proof,v_client,v_same_key,jsonb_build_object('studentName','ROLLBACK ONLY EXISTING','email','','phone','','loginAlias',''));
 begin
  perform public.club_preregister_student_v3('rswtta',v_proof,v_client,v_same_key,v_search->>'normalizedQuery',v_search->>'snapshotHash',v_preview->'normalized',v_preview->>'snapshotHash',true);
  raise exception 'Name-only duplicate was accepted';
 exception when others then if sqlerrm not like '%Exact name requires%' then raise; end if; end;
 v_preview:=public.club_preview_student_preregistration_v2('rswtta',v_proof,v_client,v_same_key,jsonb_build_object('studentName','ROLLBACK ONLY EXISTING','email','','phone','+16505550999','loginAlias','rollback-distinct-1926'));
 perform public.club_preregister_student_v3('rswtta',v_proof,v_client,v_same_key,v_search->>'normalizedQuery',v_search->>'snapshotHash',v_preview->'normalized',v_preview->>'snapshotHash',true);
 if (select count(*) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid)<>v_accounts_before+3 then raise exception 'Unexpected account side effect'; end if;
 if (select count(*) from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid)<>v_activity_before+2 then raise exception 'Exactly one activity per create failed'; end if;
 if (select count(*) from rswtta_private.club_preregistration_requests)<>v_requests_before+2 then raise exception 'Unexpected request cardinality'; end if;
end $acceptance$;
rollback;
