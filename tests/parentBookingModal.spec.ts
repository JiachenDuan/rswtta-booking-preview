import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const source = readFileSync("components/ClubApp.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const parentApp = source.slice(source.indexOf("function ParentApp"), source.indexOf("function CalendarControls"));
const groupRequestModal = source.slice(source.indexOf("function GroupClassRequestModal"), source.indexOf("function BookingList"));
const bookingList = source.slice(source.indexOf("function BookingList"));

test("My Classes is presentation-only for every status and date", () => {
  expect(parentApp).toContain('<BookingList bookings={filteredClassBookings} language={language} />');
  expect(bookingList).toContain("booking.studentName");
  expect(bookingList).toContain("booking.dateLabel");
  expect(bookingList).toContain("booking.timeLabel");
  expect(bookingList).toContain("statusText(booking.status, language)");
  expect(bookingList).not.toContain("onClick");
  expect(bookingList).not.toContain("Cancel class");
  expect(bookingList).not.toContain("modal-warning");
  expect(bookingList).not.toContain("row-actions");
});

test("parent class calendar cards cannot open a class-action modal", () => {
  expect(source).not.toContain("function ParentClassCompleteModal");
  expect(source).not.toContain("selectedParentBooking");
  expect(parentApp).toContain("isBookingActionable={isGroupClassBlock}");
  expect(parentApp).not.toContain("setSelectedParentBooking");
  expect(parentApp).not.toContain("parentCancellationBlockReason");
  expect(parentApp).toContain('copy(language, "View class details and status.", "查看课程详情和状态。")');
});

test("existing group enrollments expose no parent leave or cancellation action", () => {
  expect(groupRequestModal).toContain("hasExistingEnrollment");
  expect(groupRequestModal).not.toContain("Leave group class");
  expect(groupRequestModal).not.toContain("onCancelEnrollment");
  expect(groupRequestModal).not.toContain("parentCancellationWarning");
  expect(groupRequestModal).toContain('copy(language, "Close", "关闭")');
});

test("the existing accessible top-right close style remains available to legitimate action modals", () => {
  const closeRule = css.match(/\.modal-close-icon \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const focusRule = css.match(/\.modal-close-icon:focus-visible \{([\s\S]*?)\n\}/)?.[1] ?? "";

  expect(source).toContain('className="modal-close-icon" type="button" aria-label="Close"');
  expect(closeRule).toContain("width: 44px");
  expect(closeRule).toContain("height: 44px");
  expect(focusRule).toContain("outline: 3px solid var(--gold)");
});
