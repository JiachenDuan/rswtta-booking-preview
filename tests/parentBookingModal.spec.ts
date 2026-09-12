import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const source = readFileSync("components/ClubApp.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const parentApp = source.slice(source.indexOf("function ParentApp"), source.indexOf("function CalendarControls"));
const classActionsModal = source.slice(source.indexOf("function ParentClassActionModal"), source.indexOf("function BookingList"));
const groupRequestModal = source.slice(source.indexOf("function GroupClassRequestModal"), source.indexOf("function ParentClassActionModal"));
const bookingList = source.slice(source.indexOf("function BookingList"));

test("Calendar and My Classes remain explicitly separated action surfaces", () => {
  expect(parentApp).toContain("isGroupClassBlock(booking) || canParentRequestChange(booking)");
  expect(parentApp).toContain("setSelectedParentBooking(booking)");
  expect(parentApp).toContain("<ParentClassActionModal");
  expect(parentApp).toContain('<BookingList bookings={filteredClassBookings} language={language} />');
  expect(bookingList).toContain("booking.studentName");
  expect(bookingList).toContain("statusText(booking.status, language)");
  expect(bookingList).not.toContain("onClick");
  expect(bookingList).not.toContain("Cancel class");
  expect(bookingList).not.toContain("modal-warning");
  expect(bookingList).not.toContain("row-actions");
});

test("Calendar Class Actions restores Mark complete and conditionally renders cancellation", () => {
  expect(classActionsModal).toContain("parentCancellationBlockReason(booking, now)");
  expect(classActionsModal).toContain('className={`modal-actions ${!canCancel ? "single-action" : ""}`}');
  expect(classActionsModal).toContain("{canCancel ? (");
  expect(classActionsModal).toContain('copy(language, "Cancel class", "取消课程")');
  expect(classActionsModal).not.toContain("disabled={!canCancel}");
  expect(classActionsModal).toContain('copy(language, "Mark complete", "标记完成")');
  expect(classActionsModal).toContain("disabled={!canComplete} onClick={onComplete}");
  expect(css).toMatch(/\.modal-actions\.single-action \{[\s\S]*?grid-template-columns: 1fr;/);
});

test("Calendar Class Actions uses one accessible top-right × and no bottom Close text button", () => {
  const closeRule = css.match(/\.modal-close-icon \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const focusRule = css.match(/\.modal-close-icon:focus-visible \{([\s\S]*?)\n\}/)?.[1] ?? "";
  expect(classActionsModal).toContain('className="modal-close-icon" type="button" aria-label="Close" onClick={onClose}');
  expect(classActionsModal).toContain('<span aria-hidden="true">×</span>');
  expect(classActionsModal).not.toContain('copy(language, "Close", "关闭")');
  expect(classActionsModal.match(/aria-label="Close"/g)).toHaveLength(1);
  expect(closeRule).toContain("width: 44px");
  expect(closeRule).toContain("height: 44px");
  expect(focusRule).toContain("outline: 3px solid var(--gold)");
});

test("existing group enrollments remain read-only without a leave action", () => {
  expect(groupRequestModal).toContain("hasExistingEnrollment");
  expect(groupRequestModal).not.toContain("Leave group class");
  expect(groupRequestModal).not.toContain("onCancelEnrollment");
  expect(groupRequestModal).toContain('type="button" aria-label={copy(language, "Close", "关闭")}');
  expect(groupRequestModal).not.toContain('copy(language, "Close", "关闭")}</button>');
});
