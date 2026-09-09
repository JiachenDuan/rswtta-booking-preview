import { expect, test } from "@playwright/test";
import {
  assertParentCancellationAllowed,
  isParentCancellationAllowed,
  PARENT_CANCELLATION_WARNING,
  PARENT_CANCELLATION_WINDOW_MS
} from "../lib/cancellationPolicy";
import type { Booking } from "../lib/types";

const now = Date.parse("2026-09-09T20:00:00.000Z");

function booking(program: string, offsetMs: number): Pick<Booking, "program" | "startsAt"> {
  return {
    program,
    startsAt: new Date(now + offsetMs).toISOString()
  };
}

for (const { label, program } of [
  { label: "private", program: "Private lesson" },
  { label: "group", program: "Group enrollment" }
]) {
  test(`${label}: cancellation is allowed when start is more than 12 hours away`, () => {
    expect(isParentCancellationAllowed(booking(program, PARENT_CANCELLATION_WINDOW_MS + 1), now)).toBe(true);
  });

  test(`${label}: cancellation is blocked exactly 12 hours before start`, () => {
    const classBooking = booking(program, PARENT_CANCELLATION_WINDOW_MS);
    expect(isParentCancellationAllowed(classBooking, now)).toBe(false);
    expect(() => assertParentCancellationAllowed(classBooking, now)).toThrow(PARENT_CANCELLATION_WARNING);
  });

  test(`${label}: cancellation is blocked less than 12 hours before start`, () => {
    const classBooking = booking(program, PARENT_CANCELLATION_WINDOW_MS - 1);
    expect(isParentCancellationAllowed(classBooking, now)).toBe(false);
    expect(() => assertParentCancellationAllowed(classBooking, now)).toThrow(PARENT_CANCELLATION_WARNING);
  });
}
