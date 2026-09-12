import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { missingPreregisteredStudentNames } from "../lib/projectStore";

const account = (id: string, studentName: string, preregisteredName?: string) => ({
  id,
  values: { studentName, preregisteredName }
});

test("completed immutable claims satisfy all five renamed roster seeds", () => {
  const rows = [
    account("9bed3c27-3e60-4a78-be48-fbb40430cf0c", "Alex Li", "Alex"),
    account("d33b45ca-34bc-4df9-a830-b38ea32cd12e", "Eddie Chai", "Eddie"),
    account("9f04c65b-d514-4d17-b407-d57b043964e8", "Luke Xu", "Luke"),
    account("bdaac62c-8f13-4426-bca1-fc8ac7d2a7f9", "Kyson Duan", "Kyson"),
    account("399ba93f-c2cb-4576-88c0-af732809e73e", "Onur", "Oaur")
  ];

  expect(missingPreregisteredStudentNames(rows, ["Alex", "Eddie", "Luke", "Kyson", "Oaur"])).toEqual([]);
});

test("both Ella accounts and Felix remain independent rows while satisfying their seeds", () => {
  const rows = [
    account("b8433b38-75f0-4e37-8792-3b952d26c74d", "Ella"),
    account("3a6d38c0-a343-42fe-b373-e1649928041d", "Ella"),
    account("bf649094-a22b-469b-8232-7bc1de6ee70a", "Felix"),
    account("5ff0ff61-356e-4310-a3f8-9a00c8e9b66c", "Sharon Lynn", "Felix")
  ];

  expect(rows).toHaveLength(4);
  expect(missingPreregisteredStudentNames(rows, ["Ella", "Felix"])).toEqual([]);
  expect(rows.filter((row) => row.values.studentName === "Ella")).toHaveLength(2);
  expect(rows.some((row) => row.id.endsWith("de6ee70a"))).toBe(true);
});

test("missing seeds do not collapse legitimate duplicate display names", () => {
  const rows = [account("alex-one", "Alex Smith"), account("alex-two", "Alex Smith")];
  expect(missingPreregisteredStudentNames(rows, ["Alex", "Ella"])).toEqual(["Alex", "Ella"]);
});

test("database prevention is claim-only, completion-gated, and bound for stale clients", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260912130000_require_completed_seed_claim.sql"),
    "utf8"
  );
  expect(migration).toContain("existing.values->>'preregisteredName'");
  expect(migration).toMatch(/profileSetupRequired'\)::boolean, true\) is false/);
  expect(migration).not.toContain("existing.values->>'studentName'");
  expect(migration).toContain("before insert or update of project_table_id, values");
  expect(migration).toContain("existing.id <> new.id");
});

test("Oaur two-client seed race is serialized even when stale payloads omit preregisteredName", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260912164500_lock_legacy_student_seed_claims.sql"),
    "utf8"
  );
  const lockAt = migration.indexOf("pg_advisory_xact_lock(hashtextextended(v_accounts_table_id::text || ':' || v_claim, 0))");
  const ownerCheckAt = migration.indexOf("existing.values->>'preregisteredName'");

  expect(migration).toContain("coalesce(nullif(new.values->>'preregisteredName', ''), new.values->>'studentName', '')");
  expect(lockAt).toBeGreaterThan(0);
  expect(ownerCheckAt).toBeGreaterThan(lockAt);
  expect(migration).toContain("jsonb_set(new.values, '{preregisteredName}'");
  expect(migration).toContain("create unique index if not exists project_rows_unique_legacy_seed_claim");
  expect(migration).toContain("Preregistered roster claim is immutable");
});

test("remote account listing never invokes preregistered seed insertion", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/projectStore.ts"), "utf8");
  const listStart = source.indexOf("async function listAccountRowsWithSeeds()");
  const listEnd = source.indexOf("export async function registerParentAccount", listStart);
  const implementation = source.slice(listStart, listEnd);

  expect(implementation).toContain('() => listRows<AccountValues>("parent_accounts")');
  expect(implementation).toContain("seedLocalPreregisteredAccounts(rows)");
  expect(implementation).not.toContain('createRow("parent_accounts"');
});
