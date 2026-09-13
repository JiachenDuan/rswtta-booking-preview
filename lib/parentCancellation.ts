import type { Booking } from "@/lib/types";

export type ParentCancellationScope = "selected" | "selected_and_future";

const ACTIVE_PARENT_STATUSES = new Set(["requested", "club_confirmed"]);
const CANCELLATION_NOTICE_MS = 12 * 60 * 60 * 1000;

export function isPersistedParentCancellationCandidate(booking: Booking, now: number) {
  return (
    !booking.id.startsWith("virtual-") &&
    ACTIVE_PARENT_STATUSES.has(booking.status) &&
    new Date(booking.startsAt).getTime() > now + CANCELLATION_NOTICE_MS
  );
}

export function originalOccurrenceBoundary(booking: Booking) {
  return booking.recurrenceOriginalStartsAt ?? booking.startsAt;
}

export function parentCancellationTargets(
  bookings: Booking[],
  selected: Booking,
  scope: ParentCancellationScope,
  now: number
) {
  if (!isPersistedParentCancellationCandidate(selected, now)) return [];
  if (scope === "selected" || !selected.seriesId) return [selected];

  const boundary = new Date(originalOccurrenceBoundary(selected)).getTime();
  return bookings
    .filter(
      (booking) =>
        booking.seriesId === selected.seriesId &&
        isPersistedParentCancellationCandidate(booking, now) &&
        new Date(originalOccurrenceBoundary(booking)).getTime() >= boundary
    )
    .sort(
      (left, right) =>
        new Date(originalOccurrenceBoundary(left)).getTime() -
        new Date(originalOccurrenceBoundary(right)).getTime()
    );
}
