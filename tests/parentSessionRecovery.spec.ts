import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const app = readFileSync("components/ClubApp.tsx", "utf8");
const sessionClient = readFileSync("lib/parentLegacySession.ts", "utf8");

test("malformed and expired verified sessions clear only the app session token", () => {
  expect(sessionClient).toContain("const value: unknown = JSON.parse(raw)");
  expect(sessionClient).toContain("Number.isFinite(expiresAt)");
  expect(sessionClient).not.toContain("expiresAt > Date.now()");
  expect(sessionClient).toContain("clearParentLegacySession();\n  return null;");
  const clearBody = sessionClient.slice(sessionClient.indexOf("export function clearParentLegacySession"), sessionClient.indexOf("export async function loginParentLegacySession"));
  expect(clearBody).toContain("removeItem(parentLegacySessionStorageKey)");
  expect(clearBody).not.toContain("parentLegacyClientKeyStorageKey");
  expect(clearBody).not.toContain("localStorage");
});

test("login and resume reject incomplete dashboard responses before rendering", () => {
  expect(sessionClient).toContain("Array.isArray(candidate.bookings)");
  expect(sessionClient).toContain("Array.isArray(candidate.calendarBookings)");
  expect(sessionClient).toContain('typeof candidate.serverNow === "string"');
  expect(sessionClient.match(/requireDashboard\(/g)).toHaveLength(3);
  expect(sessionClient).toContain("if (!isStoredSession(session))");
});

test("legacy setup snapshots are parsed safely and never resumed without proof", () => {
  const reader = app.slice(app.indexOf("function readStoredParentSetupAccount"), app.indexOf("async function withTimeout"));
  expect(reader).toContain("try {");
  expect(reader).toContain("JSON.parse(raw)");
  expect(reader).toContain("catch {");
  expect(reader).toContain("removeItem(parentSessionKey)");
  const restore = app.slice(app.indexOf("const hadVerifiedSession"), app.indexOf("loadAll();", app.indexOf("const hadVerifiedSession")));
  expect(restore).toContain("const hadStoredParent");
  expect(restore).toContain("require a fresh setup login");
  expect(restore).not.toContain("applyParentSession(storedParent");
});

test("session restore is bounded and returns to bilingual login recovery", () => {
  expect(app).toContain("const parentSessionRestoreTimeoutMs = 8000");
  expect(app).toContain("withTimeout(resumeParentLegacySession");
  expect(app).toContain('setParentSessionRecovery("restoring")');
  expect(app).toContain('setParentSessionRecovery("recovered")');
  expect(app).toContain("Your saved Parent session was invalid or expired. Please sign in again.");
  expect(app).toContain("您保存的家长登录已失效或过期。请重新登录。");
  expect(app).toContain('disabled={parentSessionRecovery === "restoring"}');
});

test("recovery does not weaken login or clear valid sessions", () => {
  expect(sessionClient).toContain('supabase.rpc("parent_legacy_session_resume"');
  expect(sessionClient).toContain("p_session_token: sessionToken");
  expect(sessionClient).toContain("p_client_key: parentLegacyClientKey()");
  expect(app).toContain("applyParentLegacyDashboard(dashboard)");
  const successBranch = app.slice(app.indexOf(".then((dashboard)"), app.indexOf(".catch(()", app.indexOf(".then((dashboard)")));
  expect(successBranch).not.toContain("clearParentLegacySession");
});
