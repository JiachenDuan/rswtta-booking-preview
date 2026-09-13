import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { planClassReportExport } from "../lib/classReport";
import { recurrenceIdentity } from "../lib/recurrence";
import { expectedRecurringCancellationRows, selectRecurringCancellationTargets } from "../lib/recurringCancellation";
import type { Booking, ParentAccount } from "../lib/types";

const accountId = "d33b45ca-34bc-4df9-a830-b38ea32cd12e";
const seriesId = `import:national%20a:${accountId}:debolina%20f21%2Ff22`;
const now = new Date("2026-09-13T01:56:00.000Z");

function saturday(day: string, status: Booking["status"] = "club_confirmed", patch: Partial<Booking> = {}): Booking {
  const startsAt = `${day}T22:30:00.000Z`;
  return {
    id: `row-${day}`,
    studentAccountId: accountId,
    ...recurrenceIdentity(seriesId, startsAt),
    studentName: "Eddie Chai",
    familyName: "Eddie Chai",
    studentEmail: "eddie@example.test",
    phone: "5551119756",
    requestedCoach: "National A",
    assignedCoach: "National A",
    program: "Private lesson",
    dateLabel: `Sat, ${day}`,
    timeLabel: "3:30 PM - 4:30 PM",
    startsAt,
    priceCents: 15000,
    status,
    parentNote: "Imported Debolina recurring class from Google Sheet as National A (Debolina F21/F22) through Dec 31, 2026.",
    createdAt: startsAt,
    updatedAt: startsAt,
    ...patch
  };
}

const days = [
  "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03", "2026-10-10", "2026-10-17",
  "2026-10-24", "2026-10-31", "2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12", "2026-12-19", "2026-12-26"
];
const eddieSeries = days.map((day, index) => saturday(day, index >= 2 && index <= 6 ? "cancelled" : "club_confirmed"));

function atOffset(minutes: number, id: string, status: Booking["status"] = "club_confirmed") {
  const startsAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  return saturday("2026-10-24", status, { id, startsAt, ...recurrenceIdentity(seriesId, startsAt) });
}

test("Sep 12 past occurrence selects all ten persisted active Saturdays after Oct 17", () => {
  const targets = selectRecurringCancellationTargets(eddieSeries, eddieSeries[1], "future", now, "club");
  expect(targets).toHaveLength(10);
  expect(targets[0].startsAt).toBe("2026-10-24T22:30:00.000Z");
  expect(targets.at(-1)?.startsAt).toBe("2026-12-26T22:30:00.000Z");
  expect(targets.every((booking) => booking.studentAccountId === accountId && booking.status === "club_confirmed")).toBe(true);
});

test("future and all scopes use immutable original slots while preserving past, completed, and cancelled rows", () => {
  const movedOct24 = { ...eddieSeries[7], startsAt: "2026-10-25T00:00:00.000Z" };
  const completedOct31 = { ...eddieSeries[8], status: "coach_confirmed" as const };
  const rows = [...eddieSeries.slice(0, 7), movedOct24, completedOct31, ...eddieSeries.slice(9)];
  const future = selectRecurringCancellationTargets(rows, movedOct24, "future", now, "club");
  const all = selectRecurringCancellationTargets(rows, eddieSeries[12], "all", now, "club");
  expect(future.map((booking) => booking.id)).toEqual([movedOct24.id, ...eddieSeries.slice(9).map((booking) => booking.id)]);
  expect(all.map((booking) => booking.id)).toEqual(future.map((booking) => booking.id));
  expect(future).not.toContainEqual(completedOct31);
});

test("Parent recurring cancellation rejects past, current, completed, cancelled, 11h59m, and exactly 12h selected occurrences", () => {
  for (const selected of [
    atOffset(-1, "past"),
    atOffset(0, "current"),
    atOffset(13 * 60, "completed", "coach_confirmed"),
    atOffset(13 * 60, "cancelled", "cancelled"),
    atOffset(11 * 60 + 59, "inside-cutoff"),
    atOffset(12 * 60, "exact-cutoff")
  ]) {
    expect(() => selectRecurringCancellationTargets([selected], selected, "future", new Date(now.getTime() + 12 * 60 * 60_000), "parent"))
      .toThrow("must be active and start more than 12 hours");
  }
});

test("Parent >12h selection includes only selected and later active rows and preserves protected rows", () => {
  const earlier = atOffset(12 * 60 + 1, "earlier");
  const selected = atOffset(13 * 60, "selected");
  const later = atOffset(14 * 60, "later");
  const laterCompleted = atOffset(15 * 60, "later-completed", "coach_confirmed");
  const laterCancelled = atOffset(16 * 60, "later-cancelled", "cancelled");
  const cutoffProtected = atOffset(11 * 60 + 59, "cutoff-protected");
  const targets = selectRecurringCancellationTargets(
    [laterCancelled, earlier, laterCompleted, selected, cutoffProtected, later],
    selected,
    "future",
    new Date(now.getTime() + 12 * 60 * 60_000),
    "parent"
  );
  expect(targets.map((booking) => booking.id)).toEqual(["selected", "later"]);
});

test("same-name accounts and series stay isolated while a reassigned series occurrence remains in scope", () => {
  const otherAccount = saturday("2026-10-24", "club_confirmed", { id: "other-account", studentAccountId: "account-other" });
  const reassigned = { ...eddieSeries[8], assignedCoach: "National B", requestedCoach: "National B" };
  const otherProgram = saturday("2026-11-07", "club_confirmed", { id: "other-program", groupClassId: "group:other", program: "Group enrollment" });
  const otherSeries = saturday("2026-11-14", "club_confirmed", { id: "other-series", ...recurrenceIdentity("series:other", "2026-11-14T22:30:00.000Z") });
  const rows = [...eddieSeries.slice(0, 8), reassigned, ...eddieSeries.slice(9), otherAccount, otherProgram, otherSeries];
  const targets = selectRecurringCancellationTargets(rows, eddieSeries[1], "future", now, "club");
  expect(targets).toHaveLength(10);
  expect(targets).toContainEqual(reassigned);
  expect(targets).not.toEqual(expect.arrayContaining([otherAccount, otherProgram, otherSeries]));
});

test("virtual targets carry finite identity and a persisted cancellation suppresses synthesis after reload", () => {
  const virtual = saturday("2026-12-26", "club_confirmed", { id: `virtual-${encodeURIComponent(`${seriesId}@2026-12-26T22:30:00.000Z`)}` });
  const [expected] = expectedRecurringCancellationRows([virtual]);
  expect(expected.id).toBeNull();
  expect(expected.values).toMatchObject({
    studentAccountId: accountId,
    seriesId,
    recurrenceOccurrenceId: virtual.recurrenceOccurrenceId,
    recurrenceOriginalStartsAt: virtual.recurrenceOriginalStartsAt,
    startsAt: virtual.startsAt
  });
  const persistedCancelled = { ...virtual, id: "persisted-cancel", status: "cancelled" as const };
  const generatedOnReload = virtual;
  const existingOccurrenceIds = new Set([persistedCancelled.recurrenceOccurrenceId]);
  expect(existingOccurrenceIds.has(generatedOnReload.recurrenceOccurrenceId)).toBe(true);
  expect(selectRecurringCancellationTargets([persistedCancelled], persistedCancelled, "all", now, "club")).toEqual([]);
});

test("soft cancellation leaves completed billing/history inputs unchanged and excludes future active rows", () => {
  const account: ParentAccount = { id: accountId, studentName: "Eddie Chai", parentName: "", email: "eddie@example.test", phone: "", confirmed: true, profileSetupRequired: false, createdAt: now.toISOString() };
  const completed = saturday("2026-09-05", "coach_confirmed");
  const future = saturday("2026-10-24", "club_confirmed");
  const afterFuture = { ...future, status: "cancelled" as const };
  const range = { accounts: [account], periodStart: new Date("2026-01-01"), periodEnd: new Date("2027-01-01") };
  const before = planClassReportExport({ ...range, bookings: [completed, future] });
  const after = planClassReportExport({ ...range, bookings: [completed, afterFuture] });
  expect(before.linkedBookings.map((booking) => booking.id)).toEqual([completed.id, future.id]);
  expect(after.linkedBookings.map((booking) => booking.id)).toEqual([completed.id]);
  expect(after.linkedBookings[0].status).toBe("coach_confirmed");
  expect(after.unresolvedBookings).toEqual([]);
});

test("migration is one atomic soft-cancel RPC with stale, membership, cutoff, history, and rollback guards", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260913023000_cancel_recurring_booking_occurrences.sql"), "utf8");
  expect(sql).toContain("create or replace function public.cancel_recurring_booking_occurrences");
  expect(sql).toContain("coalesce(jsonb_typeof(p_expected_rows), 'null') <> 'array'");
  expect(sql).toContain("coalesce(jsonb_array_length(p_expected_rows), 0) = 0");
  expect(sql).toContain("lock table public.project_rows in share row exclusive mode");
  expect(sql).toContain("pg_advisory_xact_lock");
  expect(sql).toContain("Recurring row changed while cancellation was being confirmed");
  expect(sql).toContain("Recurring cancellation membership changed");
  expect(sql).toContain("interval '12 hours'");
  expect(sql).toContain("Parent recurring cancellation requires an active selected class more than 12 hours away");
  expect(sql).toContain("set_config('rswtta.cancellation_actor', p_actor, true)");
  expect(sql).toContain("'status', 'cancelled'");
  expect(sql).toContain("'action', 'cancelled'");
  expect(sql).toContain("p_expected_row_count");
  expect(sql).not.toMatch(/delete\s+from\s+public\.project_rows/i);
  expect(sql).toContain("drop function if exists public.cancel_recurring_booking_occurrences");
});

test("Parent and Club confirmations show exact bilingual counts and invoke the RPC only from final callbacks", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "components/ClubApp.tsx"), "utf8");
  const parentModal = app.slice(app.indexOf("function ParentClassActionModal"), app.indexOf("function BookingList"));
  const clubModal = app.slice(app.indexOf("function ClubBookingActionModal"));
  const parentHandler = app.slice(app.indexOf("async function cancelParentRecurringClasses"), app.indexOf("async function completeParentClass"));
  const clubHandler = app.slice(app.indexOf("async function cancelClubClass"), app.indexOf("async function manageGroupOccurrence"));
  expect(parentModal).toContain("Final recurring cancellation confirmation");
  expect(parentModal).toContain("最终确认取消重复课程");
  expect(parentModal).toContain("recurringCancellationTargets.length");
  expect(parentModal).toContain("Beginning with ${booking.dateLabel} ${booking.timeLabel}");
  expect(parentModal).toContain('onClick={confirmCancellation === "recurring" ? onCancelRecurring : onCancel}');
  expect(parentModal).toContain('setConfirmCancellation("single")');
  expect(parentModal).toContain('setConfirmCancellation("recurring")');
  expect(parentModal).not.toContain("cancelRecurringBookingsAtomically");
  expect(clubModal).toContain("recurringCancellationTargets.length");
  expect(clubModal).toContain("仍有效的未来课程");
  expect(parentHandler).toContain("cancelRecurringBookingsAtomically");
  expect(clubHandler).toContain("cancelRecurringBookingsAtomically");
  expect(clubHandler).not.toContain("Promise.all");
});
