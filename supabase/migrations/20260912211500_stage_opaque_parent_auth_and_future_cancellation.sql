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
-- Known identifier collisions do not block credential/binding migration. Login aliases
-- are created only where one normalized identifier resolves to exactly one account.
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
  client_digest bytea not null check (octet_length(client_digest) = 32),
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

create function rswtta_private.issue_session(p_principal_id uuid,p_client_digest bytea,p_rotated_from uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, extensions, rswtta_private as $$
declare v_access text := encode(extensions.gen_random_bytes(32),'hex'); v_refresh text := encode(extensions.gen_random_bytes(48),'hex'); v_id uuid; v_version bigint;
begin
  if octet_length(p_client_digest)<>32 then raise exception 'Invalid client binding'; end if;
  select credential_version into strict v_version from rswtta_private.credentials where principal_id=p_principal_id;
  insert into rswtta_private.sessions(principal_id,access_token_hash,refresh_token_hash,credential_version,client_digest,expires_at,refresh_expires_at,rotated_from)
  values(p_principal_id,rswtta_private.token_hash(v_access),rswtta_private.token_hash(v_refresh),v_version,p_client_digest,
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

-- Migrate all credentials and immutable account bindings. Alias candidates are
-- normalized and grouped first; ambiguous email/name aliases are omitted rather than
-- guessed. Such accounts remain migrated but cannot log in until an administrator
-- adds a uniquely verified alias through a separately reviewed recovery process.
do $migrate$
declare v_accounts uuid; r public.project_rows%rowtype; v_principal uuid; v_household uuid;
begin
  select t.id into strict v_accounts from public.project_tables t join public.projects p on p.id=t.project_id
  where p.slug='rswtta-booking' and t.slug='parent_accounts';
  for r in select * from public.project_rows where project_table_id=v_accounts order by id for update loop
    insert into rswtta_private.auth_principals(actor_kind) values('parent') returning id into v_principal;
    insert into rswtta_private.households default values returning id into v_household;
    insert into rswtta_private.household_accounts(principal_id,household_id,account_id) values(v_principal,v_household,r.id);
    insert into rswtta_private.credentials(principal_id,algorithm,iterations,salt,password_hash)
    values(v_principal,'pbkdf2-sha256',100000,decode(r.values->>'passwordSalt','base64'),decode(r.values->>'passwordHash','base64'));
  end loop;

  insert into rswtta_private.login_aliases(alias_digest,principal_id,alias_kind)
  select rswtta_private.alias_hash(c.kind,c.identifier),ha.principal_id,c.kind
  from (
    select account_id,kind,identifier
    from (
      select r.id account_id,'email'::text kind,lower(btrim(r.values->>'email')) identifier
      from public.project_rows r where r.project_table_id=v_accounts and position('@' in btrim(coalesce(r.values->>'email','')))>0
      union
      select r.id,'legacy',lower(btrim(x.identifier))
      from public.project_rows r
      cross join lateral (values(nullif(r.values->>'preregisteredName','')),(nullif(r.values->>'studentName',''))) x(identifier)
      where r.project_table_id=v_accounts and nullif(btrim(x.identifier),'') is not null
    ) candidates
    where (kind,identifier) in (
      select kind,identifier from (
        select distinct account_id,kind,identifier from (
          select r.id account_id,'email'::text kind,lower(btrim(r.values->>'email')) identifier
          from public.project_rows r where r.project_table_id=v_accounts and position('@' in btrim(coalesce(r.values->>'email','')))>0
          union
          select r.id,'legacy',lower(btrim(x.identifier))
          from public.project_rows r cross join lateral (values(nullif(r.values->>'preregisteredName','')),(nullif(r.values->>'studentName',''))) x(identifier)
          where r.project_table_id=v_accounts and nullif(btrim(x.identifier),'') is not null
        ) all_candidates
      ) distinct_candidates group by kind,identifier having count(*)=1
    )
  ) c join rswtta_private.household_accounts ha on ha.account_id=c.account_id
  on conflict (alias_digest) do nothing;
end $migrate$;

-- Public credential JSON and the legacy production client remain untouched during
-- shadow staging. Removal and the rejection trigger are activation-only operations.

-- JSON adapters keep public row metadata and sensitive account selection server-side.
create function rswtta_private.parent_account_id(p_principal_id uuid)
returns uuid language sql stable strict security definer set search_path=pg_catalog,rswtta_private as $$
  select account_id from rswtta_private.household_accounts where principal_id=p_principal_id order by account_id limit 1
$$;

create function rswtta_private.row_json(p_row public.project_rows)
returns jsonb language sql immutable strict set search_path=pg_catalog as $$
  select coalesce(p_row.values,'{}'::jsonb)||jsonb_build_object('id',p_row.id,'createdAt',p_row.created_at,'updatedAt',p_row.updated_at)
$$;

create function rswtta_private.parent_dashboard(p_principal_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,rswtta_private as $$
declare v_account_id uuid; v_account public.project_rows%rowtype; v_bookings uuid; v_own jsonb; v_calendar jsonb;
begin
  v_account_id:=rswtta_private.parent_account_id(p_principal_id);
  select * into strict v_account from public.project_rows where id=v_account_id;
  select t.id into strict v_bookings from public.project_tables t join public.projects p on p.id=t.project_id
    where p.slug='rswtta-booking' and t.slug='bookings';
  select coalesce(jsonb_agg(rswtta_private.row_json(r) order by r.values->>'startsAt',r.id),'[]'::jsonb)
    into v_own from public.project_rows r where r.project_table_id=v_bookings and r.values->>'studentAccountId'=v_account_id::text;
  select coalesce(jsonb_agg(
    case when r.values->>'studentAccountId'=v_account_id::text then rswtta_private.row_json(r)
    else (rswtta_private.row_json(r)-'studentAccountId'-'studentEmail'-'phone'-'parentNote')
      ||jsonb_build_object('studentName','','familyName','') end
    order by r.values->>'startsAt',r.id),'[]'::jsonb)
    into v_calendar from public.project_rows r where r.project_table_id=v_bookings;
  return jsonb_build_object(
    'account',(rswtta_private.row_json(v_account)-'passwordHash'-'passwordSalt'-'confirmationCode'),
    'bookings',v_own,'calendarBookings',v_calendar,'serverNow',clock_timestamp());
end $$;

create function rswtta_private.set_unique_email_alias(p_principal_id uuid,p_email text)
returns void language plpgsql security definer set search_path=pg_catalog,rswtta_private as $$
declare v_digest bytea;
begin
  if position('@' in btrim(coalesce(p_email,'')))=0 then raise exception 'A valid email is required'; end if;
  v_digest:=rswtta_private.alias_hash('email',p_email);
  if exists(select 1 from rswtta_private.login_aliases where alias_digest=v_digest and principal_id<>p_principal_id) then
    raise exception 'Email is already used by another account';
  end if;
  delete from rswtta_private.login_aliases where principal_id=p_principal_id and alias_kind='email';
  insert into rswtta_private.login_aliases(alias_digest,principal_id,alias_kind) values(v_digest,p_principal_id,'email') on conflict do nothing;
end $$;

create function public.parent_session_login(p_username text,p_password text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_kind text:=case when position('@' in btrim(coalesce(p_username,'')))>0 then 'email' else 'legacy' end; v_alias bytea; v_client bytea; v_principal uuid; v_credential rswtta_private.credentials%rowtype; v_session jsonb;
begin
  if length(coalesce(p_username,'')) not between 1 and 320 or length(coalesce(p_password,'')) not between 1 and 1024 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid login'; end if;
  v_alias:=rswtta_private.alias_hash(v_kind,p_username); v_client:=rswtta_private.token_hash(p_client_key);
  perform pg_advisory_xact_lock(hashtextextended('parent-login:'||encode(v_alias,'hex'),0));
  delete from rswtta_private.login_attempts where attempted_at<clock_timestamp()-interval '1 day';
  if (select count(*) from rswtta_private.login_attempts where attempted_at>clock_timestamp()-interval '15 minutes' and (identifier_digest=v_alias or client_digest=v_client) and not succeeded)>=8 then
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); raise exception 'Invalid login';
  end if;
  select principal_id into v_principal from rswtta_private.login_aliases where alias_digest=v_alias and alias_kind=v_kind;
  if v_principal is null then
    perform rswtta_private.pbkdf2_sha256(p_password,decode('000102030405060708090a0b0c0d0e0f','hex'),100000);
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); raise exception 'Invalid login';
  end if;
  select * into strict v_credential from rswtta_private.credentials where principal_id=v_principal;
  if rswtta_private.pbkdf2_sha256(p_password,v_credential.salt,v_credential.iterations)<>v_credential.password_hash then
    insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),false); raise exception 'Invalid login';
  end if;
  insert into rswtta_private.login_attempts values(v_alias,v_client,clock_timestamp(),true);
  v_session:=rswtta_private.issue_session(v_principal,v_client);
  return v_session||rswtta_private.parent_dashboard(v_principal);
exception when no_data_found then raise exception 'Invalid login'; end $$;

create function public.parent_session_refresh(p_session_token text,p_refresh_token text,p_client_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,rswtta_private as $$
declare v_old rswtta_private.sessions%rowtype; v_session jsonb;
begin
  if length(coalesce(p_session_token,''))<64 or length(coalesce(p_refresh_token,''))<64 or length(coalesce(p_client_key,'')) not between 16 and 256 then raise exception 'Invalid session'; end if;
  select * into strict v_old from rswtta_private.sessions where access_token_hash=rswtta_private.token_hash(p_session_token)
    and refresh_token_hash=rswtta_private.token_hash(p_refresh_token) for update;
  if v_old.revoked_at is not null or v_old.refresh_expires_at<=clock_timestamp() or v_old.client_digest<>rswtta_private.token_hash(p_client_key) then raise exception 'Invalid session'; end if;
  if exists(select 1 from rswtta_private.auth_principals where id=v_old.principal_id and (actor_kind<>'parent' or disabled_at is not null)) then raise exception 'Invalid session'; end if;
  update rswtta_private.sessions set revoked_at=clock_timestamp(),last_seen_at=clock_timestamp() where id=v_old.id;
  v_session:=rswtta_private.issue_session(v_old.principal_id,v_old.client_digest,v_old.id);
  return v_session||rswtta_private.parent_dashboard(v_old.principal_id);
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_session_logout(p_session_token text)
returns void language plpgsql security definer set search_path=pg_catalog,extensions,rswtta_private as $$
begin
  update rswtta_private.sessions set revoked_at=coalesce(revoked_at,clock_timestamp())
  where access_token_hash=rswtta_private.token_hash(p_session_token)
    and principal_id in(select id from rswtta_private.auth_principals where actor_kind='parent');
end $$;

create function public.parent_issue_operation_nonce(p_session_token text,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,rswtta_private as $$
declare v_session uuid; v_nonce text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  if p_operation<>'cancel_booking_occurrences' then raise exception 'Invalid operation'; end if;
  select session_id into strict v_session from rswtta_private.valid_session(p_session_token,'parent');
  delete from rswtta_private.operation_nonces where expires_at<clock_timestamp();
  insert into rswtta_private.operation_nonces(nonce_hash,session_id,operation,expires_at)
    values(rswtta_private.token_hash(v_nonce),v_session,p_operation,clock_timestamp()+interval '5 minutes');
  return jsonb_build_object('operationNonce',v_nonce,'expiresAt',clock_timestamp()+interval '5 minutes');
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_update_profile(p_session_token text,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_principal uuid; v_account uuid; v_safe jsonb;
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent');
  v_account:=rswtta_private.parent_account_id(v_principal);
  if btrim(coalesce(p_profile->>'studentName',''))='' or position('@' in btrim(coalesce(p_profile->>'email','')))=0 or length(btrim(coalesce(p_profile->>'phone','')))<7 then raise exception 'Student name, email, and phone are required'; end if;
  perform rswtta_private.set_unique_email_alias(v_principal,p_profile->>'email');
  v_safe:=jsonb_build_object('studentName',btrim(p_profile->>'studentName'),'parentName',btrim(coalesce(p_profile->>'parentName','')),'email',lower(btrim(p_profile->>'email')),'phone',btrim(p_profile->>'phone'));
  perform public.rename_student_account(v_account,v_safe);
  return rswtta_private.parent_dashboard(v_principal);
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_complete_profile(p_session_token text,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_principal uuid; v_account uuid; v_safe jsonb; v_salt bytea:=extensions.gen_random_bytes(16);
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent');
  v_account:=rswtta_private.parent_account_id(v_principal);
  if btrim(coalesce(p_profile->>'studentName',''))='' or position('@' in btrim(coalesce(p_profile->>'email','')))=0 or length(btrim(coalesce(p_profile->>'phone','')))<7 or length(coalesce(p_profile->>'password',''))<10 then raise exception 'Profile and a new password are required'; end if;
  perform rswtta_private.set_unique_email_alias(v_principal,p_profile->>'email');
  v_safe:=jsonb_build_object('studentName',btrim(p_profile->>'studentName'),'parentName',btrim(coalesce(p_profile->>'parentName','')),'email',lower(btrim(p_profile->>'email')),'phone',btrim(p_profile->>'phone'),'confirmed',true,'profileSetupRequired',false);
  perform public.rename_student_account(v_account,v_safe);
  update rswtta_private.credentials set salt=v_salt,password_hash=rswtta_private.pbkdf2_sha256(p_profile->>'password',v_salt,100000),password_changed_at=clock_timestamp(),credential_version=credential_version+1 where principal_id=v_principal;
  update rswtta_private.sessions set credential_version=(select credential_version from rswtta_private.credentials where principal_id=v_principal) where access_token_hash=rswtta_private.token_hash(p_session_token) and revoked_at is null;
  update rswtta_private.sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where principal_id=v_principal and access_token_hash<>rswtta_private.token_hash(p_session_token);
  return rswtta_private.parent_dashboard(v_principal);
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_request_password_reset(p_username text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  -- No mail worker/outbox is staged. Keep the response generic and honest.
  return jsonb_build_object('accepted',true,'queued',false,'delivery','unsupported');
end $$;

create function public.parent_request_booking(p_session_token text,p_idempotency_key uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_principal uuid; v_account uuid;
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent');
  if p_idempotency_key is null then raise exception 'A unique request identity is required'; end if;
  v_account:=rswtta_private.parent_account_id(v_principal);
  perform public.request_booking_as_parent(p_idempotency_key,v_account::text,(p_values-'studentAccountId'-'studentEmail'-'studentName'-'familyName'-'phone')||jsonb_build_object('studentAccountId',v_account::text));
  return rswtta_private.parent_dashboard(v_principal);
exception when no_data_found then raise exception 'Invalid session'; end $$;

create function public.parent_request_group_class(p_session_token text,p_selected_booking_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_principal uuid; v_account uuid; v_bookings uuid; v_group public.project_rows%rowtype; v_parent public.project_rows%rowtype; v_values jsonb;
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent');
  v_account:=rswtta_private.parent_account_id(v_principal);
  select * into strict v_parent from public.project_rows where id=v_account;
  select t.id into strict v_bookings from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings';
  select * into strict v_group from public.project_rows where id=p_selected_booking_id and project_table_id=v_bookings for update;
  if p_idempotency_key is null or v_group.values->>'program'<>'Group class' or coalesce(v_group.values->>'groupClassId','')='' or coalesce(v_group.values->>'status','')='cancelled' or (v_group.values->>'startsAt')::timestamptz<=clock_timestamp() then raise exception 'Group class is unavailable'; end if;
  if public.rswtta_canonical_coach_id(coalesce(nullif(v_group.values->>'assignedCoach',''),v_group.values->>'requestedCoach',''))='coach_tian_ye' then raise exception 'Coach Tian Ye’s classes cannot be booked directly through this app.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('parent-group:'||v_account::text||':'||(v_group.values->>'groupClassId'),0));
  if not exists(select 1 from public.project_rows where project_table_id=v_bookings and values->>'studentAccountId'=v_account::text and values->>'groupClassId'=v_group.values->>'groupClassId' and values->>'startsAt'=v_group.values->>'startsAt' and coalesce(values->>'status','')<>'cancelled') then
    v_values:=(v_group.values-'id'-'createdAt'-'updatedAt')||jsonb_build_object('studentAccountId',v_account::text,'studentName',coalesce(v_parent.values->>'studentName',''),'familyName',coalesce(v_parent.values->>'studentName',''),'studentEmail',coalesce(v_parent.values->>'email',''),'phone',coalesce(v_parent.values->>'phone',''),'status','requested','parentNote','Group class join request');
    insert into public.project_rows(id,project_table_id,values) values(p_idempotency_key,v_bookings,v_values);
  end if;
  return rswtta_private.parent_dashboard(v_principal);
exception when no_data_found then raise exception 'Invalid session or group class'; end $$;

create function public.parent_complete_booking(p_session_token text,p_selected_booking_id uuid,p_expected_selected_version timestamptz,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_principal uuid; v_account uuid; v_bookings uuid; v_row public.project_rows%rowtype;
begin
  select principal_id into strict v_principal from rswtta_private.valid_session(p_session_token,'parent'); v_account:=rswtta_private.parent_account_id(v_principal);
  select t.id into strict v_bookings from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings';
  select * into strict v_row from public.project_rows where id=p_selected_booking_id and project_table_id=v_bookings and values->>'studentAccountId'=v_account::text for update;
  if p_idempotency_key is null or v_row.updated_at<>p_expected_selected_version or coalesce(v_row.values->>'status','')<>'club_confirmed' or (v_row.values->>'startsAt')::timestamptz>clock_timestamp() then raise exception 'Booking changed or cannot be completed'; end if;
  update public.project_rows set values=values||jsonb_build_object('status','coach_confirmed') where id=v_row.id;
  return rswtta_private.parent_dashboard(v_principal);
exception when no_data_found then raise exception 'Invalid session or booking'; end $$;

create function public.parent_cancel_booking_occurrences(
  p_session_token text,p_operation_nonce text,p_selected_booking_id uuid,p_scope text,p_idempotency_key uuid,
  p_expected_selected_version timestamptz,p_expected_series_id text,p_expected_original_starts_at timestamptz,p_expected_eligible_count integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,extensions,public,rswtta_private as $$
declare v_session uuid; v_principal uuid; v_account uuid; v_bookings uuid; v_activity uuid; v_selected public.project_rows%rowtype; v_ids uuid[]; v_count integer; v_now timestamptz:=clock_timestamp(); v_request_hash bytea; v_prior jsonb; v_result jsonb;
begin
  if p_scope not in ('selected','selected_and_future') or p_idempotency_key is null or p_expected_eligible_count<1 then raise exception 'Invalid cancellation request'; end if;
  select session_id,principal_id into strict v_session,v_principal from rswtta_private.valid_session(p_session_token,'parent'); v_account:=rswtta_private.parent_account_id(v_principal);
  v_request_hash:=extensions.digest(convert_to(concat_ws('|',p_selected_booking_id,p_scope,p_expected_selected_version,p_expected_series_id,p_expected_original_starts_at,p_expected_eligible_count),'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended('parent-cancel-idempotency:'||v_principal::text||':'||p_idempotency_key::text,0));
  select result into v_prior from rswtta_private.idempotency_results where principal_id=v_principal and operation='cancel_booking_occurrences' and idempotency_key=p_idempotency_key and request_hash=v_request_hash;
  if found then return v_prior; end if;
  if exists(select 1 from rswtta_private.idempotency_results where principal_id=v_principal and operation='cancel_booking_occurrences' and idempotency_key=p_idempotency_key) then raise exception 'Idempotency key payload mismatch'; end if;
  update rswtta_private.operation_nonces set consumed_at=clock_timestamp() where nonce_hash=rswtta_private.token_hash(p_operation_nonce) and session_id=v_session and operation='cancel_booking_occurrences' and consumed_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'Invalid or replayed operation'; end if;
  select t.id into strict v_bookings from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='bookings';
  select t.id into strict v_activity from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='activity_logs';
  select * into strict v_selected from public.project_rows where id=p_selected_booking_id and project_table_id=v_bookings and values->>'studentAccountId'=v_account::text for update;
  if v_selected.updated_at<>p_expected_selected_version or coalesce(v_selected.values->>'status','') not in ('requested','club_confirmed') or (v_selected.values->>'startsAt')::timestamptz<=v_now+interval '12 hours' then raise exception 'Selected booking changed or is inside cutoff'; end if;
  if coalesce(v_selected.values->>'groupClassId','')<>'' or v_selected.values->>'program' in ('Group class','Unavailable') then raise exception 'Protected/group rows cannot be cancelled'; end if;
  if coalesce(v_selected.values->>'seriesId','')<>coalesce(p_expected_series_id,'') or coalesce((v_selected.values->>'recurrenceOriginalStartsAt')::timestamptz,(v_selected.values->>'startsAt')::timestamptz)<>p_expected_original_starts_at then raise exception 'Immutable recurrence identity changed'; end if;
  if p_scope='selected_and_future' and coalesce(p_expected_series_id,'')='' then raise exception 'Future scope requires an immutable series'; end if;
  perform pg_advisory_xact_lock(hashtextextended('parent-cancel-series:'||v_account::text||':'||coalesce(p_expected_series_id,p_selected_booking_id::text),0));
  perform 1 from public.project_rows r where r.project_table_id=v_bookings and r.values->>'studentAccountId'=v_account::text and (r.id=p_selected_booking_id or (p_scope='selected_and_future' and r.values->>'seriesId'=p_expected_series_id and coalesce((r.values->>'recurrenceOriginalStartsAt')::timestamptz,(r.values->>'startsAt')::timestamptz)>=p_expected_original_starts_at)) order by r.id for update;
  select coalesce(array_agg(r.id order by coalesce((r.values->>'recurrenceOriginalStartsAt')::timestamptz,(r.values->>'startsAt')::timestamptz),r.id),'{}'),count(*) into v_ids,v_count
  from public.project_rows r where r.project_table_id=v_bookings and r.values->>'studentAccountId'=v_account::text
    and (r.id=p_selected_booking_id or (p_scope='selected_and_future' and r.values->>'seriesId'=p_expected_series_id and coalesce((r.values->>'recurrenceOriginalStartsAt')::timestamptz,(r.values->>'startsAt')::timestamptz)>=p_expected_original_starts_at))
    and coalesce(r.values->>'status','') in ('requested','club_confirmed') and (r.values->>'startsAt')::timestamptz>v_now+interval '12 hours'
    and coalesce(r.values->>'groupClassId','')='' and r.values->>'program' not in ('Group class','Unavailable');
  if not(p_selected_booking_id=any(v_ids)) or v_count<>p_expected_eligible_count then raise exception 'Eligible cancellation set changed'; end if;
  perform set_config('rswtta.cancellation_actor','parent',true);
  update public.project_rows set values=values||jsonb_build_object('status','cancelled','cancelledAt',v_now,'cancellationSource',case when p_scope='selected' then 'parent_selected' else 'parent_future' end) where id=any(v_ids);
  v_result:=rswtta_private.parent_dashboard(v_principal)||jsonb_build_object('selectedBookingId',p_selected_booking_id,'scope',p_scope,'cancelledCount',v_count,'cancelledBookingIds',to_jsonb(v_ids));
  insert into public.project_rows(project_table_id,values) values(v_activity,jsonb_build_object('action','parent_bookings_cancelled','message',format('Parent cancelled %s eligible persisted booking(s).',v_count),'count',v_count,'selectedBookingId',p_selected_booking_id,'scope',p_scope,'seriesId',p_expected_series_id,'boundaryOriginalStartsAt',p_expected_original_starts_at,'cancelledBookingIds',to_jsonb(v_ids),'serverTime',v_now));
  insert into rswtta_private.idempotency_results(principal_id,operation,idempotency_key,request_hash,result) values(v_principal,'cancel_booking_occurrences',p_idempotency_key,v_request_hash,v_result);
  return v_result;
exception when no_data_found then raise exception 'Invalid session or booking'; when invalid_text_representation or datetime_field_overflow then raise exception 'Invalid booking identity'; end $$;


-- No browser grants are added here. Activation is an explicit separate migration.
revoke all on all functions in schema rswtta_private from public,anon,authenticated;
do $revoke_parent_stage$
declare r regprocedure;
begin
  for r in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,7)='parent_'
  loop execute format('revoke all on function %s from public,anon,authenticated',r); end loop;
end $revoke_parent_stage$;

-- Verify backup identity and complete private credential/binding migration without changing legacy credentials.
do $verify$
declare v_accounts uuid; v_live bigint; v_backup bigint; v_live_ids text; v_backup_ids text;
begin
  select t.id into strict v_accounts from public.project_tables t join public.projects p on p.id=t.project_id where p.slug='rswtta-booking' and t.slug='parent_accounts';
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,',' order by id),''),'sha256'),'hex') into v_live,v_live_ids from public.project_rows where project_table_id=v_accounts;
  select count(*),encode(extensions.digest(coalesce(string_agg(id::text,',' order by id),''),'sha256'),'hex') into v_backup,v_backup_ids from rswtta_private.backup_parent_accounts_20260912211500;
  if v_live<>v_backup or v_live_ids<>v_backup_ids then raise exception 'Private backup verification failed'; end if;
  if exists(select 1 from public.project_rows where project_table_id=v_accounts and (coalesce(values->>'passwordHash','')='' or coalesce(values->>'passwordSalt','')='')) then raise exception 'Shadow stage changed legacy credentials'; end if;
  if (select count(*) from rswtta_private.credentials)<>v_live or (select count(*) from rswtta_private.household_accounts)<>v_live then raise exception 'Private credential/binding count mismatch'; end if;
end $verify$;
commit;
