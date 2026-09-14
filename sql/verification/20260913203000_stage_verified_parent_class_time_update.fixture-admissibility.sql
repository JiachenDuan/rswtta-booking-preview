-- Pre-feature fixture admissibility; always rolls back.
begin;
do $fixture$
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
begin
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
 if (select count(*) from public.project_rows where id in(v_account,v_other,v_setup,v_selected,v_oneoff,v_other_booking,v_conflict,v_edge))<>8 then raise exception 'fixture count mismatch'; end if;
 raise notice 'PASS pre-existing schema fixture admissibility: 8 rows';
end $fixture$;
rollback;
