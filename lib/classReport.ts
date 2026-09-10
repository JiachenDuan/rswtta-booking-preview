import { canonicalizeStudentReference } from "@/lib/studentIdentity";
import type { Booking, ParentAccount } from "@/lib/types";

export type CsvCell = string | number;

type LinkedStudentTotal = {
  studentAccountId: string;
  studentName: string;
  confirmedCount: number;
  completedCount: number;
  totalCount: number;
};

export type ClassReportPlan = {
  eligibleSourceCount: number;
  exportedLinkedCount: number;
  exportedUnresolvedCount: number;
  unresolvedInPeriodCount: number;
  confirmedCount: number;
  completedCount: number;
  unresolvedConfirmedCount: number;
  unresolvedCompletedCount: number;
  linkedStudentTotals: LinkedStudentTotal[];
  linkedBookings: Booking[];
  unresolvedBookings: Booking[];
};

export function csvValue(value: CsvCell) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCsvRows(rows: CsvCell[][]) {
  return rows.map((row) => row.map((cell) => csvValue(cell)).join(",")).join("\n");
}

export function classReportAuditRows(plan: ClassReportPlan, isStudentFiltered: boolean): CsvCell[][] {
  return [
    ["Eligible source rows", plan.eligibleSourceCount],
    ["Exported linked rows", plan.exportedLinkedCount],
    ["Exported unresolved rows", plan.exportedUnresolvedCount],
    ["Reconciliation", `${plan.eligibleSourceCount} = ${plan.exportedLinkedCount} + ${plan.exportedUnresolvedCount}`],
    ["Confirmed rows", plan.confirmedCount],
    ["Completed rows", plan.completedCount],
    ["Duplicate booking IDs", 0],
    ...(isStudentFiltered
      ? [["UNRESOLVED ATTRIBUTION WARNING", `${plan.unresolvedInPeriodCount} in-period unresolved rows were not included because they cannot safely be attributed by name.`] as CsvCell[]]
      : [])
  ];
}

export function classReportBillingReconciliationRows(plan: ClassReportPlan): CsvCell[][] {
  return [
    [],
    ["BILLING RECONCILIATION BY STABLE STUDENT ACCOUNT"],
    ["Student account ID", "Current canonical name", "Confirmed", "Completed", "Eligible total"],
    ...plan.linkedStudentTotals.map((student) => [
      student.studentAccountId,
      student.studentName,
      student.confirmedCount,
      student.completedCount,
      student.totalCount
    ]),
    [
      "UNRESOLVED",
      "Cannot safely attribute or bill",
      plan.unresolvedConfirmedCount,
      plan.unresolvedCompletedCount,
      plan.exportedUnresolvedCount
    ],
    ["Linked per-student total", "", "", "", plan.exportedLinkedCount],
    ["Unresolved reconciliation total", "", "", "", plan.exportedUnresolvedCount],
    ["All eligible classes", "", "", "", plan.eligibleSourceCount],
    ["Billing reconciliation", "", "", "", `${plan.exportedLinkedCount} + ${plan.exportedUnresolvedCount} = ${plan.eligibleSourceCount}`]
  ];
}

export function unresolvedClassReportRows(bookings: Booking[]): CsvCell[][] {
  if (!bookings.length) return [];
  return [
    [],
    ["UNRESOLVED BILLING RECONCILIATION QUEUE"],
    ["These legacy rows are display snapshots only and cannot safely be attributed or billed to any student account."],
    ["Booking ID", "Student snapshot", "Date", "Time", "Coach", "Status"],
    ...bookings.map((booking) => [
      booking.id,
      booking.studentName,
      booking.dateLabel,
      booking.timeLabel,
      booking.assignedCoach || booking.requestedCoach,
      booking.status
    ])
  ];
}

function isEligibleClassReportBooking(booking: Booking, periodStart: Date, periodEnd: Date) {
  const startsAt = new Date(booking.startsAt);
  return (
    startsAt >= periodStart &&
    startsAt <= periodEnd &&
    booking.program !== "Unavailable" &&
    booking.program !== "Group class" &&
    (booking.status === "club_confirmed" || booking.status === "coach_confirmed")
  );
}

export function assertLosslessClassReport(plan: ClassReportPlan) {
  if (plan.eligibleSourceCount !== plan.exportedLinkedCount + plan.exportedUnresolvedCount) {
    throw new Error(
      `Class report reconciliation failed: ${plan.eligibleSourceCount} eligible source rows != ${plan.exportedLinkedCount} linked + ${plan.exportedUnresolvedCount} unresolved`
    );
  }
  const exportedIds = [...plan.linkedBookings, ...plan.unresolvedBookings].map((booking) => booking.id);
  if (new Set(exportedIds).size !== exportedIds.length) {
    throw new Error("Class report contains duplicate booking IDs");
  }
  if (plan.confirmedCount + plan.completedCount !== plan.eligibleSourceCount) {
    throw new Error("Class report status reconciliation failed");
  }
  const linkedStudentTotal = plan.linkedStudentTotals.reduce((sum, student) => sum + student.totalCount, 0);
  if (linkedStudentTotal !== plan.exportedLinkedCount) {
    throw new Error("Class report per-student billing reconciliation failed");
  }
}

export function planClassReportExport(input: {
  bookings: Booking[];
  accounts: ParentAccount[];
  periodStart: Date;
  periodEnd: Date;
  studentAccountId?: string;
}): ClassReportPlan {
  const accountIds = new Set(input.accounts.map((account) => account.id));
  const canonicalEligible = input.bookings
    .filter((booking) => isEligibleClassReportBooking(booking, input.periodStart, input.periodEnd))
    .map((booking) => canonicalizeStudentReference(booking, input.accounts));
  const linked = canonicalEligible.filter((booking) => booking.studentAccountId && accountIds.has(booking.studentAccountId));
  const unresolvedLegacy = canonicalEligible.filter((booking) => !booking.studentAccountId || !accountIds.has(booking.studentAccountId));
  const selectedLinked = input.studentAccountId
    ? linked.filter((booking) => booking.studentAccountId === input.studentAccountId)
    : linked;
  const exportedUnresolved = input.studentAccountId ? [] : unresolvedLegacy;
  const exported = [...selectedLinked, ...exportedUnresolved];
  const linkedByAccount = new Map<string, LinkedStudentTotal>();
  for (const booking of selectedLinked) {
    const studentAccountId = booking.studentAccountId!;
    const current = linkedByAccount.get(studentAccountId) ?? {
      studentAccountId,
      studentName: booking.studentName,
      confirmedCount: 0,
      completedCount: 0,
      totalCount: 0
    };
    current.confirmedCount += booking.status === "club_confirmed" ? 1 : 0;
    current.completedCount += booking.status === "coach_confirmed" ? 1 : 0;
    current.totalCount += 1;
    linkedByAccount.set(studentAccountId, current);
  }
  const linkedStudentTotals = [...linkedByAccount.values()].sort((left, right) => left.studentName.localeCompare(right.studentName));
  const plan: ClassReportPlan = {
    eligibleSourceCount: exported.length,
    exportedLinkedCount: selectedLinked.length,
    exportedUnresolvedCount: exportedUnresolved.length,
    unresolvedInPeriodCount: unresolvedLegacy.length,
    confirmedCount: exported.filter((booking) => booking.status === "club_confirmed").length,
    completedCount: exported.filter((booking) => booking.status === "coach_confirmed").length,
    unresolvedConfirmedCount: exportedUnresolved.filter((booking) => booking.status === "club_confirmed").length,
    unresolvedCompletedCount: exportedUnresolved.filter((booking) => booking.status === "coach_confirmed").length,
    linkedStudentTotals,
    linkedBookings: selectedLinked,
    unresolvedBookings: exportedUnresolved
  };
  assertLosslessClassReport(plan);
  return plan;
}
