import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { expectedGroupOccurrenceRows, searchGroupEnrollmentAccounts, selectGroupOccurrenceTargets } from "../lib/groupOccurrence";
import { planRecurringReschedule } from "../lib/recurrence";
import { planClassReportExport } from "../lib/classReport";
import type { Booking, ParentAccount } from "../lib/types";

const now = new Date("2027-01-01T00:00:00.000Z");
const accountA: ParentAccount = { id: "11111111-1111-4111-8111-111111111111", studentName: "Alex Kim", parentName: "Family A", email: "a@example.com", phone: "111", confirmed: true, profileSetupRequired: false, createdAt: now.toISOString() };
const accountB: ParentAccount = { ...accountA, id: "22222222-2222-4222-8222-222222222222", parentName: "Family B", email: "b@example.com" };

function groupBlock(id: string, groupClassId: string, startsAt: string): Booking {
  return {
    id,
    seriesId: "series:group-add",
    recurrenceOccurrenceId: `series:group-add@${startsAt}`,
    recurrenceOriginalStartsAt: startsAt,
    groupClassId,
    studentName: "Group class",
    familyName: "Group class",
    studentEmail: "",
    phone: "",
    requestedCoach: "Coach Jorden",
    assignedCoach: "Coach Jorden",
    program: "Group class",
    dateLabel: startsAt.slice(0, 10),
    timeLabel: "10 AM - 11 AM",
    startsAt,
    priceCents: 0,
    status: "club_confirmed",
    parentNote: "group",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function enrollment(id: string, block: Booking, account = accountA): Booking {
  return {
    ...block,
    id,
    studentAccountId: account.id,
    studentName: account.studentName,
    familyName: account.studentName,
    studentEmail: account.email,
    phone: account.phone,
    program: "Group enrollment",
    priceCents: 7500,
    parentNote: "Added to recurring group class by club."
  };
}

const block1 = groupBlock("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "group:add:1", "2027-02-01T18:00:00.000Z");
const block2 = groupBlock("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "group:add:2", "2027-02-08T18:00:00.000Z");

const migrationPath = path.join(process.cwd(), "supabase/migrations/20260912112000_add_student_to_recurring_group_occurrences.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const store = fs.readFileSync(path.join(process.cwd(), "lib/projectStore.ts"), "utf8");
const club = fs.readFileSync(path.join(process.cwd(), "components/ClubApp.tsx"), "utf8");

test("duplicate display names remain distinct account-ID-backed selector results without contact matching", () => {
  const results = searchGroupEnrollmentAccounts([accountA, accountB], "Alex", new Set());
  expect(results.map((account) => account.id)).toEqual([accountA.id, accountB.id]);
  expect(searchGroupEnrollmentAccounts([accountA, accountB], accountB.id.slice(0, 8), new Set()).map((account) => account.id)).toEqual([accountB.id]);
  expect(searchGroupEnrollmentAccounts([accountA, accountB], "a@example.com", new Set())).toEqual([]);
});

test("single and future scopes send exact immutable block snapshots and account ID", () => {
  const single = selectGroupOccurrenceTargets([block1, block2], block1, "single", now);
  const future = selectGroupOccurrenceTargets([block1, block2], block1, "future", now);
  expect(single.blocks.map((block) => block.id)).toEqual([block1.id]);
  expect(future.blocks.map((block) => block.id)).toEqual([block1.id, block2.id]);
  expect(expectedGroupOccurrenceRows(future.blocks)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: block1.id, groupClassId: block1.groupClassId, seriesId: block1.seriesId, updatedAt: block1.updatedAt }),
    expect.objectContaining({ id: block2.id, recurrenceOriginalStartsAt: block2.recurrenceOriginalStartsAt })
  ]));
  expect(store).toContain("p_student_account_id: input.student.id");
  expect(store).toContain("p_expected_blocks: expectedGroupOccurrenceRows(selection.blocks)");
  expect(store).not.toContain("selectedStudent.studentName");
});

test("server RPC is one transaction with locks, exact scope, idempotency, duplicate, conflict, capacity, and one activity row", () => {
  expect(migration).toContain("create or replace function public.add_student_to_group_occurrences");
  expect(migration).toContain("Group occurrence count changed");
  expect(migration).toContain("Expected group block scope omitted a row");
  expect(migration).toContain("for update");
  expect(migration).toContain("rswtta:parent-request:student:");
  expect(migration).toContain("group-class:");
  expect(migration).toContain("project_rows_active_group_membership_unique");
  expect(migration).toContain("group-add-idempotency:");
  expect(migration).toContain("Student is already a member on:");
  expect(migration).toContain("Student has a conflicting class on:");
  expect(migration).toContain("Group capacity is full on:");
  expect(migration).toContain("Only a future active group class can receive a student");
  expect(migration).toContain("Target scope contains a past, cancelled, completed, or invalid group block");
  expect(migration).toContain("group_student_added");
  expect((migration.match(/insert into public\.project_rows\(project_table_id, values\) values \(v_activity_table_id/g) ?? []).length).toBe(1);
  expect(migration).not.toMatch(/delete\s+from/i);
});

test("new enrollment follows linked group reschedule and preserves stable identity", () => {
  const added = enrollment("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", block1);
  const changes = planRecurringReschedule([block1, block2, added], block1, "2027-02-01T19:00:00.000Z", "future");
  const linked = changes.find((change) => change.id === added.id)!;
  expect(linked.newStartsAt).toBe("2027-02-01T19:00:00.000Z");
  expect(linked.values.groupClassId).toBe(block1.groupClassId);
  expect(linked.values.studentAccountId).toBe(accountA.id);
  expect(migration).toContain("'seriesId', v_block.values->>'seriesId'");
  expect(migration).toContain("'recurrenceOccurrenceId', (v_block.values->>'recurrenceOccurrenceId') || ':student:' || p_student_account_id::text");
});

test("billing/export increases exactly by inserted enrollments with no unresolved rows", () => {
  const before = planClassReportExport({ bookings: [block1, block2], accounts: [accountA], periodStart: new Date("2027-01-01"), periodEnd: new Date("2027-03-01") });
  const added = [enrollment("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", block1), enrollment("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", block2)];
  const after = planClassReportExport({ bookings: [block1, block2, ...added], accounts: [accountA], periodStart: new Date("2027-01-01"), periodEnd: new Date("2027-03-01") });
  expect(after.eligibleSourceCount - before.eligibleSourceCount).toBe(added.length);
  expect(after.exportedLinkedCount).toBe(added.length);
  expect(after.exportedUnresolvedCount).toBe(0);
  expect(after.linkedStudentTotals[0].totalCount).toBe(added.length);
});

test("add-student controls are confined to manageable Club Group blocks and stay out of Parent/private surfaces", () => {
  expect(club).toContain("{manageableGroup ? <div className=\"group-dropin-panel\">");
  expect(club).toContain('"This group class only"');
  expect(club).toContain('"This and future group classes"');
  expect(club).toContain('"Confirm group enrollment"');
  expect(club).toContain("studentAccountDisambiguator");
  expect((club.match(/onAddDropIn=/g) ?? []).length).toBe(1);
  expect(club.indexOf("This and future group classes")).toBeGreaterThan(club.indexOf("if (isGroupClassBlock(booking))"));
});
