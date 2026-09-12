import { canonicalCoachId } from "@/lib/coachPolicy";
import type { Booking } from "@/lib/types";

function bookingEnd(booking: Pick<Booking, "startsAt" | "timeLabel">) {
  const starts = new Date(booking.startsAt);
  const [, endLabel] = booking.timeLabel.split(" - ");
  const match = endLabel?.match(/^(\d{1,2})(?::(\d{2}))?\s+(AM|PM)$/i);
  if (!match) return new Date(starts.getTime() + 60 * 60 * 1000);
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hours += 12;
  const ends = new Date(starts);
  ends.setHours(hours, Number(match[2] ?? "0"), 0, 0);
  return ends <= starts ? new Date(starts.getTime() + 60 * 60 * 1000) : ends;
}

export function halfOpenIntervalsOverlap(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function isParentRequestIntervalUnavailable(
  bookings: Booking[],
  studentAccountId: string,
  coach: string,
  startsAt: string,
  durationMinutes: number
) {
  const starts = new Date(startsAt);
  const ends = new Date(starts.getTime() + durationMinutes * 60 * 1000);
  const requestedCoachId = canonicalCoachId(coach);
  return bookings.some((booking) => {
    if (booking.status === "cancelled") return false;
    const bookingCoach = booking.assignedCoach || booking.requestedCoach;
    const blocksCoach = canonicalCoachId(bookingCoach) === requestedCoachId;
    const blocksStudent = Boolean(studentAccountId) && booking.studentAccountId === studentAccountId;
    return (blocksCoach || blocksStudent) && halfOpenIntervalsOverlap(starts, ends, new Date(booking.startsAt), bookingEnd(booking));
  });
}
