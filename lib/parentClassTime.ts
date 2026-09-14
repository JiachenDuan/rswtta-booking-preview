import type { Booking, BookingStatus } from "@/lib/types";

export const PARENT_CLASS_TIME_NOTICE_MS = 12 * 60 * 60 * 1000;
export const PARENT_CLASS_TIME_ACTIVE_STATUSES = new Set<BookingStatus>([
  "requested",
  "change_requested",
  "club_confirmed"
]);

export type ParentClassTimeSnapshot = Pick<
  Booking,
  | "id"
  | "updatedAt"
  | "status"
  | "startsAt"
  | "seriesId"
  | "recurrenceOccurrenceId"
  | "recurrenceOriginalStartsAt"
>;

export function parentClassDurationMinutes(booking: Pick<Booking, "startsAt" | "timeLabel">) {
  const start = new Date(booking.startsAt);
  const endLabel = booking.timeLabel.split(" - ")[1]?.trim();
  const match = endLabel?.match(/^(\d{1,2})(?::(\d{2}))?\s+(AM|PM)$/i);
  if (!match || !Number.isFinite(start.getTime())) return 0;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const end = new Date(start);
  end.setHours(hour, Number(match[2] ?? "0"), 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1);
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function isParentPrivateOccurrence(booking: Booking) {
  const isEnrollment =
    booking.program === "Group enrollment" ||
    (booking.program === "Group lesson" &&
      (booking.parentNote.includes("Parent requested to join group class") ||
        booking.parentNote.includes("Added to group class by club")));
  return (
    booking.program !== "Group class" &&
    booking.program !== "Unavailable" &&
    !isEnrollment &&
    !booking.groupClassId &&
    !booking.id.startsWith("virtual-") &&
    Boolean(booking.studentAccountId)
  );
}

export function canParentUpdateClassTime(booking: Booking, serverNowMs: number) {
  const startsAt = new Date(booking.startsAt).getTime();
  return (
    isParentPrivateOccurrence(booking) &&
    PARENT_CLASS_TIME_ACTIVE_STATUSES.has(booking.status) &&
    Number.isFinite(startsAt) &&
    startsAt > serverNowMs + PARENT_CLASS_TIME_NOTICE_MS
  );
}

export function isValidParentClassTimeTarget(targetStartsAt: string, durationMinutes: number, serverNowMs: number) {
  const target = new Date(targetStartsAt);
  return (
    Number.isFinite(target.getTime()) &&
    target.getTime() > serverNowMs + PARENT_CLASS_TIME_NOTICE_MS &&
    target.getSeconds() === 0 &&
    target.getMilliseconds() === 0 &&
    target.getMinutes() % 30 === 0 &&
    durationMinutes >= 30 &&
    durationMinutes <= 12 * 60 &&
    durationMinutes % 30 === 0
  );
}

export function parentClassTimeResultStatus(status: BookingStatus): BookingStatus {
  return status === "club_confirmed" ? "change_requested" : status;
}

export function parentClassTimeSnapshot(booking: Booking): ParentClassTimeSnapshot {
  return {
    id: booking.id,
    updatedAt: booking.updatedAt,
    status: booking.status,
    startsAt: booking.startsAt,
    seriesId: booking.seriesId,
    recurrenceOccurrenceId: booking.recurrenceOccurrenceId,
    recurrenceOriginalStartsAt: booking.recurrenceOriginalStartsAt
  };
}
