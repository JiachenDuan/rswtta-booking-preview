-- Disposable acceptance: every fixture and mutation rolls back.
begin;
do $acceptance$
declare
 v_account constant uuid:='f1000000-0000-4000-8000-000000000011';
 v_other constant uuid:='f1000000-0000-4000-8000-000000000012';
 v_setup constant uuid:='f1000000-0000-4000-8000-000000000013';
 v_duplicate constant uuid:='f1000000-0000-4000-8000-000000000014';
 v_selected constant uuid:='f2000000-0000-4000-8000-000000000011';
 v_oneoff constant uuid:='f2000000-0000-4000-8000-000000000012';
 v_other_booking constant uuid:='f2000000-0000-4000-8000-000000000013';
 v_conflict constant uuid:='f2000000-0000-4000-8000-000000000014';
 v_edge constant uuid:='f2000000-0000-4000-8000-000000000015';
 v_client text:='f3000000-0000-4000-8000-000000000011'; v_token text; v_nonce text; v_result jsonb; v_before jsonb; v_after jsonb; v_updated timestamptz;
 v_activity_before bigint; v_activity_after bigint; v_package_before text; v_package_after text; v_bills_before text; v_bills_after text; v_session_id uuid; v_failed boolean;
 v_atomic_before text; v_atomic_after text; v_activity_values jsonb; v_oneoff_before jsonb; v_oneoff_updated timestamptz;
begin
 select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') into v_package_before from public.class_package_events x;
 select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') into v_bills_before from public.project_rows x where x.project_table_id='47f053f4-af24-4e6c-a3ea-984f6bd36943';
 select count(*) into v_activity_before from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908';
 insert into public.project_rows(id,project_table_id,values) values
 (v_account,'8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Acceptance Parent','parentName','Fixture','email','parent-time-acceptance@example.test','phone','5555555555','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2('fixture-password',decode('00112233445566778899aabbccddeeff','hex'),100000),'base64'),'passwordSalt',encode(decode('00112233445566778899aabbccddeeff','hex'),'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',false)),
 (v_other,'8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Other Acceptance','parentName','Fixture','email','parent-time-other@example.test','phone','5555555556','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2('other-password',decode('ffeeddccbbaa99887766554433221100','hex'),100000),'base64'),'passwordSalt',encode(decode('ffeeddccbbaa99887766554433221100','hex'),'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',false)),
 (v_setup,'8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Setup Acceptance','parentName','','email','parent-time-setup@example.test','phone','','passwordHash',encode(rswtta_private.club_preregistration_pbkdf2('setup-password',decode('102132435465768798a9bacbdcedfe0f','hex'),100000),'base64'),'passwordSalt',encode(decode('102132435465768798a9bacbdcedfe0f','hex'),'base64'),'confirmationCode','','confirmed',true,'profileSetupRequired',true));
 insert into public.project_rows(id,project_table_id,values) values
 (v_selected,'a7a8a308-2305-4ab6-ad20-5ce174558035',jsonb_build_object('studentAccountId',v_account,'studentName','Acceptance Parent','familyName','Acceptance Parent','studentEmail','parent-time-acceptance@example.test','phone','5555555555','requestedCoach','Acceptance Coach','assignedCoach','Acceptance Coach','program','Private lesson','dateLabel','Mon, Sep 21, 2026','timeLabel','9 AM - 10 AM','startsAt','2026-09-21T16:00:00.000Z','priceCents',10000,'status','club_confirmed','parentNote','fixture history','seriesId','acceptance-series','recurrenceOccurrenceId','acceptance-occurrence','recurrenceOriginalStartsAt','2026-09-21T16:00:00.000Z','billingMarker','preserve-me')),
 (v_oneoff,'a7a8a308-2305-4ab6-ad20-5ce174558035',jsonb_build_object('studentAccountId',v_account,'studentName','Acceptance Parent','familyName','Acceptance Parent','studentEmail','parent-time-acceptance@example.test','phone','5555555555','requestedCoach','Acceptance Coach B','assignedCoach','Acceptance Coach B','program','Private lesson','dateLabel','Wed, Sep 23, 2026','timeLabel','9 AM - 10 AM','startsAt','2026-09-23T16:00:00.000Z','priceCents',10000,'status','requested','parentNote','oneoff history')),
 (v_other_booking,'a7a8a308-2305-4ab6-ad20-5ce174558035',jsonb_build_object('studentAccountId',v_other,'studentName','Other Acceptance','familyName','Other Acceptance','studentEmail','parent-time-other@example.test','phone','5555555556','requestedCoach','Acceptance Coach C','assignedCoach','Acceptance Coach C','program','Private lesson','dateLabel','Wed, Sep 23, 2026','timeLabel','11 AM - 12 PM','startsAt','2026-09-23T18:00:00.000Z','priceCents',10000,'status','requested','parentNote','other history')),
 (v_conflict,'a7a8a308-2305-4ab6-ad20-5ce174558035',jsonb_build_object('studentName','Coach unavailable','familyName','Club','studentEmail','','phone','','requestedCoach','Acceptance Coach B','assignedCoach','Acceptance Coach B','program','Unavailable','dateLabel','Thu, Sep 24, 2026','timeLabel','9 AM - 10 AM','startsAt','2026-09-24T16:00:00.000Z','priceCents',0,'status','club_confirmed','parentNote','fixture unavailable')),
 (v_edge,'a7a8a308-2305-4ab6-ad20-5ce174558035',jsonb_build_object('studentAccountId',v_account,'studentName','Acceptance Parent','familyName','Acceptance Parent','studentEmail','','phone','','requestedCoach','Acceptance Edge','assignedCoach','Acceptance Edge','program','Private lesson','dateLabel','','timeLabel','9 AM - 10 AM','startsAt',clock_timestamp()+interval '12 hours','priceCents',10000,'status','requested','parentNote','edge'));

 v_result:=public.parent_legacy_session_login('parent-time-acceptance@example.test','fixture-password',v_client); v_token:=v_result->>'sessionToken';
 if v_token is null or v_result->'account'->>'id'<>v_account::text or jsonb_array_length(v_result->'bookings')<>3 then raise exception 'valid login/dashboard failed'; end if;
 select id into strict v_session_id from rswtta_private.parent_legacy_sessions where token_hash=rswtta_private.club_preregistration_digest(v_token) and account_id=v_account and revoked_at is null;
 if (select count(*) from rswtta_private.valid_parent_legacy_session(v_token,v_client))<>1 or (select count(*) from rswtta_private.valid_parent_legacy_session(v_token,'wrong-client-key-000000000000'))<>0 then raise exception 'token binding failed'; end if;

 -- The live recurrence trigger applies to every project_rows family, including activity.
 -- A recurrence-aware activity row therefore carries the complete immutable tuple or none.
 select encode(extensions.digest(jsonb_build_object(
   'bookings',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.project_rows r where r.id in(v_selected,v_oneoff,v_other_booking,v_conflict,v_edge)),
   'activity',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'),
   'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from rswtta_private.parent_legacy_sessions s where s.account_id in(v_account,v_other)),
   'nonces',(select coalesce(jsonb_agg(to_jsonb(n) order by encode(n.nonce_hash,'hex')),'[]') from rswtta_private.parent_class_time_nonces n),
   'idempotency',(select coalesce(jsonb_agg(to_jsonb(i) order by i.account_id,i.idempotency_key),'[]') from rswtta_private.parent_class_time_idempotency i)
 )::text,'sha256'),'hex') into v_atomic_before;
 begin
   insert into public.project_rows(project_table_id,values) values('133ad2fa-44b2-4aab-ab5d-b79c563ab908',jsonb_build_object('action','acceptance_incomplete_recurrence','seriesId','acceptance-series','recurrenceOccurrenceId','acceptance-occurrence'));
   raise exception 'incomplete activity tuple accepted';
 exception when others then if sqlerrm='incomplete activity tuple accepted' then raise; end if; end;
 begin
   insert into public.project_rows(project_table_id,values) values('133ad2fa-44b2-4aab-ab5d-b79c563ab908',jsonb_build_object('action','acceptance_incomplete_recurrence','recurrenceOccurrenceId','acceptance-occurrence','recurrenceOriginalStartsAt','2026-09-21T16:00:00.000Z'));
   raise exception 'occurrence without series accepted';
 exception when others then if sqlerrm='occurrence without series accepted' then raise; end if; end;
 begin
   insert into public.project_rows(project_table_id,values) values('133ad2fa-44b2-4aab-ab5d-b79c563ab908',jsonb_build_object('action','acceptance_incomplete_recurrence','seriesId','acceptance-series','recurrenceOriginalStartsAt','2026-09-21T16:00:00.000Z'));
   raise exception 'series without occurrence accepted';
 exception when others then if sqlerrm='series without occurrence accepted' then raise; end if; end;
 select encode(extensions.digest(jsonb_build_object(
   'bookings',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.project_rows r where r.id in(v_selected,v_oneoff,v_other_booking,v_conflict,v_edge)),
   'activity',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.project_rows r where r.project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'),
   'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from rswtta_private.parent_legacy_sessions s where s.account_id in(v_account,v_other)),
   'nonces',(select coalesce(jsonb_agg(to_jsonb(n) order by encode(n.nonce_hash,'hex')),'[]') from rswtta_private.parent_class_time_nonces n),
   'idempotency',(select coalesce(jsonb_agg(to_jsonb(i) order by i.account_id,i.idempotency_key),'[]') from rswtta_private.parent_class_time_idempotency i)
 )::text,'sha256'),'hex') into v_atomic_after;
 if v_atomic_after<>v_atomic_before then raise exception 'incomplete recurrence tuple failure was not atomic'; end if;

 select values,updated_at into strict v_before,v_updated from public.project_rows where id=v_selected;
 v_nonce:=(public.parent_issue_class_time_update_nonce(v_token,v_client)->>'operationNonce');
 v_result:=public.parent_update_booking_time(v_token,v_client,v_nonce,v_selected,'f4000000-0000-4000-8000-000000000011',v_updated,'club_confirmed','2026-09-21T16:00:00Z','acceptance-series','acceptance-occurrence','2026-09-21T16:00:00Z','2026-09-22T16:00:00Z','Tue, Sep 22, 2026','9 AM - 10 AM');
 select values into strict v_after from public.project_rows where id=v_selected;
 if v_after->>'startsAt'<>'2026-09-22T16:00:00.000Z' or v_after->>'status'<>'change_requested' or (v_after-'startsAt'-'dateLabel'-'timeLabel'-'status')<>(v_before-'startsAt'-'dateLabel'-'timeLabel'-'status') then raise exception 'valid selected recurring update did not preserve fields'; end if;
 if v_after->>'seriesId'<>'acceptance-series' or v_after->>'recurrenceOccurrenceId'<>'acceptance-occurrence' or v_after->>'recurrenceOriginalStartsAt'<>'2026-09-21T16:00:00.000Z' then raise exception 'selected recurring occurrence identity shifted'; end if;
 select count(*) into v_activity_after from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'; if v_activity_after<>v_activity_before+1 then raise exception 'activity count mismatch'; end if;
 select values into strict v_activity_values from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908' and values->>'action'='parent_class_time_updated' and values->>'idempotencyKey'='f4000000-0000-4000-8000-000000000011';
 if coalesce(v_activity_values->>'seriesId','')<>'' or coalesce(v_activity_values->>'recurrenceOccurrenceId','')<>'' or coalesce(v_activity_values->>'recurrenceOriginalStartsAt','')<>'' then raise exception 'recurring update activity violated no-recurrence-identity convention'; end if;
 v_result:=public.parent_update_booking_time(v_token,v_client,v_nonce,v_selected,'f4000000-0000-4000-8000-000000000011',v_updated,'club_confirmed','2026-09-21T16:00:00Z','acceptance-series','acceptance-occurrence','2026-09-21T16:00:00Z','2026-09-22T16:00:00Z','Tue, Sep 22, 2026','9 AM - 10 AM'); if not coalesce((v_result->>'replayed')::boolean,false) then raise exception 'idempotent retry failed'; end if;
 if (select count(*) from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908')<>v_activity_after then raise exception 'replay wrote another activity'; end if;
 begin perform public.parent_update_booking_time(v_token,v_client,v_nonce,v_selected,'f4000000-0000-4000-8000-000000000011',v_updated,'club_confirmed','2026-09-21T16:00:00Z','acceptance-series','acceptance-occurrence','2026-09-21T16:00:00Z','2026-09-22T16:30:00Z','Tue, Sep 22, 2026','9:30 AM - 10:30 AM'); raise exception 'payload mismatch accepted'; exception when others then if sqlerrm='payload mismatch accepted' then raise; end if; end;

 -- Cross-account, forged token/account-ID, stale snapshot, conflict and strict edges all fail closed.
 v_nonce:=(public.parent_issue_class_time_update_nonce(v_token,v_client)->>'operationNonce'); begin perform public.parent_update_booking_time(v_token,v_client,v_nonce,v_other_booking,extensions.gen_random_uuid(),(select updated_at from public.project_rows where id=v_other_booking),'requested','2026-09-23T18:00:00Z','','',null,'2026-09-25T18:00:00Z','Fri, Sep 25, 2026','11 AM - 12 PM'); raise exception 'cross-account accepted'; exception when others then if sqlerrm='cross-account accepted' then raise; end if; end;
 begin perform public.parent_issue_class_time_update_nonce(v_account::text,v_client); raise exception 'bare account accepted'; exception when others then if sqlerrm='bare account accepted' then raise; end if; end;

 -- One-off updates use the established no-recurrence convention: all three fields are absent/null.
 select values,updated_at into strict v_oneoff_before,v_oneoff_updated from public.project_rows where id=v_oneoff;
 v_nonce:=(public.parent_issue_class_time_update_nonce(v_token,v_client)->>'operationNonce');
 v_result:=public.parent_update_booking_time(v_token,v_client,v_nonce,v_oneoff,'f4000000-0000-4000-8000-000000000012',v_oneoff_updated,'requested','2026-09-23T16:00:00Z','','',null,'2026-09-26T16:00:00Z','Sat, Sep 26, 2026','9 AM - 10 AM');
 select values into strict v_after from public.project_rows where id=v_oneoff;
 if v_after->>'startsAt'<>'2026-09-26T16:00:00.000Z' or v_after->>'status'<>'requested' or (v_after-'startsAt'-'dateLabel'-'timeLabel'-'status')<>(v_oneoff_before-'startsAt'-'dateLabel'-'timeLabel'-'status') then raise exception 'valid one-off update did not preserve fields'; end if;
 select values into strict v_activity_values from public.project_rows where project_table_id='133ad2fa-44b2-4aab-ab5d-b79c563ab908' and values->>'action'='parent_class_time_updated' and values->>'idempotencyKey'='f4000000-0000-4000-8000-000000000012';
 if coalesce(v_activity_values->>'seriesId','')<>'' or coalesce(v_activity_values->>'recurrenceOccurrenceId','')<>'' or coalesce(v_activity_values->>'recurrenceOriginalStartsAt','')<>'' then raise exception 'one-off activity carried recurrence identity'; end if;

 v_nonce:=(public.parent_issue_class_time_update_nonce(v_token,v_client)->>'operationNonce'); begin perform public.parent_update_booking_time(v_token,v_client,v_nonce,v_oneoff,extensions.gen_random_uuid(),'2000-01-01Z','requested','2026-09-23T16:00:00Z','','',null,'2026-09-25T16:00:00Z','Fri, Sep 25, 2026','9 AM - 10 AM'); raise exception 'stale accepted'; exception when others then if sqlerrm='stale accepted' then raise; end if; end;
 v_nonce:=(public.parent_issue_class_time_update_nonce(v_token,v_client)->>'operationNonce'); begin perform public.parent_update_booking_time(v_token,v_client,v_nonce,v_oneoff,extensions.gen_random_uuid(),(select updated_at from public.project_rows where id=v_oneoff),'requested','2026-09-26T16:00:00Z','','',null,'2026-09-24T16:00:00Z','Thu, Sep 24, 2026','9 AM - 10 AM'); raise exception 'conflict accepted'; exception when others then if sqlerrm='conflict accepted' then raise; end if; end;
 v_nonce:=(public.parent_issue_class_time_update_nonce(v_token,v_client)->>'operationNonce'); begin perform public.parent_update_booking_time(v_token,v_client,v_nonce,v_oneoff,extensions.gen_random_uuid(),(select updated_at from public.project_rows where id=v_oneoff),'requested','2026-09-26T16:00:00Z','','',null,clock_timestamp()+interval '12 hours','',''); raise exception 'target 12h accepted'; exception when others then if sqlerrm='target 12h accepted' then raise; end if; end;
 v_nonce:=(public.parent_issue_class_time_update_nonce(v_token,v_client)->>'operationNonce'); begin perform public.parent_update_booking_time(v_token,v_client,v_nonce,v_edge,extensions.gen_random_uuid(),(select updated_at from public.project_rows where id=v_edge),'requested',(select values->>'startsAt' from public.project_rows where id=v_edge)::timestamptz,'','',null,'2026-09-25T19:00:00Z','Fri, Sep 25, 2026','12 PM - 1 PM'); raise exception 'current 12h accepted'; exception when others then if sqlerrm='current 12h accepted' then raise; end if; end;

 begin perform public.parent_legacy_session_login('parent-time-setup@example.test','setup-password',v_client); raise exception 'setup account login accepted'; exception when others then if sqlerrm='setup account login accepted' then raise; end if; end;
 insert into public.project_rows(id,project_table_id,values) select v_duplicate,project_table_id,values||jsonb_build_object('studentName','Ambiguous Acceptance') from public.project_rows where id=v_account;
 begin perform public.parent_legacy_session_login('parent-time-acceptance@example.test','fixture-password',v_client); raise exception 'ambiguous login accepted'; exception when others then if sqlerrm='ambiguous login accepted' then raise; end if; end;
 delete from public.project_rows where id=v_duplicate;

 -- Logout/revocation and expiry invalidate both dashboard and mutation authority.
 perform public.parent_legacy_session_logout(v_token,v_client); if (select count(*) from rswtta_private.valid_parent_legacy_session(v_token,v_client))<>0 then raise exception 'logout failed'; end if;
 v_result:=public.parent_legacy_session_login('parent-time-acceptance@example.test','fixture-password',v_client); v_token:=v_result->>'sessionToken';
 update rswtta_private.parent_legacy_sessions set expires_at=clock_timestamp()-interval '1 second' where token_hash=rswtta_private.club_preregistration_digest(v_token);
 begin perform public.parent_legacy_session_resume(v_token,v_client); raise exception 'expired session accepted'; exception when others then if sqlerrm='expired session accepted' then raise; end if; end;

 select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') into v_package_after from public.class_package_events x;
 select encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by x.id),''),'sha256'),'hex') into v_bills_after from public.project_rows x where x.project_table_id='47f053f4-af24-4e6c-a3ea-984f6bd36943';
 if v_package_after<>v_package_before or v_bills_after<>v_bills_before then raise exception 'package/billing neutrality failed'; end if;
 raise notice 'PASS parent class-time rollback-only acceptance: auth binding/expiry/logout/setup/ambiguity/cross-account/boundaries/stale/conflict/selected identity/status/activity/idempotency/neutrality';
end $acceptance$;
rollback;
