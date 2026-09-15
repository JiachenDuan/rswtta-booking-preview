import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  baseUnitsToDisplay,
  classPackageAccountRows,
  DEFAULT_PACKAGE_OPENING_AMOUNT,
  openingAmountToBaseUnits,
  PACKAGE_CATEGORIES,
  PACKAGE_CATEGORY_LABELS,
  PACKAGE_UNIT_BASIS,
  resolveClassPackageConsumption,
  safeAccountSuffix,
  searchClassPackageAccounts,
  summarizePackageEvents
} from "../lib/classPackages";
import type { Booking, PackageBalance, PackageLedgerEvent, ParentAccount } from "../lib/types";

const migration = readFileSync("supabase/migrations/20260913043700_manage_class_packages.sql", "utf8");
const backup = readFileSync("sql/backups/20260913043700_manage_class_packages.private-backup.sql", "utf8");
const rollback = readFileSync("sql/rollback/20260913043700_manage_class_packages.rollback.sql", "utf8");
const verification = readFileSync("sql/verification/20260913043700_manage_class_packages.verify.sql", "utf8");
const proof = readFileSync("scripts/prove-manage-packages-rollback.sh", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const panel = readFileSync("components/ClassPackagesPanel.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const app = readFileSync("components/ClubApp.tsx", "utf8");

const account = (id: string, studentName: string): ParentAccount => ({ id, studentName, parentName: "", email: "", phone: "", confirmed: true, profileSetupRequired: false, createdAt: "2026-09-12T00:00:00Z" });
const accounts = [account("3a6d38c0-a343-42fe-b373-e1649928041d", "Ella"), account("b8433b38-75f0-4e37-8792-3b952d26c74d", "Ella")];
const balance = (studentAccountId: string, category: PackageBalance["category"], amount: number): PackageBalance => ({
  packageId: `${studentAccountId}:${category}`, studentAccountId, category, unitBasis: PACKAGE_UNIT_BASIS[category],
  openingAmountBaseUnits: amount, adjustmentAmountBaseUnits: 0, usageAmountBaseUnits: 0, remainingAmountBaseUnits: amount,
  version: 1, lastEventAt: "2026-09-12T01:00:00Z"
});
const event = (partial: Partial<PackageLedgerEvent> & Pick<PackageLedgerEvent, "eventType" | "amountBaseUnits" | "version">): PackageLedgerEvent => ({
  eventId: `event-${partial.version}`, packageId: "package-1", studentAccountId: accounts[0].id,
  category: "coach_director_private", unitBasis: "hours", oldOpeningAmountBaseUnits: null, newOpeningAmountBaseUnits: null,
  note: "", reference: "", actorKind: "service_role", createdAt: `2026-09-12T0${partial.version}:00:00Z`, ...partial
});
const booking = (partial: Partial<Booking> = {}): Partial<Booking> => ({
  id: "booking-1", recurrenceOccurrenceId: "occ-stable", studentAccountId: "account-1", assignedCoach: "Coach Jorden",
  program: "Private lesson", timeLabel: "4 PM - 5 PM", startsAt: "2026-09-20T16:00:00-07:00", status: "coach_confirmed", ...partial
});

test("defines canonical categories, explicit unit basis, and bilingual labels", () => {
  expect(PACKAGE_CATEGORIES).toEqual(["coach_director_private", "national_coach_private", "group_class"]);
  expect(PACKAGE_UNIT_BASIS).toEqual({ coach_director_private: "hours", national_coach_private: "hours", group_class: "class_credit" });
  expect(PACKAGE_CATEGORY_LABELS.group_class.zh).toContain("团体课");
});

test("private openings use half-hours while group openings require integer credits", () => {
  expect(DEFAULT_PACKAGE_OPENING_AMOUNT).toBe(0);
  expect(openingAmountToBaseUnits("coach_director_private", 0.5)).toBe(30);
  expect(openingAmountToBaseUnits("national_coach_private", 500)).toBe(30000);
  expect(openingAmountToBaseUnits("group_class", 12)).toBe(12);
  expect(baseUnitsToDisplay("coach_director_private", 90)).toBe("1.5");
  expect(baseUnitsToDisplay("group_class", 90)).toBe("90");
  for (const value of [-0.5, 0.1, 10.25, 500.5, Number.NaN]) expect(() => openingAmountToBaseUnits("coach_director_private", value)).toThrow();
  for (const value of [-1, 0.5, 10001]) expect(() => openingAmountToBaseUnits("group_class", value)).toThrow();
});

test("same-name accounts and categories remain isolated by permanent account ID", () => {
  const rows = classPackageAccountRows(accounts, [balance(accounts[0].id, "coach_director_private", 600), balance(accounts[0].id, "group_class", 9), balance(accounts[1].id, "coach_director_private", 30)]);
  expect(rows[0].packages.coach_director_private.remainingAmountBaseUnits).toBe(600);
  expect(rows[0].packages.national_coach_private.remainingAmountBaseUnits).toBe(0);
  expect(rows[0].packages.group_class.remainingAmountBaseUnits).toBe(9);
  expect(rows[1].packages.coach_director_private.remainingAmountBaseUnits).toBe(30);
  expect(rows.every((row) => row.duplicateName)).toBeTruthy();
  expect(safeAccountSuffix(rows[0].account.id)).not.toBe(safeAccountSuffix(rows[1].account.id));
  expect(searchClassPackageAccounts(rows, "b8433b").map((row) => row.account.id)).toEqual([accounts[1].id]);
});

test("event history preserves base units, category isolation, usage, and versions", () => {
  expect(summarizePackageEvents([
    event({ eventType: "opening_set", amountBaseUnits: 600, oldOpeningAmountBaseUnits: 0, newOpeningAmountBaseUnits: 600, version: 1 }),
    event({ eventType: "usage", amountBaseUnits: -90, version: 2 }),
    event({ eventType: "adjustment", amountBaseUnits: 30, version: 3 }),
    event({ eventType: "opening_set", amountBaseUnits: -120, oldOpeningAmountBaseUnits: 600, newOpeningAmountBaseUnits: 480, version: 4 })
  ])).toEqual({ openingAmountBaseUnits: 480, adjustmentAmountBaseUnits: 30, usageAmountBaseUnits: 90, remainingAmountBaseUnits: 420, version: 4 });
  expect(() => summarizePackageEvents([event({ eventType: "usage", amountBaseUnits: -30, version: 2 })])).toThrow(/contiguous/);
  expect(() => summarizePackageEvents([event({ eventType: "opening_set", amountBaseUnits: 1, oldOpeningAmountBaseUnits: 0, newOpeningAmountBaseUnits: 1, version: 1, category: "group_class" })])).toThrow(/mismatch/);
});

test("Tian Ye immutable ID and reviewed aliases resolve to director private", () => {
  expect(resolveClassPackageConsumption(booking({ assignedCoachId: "coach_tian_ye", assignedCoach: "Unrelated Name" })).category).toBe("coach_director_private");
  for (const name of ["Coach Tian Ye", "Tian Ye", "Tianye", "Tian-Ye", "Coach.Tian Ye", " Head  Coach Tian "]) {
    expect(resolveClassPackageConsumption(booking({ assignedCoach: name })).category).toBe("coach_director_private");
  }
  expect(resolveClassPackageConsumption(booking({ assignedCoach: "Tian Younger" })).category).toBe("national_coach_private");
});

test("explicit immutable non-Tian coach ID wins over a Tian-like display name", () => {
  const result = resolveClassPackageConsumption(booking({ assignedCoachId: "coach_jorden", assignedCoach: "Coach Tian Ye" }));
  expect(result.category).toBe("national_coach_private");
});

test("other private coaches resolve to national coach with exact duration", () => {
  for (const coach of ["Coach Jorden", "National A", "National B"]) {
    expect(resolveClassPackageConsumption(booking({ assignedCoach: coach, timeLabel: "4 PM - 5 PM" }))).toMatchObject({ category: "national_coach_private", unitBasis: "hours", consumptionAmount: 1, amountBaseUnits: 60 });
    expect(resolveClassPackageConsumption(booking({ assignedCoach: coach, timeLabel: "6:30 PM - 8 PM" }))).toMatchObject({ consumptionAmount: 1.5, amountBaseUnits: 90 });
  }
});

test("group classification precedes coach and always consumes exactly one credit", () => {
  for (const value of [booking({ groupClassId: "group-1", assignedCoachId: "coach_tian_ye", timeLabel: "10 AM - 12 PM" }), booking({ program: "Group class", timeLabel: "6:30 PM - 7 PM" }), booking({ program: "Group enrollment", timeLabel: "garbage" })]) {
    expect(resolveClassPackageConsumption(value)).toMatchObject({ category: "group_class", unitBasis: "class_credit", consumptionAmount: 1, amountBaseUnits: 1 });
  }
});

test("ambiguous Group lesson is private unless immutable groupClassId exists", () => {
  expect(resolveClassPackageConsumption(booking({ program: "Group lesson" })).category).toBe("national_coach_private");
  expect(resolveClassPackageConsumption(booking({ program: "Group lesson", groupClassId: "group-1" })).category).toBe("group_class");
});

test("private resolver rejects missing coach, duration, startsAt, nonpositive, sub-minute, and overnight-like durations", () => {
  expect(resolveClassPackageConsumption(booking({ assignedCoach: "", requestedCoach: "" })).reason).toBe("missing_coach");
  for (const timeLabel of ["", "90 minutes", "1h", "4 PM - 4 PM", "11 PM - 1 AM", "13 PM - 2 PM", "4:60 PM - 5 PM"]) expect(resolveClassPackageConsumption(booking({ timeLabel })).reason).toBe("invalid_duration");
  expect(resolveClassPackageConsumption(booking({ startsAt: "" })).reason).toBe("missing_starts_at");
  expect(resolveClassPackageConsumption(booking({ startsAt: "not-a-date" })).reason).toBe("missing_starts_at");
});

test("moved booking uses current duration while stable occurrence ID prevents identity drift", () => {
  const moved = resolveClassPackageConsumption(booking({ recurrenceOccurrenceId: "original-occurrence", recurrenceOriginalStartsAt: "2026-09-01T16:00:00Z", startsAt: "2026-09-22T19:00:00Z", timeLabel: "7 PM - 8:30 PM" }));
  expect(moved).toMatchObject({ stableOccurrenceId: "original-occurrence", consumptionAmount: 1.5, amountBaseUnits: 90 });
});

test("only coach-confirmed completed booking is eligible and resolver never debits", () => {
  expect(resolveClassPackageConsumption(booking({ status: "coach_confirmed" }))).toMatchObject({ eligible: true, reason: "eligible" });
  for (const status of ["cancelled", "club_confirmed", "requested", "change_requested"] as const) expect(resolveClassPackageConsumption(booking({ status }))).toMatchObject({ eligible: false, reason: "ineligible_status" });
  const resolverBody = migration.slice(migration.indexOf("create or replace function public.resolve_class_package_consumption"), migration.indexOf("comment on function public.resolve_class_package_consumption"));
  expect(resolverBody).not.toMatch(/insert|update|delete|class_package_events/i);
  expect(store).not.toContain('rpc("resolve_class_package_consumption"');
  expect(`${app}\n${store}`).not.toMatch(/(?:package|classPackage).*(?:usage|debit)|(?:usage|debit).*(?:package|classPackage)/i);
  expect(migration).not.toMatch(/create\s+trigger[\s\S]{0,300}(?:project_rows|bookings)/i);
});

test("migration retains production guards and old zero-ledger stop", () => {
  for (const value of ["expected 65 accounts", "expected 1978 bookings", "expected zero legacy package rows", accounts[0].id, accounts[1].id, "889ef52e232d48fec0a2da04bf33992a"]) expect(migration).toContain(value);
  expect(migration).toContain("stop rather than infer a category");
  expect(migration).not.toMatch(/(?:update|delete|insert into)\s+public\.project_rows/i);
});

test("schema stores and enforces canonical category plus unit basis", () => {
  expect(migration).toContain("class_package_keys_category_unit");
  expect(migration).toContain("class_package_events_key_identity");
  expect(migration).toContain("amount_base_units");
  expect(migration).not.toContain("amount_minutes");
  expect(migration).toContain("class_package_events_package_version unique (package_id, version)");
  expect(migration).toContain("class_package_events_idempotency unique (project_id, idempotency_key)");
});

test("authoritative SQL resolver is immutable, group-first, alias-reviewed, ACL-restricted, and non-debiting", () => {
  expect(migration).toContain("resolve_class_package_consumption(p_booking jsonb)");
  expect(migration).toContain("language plpgsql immutable");
  expect(migration).toContain("regexp_match(v_label");
  expect(migration).toContain("'coachtianye','tianye','coachtian','headcoachtian'");
  expect(migration.indexOf("if v_group_id is not null")).toBeLessThan(migration.indexOf("if v_coach_id is not null"));
  expect(migration).toContain("revoke all on function public.resolve_class_package_consumption(jsonb) from public, anon, authenticated");
  expect(migration).toContain("grant execute on function public.resolve_class_package_consumption(jsonb) to service_role");
});

test("opening RPC preserves stale, idempotency, category, unit, and account isolation", () => {
  for (const text of ["rswtta:package:v2:idempotency:", "rswtta:package:v2:account-category:", "stale package opening: expected opening/version", "idempotency key was already used with different input", "stored category/unit basis mismatch", "legacy_club_session_unverified"]) expect(migration).toContain(text);
  expect(migration).toContain("on conflict on constraint class_package_keys_account_category do nothing");
  expect(migration).toContain("where e.package_id=v_package.id");
  expect(migration).not.toContain("on conflict(project_id,student_account_id,category)");
  expect(store).toContain('isTrustedOperatorClientEnabled() ? "operator_set_class_package_opening" : "set_class_package_opening"');
  expect(store).toContain("p_unit_basis: unitBasis");
});

test("private backup, rollback, verification, and proof cover revised resolver and schema", () => {
  expect(backup).toContain("club_package_manifest_20260913_0437");
  expect(backup).toContain("resolve_class_package_consumption");
  expect(backup).toContain("('legacy_ledger_count', '0')");
  expect(rollback).toContain("preserve history and roll forward instead");
  expect(rollback).toContain("resolve_class_package_consumption(jsonb)");
  expect(verification).toContain("coach_director_private");
  expect(verification).toContain("class_credit");
  expect(verification).toContain("resolve_class_package_consumption");
  expect(proof).toContain("rollback_proof=passed");
});

test("Club-only bilingual UI labels hours and class credits without touching Parent app", () => {
  const parentStart = app.indexOf("function ParentApp(");
  const clubStart = app.indexOf("function ClubAppView(");
  expect(app.slice(parentStart, clubStart)).not.toContain("ClassPackagesPanel");
  expect(app.slice(clubStart)).toContain("<ClassPackagesPanel");
  for (const text of ["Manage packages", "管理课时包", "hours", "小时", "class credits", "团体课次数", "0.5-hour", "非负整数"]) expect(panel).toContain(text);
  expect(css).toContain("@media (max-width: 900px)");
  expect(css).toContain("@media (max-width: 560px)");
});

test("package management leaves billing, activity, and exports untouched", () => {
  expect(store).toContain("export async function listActivityLogs()");
  expect(store).toContain("export async function createBillNotification");
  expect(app).toContain("classReportBillingReconciliationRows(reportPlan)");
  expect(migration).not.toMatch(/(?:update|delete|insert into)\s+public\.(?:bill_notifications|activity_logs)/i);
});
