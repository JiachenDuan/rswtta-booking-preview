-- STAGED ONLY: counts and ordered-ID SHA-256 guards below are from the fresh
-- 2026-09-12 fully paginated production snapshot. Re-freeze and update them if
-- production changes before the companion activation/client rollout is reviewed.
--
-- Rollback plan: use sql/rollback/20260912211500_stage_opaque_parent_auth_and_future_cancellation.rollback.sql
-- in the same maintenance window. It verifies the private backup before restoring
-- credential keys. Sessions/nonces/idempotency rows are disposable and are revoked.

begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:20260912211500:opaque-auth', 0));
create extension if not exists pgcrypto;

-- Exact baseline guard. The ordered-ID hashes contain no PII or credential material.
-- The identifier uniqueness guard intentionally blocks the known collision until
-- ownership is resolved out-of-band; this migration never guesses which account wins.
do $guard$
declare
  v_project_id uuid;
  v_accounts_table_id uuid;
  v_bookings_table_id uuid;
  v_accounts_count bigint;
  v_bookings_count bigint;
  v_accounts_hash text;
  v_bookings_hash text;
  c_accounts_count constant bigint := 65;
  c_bookings_count constant bigint := 1978;
  c_accounts_hash constant text := '5ac42d21ab1b8fe42f774340f321027b7c7640433134e6e41feec216b13ec36b';
  c_bookings_hash constant text := '165c6a83bcd7ecfda9046ecb39c84eeea8bf62108529ef8894f7e142ff3fa679';
begin
  select id into strict v_project_id from public.projects where slug = 'rswtta-booking';
  select id into strict v_accounts_table_id from public.project_tables where project_id = v_project_id and slug = 'parent_accounts';
  select id into strict v_bookings_table_id from public.project_tables where project_id = v_project_id and slug = 'bookings';

  select count(*), encode(extensions.digest(string_agg(id::text,E'\n' order by id),'sha256'),'hex')
  into v_accounts_count, v_accounts_hash from public.project_rows where project_table_id = v_accounts_table_id;

  select count(*), encode(extensions.digest(string_agg(id::text,E'\n' order by id),'sha256'),'hex')
  into v_bookings_count, v_bookings_hash from public.project_rows where project_table_id = v_bookings_table_id;

  if v_accounts_count <> c_accounts_count or v_accounts_hash <> c_accounts_hash then
    raise exception 'Parent account baseline mismatch (count/hash)';
  end if;
  if v_bookings_count <> c_bookings_count or v_bookings_hash <> c_bookings_hash then
    raise exception 'Booking baseline mismatch (count/hash)';
  end if;
  if exists (select 1 from public.project_rows where project_table_id = v_accounts_table_id
    and (coalesce(values->>'passwordHash','') = '' or coalesce(values->>'passwordSalt','') = '')) then
    raise exception 'Every migrated account must have a complete legacy credential';
  end if;
  if exists (
    select 1 from (
      select case when position('@' in btrim(values->>'email')) > 0 then 'email:' else 'legacy:' end
             || lower(btrim(coalesce(nullif(values->>'email',''), nullif(values->>'preregisteredName',''), values->>'studentName'))) identifier,
             count(*)
      from public.project_rows where project_table_id = v_accounts_table_id
      group by 1 having count(*) <> 1
    ) duplicates
  ) then raise exception 'Login identifiers are not unique; resolve without guessing before migration'; end if;
end $guard$;

create schema if not exists rswtta_private;
revoke all on schema rswtta_private from public;
revoke all on schema rswtta_private from anon, authenticated;

-- Scoped, private, immutable backup of only affected account rows.
create table rswtta_private.backup_parent_accounts_20260912211500
as
select r.* from public.project_rows r
join public.project_tables t on t.id = r.project_table_id
join public.projects p on p.id = t.project_id
where p.slug = 'rswtta-booking' and t.slug = 'parent_accounts';
alter table rswtta_private.backup_parent_accounts_20260912211500 enable row level security;
revoke all on rswtta_private.backup_parent_accounts_20260912211500 from public;
revoke all on rswtta_private.backup_parent_accounts_20260912211500 from anon, authenticated;
comment on table rswtta_private.backup_parent_accounts_20260912211500 is
  'Rollback-only scoped backup. Contains PII/credential hashes; never expose through PostgREST.';

create table rswtta_private.auth_principals (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null check (actor_kind in ('parent','club')),
  disabled_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.household_accounts (
  principal_id uuid not null references rswtta_private.auth_principals(id),
  household_id uuid not null references rswtta_private.households(id),
  account_id uuid not null references public.project_rows(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (principal_id, account_id),
  unique (account_id)
);
create table rswtta_private.login_aliases (
  alias_digest bytea primary key check (octet_length(alias_digest) = 32),
  principal_id uuid not null references rswtta_private.auth_principals(id),
  alias_kind text not null check (alias_kind in ('email','legacy','club')),
  created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.credentials (
  principal_id uuid primary key references rswtta_private.auth_principals(id),
  algorithm text not null check (algorithm = 'pbkdf2-sha256'),
  iterations integer not null check (iterations >= 100000),
  salt bytea not null check (octet_length(salt) >= 16),
  password_hash bytea not null check (octet_length(password_hash) = 32),
  password_changed_at timestamptz not null default clock_timestamp(),
  credential_version bigint not null default 1 check (credential_version > 0)
);
create table rswtta_private.sessions (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references rswtta_private.auth_principals(id),
  access_token_hash bytea not null unique check (octet_length(access_token_hash) = 32),
  refresh_token_hash bytea not null unique check (octet_length(refresh_token_hash) = 32),
  credential_version bigint not null,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_from uuid references rswtta_private.sessions(id),
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz
);
create index sessions_principal_active_idx on rswtta_private.sessions(principal_id, expires_at) where revoked_at is null;
create table rswtta_private.operation_nonces (
  nonce_hash bytea primary key check (octet_length(nonce_hash) = 32),
  session_id uuid not null references rswtta_private.sessions(id),
  operation text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create table rswtta_private.idempotency_results (
  principal_id uuid not null references rswtta_private.auth_principals(id),
  operation text not null,
  idempotency_key uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (principal_id, operation, idempotency_key)
);
create table rswtta_private.login_attempts (
  identifier_digest bytea not null,
  client_digest bytea not null,
  attempted_at timestamptz not null default clock_timestamp(),
  succeeded boolean not null default false
);
create index login_attempts_window_idx on rswtta_private.login_attempts(identifier_digest, client_digest, attempted_at desc);
create table rswtta_private.password_resets (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  principal_id uuid not null references rswtta_private.auth_principals(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

alter table rswtta_private.auth_principals enable row level security;
alter table rswtta_private.households enable row level security;
alter table rswtta_private.household_accounts enable row level security;
alter table rswtta_private.login_aliases enable row level security;
alter table rswtta_private.credentials enable row level security;
alter table rswtta_private.sessions enable row level security;
alter table rswtta_private.operation_nonces enable row level security;
alter table rswtta_private.idempotency_results enable row level security;
alter table rswtta_private.login_attempts enable row level security;
alter table rswtta_private.password_resets enable row level security;
revoke all on all tables in schema rswtta_private from public;
revoke all on all tables in schema rswtta_private from anon, authenticated;

create function rswtta_private.deny_binding_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin raise exception 'Authentication/account bindings are immutable'; end $$;
create trigger immutable_household_accounts before update or delete on rswtta_private.household_accounts
for each row execute function rswtta_private.deny_binding_mutation();

create function rswtta_private.alias_hash(p_kind text, p_identifier text)
returns bytea language sql immutable strict set search_path = pg_catalog, extensions as $$
  select extensions.digest(convert_to(lower(btrim(p_kind)) || ':' || lower(btrim(p_identifier)), 'UTF8'), 'sha256')
$$;
create function rswtta_private.token_hash(p_token text)
returns bytea language sql immutable strict set search_path = pg_catalog, extensions as $$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
$$;

-- Implements WebCrypto PBKDF2-HMAC-SHA256 for the legacy browser format:
-- base64(16-byte salt), base64(32-byte result), 100000 iterations.
create function rswtta_private.bytea_xor(p_left bytea, p_right bytea)
returns bytea language plpgsql immutable strict set search_path = pg_catalog as $$
declare v_out bytea := p_left; i integer;
begin
  if octet_length(p_left) <> octet_length(p_right) then raise exception 'XOR length mismatch'; end if;
  for i in 0..octet_length(p_left)-1 loop
    v_out := set_byte(v_out, i, get_byte(p_left,i) # get_byte(p_right,i));
  end loop;
  return v_out;
end $$;
create function rswtta_private.pbkdf2_sha256(p_password text, p_salt bytea, p_iterations integer default 100000)
returns bytea language plpgsql immutable strict set search_path = pg_catalog, extensions, rswtta_private as $$
declare u bytea; t bytea; i integer;
begin
  if p_iterations <> 100000 then raise exception 'Unsupported legacy PBKDF2 iteration count'; end if;
  u := extensions.hmac(p_salt || decode('00000001','hex'), convert_to(p_password,'UTF8'), 'sha256');
  t := u;
  for i in 2..p_iterations loop
    u := extensions.hmac(u, convert_to(p_password,'UTF8'), 'sha256');
    t := rswtta_private.bytea_xor(t,u);
  end loop;
  return t;
end $$;

create function rswtta_private.valid_session(p_access_token text, p_actor_kind text default null)
returns table(session_id uuid, principal_id uuid, actor_kind text)
language sql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
  select s.id, s.principal_id, p.actor_kind
  from rswtta_private.sessions s
  join rswtta_private.auth_principals p on p.id=s.principal_id
  join rswtta_private.credentials c on c.principal_id=p.id
  where s.access_token_hash=rswtta_private.token_hash(p_access_token)
    and s.revoked_at is null and p.disabled_at is null
    and s.expires_at > clock_timestamp()
    and s.credential_version=c.credential_version
    and (p_actor_kind is null or p.actor_kind=p_actor_kind)
$$;

create function rswtta_private.issue_session(p_principal_id uuid, p_rotated_from uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_access text := encode(extensions.gen_random_bytes(32),'hex'); v_refresh text := encode(extensions.gen_random_bytes(48),'hex'); v_id uuid; v_version bigint;
begin
  select credential_version into strict v_version from rswtta_private.credentials where principal_id=p_principal_id;
  insert into rswtta_private.sessions(principal_id,access_token_hash,refresh_token_hash,credential_version,expires_at,refresh_expires_at,rotated_from)
  values(p_principal_id,rswtta_private.token_hash(v_access),rswtta_private.token_hash(v_refresh),v_version,
    clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '30 days',p_rotated_from) returning id into v_id;
  return jsonb_build_object('sessionToken',v_access,'refreshToken',v_refresh,'expiresAt',clock_timestamp()+interval '30 minutes','sessionId',v_id);
end $$;

-- Backend-only bootstrap for the Club principal. Run through a masked secret flow
-- after this staged migration and before activation; never place the password in SQL.
create function rswtta_private.bootstrap_club_credential(p_identifier text,p_password text)
returns uuid language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_principal uuid; v_salt bytea:=extensions.gen_random_bytes(16);
begin
  if length(coalesce(p_identifier,'')) not between 3 and 320 or length(coalesce(p_password,''))<14 then raise exception 'Invalid club credential'; end if;
  if exists(select 1 from rswtta_private.auth_principals where actor_kind='club') then raise exception 'Club principal already exists'; end if;
  insert into rswtta_private.auth_principals(actor_kind) values('club') returning id into v_principal;
  insert into rswtta_private.login_aliases(alias_digest,principal_id,alias_kind) values(rswtta_private.alias_hash('club',p_identifier),v_principal,'club');
  insert into rswtta_private.credentials(principal_id,algorithm,iterations,salt,password_hash)
  values(v_principal,'pbkdf2-sha256',100000,v_salt,rswtta_private.pbkdf2_sha256(p_password,v_salt,100000));
  return v_principal;
end $$;

-- Migrate one principal/household per existing account without storing plaintext aliases.
do $migrate$
declare v_accounts uuid; r public.project_rows%rowtype; v_principal uuid; v_household uuid; v_identifier text; v_kind text;
begin
  select t.id into strict v_accounts from public.project_tables t join public.projects p on p.id=t.project_id
  where p.slug='rswtta-booking' and t.slug='parent_accounts';
  for r in select * from public.project_rows where project_table_id=v_accounts order by id for update loop
    insert into rswtta_private.auth_principals(actor_kind) values('parent') returning id into v_principal;
    insert into rswtta_private.households default values returning id into v_household;
    insert into rswtta_private.household_accounts(principal_id,household_id,account_id) values(v_principal,v_household,r.id);
    if position('@' in btrim(coalesce(r.values->>'email',''))) > 0 then v_identifier:=r.values->>'email'; v_kind:='email';
    else v_identifier:=coalesce(nullif(r.values->>'preregisteredName',''),r.values->>'studentName'); v_kind:='legacy'; end if;
    insert into rswtta_private.login_aliases(alias_digest,principal_id,alias_kind)
    values(rswtta_private.alias_hash(v_kind,v_identifier),v_principal,v_kind);
    insert into rswtta_private.credentials(principal_id,algorithm,iterations,salt,password_hash)
    values(v_principal,'pbkdf2-sha256',100000,decode(r.values->>'passwordSalt','base64'),decode(r.values->>'passwordHash','base64'));
    update public.project_rows set values=values-'passwordHash'-'passwordSalt'-'confirmationCode' where id=r.id;
  end loop;
end $migrate$;

create function rswtta_private.reject_public_credentials()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.values ?| array['passwordHash','passwordSalt','confirmationCode','sessionToken','refreshToken'] then
    raise exception 'Credential/session material is private';
  end if; return new;
end $$;
create trigger reject_public_parent_credentials before insert or update of values on public.project_rows
for each row execute function rswtta_private.reject_public_credentials();

create function public.parent_login(p_identifier text, p_password text, p_client_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, public, rswtta_private as $$
declare v_kind text := case when position('@' in btrim(p_identifier))>0 then 'email' else 'legacy' end; v_alias bytea; v_client bytea; v_principal uuid; v_credential rswtta_private.credentials%rowtype; v_account uuid; v_result jsonb;
begin
  if length(coalesce(p_identifier,'')) not between 1 and 320 or length(coalesce(p_password,'')) not between 1 and 1024
    or length(coalesce(p_client_key,'')) not between 16 and 256 then return jsonb_build_object('ok',false,'error','Invalid login'); end if;
  v_alias:=rswtta_private.alias_hash(v_kind,p_identifier); v_client:=rswtta_private.token_hash(p_client_key);
  perform pg_advisory_xact_lock(hashtextextended('login:'||encode(v_alias,'hex'),0));
  delete from rswtta_private.login_attempts where attempted_at < clock_timestamp()-interval '1 day';
  if (select count(*) from rswtta_private.login_attempts where attempted_at>clock_timestamp()-interval '15 minutes'
      and (identifier_digest=v_alias or client_digest=v_client) and not succeeded) >= 8 then
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); return jsonb_build_object('ok',false,'error','Invalid login');
  end if;
  select principal_id into v_principal from rswtta_private.login_aliases where alias_digest=v_alias;
  if v_principal is null then
    -- Equalize unknown-user work with a fixed dummy hash; all failures remain generic.
    perform rswtta_private.pbkdf2_sha256(p_password,decode('000102030405060708090a0b0c0d0e0f','hex'),100000);
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); return jsonb_build_object('ok',false,'error','Invalid login');
  end if;
  select * into strict v_credential from rswtta_private.credentials where principal_id=v_principal;
  if extensions.digest(rswtta_private.pbkdf2_sha256(p_password,v_credential.salt,v_credential.iterations),'sha256')
     <> extensions.digest(v_credential.password_hash,'sha256') then
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); return jsonb_build_object('ok',false,'error','Invalid login');
  end if;
  insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),true);
  select account_id into v_account from rswtta_private.household_accounts where principal_id=v_principal order by account_id limit 1;
  v_result:=rswtta_private.issue_session(v_principal);
  return v_result || jsonb_build_object('ok',true,'accountId',v_account);
exception when others then
  if sqlerrm='Invalid login' then raise exception 'Invalid login'; end if; raise;
end $$;

create function public.parent_refresh_session(p_refresh_token text, p_client_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_old rswtta_private.sessions%rowtype;
begin
  if length(coalesce(p_refresh_token,''))<64 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid session'; end if;
  select * into strict v_old from rswtta_private.sessions where refresh_token_hash=rswtta_private.token_hash(p_refresh_token) for update;
  if v_old.revoked_at is not null or v_old.refresh_expires_at<=clock_timestamp() then raise exception 'Invalid session'; end if;
  update rswtta_private.sessions set revoked_at=clock_timestamp() where id=v_old.id;
  return rswtta_private.issue_session(v_old.principal_id,v_old.id);
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_logout(p_session_token text)
returns void language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
begin update rswtta_private.sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where access_token_hash=rswtta_private.token_hash(p_session_token); end $$;

create function public.parent_issue_operation_nonce(p_session_token text, p_operation text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_session uuid; v_nonce text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  if p_operation not in ('cancel_future_bookings','change_password') then raise exception 'Invalid operation'; end if;
  select session_id into strict v_session from rswtta_private.valid_session(p_session_token,'parent');
  delete from rswtta_private.operation_nonces where expires_at<clock_timestamp();
  insert into rswtta_private.operation_nonces(nonce_hash,session_id,operation,expires_at)
  values(rswtta_private.token_hash(v_nonce),v_session,p_operation,clock_timestamp()+interval '5 minutes');
  return jsonb_build_object('operationNonce',v_nonce,'expiresAt',clock_timestamp()+interval '5 minutes');
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_get_account(p_session_token text)
returns public.project_rows language plpgsql security definer set search_path = pg_catalog, extensions, public, rswtta_private as $$
declare v_principal uuid; v_account uuid; v_row public.project_rows%rowtype;
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent');
  select account_id into strict v_account from rswtta_private.household_accounts where principal_id=v_principal order by account_id limit 1;
  select * into strict v_row from public.project_rows where id=v_account; return v_row;
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_list_bookings(p_session_token text)
returns setof public.project_rows language plpgsql security definer set search_path = pg_catalog, extensions, public, rswtta_private as $$
declare v_principal uuid; v_bookings uuid;
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent');
  select t.id into strict v_bookings from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings';
  return query select r.* from public.project_rows r join rswtta_private.household_accounts a
    on a.account_id::text=r.values->>'studentAccountId' and a.principal_id=v_principal where r.project_table_id=v_bookings order by r.created_at,r.id;
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_list_bills(p_session_token text)
returns setof public.project_rows language plpgsql security definer set search_path = pg_catalog, extensions, public, rswtta_private as $$
declare v_principal uuid; v_bills uuid;
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent');
  select t.id into strict v_bills from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bill_notifications';
  return query select r.* from public.project_rows r join rswtta_private.household_accounts a
    on a.account_id::text=r.values->>'studentAccountId' and a.principal_id=v_principal where r.project_table_id=v_bills order by r.created_at,r.id;
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_update_account_v2(p_session_token text,p_operation_nonce text,p_values jsonb)
returns public.project_rows language plpgsql security definer set search_path = pg_catalog, extensions, public, rswtta_private as $$
declare v_session uuid; v_principal uuid; v_account uuid; v_row public.project_rows%rowtype; v_safe jsonb;
begin
  select session_id,principal_id into strict v_session,v_principal from rswtta_private.valid_session(p_session_token,'parent');
  update rswtta_private.operation_nonces set consumed_at=clock_timestamp() where nonce_hash=rswtta_private.token_hash(p_operation_nonce)
    and session_id=v_session and operation='update_account' and consumed_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'Invalid or replayed operation'; end if;
  select account_id into strict v_account from rswtta_private.household_accounts where principal_id=v_principal order by account_id limit 1;
  v_safe:=p_values-'id'-'accountId'-'studentAccountId'-'passwordHash'-'passwordSalt'-'confirmationCode';
  select public.rename_student_account(v_account,v_safe) into v_row; return v_row;
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_change_password(p_session_token text,p_operation_nonce text,p_current_password text,p_new_password text)
returns void language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_session uuid; v_principal uuid; v_cred rswtta_private.credentials%rowtype; v_salt bytea:=extensions.gen_random_bytes(16);
begin
  if length(coalesce(p_new_password,''))<10 then raise exception 'Password does not meet policy'; end if;
  select session_id,principal_id into strict v_session,v_principal from rswtta_private.valid_session(p_session_token,'parent');
  update rswtta_private.operation_nonces set consumed_at=clock_timestamp() where nonce_hash=rswtta_private.token_hash(p_operation_nonce)
    and session_id=v_session and operation='change_password' and consumed_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'Invalid or replayed operation'; end if;
  select * into strict v_cred from rswtta_private.credentials where principal_id=v_principal for update;
  if extensions.digest(rswtta_private.pbkdf2_sha256(p_current_password,v_cred.salt,v_cred.iterations),'sha256')<>extensions.digest(v_cred.password_hash,'sha256') then raise exception 'Invalid credential'; end if;
  update rswtta_private.credentials set salt=v_salt,password_hash=rswtta_private.pbkdf2_sha256(p_new_password,v_salt,100000),
    password_changed_at=clock_timestamp(),credential_version=credential_version+1 where principal_id=v_principal;
  update rswtta_private.sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where principal_id=v_principal;
end $$;

-- Backend-only reset-token creation. A trusted email worker calls this function,
-- delivers the returned one-time token, and never logs it. It is intentionally
-- not granted to browser roles. The public begin RPC below always returns the same response.
create function rswtta_private.create_password_reset_token(p_principal_id uuid)
returns text language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_token text:=encode(extensions.gen_random_bytes(48),'hex');
begin
  insert into rswtta_private.password_resets(token_hash,principal_id,expires_at)
  values(rswtta_private.token_hash(v_token),p_principal_id,clock_timestamp()+interval '30 minutes'); return v_token;
end $$;
create function public.parent_begin_password_reset(p_identifier text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
begin
  -- Queue integration intentionally follows in a separately reviewed email outbox;
  -- do not reveal whether the hashed alias exists.
  return jsonb_build_object('accepted',true);
end $$;
create function public.parent_complete_password_reset(p_reset_token text,p_new_password text)
returns void language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_reset rswtta_private.password_resets%rowtype; v_salt bytea:=extensions.gen_random_bytes(16);
begin
  if length(coalesce(p_new_password,''))<10 then raise exception 'Invalid or expired reset'; end if;
  select * into strict v_reset from rswtta_private.password_resets where token_hash=rswtta_private.token_hash(p_reset_token) for update;
  if v_reset.consumed_at is not null or v_reset.expires_at<=clock_timestamp() then raise exception 'Invalid or expired reset'; end if;
  update rswtta_private.password_resets set consumed_at=clock_timestamp() where token_hash=v_reset.token_hash;
  update rswtta_private.credentials set salt=v_salt,password_hash=rswtta_private.pbkdf2_sha256(p_new_password,v_salt,100000),
    password_changed_at=clock_timestamp(),credential_version=credential_version+1 where principal_id=v_reset.principal_id;
  update rswtta_private.sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where principal_id=v_reset.principal_id;
exception when no_data_found then raise exception 'Invalid or expired reset'; end $$;

create function public.parent_cancel_future_bookings(
  p_session_token text,p_operation_nonce text,p_idempotency_key uuid,p_selected_booking_id uuid,
  p_expected_status text,p_expected_updated_at timestamptz,p_expected_series_id text,
  p_expected_original_starts_at timestamptz,p_expected_eligible_count integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, public, rswtta_private as $$
declare
  v_session uuid; v_principal uuid; v_bookings uuid; v_activity uuid; v_selected public.project_rows%rowtype;
  v_ids uuid[]; v_count integer; v_now timestamptz:=clock_timestamp(); v_request_hash bytea; v_prior jsonb; v_result jsonb;
begin
  if p_idempotency_key is null or p_selected_booking_id is null or p_expected_eligible_count<1 then raise exception 'Invalid cancellation request'; end if;
  select session_id,principal_id into strict v_session,v_principal from rswtta_private.valid_session(p_session_token,'parent');
  v_request_hash:=extensions.digest(convert_to(concat_ws('|',p_selected_booking_id,p_expected_status,p_expected_updated_at,p_expected_series_id,p_expected_original_starts_at,p_expected_eligible_count),'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended('parent-cancel-idempotency:'||v_principal::text||':'||p_idempotency_key::text,0));
  select result into v_prior from rswtta_private.idempotency_results where principal_id=v_principal and operation='cancel_future_bookings'
    and idempotency_key=p_idempotency_key and request_hash=v_request_hash;
  if found then return v_prior; end if;
  if exists(select 1 from rswtta_private.idempotency_results where principal_id=v_principal and operation='cancel_future_bookings' and idempotency_key=p_idempotency_key) then raise exception 'Idempotency key payload mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('parent-cancel:'||v_principal::text||':'||p_expected_series_id,0));
  update rswtta_private.operation_nonces set consumed_at=clock_timestamp() where nonce_hash=rswtta_private.token_hash(p_operation_nonce)
    and session_id=v_session and operation='cancel_future_bookings' and consumed_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'Invalid or replayed operation'; end if;
  select t.id into strict v_bookings from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings';
  select t.id into strict v_activity from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='activity_logs';
  select r.* into strict v_selected from public.project_rows r join rswtta_private.household_accounts a
    on a.account_id::text=r.values->>'studentAccountId' and a.principal_id=v_principal
    where r.id=p_selected_booking_id and r.project_table_id=v_bookings for update of r;
  if coalesce(v_selected.values->>'groupClassId','')<>'' or v_selected.values->>'program'='Group class' then raise exception 'Group bookings cannot use parent future cancellation'; end if;
  if coalesce(v_selected.values->>'status','') not in ('requested','club_confirmed')
    or coalesce(v_selected.values->>'status','')<>p_expected_status or v_selected.updated_at<>p_expected_updated_at then raise exception 'Selected booking changed'; end if;
  if coalesce(v_selected.values->>'seriesId','')='' or v_selected.values->>'seriesId'<>p_expected_series_id
    or coalesce(v_selected.values->>'recurrenceOriginalStartsAt','')='' or (v_selected.values->>'recurrenceOriginalStartsAt')::timestamptz<>p_expected_original_starts_at then raise exception 'Immutable recurrence boundary changed'; end if;
  if (v_selected.values->>'startsAt')::timestamptz<=v_now+interval '12 hours' then raise exception 'Selected booking is inside the cancellation cutoff'; end if;

  perform 1 from public.project_rows r join rswtta_private.household_accounts a on a.account_id::text=r.values->>'studentAccountId' and a.principal_id=v_principal
    where r.project_table_id=v_bookings and r.values->>'seriesId'=p_expected_series_id
      and coalesce(r.values->>'groupClassId','')='' and r.values->>'program'<>'Group class'
      and (r.values->>'recurrenceOriginalStartsAt')::timestamptz>=p_expected_original_starts_at
    order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz,r.id for update of r;
  select coalesce(array_agg(r.id order by (r.values->>'recurrenceOriginalStartsAt')::timestamptz,r.id),'{}'),count(*)
  into v_ids,v_count from public.project_rows r join rswtta_private.household_accounts a
    on a.account_id::text=r.values->>'studentAccountId' and a.principal_id=v_principal
    where r.project_table_id=v_bookings and r.values->>'seriesId'=p_expected_series_id
      and coalesce(r.values->>'groupClassId','')='' and r.values->>'program'<>'Group class'
      and (r.values->>'recurrenceOriginalStartsAt')::timestamptz>=p_expected_original_starts_at
      and (r.values->>'startsAt')::timestamptz>v_now+interval '12 hours'
      and coalesce(r.values->>'status','') in ('requested','club_confirmed');
  if not(p_selected_booking_id=any(v_ids)) or v_count<>p_expected_eligible_count then raise exception 'Eligible cancellation set changed'; end if;
  perform set_config('rswtta.cancellation_actor','parent',true);
  update public.project_rows set values=values||jsonb_build_object('status','cancelled','cancelledAt',v_now,'cancellationSource','parent_future') where id=any(v_ids);
  v_result:=jsonb_build_object('selectedBookingId',p_selected_booking_id,'seriesId',p_expected_series_id,
    'boundaryOriginalStartsAt',p_expected_original_starts_at,'cancelledCount',v_count,'cancelledBookingIds',to_jsonb(v_ids),'serverTime',v_now);
  insert into public.project_rows(project_table_id,values) values(v_activity,jsonb_build_object(
    'action','parent_future_bookings_cancelled','message',format('Parent cancelled %s eligible persisted booking(s) from immutable recurrence boundary.',v_count),
    'count',v_count,'selectedBookingId',p_selected_booking_id,'seriesId',p_expected_series_id,
    'boundaryOriginalStartsAt',p_expected_original_starts_at,'cancelledBookingIds',to_jsonb(v_ids),'serverTime',v_now));
  insert into rswtta_private.idempotency_results(principal_id,operation,idempotency_key,request_hash,result)
    values(v_principal,'cancel_future_bookings',p_idempotency_key,v_request_hash,v_result);
  return v_result;
exception when no_data_found then raise exception 'Invalid session or booking';
when invalid_text_representation or datetime_field_overflow then raise exception 'Invalid recurrence identity'; end $$;

-- Parent writes use the same rule: the account identity is selected only from the
-- valid session binding. No function below accepts caller account/email fields.
create function public.parent_request_booking_v2(p_session_token text,p_operation_nonce text,p_request_id uuid,p_values jsonb)
returns public.project_rows language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_session uuid; v_principal uuid; v_account uuid; v_nonce_found boolean; v_row public.project_rows%rowtype;
begin
  select session_id,principal_id into strict v_session,v_principal from rswtta_private.valid_session(p_session_token,'parent');
  select account_id into strict v_account from rswtta_private.household_accounts where principal_id=v_principal order by account_id limit 1;
  update rswtta_private.operation_nonces set consumed_at=clock_timestamp() where nonce_hash=rswtta_private.token_hash(p_operation_nonce)
    and session_id=v_session and operation='request_booking' and consumed_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'Invalid or replayed operation'; end if;
  select public.request_booking_as_parent(p_request_id,v_account::text,(p_values-'studentAccountId'-'studentEmail')||jsonb_build_object('studentAccountId',v_account::text)) into v_row;
  return v_row;
exception when no_data_found then raise exception 'Invalid session'; end $$;

-- Extend nonce allow-list for the staged booking wrapper.
create or replace function public.parent_issue_operation_nonce(p_session_token text, p_operation text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_session uuid; v_nonce text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  if p_operation not in ('cancel_future_bookings','change_password','request_booking','update_account') then raise exception 'Invalid operation'; end if;
  select session_id into strict v_session from rswtta_private.valid_session(p_session_token,'parent');
  delete from rswtta_private.operation_nonces where expires_at<clock_timestamp();
  insert into rswtta_private.operation_nonces(nonce_hash,session_id,operation,expires_at)
  values(rswtta_private.token_hash(v_nonce),v_session,p_operation,clock_timestamp()+interval '5 minutes');
  return jsonb_build_object('operationNonce',v_nonce,'expiresAt',clock_timestamp()+interval '5 minutes');
exception when no_data_found then raise exception 'Invalid session'; end $$;

-- No browser grants are added here. Activation is an explicit separate migration.
revoke all on all functions in schema rswtta_private from public;
revoke all on all functions in schema rswtta_private from anon, authenticated;
revoke all on function public.parent_login(text,text,text) from public;
revoke all on function public.parent_refresh_session(text,text) from public;
revoke all on function public.parent_logout(text) from public;
revoke all on function public.parent_issue_operation_nonce(text,text) from public;
revoke all on function public.parent_get_account(text) from public;
revoke all on function public.parent_list_bookings(text) from public;
revoke all on function public.parent_list_bills(text) from public;
revoke all on function public.parent_update_account_v2(text,text,jsonb) from public;
revoke all on function public.parent_change_password(text,text,text,text) from public;
revoke all on function public.parent_begin_password_reset(text) from public;
revoke all on function public.parent_complete_password_reset(text,text) from public;
revoke all on function public.parent_cancel_future_bookings(text,text,uuid,uuid,text,timestamptz,text,timestamptz,integer) from public;
revoke all on function public.parent_request_booking_v2(text,text,uuid,jsonb) from public;

-- Verify backup identity against pre-move values and ensure public secrets are gone.
do $verify$
declare v_accounts uuid; v_live bigint; v_backup bigint; v_live_ids text; v_backup_ids text;
begin
  select t.id into strict v_accounts from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='parent_accounts';
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,',' order by id),''),'sha256'),'hex') into v_live,v_live_ids from public.project_rows where project_table_id=v_accounts;
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,',' order by id),''),'sha256'),'hex') into v_backup,v_backup_ids from rswtta_private.backup_parent_accounts_20260912211500;
  if v_live<>v_backup or v_live_ids<>v_backup_ids then raise exception 'Private backup verification failed'; end if;
  if exists(select 1 from public.project_rows where project_table_id=v_accounts and values ?| array['passwordHash','passwordSalt','confirmationCode']) then raise exception 'Public credential removal failed'; end if;
  if (select count(*) from rswtta_private.credentials)<>v_live or (select count(*) from rswtta_private.household_accounts)<>v_live then raise exception 'Private credential/binding count mismatch'; end if;
end $verify$;
commit;
