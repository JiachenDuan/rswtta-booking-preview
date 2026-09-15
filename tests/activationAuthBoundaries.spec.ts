import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const app = readFileSync("components/ClubApp.tsx", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const prereg = readFileSync("lib/clubPreregistration.ts", "utf8");
const parentClient = readFileSync("lib/parentVerifiedMutations.ts", "utf8");
const context = readFileSync("lib/coachAuth/clientContext.ts", "utf8");
const sql = readFileSync("supabase/migrations/20260915130000_activation_auth_boundaries.sql", "utf8");

function body(name: string) {
  const start = sql.indexOf(`function ${name}`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start));
}

test("Parent mutations derive ownership from opaque session proof and never accept account IDs", () => {
  for (const rpc of ["parent_verified_update_profile", "parent_verified_request_private_booking", "parent_verified_request_group_class", "parent_verified_cancel_booking", "parent_verified_complete_booking"]) {
    expect(parentClient).toContain(`supabase.rpc(\"${rpc}\"`);
    expect(body(`public.${rpc}`)).toContain("parent_verified_account(p_session_token,p_client_key)");
  }
  expect(parentClient).not.toContain("p_student_account_id");
  expect(body("public.parent_verified_request_private_booking")).toContain("public.request_booking_as_parent");
  expect(body("public.parent_verified_cancel_booking")).toContain("public.cancel_booking_as_parent");
  expect(app).not.toContain("cancelBookingAsParent(booking, parentSession");
  expect(app).not.toContain("updateParentAccount({");
});

test("trusted routing activates only after membership verification and Parent stays on legacy contracts", () => {
  const login = app.slice(app.indexOf("async function loginClub"), app.indexOf("async function loginUnified"));
  expect(login.indexOf('supabase.rpc("app_my_membership")')).toBeLessThan(login.indexOf("activateVerifiedOperator()"));
  expect(login).toContain("if (normalizedIdentifier === clubEmail)");
  expect(login.indexOf("normalizedIdentifier === clubEmail")).toBeLessThan(login.indexOf("signInWithPassword"));
  expect(login).toContain("safeStorageWrite(browserStorage(\"localStorage\"), clubSessionKey, \"true\")");
  expect(context).toContain("let activeTrustedOperator = false");
  expect(store).toContain("isTrustedOperatorContextActive()");
  expect(store).not.toContain("isTrustedOperatorClientEnabled()");
  expect(parentClient).toContain("parentLegacyClientKey()");
  expect(parentClient).not.toContain("isTrustedOperatorContextActive");
  expect(app).toContain("const verifiedState = operatorOnly");
  expect(app).toContain('useState<"parent" | "club">(operatorOnly ? "club" : "parent")');
});

test("generic directory loading starts only after Club auth and trusted mode never subscribes to project_rows", () => {
  const effect = app.slice(app.indexOf('if (!clubAuthenticated || (!legacyClubProof && !isTrustedOperatorContextActive())) return'), app.indexOf("}, [clubAuthenticated, legacyClubProof])"));
  const trustedBranch = effect.slice(effect.indexOf("if (isTrustedOperatorContextActive())"), effect.indexOf("const refreshFromPush"));
  expect(trustedBranch).toContain("window.setInterval(() => void loadAll(), 30_000)");
  expect(trustedBranch).not.toContain('.channel("rswtta-project-rows-push")');
  expect(effect).toContain('.channel("rswtta-project-rows-push")');
  const mount = app.slice(app.indexOf("useEffect(() => {", app.indexOf("function ClubApp")), app.indexOf('if (!clubAuthenticated || (!legacyClubProof'));
  expect(mount).not.toContain('.channel("rswtta-project-rows-push")');
  expect(app.slice(app.indexOf("async function loginParent"), app.indexOf("async function requestPasswordReset"))).not.toContain("loadAll()");
});

test("completed preregistered Parent setup requires the email used by verified dashboard login", () => {
  expect(app).toContain("const contactReady = emailReady && (account.clubPreregistered || phoneReady)");
  expect(app).toContain('copy(language, "Email required", "邮箱（必填）")');
  expect(app).not.toContain('account.clubPreregistered ? "Email optional"');
});

test("TOTP enrollment, challenge, AAL2 verification, recovery, and sign-out are wired", () => {
  for (const api of ["mfa.listFactors()", 'mfa.enroll({ factorType: "totp"', "mfa.challengeAndVerify", "mfa.getAuthenticatorAssuranceLevel()", "auth.signOut()"] ) expect(app).toContain(api);
  expect(app).toContain('assurance.data.currentLevel !== "aal2"');
  expect(app).toContain("Try a fresh code or sign out");
  expect(app).toContain("operatorMfaRequired");
});

test("secure preregistration preserves collision snapshots and sends no shared Club proof", () => {
  const trustedBranch = prereg.slice(prereg.indexOf('? await supabase.rpc("operator_create_student_preregistration"'), prereg.indexOf(': await supabase.rpc("club_preregister_student_v3"'));
  expect(trustedBranch).toContain("p_search_snapshot_hash");
  expect(trustedBranch).toContain("p_duplicate_snapshot_hash");
  expect(trustedBranch).not.toContain("p_club_proof");
  const create = body("public.operator_create_student_preregistration");
  expect(create).toContain("require_operator(true)");
  expect(create).toContain("club_preregistration_proposed_id");
  expect(create).toContain("club_preregistration_temp_credential");
  expect(create).toContain("Idempotency key payload mismatch");
  expect(create).toContain("loginAlias");
});

test("club_admin and coach remain equal permissions with immutable exact identity shape", () => {
  const boundary = readFileSync("supabase/migrations/20260915113000_trusted_application_boundary.sql", "utf8");
  expect(boundary).toContain("(role='club_admin' and coach_id is null) or (role='coach' and coach_id is not null)");
  expect(boundary).toContain("new.role<>old.role or new.coach_id is distinct from old.coach_id");
  expect(body("public.operator_create_student_preregistration")).not.toContain("club_admin");
});
