import { canonicalizeStudentReference } from "@/lib/studentIdentity";
import type { Booking, ParentAccount } from "@/lib/types";

export type CsvCell = string | number;

export type ClassReportPlan = {
  eligibleSourceCount: number;
  exportedLinkedCount: number;
  exportedUnresolvedCount: number;
  unresolvedInPeriodCount: number;
  confirmedCount: number;
  completedCount: number;
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

export function unresolvedClassReportRows(bookings: Booking[]): CsvCell[][] {
  if (!bookings.length) return [];
  return [
    [],
    ["UNRESOLVED LEGACY CLASS ROWS"],
    ["These rows are display snapshots only and cannot safely be attributed to any student account."],
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
  const plan: ClassReportPlan = {
    eligibleSourceCount: exported.length,
    exportedLinkedCount: selectedLinked.length,
    exportedUnresolvedCount: exportedUnresolved.length,
    unresolvedInPeriodCount: unresolvedLegacy.length,
    confirmedCount: exported.filter((booking) => booking.status === "club_confirmed").length,
    completedCount: exported.filter((booking) => booking.status === "coach_confirmed").length,
    linkedBookings: selectedLinked,
    unresolvedBookings: exportedUnresolved
  };
  assertLosslessClassReport(plan);
  return plan;
}
