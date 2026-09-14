import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { creationDecision, maskEmail, maskPhone, normalizeLoginAlias, normalizePreregistrationInput, previewPreregistrationCollisions, validatePreregistrationInput } from "../lib/clubPreregistration";
import type { ParentAccount } from "../lib/types";

const migration = readFileSync("supabase/migrations/20260914133000_search_before_club_preregistration.sql", "utf8");
const rollback = readFileSync("sql/rollback/20260914133000_search_before_club_preregistration.rollback.sql", "utf8");
const client = readFileSync("lib/clubPreregistration.ts", "utf8");
const panel = readFileSync("components/RegisterStudentPanel.tsx", "utf8");
const app = readFileSync("components/ClubApp.tsx", "utf8");
const acceptance = readFileSync("sql/verification/20260914133000_club_search_preregister.acceptance-rollback.sql", "utf8");
const acceptancePreflight = readFileSync("scripts/preflight-club-acceptance.mjs", "utf8");
const acceptanceRunner = readFileSync("scripts/run-club-acceptance.mjs", "utf8");
const concurrencyRunner = readFileSync("scripts/run-club-concurrency-acceptance.mjs", "utf8");
const input = (studentName: string, email = "", phone = "", loginAlias = "") => ({ studentName, email, phone, loginAlias });
const account = (id: string, studentName: string, email = "", phone = "", loginAlias = ""): ParentAccount => ({ id, studentName, email, phone, loginAlias, parentName: "", confirmed: true, profileSetupRequired: false, createdAt: "2026-09-13T00:00:00Z" });

test("normalizes Unicode, case, whitespace, contact, and login aliases", () => {
  expect(normalizePreregistrationInput(input("  王\u3000小明  ", " STUDENT@Example.COM ", "+1 (650) 555-1212", " Ａｌｅｘ   Li "))).toEqual({ studentName: "王 小明", email: "student@example.com", phone: "+16505551212", loginAlias: "alex li" });
  expect(normalizeLoginAlias(" Ａｌｅｘ   Li ")).toBe("alex li");
  expect(validatePreregistrationInput(input("A")).studentName).toBe("A");
});

test("name is required while every other field is optional and validated when present", () => {
  expect(() => validatePreregistrationInput(input(""))).toThrow(/required/);
  expect(validatePreregistrationInput(input("Li"))).toEqual(input("Li"));
  for (const email of ["x", "a@", "@b.com"]) expect(() => validatePreregistrationInput(input("Li", email))).toThrow(/valid email/);
  for (const phone of ["123", "+12x345678"]) expect(() => validatePreregistrationInput(input("Li", "", phone))).toThrow(/valid phone/);
  expect(() => validatePreregistrationInput(input("A\u0000B"))).toThrow(/control/);
});

test("search and warning output masks contacts and uses short stable IDs", () => {
  expect(maskEmail("student@example.test")).toBe("s***@e***");
  expect(maskPhone("+1 (650) 555-1212")).toBe("***1212");
  for (const value of ["maskedEmail", "maskedPhone", "shortId", "left(r.id::text,8)", "club_search_students"]) expect(migration + panel).toContain(value);
  expect(migration).not.toContain("jsonb_build_object('accountId',r.id,'shortId',left(r.id::text,8),'studentName',coalesce(r.values->>'studentName',''),'email'");
});

test("exact and similar bilingual warnings appear while typing without merge or silent selection", () => {
  const accounts = [account("one", "Same Name", "one@example.test", "6505551111"), account("two", "Same Nameson", "two@example.test", "6505552222")];
  const collisions = previewPreregistrationCollisions(accounts, input(" same  name ", "new@example.test", "6505553333"));
  expect(collisions.find((item) => item.accountId === "one")?.kinds).toContain("exact_name");
  expect(collisions.find((item) => item.accountId === "two")?.kinds).toContain("similar_name");
  for (const text of ["Exact name", "姓名完全相同", "Similar name", "姓名相似", "Nothing is merged or selected automatically", "系统不会自动合并或选择"]) expect(panel).toContain(text);
});

test("hard-block rules: email, alias, exact name plus matching contact, and name-only blank", () => {
  const existing = account("existing-uuid", "Same Name", "same@example.test", "6505551111", "same-login");
  expect(creationDecision(previewPreregistrationCollisions([existing], input("Different", "SAME@example.test")), input("Different", "SAME@example.test"), false)).toMatchObject({ blocked: true, reason: "email" });
  expect(creationDecision(previewPreregistrationCollisions([existing], input("Different", "", "", "SAME-LOGIN")), input("Different", "", "", "SAME-LOGIN"), false)).toMatchObject({ blocked: true, reason: "login_alias" });
  expect(creationDecision(previewPreregistrationCollisions([existing], input("Same Name", "", "6505551111")), input("Same Name", "", "6505551111"), true)).toMatchObject({ blocked: true, reason: "name_contact" });
  expect(creationDecision(previewPreregistrationCollisions([existing], input("Same Name")), input("Same Name"), true)).toMatchObject({ blocked: true, reason: "name_only" });
});

test("phone alone warns only and reviewed different-person same-name needs a differentiator", () => {
  const sharedPhone = account("household", "Other Student", "", "6505551111");
  const sameName = account("same-name", "Alex Kim", "", "6505552222");
  expect(creationDecision(previewPreregistrationCollisions([sharedPhone], input("New Student", "", "6505551111")), input("New Student", "", "6505551111"), false)).toMatchObject({ blocked: false });
  const differentPhone = input("Alex Kim", "", "6505553333");
  expect(creationDecision(previewPreregistrationCollisions([sameName], differentPhone), differentPhone, false)).toMatchObject({ blocked: true, reason: "same_name_review" });
  expect(creationDecision(previewPreregistrationCollisions([sameName], differentPhone), differentPhone, true)).toMatchObject({ blocked: false });
});

test("mandatory Step 1 unlocks Step 2 and choosing existing navigates without writes", () => {
  for (const text of ["Step 1 · Search existing students", "第 1 步 · 搜索现有学生", "Continue to Step 2", "继续第 2 步", "disabled={!searchResponse || busy}", "Choose existing", "选择现有账号"]) expect(panel).toContain(text);
  expect(panel).toContain("onChooseExisting(account)");
  expect(app).toContain('setClubSection("calendar"); setShowAddClassModal(true)');
  const chooseBody = panel.slice(panel.indexOf("onChooseExisting(account)"), panel.indexOf("onChooseExisting(account)") + 180);
  expect(chooseBody).not.toMatch(/create|rpc|insert|update/i);
});

test("same-name confirmation previews old and proposed UUIDs explicitly", () => {
  for (const text of ["Existing stable ID(s)", "现有稳定 ID", "Proposed new stable ID", "拟创建的稳定 ID", "reviewedSameName"]) expect(panel).toContain(text);
  expect(migration).toContain("club_preregistration_proposed_id");
  expect(migration).toContain("Explicit same-name confirmation required");
});

test("server repeats search and collision snapshots atomically under deterministic locks", () => {
  const body = migration.slice(migration.indexOf("create function public.club_preregister_student_v3"));
  for (const value of ["club_search_students_snapshot(p_search_query)", "Student search is stale", "club_preregistration_preview_v2(v_safe,p_request_key)", "Duplicate preview is stale", "club-preregister-search:", "club-preregister-name:", "club-preregister-email:", "club-preregister-phone:", "club-preregister-alias:"]) expect(body).toContain(value);
});

test("one idempotent create RPC rejects payload mismatch and emits one redacted activity", () => {
  const body = migration.slice(migration.indexOf("create function public.club_preregister_student_v3"));
  expect(body).toContain("request_hash<>v_request_hash");
  expect(body).toContain("Idempotency key payload mismatch");
  expect(body.match(/insert into public\.project_rows/g)).toHaveLength(2);
  expect(body.match(/student_preregistered/g)).toHaveLength(1);
  expect(body).toContain("'studentName',''");
  expect(body).not.toMatch(/message[^\n]+email|message[^\n]+phone|password[^\n]+message/i);
});

test("only credential claims are uniquely indexed; names and phones remain warning-capable", () => {
  expect(migration).toContain("project_rows_unique_parent_email_claim");
  expect(migration).toContain("project_rows_unique_parent_login_alias_claim");
  expect(migration).not.toMatch(/unique index[^\n]+studentName|unique index[^\n]+phone/i);
});

test("legacy Club authority is reused exactly with no grant broadening", () => {
  expect(migration).toContain("club_preregistration_verify_legacy_club");
  expect(migration).toContain("club_unverified_legacy");
  expect(migration).toContain("revoke all on function public.club_preregister_student_v2");
  expect(migration).not.toMatch(/grant execute[^;]+\bto\s+public\b/i);
  for (const role of ["anon", "authenticated"]) expect(migration).toContain(`to anon,authenticated`);
});

test("temporary setup and Parent/Coach surfaces remain unchanged", () => {
  expect(migration).toContain("club_preregistration_temp_credential");
  expect(migration).toContain("profileSetupRequired',true");
  expect(migration).toContain("confirmed',false");
  expect(migration).not.toContain("create or replace function public.parent_legacy");
  const parentStart = app.indexOf("function ParentApp("); const clubStart = app.indexOf("function ClubAppView(");
  expect(app.slice(parentStart, clubStart)).not.toContain("RegisterStudentPanel");
  expect(app).toContain("onCoachComplete");
});

test("no booking, bill, group, or package side effect and three package zeros still derive", () => {
  const body = migration.slice(migration.indexOf("create function public.club_preregister_student_v3"));
  expect(body).not.toMatch(/class_package_events|class_package_keys|bill_notifications|bookings|groupClassId/);
  const packageSource = readFileSync("lib/classPackages.ts", "utf8");
  for (const category of ["coach_director_private", "national_coach_private", "group_class"]) expect(packageSource).toContain(`"${category}"`);
  expect(packageSource).toContain("emptyPackageBalance");
});

test("stale UI, concurrency keys, rollback, baseline, and private backup gates are explicit", () => {
  for (const text of ["67", "2031", "81", "Fresh private backup mismatch", "has_table_privilege('anon'", "pg_advisory_xact_lock"]) expect(migration).toContain(text);
  for (const object of ["club_preregister_student_v3", "club_preview_student_preregistration_v2", "club_search_students", "project_rows_unique_parent_email_claim", "club_search_preregister_backup_20260914133000"]) expect(rollback).toContain(object);
  expect(rollback).toContain("grant execute on function public.club_preregister_student_v2");
});

test("Club proof substitution targets one SQL variable value with unresolved-placeholder preflight", () => {
  expect(acceptance.match(/__CLUB_ACCEPTANCE_PROOF_VALUE__/g)).toHaveLength(1);
  expect(acceptance.split("\n")[0]).not.toContain("__CLUB_ACCEPTANCE_PROOF_VALUE__");
  for (const text of ["Expected exactly one Club proof SQL assignment", "Rendered SQL has unresolved placeholders", "commentCollisions", "unexpectedOccurrences"]) expect(acceptancePreflight).toContain(text);
  for (const text of ["renderClubAcceptance(template, proof)", "renderedSqlUnresolvedPlaceholders: 0", "replaceAll(proof, \"<redacted>\")", "proofPersisted: false"]) expect(acceptanceRunner).toContain(text);
});

test("rollback-only runtime acceptance covers proof authentication, stale checks, idempotency, and concurrent serialization", () => {
  for (const text of ["Club proof preflight did not authenticate disposable search RPC", "Student search is stale", "Duplicate preview is stale", "Idempotent replay failed", "rollback;"]) expect(acceptance).toContain(text);
  for (const text of ["Promise.all([run(), run()])", "sameDeterministicAccountId", "rollbackOnly: true", "proofPersisted: false"]) expect(concurrencyRunner).toContain(text);
});

test("bilingual responsive keyboard/focus UX has no horizontal overflow", () => {
  const css = readFileSync("app/globals.css", "utf8");
  for (const text of ["Register new student", "注册新学生", "Final explicit confirmation", "最终明确确认", "aria-live=\"polite\"", "role=\"alertdialog\"", "autoFocus", "onSubmit={runSearch}"]) expect(panel).toContain(text);
  expect(css).toContain("min-width: 0");
  expect(css).toContain("overflow-wrap: anywhere");
  expect(css).toContain("@media (max-width: 560px)");
  const preregistrationCss = css.slice(css.indexOf("/* Club-only student preregistration. */"), css.indexOf("/* Club-only category-aware package ledger. */"));
  expect(preregistrationCss).not.toContain("100vw");
});
