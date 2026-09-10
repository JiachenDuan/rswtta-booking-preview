import type { Booking } from "@/lib/types";

type ActivityLanguage = "en" | "zh";
type CancellationDetails = Pick<Booking, "studentName" | "dateLabel" | "timeLabel">;

export function parentCancellationActivityMessage(
  booking: CancellationDetails,
  coachName: string,
  isGroupClass: boolean,
  language: ActivityLanguage
) {
  if (language === "zh") {
    return isGroupClass
      ? `家长/学生已退出团体课：${booking.studentName} 与 ${coachName}，原定 ${booking.dateLabel} ${booking.timeLabel}。`
      : `家长/学生已取消私教课：${booking.studentName} 与 ${coachName}，原定 ${booking.dateLabel} ${booking.timeLabel}。`;
  }

  return isGroupClass
    ? `Parent/student left group class: ${booking.studentName} with ${coachName}, scheduled ${booking.dateLabel} ${booking.timeLabel}.`
    : `Parent/student cancelled private class: ${booking.studentName} with ${coachName}, scheduled ${booking.dateLabel} ${booking.timeLabel}.`;
}
