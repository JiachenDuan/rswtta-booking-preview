import type { Booking, BookingStatus, ParentAccount } from "@/lib/types";

export type ParentLegacyDashboardPayload = {
  account: ParentAccount;
  bookings: Booking[];
  calendarBookings: Booking[];
  serverNow: string;
};

const bookingStatuses = new Set<BookingStatus>(["requested", "club_confirmed", "change_requested", "cancelled", "coach_confirmed"]);

function normalizeCoachName(value: unknown) {
  const coach = String(value ?? "Coach A").trim();
  if (coach === "Coach A" || coach === "National A" || coach === "Debolina" || coach === "Coach Debolina") return "National A";
  if (coach === "Coach B" || coach === "National B" || coach === "Diren" || coach === "Coach Diren") return "National B";
  return coach;
}

function optionalString(value: unknown) {
  const normalized = String(value ?? "");
  return normalized || undefined;
}

export function normalizeParentLegacyBooking(value: unknown): Booking {
  if (!value || typeof value !== "object") throw new Error("Invalid Parent dashboard booking");
  const booking = value as Partial<Booking>;
  if (typeof booking.id !== "string" || !booking.id) throw new Error("Invalid Parent dashboard booking");
  const requestedCoach = normalizeCoachName(booking.requestedCoach ?? booking.assignedCoach ?? "National A");
  const assignedCoach = normalizeCoachName(booking.assignedCoach ?? booking.requestedCoach ?? "National A");
  const status = String(booking.status ?? "requested") as BookingStatus;
  return {
    id: booking.id,
    studentAccountId: optionalString(booking.studentAccountId),
    seriesId: optionalString(booking.seriesId),
    recurrenceOccurrenceId: optionalString(booking.recurrenceOccurrenceId),
    recurrenceOriginalStartsAt: optionalString(booking.recurrenceOriginalStartsAt),
    groupClassId: optionalString(booking.groupClassId),
    coachId: optionalString(booking.coachId),
    assignedCoachId: optionalString(booking.assignedCoachId),
    requestedCoachId: optionalString(booking.requestedCoachId),
    studentName: String(booking.studentName ?? "Student"),
    familyName: String(booking.familyName ?? booking.studentName ?? "Student"),
    studentEmail: String(booking.studentEmail ?? ""),
    phone: String(booking.phone ?? ""),
    requestedCoach,
    assignedCoach,
    program: String(booking.program ?? "Private lesson"),
    dateLabel: String(booking.dateLabel ?? "Today"),
    timeLabel: String(booking.timeLabel ?? "4:30 PM"),
    startsAt: String(booking.startsAt ?? new Date().toISOString()),
    priceCents: Number.isFinite(Number(booking.priceCents)) ? Number(booking.priceCents) : 0,
    capacity: booking.capacity === undefined ? undefined : Number(booking.capacity),
    maxCapacity: booking.maxCapacity === undefined ? undefined : Number(booking.maxCapacity),
    status: bookingStatuses.has(status) ? status : "requested",
    parentNote: String(booking.parentNote ?? ""),
    createdAt: String(booking.createdAt ?? ""),
    updatedAt: String(booking.updatedAt ?? "")
  };
}

export function isParentLegacyDashboard(value: unknown): value is ParentLegacyDashboardPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParentLegacyDashboardPayload>;
  return Boolean(
    candidate.account
    && typeof candidate.account.id === "string"
    && typeof candidate.account.studentName === "string"
    && typeof candidate.account.parentName === "string"
    && typeof candidate.account.email === "string"
    && typeof candidate.account.phone === "string"
    && typeof candidate.account.confirmed === "boolean"
    && typeof candidate.account.profileSetupRequired === "boolean"
    && typeof candidate.account.createdAt === "string"
  )
    && Array.isArray(candidate.bookings)
    && Array.isArray(candidate.calendarBookings)
    && typeof candidate.serverNow === "string"
    && Number.isFinite(Date.parse(candidate.serverNow));
}

export function normalizeParentLegacyDashboard<T extends ParentLegacyDashboardPayload>(dashboard: T): T {
  return {
    ...dashboard,
    bookings: dashboard.bookings.map(normalizeParentLegacyBooking),
    calendarBookings: dashboard.calendarBookings.map(normalizeParentLegacyBooking)
  };
}
