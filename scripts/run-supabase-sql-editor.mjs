import fs from "node:fs";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";

const [sqlPath, outputPath] = process.argv.slice(2);
if (!sqlPath || !outputPath) throw new Error("usage: node scripts/run-supabase-sql-editor.mjs SQL OUTPUT");
const sql = fs.readFileSync(sqlPath, "utf8");
const browser = await chromium.connectOverCDP("http://127.0.0.1:18805");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => candidate.url().includes("supabase.com/dashboard/project/xtewfpzsyjeaqgkdttij/sql/"));
if (!page) throw new Error("Supabase SQL editor tab is not open");
await page.waitForFunction(() => Boolean(globalThis.monaco?.editor?.getEditors?.()[0]), null, { timeout: 30000 });
const written = await page.evaluate((value) => {
  const editor = globalThis.monaco.editor.getEditors()[0];
  editor.setValue(value);
  return editor.getValue();
}, sql);
if (written !== sql) throw new Error("Monaco editor readback mismatch");
const hash = crypto.createHash("sha256").update(sql).digest("hex");
await page.getByRole("button", { name: /^Run/ }).click();
await page.waitForTimeout(500);
await page.waitForFunction(() => {
  const text = document.body.innerText;
  const run = [...document.querySelectorAll("button")].find((button) => /^Run(?:\n|$)/.test(button.innerText));
  return Boolean(run && !run.disabled && !text.includes("Running...") && !text.includes("Running query"));
}, null, { timeout: 120000 });
await page.waitForTimeout(1000);
const body = await page.locator("body").innerText();
fs.writeFileSync(outputPath, body);
console.log(JSON.stringify({ sqlPath, outputPath, bytes: sql.length, sha256: hash, resultChars: body.length, url: page.url() }));
await browser.close();
