export const TIAN_YE_COACH_ID = "coach_tian_ye";
export const TIAN_YE_BOOKING_MESSAGE_EN = "Coach Tian Ye’s classes cannot be booked directly through this app. Please email info@rswtta.com or contact Coach Tian Ye or the club assistant.";
export const TIAN_YE_BOOKING_MESSAGE_ZH = "Tian Ye 教练的课程无法通过本应用直接预约。请发送邮件至 info@rswtta.com，或联系 Tian Ye 教练或俱乐部助理。";

function normalizedCoachName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function canonicalCoachId(value: string) {
  const coach = normalizedCoachName(value);
  if (["coachtianye", "tianye", "coachtian", "headcoachtian"].includes(coach)) return TIAN_YE_COACH_ID;
  if (["coachjorden", "jorden", "coachwang", "wang"].includes(coach)) return "coach_jorden";
  if (["nationala", "debolina"].includes(coach)) return "coach_debolina";
  if (["nationalb", "diren"].includes(coach)) return "coach_diren";
  return `coach:${coach}`;
}

export function isTianYeCoach(value: string) {
  return canonicalCoachId(value) === TIAN_YE_COACH_ID;
}
