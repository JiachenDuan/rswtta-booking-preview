const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xtewfpzsyjeaqgkdttij.supabase.co',
  'sb_publishable_c9Bvz2ebh2Jcejk_7sIQWQ_avpFiSFb'
);

const projectSlug = 'rswtta-booking';

function normalizeCoachName(coach = '') {
  if (coach === 'Coach A' || coach === 'National Level Coach A') return 'National A';
  if (coach === 'Coach B' || coach === 'National Coach B') return 'National B';
  return coach;
}

function bookingNaturalKey(values = {}) {
  return [
    String(values.studentName ?? '').trim().toLowerCase(),
    normalizeCoachName(values.assignedCoach ?? values.requestedCoach ?? '').trim().toLowerCase(),
    String(values.startsAt ?? '').trim()
  ].join('|');
}

function isImported(values = {}) {
  const note = String(values.parentNote ?? '');
  return note.includes('Imported Coach Tian Ye recurring class from Excel') || note.includes('Imported Coach Wang recurring class from Excel as Coach Jorden');
}

async function getBookingTableId() {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('slug', projectSlug)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) throw new Error(`Project not found: ${projectSlug}`);

  const { data: table, error: tableError } = await supabase
    .from('project_tables')
    .select('id')
    .eq('project_id', project.id)
    .eq('slug', 'bookings')
    .maybeSingle();
  if (tableError) throw tableError;
  if (!table) throw new Error('Bookings table not found');
  return table.id;
}

async function main() {
  const tableId = await getBookingTableId();
  const seen = new Set();
  const duplicateSamples = [];
  let total = 0;
  let imported = 0;
  let duplicateNaturalKeys = 0;

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('project_rows')
      .select('id,values')
      .eq('project_table_id', tableId)
      .range(from, from + 999);
    if (error) throw error;

    for (const row of data ?? []) {
      total += 1;
      if (isImported(row.values)) imported += 1;
      const key = bookingNaturalKey(row.values);
      if (seen.has(key)) {
        duplicateNaturalKeys += 1;
        if (duplicateSamples.length < 10) duplicateSamples.push({ id: row.id, key });
      } else {
        seen.add(key);
      }
    }

    if (!data || data.length < 1000) break;
  }

  console.log(JSON.stringify({
    tableId,
    total,
    imported,
    uniqueNaturalKeys: seen.size,
    duplicateNaturalKeys,
    duplicateSamples
  }, null, 2));

  if (duplicateNaturalKeys > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
