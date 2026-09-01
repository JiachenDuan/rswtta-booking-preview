-- Prevent duplicate active bookings for the RSWTTA bookings table.
-- Natural key: studentName + normalized coach + startsAt.
-- Allows cancelled rows to coexist so history/cancelled classes don't block a future rebook.

create unique index if not exists project_rows_rswtta_bookings_unique_active
on public.project_rows (
  project_table_id,
  lower(btrim(values->>'studentName')),
  lower(btrim(coalesce(nullif(values->>'assignedCoach', ''), values->>'requestedCoach', ''))),
  btrim(values->>'startsAt')
)
where
  project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'
  and coalesce(values->>'status', '') <> 'cancelled';

-- Verify current duplicate count. Should return 0 rows.
select
  lower(btrim(values->>'studentName')) as student_name,
  lower(btrim(coalesce(nullif(values->>'assignedCoach', ''), values->>'requestedCoach', ''))) as coach,
  btrim(values->>'startsAt') as starts_at,
  count(*) as row_count
from public.project_rows
where
  project_table_id = 'a7a8a308-2305-4ab6-ad20-5ce174558035'
  and coalesce(values->>'status', '') <> 'cancelled'
group by 1, 2, 3
having count(*) > 1
order by row_count desc;
