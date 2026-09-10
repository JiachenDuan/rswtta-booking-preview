import { expect, test } from "@playwright/test";
import { serializeCsvRows } from "../lib/classReport";
import {
  canonicalizeStudentReference,
  planStudentIdentityBackfill,
  planStudentRename,
  prepareStudentReferenceForCreation,
  resolveProvableStudentAccount,
  resolveStudentAccountForSeed
} from "../lib/studentIdentity";

const account = { id: "account-1", studentName: "Kyson", email: "old@example.test", phone: "1111111" };

function references() {
  return [
    { id: "private-future", studentAccountId: account.id, studentName: "Kyson", familyName: "Kyson", startsAt: "2026-10-01", program: "Private lesson" },
    { id: "private-past", studentAccountId: account.id, studentName: "Kyson", familyName: "Kyson", startsAt: "2026-08-01", program: "Private lesson" },
    { id: "group-request", studentAccountId: account.id, studentName: "Kyson", familyName: "Kyson", startsAt: "2026-10-02", program: "Group enrollment" },
    { id: "group-complete", studentAccountId: account.id, studentName: "Kyson", familyName: "Kyson", startsAt: "2026-08-02", program: "Group lesson" },
    { id: "other-student", studentAccountId: "account-2", studentName: "Kyson Lee", familyName: "Kyson Lee", startsAt: "2026-10-03", program: "Private lesson" }
  ];
}

test("new records persist the selected account ID and canonical current name at creation", () => {
  const created = prepareStudentReferenceForCreation(
    { studentAccountId: "student-1", studentName: "Avery", familyName: "Avery", studentEmail: "old@example.test", phone: "111" },
    [{ id: "student-1", studentName: "Avery Johnson", email: "new@example.test", phone: "222" }],
    { requireAccount: true }
  );
  expect(created).toMatchObject({
    studentAccountId: "student-1",
    studentName: "Avery Johnson",
    familyName: "Avery Johnson",
    studentEmail: "new@example.test",
    phone: "222"
  });
});

test("storage boundary links an unlinked new record only when one account is provable", () => {
  const created = prepareStudentReferenceForCreation(
    { studentName: "Morgan", familyName: "Morgan", studentEmail: "morgan@example.test" },
    [
      { id: "morgan", studentName: "Morgan Lee", preregisteredName: "Morgan", email: "morgan@example.test" },
      { id: "other", studentName: "Taylor Lee", email: "taylor@example.test" }
    ],
    { requireAccount: true }
  );
  expect(created).toMatchObject({ studentAccountId: "morgan", studentName: "Morgan Lee", familyName: "Morgan Lee" });
});

test("duplicate first names never cross-link at creation", () => {
  const accounts = [
    { id: "alex-li", studentName: "Alex Li" },
    { id: "alex-ma", studentName: "Alex Ma" }
  ];
  expect(resolveProvableStudentAccount({ studentName: "Alex" }, accounts)).toMatchObject({
    status: "ambiguous",
    candidateAccountIds: ["alex-li", "alex-ma"]
  });
  expect(() => prepareStudentReferenceForCreation({ studentName: "Alex" }, accounts, { requireAccount: true })).toThrow(
    "Student identity is ambiguous"
  );
});

test("backfill plans only unique owners and emits explicit ambiguous and unmatched records", () => {
  const accounts = [
    { id: "alex-li", studentName: "Alex Li", email: "alex.li@example.test" },
    { id: "alex-ma", studentName: "Alex Ma", email: "alex.ma@example.test" },
    { id: "morgan", studentName: "Morgan Lee", preregisteredName: "Morgan", email: "morgan@example.test" }
  ];
  const references: Array<{
    id: string;
    studentAccountId?: string;
    studentName: string;
    familyName: string;
    studentEmail?: string;
    program: string;
  }> = [
    { id: "private", studentName: "Morgan", familyName: "Morgan", studentEmail: "morgan@example.test", program: "Private lesson" },
    { id: "group", studentName: "Morgan", familyName: "Morgan", program: "Group enrollment" },
    { id: "ambiguous", studentName: "Alex", familyName: "Alex", program: "Private lesson" },
    { id: "unmatched", studentName: "Unknown Student", familyName: "Unknown Student", program: "Group lesson" }
  ];
  const snapshot = structuredClone(references);
  const plan = planStudentIdentityBackfill(references, accounts);

  expect(plan).toMatchObject({ resolvedCount: 2, ambiguousCount: 1, unmatchedCount: 1 });
  expect(plan.resolved.every((item) => item.studentAccountId === "morgan" && item.studentName === "Morgan Lee")).toBe(true);
  expect(plan.unresolved).toEqual([
    expect.objectContaining({
      reference: expect.objectContaining({ id: "ambiguous", studentName: "Alex" }),
      status: "ambiguous",
      candidateAccountIds: ["alex-li", "alex-ma"]
    }),
    expect.objectContaining({
      reference: expect.objectContaining({ id: "unmatched", studentName: "Unknown Student" }),
      status: "unresolved",
      candidateAccountIds: []
    })
  ]);
  expect(references).toEqual(snapshot);
});

test("conflicting exact-name and contact evidence is unresolved instead of guessed", () => {
  const plan = planStudentIdentityBackfill(
    [{ id: "conflict", studentName: "Luke Xu", studentEmail: "leo@example.test" }],
    [
      { id: "luke", studentName: "Luke Xu", email: "luke@example.test" },
      { id: "leo", studentName: "Leo", email: "leo@example.test" }
    ]
  );
  expect(plan).toMatchObject({ resolvedCount: 0, ambiguousCount: 1, unmatchedCount: 0 });
  expect(plan.unresolved[0].candidateAccountIds).toEqual(["leo", "luke"]);
});

test("rename links and updates private, group, future, and past references without touching another same-first-name student", () => {
  const plan = planStudentRename({
    accountId: account.id,
    newStudentName: "Kyson Duan",
    newEmail: "new@example.test",
    newPhone: "2222222",
    accounts: [account, { id: "account-2", studentName: "Kyson Lee" }],
    bookings: references(),
    bills: [{ id: "bill-1", studentAccountId: account.id, studentName: "Kyson", familyName: "Kyson", classCount: 4, message: "Kyson: 4 completed classes ready to bill" }]
  });

  expect(plan.updatedBookingCount).toBe(4);
  expect(plan.bookings.slice(0, 4).every((item) => item.studentAccountId === account.id && item.studentName === "Kyson Duan")).toBe(true);
  expect(plan.bookings[4].studentName).toBe("Kyson Lee");
  expect(plan.bills[0]).toMatchObject({ studentAccountId: account.id, studentName: "Kyson Duan", familyName: "Kyson Duan", message: "Kyson Duan: 4 completed classes ready to bill" });
});

test("ambiguous unlinked legacy records remain untouched during a rename", () => {
  const bookings = [{ id: "legacy", studentName: "Kyson", familyName: "Kyson" }];
  const snapshot = structuredClone(bookings);
  const plan = planStudentRename({
    accountId: account.id,
    newStudentName: "Kyson Duan",
    newEmail: "new@example.test",
    newPhone: "2222222",
    accounts: [account, { id: "account-2", studentName: "KYSON" }],
    bookings,
    bills: []
  });
  expect(plan.updatedBookingCount).toBe(0);
  expect(plan.bookings).toEqual(snapshot);
  expect(bookings).toEqual(snapshot);
});

test("already linked records remain collision-safe even when legacy display names are duplicated", () => {
  const plan = planStudentRename({
    accountId: account.id,
    newStudentName: "Kyson Duan",
    newEmail: "new@example.test",
    newPhone: "2222222",
    accounts: [account, { id: "account-2", studentName: "KYSON" }],
    bookings: [
      { id: "mine", studentAccountId: account.id, studentName: "Kyson", familyName: "Kyson" },
      { id: "theirs", studentAccountId: "account-2", studentName: "KYSON", familyName: "KYSON" }
    ],
    bills: []
  });
  expect(plan.bookings[0].studentName).toBe("Kyson Duan");
  expect(plan.bookings[1].studentName).toBe("KYSON");
});

test("CSV output resolves linked and uniquely claimed legacy names while excluding stale names", () => {
  const accounts = [
    { id: "avery-account", studentName: "Avery Johnson", preregisteredName: "Avery" },
    { id: "morgan-account", studentName: "Morgan Lee", preregisteredName: "Morgan" }
  ];
  const staleReferences = [
    { id: "linked", studentAccountId: "avery-account", studentName: "Avery", familyName: "Avery" },
    { id: "legacy", studentName: "Morgan", familyName: "Morgan" }
  ];
  const canonical = staleReferences.map((booking) => canonicalizeStudentReference(booking, accounts));
  const csv = serializeCsvRows(canonical.map((booking) => [`STUDENT: ${booking.studentName}`]));

  expect(csv).toContain("STUDENT: Avery Johnson");
  expect(csv).toContain("STUDENT: Morgan Lee");
  expect(csv.split("\n")).not.toContain("STUDENT: Avery");
  expect(csv.split("\n")).not.toContain("STUDENT: Morgan");
});

test("ambiguous legacy names are not canonicalized into either duplicate student", () => {
  const legacy = { id: "legacy", studentName: "Alex", familyName: "Alex" };
  const result = canonicalizeStudentReference(legacy, [
    { id: "alex-1", studentName: "Alex Chen", preregisteredName: "Alex" },
    { id: "alex-2", studentName: "Alex Smith", preregisteredName: "Alex" }
  ]);
  expect(result).toEqual(legacy);
});

test("recurring seed resolves a claimed student's current full name instead of recreating the old name", () => {
  const resolved = resolveStudentAccountForSeed(
    [
      { id: account.id, studentName: "Kyson Duan", preregisteredName: "Kyson" },
      { id: "blank-duplicate", studentName: "Kyson" }
    ],
    "Kyson"
  );
  expect(resolved).toMatchObject({ id: account.id, studentName: "Kyson Duan" });
});
