import type { Booking } from "@/lib/types";

export const PARENT_CANCELLATION_WINDOW_MS = 12 * 60 * 60 * 1000;
export const PARENT_CANCELLATION_PAST_WARNING = "This class has already started and can no longer be cancelled online. Please contact the club assistant.";
export const PARENT_CANCELLATION_CUTOFF_WARNING = "This class starts within 12 hours and can no longer be cancelled online. Please contact the club assistant.";
export const PARENT_CANCELLATION_INVALID_TIME_WARNING = "This class time is unavailable, so it cannot be cancelled online. Please contact the club assistant.";

export type ParentCancellationBlockReason = "past" | "within_cutoff" | "invalid_time";
type CancellationBooking = Pick<Booking, "startsAt">;
type CancellationLanguage = "en" | "zh";

export function parentCancellationBlockReason(booking: CancellationBooking, now: number): ParentCancellationBlockReason | null {
  const startsAt = new Date(booking.startsAt).getTime();
  if (!Number.isFinite(startsAt)) return "invalid_time";
  if (startsAt <= now) return "past";
  if (startsAt <= now + PARENT_CANCELLATION_WINDOW_MS) return "within_cutoff";
  return null;
}

export function isParentCancellationAllowed(booking: CancellationBooking, now = Date.now()) {
  return parentCancellationBlockReason(booking, now) === null;
}

export function parentCancellationWarning(reason: ParentCancellationBlockReason, language: CancellationLanguage) {
  const messages: Record<ParentCancellationBlockReason, Record<CancellationLanguage, string>> = {
    past: {
      en: PARENT_CANCELLATION_PAST_WARNING,
      zh: "课程已经开始，无法在线取消。请联系俱乐部助理。"
    },
    within_cutoff: {
      en: PARENT_CANCELLATION_CUTOFF_WARNING,
      zh: "课程将在 12 小时内开始，无法在线取消。请联系俱乐部助理。"
    },
    invalid_time: {
      en: PARENT_CANCELLATION_INVALID_TIME_WARNING,
      zh: "课程时间无效，无法在线取消。请联系俱乐部助理。"
    }
  };
  return messages[reason][language];
}

export function assertParentCancellationAllowed(booking: CancellationBooking, now = Date.now()) {
  const reason = parentCancellationBlockReason(booking, now);
  if (reason) throw new Error(parentCancellationWarning(reason, "en"));
}
