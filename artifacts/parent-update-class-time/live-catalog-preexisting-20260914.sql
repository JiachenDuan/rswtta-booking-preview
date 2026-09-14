select jsonb_pretty(jsonb_build_object(
 'server_now', clock_timestamp(),
 'relations', (select jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'relation',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) order by k.conname),'[]') from pg_constraint k where k.conrelid=c.oid),
   'visibility',jsonb_build_object('anon_select',has_table_privilege('anon',c.oid,'SELECT'),'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'))
 ) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in (
   ('public','project_rows'),('public','projects'),('public','project_tables'),('public','class_package_events'),('public','class_package_hours_ledger'),('public','class_package_keys'),
   ('rswtta_private','club_preregistration_sessions'),('rswtta_private','club_preregistration_aliases'),
   ('rswtta_private','parent_legacy_sessions'),('rswtta_private','parent_class_time_nonces'),('rswtta_private','parent_class_time_idempotency')
 )),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'return_type',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'acl',p.proacl) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (
   ('rswtta_private','club_preregistration_pbkdf2'),('rswtta_private','club_preregistration_digest'),('public','rswtta_booking_ends_at'),('public','rswtta_canonical_coach_id'),
   ('rswtta_private','parent_legacy_credential_fingerprint'),('rswtta_private','valid_parent_legacy_session'),('rswtta_private','parent_legacy_row_json'),('rswtta_private','parent_legacy_dashboard'),
   ('public','parent_legacy_session_login'),('public','parent_legacy_session_resume'),('public','parent_legacy_session_logout'),('public','parent_issue_class_time_update_nonce'),('public','parent_update_booking_time')
 ))
)) as catalog_matrix;
