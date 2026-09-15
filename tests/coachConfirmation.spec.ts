import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  invitationCompletionErrorMessage,
  parseCoachConfirmationInput,
  passwordUpdateErrorMessage
} from "../lib/coachAuth/confirmation";

const confirmForm = readFileSync("app/coach/confirm/ConfirmForm.tsx", "utf8");
const confirmPage = readFileSync("app/coach/confirm/page.tsx", "utf8");
const actions = readFileSync("app/coach/actions.ts", "utf8");
const authServer = readFileSync("lib/coachAuth/server.ts", "utf8");
const authBrowser = readFileSync("lib/coachAuth/browser.ts", "utf8");
const clubApp = readFileSync("components/ClubApp.tsx", "utf8");

test("default-template invite and recovery fragments are accepted in the Club app session store", () => {
  expect(parseCoachConfirmationInput({
    hash: "#access_token=access.jwt&refresh_token=refresh-token&type=invite&expires_in=3600&token_type=bearer"
  })).toEqual({ kind: "implicit", accessToken: "access.jwt", refreshToken: "refresh-token", type: "invite" });

  expect(parseCoachConfirmationInput({
    code: "browser-bound-code",
    hash: "#access_token=recovery.jwt&refresh_token=recovery-refresh&type=recovery"
  })).toEqual({ kind: "implicit", accessToken: "recovery.jwt", refreshToken: "recovery-refresh", type: "recovery" });

  expect(confirmPage).toContain("<ConfirmForm code={code} tokenHash={tokenHash} type={type} />");
  expect(authBrowser).toContain('from "@supabase/supabase-js"');
  expect(authBrowser).not.toContain('from "@supabase/ssr"');
  expect(authBrowser).toContain("persistSession: true");
  expect(authBrowser).toContain("detectSessionInUrl: false");
  expect(confirmPage).not.toContain("hasSecureContext");
  expect(confirmForm).toContain("hash: window.location.hash");
  expect(confirmForm).toContain("client.auth.setSession");
  expect(confirmForm.indexOf("client.auth.setSession")).toBeLessThan(confirmForm.lastIndexOf("cleanConfirmationUrl()"));
});

test("PKCE, token-hash, existing-session, and callback-error fallbacks remain explicit", () => {
  expect(parseCoachConfirmationInput({ code: "same-browser-code" })).toEqual({ kind: "pkce", code: "same-browser-code" });
  expect(parseCoachConfirmationInput({ tokenHash: "hashed-otp", type: "recovery" }))
    .toEqual({ kind: "otp", tokenHash: "hashed-otp", type: "recovery" });
  expect(parseCoachConfirmationInput({})).toEqual({ kind: "session" });
  expect(parseCoachConfirmationInput({ hash: "#error=access_denied&error_description=expired" })).toEqual({ kind: "error" });
  expect(parseCoachConfirmationInput({ tokenHash: "hashed-otp", type: "signup" })).toEqual({ kind: "session" });

  for (const call of ["exchangeCodeForSession", "verifyOtp", "getUser"]) expect(confirmForm).toContain(call);
  expect(confirmForm).toContain("coachExchangeCodeAction(confirmation.code)");
  expect(actions).toContain("export async function coachExchangeCodeAction");
  expect(actions).toContain("data.session.access_token");
});

test("recovery requests deliberately omit browser-bound PKCE", () => {
  expect(actions).toContain("createCoachRecoverySupabaseClient()");
  expect(authServer).toContain('flowType: "implicit"');
  expect(authServer).toContain("persistSession: false");
  expect(authServer).toContain("detectSessionInUrl: false");
});

test("password and post-password failures tell the user what completed", () => {
  expect(passwordUpdateErrorMessage({ code: "weak_password", message: "Password is too weak" }))
    .toContain("does not meet the security requirements");
  expect(passwordUpdateErrorMessage({ code: "over_request_rate_limit", message: "Too many requests" }))
    .toContain("Too many attempts");
  expect(passwordUpdateErrorMessage({ code: "session_not_found", message: "Auth session missing" }))
    .toContain("secure link has expired");
  expect(passwordUpdateErrorMessage({ code: "unexpected", message: "Database offline" }))
    .toContain("Could not set your password");
  expect(invitationCompletionErrorMessage).toContain("Your password was set");

  const update = confirmForm.indexOf("auth.updateUser");
  const acceptance = confirmForm.indexOf('rpc("operator_accept_invitation"');
  expect(update).toBeGreaterThan(-1);
  expect(acceptance).toBeGreaterThan(update);
  expect(confirmForm).toContain('setStatus(passwordUpdated ? "password-set-error" : "ready")');
});

test("legacy shared Club login remains available", () => {
  expect(clubApp).toContain("if (normalizedIdentifier === clubEmail)");
  expect(clubApp).toContain('safeStorageWrite(browserStorage("localStorage"), clubSessionKey, "true")');
});
