import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20260915113000_trusted_application_boundary.sql", "utf8");
const closure = readFileSync("sql/staged/20260915120000_close_legacy_project_rows.sql", "utf8");
const coachPage = readFileSync("app/coach/page.tsx", "utf8");
const clubClient = readFileSync("components/ClubApp.tsx", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const preregistration = readFileSync("lib/clubPreregistration.ts", "utf8");
const clubRoute = readFileSync("app/club/page.tsx", "utf8");
const parentRoute = readFileSync("app/parent/page.tsx", "utf8");
const operatorConfig = readFileSync("lib/coachAuth/config.ts", "utf8");

function body(name: string) {
  const start = sql.indexOf(`function ${name}`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start));
}

test("exactly two labels share one complete operator predicate and shape", () => {
  expect(sql).toContain("role text not null check(role in ('club_admin','coach'))");
  expect(sql).toContain("(role='club_admin' and coach_id is null) or (role='coach' and coach_id is not null)");
  expect(sql).not.toContain("require_club_admin");
  for (const fn of ["public.operator_list_memberships", "public.operator_request_invitation", "public.operator_change_membership_status", "public.operator_request_auth_account_action", "public.operator_calendar", "public.operator_list_bookings", "public.operator_create_booking", "public.operator_update_booking", "public.operator_cancel_booking", "public.operator_set_class_package_opening"]) {
    expect(body(fn)).toContain("rswtta_private.require_operator(");
  }
  expect(body("rswtta_private.require_operator")).toContain("m.role in ('club_admin','coach')");
  expect(body("public.app_my_membership")).toContain("display_name text,email text");
  expect(coachPage).toContain("All coaches’ sessions are shown");
});

test("parent account projection is explicit and never returns credential fields", () => {
  expect(sql).not.toContain("operator_project_rows");
  expect(sql).not.toContain("operator_mutate_project_row");
  const projection = body("public.operator_list_parent_accounts");
  for (const field of ["studentName", "parentName", "email", "phone", "confirmed", "profileSetupRequired"]) expect(projection).toContain(`'${field}'`);
  for (const secret of ["passwordHash", "passwordSalt", "confirmationCode", "credentialVersion"]) expect(projection).not.toContain(secret);
  expect(store).toContain('parent_accounts: "operator_list_parent_accounts"');
});

test("secure store has purpose-specific RPCs and no local fallback", () => {
  expect(store).toContain("if (isTrustedOperatorClientEnabled() || shouldSkipLocalFallback(error)) throw error");
  for (const rpc of ["operator_create_booking", "operator_update_booking", "operator_cancel_booking", "operator_reschedule_booking_occurrences", "operator_manage_group_occurrences", "operator_add_student_to_group_occurrences", "operator_create_bill_notification", "operator_create_activity_log", "operator_set_class_package_opening"]) expect(store).toContain(rpc);
  expect(preregistration).toContain("operator_search_students");
  expect(preregistration).toContain("operator_preview_student_preregistration");
  expect(preregistration).toContain("no legacy shared credential was sent");
});

test("auth.uid audit, AAL2, immutable history and lockout are enforced", () => {
  expect(body("rswtta_private.append_operator_audit")).toContain("auth.uid()");
  expect(body("rswtta_private.require_aal2")).toContain("AAL2 required");
  expect(sql).toContain("Authorization audit events are immutable");
  expect(sql).toContain("unique(actor_auth_user_id,request_id,action)");
  expect(body("rswtta_private.guard_project_membership")).toContain("pg_advisory_xact_lock");
  expect(body("rswtta_private.guard_project_membership")).toContain("Cannot suspend own active membership");
  expect(body("rswtta_private.guard_project_membership")).toContain("Cannot suspend the final active Club Admin");
  for (const fn of ["public.operator_create_booking", "public.operator_update_booking", "public.operator_cancel_booking", "public.operator_change_membership_status", "public.operator_request_auth_account_action"]) expect(body(fn)).toContain("require_operator(true)");
});

test("unauthenticated and stale legacy mounts never preload or subscribe", () => {
  expect(clubClient).not.toContain("if (!secureOperatorClient) loadAll()");
  expect(clubClient).toContain("A legacy boolean is not authentication proof");
  expect(clubClient).toContain("if (storedClub.value === \"true\") safeStorageRemove");
  expect(clubClient).toContain("secureOperatorClient ? null : supabase");
  expect(clubClient).toContain("supabase.auth.getSession()");
  expect(clubClient).toContain("supabase.auth.signInWithPassword");
  expect(clubClient).toContain("supabase.auth.signOut");
  expect(clubRoute).toContain("<ClubApp operatorOnly />");
  expect(parentRoute).toContain("<ClubApp />");
  expect(operatorConfig).toContain('window.location.pathname === "/club"');
  expect(operatorConfig).toContain('typeof window !== "undefined"');
});

test("closure is staged, catalog-specific, and targets replacement contracts", () => {
  expect(closure).toContain("STAGED ONLY — DO NOT APPLY");
  expect(closure).toContain("reschedule_booking_occurrences(jsonb,text,text,text)");
  expect(closure).toContain("manage_group_occurrences(uuid,text,text,text,text,text,text,integer,integer,jsonb,text,text,text)");
  expect(closure).toContain("add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)");
  expect(closure).toContain("public.operator_list_bookings(integer)");
  expect(closure).not.toContain("operator_project_rows");
});

test("push recipients remain affected assigned/requested coaches only", () => {
  const fanout = body("rswtta_private.booking_notification_auth_users");
  expect(fanout).toContain("public.booking_coach_assignments");
  expect(fanout).toContain("a.assignment_kind in ('assigned','requested')");
  expect(fanout).not.toContain("m.role='club_admin'");
});
