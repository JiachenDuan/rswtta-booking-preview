import { expect, test } from "@playwright/test";
import { parentCancellationActivityMessage } from "../lib/activityLog";

const scheduledClass = {
  studentName: "Ethan Chen",
  dateLabel: "Sep 12, 2026",
  timeLabel: "4:30 PM - 5:30 PM"
};

test("parent private cancellation activity identifies actor, class type, student, coach, and schedule", () => {
  expect(parentCancellationActivityMessage(scheduledClass, "Tian Ye", false, "en")).toBe(
    "Parent/student cancelled private class: Ethan Chen with Tian Ye, scheduled Sep 12, 2026 4:30 PM - 5:30 PM."
  );
});

test("parent group leave activity identifies actor, class type, student, coach, and schedule", () => {
  expect(parentCancellationActivityMessage(scheduledClass, "Jorden", true, "en")).toBe(
    "Parent/student left group class: Ethan Chen with Jorden, scheduled Sep 12, 2026 4:30 PM - 5:30 PM."
  );
});
