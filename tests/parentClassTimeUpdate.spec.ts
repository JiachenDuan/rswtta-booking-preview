import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  canParentUpdateClassTime,
  isParentPrivateOccurrence,
  isValidParentClassTimeTarget,
  parentClassDurationMinutes,
  parentClassTimeResultStatus
} from "../lib/parentClassTime";
import type { Booking, BookingStatus } from "../lib/types";

const app = readFileSync("components/ClubApp.tsx", "utf8");
const client = readFileSync("lib/parentClassTimeClient.ts", "utf8");
const sessionClient = readFileSync("lib/parentLegacySession.ts", "utf8");
const sql = readFileSync("supabase/migrations/20260913203000_stage_verified_parent_class_time_update.sql", "utf8");
const acceptanceSql = readFileSync("sql/verification/20260913203000_stage_verified_parent_class_time_update.acceptance.sql", "utf8");
const audit = JSON.parse(readFileSync("artifacts/parent-update-class-time/production-readonly-audit-20260914T061312Z.json", "utf8"));
const now = Date.parse("2026-09-13T20:00:00.000Z");

function booking(input: Partial<Booking> = {}): Booking {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    studentAccountId: "00000000-0000-4000-8000-000000000002",
    studentName: "Student",
    familyName: "Student",
    studentEmail: "",
    phone: "",
    requestedCoach: "National A",
    assignedCoach: "National A",
    program: "Private lesson",
    dateLabel: "Mon, Sep 14, 2026",
    timeLabel: "9 AM - 10 AM",
    startsAt: "2026-09-14T16:00:00.000Z",
    priceCents: 10000,
    status: "club_confirmed",
    parentNote: "existing history",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-13T19:00:00.000Z",
    ...input
  };
}

test("current and target cutoffs are strictly greater than server now plus 12 hours", () => {
  expect(canParentUpdateClassTime(booking({ startsAt: new Date(now + 12 * 60 * 60 * 1000).toISOString() }), now)).toBe(false);
  expect(canParentUpdateClassTime(booking({ startsAt: new Date(now + 12 * 60 * 60 * 1000 + 1).toISOString() }), now)).toBe(true);
  expect(isValidParentClassTimeTarget(new Date(now + 12 * 60 * 60 * 1000).toISOString(), 60, now)).toBe(false);
  expect(isValidParentClassTimeTarget("2026-09-14T08:30:00.000Z", 60, now)).toBe(true);
  expect(sql.match(/<=v_now\+interval '12 hours'/g)).toHaveLength(2);
});

test("past, current, completed, and cancelled occurrences are excluded", () => {
  for (const startsAt of [new Date(now - 1).toISOString(), new Date(now).toISOString()]) expect(canParentUpdateClassTime(booking({ startsAt }), now)).toBe(false);
  for (const status of ["coach_confirmed", "cancelled"] as BookingStatus[]) expect(canParentUpdateClassTime(booking({ status }), now)).toBe(false);
  expect(sql).toContain("not in ('requested','change_requested','club_confirmed')");
});

test("only a persisted private occurrence with account identity is eligible", () => {
  expect(isParentPrivateOccurrence(booking())).toBe(true);
  for (const program of ["Group class", "Group enrollment", "Unavailable"]) expect(isParentPrivateOccurrence(booking({ program }))).toBe(false);
  expect(isParentPrivateOccurrence(booking({ program: "Group lesson" }))).toBe(true);
  expect(isParentPrivateOccurrence(booking({ program: "Group lesson", parentNote: "Parent requested to join group class." }))).toBe(false);
  expect(isParentPrivateOccurrence(booking({ id: "virtual-occurrence" }))).toBe(false);
  expect(isParentPrivateOccurrence(booking({ studentAccountId: undefined }))).toBe(false);
  expect(sql).toContain("v_selected.values->>'program' not in ('Private lesson','Group lesson')");
  expect(sql).toContain("coalesce(v_selected.values->>'groupClassId','')<>''");
});

test("server derives Parent ownership and same-name accounts confer no authority", () => {
  expect(sql).toContain("valid_parent_legacy_session(p_session_token,p_client_key)");
  expect(sql).toContain("select session_id,account_id into strict v_session,v_account");
  expect(sql).toContain("v_selected.values->>'studentAccountId'<>v_account::text");
  expect(sql).not.toMatch(/studentName[^\n]*=p_/);
  expect(client).not.toContain("p_student_account_id");
  expect(client).not.toContain("p_account_id");
});

test("one-off and recurring selected occurrences preserve identity and never shift a series", () => {
  expect(sql).toContain("p_selected_booking_id");
  expect(sql).not.toMatch(/where[^;]*seriesId[^;]*update/i);
  expect(sql).toContain("coalesce(v_selected.values->>'seriesId','')<>coalesce(p_expected_series_id,'')");
  expect(sql).toContain("coalesce(v_selected.values->>'recurrenceOccurrenceId','')<>coalesce(p_expected_occurrence_id,'')");
  expect(sql).toContain("coalesce(nullif(v_selected.values->>'recurrenceOriginalStartsAt','')::timestamptz,'epoch'::timestamptz)<>coalesce(p_expected_original_starts_at,'epoch'::timestamptz)");
  const updatedObject = sql.slice(sql.indexOf("update public.project_rows set values=values||jsonb_build_object("), sql.indexOf("where id=p_selected_booking_id"));
  expect(updatedObject).not.toContain("seriesId");
  expect(updatedObject).not.toContain("recurrenceOccurrenceId");
  expect(updatedObject).not.toContain("recurrenceOriginalStartsAt");
});

test("duration is preserved and valid in 30-minute increments", () => {
  expect(parentClassDurationMinutes(booking())).toBe(60);
  expect(parentClassDurationMinutes(booking({ timeLabel: "9 AM - 10:30 AM" }))).toBe(90);
  expect(isValidParentClassTimeTarget("2026-09-14T09:00:00.000Z", 45, now)).toBe(false);
  expect(sql).toContain("v_target_end:=p_target_starts_at+v_duration");
  expect(sql).toContain("mod(extract(epoch from v_duration)::integer,1800)<>0");
});

test("confirmed updates become change_requested while pending states are preserved", () => {
  expect(parentClassTimeResultStatus("club_confirmed")).toBe("change_requested");
  expect(parentClassTimeResultStatus("requested")).toBe("requested");
  expect(parentClassTimeResultStatus("change_requested")).toBe("change_requested");
  expect(sql).toContain("case when v_selected.values->>'status'='club_confirmed' then 'change_requested' else v_selected.values->>'status' end");
  expect(client).not.toContain("p_new_status");
  expect(client).not.toContain("priceCents");
});

test("coach unavailable and student overlap are checked under deterministic locks", () => {
  expect(sql).toContain("parent-time:coach:");
  expect(sql).toContain("order by r.id for update");
  expect(sql).toContain("rswtta_canonical_coach_id");
  expect(sql).toContain("r.values->>'studentAccountId'=v_account::text");
  expect(sql).toContain("rswtta_booking_ends_at(r.values)>p_target_starts_at");
});

test("stale snapshots, mismatched idempotency replays, races, and failures abort atomically", () => {
  for (const field of ["updated_at", "status", "startsAt", "seriesId", "recurrenceOccurrenceId", "recurrenceOriginalStartsAt"]) expect(sql).toContain(field);
  expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('parent-time-idempotency:'");
  expect(sql).toContain("Idempotency key was reused for a different class-time update");
  expect(sql).toContain("return v_existing.result||jsonb_build_object('replayed',true)");
  expect(sql).toContain("begin;");
  expect(sql).toContain("return v_result;");
  expect(sql.trim().startsWith("-- PRODUCTION ROLLOUT")).toBe(true);
  expect(sql.trim().endsWith("commit;")).toBe(true);
});

test("one redacted activity row is in the same transaction and package/billing state is untouched", () => {
  const activityInserts = sql.match(/insert into public\.project_rows\(project_table_id,values\) values\(v_activity/g) ?? [];
  expect(activityInserts).toHaveLength(1);
  expect(sql).toContain("'studentName',''");
  expect(sql).toContain("'packageDeduction',false");
  const activityObject = sql.slice(sql.indexOf("'action','parent_class_time_updated'"), sql.indexOf("v_result:=rswtta_private.parent_legacy_dashboard"));
  expect(activityObject).not.toContain("'seriesId'");
  expect(activityObject).not.toContain("'recurrenceOccurrenceId'");
  expect(activityObject).not.toContain("'recurrenceOriginalStartsAt'");
  expect(acceptanceSql).toContain("recurring update activity violated no-recurrence-identity convention");
  expect(acceptanceSql).toContain("selected recurring occurrence identity shifted");
  expect(acceptanceSql).toContain("incomplete recurrence tuple failure was not atomic");
  const mutationBody = sql.slice(sql.indexOf("create function public.parent_update_booking_time"), sql.indexOf("revoke all on function public.parent_legacy_session_login"));
  expect(mutationBody).not.toContain("class_package_events");
  expect(mutationBody).not.toContain("bill_notifications");
  expect(mutationBody).not.toMatch(/delete from public\.project_rows/);
});

test("client and staged SQL use the exact same narrow RPC argument contract", () => {
  const declaration = /create function public\.parent_update_booking_time\s*\(([\s\S]*?)\) returns/i.exec(sql)?.[1] ?? "";
  const sqlArgs = [...declaration.matchAll(/\b(p_[a-z0-9_]+)\s+[a-z]/gi)].map((match) => match[1]).sort();
  const call = /supabase\.rpc\("parent_update_booking_time",\s*\{([\s\S]*?)\n  \}\)/.exec(client)?.[1] ?? "";
  const clientArgs = [...call.matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map((match) => match[1]).sort();
  expect(clientArgs).toEqual(sqlArgs);
  expect(clientArgs).toHaveLength(14);
});

test("the new path uses a narrow opaque legacy session while honestly retaining the accepted direct-write baseline", () => {
  expect(sql).toContain("legacy path can bypass this RPC");
  expect(sql).toContain("parent_legacy_sessions");
  expect(sql).toContain("credential_fingerprint");
  expect(sql).toContain("profileSetupRequired");
  expect(sql).toContain("grant execute on function public.parent_update_booking_time");
  expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+(table\s+)?public\.project_rows/i);
  expect(client).toContain("p_session_token");
  expect(client).toContain("p_client_key");
  expect(client).not.toContain("localStorage");
  expect(sessionClient).toContain("sessionStorage");
  expect(sessionClient).not.toContain("localStorage");
});

test("rolled-back Parent class-time UI remains absent without weakening existing class actions", () => {
  const modal = app.slice(app.indexOf("function ParentClassActionModal"), app.indexOf("function BookingList"));
  expect(modal).toContain('"Class actions", "课程操作"');
  expect(modal).toContain('"Cancel class", "取消课程"');
  expect(modal).toContain('"Mark complete", "标记完成"');
  expect(modal).toContain("parentCancellationWarning(cancellationBlockReason, language)");
  expect(modal).not.toContain("Update class time");
  expect(modal).not.toContain("更新课程时间");
  expect(modal).not.toContain("onUpdateTime");
  expect(modal).not.toContain("setStage");
  expect(app).not.toContain("updateParentOccurrenceTime");
  expect(app).not.toContain("parentClassTimeEnabled");
});

test("fresh timestamped audit is exhaustive, internally exact, redacted, and production read-only", () => {
  expect(audit.auditKind).toBe("parent-update-class-time-production-readonly-refresh");
  expect(Date.parse(audit.generatedAt)).toBeGreaterThan(Date.parse("2026-09-14T00:00:00.000Z"));
  expect(Date.parse(audit.productionServerNow)).toBeGreaterThan(0);
  expect(Object.keys(audit.tables).sort()).toEqual(["activity_logs", "bill_notifications", "bookings", "parent_accounts"]);
  for (const table of Object.values(audit.tables) as Array<{ pages: Array<{ from: number; to: number; returned: number }>; rowCount: number; uniqueIdCount: number; rowIds: string[]; orderedIdSha256: string; canonicalRowSha256: string }>) {
    expect(table.rowCount).toBe(table.uniqueIdCount);
    expect(table.pages.reduce((sum, page) => sum + page.returned, 0)).toBe(table.rowCount);
    expect(table.rowIds).toHaveLength(table.rowCount);
    expect(new Set(table.rowIds).size).toBe(table.rowCount);
    expect([...table.rowIds].sort()).toEqual(table.rowIds);
    expect(table.pages.at(-1)?.returned).toBeLessThan(500);
    expect(table.pages.every((page, index) => page.from === index * 500 && page.to === index * 500 + 499 && page.returned <= 500)).toBe(true);
    expect(table.orderedIdSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(table.canonicalRowSha256).toMatch(/^[0-9a-f]{64}$/);
  }
  expect(audit.tables.bookings.rowCount).toBeGreaterThan(0);
  expect(audit.tables.parent_accounts.rowCount).toBeGreaterThan(0);
  expect(audit.bookingSummary.eligibleSelectedOccurrenceIds).toHaveLength(audit.bookingSummary.eligibleSelectedOccurrenceCount);
  expect(new Set(audit.bookingSummary.eligibleSelectedOccurrenceIds).size).toBe(audit.bookingSummary.eligibleSelectedOccurrenceCount);
  expect(audit.bookingSummary.eligibleSelectedOccurrenceIds.every((id: string) => audit.tables.bookings.rowIds.includes(id))).toBe(true);
  expect(audit.safety).toEqual({ httpMethods: ["GET"], productionRowMutations: 0, deployments: 0 });
  expect(audit.redaction).toContain("No row values");
});
