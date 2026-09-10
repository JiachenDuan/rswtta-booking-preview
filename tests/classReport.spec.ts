import { expect, test } from "@playwright/test";
import {
  assertLosslessClassReport,
  classReportAuditRows,
  classReportBillingReconciliationRows,
  planClassReportExport,
  serializeCsvRows,
  unresolvedClassReportRows
} from "../lib/classReport";
import type { Booking, ParentAccount } from "../lib/types";

const accounts: ParentAccount[] = [
  {
    id: "avery-account",
    preregisteredName: "Avery",
    studentName: "Avery Johnson",
    parentName: "Parent",
    email: "avery@example.test",
    phone: "1111111",
    confirmed: true,
    profileSetupRequired: false,
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "other-account",
    preregisteredName: "Morgan",
    studentName: "Morgan Lee",
    parentName: "Parent",
    email: "morgan@example.test",
    phone: "2222222",
    confirmed: true,
    profileSetupRequired: false,
    createdAt: "2026-01-01T00:00:00.000Z"
  }
];

function booking(id: string, input: Partial<Booking>): Booking {
  return {
    id,
    studentName: "Snapshot",
    familyName: "Snapshot",
    studentEmail: "",
    phone: "",
    requestedCoach: "Coach Tian Ye",
    assignedCoach: "Coach Tian Ye",
    program: "Private coaching",
    dateLabel: "Sep 8, 2026",
    timeLabel: "5:00 PM",
    startsAt: "2026-09-08T17:00:00-07:00",
    priceCents: 0,
    status: "club_confirmed",
    parentNote: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...input
  };
}

const source = [
  booking("linked-confirmed", { studentAccountId: "avery-account", studentName: "Avery", status: "club_confirmed" }),
  booking("linked-completed", { studentAccountId: "avery-account", studentName: "Avery", status: "coach_confirmed" }),
  booking("unresolved-confirmed", { studentName: "Morgan", status: "club_confirmed" }),
  booking("unresolved-completed", { studentName: "Morgan", status: "coach_confirmed" }),
  booking("other-linked", { studentAccountId: "other-account", studentName: "Morgan", status: "coach_confirmed" }),
  booking("requested", { studentAccountId: "avery-account", status: "requested" }),
  booking("outside", { studentAccountId: "avery-account", startsAt: "2026-08-08T17:00:00-07:00", status: "coach_confirmed" }),
  booking("blocked", { program: "Unavailable", status: "club_confirmed" }),
  booking("group-block", { program: "Group class", status: "coach_confirmed" })
];

const periodStart = new Date("2026-09-01T00:00:00-07:00");
const periodEnd = new Date("2026-09-30T23:59:59-07:00");

test("all-students export reconciles every eligible confirmed and completed class without duplicates", () => {
  const plan = planClassReportExport({ bookings: source, accounts, periodStart, periodEnd });
  expect(plan.eligibleSourceCount).toBe(5);
  expect(plan.exportedLinkedCount).toBe(3);
  expect(plan.exportedUnresolvedCount).toBe(2);
  expect(plan.confirmedCount).toBe(2);
  expect(plan.completedCount).toBe(3);
  expect(plan.eligibleSourceCount).toBe(plan.exportedLinkedCount + plan.exportedUnresolvedCount);
  const ids = [...plan.linkedBookings, ...plan.unresolvedBookings].map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(plan.linkedStudentTotals).toEqual([
    { studentAccountId: "avery-account", studentName: "Avery Johnson", confirmedCount: 1, completedCount: 1, totalCount: 2 },
    { studentAccountId: "other-account", studentName: "Morgan Lee", confirmedCount: 0, completedCount: 1, totalCount: 1 }
  ]);
  expect(plan.linkedStudentTotals.reduce((sum, student) => sum + student.totalCount, 0) + plan.exportedUnresolvedCount).toBe(plan.eligibleSourceCount);
});

test("linked export rows use the canonical renamed account name", () => {
  const plan = planClassReportExport({ bookings: source, accounts, periodStart, periodEnd });
  expect(plan.linkedBookings.filter((item) => item.studentAccountId === "avery-account")).toHaveLength(2);
  expect(plan.linkedBookings.filter((item) => item.studentAccountId === "avery-account").every((item) => item.studentName === "Avery Johnson")).toBe(true);
});

test("a stale account ID is reported as unresolved instead of rendered under a non-canonical snapshot", () => {
  const plan = planClassReportExport({
    bookings: [booking("orphaned", { studentAccountId: "missing-account", studentName: "Old Snapshot", status: "coach_confirmed" })],
    accounts,
    periodStart,
    periodEnd
  });
  expect(plan.exportedLinkedCount).toBe(0);
  expect(plan.exportedUnresolvedCount).toBe(1);
  expect(plan.unresolvedBookings[0]).toMatchObject({ id: "orphaned", studentName: "Old Snapshot" });
});

test("unresolved CSV section is explicit and carries every required audit field", () => {
  const plan = planClassReportExport({ bookings: source, accounts, periodStart, periodEnd });
  const csv = serializeCsvRows([
    ...classReportAuditRows(plan, false),
    ...classReportBillingReconciliationRows(plan),
    ...unresolvedClassReportRows(plan.unresolvedBookings)
  ]);
  expect(csv).toContain("Eligible source rows,5");
  expect(csv).toContain("Reconciliation,5 = 3 + 2");
  expect(csv).toContain("BILLING RECONCILIATION BY STABLE STUDENT ACCOUNT");
  expect(csv).toContain("avery-account,Avery Johnson,1,1,2");
  expect(csv).toContain("other-account,Morgan Lee,0,1,1");
  expect(csv).toContain("Billing reconciliation,,,,3 + 2 = 5");
  expect(csv).toContain("UNRESOLVED BILLING RECONCILIATION QUEUE");
  expect(csv).toContain("Booking ID,Student snapshot,Date,Time,Coach,Status");
  expect(csv).toContain('unresolved-confirmed,Morgan,"Sep 8, 2026",5:00 PM,Coach Tian Ye,club_confirmed');
  expect(csv).toContain('unresolved-completed,Morgan,"Sep 8, 2026",5:00 PM,Coach Tian Ye,coach_confirmed');
});

test("per-student export filters by account ID only and warns that ambiguous rows are unattributable", () => {
  const plan = planClassReportExport({ bookings: source, accounts, periodStart, periodEnd, studentAccountId: "avery-account" });
  expect(plan.linkedBookings.map((item) => item.id)).toEqual(["linked-confirmed", "linked-completed"]);
  expect(plan.unresolvedBookings).toHaveLength(0);
  expect(plan.unresolvedInPeriodCount).toBe(2);
  expect(plan.eligibleSourceCount).toBe(2);
  expect(plan.eligibleSourceCount).toBe(plan.exportedLinkedCount + plan.exportedUnresolvedCount);
  const csv = serializeCsvRows(classReportAuditRows(plan, true));
  expect(csv).toContain("UNRESOLVED ATTRIBUTION WARNING,2 in-period unresolved rows were not included because they cannot safely be attributed by name.");
});

test("duplicate eligible booking IDs fail the lossless export assertion", () => {
  expect(() => planClassReportExport({ bookings: [source[0], { ...source[0] }], accounts, periodStart, periodEnd })).toThrow("duplicate booking IDs");
  expect(() => assertLosslessClassReport({
    eligibleSourceCount: 2,
    exportedLinkedCount: 1,
    exportedUnresolvedCount: 0,
    unresolvedInPeriodCount: 0,
    confirmedCount: 1,
    completedCount: 0,
    unresolvedConfirmedCount: 0,
    unresolvedCompletedCount: 0,
    linkedStudentTotals: [{ studentAccountId: "avery-account", studentName: "Avery Johnson", confirmedCount: 1, completedCount: 0, totalCount: 1 }],
    linkedBookings: [source[0]],
    unresolvedBookings: []
  })).toThrow("reconciliation failed");
});
