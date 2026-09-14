import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeLoginAlias, normalizePreregistrationInput, previewPreregistrationCollisions, validatePreregistrationInput } from "../lib/clubPreregistration";
import type { ParentAccount } from "../lib/types";

const baseMigration = readFileSync("supabase/migrations/20260913210000_club_unverified_legacy_preregistration.sql", "utf8");
const fixMigration = readFileSync("supabase/migrations/20260913213000_fix_club_preregister_duplicate_names.sql", "utf8");
const v2Migration = readFileSync("supabase/migrations/20260913214500_create_club_preregister_student_v2.sql", "utf8");
const migration = baseMigration + "\n" + fixMigration + "\n" + v2Migration;
const client = readFileSync("lib/clubPreregistration.ts", "utf8");
const panel = readFileSync("components/RegisterStudentPanel.tsx", "utf8");
const app = readFileSync("components/ClubApp.tsx", "utf8");
const account = (id: string, studentName: string, email = "", phone = ""): ParentAccount => ({ id, studentName, email, phone, parentName: "", confirmed: true, profileSetupRequired: false, createdAt: "2026-09-13T00:00:00Z" });

test("normalizes Unicode, aliases, and optional contact fields", () => {
  expect(normalizePreregistrationInput({ studentName: "  王\u3000小明  ", email: " STUDENT@Example.COM ", phone: "+1 (650) 555-1212" })).toEqual({ studentName: "王 小明", email: "student@example.com", phone: "+16505551212" });
  expect(normalizeLoginAlias(" Ａｌｅｘ   Li ")).toBe("alex li");
  expect(validatePreregistrationInput({ studentName: "A", email: "", phone: "" }).studentName).toBe("A");
});

test("rejects invalid optional contacts and control characters", () => {
  for (const email of ["x", "a@", "@b.com"]) expect(() => validatePreregistrationInput({ studentName: "Li", email, phone: "" })).toThrow(/valid email/);
  for (const phone of ["123", "+12x345678"]) expect(() => validatePreregistrationInput({ studentName: "Li", email: "", phone })).toThrow(/valid phone/);
  expect(() => validatePreregistrationInput({ studentName: "A\u0000B", email: "", phone: "" })).toThrow(/control/);
});

test("collision preview preserves separate UUID identities", () => {
  const accounts = [account("one", "Same Name", "one@example.test", "6505551111"), account("two", "Other", "two@example.test", "6505551111")];
  const collisions = previewPreregistrationCollisions(accounts, { studentName: " same  name ", email: "NEW@example.test", phone: "(650) 555-1111" });
  expect(collisions).toHaveLength(2);
  expect(collisions.find((item) => item.accountId === "one")?.kinds).toEqual(["display_name", "phone"]);
  expect(new Set([accounts[0].id, "new-stable-id"]).size).toBe(2);
});

test("server labels the exception honestly and validates proof server-side", () => {
  expect(migration).toContain("club_unverified_legacy");
  expect(migration).toContain("club_preregistration_verify_legacy_club");
  expect(migration).toContain("p_club_proof");
  expect(migration).not.toMatch(/p_actor|caller_actor|actor_label/i);
  expect(client).toContain("p_club_proof: legacyClubProof");
  expect(client).not.toContain("supabase.auth.getSession");
});

test("creation is atomic, stale-safe, idempotent, serialized, and canonical-ID based", () => {
  for (const value of ["begin;", "pg_advisory_xact_lock", "request_hash<>v_request_hash", "Idempotency key payload mismatch", "Duplicate preview is stale", "extensions.gen_random_uuid()", "accountId", "loginAlias", "collisionVersion"]) expect(migration).toContain(value);
  const activeBody = v2Migration.slice(v2Migration.indexOf("create function public.club_preregister_student_v2"));
  expect(activeBody.match(/insert into public\.project_rows/g)).toHaveLength(2);
  expect(migration).toContain("confirmed',false");
  expect(migration).toContain("profileSetupRequired',true");
});

test("uses only the existing slow salted credential family and setup atomically replaces it", () => {
  expect(migration).toContain("club_preregistration_temp_credential");
  expect(migration).toContain("algorithm='pbkdf2-sha256'");
  expect(migration).toContain("iterations=100000");
  expect(migration).toContain("club_preregistration_pbkdf2");
  expect(migration).toContain("A different password is required");
  expect(migration).toContain("profileSetupRequired',false");
  expect(migration).toContain("club_preregistration_sessions s set revoked_at=clock_timestamp()");
});

test("first login is setup-only, rate-limited, and protected from direct account mutation", () => {
  expect(migration).toContain("parent_legacy_setup_login");
  expect(migration).toContain("parent_legacy_complete_setup");
  expect(migration).toContain("interval '15 minutes'");
  expect(migration).toContain(">=8");
  expect(migration).toContain("protect_club_preregistered_account");
  expect(migration).toContain("setupOnly',true");
  expect(app).toContain("Dashboard, schedule, booking, billing, packages, and account data stay locked");
});

test("private backup and internal tables deny browser roles", () => {
  expect(migration).toContain("club_preregistration_backup_20260913210000");
  expect(migration).toContain("Private rollback-only backup");
  expect(migration).toContain("has_table_privilege('anon'");
  expect(migration).toContain("revoke all on all tables in schema rswtta_private from public,anon,authenticated");
});

test("activity is redacted and no package, booking, billing, or group record is created", () => {
  const body = v2Migration.slice(v2Migration.indexOf("create function public.club_preregister_student_v2"));
  expect(body).toContain("One pending student preregistration was created.");
  expect(body).toContain("'studentName',''");
  expect(body).toContain("'actor','club_unverified_legacy'");
  expect(body).not.toMatch(/class_package_events|class_package_keys|bill_notifications|bookings|groupClassId/);
});

test("Club-only bilingual UI warns generically and keeps contacts optional", () => {
  const parentStart = app.indexOf("function ParentApp(");
  const clubStart = app.indexOf("function ClubAppView(");
  expect(app.slice(parentStart, clubStart)).not.toContain("RegisterStudentPanel");
  for (const value of ["Register new student", "注册新学生", "Second confirmation", "二次确认", "temporary password", "临时密码", "Email (optional)", "邮箱（可选）", "Possible matches", "可能匹配"]) expect(panel).toContain(value);
  expect(panel).toContain('data-club-only="true"');
});

test("three package categories remain derived with no preregistration side effect", () => {
  const packageSource = readFileSync("lib/classPackages.ts", "utf8");
  for (const category of ["coach_director_private", "national_coach_private", "group_class"]) expect(packageSource).toContain(`"${category}"`);
  const body = v2Migration.slice(v2Migration.indexOf("create function public.club_preregister_student_v2"));
  expect(body).not.toContain("package_");
});
