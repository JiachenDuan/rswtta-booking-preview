import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { groupEnrollmentPreflight, isPastActiveGroupBlock, selectGroupEnrollmentTargets } from "../lib/groupOccurrence";
import type { Booking } from "../lib/types";

const now = new Date("2026-09-13T16:00:00.000Z");
function block(overrides: Partial<Booking> = {}): Booking {
  return { id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",seriesId:"series:past",recurrenceOccurrenceId:"series:past@2026-09-01",recurrenceOriginalStartsAt:"2026-09-01T17:00:00.000Z",groupClassId:"group:past",studentName:"Group class",familyName:"Group class",studentEmail:"",phone:"",requestedCoach:"Coach Jorden",assignedCoach:"Coach Jorden",program:"Group class",dateLabel:"2026-09-01",timeLabel:"10 AM - 11 AM",startsAt:"2026-09-01T17:00:00.000Z",priceCents:0,status:"club_confirmed",parentNote:"",createdAt:now.toISOString(),updatedAt:now.toISOString(),...overrides };
}
function enrollment(selected: Booking, status: Booking["status"]="club_confirmed", priceCents=7500): Booking {
  return {...selected,id:crypto.randomUUID(),studentAccountId:"11111111-1111-4111-8111-111111111111",studentName:"Alex Kim",familyName:"Alex Kim",program:"Group enrollment",status,priceCents};
}
const migration=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260913093000_allow_past_single_group_enrollment.sql"),"utf8");
const acceptance=fs.readFileSync(path.join(process.cwd(),"sql/verification/20260913093000_past_group_enrollment.acceptance-rollback.sql"),"utf8");
const recurrenceGuard=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260910200000_recurring_occurrence_identity.sql"),"utf8");
const club=fs.readFileSync(path.join(process.cwd(),"components/ClubApp.tsx"),"utf8");
const store=fs.readFileSync(path.join(process.cwd(),"lib/projectStore.ts"),"utf8");

test("past canonical noncancelled block permits single existing-student selection only",()=>{
  const selected=block();
  expect(isPastActiveGroupBlock(selected,now)).toBe(true);
  expect(selectGroupEnrollmentTargets([selected],selected,"single",now).blocks).toEqual([selected]);
  expect(()=>selectGroupEnrollmentTargets([selected],selected,"future",now)).toThrow(/limited to this group class only/);
  expect(isPastActiveGroupBlock(block({status:"cancelled"}),now)).toBe(false);
  for(const identityField of ["groupClassId","seriesId","recurrenceOccurrenceId","recurrenceOriginalStartsAt"] as const) {
    expect(isPastActiveGroupBlock(block({[identityField]:undefined}),now),identityField).toBe(false);
  }
  expect(()=>selectGroupEnrollmentTargets([selected,block({id:crypto.randomUUID()})],selected,"single",now)).toThrow(/exactly one canonical/);
});

test("client preflight blocks historical duplicates, overlap, and actual capacity",()=>{
  const selected=block() as Booking & {capacity:number}; selected.capacity=1;
  const history=enrollment(selected,"cancelled");
  const active={...enrollment(selected),id:crypto.randomUUID(),studentAccountId:"33333333-3333-4333-8333-333333333333"};
  const overlap={...enrollment({...selected,groupClassId:"other"}),id:crypto.randomUUID(),program:"Private lesson",startsAt:"2026-09-01T17:30:00.000Z",timeLabel:"10:30 AM - 11:30 AM"};
  const plan=groupEnrollmentPreflight([selected,history,active,overlap],selected,history.studentAccountId!);
  expect(plan.blockingReasons).toEqual(expect.arrayContaining([
    expect.stringContaining("active or cancelled"),expect.stringContaining("overlaps"),expect.stringContaining("capacity")
  ]));
});

test("preview derives established price and status without exposing contact",()=>{
  const selected=block({status:"coach_confirmed"});
  const older={...enrollment(selected,"coach_confirmed",7000),createdAt:"2026-08-01T00:00:00.000Z"};
  const latest={...enrollment(selected,"coach_confirmed",7500),createdAt:"2026-09-01T00:00:00.000Z"};
  const plan=groupEnrollmentPreflight([selected,older,latest],selected,"22222222-2222-4222-8222-222222222222");
  expect(plan).toMatchObject({priceCents:7500,status:"coach_confirmed",blockingReasons:[]});
  expect(club).toContain("Backdate an existing student to this historical occurrence only.");
  expect(club).toContain("Billing and CSV eligible rows: +1.");
  expect(club).toContain("No class package credit will be deducted automatically.");
  expect(club).toContain("仅可将现有学生补录到这一次历史团体课。");
  expect(club).toContain("不会自动扣除课包额度");
  expect(club).not.toMatch(/studentDisplayContact\(selectedDropInStudents/);
});

test("one RPC call uses stable account ID, exact snapshot, and one idempotency key",()=>{
  expect(store).toContain("selectGroupEnrollmentTargets(input.bookings");
  expect(store).toContain("p_student_account_id: input.student.id");
  expect(store).toContain("p_expected_blocks: expectedGroupOccurrenceRows(selection.blocks)");
  expect(store).toContain('isTrustedOperatorClientEnabled() ? "operator_add_student_to_group_occurrences" : "add_student_to_group_occurrences"');
  const enrollmentAdapter = store.slice(store.indexOf("export async function addStudentToGroupOccurrencesAtomically"), store.indexOf("export async function authoritativeCurrentTime"));
  expect((enrollmentAdapter.match(/p_idempotency_key: input\.idempotencyKey/g)??[])).toHaveLength(1);
});

test("replacement RPC is transactional, authoritative, race-safe and package-neutral",()=>{
  for(const text of ["begin;","security invoker","Past group enrollment is limited to one occurrence","exactly one canonical group block","Group block changed while adding the student","active or cancelled enrollment history","conflicting class","Group capacity is full","group-add-idempotency:","rswtta:parent-request:student:","group-class:","for update","requestFingerprint","packageDeduction',false","when unique_violation"]){ expect(migration).toContain(text); }
  expect(migration).toContain("case when v_block.values->>'status'='coach_confirmed' then 'coach_confirmed' else 'club_confirmed' end");
  expect(migration).toContain("coalesce(v_price,7500)");
  expect((migration.match(/insert into public\.project_rows\(project_table_id,values\) values\(v_activity/g)??[])).toHaveLength(1);
  expect(migration).not.toMatch(/insert into public\.class_package|update public\.class_package|delete\s+from/i);
});

test("migration freezes production counts and compares complete ordered hashes to private backup",()=>{
  for(const count of ["1993 bookings","65 accounts","66 activity rows","141 group blocks","33 group enrollments","15 past group blocks"]){ expect(migration).toContain(count); }
  expect(migration).toContain("ordered hash changed after backup");
  expect(migration).toContain("private_migration_backups.past_group_manifest_20260913_0952");
});

test("rollback acceptance fixtures satisfy the production recurrence identity guard",()=>{
  for(const productionGuard of [
    "Recurring rows require complete occurrence identity",
    "Occurrence identity requires seriesId",
    "Series, occurrence, original-slot, and group-class identities are immutable"
  ]) expect(recurrenceGuard).toContain(productionGuard);
  expect(acceptance).toContain("Acceptance fixture recurrence identity is incomplete");
  expect(acceptance).toContain("Acceptance conflict fixture immutable recurrence identity changed");
  expect(acceptance).toContain("\"seriesId\":\"series:acceptance:private-conflict\"");
  expect(acceptance).toContain("\"recurrenceOccurrenceId\":\"series:acceptance:private-conflict@2026-08-03T17:30:00.000Z\"");
  expect(acceptance).toContain("\"recurrenceOriginalStartsAt\":\"2026-08-03T17:30:00.000Z\"");
  expect(acceptance.indexOf("Acceptance fixture recurrence identity is incomplete")).toBeLessThan(acceptance.indexOf("select '20000000-0000-4000-8000-000000009303'"));
  expect(acceptance).toContain("Acceptance failed: incomplete occurrence identity accepted");
});
