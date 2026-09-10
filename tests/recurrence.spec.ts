import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  legacyImportedSeriesId,
  occurrenceId,
  planRecurringReschedule,
  recurrenceIdentity,
  stableBookingEntityId,
  withDerivedRecurringIdentity
} from "../lib/recurrence";
import { planClassReportExport, serializeCsvRows } from "../lib/classReport";
import type { Booking } from "../lib/types";

function booking(id: string, startsAt: string, patch: Partial<Booking> = {}): Booking {
  return {
    id,
    studentAccountId: "account-a",
    studentName: "Sam Lee",
    familyName: "Sam Lee",
    studentEmail: "sam@example.test",
    phone: "5551112222",
    requestedCoach: "Coach Tian Ye",
    assignedCoach: "Coach Tian Ye",
    program: "Private lesson",
    dateLabel: "Thu, Sep 10, 2026",
    timeLabel: "4 PM - 5 PM",
    startsAt,
    priceCents: 15000,
    status: "club_confirmed",
    parentNote: "",
    createdAt: startsAt,
    updatedAt: startsAt,
    ...patch
  };
}

const firstAt = "2026-09-10T23:00:00.000Z";
const secondAt = "2026-09-17T23:00:00.000Z";
const thirdAt = "2026-09-24T23:00:00.000Z";
const seriesId = "series:stable";
const recurring = [firstAt, secondAt, thirdAt].map((startsAt, index) => booking(`row-${index}`, startsAt, recurrenceIdentity(seriesId, startsAt)));

test("persisted recurring occurrence keeps immutable UI identity when moved", () => {
  const movedAt = "2026-09-11T01:00:00.000Z";
  const [change] = planRecurringReschedule(recurring, recurring[0], movedAt, "single");
  expect(change.id).toBe("row-0");
  expect(change.values.studentAccountId).toBe("account-a");
  expect(change.values.recurrenceOccurrenceId).toBe(occurrenceId(seriesId, firstAt));
  expect(stableBookingEntityId(change.values)).toBe(stableBookingEntityId(recurring[0]));
  expect(change.newStartsAt).toBe(movedAt);
  expect(recurring[1].startsAt).toBe(secondAt);
});

test("virtual recurring occurrence materializes without changing occurrence identity", () => {
  const virtual = booking(`virtual-${encodeURIComponent(occurrenceId(seriesId, firstAt))}`, firstAt, recurrenceIdentity(seriesId, firstAt));
  const [change] = planRecurringReschedule([virtual], virtual, "2026-09-11T00:00:00.000Z", "single");
  expect(change.id).toBeUndefined();
  expect(change.values.recurrenceOriginalStartsAt).toBe(firstAt);
  expect(change.values.recurrenceOccurrenceId).toBe(occurrenceId(seriesId, firstAt));
});

test("ordinary one-off reschedules only itself", () => {
  const oneOff = booking("one-off", firstAt);
  const sameStudent = booking("other", secondAt);
  const changes = planRecurringReschedule([oneOff, sameStudent], oneOff, "2026-09-11T00:30:00.000Z", "all");
  expect(changes.map((item) => item.id)).toEqual(["one-off"]);
  expect(changes[0].values.seriesId).toBeUndefined();
});

test("same-name students remain isolated by series and account IDs", () => {
  const other = booking("same-name-other", secondAt, { studentAccountId: "account-b", ...recurrenceIdentity("series:other", secondAt) });
  const changes = planRecurringReschedule([...recurring, other], recurring[0], "2026-09-10T22:00:00.000Z", "all");
  expect(changes).toHaveLength(3);
  expect(changes.every((item) => item.values.studentAccountId === "account-a")).toBe(true);
});

test("single, future, and all scopes select the intended original slots and apply one series delta", () => {
  expect(planRecurringReschedule(recurring, recurring[1], "2026-09-18T00:00:00.000Z", "single")).toHaveLength(1);
  const future = planRecurringReschedule(recurring, recurring[1], "2026-09-18T00:00:00.000Z", "future");
  expect(future.map((item) => item.id)).toEqual(["row-1", "row-2"]);
  expect(future.map((item) => item.newStartsAt)).toEqual(["2026-09-18T00:00:00.000Z", "2026-09-25T00:00:00.000Z"]);
  const all = planRecurringReschedule(recurring, recurring[1], "2026-09-18T00:00:00.000Z", "all");
  expect(all.map((item) => item.id)).toEqual(["row-0", "row-1", "row-2"]);
  expect(all.map((item) => item.newStartsAt)).toEqual(["2026-09-11T00:00:00.000Z", "2026-09-18T00:00:00.000Z", "2026-09-25T00:00:00.000Z"]);
});

test("legacy recurring reload derives the same series and original-slot identity", () => {
  const legacy = booking("persisted", firstAt, { parentNote: "Imported Coach Tian Ye recurring class from Excel (TIAN YE G2/G3) through Dec 31, 2026." });
  const firstLoad = withDerivedRecurringIdentity(legacy);
  const reloaded = withDerivedRecurringIdentity({ ...firstLoad, startsAt: "2026-09-11T00:00:00.000Z" });
  expect(legacyImportedSeriesId(legacy)).toBe(firstLoad.seriesId);
  expect(reloaded.recurrenceOccurrenceId).toBe(firstLoad.recurrenceOccurrenceId);
  expect(reloaded.recurrenceOriginalStartsAt).toBe(firstAt);
});

test("legacy recurring group blocks derive a stable series without a student account", () => {
  const block = booking("group-block", firstAt, {
    studentAccountId: undefined,
    studentName: "Group class",
    familyName: "Club",
    assignedCoach: "National A",
    requestedCoach: "National A",
    program: "Group class",
    parentNote: "Recurring group class block from Google Sheet (Debolina E9/E10: Group: pat wang dian) through Dec 31, 2026."
  });
  const derived = withDerivedRecurringIdentity(block);
  expect(derived.seriesId).toBe("import:national%20a:group%20class:debolina%20e9%2Fe10%3A%20group%3A%20pat%20wang%20dian");
  expect(derived.recurrenceOccurrenceId).toBe(`${derived.seriesId}@${firstAt}`);
});

test("occurrence suppression key stays at the original slot and prevents old-time duplication", () => {
  const moved = { ...recurring[0], startsAt: "2026-09-11T00:00:00.000Z" };
  const generatedOriginal = recurring[0];
  const persistedKeys = new Set([moved.recurrenceOccurrenceId]);
  expect(persistedKeys.has(generatedOriginal.recurrenceOccurrenceId)).toBe(true);
  expect([moved].filter((item) => item.startsAt === firstAt)).toHaveLength(0);
});

test("reschedule metadata does not change billing reconciliation or CSV row identity", () => {
  const moved = planRecurringReschedule(recurring, recurring[0], "2026-09-11T00:00:00.000Z", "single")[0].values;
  const afterRows = [moved, recurring[1], recurring[2]];
  const reportInput = {
    accounts: [{
      id: "account-a",
      studentName: "Sam Lee",
      parentName: "",
      email: "sam@example.test",
      phone: "5551112222",
      confirmed: true,
      profileSetupRequired: false,
      createdAt: firstAt
    }],
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2027-01-01T00:00:00.000Z")
  };
  const before = planClassReportExport({ ...reportInput, bookings: recurring });
  const after = planClassReportExport({ ...reportInput, bookings: afterRows });
  expect({ eligible: after.eligibleSourceCount, linked: after.exportedLinkedCount, unresolved: after.exportedUnresolvedCount }).toEqual({
    eligible: before.eligibleSourceCount,
    linked: before.exportedLinkedCount,
    unresolved: before.exportedUnresolvedCount
  });
  expect(after.linkedBookings.map((item) => item.id)).toEqual(before.linkedBookings.map((item) => item.id));
  expect(serializeCsvRows([["id", "student", "price"], [moved.id, moved.studentName, String(moved.priceCents)]])).toBe(
    'id,student,price\nrow-0,Sam Lee,15000'
  );
});

test("group block and enrollments sharing permanent groupClassId move together", () => {
  const groupClassId = "group:permanent";
  const block = booking("block", firstAt, { studentAccountId: undefined, studentName: "Group class", familyName: "Club", program: "Group class", groupClassId });
  const enrollmentA = booking("enroll-a", firstAt, { program: "Group enrollment", groupClassId });
  const enrollmentB = booking("enroll-b", firstAt, { studentAccountId: "account-b", program: "Group enrollment", groupClassId });
  const changes = planRecurringReschedule([block, enrollmentA, enrollmentB], block, "2026-09-11T00:00:00.000Z", "single");
  expect(changes.map((item) => item.id)).toEqual(["block", "enroll-a", "enroll-b"]);
  expect(new Set(changes.map((item) => item.newStartsAt))).toEqual(new Set(["2026-09-11T00:00:00.000Z"]));
});

test("future group-series move shifts every block and its enrollments together", () => {
  const groupSeries = "series:group";
  const blockA = booking("block-a", firstAt, {
    studentAccountId: undefined,
    studentName: "Group class",
    familyName: "Club",
    program: "Group class",
    groupClassId: "group:a",
    ...recurrenceIdentity(groupSeries, firstAt)
  });
  const enrollmentA = booking("enroll-a", firstAt, { program: "Group enrollment", groupClassId: "group:a" });
  const blockB = booking("block-b", secondAt, {
    studentAccountId: undefined,
    studentName: "Group class",
    familyName: "Club",
    program: "Group class",
    groupClassId: "group:b",
    ...recurrenceIdentity(groupSeries, secondAt)
  });
  const enrollmentB = booking("enroll-b", secondAt, { studentAccountId: "account-b", program: "Group enrollment", groupClassId: "group:b" });
  const changes = planRecurringReschedule([blockA, enrollmentA, blockB, enrollmentB], blockA, "2026-09-11T00:00:00.000Z", "future");
  expect(changes.map((item) => item.id)).toEqual(["block-a", "enroll-a", "block-b", "enroll-b"]);
  expect(changes.map((item) => item.newStartsAt)).toEqual([
    "2026-09-11T00:00:00.000Z",
    "2026-09-11T00:00:00.000Z",
    "2026-09-18T00:00:00.000Z",
    "2026-09-18T00:00:00.000Z"
  ]);
});

test("database migration makes future/all one RPC transaction and rejects partial group updates", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260910200000_recurring_occurrence_identity.sql"), "utf8");
  expect(sql).toContain("create or replace function public.reschedule_booking_occurrences");
  expect(sql).toContain("for update");
  expect(sql).toContain("raise exception 'Every group block and enrollment must move together'");
  expect(sql).toContain("Booking changed while it was being rescheduled");
  expect(sql).toContain("recurrenceOccurrenceId");
  expect(sql).toContain("oldStartsAt");
  expect(sql).toContain("newStartsAt");
  expect(sql).toContain("Booking-count guard failed: expected 1883");
  expect(sql).toContain("Imported recurring-row guard failed: expected 1530");
  expect(sql).toContain("Imported recurring postcondition failed: expected 1530");
  expect(sql).toContain("Group-series postcondition failed: expected 141");
  expect(sql).toContain("on public.project_rows (project_table_id, (values->>'recurrenceOccurrenceId'))");
});
