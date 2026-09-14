import crypto from "node:crypto";
import fs from "node:fs";
import { chromium } from "playwright";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("usage: node scripts/run-club-concurrency-acceptance.mjs OUTPUT");
const source = fs.readFileSync(new URL("../components/ClubApp.tsx", import.meta.url), "utf8");
const match = source.match(/^const clubPassword = (["'])(.+)\1;$/mu);
if (!match) throw new Error("Unable to obtain existing Club proof without logging it");
const proof = match[2];
const q = (value) => `'${value.replaceAll("'", "''")}'`;
const requestKey = "00000000-0000-4000-8000-000000001930";
const sql = `begin;
with s as materialized (
 select public.club_search_students('rswtta',${q(proof)},'rollback-concurrency-client','rollback concurrency unique') value
), p as materialized (
 select public.club_preview_student_preregistration_v2('rswtta',${q(proof)},'rollback-concurrency-client','${requestKey}'::uuid,jsonb_build_object('studentName','ROLLBACK CONCURRENCY UNIQUE','email','','phone','','loginAlias','rollback-concurrency-unique')) value
), c as materialized (
 select public.club_preregister_student_v3('rswtta',${q(proof)},'rollback-concurrency-client','${requestKey}'::uuid,s.value->>'normalizedQuery',s.value->>'snapshotHash',p.value->'normalized',p.value->>'snapshotHash',false) value from s,p
), delay as materialized (select pg_sleep(2) from c)
select jsonb_build_object('accountId',c.value->>'accountId','replayed',(c.value->>'replayed')::boolean) concurrency_result from c,delay;
rollback;`;
if (/__[A-Z][A-Z0-9_]{2,}__/u.test(sql)) throw new Error("Unresolved placeholder in concurrency SQL");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const browser = await chromium.connectOverCDP("http://127.0.0.1:18805");
const context = browser.contexts()[0];
let page = context.pages().find((candidate) => candidate.url().includes("/project/xtewfpzsyjeaqgkdttij/sql"));
if (!page) page = await context.newPage();
const authRequest = page.waitForRequest((request) => request.url().includes("/platform/pg-meta/xtewfpzsyjeaqgkdttij/query?key="), { timeout: 30000 });
await page.goto("https://supabase.com/dashboard/project/xtewfpzsyjeaqgkdttij/sql/new", { waitUntil: "domcontentloaded" });
const headers = await (await authRequest).allHeaders();
const safeHeaders = {};
for (const name of ["authorization", "apikey", "content-type", "x-client-info", "x-connection-encrypted"]) if (headers[name]) safeHeaders[name] = headers[name];
safeHeaders["content-type"] = "application/json";
const endpoint = "https://api.supabase.com/platform/pg-meta/xtewfpzsyjeaqgkdttij/query?key=";
const started = Date.now();
const run = async () => {
  const callStarted = Date.now();
  const response = await context.request.post(endpoint, { headers: safeHeaders, data: { query: sql }, timeout: 240000 });
  const raw = await response.text();
  return { status: response.status(), elapsedMs: Date.now() - callStarted, body: raw.replaceAll(proof, "<redacted>") };
};
const results = await Promise.all([run(), run()]);
const ids = results.flatMap((result) => [...result.body.matchAll(/"accountId"\s*:\s*"([0-9a-f-]{36})"/gu)].map((item) => item[1]));
const pass = results.every((result) => result.status === 201) && ids.length === 2 && new Set(ids).size === 1 && results.some((result) => result.elapsedMs >= 3500);
const record = { pass, sqlSha256: sha(sql), calls: results.map(({ status, elapsedMs, body }) => ({ status, elapsedMs, bodySha256: sha(body), body })), sameDeterministicAccountId: ids.length === 2 && new Set(ids).size === 1, elapsedMs: Date.now() - started, proofPrinted: false, proofPersisted: false, rollbackOnly: true, capturedAt: new Date().toISOString() };
fs.writeFileSync(outputPath, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ outputPath, pass, statuses: results.map((item) => item.status), elapsedMs: results.map((item) => item.elapsedMs), sameDeterministicAccountId: record.sameDeterministicAccountId, proofPrinted: false, proofPersisted: false }));
await browser.close();
if (!pass) process.exit(1);
