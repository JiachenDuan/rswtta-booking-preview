import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeCoachProfile, normalizeCoachSchedule, partitionCoachSchedule } from "../lib/coachAuth/data";

const actions = readFileSync("app/coach/actions.ts", "utf8");
const config = readFileSync("lib/coachAuth/config.ts", "utf8");
const server = readFileSync("lib/coachAuth/server.ts", "utf8");
const page = readFileSync("app/coach/page.tsx", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260915102000_coach_auth_foundation.sql", "utf8");

 test("Club operator activation works during dual-auth rollout and uses SSR cookies", () => {
  expect(actions).toContain('if (!isOperatorAuthEnabled())');
  expect(config).toContain('isCoachAuthEnabled() || process.env.NEXT_PUBLIC_TRUSTED_OPERATOR_AUTH_ENABLED !== "false"');
  expect(config).toContain("VERCEL_PROJECT_PRODUCTION_URL");
  expect(server).toContain('createServerClient');
  expect(server).toContain('cookies()');
  expect(server).not.toContain("localStorage");
  expect(actions).not.toContain("service_role");
  expect(proxy).toContain('matcher: ["/coach/:path*"]');
  expect(proxy).toContain("await supabase.auth.getUser()");
  expect(actions).toContain('redirect("/club")');
 });

 test("Operator shell reads equal-permission RPC projections", () => {
  expect(page).toContain('supabase.rpc("app_my_membership")');
  expect(page).toContain('supabase.rpc("operator_calendar")');
  expect(actions).toContain('supabase.rpc("operator_accept_invitation",');
  expect(page).toContain("Operator access is not active");
  expect(page).toContain("profileRows.length !== 1");
 });

 test("Coach SQL boundary derives identity from auth.uid and denies browser tables", () => {
  expect(migration).toContain("auth.uid()");
  expect(migration).toContain("public.booking_coach_assignments");
  expect(migration).toContain("revoke all on public.coaches,public.project_coach_memberships,public.coach_auth_audit_events,public.booking_coach_assignments from public,anon,authenticated");
  expect(migration).toContain("grant execute on function public.coach_accept_invitation(),public.coach_my_profile(),public.coach_my_schedule(integer) to authenticated");
  expect(migration).toContain("Coach identity is immutable");
  expect(migration).not.toContain("values->>'studentEmail'");
  expect(migration).not.toContain("values->>'phone'");
  expect(migration).not.toContain("values->>'parentNote'");
 });

 test("schedule normalization allowlists display fields and partitions time", () => {
  const items = normalizeCoachSchedule([
    { starts_at: "2026-09-16T10:00:00Z", ends_at: "2026-09-16T11:00:00Z", student_name: "A", class_name: "Private", parent_email: "secret@example.com", booking_id: "private-id" },
    { starts_at: "2026-09-14T10:00:00Z", student_name: "B" },
    { starts_at: "not-a-date", student_name: "discard" }
  ]);
  expect(items).toHaveLength(2);
  expect(items[0]).not.toHaveProperty("parent_email");
  expect(items[0]).not.toHaveProperty("booking_id");
  const partitioned = partitionCoachSchedule(items, new Date("2026-09-15T00:00:00Z"));
  expect(partitioned.upcoming).toHaveLength(1);
  expect(partitioned.past).toHaveLength(1);
 });

 test("profile normalization exposes only Coach identity", () => {
  expect(normalizeCoachProfile({ display_name: "Coach Li", phone: "555", role: "club_admin" }, "li@example.com"))
    .toEqual({ displayName: "Coach Li", email: "li@example.com", role: "Club Admin" });
 });
