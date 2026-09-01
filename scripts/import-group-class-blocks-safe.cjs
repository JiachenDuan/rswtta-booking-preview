const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xtewfpzsyjeaqgkdttij.supabase.co',
  'sb_publishable_c9Bvz2ebh2Jcejk_7sIQWQ_avpFiSFb'
);

const DRY_RUN = process.argv.includes('--dry-run');
const projectSlug = 'rswtta-booking';
const sourcePath = 'analysis/recurring-classes-groups-left-out.csv';
const startDate = new Date(2026, 8, 1, 0, 0, 0, 0);
const endDate = new Date(2026, 11, 31, 23, 59, 59, 999);
const dayIndexes = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const coachMap = { Debolina: 'National A', Diren: 'National B', Wong: 'Coach Jorden', Wang: 'Coach Jorden' };

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.filter((r) => r.some((c) => String(c).trim()));
}
function csvRecords(path) {
  const rows = parseCsv(fs.readFileSync(path, 'utf8'));
  const headers = rows.shift();
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}
function parseClock(label) {
  const cleaned = String(label).trim().toUpperCase().replace(/\s+/g, ' ');
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) throw new Error(`Could not parse time: ${label}`);
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3];
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}
function parseTimeRange(range) {
  const [startLabel, endLabel] = String(range).split('-').map((part) => part.trim());
  if (!startLabel || !endLabel) throw new Error(`Could not parse range: ${range}`);
  const end = parseClock(endLabel);
  let start = parseClock(startLabel);
  if (!/[AP]M/i.test(startLabel) && /[AP]M/i.test(endLabel)) {
    const inferred = parseClock(`${startLabel} ${endLabel.match(/[AP]M/i)[0]}`);
    start = inferred.hour > end.hour ? parseClock(`${startLabel} AM`) : inferred;
    if (end.hour >= 12 && inferred.hour < 12) start = parseClock(`${startLabel} PM`);
  }
  return { start, end };
}
function formatTime(date) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date).replace(':00', '');
}
function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function nextDateForDay(start, dayIndex) {
  const date = new Date(start); date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + ((dayIndex - date.getDay() + 7) % 7));
  return date;
}
function normalizeCoach(coach = '') {
  const value = String(coach).trim();
  if (['Debolina', 'Coach Debolina', 'National A', 'Coach A'].includes(value)) return 'National A';
  if (['Diren', 'Coach Diren', 'National B', 'Coach B'].includes(value)) return 'National B';
  if (['Wang', 'Wong', 'Coach Wang', 'Coach Wong', 'Coach Jorden'].includes(value)) return 'Coach Jorden';
  if (['Tian Ye', 'Coach Tian Ye'].includes(value)) return 'Coach Tian Ye';
  return value;
}
function naturalKey(values = {}) {
  return [
    String(values.studentName ?? '').trim().toLowerCase(),
    normalizeCoach(values.assignedCoach ?? values.requestedCoach ?? '').toLowerCase(),
    String(values.startsAt ?? '').trim()
  ].join('|');
}
async function tableIds() {
  const { data: project, error: pe } = await supabase.from('projects').select('id').eq('slug', projectSlug).maybeSingle();
  if (pe) throw pe;
  if (!project) throw new Error(`Project not found: ${projectSlug}`);
  const { data: tables, error: te } = await supabase.from('project_tables').select('id,slug').eq('project_id', project.id);
  if (te) throw te;
  const ids = Object.fromEntries((tables ?? []).map((table) => [table.slug, table.id]));
  if (!ids.bookings) throw new Error('Missing bookings table');
  return ids;
}
async function fetchRows(tableId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('project_rows').select('id,values').eq('project_table_id', tableId).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
function sourceSlots() {
  return csvRecords(sourcePath).map((row) => ({ ...row, mappedCoach: coachMap[row.coach] ?? row.coach }));
}
function buildBookings() {
  const bookings = [];
  for (const slot of sourceSlots()) {
    const dayIndex = dayIndexes[slot.day];
    if (dayIndex == null) throw new Error(`Unknown day: ${slot.day}`);
    const { start, end } = parseTimeRange(slot.time);
    for (let date = nextDateForDay(startDate, dayIndex); date <= endDate; date.setDate(date.getDate() + 7)) {
      const starts = new Date(date); starts.setHours(start.hour, start.minute, 0, 0);
      if (starts < startDate || starts > endDate) continue;
      const ends = new Date(date); ends.setHours(end.hour, end.minute, 0, 0);
      if (ends <= starts) ends.setTime(starts.getTime() + 60 * 60 * 1000);
      bookings.push({
        id: '',
        studentName: 'Group class',
        familyName: 'Group class',
        studentEmail: '',
        phone: '',
        requestedCoach: slot.mappedCoach,
        assignedCoach: slot.mappedCoach,
        program: 'Group class',
        dateLabel: formatDate(starts),
        timeLabel: `${formatTime(starts)} - ${formatTime(ends)}`,
        startsAt: starts.toISOString(),
        priceCents: 0,
        status: 'club_confirmed',
        parentNote: `Recurring group class block from Google Sheet (${slot.source}: ${slot.raw_cell}) through Dec 31, 2026.`,
        createdAt: '',
        updatedAt: ''
      });
    }
  }
  const unique = new Map(), duplicateSourceKeys = [];
  for (const booking of bookings) {
    const key = naturalKey(booking);
    if (unique.has(key)) duplicateSourceKeys.push(key);
    else unique.set(key, booking);
  }
  return { bookings: [...unique.values()], duplicateSourceKeys };
}
async function main() {
  const ids = await tableIds();
  const bookingRows = await fetchRows(ids.bookings);
  const { bookings, duplicateSourceKeys } = buildBookings();
  const activeKeys = new Set(bookingRows.filter((row) => row.values?.status !== 'cancelled').map((row) => naturalKey(row.values)));
  const toInsert = bookings.filter((booking) => !activeKeys.has(naturalKey(booking)));
  const byCoach = {};
  for (const booking of bookings) byCoach[booking.assignedCoach] = (byCoach[booking.assignedCoach] ?? 0) + 1;
  const preview = {
    dryRun: DRY_RUN,
    sourceGroupBlocks: sourceSlots().length,
    generatedUniqueGroupRows: bookings.length,
    duplicateSourceKeys: duplicateSourceKeys.length,
    existingBookingRows: bookingRows.length,
    skippedExistingGroupRows: bookings.length - toInsert.length,
    groupRowsToInsert: toInsert.length,
    generatedRowsByCoach: byCoach
  };
  console.error(JSON.stringify({ phase: 'preview', ...preview }, null, 2));
  if (DRY_RUN) return console.log(JSON.stringify(preview, null, 2));
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const batch = toInsert.slice(i, i + 100).map((values) => ({ project_table_id: ids.bookings, values }));
    const { error } = await supabase.from('project_rows').insert(batch);
    if (error) throw error;
    inserted += batch.length;
    console.error(JSON.stringify({ phase: 'group-blocks-inserted', inserted, total: toInsert.length }));
  }
  const afterRows = await fetchRows(ids.bookings);
  const seen = new Set(), dupes = [];
  for (const row of afterRows) {
    if (row.values?.status === 'cancelled') continue;
    const key = naturalKey(row.values);
    if (seen.has(key)) dupes.push({ id: row.id, key }); else seen.add(key);
  }
  const groupByCoach = {};
  for (const row of afterRows) {
    const values = row.values ?? {};
    if (values.status === 'cancelled') continue;
    if (values.program !== 'Group class' || String(values.studentName ?? '').trim().toLowerCase() !== 'group class') continue;
    const coach = normalizeCoach(values.assignedCoach ?? values.requestedCoach ?? '');
    groupByCoach[coach] = (groupByCoach[coach] ?? 0) + 1;
  }
  console.log(JSON.stringify({ groupBlocksInserted: inserted, totalBookingRowsAfter: afterRows.length, activeDuplicateCountAfter: dupes.length, activeGroupBlocksByCoach: groupByCoach, activeDuplicateSamples: dupes.slice(0, 10) }, null, 2));
  if (dupes.length > 0) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ phase: 'error', message: error.message, code: error.code, details: error.details, hint: error.hint }, null, 2)); process.exit(1); });
