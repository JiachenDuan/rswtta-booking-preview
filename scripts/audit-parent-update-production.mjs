import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("usage: node scripts/audit-parent-update-production.mjs OUTPUT.json");
const url = "https://xtewfpzsyjeaqgkdttij.supabase.co";
const key = "sb_publishable_c9Bvz2ebh2Jcejk_7sIQWQ_avpFiSFb";
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};
const canonical = (value) => JSON.stringify(stable(value));

async function exhaustRows(tableId, slug) {
  const pageSize = 500;
  const rows = [];
  const pages = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from("project_rows").select("id,project_table_id,values,created_at,updated_at").eq("project_table_id", tableId).order("id").range(from, from + pageSize - 1);
    if (error) throw new Error(`${slug} page ${from}: ${error.message}`);
    pages.push({ from, to: from + pageSize - 1, returned: data.length });
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  const ids = rows.map((row) => row.id);
  return {
    rows,
    evidence: {
      tableId,
      rowCount: rows.length,
      uniqueIdCount: new Set(ids).size,
      pageCount: pages.length,
      pages,
      orderedIdSha256: sha256(ids.join("\n")),
      canonicalRowSha256: sha256(rows.map(canonical).join("\n")),
      rowIds: ids
    }
  };
}

const { data: project, error: projectError } = await client.from("projects").select("id,slug,created_at").eq("slug", "rswtta-booking").single();
if (projectError) throw projectError;
const { data: tableRows, error: tableError } = await client.from("project_tables").select("id,slug,created_at").eq("project_id", project.id).order("slug");
if (tableError) throw tableError;
const tableMap = Object.fromEntries(tableRows.map((row) => [row.slug, row.id]));
const wanted = ["bookings", "parent_accounts", "activity_logs", "bill_notifications"];
const fetched = {};
for (const slug of wanted) fetched[slug] = await exhaustRows(tableMap[slug], slug);
const bookings = fetched.bookings.rows;
const accounts = fetched.parent_accounts.rows;
const activity = fetched.activity_logs.rows;
const clockResponse = await fetch(`${url}/rest/v1/projects?select=id&slug=eq.rswtta-booking&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
if (!clockResponse.ok) throw new Error(`clock request failed: ${clockResponse.status}`);
const serverNow = new Date(clockResponse.headers.get("date") ?? Date.now()).toISOString();
const cutoff = new Date(Date.parse(serverNow) + 12 * 60 * 60 * 1000);
const countBy = (rows, fn) => Object.fromEntries([...rows.reduce((map, row) => map.set(fn(row), (map.get(fn(row)) ?? 0) + 1), new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
const isEnrollment = (v) => v.program === "Group enrollment" || (v.program === "Group lesson" && (String(v.parentNote ?? "").includes("Parent requested to join group class") || String(v.parentNote ?? "").includes("Added to group class by club")));
const candidateIds = bookings.filter(({ values: v }) =>
  Boolean(v.studentAccountId) && !String(v.id ?? "").startsWith("virtual-") && !v.groupClassId && !isEnrollment(v) && ["Private lesson", "Group lesson"].includes(v.program) && ["requested", "change_requested", "club_confirmed"].includes(v.status) && Date.parse(v.startsAt) > cutoff.getTime()
).map((row) => row.id).sort();
const recurrence = bookings.map((row) => row.values);
const aliasNorm = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const identifiers = new Map();
for (const row of accounts) {
  const v = row.values;
  for (const [kind, raw] of [["loginAlias", v.loginAlias], ["email", v.email], ["studentName", v.studentName], ["firstName", String(v.studentName ?? "").split(/\s+/u)[0]]]) {
    const normalized = aliasNorm(raw);
    if (!normalized) continue;
    const key = `${kind}:${normalized}`;
    const current = identifiers.get(key) ?? [];
    current.push(row.id);
    identifiers.set(key, current);
  }
}
const credentialFamilies = new Map();
for (const row of accounts) {
  const v = row.values;
  const family = `${v.passwordSalt ? "salt-present" : "salt-missing"}|${v.passwordHash ? "hash-present" : "hash-missing"}|${String(v.passwordSalt ?? "").length}|${String(v.passwordHash ?? "").length}`;
  credentialFamilies.set(family, (credentialFamilies.get(family) ?? 0) + 1);
}
const artifact = {
  auditKind: "parent-update-class-time-production-readonly-refresh",
  generatedAt: new Date().toISOString(),
  productionServerNow: serverNow,
  strictCutoff: cutoff.toISOString(),
  scope: { projectId: project.id, projectSlug: project.slug, projectTables: tableRows },
  tables: Object.fromEntries(wanted.map((slug) => [slug, fetched[slug].evidence])),
  bookingSummary: {
    statuses: countBy(bookings, (row) => String(row.values.status ?? "")),
    programs: countBy(bookings, (row) => String(row.values.program ?? "")),
    accountLinked: bookings.filter((row) => Boolean(row.values.studentAccountId)).length,
    unlinked: bookings.filter((row) => !row.values.studentAccountId).length,
    orphanAccountIds: bookings.filter((row) => row.values.studentAccountId && !accounts.some((account) => account.id === row.values.studentAccountId)).length,
    recurring: recurrence.filter((v) => Boolean(v.seriesId)).length,
    completeRecurrenceIdentity: recurrence.filter((v) => v.seriesId && v.recurrenceOccurrenceId && v.recurrenceOriginalStartsAt).length,
    incompleteRecurrenceIdentity: recurrence.filter((v) => Boolean(v.seriesId || v.recurrenceOccurrenceId || v.recurrenceOriginalStartsAt) && !(v.seriesId && v.recurrenceOccurrenceId && v.recurrenceOriginalStartsAt)).length,
    duplicateOccurrenceIds: recurrence.filter((v) => v.recurrenceOccurrenceId).length - new Set(recurrence.map((v) => v.recurrenceOccurrenceId).filter(Boolean)).size,
    eligibleSelectedOccurrenceCount: candidateIds.length,
    eligibleSelectedOccurrenceIds: candidateIds
  },
  accountSummary: {
    confirmed: countBy(accounts, (row) => String(Boolean(row.values.confirmed))),
    profileSetupRequired: countBy(accounts, (row) => String(Boolean(row.values.profileSetupRequired))),
    clubPreregistered: countBy(accounts, (row) => String(Boolean(row.values.clubPreregistered))),
    credentialShapeFamilies: Object.fromEntries([...credentialFamilies.entries()].sort()),
    normalizedIdentifierCollisionPartitions: Object.fromEntries([...identifiers.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([key, ids]) => [key.split(":", 1)[0], ids.length]).reduce((map, [kind, count]) => map.set(kind, (map.get(kind) ?? 0) + count), new Map())),
    aliasesPresent: accounts.filter((row) => Boolean(row.values.loginAlias)).length,
    credentialVersionsPresent: accounts.filter((row) => row.values.credentialVersion != null).length
  },
  activitySummary: { actions: countBy(activity, (row) => String(row.values.action ?? "")) },
  safety: { httpMethods: ["GET"], productionRowMutations: 0, deployments: 0 },
  redaction: "No row values, names, aliases, emails, phones, credentials, notes, or tokens are persisted; only IDs, counts, partitions, and hashes."
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ outputPath, sha256: sha256(fs.readFileSync(outputPath)), serverNow, counts: Object.fromEntries(wanted.map((slug) => [slug, fetched[slug].rows.length])), pages: Object.fromEntries(wanted.map((slug) => [slug, fetched[slug].evidence.pages.map((page) => page.returned)])), candidateCount: candidateIds.length }));
