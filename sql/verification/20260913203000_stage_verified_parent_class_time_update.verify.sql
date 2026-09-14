begin transaction read only;
with live as (
 select t.slug,count(r.id) row_count,encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') id_hash
 from public.project_tables t join public.projects p on p.id=t.project_id left join public.project_rows r on r.project_table_id=t.id
 where p.slug='rswtta-booking' and t.slug in('bookings','parent_accounts','activity_logs','bill_notifications') group by t.slug
), backup as (
 select 'bookings' slug,count(*) row_count,encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') id_hash from rswtta_private.backup_parent_time_bookings_20260913203000
 union all select 'parent_accounts',count(*),encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') from rswtta_private.backup_parent_time_accounts_20260913203000
 union all select 'activity_logs',count(*),encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') from rswtta_private.backup_parent_time_activity_20260913203000
 union all select 'bill_notifications',count(*),encode(extensions.digest(coalesce(string_agg(id::text,E'\n' order by id),''),'sha256'),'hex') from rswtta_private.backup_parent_time_bills_20260913203000
)
select jsonb_pretty(jsonb_build_object(
 'serverNow',clock_timestamp(),
 'objects',jsonb_build_object(
  'login',to_regprocedure('public.parent_legacy_session_login(text,text,text)'),
  'resume',to_regprocedure('public.parent_legacy_session_resume(text,text)'),
  'logout',to_regprocedure('public.parent_legacy_session_logout(text,text)'),
  'nonce',to_regprocedure('public.parent_issue_class_time_update_nonce(text,text)'),
  'update',to_regprocedure('public.parent_update_booking_time(text,text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text)')),
 'live',(select jsonb_agg(to_jsonb(l) order by slug) from live l),
 'backup',(select jsonb_agg(to_jsonb(b) order by slug) from backup b),
 'privateCounts',jsonb_build_object(
  'legacySessions',(select count(*) from rswtta_private.parent_legacy_sessions),
  'nonces',(select count(*) from rswtta_private.parent_class_time_nonces),
  'idempotency',(select count(*) from rswtta_private.parent_class_time_idempotency),
  'setupSessions',(select count(*) from rswtta_private.club_preregistration_sessions),
  'setupAliases',(select count(*) from rswtta_private.club_preregistration_aliases),
  'packageLedger',(select count(*) from public.class_package_hours_ledger),
  'packageKeys',(select count(*) from public.class_package_keys),
  'packageEvents',(select count(*) from public.class_package_events)),
 'grants',jsonb_build_object(
  'anonLogin',has_function_privilege('anon','public.parent_legacy_session_login(text,text,text)','execute'),
  'anonResume',has_function_privilege('anon','public.parent_legacy_session_resume(text,text)','execute'),
  'anonLogout',has_function_privilege('anon','public.parent_legacy_session_logout(text,text)','execute'),
  'anonNonce',has_function_privilege('anon','public.parent_issue_class_time_update_nonce(text,text)','execute'),
  'anonUpdate',has_function_privilege('anon','public.parent_update_booking_time(text,text,text,uuid,uuid,timestamptz,text,timestamptz,text,text,timestamptz,timestamptz,text,text)','execute')),
 'acceptedResidualLegacyRisk',jsonb_build_object(
  'anonProjectRowsUpdate',has_table_privilege('anon','public.project_rows','update'),
  'authenticatedProjectRowsUpdate',has_table_privilege('authenticated','public.project_rows','update'))
));
rollback;
