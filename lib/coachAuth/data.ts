export type CoachProfile = {
  displayName: string;
  email: string;
};

export type CoachScheduleItem = {
  startsAt: string;
  endsAt: string | null;
  studentName: string;
  className: string;
  location: string;
  status: string;
};

function record(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return record(value[0]);
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function normalizeCoachProfile(value: unknown, fallbackEmail = ""): CoachProfile {
  const source = record(value);
  return {
    displayName: text(source, ["display_name", "displayName", "name", "coach_name"]) || "Coach",
    email: text(source, ["email"]) || fallbackEmail
  };
}

export function normalizeCoachSchedule(value: unknown): CoachScheduleItem[] {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).items)
    ? (value as { items: unknown[] }).items
    : [];

  return rows.flatMap((item) => {
    const source = record(item);
    const startsAt = text(source, ["starts_at", "start_time", "scheduled_at", "start"]);
    if (!startsAt || Number.isNaN(Date.parse(startsAt))) return [];
    const endsAt = text(source, ["ends_at", "end_time", "end"]);
    return [{
      startsAt,
      endsAt: endsAt && !Number.isNaN(Date.parse(endsAt)) ? endsAt : null,
      studentName: text(source, ["student_display_name", "student_name", "student_first_name"]) || "Student",
      className: text(source, ["program", "class_name", "class_type", "category", "title"]) || "Coaching session",
      location: text(source, ["location_name", "location"]),
      status: text(source, ["status"]) || "scheduled"
    }];
  }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function partitionCoachSchedule(items: CoachScheduleItem[], now = new Date()) {
  const timestamp = now.getTime();
  return {
    upcoming: items.filter((item) => Date.parse(item.endsAt ?? item.startsAt) >= timestamp),
    past: items.filter((item) => Date.parse(item.endsAt ?? item.startsAt) < timestamp).reverse()
  };
}
