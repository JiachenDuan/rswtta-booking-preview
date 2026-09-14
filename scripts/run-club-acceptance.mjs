import crypto from "node:crypto";
import fs from "node:fs";
import { chromium } from "playwright";
import { renderClubAcceptance, scanTemplatePlaceholders } from "./preflight-club-acceptance.mjs";

const [templatePath, outputPath] = process.argv.slice(2);
if (!templatePath || !outputPath) throw new Error("usage: node scripts/run-club-acceptance.mjs SQL_TEMPLATE OUTPUT");
const template = fs.readFileSync(templatePath, "utf8");
const clubSource = fs.readFileSync(new URL("../components/ClubApp.tsx", import.meta.url), "utf8");
const proofMatch = clubSource.match(/^const clubPassword = (["'])(.+)\1;$/mu);
if (!proofMatch) throw new Error("Unable to obtain the existing Club proof without logging it");
const proof = proofMatch[2];
const scan = scanTemplatePlaceholders();
const sql = renderClubAcceptance(template, proof);
if (/__[A-Z][A-Z0-9_]{2,}__/u.test(sql)) throw new Error("Refusing to execute SQL with unresolved placeholders");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
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
const response = await context.request.post("https://api.supabase.com/platform/pg-meta/xtewfpzsyjeaqgkdttij/query?key=", { headers: safeHeaders, data: { query: sql }, timeout: 240000 });
const rawBody = await response.text();
const responseBody = rawBody.replaceAll(proof, "<redacted>");
const record = {
  sqlPath: templatePath,
  templateSha256: sha256(template),
  submittedQuerySha256: sha256(sql),
  responseStatus: response.status(),
  responseBodySha256: sha256(rawBody),
  responseBody,
  preflight: { ...scan, renderedSqlUnresolvedPlaceholders: 0, proofPrinted: false, proofPersisted: false, disposableSearchAuthenticated: response.ok() },
  capturedAt: new Date().toISOString()
};
fs.writeFileSync(outputPath, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ sqlPath: templatePath, outputPath, templateSha256: record.templateSha256, submittedQuerySha256: record.submittedQuerySha256, responseStatus: response.status(), preflight: record.preflight }));
await browser.close();
if (!response.ok()) process.exit(1);
