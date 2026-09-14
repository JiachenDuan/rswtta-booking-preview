begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:parent-time:concurrency-fixture',0));
do $guard$ declare v_count bigint; v_hash text; begin
 select count(*),encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows where project_table_id='a7a8a308-2305-4ab6-ad20-5ce174558035';
 if v_count<>2031 or v_hash<>'24600168527f67767eb244338a7a6c05cbf9daaa09cc236938aa1c5e5e04592a' then raise exception 'booking baseline changed'; end if;
 if exists(select 1 from public.project_rows where id in('f1000000-0000-4000-8000-000000000021','f2000000-0000-4000-8000-000000000021')) then raise exception 'fixture collision'; end if;
end $guard$;
insert into public.project_rows(id,project_table_id,values,created_at,updated_at) values
('f1000000-0000-4000-8000-000000000021','8236c8f8-0fab-400c-bedc-143fd5930707',jsonb_build_object('studentName','Concurrency Acceptance','email','parent-time-concurrency@example.test','confirmed',true,'profileSetupRequired',false),'2026-09-14T07:00:00Z','2026-09-14T07:00:00Z'),
('f2000000-0000-4000-8000-000000000021','a7a8a308-2305-4ab6-ad20-5ce174558035',jsonb_build_object('studentAccountId','f1000000-0000-4000-8000-000000000021','studentName','Concurrency Acceptance','requestedCoach','Concurrency Acceptance Coach','assignedCoach','Concurrency Acceptance Coach','program','Private lesson','startsAt','2026-09-28T16:00:00.000Z','dateLabel','Mon, Sep 28, 2026','timeLabel','9 AM - 10 AM','status','requested','priceCents',10000),'2026-09-14T07:00:00Z','2026-09-14T07:00:00Z');
insert into rswtta_private.parent_legacy_sessions(id,token_hash,account_id,client_digest,credential_fingerprint,expires_at) values
('f5000000-0000-4000-8000-000000000021',rswtta_private.club_preregistration_digest('concurrency-session-a'),'f1000000-0000-4000-8000-000000000021',rswtta_private.club_preregistration_digest('fixture-concurrency-client-0001'),rswtta_private.parent_legacy_credential_fingerprint((select values from public.project_rows where id='f1000000-0000-4000-8000-000000000021')),clock_timestamp()+interval '1 hour'),
('f5000000-0000-4000-8000-000000000022',rswtta_private.club_preregistration_digest('concurrency-session-b'),'f1000000-0000-4000-8000-000000000021',rswtta_private.club_preregistration_digest('fixture-concurrency-client-0001'),rswtta_private.parent_legacy_credential_fingerprint((select values from public.project_rows where id='f1000000-0000-4000-8000-000000000021')),clock_timestamp()+interval '1 hour');
insert into rswtta_private.parent_class_time_nonces(nonce_hash,session_id,operation,expires_at) values
(rswtta_private.club_preregistration_digest('concurrency-nonce-a'),'f5000000-0000-4000-8000-000000000021','update_booking_time',clock_timestamp()+interval '1 hour'),
(rswtta_private.club_preregistration_digest('concurrency-nonce-b'),'f5000000-0000-4000-8000-000000000022','update_booking_time',clock_timestamp()+interval '1 hour');
commit;
