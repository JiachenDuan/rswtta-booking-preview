-- LOCAL-ONLY PROPOSAL — DO NOT APPLY until the publication security gate is satisfied.
-- Gate: replace the bypassable Club login with Supabase Auth identities carrying an
-- authenticated, server-controlled `club_staff` authorization claim (or membership row),
-- then validate the RLS predicates below against that identity in staging.

begin;

create table if not exists public.class_package_hours_ledger (
  id uuid primary key default gen_random_uuid(),
  student_account_id uuid not null references public.project_rows(id) on delete restrict,
  delta_minutes integer not null check (delta_minutes <> 0),
  operation_type text not null check (operation_type in ('package_purchase', 'correction')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_type text not null default 'club_user' check (actor_type in ('club_user', 'system')),
  note text not null default '' check (char_length(note) <= 500),
  reference text not null default '' check (char_length(reference) <= 120),
  idempotency_key uuid not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint class_package_hours_ledger_actor_idempotency unique (actor_id, idempotency_key)
);

comment on table public.class_package_hours_ledger is
  'Immutable class-package minute deltas. Correct errors with compensating rows; never update/delete.';

create index if not exists class_package_hours_ledger_account_created_idx
  on public.class_package_hours_ledger (student_account_id, created_at desc);

alter table public.class_package_hours_ledger enable row level security;
revoke all on public.class_package_hours_ledger from anon, authenticated;
grant select on public.class_package_hours_ledger to authenticated;

-- Replace this claim check with the project’s reviewed server-controlled role mechanism.
create policy class_package_hours_ledger_club_read
  on public.class_package_hours_ledger for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'club_staff');

create or replace function public.add_class_package_hours(
  p_student_account_id uuid,
  p_delta_minutes integer,
  p_operation_type text,
  p_note text,
  p_reference text,
  p_idempotency_key uuid
) returns public.class_package_hours_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.class_package_hours_ledger;
  v_created public.class_package_hours_ledger;
begin
  if v_actor_id is null or (auth.jwt() -> 'app_metadata' ->> 'role') <> 'club_staff' then
    raise exception 'club_staff authorization required' using errcode = '42501';
  end if;
  if p_delta_minutes is null or p_delta_minutes = 0 then
    raise exception 'delta_minutes must be a nonzero integer';
  end if;
  if p_operation_type not in ('package_purchase', 'correction') then
    raise exception 'unsupported operation_type';
  end if;
  if p_operation_type = 'package_purchase' and (p_delta_minutes < 30 or p_delta_minutes > 30000 or p_delta_minutes % 30 <> 0) then
    raise exception 'package purchases must be 30..30000 minutes in 30-minute increments';
  end if;
  if char_length(coalesce(p_note, '')) > 500 or char_length(coalesce(p_reference, '')) > 120 then
    raise exception 'note/reference too long';
  end if;
  if not exists (
    select 1 from public.project_rows r
    join public.project_tables t on t.id = r.project_table_id
    join public.projects p on p.id = t.project_id
    where r.id = p_student_account_id
      and t.slug = 'parent_accounts'
      and p.slug = 'rswtta-booking'
  ) then
    raise exception 'student account does not belong to this project';
  end if;

  select * into v_existing from public.class_package_hours_ledger
   where actor_id = v_actor_id and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  insert into public.class_package_hours_ledger
    (student_account_id, delta_minutes, operation_type, actor_id, actor_type, note, reference, idempotency_key)
  values
    (p_student_account_id, p_delta_minutes, p_operation_type, v_actor_id, 'club_user', coalesce(p_note, ''), coalesce(p_reference, ''), p_idempotency_key)
  returning * into v_created;
  return v_created;
exception when unique_violation then
  select * into v_existing from public.class_package_hours_ledger
   where actor_id = v_actor_id and idempotency_key = p_idempotency_key;
  return v_existing;
end;
$$;

revoke all on function public.add_class_package_hours(uuid, integer, text, text, text, uuid) from public, anon;
grant execute on function public.add_class_package_hours(uuid, integer, text, text, text, uuid) to authenticated;

-- Ledger immutability: no UPDATE/DELETE grants or policies. This trigger also guards
-- privileged accidental mutation; corrections must be compensating INSERT entries.
create or replace function public.reject_class_package_ledger_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'class package ledger entries are immutable; insert a compensating correction';
end;
$$;

create trigger class_package_hours_ledger_immutable
before update or delete on public.class_package_hours_ledger
for each row execute function public.reject_class_package_ledger_mutation();

-- Derived balance: coalesce(sum(delta_minutes), 0); never persist a mutable balance.
create or replace view public.class_package_hour_balances with (security_invoker = true) as
select a.id as student_account_id,
       coalesce(sum(l.delta_minutes), 0)::bigint as balance_minutes,
       max(l.created_at) as last_package_update
from public.project_rows a
join public.project_tables t on t.id = a.project_table_id and t.slug = 'parent_accounts'
join public.projects p on p.id = t.project_id and p.slug = 'rswtta-booking'
left join public.class_package_hours_ledger l on l.student_account_id = a.id
group by a.id;

commit;
