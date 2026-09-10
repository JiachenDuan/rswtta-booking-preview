import { expect, test } from "@playwright/test";
import {
  assertParentCancellationAllowed,
  isParentCancellationAllowed,
  parentCancellationBlockReason,
  parentCancellationWarning,
  PARENT_CANCELLATION_CUTOFF_WARNING,
  PARENT_CANCELLATION_PAST_WARNING,
  PARENT_CANCELLATION_WINDOW_MS
} from "../lib/cancellationPolicy";
import type { Booking } from "../lib/types";

const now = Date.parse("2026-09-09T20:00:00.000Z");
const minute = 60_000;

function booking(offsetMs: number, id = "persisted-booking"): Pick<Booking, "id" | "startsAt"> {
  return { id, startsAt: new Date(now + offsetMs).toISOString() };
}

for (const { label, id } of [
  { label: "persisted booking", id: "persisted-booking" },
  { label: "virtual recurring booking", id: "virtual-series@2026-09-10" }
]) {
  test(`${label}: past, now, and within-cutoff starts are blocked`, () => {
    expect(parentCancellationBlockReason(booking(-minute, id), now)).toBe("past");
    expect(parentCancellationBlockReason(booking(0, id), now)).toBe("past");
    expect(parentCancellationBlockReason(booking(11 * 60 * minute + 59 * minute, id), now)).toBe("within_cutoff");
    expect(isParentCancellationAllowed(booking(11 * 60 * minute + 59 * minute, id), now)).toBe(false);
  });

  test(`${label}: exactly 12 hours is blocked and 12h01m is allowed`, () => {
    const exactlyTwelveHours = booking(PARENT_CANCELLATION_WINDOW_MS, id);
    expect(parentCancellationBlockReason(exactlyTwelveHours, now)).toBe("within_cutoff");
    expect(() => assertParentCancellationAllowed(exactlyTwelveHours, now)).toThrow(PARENT_CANCELLATION_CUTOFF_WARNING);
    expect(isParentCancellationAllowed(booking(PARENT_CANCELLATION_WINDOW_MS + minute, id), now)).toBe(true);
  });
}

test("ISO instants remain correct across the daylight-saving fall-back boundary", () => {
  const beforeFallback = Date.parse("2026-11-01T01:30:00-07:00");
  const exactTwelveHours = { startsAt: "2026-11-01T12:30:00-08:00" };
  const twelveHoursOneMinute = { startsAt: "2026-11-01T12:31:00-08:00" };

  expect(parentCancellationBlockReason(exactTwelveHours, beforeFallback)).toBe("within_cutoff");
  expect(isParentCancellationAllowed(twelveHoursOneMinute, beforeFallback)).toBe(true);
});

test("past and cutoff reasons are clear and bilingual", () => {
  expect(parentCancellationWarning("past", "en")).toBe(PARENT_CANCELLATION_PAST_WARNING);
  expect(parentCancellationWarning("past", "zh")).toContain("已经开始");
  expect(parentCancellationWarning("within_cutoff", "en")).toBe(PARENT_CANCELLATION_CUTOFF_WARNING);
  expect(parentCancellationWarning("within_cutoff", "zh")).toContain("12 小时内");
});
