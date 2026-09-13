-- Read-only post-activation contract assertions. Run after both migrations in a
-- disposable/rollback verification database; this file performs no mutations.
do $test$
declare v_definition text;
begin
  if has_schema_privilege('anon','rswtta_private','usage') or has_schema_privilege('authenticated','rswtta_private','usage') then
    raise exception 'browser roles can use private schema';
  end if;
  if has_table_privilege('anon','public.project_rows','select') or has_table_privilege('anon','public.project_rows','insert')
    or has_table_privilege('anon','public.project_rows','update') or has_table_privilege('authenticated','public.project_rows','select') then
    raise exception 'browser role retains direct project_rows access';
  end if;
  if has_function_privilege('anon','public.cancel_booking_as_parent(uuid,text,jsonb)','execute')
    or has_function_privilege('anon','public.cancel_booking_as_club(uuid)','execute')
    or has_function_privilege('anon','public.request_booking_as_parent(uuid,text,jsonb)','execute') then
    raise exception 'legacy caller-identity RPC remains executable';
  end if;
  if not has_function_privilege('anon','public.parent_session_login(text,text,text)','execute')
    or not has_function_privilege('anon','public.parent_session_refresh(text,text,text)','execute')
    or not has_function_privilege('anon','public.parent_cancel_booking_occurrences(text,text,uuid,text,uuid,timestamptz,text,timestamptz,integer)','execute')
    or not has_function_privilege('anon','public.club_login(text,text,text)','execute') then
    raise exception 'opaque-session surface is not executable';
  end if;
  select pg_get_functiondef('public.parent_cancel_booking_occurrences(text,text,uuid,text,uuid,timestamptz,text,timestamptz,integer)'::regprocedure) into v_definition;
  if position('valid_session' in v_definition)=0 or position('parent_account_id' in v_definition)=0
    or position('for update' in lower(v_definition))=0 or position('interval ''12 hours''' in v_definition)=0
    or position('recurrenceOriginalStartsAt' in v_definition)=0 or position('idempotency_results' in v_definition)=0
    or position('operation_nonces' in v_definition)=0 or position('p_expected_eligible_count' in v_definition)=0
    then raise exception 'cancellation security contract regressed'; end if;
  select pg_get_functiondef('rswtta_private.parent_dashboard(uuid)'::regprocedure) into v_definition;
  if position('studentEmail' in v_definition)=0 or position('studentAccountId' in v_definition)=0 then
    raise exception 'calendar privacy projection regressed';
  end if;
  if exists(select 1 from public.project_rows r join public.project_tables t on t.id=r.project_table_id
    join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='parent_accounts'
    and r.values ?| array['passwordHash','passwordSalt','confirmationCode']) then raise exception 'public credentials remain after activation'; end if;
  if (select count(*) from rswtta_private.credentials where principal_id in(select id from rswtta_private.auth_principals where actor_kind='parent'))<>65
    or (select count(*) from rswtta_private.household_accounts)<>65 then raise exception 'not all Parent credentials/bindings migrated'; end if;
  if exists(select 1 from rswtta_private.sessions where access_token_hash is null or refresh_token_hash is null) then raise exception 'unhashed session token state'; end if;
end $test$;
