-- ACTIVATION MIGRATION: stage separately and apply only with a compatible client.
-- This intentionally removes all anonymous direct-table and legacy Parent/Club
-- authority in the same transaction that grants opaque-session RPCs.
-- Prerequisite: run rswtta_private.bootstrap_club_credential through a masked,
-- backend-only secret flow, then verify the exact 65 Parent / 1 Club principal guard.
-- Rollback is access-control only; see the companion rollback SQL. Do not restore
-- public credential JSON. Rolling the client back requires the secure RPC adapter.

begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:20260912213000:activate-opaque-auth',0));

do $guard$
declare
  c_parent_principals constant bigint := 65;
  c_club_principals constant bigint := 1;
  v_parent bigint; v_club bigint;
begin
  if to_regprocedure('public.parent_cancel_future_bookings(text,text,uuid,uuid,text,timestamptz,text,timestamptz,integer)') is null
    or to_regprocedure('public.parent_login(text,text,text)') is null then raise exception 'Opaque Parent stage is absent'; end if;
  select count(*) filter(where actor_kind='parent'),count(*) filter(where actor_kind='club') into v_parent,v_club from rswtta_private.auth_principals;
  if v_parent<>c_parent_principals or v_club<>c_club_principals or v_club<>1 then raise exception 'Principal baseline mismatch'; end if;
  if exists(select 1 from rswtta_private.auth_principals p left join rswtta_private.credentials c on c.principal_id=p.id where c.principal_id is null) then raise exception 'Principal without credential'; end if;
end $guard$;

create function public.club_login(p_identifier text,p_password text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,rswtta_private as $$
declare v_alias bytea; v_client bytea; v_principal uuid; v_credential rswtta_private.credentials%rowtype;
begin
  if length(coalesce(p_identifier,'')) not between 1 and 320 or length(coalesce(p_password,'')) not between 1 and 1024
    or length(coalesce(p_client_key,'')) not between 16 and 256 then return jsonb_build_object('ok',false,'error','Invalid login'); end if;
  v_alias:=rswtta_private.alias_hash('club',p_identifier); v_client:=rswtta_private.token_hash(p_client_key);
  perform pg_advisory_xact_lock(hashtextextended('login:'||encode(v_alias,'hex'),0));
  if (select count(*) from rswtta_private.login_attempts where attempted_at>clock_timestamp()-interval '15 minutes'
      and (identifier_digest=v_alias or client_digest=v_client) and not succeeded)>=8 then
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); return jsonb_build_object('ok',false,'error','Invalid login');
  end if;
  select principal_id into v_principal from rswtta_private.login_aliases where alias_digest=v_alias and alias_kind='club';
  if v_principal is null then
    perform rswtta_private.pbkdf2_sha256(p_password,decode('101112131415161718191a1b1c1d1e1f','hex'),100000);
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); return jsonb_build_object('ok',false,'error','Invalid login');
  end if;
  select * into strict v_credential from rswtta_private.credentials where principal_id=v_principal;
  if extensions.digest(rswtta_private.pbkdf2_sha256(p_password,v_credential.salt,v_credential.iterations),'sha256')<>extensions.digest(v_credential.password_hash,'sha256') then
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); return jsonb_build_object('ok',false,'error','Invalid login');
  end if;
  insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),true);
  return rswtta_private.issue_session(v_principal)||jsonb_build_object('ok',true);
exception when others then if sqlerrm='Invalid login' then raise exception 'Invalid login'; end if; raise; end $$;

create function public.club_refresh_session(p_refresh_token text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,rswtta_private as $$
declare v_old rswtta_private.sessions%rowtype; v_kind text;
begin
  if length(coalesce(p_refresh_token,''))<64 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid session'; end if;
  select s.* into strict v_old from rswtta_private.sessions s
    where s.refresh_token_hash=rswtta_private.token_hash(p_refresh_token) for update;
  select actor_kind into strict v_kind from rswtta_private.auth_principals where id=v_old.principal_id;
  if v_kind<>'club' or v_old.revoked_at is not null or v_old.refresh_expires_at<=clock_timestamp() then raise exception 'Invalid session'; end if;
  update rswtta_private.sessions set revoked_at=clock_timestamp() where id=v_old.id;
  return rswtta_private.issue_session(v_old.principal_id,v_old.id);
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.club_logout(p_session_token text)
returns void language plpgsql security definer set search_path=pg_catalog,extensions,rswtta_private as $$
declare v_session uuid;
begin
  select session_id into strict v_session from rswtta_private.valid_session(p_session_token,'club');
  update rswtta_private.sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_session;
exception when no_data_found then return; end $$;

-- Generic Club backend plumbing preserves existing project-row shapes while
-- moving all authority behind a valid opaque Club session.
create function public.club_list_rows(p_session_token text,p_table_slug text)
returns setof public.project_rows language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_table uuid;
begin
  perform 1 from rswtta_private.valid_session(p_session_token,'club'); if not found then raise exception 'Invalid session'; end if;
  select t.id into strict v_table from public.project_tables t join public.projects p on p.id=t.project_id
    where p.slug='rswtta-booking' and t.slug=p_table_slug;
  return query select r.* from public.project_rows r where r.project_table_id=v_table order by r.created_at,r.id;
exception when no_data_found then raise exception 'Invalid session or table'; end $$;

create function public.club_insert_row(p_session_token text,p_table_slug text,p_row_id uuid,p_values jsonb)
returns public.project_rows language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_table uuid; v_row public.project_rows%rowtype;
begin
  perform 1 from rswtta_private.valid_session(p_session_token,'club'); if not found then raise exception 'Invalid session'; end if;
  select t.id into strict v_table from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug=p_table_slug;
  insert into public.project_rows(id,project_table_id,values) values(coalesce(p_row_id,gen_random_uuid()),v_table,p_values)
    returning * into v_row; return v_row;
exception when no_data_found then raise exception 'Invalid session or table'; end $$;

create function public.club_update_row(p_session_token text,p_table_slug text,p_row_id uuid,p_expected_updated_at timestamptz,p_values jsonb)
returns public.project_rows language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_table uuid; v_row public.project_rows%rowtype;
begin
  perform 1 from rswtta_private.valid_session(p_session_token,'club'); if not found then raise exception 'Invalid session'; end if;
  select t.id into strict v_table from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug=p_table_slug;
  perform set_config('rswtta.cancellation_actor','club',true);
  update public.project_rows set values=p_values where id=p_row_id and project_table_id=v_table and updated_at=p_expected_updated_at returning * into v_row;
  if not found then raise exception 'Row changed or is unavailable'; end if; return v_row;
exception when no_data_found then raise exception 'Invalid session or table'; end $$;

create function public.club_delete_row(p_session_token text,p_table_slug text,p_row_id uuid,p_expected_updated_at timestamptz)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_table uuid; v_deleted uuid;
begin
  perform 1 from rswtta_private.valid_session(p_session_token,'club'); if not found then raise exception 'Invalid session'; end if;
  select t.id into strict v_table from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug=p_table_slug;
  delete from public.project_rows where id=p_row_id and project_table_id=v_table and updated_at=p_expected_updated_at returning id into v_deleted;
  if v_deleted is null then raise exception 'Row changed or is unavailable'; end if; return v_deleted;
exception when no_data_found then raise exception 'Invalid session or table'; end $$;

-- Remove prototype browser table authority and permissive policies.
revoke all on table public.projects,public.project_members,public.project_tables,public.project_columns,public.project_rows from anon,authenticated;
drop policy if exists "prototype public read projects" on public.projects;
drop policy if exists "prototype public insert projects" on public.projects;
drop policy if exists "prototype public read project_members" on public.project_members;
drop policy if exists "prototype public insert project_members" on public.project_members;
drop policy if exists "prototype public read project_tables" on public.project_tables;
drop policy if exists "prototype public insert project_tables" on public.project_tables;
drop policy if exists "prototype public read project_columns" on public.project_columns;
drop policy if exists "prototype public insert project_columns" on public.project_columns;
drop policy if exists "prototype public read project_rows" on public.project_rows;
drop policy if exists "prototype public insert project_rows" on public.project_rows;
drop policy if exists "prototype public update project_rows" on public.project_rows;

-- Revoke every known caller-identity/anonymous legacy Parent or Club RPC.
do $revoke$
declare r regprocedure;
begin
  foreach r in array array[
    to_regprocedure('public.rename_student_account(uuid,jsonb)'),
    to_regprocedure('public.reschedule_booking_occurrences(jsonb,text,text,text)'),
    to_regprocedure('public.cancel_booking_as_parent(uuid,text,jsonb)'),
    to_regprocedure('public.cancel_booking_as_club(uuid)'),
    to_regprocedure('public.request_booking_as_parent(uuid,text,jsonb)'),
    to_regprocedure('public.manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text)'),
    to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)'),
    to_regprocedure('public.list_class_package_balances()'),
    to_regprocedure('public.add_class_package_hours(uuid,integer,text,text,uuid)')
  ] loop
    if r is not null then execute format('revoke all on function %s from public, anon, authenticated',r); end if;
  end loop;
end $revoke$;

-- Minimum browser surface. Remove PostgreSQL's default PUBLIC EXECUTE first.
revoke all on function public.club_login(text,text,text) from public;
revoke all on function public.club_refresh_session(text,text) from public;
revoke all on function public.club_logout(text) from public;
revoke all on function public.club_list_rows(text,text) from public;
revoke all on function public.club_insert_row(text,text,uuid,jsonb) from public;
revoke all on function public.club_update_row(text,text,uuid,timestamptz,jsonb) from public;
revoke all on function public.club_delete_row(text,text,uuid,timestamptz) from public;
grant execute on function public.parent_login(text,text,text) to anon,authenticated;
grant execute on function public.parent_refresh_session(text,text) to anon,authenticated;
grant execute on function public.parent_logout(text) to anon,authenticated;
grant execute on function public.parent_issue_operation_nonce(text,text) to anon,authenticated;
grant execute on function public.parent_get_account(text) to anon,authenticated;
grant execute on function public.parent_list_bookings(text) to anon,authenticated;
grant execute on function public.parent_list_bills(text) to anon,authenticated;
grant execute on function public.parent_update_account_v2(text,text,jsonb) to anon,authenticated;
grant execute on function public.parent_change_password(text,text,text,text) to anon,authenticated;
grant execute on function public.parent_begin_password_reset(text) to anon,authenticated;
grant execute on function public.parent_complete_password_reset(text,text) to anon,authenticated;
grant execute on function public.parent_cancel_future_bookings(text,text,uuid,uuid,text,timestamptz,text,timestamptz,integer) to anon,authenticated;
grant execute on function public.parent_request_booking_v2(text,text,uuid,jsonb) to anon,authenticated;
grant execute on function public.club_login(text,text,text) to anon,authenticated;
grant execute on function public.club_refresh_session(text,text) to anon,authenticated;
grant execute on function public.club_logout(text) to anon,authenticated;
grant execute on function public.club_list_rows(text,text) to anon,authenticated;
grant execute on function public.club_insert_row(text,text,uuid,jsonb) to anon,authenticated;
grant execute on function public.club_update_row(text,text,uuid,timestamptz,jsonb) to anon,authenticated;
grant execute on function public.club_delete_row(text,text,uuid,timestamptz) to anon,authenticated;

-- Backend reset delivery gets only schema usage + token creation, never table ACLs.
do $backend$
begin
  if to_regrole('service_role') is not null then
    grant usage on schema rswtta_private to service_role;
    grant execute on function rswtta_private.create_password_reset_token(uuid) to service_role;
  end if;
end $backend$;

-- Preserve private schema isolation after all definitions.
revoke all on schema rswtta_private from public,anon,authenticated;
revoke all on all tables in schema rswtta_private from public,anon,authenticated;
revoke all on all functions in schema rswtta_private from public,anon,authenticated;

commit;
