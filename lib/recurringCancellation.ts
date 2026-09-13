import type { Booking } from "@/lib/types";

export type RecurringCancellationActor = "club" | "parent";
export type RecurringCancellationScope = "future" | "all";

function originalTime(booking: Booking) {
  return new Date(booking.recurrenceOriginalStartsAt || booking.startsAt).getTime();
}

function coachIdentity(booking: Booking) {
  return booking.assignedCoach || booking.requestedCoach;
}

function isCancellable(booking: Booking, actor: RecurringCancellationActor) {
  return actor === "parent"
    ? booking.status === "requested" || booking.status === "club_confirmed"
    : booking.status === "requested" || booking.status === "change_requested" || booking.status === "club_confirmed";
}

export function selectRecurringCancellationTargets(
  bookings: Booking[],
  selected: Booking,
  scope: RecurringCancellationScope,
  notBefore: Date,
  actor: RecurringCancellationActor
) {
  if (
    !selected.studentAccountId ||
    !selected.seriesId ||
    !selected.recurrenceOccurrenceId ||
    !selected.recurrenceOriginalStartsAt
  ) {
    throw new Error("Recurring class identity is incomplete");
  }
  if (selected.groupClassId || selected.program === "Group class" || selected.program === "Group enrollment") {
    throw new Error("Group classes and enrollments must use group occurrence management");
  }

  const boundary = originalTime(selected);
  const cutoff = notBefore.getTime();
  if (actor === "parent" && (!isCancellable(selected, actor) || new Date(selected.startsAt).getTime() <= cutoff)) {
    throw new Error("The selected class must be active and start more than 12 hours from now");
  }
  return bookings
    .filter((booking) => booking.seriesId === selected.seriesId)
    .filter((booking) => booking.studentAccountId === selected.studentAccountId)
    .filter((booking) => !booking.groupClassId && booking.program !== "Group class" && booking.program !== "Group enrollment")
    .filter((booking) => isCancellable(booking, actor))
    .filter((booking) => new Date(booking.startsAt).getTime() > cutoff)
    .filter((booking) => scope === "all" || originalTime(booking) >= boundary)
    .sort((left, right) => originalTime(left) - originalTime(right) || left.id.localeCompare(right.id));
}

export function expectedRecurringCancellationRows(bookings: Booking[]) {
  return bookings.map((booking) => ({
    id: booking.id.startsWith("virtual-") ? null : booking.id,
    studentAccountId: booking.studentAccountId,
    seriesId: booking.seriesId,
    recurrenceOccurrenceId: booking.recurrenceOccurrenceId,
    recurrenceOriginalStartsAt: booking.recurrenceOriginalStartsAt,
    groupClassId: booking.groupClassId ?? null,
    startsAt: booking.startsAt,
    status: booking.status,
    program: booking.program,
    coach: coachIdentity(booking),
    updatedAt: booking.updatedAt,
    values: booking.id.startsWith("virtual-")
      ? {
          studentAccountId: booking.studentAccountId,
          seriesId: booking.seriesId,
          recurrenceOccurrenceId: booking.recurrenceOccurrenceId,
          recurrenceOriginalStartsAt: booking.recurrenceOriginalStartsAt,
          groupClassId: booking.groupClassId,
          studentName: booking.studentName,
          familyName: booking.familyName || booking.studentName,
          studentEmail: booking.studentEmail,
          phone: booking.phone,
          requestedCoach: booking.requestedCoach,
          assignedCoach: booking.assignedCoach,
          program: booking.program,
          dateLabel: booking.dateLabel,
          timeLabel: booking.timeLabel,
          startsAt: booking.startsAt,
          priceCents: booking.priceCents,
          status: booking.status,
          parentNote: booking.parentNote
        }
      : null
  }));
}
