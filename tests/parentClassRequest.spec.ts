import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { canonicalCoachId, isTianYeCoach, TIAN_YE_BOOKING_MESSAGE_EN, TIAN_YE_BOOKING_MESSAGE_ZH } from "../lib/coachPolicy";
import { halfOpenIntervalsOverlap, isParentRequestIntervalUnavailable } from "../lib/parentRequestPolicy";
import type { Booking } from "../lib/types";

const appSource = readFileSync("components/ClubApp.tsx", "utf8");
const storeSource = readFileSync("lib/projectStore.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260911220500_restore_parent_calendar_class_requests.sql", "utf8");
const parentApp = appSource.slice(appSource.indexOf("function ParentApp"), appSource.indexOf("function CalendarControls"));
const bookingList = appSource.slice(appSource.indexOf("function BookingList"));

test("Tian Ye aliases share one stable ID and the UI contains the exact bilingual block", () => {
  expect(canonicalCoachId("Coach Tian Ye")).toBe("coach_tian_ye");
  expect(canonicalCoachId("  tian   ye ")).toBe("coach_tian_ye");
  expect(isTianYeCoach("Head Coach Tian")).toBe(true);
  expect(isTianYeCoach("Coach Jorden")).toBe(false);
  expect(appSource).toContain("if (isTianYeCoach(requestedCoach))");
  expect(appSource).toContain("if (isGroupClassBlock(booking) && isTianYeCoach(booking.assignedCoach || booking.requestedCoach))");
  const groupRequestHandler = appSource.slice(appSource.indexOf("async function requestGroupClass"), appSource.indexOf("async function cancelParentClass"));
  expect(groupRequestHandler.indexOf("if (isTianYeCoach(coach))")).toBeGreaterThanOrEqual(0);
  expect(groupRequestHandler.indexOf("if (isTianYeCoach(coach))")).toBeLessThan(groupRequestHandler.indexOf("createBooking({"));
  expect(appSource).toContain("setShowRequestConfirm(false)");
  expect(parentApp).toContain("onUnavailableSlotSelect={isTianYeCoach(requestedCoach) ? onRestrictedCoachSelect : undefined}");
  expect(appSource).toContain("disabled={(unavailable && !actionable && !onUnavailableSlotSelect)");
  expect(appSource).toContain("onUnavailableSlotSelect?.()");
  expect(appSource).toContain('role="alertdialog"');
  expect(appSource).toContain("<CoachBookingRestrictionNotice");
  expect(appSource).toContain('copy(language, "Got it", "知道了")');
  expect(TIAN_YE_BOOKING_MESSAGE_EN).toBe("Coach Tian Ye’s classes cannot be booked directly through this app. Please email info@rswtta.com or contact Coach Tian Ye or the club assistant.");
  expect(TIAN_YE_BOOKING_MESSAGE_ZH).toContain("无法通过本应用直接预约");
  expect(migration).toContain(TIAN_YE_BOOKING_MESSAGE_EN);
});

test("Parent Calendar uses the dedicated request RPC while My Classes stays inert", () => {
  expect(appSource).toContain("const parentPrivateClassRequestsEnabled = true");
  expect(appSource).toContain("requestBookingAsParent({");
  expect(storeSource).toContain('supabase.rpc("request_booking_as_parent"');
  expect(parentApp).toContain("onSlotChange={onSlotChange}");
  expect(parentApp).toContain('<BookingList bookings={filteredClassBookings} language={language} />');
  expect(bookingList).not.toContain("requestBookingAsParent");
  expect(bookingList).not.toContain("onClick");
});

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "booking-1",
    studentAccountId: "account-b",
    studentName: "Same Display Name",
    familyName: "Same Display Name",
    studentEmail: "student@example.com",
    phone: "5555555555",
    requestedCoach: "Coach Jorden",
    assignedCoach: "Coach Jorden",
    program: "Group lesson",
    dateLabel: "Sep 20, 2026",
    timeLabel: "5:00 PM - 6:00 PM",
    startsAt: "2026-09-20T17:00:00-07:00",
    priceCents: 7500,
    status: "requested",
    parentNote: "",
    createdAt: "2026-09-11T00:00:00Z",
    updatedAt: "2026-09-11T00:00:00Z",
    ...overrides
  };
}

test("UI availability enforces the full half-open interval by coach and stable account ID", () => {
  const startsAt = "2026-09-20T17:30:00-07:00";
  expect(isParentRequestIntervalUnavailable([booking({ program: "Unavailable" })], "account-a", "Coach Jorden", startsAt, 30)).toBe(true);
  expect(isParentRequestIntervalUnavailable([booking({ status: "club_confirmed" })], "account-a", "Coach Jorden", startsAt, 30)).toBe(true);
  expect(isParentRequestIntervalUnavailable([booking({ studentAccountId: "account-a" })], "account-a", "National B", startsAt, 30)).toBe(true);
  expect(isParentRequestIntervalUnavailable([booking({ status: "cancelled" })], "account-a", "Coach Jorden", startsAt, 30)).toBe(false);
  expect(isParentRequestIntervalUnavailable([booking({ timeLabel: "5 PM - 6 PM" })], "account-a", "Coach Jorden", startsAt, 30)).toBe(true);
  expect(isParentRequestIntervalUnavailable([booking()], "account-a", "National B", startsAt, 30)).toBe(false);
  expect(halfOpenIntervalsOverlap(new Date("2026-09-20T18:00:00-07:00"), new Date("2026-09-20T18:30:00-07:00"), new Date(booking().startsAt), new Date("2026-09-20T18:00:00-07:00"))).toBe(false);
});

test("duplicate display names remain isolated when stable account IDs and coaches differ", () => {
  const existing = booking({ studentAccountId: "account-b", studentName: "Alex Lee", familyName: "Alex Lee" });
  expect(isParentRequestIntervalUnavailable([existing], "account-a", "National B", "2026-09-20T17:30:00-07:00", 30)).toBe(false);
});

test("authoritative RPC is identity-safe, half-open, cancellation-aware, and race-serialized", () => {
  expect(migration).toContain("security invoker");
  expect(migration).toContain("pg_advisory_xact_lock");
  expect(migration).toContain("coalesce(r.values->>'status', '') <> 'cancelled'");
  expect(migration).toContain("(r.values->>'startsAt')::timestamptz < v_end");
  expect(migration).toContain("v_start < public.rswtta_booking_ends_at(r.values)");
  expect(migration).toContain("r.values->>'studentAccountId' = v_account_id::text");
  expect(migration).not.toContain("studentName' =");
  expect(migration).toContain("insert into public.project_rows(id, project_table_id, values)");
  expect(storeSource).toContain("p_request_id: crypto.randomUUID()");
  expect(migration).toContain("if v_start <= clock_timestamp() then");
  expect(migration).toContain("Parent request booking-count baseline guard failed: expected 1985");
  expect(migration).toContain("Class intervals must use 30-minute increments between 30 minutes and 12 hours");
});

test("request modal remains bilingual and collapses to one column on narrow screens", () => {
  const modal = appSource.slice(appSource.indexOf("function ConfirmRequestModal"), appSource.indexOf("function GroupClassRequestModal"));
  const css = readFileSync("app/globals.css", "utf8");
  expect(modal).toContain('"Send this class request?"');
  expect(modal).toContain('"发送这个预约请求？"');
  expect(modal).toContain('"This time is not available."');
  expect(modal).toContain('"这个时间不可预约。"');
  expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.modal-field-grid[\s\S]*?grid-template-columns:\s*1fr/);
});

test("private and Group Parent requests use one accessible top-right close without footer cancellation", () => {
  const privateModal = appSource.slice(appSource.indexOf("function ConfirmRequestModal"), appSource.indexOf("function GroupClassRequestModal"));
  const groupModal = appSource.slice(appSource.indexOf("function GroupClassRequestModal"), appSource.indexOf("function ParentClassActionModal"));
  const css = readFileSync("app/globals.css", "utf8");
  const closeRule = css.match(/\.modal-close-icon \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const focusRule = css.match(/\.modal-close-icon:focus-visible \{([\s\S]*?)\n\}/)?.[1] ?? "";

  expect(privateModal.match(/className="modal-close-icon"/g)).toHaveLength(1);
  expect(privateModal).toContain('type="button" aria-label={copy(language, "Close", "关闭")}');
  expect(privateModal).toContain('<span aria-hidden="true">×</span>');
  expect(privateModal).not.toContain('copy(language, "Cancel", "取消")');
  expect(privateModal).toContain('className="modal-actions single-action"');
  expect(privateModal).toContain("onClick={onConfirm} disabled={saving || unavailable}");

  expect(groupModal.match(/className="modal-close-icon"/g)).toHaveLength(1);
  expect(groupModal).not.toContain('copy(language, "Cancel", "取消")');
  expect(groupModal).not.toContain('copy(language, "Close", "关闭")}</button>');
  expect(groupModal).toContain("onClick={onConfirm} disabled={saving}");
  expect(groupModal).toContain('className="confirm-modal parent-group-request-modal"');

  expect(closeRule).toContain("width: 44px");
  expect(closeRule).toContain("height: 44px");
  expect(closeRule).toContain("position: absolute");
  expect(closeRule).toContain("top: 14px");
  expect(closeRule).toContain("right: 14px");
  expect(focusRule).toContain("outline: 3px solid var(--gold)");
  expect(css).toMatch(/\.parent-request-head \{[\s\S]*?padding-right:\s*58px/);
  expect(css).toMatch(/\.parent-request-modal,[\s\S]*?\.parent-group-request-modal \{[\s\S]*?position:\s*relative/);
});

test("Parent request close paths dismiss, clear selection, and restore duration while Club add stays separate", () => {
  const closeHandler = appSource.slice(appSource.indexOf("function closeParentRequestModal"), appSource.indexOf("function applyParentSession"));
  const parentRequestRender = appSource.slice(appSource.indexOf("{showRequestConfirm && parentPrivateClassRequestsEnabled"), appSource.indexOf("{showTianYeRestriction"));
  const clubAddModal = appSource.slice(appSource.indexOf("function ClubAddClassModal"), appSource.indexOf("function ClubBookingActionModal"));
  const restriction = appSource.slice(appSource.indexOf("function CoachBookingRestrictionNotice"), appSource.indexOf("function ConfirmRequestModal"));

  expect(closeHandler).toContain("setShowRequestConfirm(false)");
  expect(closeHandler).toContain("setSelectedSlots([])");
  expect(closeHandler).toContain("setSelectedDurationMinutes(60)");
  expect(parentRequestRender).toContain("onCancel={closeParentRequestModal}");
  expect(parentRequestRender).toContain("if (saved) closeParentRequestModal()");
  expect(privateModalEscapeAndBackdrop(appSource)).toBe(true);
  expect(clubAddModal).toContain('copy(language, "Cancel", "取消")');
  expect(clubAddModal).not.toContain("parent-request-modal");
  expect(clubAddModal).not.toContain('aria-label={copy(language, "Close", "关闭")}');
  expect(restriction).toContain('role="alertdialog"');
  expect(restriction).toContain('copy(language, "Got it", "知道了")');
  expect(restriction).not.toContain("onConfirm");
});

function privateModalEscapeAndBackdrop(source: string) {
  const modal = source.slice(source.indexOf("function ConfirmRequestModal"), source.indexOf("function GroupClassRequestModal"));
  return modal.includes('event.key === "Escape" && !saving') &&
    modal.includes('event.currentTarget === event.target) onCancel()');
}
