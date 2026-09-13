import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isPersistedParentCancellationCandidate, originalOccurrenceBoundary, parentCancellationTargets } from "../lib/parentCancellation";
import type { Booking } from "../lib/types";

const clientSource = readFileSync("lib/parentClient.ts", "utf8");
const appSource = readFileSync("components/ClubApp.tsx", "utf8");
const parentHandler = appSource.slice(
  appSource.indexOf("async function cancelParentClass"),
  appSource.indexOf("async function completeParentClass")
);
const parentModal = appSource.slice(
  appSource.indexOf("function ParentClassActionModal"),
  appSource.indexOf("function BookingList")
);

function booking(overrides: Partial<Booking>): Booking {
  return {
    id: "booking-1",
    studentName: "Student",
    familyName: "Student",
    studentEmail: "private@example.com",
    phone: "555-0100",
    requestedCoach: "Coach Jorden",
    assignedCoach: "Coach Jorden",
    program: "Private lesson",
    dateLabel: "Sep 20",
    timeLabel: "7:00 PM - 8:00 PM",
    startsAt: "2026-09-21T02:00:00.000Z",
    priceCents: 7500,
    status: "club_confirmed",
    parentNote: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides
  };
}

test("Parent cancellation accepts only persisted active occurrences strictly beyond 12 hours", () => {
  const now = Date.parse("2026-09-20T00:00:00.000Z");
  expect(isPersistedParentCancellationCandidate(booking({ startsAt: "2026-09-20T12:00:00.001Z" }), now)).toBe(true);
  expect(isPersistedParentCancellationCandidate(booking({ startsAt: "2026-09-20T12:00:00.000Z" }), now)).toBe(false);
  expect(isPersistedParentCancellationCandidate(booking({ id: "virtual-seed", startsAt: "2026-09-21T00:00:00.000Z" }), now)).toBe(false);
  expect(isPersistedParentCancellationCandidate(booking({ status: "cancelled", startsAt: "2026-09-21T00:00:00.000Z" }), now)).toBe(false);
});

test("selected-and-future uses immutable original occurrence boundaries and exact eligible count", () => {
  const now = Date.parse("2026-09-12T00:00:00.000Z");
  const selected = booking({ id: "selected", seriesId: "series-a", startsAt: "2026-10-10T17:00:00.000Z", recurrenceOriginalStartsAt: "2026-09-20T17:00:00.000Z" });
  const earlierMovedLate = booking({ id: "earlier", seriesId: "series-a", startsAt: "2026-10-17T17:00:00.000Z", recurrenceOriginalStartsAt: "2026-09-13T17:00:00.000Z" });
  const futureMovedEarly = booking({ id: "future", seriesId: "series-a", startsAt: "2026-09-19T17:00:00.000Z", recurrenceOriginalStartsAt: "2026-09-27T17:00:00.000Z" });
  const cancelledFuture = booking({ id: "cancelled", seriesId: "series-a", status: "cancelled", startsAt: "2026-10-01T17:00:00.000Z", recurrenceOriginalStartsAt: "2026-10-04T17:00:00.000Z" });

  expect(originalOccurrenceBoundary(selected)).toBe("2026-09-20T17:00:00.000Z");
  expect(parentCancellationTargets([earlierMovedLate, futureMovedEarly, cancelledFuture, selected], selected, "selected_and_future", now).map((item) => item.id)).toEqual(["selected", "future"]);
});

test("one atomic Parent RPC carries token, idempotency, version, scope, and immutable boundary only", () => {
  expect(clientSource).toContain('supabase.rpc("parent_cancel_booking_occurrences"');
  expect(clientSource).toContain("p_session_token: sessionToken");
  expect(clientSource).toContain("p_idempotency_key: idempotencyKey");
  expect(clientSource).toContain("p_expected_selected_version: booking.updatedAt");
  expect(clientSource).toContain("p_expected_original_starts_at: booking.recurrenceOriginalStartsAt ?? booking.startsAt");
  expect(clientSource).toContain("p_expected_eligible_count: expectedEligibleCount");
  expect(clientSource).toContain("p_expected_series_id: booking.seriesId ?? null");
  expect(clientSource).toContain('p_operation: "cancel_booking_occurrences"');
  expect(clientSource).not.toContain("p_student_account_id");
  expect(parentHandler).toContain("parentCancellationTargets(parentBookings, booking, scope, currentTime.getTime()).length");
  expect(parentHandler).toContain("cancelParentRecurring(parentSessionToken.current, booking, scope, idempotencyKey, expectedEligibleCount)");
  expect(parentHandler).not.toContain("createBooking(");
});

test("Parent UI offers scoped exact bilingual counts and a second final confirmation", () => {
  expect(parentModal).toContain('"actions" | "scope" | "final"');
  expect(parentModal).toContain('"Selected class only — 1 class", "仅所选课程 — 1 节课"');
  expect(parentModal).toContain("recurringTargets.length");
  expect(parentModal).toContain('`Final confirmation: cancel ${countText}?`, `最终确认：取消 ${countText}？`');
  expect(parentModal).toContain('`Original-slot boundary: ${boundaryText}.`, `原始时段边界：${boundaryText}。`');
  expect(parentModal).toContain("originalOccurrenceBoundary(booking)");
  expect(parentModal).toContain("cancellationIdempotencyKey.current");
});
