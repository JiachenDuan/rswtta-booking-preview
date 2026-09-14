import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const proofSentinel = "__" + "CLUB_ACCEPTANCE_PROOF_VALUE" + "__";
const unresolvedPlaceholder = /__[A-Z][A-Z0-9_]{2,}__/gu;

export function renderClubAcceptance(template, proof) {
  if (typeof proof !== "string" || proof.length === 0) throw new Error("Club proof is required");
  const escaped = proof.replaceAll("'", "''");
  const assignment = new RegExp(`^(\\s*v_proof\\s+text\\s*:=\\s*)'${proofSentinel}'(\\s*;)`, "mu");
  const matches = [...template.matchAll(new RegExp(assignment.source, "gmu"))];
  if (matches.length !== 1) throw new Error(`Expected exactly one Club proof SQL assignment; found ${matches.length}`);
  const rendered = template.replace(assignment, `$1'${escaped}'$2`);
  const unresolved = [...rendered.matchAll(unresolvedPlaceholder)].map((match) => match[0]);
  if (unresolved.length) throw new Error(`Rendered SQL has unresolved placeholders (${unresolved.length})`);
  if (rendered.includes(proofSentinel)) throw new Error("Club proof sentinel remained after rendering");
  return rendered;
}

export function scanTemplatePlaceholders() {
  const roots = ["supabase/migrations", "sql", "scripts"];
  const files = [];
  const visit = (absolute) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:sql|sh|mjs)$/u.test(entry.name)) files.push(child);
    }
  };
  for (const directory of roots) visit(path.join(root, directory));
  const occurrences = [];
  for (const absolute of files) {
    const relative = path.relative(root, absolute);
    const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(unresolvedPlaceholder)) {
        const trimmed = line.trimStart();
        occurrences.push({ file: relative, line: index + 1, token: match[0], context: trimmed.startsWith("--") || trimmed.startsWith("#") ? "comment" : "value" });
      }
    });
  }
  const expected = occurrences.filter((item) => item.file === "sql/verification/20260914133000_club_search_preregister.acceptance-rollback.sql" && item.token === proofSentinel && item.context === "value");
  const collisions = occurrences.filter((item) => !expected.includes(item));
  if (expected.length !== 1 || collisions.length) {
    throw new Error(`Placeholder scan failed: expected=${expected.length}, collisions=${collisions.length}`);
  }
  return { filesScanned: files.length, placeholderOccurrences: occurrences.length, expectedValueOccurrences: expected.length, commentCollisions: occurrences.filter((item) => item.context === "comment").length, unexpectedOccurrences: collisions.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const templatePath = path.join(root, "sql/verification/20260914133000_club_search_preregister.acceptance-rollback.sql");
  const template = fs.readFileSync(templatePath, "utf8");
  const scan = scanTemplatePlaceholders();
  const fakeProof = `preflight-${crypto.randomUUID()}'quoted`;
  const rendered = renderClubAcceptance(template, fakeProof);
  if (!rendered.includes(fakeProof.replaceAll("'", "''"))) throw new Error("Proof assignment substitution did not authenticate the SQL value path");
  if (rendered.includes(fakeProof + "\n") || rendered.includes(`-- ${fakeProof}`)) throw new Error("Proof was substituted outside the SQL value");
  console.log(JSON.stringify({ pass: true, ...scan, renderedSqlUnresolvedPlaceholders: 0, substitutionTarget: "single SQL variable value", proofPrinted: false, proofPersisted: false }));
}
