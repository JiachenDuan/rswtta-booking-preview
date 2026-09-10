import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const source = readFileSync("components/ClubApp.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const classActionsModal = source.slice(
  source.indexOf("function ParentClassCompleteModal"),
  source.indexOf("function BookingList")
);
const groupRequestModal = source.slice(
  source.indexOf("function GroupClassRequestModal"),
  source.indexOf("function ParentClassCompleteModal")
);

test("Class Actions modal replaces the bottom text Close with one accessible top-right ×", () => {
  expect(classActionsModal).toContain('className="confirm-modal class-action-modal"');
  expect(classActionsModal).toContain('className="modal-close-icon" type="button" aria-label="Close" onClick={onClose}');
  expect(classActionsModal).toContain('<span aria-hidden="true">×</span>');
  expect(classActionsModal).not.toContain('copy(language, "Close", "关闭")');
  expect(classActionsModal.match(/aria-label="Close"/g)).toHaveLength(1);
});

test("Class Actions hides blocked cancellation while preserving the bilingual actions and Complete footer", () => {
  expect(classActionsModal).toContain('className={`modal-actions ${!canCancel ? "single-action" : ""}`}');
  expect(classActionsModal).toContain('{canCancel ? (');
  expect(classActionsModal).toContain('copy(language, "Cancel class", "取消课程")');
  expect(classActionsModal).toContain('copy(language, "Complete", "完成")');
  expect(classActionsModal).not.toContain("disabled={!canCancel}");
  expect(classActionsModal).toContain("disabled={!canComplete} onClick={onComplete}");
  expect(css).toMatch(/\.modal-actions \{[\s\S]*?grid-template-columns: 1fr 1fr;[\s\S]*?gap: 10px;/);
  expect(css).toMatch(/\.modal-actions\.single-action \{[\s\S]*?grid-template-columns: 1fr;/);
});

test("close control has a 44px target, safe title spacing, and visible keyboard focus", () => {
  const closeRule = css.match(/\.modal-close-icon \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const focusRule = css.match(/\.modal-close-icon:focus-visible \{([\s\S]*?)\n\}/)?.[1] ?? "";

  expect(closeRule).toContain("position: absolute");
  expect(closeRule).toContain("top: 14px");
  expect(closeRule).toContain("right: 14px");
  expect(closeRule).toContain("width: 44px");
  expect(closeRule).toContain("height: 44px");
  expect(closeRule).toContain("padding: 0");
  expect(css).toMatch(/\.class-action-head \{[\s\S]*?padding-right: 52px;/);
  expect(focusRule).toContain("outline: 3px solid var(--gold)");
  expect(focusRule).toContain("outline-offset: 3px");
});

test("other parent booking dialogs remain outside the screenshot-scoped change", () => {
  expect(groupRequestModal).not.toContain('className="modal-close-icon"');
  expect(groupRequestModal).toContain('copy(language, "Close", "关闭")');
});
