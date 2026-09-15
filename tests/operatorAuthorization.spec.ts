import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20260915113000_trusted_application_boundary.sql", "utf8");
const closure = readFileSync("sql/staged/20260915120000_close_legacy_project_rows.sql", "utf8");
const coachPage = readFileSync("app/coach/page.tsx", "utf8");
const clubClient = readFileSync("components/ClubApp.tsx", "utf8");

function body(name: string) {
  const start = sql.indexOf(`function ${name}`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

test("exactly two labels share one authoritative operator predicate", () => {
  expect(sql).toContain("role text not null check(role in ('club_admin','coach'))");
  expect(sql).not.toContain("require_club_admin");
  for (const fn of [
    "public.operator_list_memberships", "public.operator_request_invitation",
    "public.operator_change_membership_status", "public.operator_request_auth_account_action",
    "public.operator_calendar", "public.operator_project_rows", "public.operator_mutate_project_row",
    "public.operator_set_class_package_opening"
  ]) expect(body(fn)).toContain("rswtta_private.require_operator(");
  expect(body("rswtta_private.require_operator")).toContain("m.role in ('club_admin','coach')");
  expect(body("public.operator_calendar")).not.toContain("v_actor.coach_id");
  expect(coachPage).toContain("All coaches’ sessions are shown");
});

test("every mutation uses auth.uid attribution, immutable actor membership and request id", () => {
  expect(sql).toContain("actor_auth_user_id uuid not null");
  expect(sql).toContain("actor_membership_id uuid not null");
  expect(sql).toContain("actor_role text not null");
  expect(sql).toContain("request_id uuid not null");
  expect(sql).toContain("occurred_at timestamptz not null default clock_timestamp()");
  expect(body("rswtta_private.append_operator_audit")).toContain("auth.uid()");
  expect(sql).toContain("Authorization audit events are immutable");
  expect(sql).toContain("unique(actor_auth_user_id,request_id,action)");
});

test("audit semantics are allowlisted and private values are not persisted", () => {
  const redactor = body("rswtta_private.redact_semantic");
  expect(redactor).toContain("e.key in (");
  for (const forbidden of ["email", "phone", "password", "token", "note", "payment"]) {
    expect(redactor).not.toContain(`'${forbidden}'`);
  }
  expect(sql).toContain("semantic_before jsonb");
  expect(sql).toContain("semantic_after jsonb");
});

test("ineligible and AAL1 actors fail while sensitive mutations require AAL2", () => {
  expect(body("rswtta_private.require_operator")).toContain("Active Club operator membership required");
  expect(body("rswtta_private.require_aal2")).toContain("AAL2 required");
  for (const fn of ["public.operator_request_invitation", "public.operator_change_membership_status", "public.operator_request_auth_account_action", "public.operator_mutate_project_row"]) {
    expect(body(fn)).toContain("rswtta_private.require_operator(true)");
  }
  expect(body("public.operator_calendar")).toContain("rswtta_private.require_operator(false)");
  expect(body("public.operator_set_class_package_opening")).toContain("rswtta_private.require_operator(true)");
  expect(body("public.operator_mutate_project_row")).toContain("Stale project row; reload before changing it");
});

test("concurrency, final-admin, self-lockout and immutable binding guards are database-enforced", () => {
  const guard = body("rswtta_private.guard_project_membership");
  expect(guard).toContain("pg_advisory_xact_lock");
  expect(guard).toContain("Cannot suspend own active membership");
  expect(guard).toContain("Cannot suspend the final active Club Admin");
  expect(guard).toContain("new.auth_user_id<>old.auth_user_id");
  expect(guard).toContain("new.coach_id is distinct from old.coach_id");
  expect(body("public.operator_request_auth_account_action")).toContain("Cannot suspend or delete own sole active membership");
});

test("browser data paths fail closed and closure remains staged", () => {
  expect(sql).toContain("revoke all on public.project_auth_memberships");
  expect(sql).toContain("from public,anon,authenticated");
  expect(sql).toContain("grant execute on function public.operator_accept_invitation");
  expect(clubClient).toContain("isTrustedOperatorClientEnabled()");
  expect(clubClient).toContain("if (!secureOperatorClient) loadAll()");
  expect(clubClient).toContain("secureOperatorClient ? null : supabase");
  expect(closure).toContain("STAGED ONLY — DO NOT APPLY");
  expect(closure).toContain("revoke all on public.projects,public.project_tables,public.project_columns,public.project_members,public.project_rows");
});

test("push recipients remain affected assigned/requested coaches only", () => {
  const fanout = body("rswtta_private.booking_notification_auth_users");
  expect(fanout).toContain("public.booking_coach_assignments");
  expect(fanout).toContain("a.assignment_kind in ('assigned','requested')");
  expect(fanout).not.toContain("m.role='club_admin'");
});
