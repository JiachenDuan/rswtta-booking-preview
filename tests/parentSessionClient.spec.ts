import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const clientSource = readFileSync("lib/parentClient.ts", "utf8");
const appSource = readFileSync("components/ClubApp.tsx", "utf8");
const parentState = appSource.slice(appSource.indexOf("export function ClubApp"), appSource.indexOf("function UnifiedAuth"));
const authUi = appSource.slice(appSource.indexOf("function UnifiedAuth"), appSource.indexOf("function FirstLoginSetup"));

test("Parent identity is restored from an opaque sessionStorage token, never a stored account row", () => {
  expect(clientSource).toContain('parentSessionStorageKey = "rswtta-parent-session-token"');
  expect(clientSource).toContain("JSON.stringify(session)");
  expect(parentState).toContain("refreshParentSession(storedSession.sessionToken)");
  expect(parentState).toContain("logoutParentSession(token)");
  expect(parentState).not.toContain("localStorage.setItem(parentSessionKey");
  expect(parentState).not.toContain("JSON.stringify(account)");
});

test("all direct Parent reads and writes use the server session contract", () => {
  for (const rpc of [
    "parent_session_login",
    "parent_session_refresh",
    "parent_session_logout",
    "parent_issue_operation_nonce",
    "parent_update_profile",
    "parent_complete_profile",
    "parent_request_password_reset",
    "parent_request_booking",
    "parent_request_group_class",
    "parent_complete_booking",
    "parent_cancel_booking_occurrences"
  ]) {
    expect(clientSource).toContain(`supabase.rpc("${rpc}"`);
  }
  expect(parentState).not.toContain("loginParentAccount(");
  expect(parentState).not.toContain("requestBookingAsParent(");
  expect(parentState).not.toContain("updateParentAccount(");
  expect(parentState).not.toContain("cancelBookingAsParent(");
});

test("login keeps username and password while errors stay generic and no hash recovery is trusted", () => {
  expect(authUi).toContain('copy(language, "Username", "用户名")');
  expect(authUi).toContain('copy(language, "Password", "密码")');
  expect(parentState).toContain('"Unable to sign in. Check your username and password."');
  expect(authUi).not.toContain("window.location.hash");
  expect(authUi).not.toContain("onAuthStateChange");
  expect(clientSource).not.toContain("supabase.auth");
  expect(authUi).toContain("Online reset delivery is not available yet. Please contact the club assistant.");
});

test("Parent authorization RPC payloads never carry an account id or email identity", () => {
  expect(clientSource).not.toContain("p_account_id");
  expect(clientSource).not.toContain("p_student_account_id");
  expect(clientSource).not.toContain("p_email");
  expect(clientSource).toContain("p_session_token");
  expect(clientSource).toContain("p_refresh_token");
  expect(clientSource).toContain("p_client_key");
});
