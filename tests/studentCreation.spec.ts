import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createStudentAccountThenPersist, reusableStudentAccountByEmail } from "../lib/studentCreation";

const projectStore = readFileSync("lib/projectStore.ts", "utf8");

test("private-class new-student flow creates the account before persisting account-linked bookings", async () => {
  const calls: string[] = [];
  const { account, result } = await createStudentAccountThenPersist({
    student: { studentName: "Same Name", email: "first@example.test" },
    createOrReuseAccount: async (student) => { calls.push("account"); return { id: "student-1", ...student }; },
    persist: async (created) => { calls.push(`private:${created.id}`); return [{ studentAccountId: created.id, program: "Private lesson" }]; }
  });
  expect(calls).toEqual(["account", "private:student-1"]);
  expect(result).toEqual([{ studentAccountId: account.id, program: "Private lesson" }]);
});

test("group-class new-student flow creates the account before persisting account-linked enrollment", async () => {
  const calls: string[] = [];
  const { result } = await createStudentAccountThenPersist({
    student: { studentName: "Group Student", email: "group@example.test" },
    createOrReuseAccount: async (student) => { calls.push("account"); return { id: "student-2", ...student }; },
    persist: async (created) => { calls.push(`group:${created.id}`); return { studentAccountId: created.id, program: "Group enrollment" }; }
  });
  expect(calls).toEqual(["account", "group:student-2"]);
  expect(result).toEqual({ studentAccountId: "student-2", program: "Group enrollment" });
});

test("duplicate display names and shared phones remain distinct unless a unique email matches", () => {
  const accounts = [
    { id: "student-1", studentName: "Same Name", email: "one@example.test", phone: "5551111" },
    { id: "student-2", studentName: "Same Name", email: "two@example.test", phone: "5551111" }
  ];
  expect(reusableStudentAccountByEmail(accounts, "new@example.test")).toBeUndefined();
  expect(reusableStudentAccountByEmail(accounts, "TWO@example.test")?.id).toBe("student-2");
  expect(new Set(accounts.map((item) => item.id)).size).toBe(2);
});

test("Club-created Parent accounts retain the existing accessible setup credential path", () => {
  const createAccountBlock = /export async function createClubStudentAccount[\s\S]*?\n}\n\nexport async function/.exec(projectStore)?.[0] ?? "";
  expect(createAccountBlock).toContain("hashPassword(preregisteredPasswordTemplate)");
  expect(createAccountBlock).not.toContain("gen_random_bytes");
});

test("account failure aborts before any private or group record is persisted", async () => {
  for (const program of ["Private lesson", "Group enrollment"]) {
    let persisted = false;
    await expect(createStudentAccountThenPersist({
      student: { studentName: "Failure" },
      createOrReuseAccount: async () => { throw new Error("account unavailable"); },
      persist: async () => { persisted = true; return program; }
    })).rejects.toThrow("account unavailable");
    expect(persisted).toBe(false);
  }
});
