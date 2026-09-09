import type { Booking } from "@/lib/types";

export const PARENT_CANCELLATION_WARNING = "This class is within 12 hours. Please contact the club assistant to cancel.";
export const PARENT_CANCELLATION_WINDOW_MS = 12 * 60 * 60 * 1000;

type CancellationBooking = Pick<Booking, "startsAt">;

export function isParentCancellationAllowed(booking: CancellationBooking, now = Date.now()) {
  const startsAt = new Date(booking.startsAt).getTime();
  return Number.isFinite(startsAt) && startsAt - now > PARENT_CANCELLATION_WINDOW_MS;
}

export function assertParentCancellationAllowed(booking: CancellationBooking, now = Date.now()) {
  if (!isParentCancellationAllowed(booking, now)) {
    throw new Error(PARENT_CANCELLATION_WARNING);
  }
}
