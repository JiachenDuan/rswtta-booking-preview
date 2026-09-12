-- Production class-package ledger for the explicitly accepted legacy Club session risk.
-- The caller is NOT authenticated as Club staff. Every inserted row records that truth as
-- actor_kind = 'legacy_club_session_unverified'. Replace the anon grants after real Club auth ships.

begin;

select pg_advisory_xact_lock(hashtextextended('rswtta:class-package-ledger:migration', 0));

do $$
declare
  v_project_id uuid;
  v_accounts_table_id uuid;
  v_account_count integer;
  v_setup_required_count integer;
  v_profile_complete_count integer;
  v_identity_sha256 text;
begin
  select id into strict v_project_id
  from public.projects
  where slug = 'rswtta-booking';

  if v_project_id <> 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid then
    raise exception 'Class-package migration guard failed: project ID changed';
  end if;

  select id into strict v_accounts_table_id
  from public.project_tables
  where project_id = v_project_id and slug = 'parent_accounts';

  if v_accounts_table_id <> '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid then
    raise exception 'Class-package migration guard failed: parent_accounts table ID changed';
  end if;

  select count(*),
         count(*) filter (where coalesce((values->>'profileSetupRequired')::boolean, false)),
         count(*) filter (where not coalesce((values->>'profileSetupRequired')::boolean, false)),
         encode(digest(coalesce(string_agg(id::text, ',' order by id), ''), 'sha256'), 'hex')
    into v_account_count, v_setup_required_count, v_profile_complete_count, v_identity_sha256
  from public.project_rows
  where project_table_id = v_accounts_table_id;

  if v_account_count <> 73 then
    raise exception 'Class-package migration guard failed: expected 73 accounts, found %', v_account_count;
  end if;
  if v_setup_required_count <> 47 or v_profile_complete_count <> 26 then
    raise exception 'Class-package migration guard failed: expected setup/profile counts 47/26, found %/%', v_setup_required_count, v_profile_complete_count;
  end if;
  if v_identity_sha256 <> '637b4155619fc30b668faacb14550ca2ff0d58698fbb3678d424654ef6f725c1' then
    raise exception 'Class-package migration guard failed: account identity hash changed';
  end if;
end;
$$;

create table if not exists public.class_package_hours_ledger (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  student_account_id uuid not null references public.project_rows(id) on delete restrict,
  delta_minutes integer not null,
  old_balance_minutes bigint not null,
  new_balance_minutes bigint not null,
  operation_type text not null,
  actor_kind text not null,
  note text not null default '',
  reference text not null default '',
  idempotency_key uuid not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint class_package_hours_positive_delta check (delta_minutes between 30 and 30000 and delta_minutes % 30 = 0),
  constraint class_package_hours_balance_math check (new_balance_minutes = old_balance_minutes + delta_minutes),
  constraint class_package_hours_add_only check (operation_type = 'package_purchase'),
  constraint class_package_hours_honest_actor check (actor_kind = 'legacy_club_session_unverified'),
  constraint class_package_hours_note_length check (char_length(note) <= 500),
  constraint class_package_hours_reference_length check (char_length(reference) <= 120),
  constraint class_package_hours_idempotency unique (project_id, idempotency_key)
);

comment on table public.class_package_hours_ledger is
  'Append-only prepaid package credits. Legacy Club callers are explicitly unauthenticated; no deductions, refunds, or balance sets.';

create index if not exists class_package_hours_account_created_idx
  on public.class_package_hours_ledger (project_id, student_account_id, created_at desc);

alter table public.class_package_hours_ledger enable row level security;
revoke all on public.class_package_hours_ledger from public, anon, authenticated;

drop policy if exists class_package_hours_ledger_read on public.class_package_hours_ledger;
drop policy if exists class_package_hours_ledger_insert on public.class_package_hours_ledger;
drop policy if exists class_package_hours_ledger_update on public.class_package_hours_ledger;
drop policy if exists class_package_hours_ledger_delete on public.class_package_hours_ledger;

create or replace function public.reject_class_package_ledger_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Class-package ledger rows are immutable';
end;
$$;

drop trigger if exists class_package_hours_ledger_immutable on public.class_package_hours_ledger;
create trigger class_package_hours_ledger_immutable
before update or delete on public.class_package_hours_ledger
for each row execute function public.reject_class_package_ledger_mutation();
revoke all on function public.reject_class_package_ledger_mutation() from public, anon, authenticated;

create or replace function public.list_class_package_balances()
returns table (
  student_account_id uuid,
  balance_minutes bigint,
  last_package_update timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select account.id,
         coalesce(sum(ledger.delta_minutes), 0)::bigint,
         max(ledger.created_at)
  from public.project_rows account
  left join public.class_package_hours_ledger ledger
    on ledger.project_id = 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid
   and ledger.student_account_id = account.id
  where account.project_table_id = '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid
  group by account.id
  order by account.id
$$;

create or replace function public.add_class_package_hours(
  p_student_account_id uuid,
  p_delta_minutes integer,
  p_note text,
  p_reference text,
  p_idempotency_key uuid
) returns table (
  ledger_entry_id uuid,
  student_account_id uuid,
  added_minutes integer,
  old_balance_minutes bigint,
  new_balance_minutes bigint,
  created_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id constant uuid := 'ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid;
  v_accounts_table_id constant uuid := '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  v_existing public.class_package_hours_ledger;
  v_entry public.class_package_hours_ledger;
  v_old_balance bigint;
begin
  if p_student_account_id is null then raise exception 'student account ID is required'; end if;
  if p_delta_minutes is null or p_delta_minutes < 30 or p_delta_minutes > 30000 or p_delta_minutes % 30 <> 0 then
    raise exception 'hours must be positive 30-minute increments up to 500 hours';
  end if;
  if p_idempotency_key is null then raise exception 'idempotency key is required'; end if;
  if char_length(coalesce(p_note, '')) > 500 or char_length(coalesce(p_reference, '')) > 120 then
    raise exception 'note/reference too long';
  end if;
  if not exists (
    select 1 from public.project_rows r
    where r.id = p_student_account_id and r.project_table_id = v_accounts_table_id
  ) then
    raise exception 'student account does not belong to rswtta-booking';
  end if;

  -- Serialize both duplicate replays and balance calculation for this account.
  perform pg_advisory_xact_lock(hashtextextended('rswtta:package:idempotency:' || p_idempotency_key::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('rswtta:package:account:' || p_student_account_id::text, 0));

  select * into v_existing
  from public.class_package_hours_ledger
  where project_id = v_project_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.student_account_id <> p_student_account_id
       or v_existing.delta_minutes <> p_delta_minutes
       or v_existing.note <> coalesce(p_note, '')
       or v_existing.reference <> coalesce(p_reference, '') then
      raise exception 'idempotency key was already used with different input';
    end if;
    return query select v_existing.id, v_existing.student_account_id, v_existing.delta_minutes,
      v_existing.old_balance_minutes, v_existing.new_balance_minutes, v_existing.created_at, true;
    return;
  end if;

  select coalesce(sum(ledger.delta_minutes), 0)::bigint into v_old_balance
  from public.class_package_hours_ledger ledger
  where ledger.project_id = v_project_id and ledger.student_account_id = p_student_account_id;

  insert into public.class_package_hours_ledger
    (project_id, student_account_id, delta_minutes, old_balance_minutes, new_balance_minutes,
     operation_type, actor_kind, note, reference, idempotency_key)
  values
    (v_project_id, p_student_account_id, p_delta_minutes, v_old_balance, v_old_balance + p_delta_minutes,
     'package_purchase', 'legacy_club_session_unverified', coalesce(p_note, ''), coalesce(p_reference, ''), p_idempotency_key)
  returning * into v_entry;

  return query select v_entry.id, v_entry.student_account_id, v_entry.delta_minutes,
    v_entry.old_balance_minutes, v_entry.new_balance_minutes, v_entry.created_at, false;
end;
$$;

revoke all on function public.list_class_package_balances() from public;
revoke all on function public.add_class_package_hours(uuid, integer, text, text, uuid) from public;
grant execute on function public.list_class_package_balances() to anon, authenticated;
grant execute on function public.add_class_package_hours(uuid, integer, text, text, uuid) to anon, authenticated;

commit;
