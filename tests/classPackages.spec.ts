import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  classPackageAccountRows,
  DEFAULT_PACKAGE_OPENING_HOURS,
  openingHoursToMinutes,
  PACKAGE_CATEGORIES,
  PACKAGE_CATEGORY_LABELS,
  safeAccountSuffix,
  searchClassPackageAccounts,
  summarizePackageEvents
} from "../lib/classPackages";
import type { PackageBalance, PackageLedgerEvent, ParentAccount } from "../lib/types";

const migration = readFileSync("supabase/migrations/20260913043700_manage_class_packages.sql", "utf8");
const backup = readFileSync("sql/backups/20260913043700_manage_class_packages.private-backup.sql", "utf8");
const rollback = readFileSync("sql/rollback/20260913043700_manage_class_packages.rollback.sql", "utf8");
const proof = readFileSync("scripts/prove-manage-packages-rollback.sh", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const panel = readFileSync("components/ClassPackagesPanel.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const app = readFileSync("components/ClubApp.tsx", "utf8");

const account = (id: string, studentName: string): ParentAccount => ({
  id, studentName, parentName: "", email: "", phone: "", confirmed: true,
  profileSetupRequired: false, createdAt: "2026-09-12T00:00:00.000Z"
});
const accounts = [account("3a6d38c0-a343-42fe-b373-e1649928041d", "Ella"), account("b8433b38-75f0-4e37-8792-3b952d26c74d", "Ella")];
const balance = (studentAccountId: string, category: PackageBalance["category"], remainingMinutes: number): PackageBalance => ({
  packageId: `${studentAccountId}:${category}`, studentAccountId, category,
  openingMinutes: remainingMinutes, adjustmentMinutes: 0, usageMinutes: 0,
  remainingMinutes, version: 1, lastEventAt: "2026-09-12T01:00:00.000Z"
});
const event = (partial: Partial<PackageLedgerEvent> & Pick<PackageLedgerEvent, "eventType" | "amountMinutes" | "version">): PackageLedgerEvent => ({
  eventId: `event-${partial.version}`, packageId: "package-1", studentAccountId: accounts[0].id,
  category: "coach_director", oldOpeningMinutes: null, newOpeningMinutes: null,
  note: "", reference: "", actorKind: "service_role", createdAt: `2026-09-12T0${partial.version}:00:00Z`, ...partial
});

test("defines exactly the three selected bilingual package categories", () => {
  expect(PACKAGE_CATEGORIES).toEqual(["coach_director", "national_coach", "group_class"]);
  expect(PACKAGE_CATEGORY_LABELS).toEqual({
    coach_director: { en: "Coach Director prepaid package", zh: "教练主管预付课时包" },
    national_coach: { en: "National Coach package", zh: "国家级教练课时包" },
    group_class: { en: "Group Class package", zh: "团体课课时包" }
  });
});

test("same account categories and duplicate-name accounts remain isolated by permanent ID", () => {
  const rows = classPackageAccountRows(accounts, [
    balance(accounts[0].id, "coach_director", 600),
    balance(accounts[0].id, "group_class", 90),
    balance(accounts[1].id, "coach_director", 30)
  ]);
  expect(rows[0].packages.coach_director.remainingMinutes).toBe(600);
  expect(rows[0].packages.national_coach.remainingMinutes).toBe(0);
  expect(rows[0].packages.group_class.remainingMinutes).toBe(90);
  expect(rows[1].packages.coach_director.remainingMinutes).toBe(30);
  expect(rows.every((row) => row.duplicateName)).toBeTruthy();
  expect(safeAccountSuffix(rows[0].account.id)).not.toBe(safeAccountSuffix(rows[1].account.id));
  expect(searchClassPackageAccounts(rows, "b8433b").map((row) => row.account.id)).toEqual([accounts[1].id]);
});

test("opening accepts zero and only nonnegative half-hour increments", () => {
  expect(DEFAULT_PACKAGE_OPENING_HOURS).toBe(0);
  expect(openingHoursToMinutes(0)).toBe(0);
  expect(openingHoursToMinutes(0.5)).toBe(30);
  expect(openingHoursToMinutes(500)).toBe(30000);
  for (const value of [-0.5, 0.1, 10.25, 500.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => openingHoursToMinutes(value)).toThrow();
});

test("append-only opening up/down preserves adjustments and explicit usage", () => {
  const totals = summarizePackageEvents([
    event({ eventType: "opening_set", amountMinutes: 600, oldOpeningMinutes: 0, newOpeningMinutes: 600, version: 1 }),
    event({ eventType: "usage", amountMinutes: -90, version: 2 }),
    event({ eventType: "adjustment", amountMinutes: 30, version: 3 }),
    event({ eventType: "opening_set", amountMinutes: -120, oldOpeningMinutes: 600, newOpeningMinutes: 480, version: 4 })
  ]);
  expect(totals).toEqual({ openingMinutes: 480, adjustmentMinutes: 30, usageMinutes: 90, remainingMinutes: 420, version: 4 });
});

test("event reducer rejects stale or missing versions", () => {
  expect(() => summarizePackageEvents([event({ eventType: "opening_set", amountMinutes: 30, oldOpeningMinutes: 60, newOpeningMinutes: 90, version: 1 })])).toThrow(/stale/);
  expect(() => summarizePackageEvents([event({ eventType: "usage", amountMinutes: -30, version: 2 })])).toThrow(/contiguous/);
});

test("migration freezes supplied production IDs, counts, page hashes, and zero ledgers", () => {
  for (const value of [
    "ab9d8da3-762f-466c-b7ce-fa05088f03cd", "8236c8f8-0fab-400c-bedc-143fd5930707", "expected 65 accounts", "expected 1978 bookings",
    "889ef52e232d48fec0a2da04bf33992a", "cb9afd75e44d3e82472df227e20906b4", "39d959e808832d51416426eb12e4a92f",
    "0b91e1fc9c8c0eaf07843eaf688af463", "b7481b76c02d0031443cf41335b17e5b", "c4e86cb519690b3fc148265ac0d80a73",
    accounts[0].id, accounts[1].id, "expected zero legacy package rows"
  ]) expect(migration).toContain(value);
  expect(migration).toContain("stop rather than infer a category");
  expect(migration.replace(/\s+/g, " ")).not.toMatch(/from public\.project_rows[^;]+(?:program|assignedCoach|Group lesson)/);
});

test("normalized SQL prevents duplicate keys and makes events immutable with locked ACL/RLS", () => {
  expect(migration).toContain("class_package_keys_account_category unique (project_id, student_account_id, category)");
  expect(migration).toContain("class_package_events_package_version unique (package_id, version)");
  expect(migration).toContain("class_package_events_idempotency unique (project_id, idempotency_key)");
  expect(migration).toContain("before update or delete on public.class_package_events");
  expect(migration).toContain("alter table public.class_package_events enable row level security");
  expect(migration).toContain("revoke all on public.class_package_keys, public.class_package_events from public, anon, authenticated");
  expect(migration).toContain("grant select, insert on public.class_package_keys, public.class_package_events to service_role");
  expect(migration).not.toMatch(/grant (?:select|insert|update|delete).*class_package_(?:keys|events).*\b(?:anon|authenticated)\b/i);
});

test("opening RPC serializes account/category and idempotency with stale and replay mismatch checks", () => {
  expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('rswtta:package:v2:idempotency:'");
  expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('rswtta:package:v2:account-category:'");
  expect(migration).toContain("stale package opening: expected opening/version");
  expect(migration).toContain("idempotency key was already used with different input");
  expect(migration).toContain("old_remaining_minutes bigint, new_remaining_minutes bigint");
  expect(migration).toContain("actor_kind");
  expect(migration).toContain("'legacy_club_session_unverified'");
  expect(migration).toContain("security definer set search_path = public, pg_temp");
  expect(migration).toContain("SECURITY DEFINER owner is not postgres");
});

test("old undifferentiated RPC is disabled while narrow category RPCs are exposed", () => {
  expect(migration).toContain("revoke execute on function public.add_class_package_hours(uuid, integer, text, text, uuid) from anon, authenticated");
  expect(migration).toContain("grant execute on function public.list_class_package_balances_v2() to anon, authenticated");
  expect(migration).toContain("grant execute on function public.list_class_package_history(uuid, text) to anon, authenticated");
  expect(store).toContain('supabase.rpc("list_class_package_balances_v2")');
  expect(store).toContain('supabase.rpc("list_class_package_history"');
  expect(store).toContain('supabase.rpc("set_class_package_opening"');
  expect(store).not.toContain('supabase.rpc("add_class_package_hours"');
});

test("private backup is timestamped, inaccessible to browser roles, verified, and carries the audit manifest", () => {
  expect(backup).toContain("club_package_accounts_20260913_0437");
  expect(backup).toContain("club_package_legacy_ledger_20260913_0437");
  expect(backup).toContain("club_package_catalog_20260913_0437");
  expect(backup).toContain("revoke all on schema private_migration_backups from public, anon, authenticated");
  expect(backup).toContain("v_backup_hash is distinct from v_source_hash");
  expect(backup).toContain("('legacy_ledger_count', '0')");
});

test("rollback and disposable proof refuse data loss and verify complete absence", () => {
  expect(rollback).toContain("v_keys <> 0 or v_events <> 0");
  expect(rollback).toContain("preserve history and roll forward instead");
  expect(proof).toContain("MANAGE_PACKAGES_DISPOSABLE_CONFIRM");
  expect(proof).toContain("source.count(needle) != 1");
  expect(proof).toContain("rollback_proof=passed");
});

test("Club-only bilingual UI exposes opening/adjustment/usage/remaining/history on mobile and desktop", () => {
  const parentStart = app.indexOf("function ParentApp(");
  const clubStart = app.indexOf("function ClubAppView(");
  expect(app.slice(parentStart, clubStart)).not.toContain("ClassPackagesPanel");
  expect(app.slice(clubStart)).toContain("<ClassPackagesPanel");
  for (const text of ["Manage packages", "管理课时包", "Opening", "期初", "Adjustments", "调整", "Explicit usage", "明确使用", "Remaining", "剩余", "History", "历史记录", "Zero is valid", "零有效"]) expect(panel).toContain(text);
  expect(panel).toContain("data-account-id");
  expect(panel).toContain("data-package-category");
  expect(css).toContain("@media (max-width: 900px)");
  expect(css).toContain("@media (max-width: 560px)");
});

test("package management does not alter activity, export, billing, contacts, or Parent surfaces", () => {
  const packageSection = panel.slice(panel.indexOf('<section className="class-packages"'));
  expect(packageSection).not.toContain("email");
  expect(packageSection).not.toContain("phone");
  expect(store).toContain("export async function listActivityLogs()");
  expect(store).toContain("export async function createBillNotification");
  expect(app).toContain("classReportBillingReconciliationRows(reportPlan)");
  expect(migration).not.toMatch(/(?:update|delete|insert into)\s+public\.project_rows/i);
  expect(migration).not.toMatch(/(?:update|delete|insert into)\s+public\.(?:bill_notifications|activity_logs)/i);
});
