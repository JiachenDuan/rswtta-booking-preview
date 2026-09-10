-- Prevent duplicate active bookings for the RSWTTA bookings table.
-- Natural key: stable studentAccountId + normalized coach + startsAt.
-- Allows cancelled rows to coexist so history/cancelled classes don't block a future rebook.
-- System calendar rows without a student account are excluded.

create unique index if not exists project_rows_rswtta_bookings_unique_active
on public.project_rows (
  project_table_id,
  btrim(values->>'studentAccountId'),
  lower(btrim(coalesce(nullif(values->>'assignedCoach', ''), values->>'requestedCoach', ''))),
  btrim(values->>'startsAt')
)
where
  project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'
  and coalesce(values->>'status', '') <> 'cancelled'
  and coalesce(btrim(values->>'studentAccountId'), '') <> '';

-- Verify current duplicate count. Should return 0 rows.
select
  btrim(values->>'studentAccountId') as student_account_id,
  lower(btrim(coalesce(nullif(values->>'assignedCoach', ''), values->>'requestedCoach', ''))) as coach,
  btrim(values->>'startsAt') as starts_at,
  count(*) as row_count
from public.project_rows
where
  project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'
  and coalesce(values->>'status', '') <> 'cancelled'
  and coalesce(btrim(values->>'studentAccountId'), '') <> ''
group by 1, 2, 3
having count(*) > 1
order by row_count desc;
