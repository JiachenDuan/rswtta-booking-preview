import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { expectedGroupOccurrenceRows, isFutureActiveGroupBlock, selectGroupOccurrenceTargets } from "../lib/groupOccurrence";
import { occurrenceId, recurrenceIdentity } from "../lib/recurrence";
import { planClassReportExport } from "../lib/classReport";
import type { Booking } from "../lib/types";

const now = new Date("2026-09-11T12:00:00.000Z");
const firstAt = "2026-09-20T20:00:00.000Z";
const secondAt = "2026-09-27T20:00:00.000Z";
const pastAt = "2026-09-01T20:00:00.000Z";
const seriesId = "series:group-stable";

function booking(id: string, startsAt: string, patch: Partial<Booking> = {}): Booking {
  return {
    id,
    studentAccountId: undefined,
    studentName: "Group class",
    familyName: "Club",
    studentEmail: "",
    phone: "",
    requestedCoach: "Coach Jorden",
    assignedCoach: "Coach Jorden",
    program: "Group class",
    dateLabel: "Sun, Sep 20, 2026",
    timeLabel: "1 PM - 2 PM",
    startsAt,
    priceCents: 0,
    status: "club_confirmed",
    parentNote: "",
    createdAt: startsAt,
    updatedAt: startsAt,
    ...patch
  };
}

function groupOccurrence(blockId: string, startsAt: string, groupClassId: string) {
  const block = booking(blockId, startsAt, { groupClassId, ...recurrenceIdentity(seriesId, startsAt) });
  const enrollment = booking(`${blockId}-enrollment`, startsAt, {
    studentAccountId: `account-${blockId}`,
    studentName: "Alex Kim",
    familyName: "Alex Kim",
    program: "Group enrollment",
    groupClassId,
    seriesId: undefined,
    recurrenceOccurrenceId: undefined,
    recurrenceOriginalStartsAt: undefined
  });
  return [block, enrollment] as const;
}

const [blockA, enrollmentA] = groupOccurrence("block-a", firstAt, "group:a");
const [blockB, enrollmentB] = groupOccurrence("block-b", secondAt, "group:b");


test("single and future scopes use immutable series/original boundaries and complete groupClassId membership", () => {
  const otherSameName = booking("other", secondAt, { groupClassId: "group:other", ...recurrenceIdentity("series:other", secondAt) });
  const rows = [blockA, enrollmentA, blockB, enrollmentB, otherSameName];
  const single = selectGroupOccurrenceTargets(rows, blockA, "single", now);
  expect(single.blocks.map((item) => item.id)).toEqual(["block-a"]);
  expect(single.rows.map((item) => item.id)).toEqual(["block-a", "block-a-enrollment"]);
  const future = selectGroupOccurrenceTargets(rows, blockA, "future", now);
  expect(future.blocks.map((item) => item.id)).toEqual(["block-a", "block-b"]);
  expect(future.rows.map((item) => item.id)).toEqual(["block-a", "block-a-enrollment", "block-b", "block-b-enrollment"]);
  expect(future.rows).not.toContainEqual(otherSameName);
});

test("past, completed, cancelled, malformed, and non-group entities never expose group management", () => {
  expect(isFutureActiveGroupBlock(blockA, now)).toBe(true);
  expect(isFutureActiveGroupBlock(booking("past", pastAt, { groupClassId: "group:past", ...recurrenceIdentity(seriesId, pastAt) }), now)).toBe(false);
  expect(isFutureActiveGroupBlock({ ...blockA, status: "coach_confirmed" }, now)).toBe(false);
  expect(isFutureActiveGroupBlock({ ...blockA, status: "cancelled" }, now)).toBe(false);
  expect(isFutureActiveGroupBlock({ ...blockA, program: "Private lesson", studentName: "Alex Kim" }, now)).toBe(false);
  expect(isFutureActiveGroupBlock(enrollmentA, now)).toBe(false);
  expect(() => selectGroupOccurrenceTargets([blockA], { ...blockA, groupClassId: undefined }, "single", now)).toThrow("identity is incomplete");
});

test("expected membership carries identity and stale-value guards for every block and enrollment", () => {
  const expected = expectedGroupOccurrenceRows([blockA, enrollmentA]);
  expect(expected).toHaveLength(2);
  expect(expected[0]).toMatchObject({
    id: "block-a",
    groupClassId: "group:a",
    seriesId,
    recurrenceOccurrenceId: occurrenceId(seriesId, firstAt),
    recurrenceOriginalStartsAt: firstAt,
    startsAt: firstAt,
    status: "club_confirmed",
    program: "Group class",
    updatedAt: firstAt
  });
  expect(expected[1]).toMatchObject({ id: "block-a-enrollment", groupClassId: "group:a", studentAccountId: "account-block-a" });
});

test("moving group schedule metadata preserves IDs, account links, and billing/CSV source identity", () => {
  const account = { id: "account-block-a", studentName: "Alex Kim", parentName: "", email: "alex@example.test", phone: "", confirmed: true, profileSetupRequired: false, createdAt: firstAt };
  const before = planClassReportExport({ bookings: [{ ...enrollmentA, status: "coach_confirmed" }], accounts: [account], periodStart: new Date("2026-01-01"), periodEnd: new Date("2027-01-01") });
  const moved = { ...enrollmentA, startsAt: "2026-09-20T21:00:00.000Z", dateLabel: "Sun, Sep 20, 2026", timeLabel: "2 PM - 3 PM", status: "coach_confirmed" as const };
  const after = planClassReportExport({ bookings: [moved], accounts: [account], periodStart: new Date("2026-01-01"), periodEnd: new Date("2027-01-01") });
  expect(moved.id).toBe(enrollmentA.id);
  expect(moved.studentAccountId).toBe(enrollmentA.studentAccountId);
  expect({ eligible: after.eligibleSourceCount, linked: after.exportedLinkedCount }).toEqual({ eligible: before.eligibleSourceCount, linked: before.exportedLinkedCount });
  expect(after.linkedBookings[0].id).toBe(before.linkedBookings[0].id);
});

test("one Club-only RPC enforces atomic move/cancel, complete membership, conflicts, stale values, history, and soft cancellation", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911233500_manage_recurring_group_occurrences.sql"), "utf8");
  expect(sql).toContain("create or replace function public.manage_group_occurrences");
  expect(sql).toContain("for update");
  expect(sql).toContain("pg_advisory_xact_lock");
  expect(sql).toContain("Group row count changed");
  expect(sql).toContain("Group row changed while it was being managed");
  expect(sql).toContain("Complete group membership requires exactly one block per occurrence");
  expect(sql).toContain("Past or completed group rows cannot be changed");
  expect(sql).toContain("conflicts with another coach booking or unavailable block");
  expect(sql).toContain("Moved group occurrences overlap each other");
  expect(sql).toContain("jsonb_build_object('status', 'cancelled')");
  expect(sql).not.toMatch(/delete\s+from\s+public\.project_rows/i);
  expect(sql).toContain("group_occurrence_updated");
  expect(sql).toContain("group_occurrence_cancelled");
  expect(sql).toContain("Group management booking-count baseline guard failed: expected 1997");
});

test("four controls are confined to the future active Group class branch and Parent request behavior remains separate", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "components/ClubApp.tsx"), "utf8");
  const groupStart = app.lastIndexOf("if (isGroupClassBlock(booking))");
  const groupBranch = app.slice(groupStart, app.indexOf("\n\n  return (", groupStart));
  for (const label of [
    "Update this group occurrence only",
    "Update this and future occurrences",
    "Cancel this group occurrence only",
    "Cancel this and future occurrences"
  ]) expect(groupBranch).toContain(label);
  expect(groupBranch).toContain("isFutureActiveGroupBlock(booking)");
  expect(groupBranch).toContain("Final cancellation confirmation");
  expect(app).toContain("onManageGroupOccurrence={manageGroupOccurrence}");
  expect(app).toContain("<GroupClassRequestModal");
  expect(app).toContain("<CoachBookingRestrictionNotice");
  expect(app).toContain("TIAN_YE_BOOKING_MESSAGE_EN");
});
