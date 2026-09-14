import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizePreregisteredLogin, resolvePreregisteredLogin } from "../lib/preregisteredLogin";

const accounts = [
  { id: "synthetic-alex-ma", studentName: "Alex Ma", loginAlias: "alex-ma-1001", email: "alex.ma@example.test", phone: "+16505551001" },
  { id: "synthetic-alex-li", studentName: "Alex Li", loginAlias: "alex-li-1002", email: "alex.li@example.test", phone: "+16505551002" }
];
const app = readFileSync("components/ClubApp.tsx", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const originalSetupMigration = readFileSync("supabase/migrations/20260913210000_club_unverified_legacy_preregistration.sql", "utf8");
const setupMigration = readFileSync("supabase/migrations/20260914112000_general_legacy_parent_setup_login.sql", "utf8");
const completedMigration = readFileSync("supabase/migrations/20260913203000_stage_verified_parent_class_time_update.sql", "utf8");
const browserVerification = readFileSync("scripts/verify-parent-login-matching.mjs", "utf8");

function authPanelSource() {
  return app.slice(app.indexOf("function UnifiedAuth"), app.indexOf("function FirstLoginSetup"));
}

test("exact normalized full name binds only Alex Ma's immutable account ID", () => {
  expect(normalizePreregisteredLogin(" ＡＬＥＸ\u3000  ma ")).toBe("alex ma");
  const result = resolvePreregisteredLogin(accounts, " ＡＬＥＸ\u3000  ma ");
  expect(result.status).toBe("unique_exact");
  expect(result.selected?.id).toBe("synthetic-alex-ma");
  expect(result.exactMatches.map(({ id }) => id)).toEqual(["synthetic-alex-ma"]);
  expect(result.exactMatches.map(({ studentName }) => studentName)).not.toContain("Alex Li");
});

test("first-name-only and prefixes do not match or disclose candidates", () => {
  for (const identifier of ["Alex", "Ale", "Alex M"]) {
    const result = resolvePreregisteredLogin(accounts, identifier);
    expect(result).toMatchObject({ status: "no_match", exactMatches: [] });
    expect(result.selected).toBeUndefined();
  }
  const authPanel = authPanelSource();
  expect(authPanel).not.toContain("firstNameMatches");
  expect(authPanel).not.toContain("student.studentName");
  expect(authPanel).not.toContain("maskedPreregisteredContact");
  expect(authPanel).not.toContain("Other students share this first name");
});

test("duplicate complete identifiers across distinct accounts are ambiguous and never first-match", () => {
  const duplicates = [
    { id: "synthetic-one", studentName: "Alex Example", loginAlias: "first-alias" },
    { id: "synthetic-two", studentName: "Ａｌｅｘ  Example", loginAlias: "second-alias" }
  ];
  const result = resolvePreregisteredLogin(duplicates, "alex example");
  expect(result.status).toBe("ambiguous");
  expect(result.exactMatches.map(({ id }) => id)).toEqual(["synthetic-one", "synthetic-two"]);
  expect(result.selected).toBeUndefined();
  expect(store).not.toMatch(/matches\.find\(|matches\[0\]/);
});

test("an exact complete alias binds its immutable ID and near-aliases fail", () => {
  expect(resolvePreregisteredLogin(accounts, " ALEX-MA-1001 ").selected?.id).toBe("synthetic-alex-ma");
  expect(resolvePreregisteredLogin(accounts, "alex-ma")).toMatchObject({ status: "no_match", exactMatches: [] });
  const crossFieldDuplicate = resolvePreregisteredLogin([
    { id: "synthetic-name", studentName: "Alex Exact" },
    { id: "synthetic-alias", studentName: "Alex Other", loginAlias: "alex exact" }
  ], "Alex Exact");
  expect(crossFieldDuplicate.status).toBe("ambiguous");
  expect(crossFieldDuplicate.selected).toBeUndefined();
});

test("button and Enter share form submit semantics and bilingual non-disclosing copy", () => {
  const authPanel = authPanelSource();
  expect(authPanel).toContain('<form className="simple-form auth-form" onSubmit=');
  expect(authPanel).toContain('<button type="submit" className="primary-button auth-submit"');
  for (const text of [
    "No unique account matches",
    "没有唯一匹配的账号",
    "Enter the complete full name or complete login alias.",
    "请输入完整姓名或完整登录别名。",
    "Username recognized. Enter your password to continue.",
    "已识别用户名。请输入密码以继续。"
  ]) expect(authPanel).toContain(text);
});

test("DOM verification covers disabled-to-enabled gating and guarded Enter submission", () => {
  for (const contract of [
    "emptyDisabled",
    "emptyIdentifierDisabled",
    "firstOnlyDisabled",
    "ambiguousDisabled",
    "exactEmptyPasswordDisabled",
    "exactPasswordEnabled",
    "callsBeforeValidSubmit",
    'submit === "enter"',
    'clubPreregistered: false',
    'browserName === "webkit"'
  ]) expect(browserVerification).toContain(contract);
  const authPanel = authPanelSource();
  expect(authPanel).toContain('const preregisteredLoginReady = preregisteredLoginMode && exactPreregisteredLogin && password.length > 0');
  expect(authPanel).toContain('const preregisteredLoginBlocked = preregisteredLoginMode && !preregisteredLoginReady');
  expect(authPanel).toContain('disabled={busy || disabled || preregisteredLoginBlocked}');
});

test("exact email login remains unchanged for completed accounts", () => {
  expect(store).toContain("supabase.auth.signInWithPassword");
  expect(store).toContain("if (isEmail)");
  expect(store).toContain("String(item.values.email ?? \"\").trim().toLowerCase() === normalizedIdentifier");
  expect(completedMigration).toContain("position('@' in v_identifier)=0");
  expect(completedMigration).toContain("lower(normalize(btrim(coalesce(a.values->>'email','')),NFKC))=v_identifier");
});

test("setup and completed-account gates remain separate and exact", () => {
  const setupLogin = setupMigration.slice(
    setupMigration.indexOf("create or replace function public.parent_legacy_setup_login"),
    setupMigration.indexOf("create or replace function public.parent_legacy_complete_setup")
  );
  for (const text of [
    "a.normalized_alias=v_alias",
    "profileSetupRequired')::boolean,false)",
    "interval '15 minutes'",
    ">=8",
    "club_preregistration_pbkdf2"
  ]) expect(setupLogin).toContain(text);
  expect(setupLogin).not.toMatch(/split_part|first.?name|like\s|ilike/i);
  expect(setupLogin).not.toContain("clubPreregistered')::boolean,false) or not coalesce((v_row.values->>'profileSetupRequired");
  expect(app).toContain("students.filter((student) => student.profileSetupRequired)");
  expect(app).toContain('setupResolution.status !== "unique_exact"');
  expect(app).toContain("Client matching only enables submission");
  expect(app).toContain("password verification, setup status, and rate limits");
  expect(app).toContain("legacySetupSessionToken.current = result.sessionToken");
  expect(app).toContain("loginParentLegacySession(identifier, password)");
  expect(app).not.toContain("loginParentAccount(identifier, password, { allowPreregisteredName })");
});

test("legacy setup completion always requires the opaque setup token", () => {
  expect(app).toContain("if (!legacySetupSessionToken.current) throw new Error");
  expect(app).toContain("completeLegacySetup(legacySetupSessionToken.current, input)");
  expect(app).toContain("loginParentLegacySession(input.email, input.password)");
  expect(app).toContain("setVerifiedParentSessionToken(session.sessionToken)");
  expect(app).toContain("applyParentLegacyDashboard(session)");
  expect(app).not.toContain("if (parentSession.clubPreregistered)");
  expect(app).not.toContain("completeParentProfileSetup({");
  expect(setupMigration).toContain("not coalesce((v_row.values->>'profileSetupRequired')::boolean,false)");
  expect(setupMigration).toContain("Student name, email, phone, and a different password are required");
  expect(setupMigration).toContain("v_old_candidate=v_old_hash");
  expect(setupMigration).toContain("'credentialVersion',v_session.credential_version+1");
  expect(setupMigration).toContain("set revoked_at=clock_timestamp()");
});

test("forward migration leaves original deployed migration unchanged", () => {
  expect(originalSetupMigration).toContain("clubPreregistered')::boolean,false");
  expect(setupMigration).toContain("legacy_parent_setup_alias_backup_20260914112000");
  expect(setupMigration).toContain("on conflict do nothing");
  expect(setupMigration).toContain("array['3a6d38c0','b8433b38']::text[]");
});

test("password verification and immutable-ID selection precede writes", () => {
  expect(store).toContain("item.id === resolution.selected?.id");
  const verifyAt = store.indexOf("const ok = await verifyPassword");
  const rejectAt = store.indexOf("if (!ok) throw", verifyAt);
  const writeAt = store.indexOf("updateRow(\"parent_accounts\"", verifyAt);
  expect(verifyAt).toBeGreaterThan(-1);
  expect(rejectAt).toBeGreaterThan(verifyAt);
  expect(writeAt).toBeGreaterThan(rejectAt);
});

test("Parent login changes do not alter Club partial search or registration uniqueness", () => {
  const clubClient = readFileSync("lib/clubPreregistration.ts", "utf8");
  expect(clubClient).toContain('supabase.rpc("club_search_students"');
  expect(clubClient).toContain("similar_name");
  expect(clubClient).toContain("creationDecision");
});
