import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeParentLegacyBooking, normalizeParentLegacyDashboard } from "../lib/parentLegacyDashboard";
import {
  parentLegacySessionVersion,
  parentSetupSessionVersion,
  parseParentLegacyStoredSession,
  parseParentSetupAccount,
  safeStorageRead,
  safeStorageRemove,
  safeStorageWrite,
  serializeParentSetupAccount
} from "../lib/parentSessionStorage";
import type { ParentAccount } from "../lib/types";

const app = readFileSync("components/ClubApp.tsx", "utf8");
const sessionClient = readFileSync("lib/parentLegacySession.ts", "utf8");
const dashboardClient = readFileSync("lib/parentLegacyDashboard.ts", "utf8");

const account: ParentAccount = {
  id: "account-1",
  studentName: "Test Student",
  parentName: "Test Parent",
  email: "test@example.invalid",
  phone: "0000000000",
  confirmed: true,
  profileSetupRequired: true,
  createdAt: "2026-09-14T00:00:00.000Z"
};

test("malformed JSON and valid JSON with the wrong shape are rejected", () => {
  expect(parseParentLegacyStoredSession("{", 1)).toBeNull();
  expect(parseParentLegacyStoredSession(JSON.stringify({ sessionToken: 7, expiresAt: [] }), 1)).toBeNull();
  expect(parseParentSetupAccount("{")).toBeNull();
  expect(parseParentSetupAccount(JSON.stringify({ id: "partial" }))).toBeNull();
});

test("expired tokens and unknown versions are rejected", () => {
  expect(parseParentLegacyStoredSession(JSON.stringify({ sessionToken: "opaque", expiresAt: "2026-09-14T00:00:00.000Z" }), Date.parse("2026-09-14T00:00:00.001Z"))).toBeNull();
  expect(parseParentLegacyStoredSession(JSON.stringify({ version: 99, sessionToken: "opaque", expiresAt: "2099-01-01T00:00:00.000Z" }), 1)).toBeNull();
});

test("valid legacy and versioned opaque sessions remain compatible", () => {
  const legacy = JSON.stringify({ sessionToken: "legacy-opaque", expiresAt: "2099-01-01T00:00:00.000Z" });
  const versioned = JSON.stringify({ version: parentLegacySessionVersion, sessionToken: "versioned-opaque", expiresAt: "2099-01-01T00:00:00.000Z" });
  expect(parseParentLegacyStoredSession(legacy, 1)?.sessionToken).toBe("legacy-opaque");
  expect(parseParentLegacyStoredSession(versioned, 1)?.sessionToken).toBe("versioned-opaque");
});

test("setup snapshots require the full account schema and current version", () => {
  expect(JSON.parse(serializeParentSetupAccount(account)).version).toBe(parentSetupSessionVersion);
  expect(parseParentSetupAccount(serializeParentSetupAccount(account))).toEqual(account);
  expect(parseParentSetupAccount(JSON.stringify({ ...account, confirmed: undefined }))).toBeNull();
  expect(parseParentSetupAccount(JSON.stringify({ version: 99, account }))).toBeNull();
});

test("storage read, write, and remove exceptions never escape", () => {
  const throwing = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
    clear() {},
    key() { return null; },
    length: 0
  } satisfies Storage;
  expect(safeStorageRead(null, "key")).toEqual({ value: null, failed: true });
  expect(safeStorageRead(throwing, "key")).toEqual({ value: null, failed: true });
  expect(safeStorageWrite(throwing, "key", "value")).toBe(false);
  expect(safeStorageRemove(throwing, "key")).toBe(false);
});

test("invalid and expired verified sessions clear only the app token", () => {
  expect(sessionClient).toContain("parseParentLegacyStoredSession(result.value)");
  expect(sessionClient).toContain("expiresAt > Date.now()");
  expect(sessionClient).toContain("clearParentLegacySession();");
  const clearBody = sessionClient.slice(sessionClient.indexOf("export function clearParentLegacySession"), sessionClient.indexOf("export async function loginParentLegacySession"));
  expect(clearBody).toContain("safeStorageRemove(storage(), parentLegacySessionStorageKey)");
  expect(clearBody).not.toContain("parentLegacyClientKeyStorageKey");
  expect(clearBody).not.toContain("localStorage");
});

test("fresh login normalizes legacy booking rows before dashboard rendering", () => {
  const normalized = normalizeParentLegacyBooking({
    id: "legacy-booking",
    startsAt: "2026-09-15T18:00:00.000Z",
    status: "change_requested"
  });
  expect(normalized.parentNote).toBe("");
  expect(normalized.studentName).toBe("Student");
  expect(normalized.familyName).toBe("Student");
  expect(normalized.requestedCoach).toBe("National A");
  expect(() => normalized.parentNote.toLowerCase().includes("cancel")).not.toThrow();
  const dashboard = normalizeParentLegacyDashboard({
    account,
    bookings: [],
    calendarBookings: [normalized],
    serverNow: "2026-09-14T17:00:00.000Z"
  });
  expect(dashboard.calendarBookings).toHaveLength(1);
});

test("login and resume reject incomplete dashboard envelopes before rendering", () => {
  expect(dashboardClient).toContain("Array.isArray(candidate.bookings)");
  expect(dashboardClient).toContain("Array.isArray(candidate.calendarBookings)");
  expect(dashboardClient).toContain('typeof candidate.serverNow === "string"');
  expect(sessionClient.match(/requireDashboard\(/g)).toHaveLength(2);
  expect(sessionClient).toContain("if (!isStoredSession(session))");
});

test("setup snapshots are safely parsed and never resumed without proof on reload or Back", () => {
  expect(app).toContain("readStoredParentSetupState()");
  expect(app).toContain("parseParentSetupAccount(result.value)");
  expect(app).toContain("safeStorageRemove(browserStorage(\"localStorage\"), parentSessionKey)");
  const restore = app.slice(app.indexOf("const verifiedState"), app.indexOf("loadAll();", app.indexOf("const verifiedState")));
  expect(restore).toContain("require a fresh setup login");
  expect(restore).not.toContain("applyParentSession(storedParent");
});

test("session restore is bounded and returns desktop/mobile reloads to bilingual login recovery", () => {
  expect(app).toContain("const parentSessionRestoreTimeoutMs = 8000");
  expect(app).toContain("withTimeout(resumeParentLegacySession");
  expect(app).toContain('setParentSessionRecovery("restoring")');
  expect(app).toContain('setParentSessionRecovery("recovered")');
  expect(app).toContain("Your saved Parent session was invalid or expired. Please sign in again.");
  expect(app).toContain("您保存的家长登录已失效或过期。请重新登录。");
  expect(app).toContain('disabled={parentSessionRecovery === "restoring"}');
  expect(app).toContain("setupState.storageFailed || storedClub.failed");
});

test("recovery does not weaken login or clear valid sessions", () => {
  expect(sessionClient).toContain('supabase.rpc("parent_legacy_session_resume"');
  expect(sessionClient).toContain("p_session_token: sessionToken");
  expect(sessionClient).toContain("p_client_key: parentLegacyClientKey()");
  expect(app).toContain("applyParentLegacyDashboard(dashboard)");
  const successBranch = app.slice(app.indexOf(".then((dashboard)"), app.indexOf(".catch(()", app.indexOf(".then((dashboard)")));
  expect(successBranch).not.toContain("clearParentLegacySession");
});
