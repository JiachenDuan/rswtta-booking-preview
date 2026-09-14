import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { maskedPreregisteredContact, normalizePreregisteredLogin, resolvePreregisteredLogin } from "../lib/preregisteredLogin";

const accounts = [
  { id: "synthetic-alex-ma", studentName: "Alex Ma", loginAlias: "alex ma", email: "alex.ma@example.test", phone: "+16505551001" },
  { id: "synthetic-alex-li", studentName: "Alex Li", loginAlias: "alex li", email: "alex.li@example.test", phone: "+16505551002" }
];
const app = readFileSync("components/ClubApp.tsx", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260913210000_club_unverified_legacy_preregistration.sql", "utf8");

test("case-insensitive normalized exact Alex Ma selects only its stable account despite Alex Li", () => {
  expect(normalizePreregisteredLogin(" ＡＬＥＸ   ma ")).toBe("alex ma");
  const result = resolvePreregisteredLogin(accounts, " ＡＬＥＸ   ma ");
  expect(result.status).toBe("unique_exact");
  expect(result.selected?.id).toBe("synthetic-alex-ma");
  expect(result.selected?.id).not.toBe("synthetic-alex-li");
  expect(result.firstNameMatches).toHaveLength(2);
});

test("a first-name collision warns and blocks only when no unique exact username exists", () => {
  expect(resolvePreregisteredLogin(accounts, "Alex").status).toBe("ambiguous");
  expect(resolvePreregisteredLogin(accounts, "alex ma").status).toBe("unique_exact");
  expect(app).toContain("Other students share this first name, but this exact full username identifies one account.");
  expect(app).toContain('disabled={busy || preregisteredLoginBlocked}');
});

test("duplicate exact names are ambiguous and resolution never first-matches", () => {
  const duplicates = [
    { id: "synthetic-one", studentName: "Alex Example" },
    { id: "synthetic-two", studentName: "Ａｌｅｘ  Example" }
  ];
  const result = resolvePreregisteredLogin(duplicates, "alex example");
  expect(result.status).toBe("ambiguous");
  expect(result.selected).toBeUndefined();
  expect(store).not.toMatch(/matches\.find\(|matches\[0\]/);
});

test("unique aliases and first-name matches bind one ID while no match is rejected", () => {
  expect(resolvePreregisteredLogin([accounts[0]], "Alex").selected?.id).toBe("synthetic-alex-ma");
  expect(resolvePreregisteredLogin([{ ...accounts[0], loginAlias: "alex-ma-ab12" }], "ALEX-MA-AB12").selected?.id).toBe("synthetic-alex-ma");
  expect(resolvePreregisteredLogin(accounts, "Jordan Synthetic").status).toBe("no_match");
});

test("contact hints are masked", () => {
  expect(maskedPreregisteredContact(accounts[0])).toBe("a••••@example.test");
  expect(maskedPreregisteredContact({ phone: "+1 (650) 555-1002" })).toBe("•••-•••-1002");
  expect(app).toContain('maskedPreregisteredContact(student) || copy(language, "Profile incomplete", "资料待完善")');
});

test("login form has submit semantics, Enter support, and bilingual ambiguity copy", () => {
  expect(app).toContain('<form className="simple-form auth-form" onSubmit=');
  expect(app).toContain('<button type="submit" className="primary-button auth-submit"');
  for (const text of ["No unique account matches this username.", "没有唯一账号匹配此用户名。", "Exact username found", "已找到准确用户名"]) {
    expect(app).toContain(text);
  }
});

test("normal email login remains available", () => {
  expect(store).toContain("supabase.auth.signInWithPassword");
  expect(store).toContain("if (isEmail)");
  expect(store).toContain("String(item.values.email ?? \"\").trim().toLowerCase() === normalizedIdentifier");
});

test("password verification precedes account writes and wrong passwords do not authenticate", () => {
  const verifyAt = store.indexOf("const ok = await verifyPassword");
  const rejectAt = store.indexOf("if (!ok) throw", verifyAt);
  const writeAt = store.indexOf("updateRow(\"parent_accounts\"", verifyAt);
  expect(verifyAt).toBeGreaterThan(-1);
  expect(rejectAt).toBeGreaterThan(verifyAt);
  expect(writeAt).toBeGreaterThan(rejectAt);
});

test("incomplete protected preregistration remains setup-only with rate limits and post-change invalidation", () => {
  for (const text of ["setupOnly',true", "interval '15 minutes'", ">=8", "club_preregistration_sessions s set revoked_at=clock_timestamp()", "profileSetupRequired',false"]) {
    expect(migration).toContain(text);
  }
  expect(app).toContain("protectedResolution.status === \"unique_exact\"");
  expect(app).toContain("legacySetupSessionToken.current = result.sessionToken");
});
