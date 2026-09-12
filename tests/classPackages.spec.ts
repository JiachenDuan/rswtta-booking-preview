import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  appendPackageLedgerEntry,
  classPackageAccountRows,
  DEFAULT_PACKAGE_HOURS,
  hoursToMinutes,
  packageBalanceMinutes,
  safeAccountSuffix,
  searchClassPackageAccounts
} from "../lib/classPackages";
import type { PackageHoursLedgerEntry, ParentAccount } from "../lib/types";

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

const entry = (overrides: Partial<PackageHoursLedgerEntry> = {}): PackageHoursLedgerEntry => ({
  id: "ledger-1", studentAccountId: accounts[0].id, deltaMinutes: 600,
  operationType: "package_purchase", actorId: "club-1", actorType: "club_user",
  note: "", reference: "", idempotencyKey: "idem-1",
  createdAt: "2026-09-12T01:00:00.000Z", ...overrides
});

test("includes every complete and setup-required account, with an empty ledger balance of zero", () => {
  const rows = classPackageAccountRows(accounts, [entry()]);
  expect(rows.map((row) => row.account.id)).toEqual(accounts.map((item) => item.id));
  expect(rows.find((row) => row.account.profileSetupRequired)?.balanceMinutes).toBe(600);
  expect(rows.find((row) => row.account.id === accounts[1].id)?.balanceMinutes).toBe(0);
  expect(rows.find((row) => row.account.id === accounts[2].id)?.lastUpdatedAt).toBeNull();
});

test("duplicate names remain isolated by permanent ID and use safe suffixes", () => {
  const rows = classPackageAccountRows(accounts, [entry()]);
  const alexRows = rows.filter((row) => row.account.studentName === "Alex");
  expect(alexRows).toHaveLength(2);
  expect(alexRows.every((row) => row.duplicateName)).toBeTruthy();
  expect(safeAccountSuffix(alexRows[0].account.id)).not.toBe(safeAccountSuffix(alexRows[1].account.id));
  expect(packageBalanceMinutes([entry()], accounts[1].id)).toBe(0);
  expect(searchClassPackageAccounts(rows, "000002").map((row) => row.account.id)).toEqual([accounts[1].id]);
  expect(searchClassPackageAccounts(rows, "Maya").map((row) => row.account.id)).toEqual([accounts[2].id]);
});

test("add-hours starts at zero and integer-minute conversion requires a positive safe increment", () => {
  expect(DEFAULT_PACKAGE_HOURS).toBe(0);
  expect(hoursToMinutes(10)).toBe(600);
  expect(hoursToMinutes(0.5)).toBe(30);
  expect(hoursToMinutes(10.5)).toBe(630);
  for (const value of [0, -1, 0.1, 10.25, 500.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => hoursToMinutes(value)).toThrow();
  }
});

test("ledger append is immutable/idempotent and corrections are compensating entries", () => {
  const first = appendPackageLedgerEntry([], entry({ id: "one" }));
  expect(first.inserted).toBeTruthy();
  const replay = appendPackageLedgerEntry(first.entries, entry({ id: "different-id", deltaMinutes: 1200 }));
  expect(replay.inserted).toBeFalsy();
  expect(replay.entries).toEqual(first.entries);

  const correction = appendPackageLedgerEntry(first.entries, entry({
    id: "two", idempotencyKey: "idem-2", operationType: "correction", deltaMinutes: -60,
    createdAt: "2026-09-12T02:00:00.000Z"
  }));
  expect(first.entries[0].deltaMinutes).toBe(600);
  expect(correction.entries).toHaveLength(2);
  expect(packageBalanceMinutes(correction.entries, accounts[0].id)).toBe(540);
});

test("Club-only bilingual UI contains no contact fields in its account list", () => {
  const app = readFileSync("components/ClubApp.tsx", "utf8");
  const panel = readFileSync("components/ClassPackagesPanel.tsx", "utf8");
  const parentStart = app.indexOf("function ParentApp(");
  const clubStart = app.indexOf("function ClubAppView(");
  expect(app.slice(parentStart, clubStart)).not.toContain("ClassPackagesPanel");
  expect(app.slice(clubStart)).toContain("<ClassPackagesPanel");
  expect(panel).toContain("Class packages");
  expect(panel).toContain("课时包");
  expect(panel).toContain("Setup required");
  expect(panel).toContain("待完善资料");
  expect(panel).toContain("Profile complete");
  expect(panel).toContain("资料完整");
  expect(panel).toContain('copy(language, "hours", "课时")');
  const accountRow = panel.slice(panel.indexOf('<article className="package-account-row"'), panel.indexOf("</article>", panel.indexOf('<article className="package-account-row"')));
  expect(accountRow).not.toContain("email");
  expect(accountRow).not.toContain("phone");
});

test("local review capture does not seed package credits or infer them from bookings", () => {
  const capture = readFileSync("scripts/capture-class-packages.mjs", "utf8");
  expect(capture).toContain('localStorage.removeItem("rswtta-local-package-hours-ledger-v1")');
  expect(capture).not.toContain("deltaMinutes: 600");
});

test("guarded SQL proposal enforces ownership, role, idempotency, integer minutes, and immutability", () => {
  const sql = readFileSync("sql/proposals/class-package-hours-ledger.sql", "utf8");
  expect(sql).toContain("DO NOT APPLY");
  expect(sql).toContain("student_account_id uuid not null");
  expect(sql).toContain("delta_minutes integer not null check (delta_minutes <> 0)");
  expect(sql).toContain("unique (actor_id, idempotency_key)");
  expect(sql).toContain("p_delta_minutes % 30");
  expect(sql).toContain("p.slug = 'rswtta-booking'");
  expect(sql).toContain("app_metadata' ->> 'role') <> 'club_staff'");
  expect(sql).toContain("before update or delete");
  expect(sql).toContain("coalesce(sum(l.delta_minutes), 0)");
});
