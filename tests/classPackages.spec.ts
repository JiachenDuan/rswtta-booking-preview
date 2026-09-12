import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  classPackageAccountRows,
  DEFAULT_PACKAGE_HOURS,
  hoursToMinutes,
  safeAccountSuffix,
  searchClassPackageAccounts
} from "../lib/classPackages";
import type { PackageHoursBalance, ParentAccount } from "../lib/types";

const migration = readFileSync("supabase/migrations/20260912123000_class_package_hours_ledger.sql", "utf8");
const rollback = readFileSync("sql/rollback/20260912123000_class_package_hours_ledger.rollback.sql", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const panel = readFileSync("components/ClassPackagesPanel.tsx", "utf8");

const account = (id: string, studentName: string, profileSetupRequired: boolean): ParentAccount => ({
  id, studentName, preregisteredName: profileSetupRequired ? studentName : undefined,
  parentName: "", email: "", phone: "", confirmed: true, profileSetupRequired,
  createdAt: "2026-09-12T00:00:00.000Z"
});

const accounts = [
  account("account-setup-000001", "Alex", true),
  account("account-ready-000002", "Alex", false),
  account("account-ready-000003", "Maya", false)
];
const balances: PackageHoursBalance[] = [{ studentAccountId: accounts[0].id, balanceMinutes: 600, lastPackageUpdate: "2026-09-12T01:00:00.000Z" }];

test("includes every complete and setup-required account, with missing ledger aggregate exactly zero", () => {
  const rows = classPackageAccountRows(accounts, balances);
  expect(rows.map((row) => row.account.id)).toEqual(accounts.map((item) => item.id));
  expect(rows.find((row) => row.account.profileSetupRequired)?.balanceMinutes).toBe(600);
  expect(rows.find((row) => row.account.id === accounts[1].id)?.balanceMinutes).toBe(0);
  expect(rows.find((row) => row.account.id === accounts[2].id)?.lastUpdatedAt).toBeNull();
});

test("duplicate names remain isolated and search uses permanent account identity", () => {
  const rows = classPackageAccountRows(accounts, balances);
  const alexRows = rows.filter((row) => row.account.studentName === "Alex");
  expect(alexRows).toHaveLength(2);
  expect(alexRows.every((row) => row.duplicateName)).toBeTruthy();
  expect(safeAccountSuffix(alexRows[0].account.id)).not.toBe(safeAccountSuffix(alexRows[1].account.id));
  expect(searchClassPackageAccounts(rows, "000002").map((row) => row.account.id)).toEqual([accounts[1].id]);
  expect(searchClassPackageAccounts(rows, "Maya").map((row) => row.account.id)).toEqual([accounts[2].id]);
});

test("add-hours starts at zero and permits only positive half-hour increments", () => {
  expect(DEFAULT_PACKAGE_HOURS).toBe(0);
  expect(hoursToMinutes(10)).toBe(600);
  expect(hoursToMinutes(0.5)).toBe(30);
  expect(hoursToMinutes(10.5)).toBe(630);
  for (const value of [0, -1, 0.1, 10.25, 500.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => hoursToMinutes(value)).toThrow();
});

test("Club-only bilingual UI omits contacts and acknowledges accepted legacy auth risk", () => {
  const app = readFileSync("components/ClubApp.tsx", "utf8");
  const parentStart = app.indexOf("function ParentApp(");
  const clubStart = app.indexOf("function ClubAppView(");
  expect(app.slice(parentStart, clubStart)).not.toContain("ClassPackagesPanel");
  expect(app.slice(clubStart)).toContain("<ClassPackagesPanel");
  for (const text of ["Class packages", "课时包", "Setup required", "待完善资料", "Profile complete", "资料完整", "Temporary security limitation", "临时安全限制"]) expect(panel).toContain(text);
  const accountRow = panel.slice(panel.indexOf('<article className="package-account-row"'), panel.indexOf("</article>", panel.indexOf('<article className="package-account-row"')));
  expect(accountRow).not.toContain("email");
  expect(accountRow).not.toContain("phone");
});

test("client uses only balance-read and positive add RPCs, never localStorage ledger or mutation paths", () => {
  expect(store).toContain('supabase.rpc("list_class_package_balances")');
  expect(store).toContain('supabase.rpc("add_class_package_hours"');
  expect(store).not.toContain("rswtta-local-package-hours-ledger");
  expect(store.replace(/\s+/g, " ")).not.toMatch(/class_package_hours_ledger.*\.(?:update|delete)\(/);
  expect(panel).toContain("refreshBalances");
});

test("migration stops on exact 73-account baseline and identity hash mismatch", () => {
  expect(migration).toContain("expected 73 accounts");
  expect(migration).toContain("637b4155619fc30b668faacb14550ca2ff0d58698fbb3678d424654ef6f725c1");
  expect(migration).toContain("ab9d8da3-762f-466c-b7ce-fa05088f03cd");
  expect(migration).toContain("8236c8f8-0fab-400c-bedc-143fd5930707");
  expect(migration).toContain("account identity hash changed");
});

test("ledger is append-only, add-only, honest about actor, and directly inaccessible", () => {
  expect(migration).toContain("delta_minutes between 30 and 30000 and delta_minutes % 30 = 0");
  expect(migration).toContain("operation_type = 'package_purchase'");
  expect(migration).toContain("new_balance_minutes = old_balance_minutes + delta_minutes");
  expect(migration).toContain("actor_kind = 'legacy_club_session_unverified'");
  expect(migration).toContain("before update or delete");
  expect(migration).toContain("revoke all on public.class_package_hours_ledger from public, anon, authenticated");
  expect(migration).not.toMatch(/grant (?:select|insert|update|delete).*class_package_hours_ledger/i);
});

test("narrow RPCs derive zeros and serialize transactional idempotent old/new balances", () => {
  expect(migration).toContain("create or replace function public.list_class_package_balances()");
  expect(migration).toContain("coalesce(sum(ledger.delta_minutes), 0)");
  expect(migration).toContain("create or replace function public.add_class_package_hours(");
  expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('rswtta:package:idempotency:'");
  expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('rswtta:package:account:'");
  expect(migration).toContain("idempotency key was already used with different input");
  expect(migration).toContain("v_existing.old_balance_minutes, v_existing.new_balance_minutes");
  expect(migration).toContain("old_balance_minutes bigint");
  expect(migration).toContain("new_balance_minutes bigint");
  expect(migration).toContain("replayed boolean");
  expect(migration).toContain("grant execute on function public.list_class_package_balances() to anon, authenticated");
  expect(migration).toContain("grant execute on function public.add_class_package_hours(uuid, integer, text, text, uuid) to anon, authenticated");
});

test("rollback is idempotent but refuses to destroy an active ledger", () => {
  expect(rollback).toContain("if to_regclass('public.class_package_hours_ledger') is null");
  expect(rollback).toContain("if v_entries <> 0");
  expect(rollback).toContain("preserve data and roll forward instead");
});
