export type StudentIdentityAccount = {
  id: string;
  studentName: string;
  preregisteredName?: string;
  email?: string;
  phone?: string;
};

export type StudentIdentityReference = {
  id?: string;
  studentAccountId?: string;
  studentName: string;
  familyName?: string;
  studentEmail?: string;
  phone?: string;
  classCount?: number;
  message?: string;
  [key: string]: unknown;
};

type StudentRenamePlanInput<TBooking extends StudentIdentityReference, TBill extends StudentIdentityReference> = {
  accountId: string;
  newStudentName: string;
  newEmail: string;
  newPhone: string;
  accounts: StudentIdentityAccount[];
  bookings: TBooking[];
  bills: TBill[];
};

function nameKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function firstNameKey(value: unknown) {
  return nameKey(value).split(" ")[0] ?? "";
}

export type StudentIdentityResolution =
  | { status: "resolved"; account: StudentIdentityAccount; evidence: string[]; candidateAccountIds: string[] }
  | { status: "unresolved" | "ambiguous"; evidence: string[]; candidateAccountIds: string[] };

export function resolveProvableStudentAccount(reference: StudentIdentityReference, accounts: StudentIdentityAccount[]): StudentIdentityResolution {
  if (reference.studentAccountId) {
    const account = accounts.find((item) => item.id === reference.studentAccountId);
    return account
      ? { status: "resolved", account, evidence: ["studentAccountId"], candidateAccountIds: [account.id] }
      : { status: "unresolved", evidence: ["studentAccountId-not-found"], candidateAccountIds: [] };
  }

  const referenceName = nameKey(reference.studentName);
  const referenceEmail = nameKey(reference.studentEmail);
  const referencePhone = String(reference.phone ?? "").trim();
  const evidenceByAccount = new Map<string, Set<string>>();
  const addEvidence = (account: StudentIdentityAccount, evidence: string) => {
    const current = evidenceByAccount.get(account.id) ?? new Set<string>();
    current.add(evidence);
    evidenceByAccount.set(account.id, current);
  };

  for (const account of accounts) {
    if (referenceEmail && nameKey(account.email) === referenceEmail) addEvidence(account, "email");
    if (referencePhone && String(account.phone ?? "").trim() === referencePhone) addEvidence(account, "phone");
    if (referenceName) {
      const currentName = nameKey(account.studentName);
      const claimedName = nameKey(account.preregisteredName);
      if (currentName === referenceName || claimedName === referenceName) addEvidence(account, "exact-name");
      if (!referenceName.includes(" ") && (firstNameKey(currentName) === referenceName || firstNameKey(claimedName) === referenceName)) {
        addEvidence(account, "first-name");
      }
    }
  }

  const candidateAccountIds = [...evidenceByAccount.keys()].sort();
  const evidence = [...new Set([...evidenceByAccount.values()].flatMap((items) => [...items]))].sort();
  if (candidateAccountIds.length !== 1) {
    return { status: candidateAccountIds.length > 1 ? "ambiguous" : "unresolved", evidence, candidateAccountIds };
  }
  const account = accounts.find((item) => item.id === candidateAccountIds[0])!;
  return { status: "resolved", account, evidence: [...evidenceByAccount.get(account.id)!].sort(), candidateAccountIds };
}

export function prepareStudentReferenceForCreation<T extends StudentIdentityReference>(
  reference: T,
  accounts: StudentIdentityAccount[],
  options: { requireAccount?: boolean } = {}
): T {
  if (options.requireAccount && !reference.studentAccountId) {
    throw new Error("Select or create the student account before creating this record.");
  }
  const resolution = resolveProvableStudentAccount(reference, accounts);
  if (resolution.status === "resolved") return canonicalizeStudentReference({ ...reference, studentAccountId: resolution.account.id }, accounts);
  if (options.requireAccount) {
    throw new Error(
      resolution.status === "ambiguous"
        ? "Student identity is ambiguous. Select the student account explicitly."
        : "Student account identity is required before creating this record."
    );
  }
  return { ...reference };
}

export function planStudentIdentityBackfill<T extends StudentIdentityReference>(references: T[], accounts: StudentIdentityAccount[]) {
  const resolved: T[] = [];
  const unresolved: Array<{
    reference: T;
    status: "ambiguous" | "unresolved";
    candidateAccountIds: string[];
    evidence: string[];
  }> = [];

  for (const reference of references) {
    const resolution = resolveProvableStudentAccount(reference, accounts);
    if (resolution.status === "resolved") {
      resolved.push(canonicalizeStudentReference({ ...reference, studentAccountId: resolution.account.id }, accounts));
    } else {
      unresolved.push({
        reference: { ...reference },
        status: resolution.status,
        candidateAccountIds: [...resolution.candidateAccountIds],
        evidence: [...resolution.evidence]
      });
    }
  }

  return {
    resolved,
    unresolved,
    resolvedCount: resolved.length,
    ambiguousCount: unresolved.filter((item) => item.status === "ambiguous").length,
    unmatchedCount: unresolved.filter((item) => item.status === "unresolved").length
  };
}

export function studentReferenceBelongsToAccount(reference: { studentAccountId?: string; studentName?: string }, accountId: string) {
  return Boolean(accountId && reference.studentAccountId === accountId);
}

export function partitionStudentReferencesByIdentity<T extends StudentIdentityReference>(references: T[]) {
  return {
    linked: references.filter((reference) => Boolean(reference.studentAccountId)),
    unresolvedLegacy: references.filter((reference) => !reference.studentAccountId)
  };
}

export function resolveCanonicalStudentAccount(reference: StudentIdentityReference, accounts: StudentIdentityAccount[]) {
  if (!reference.studentAccountId) return undefined;
  return accounts.find((account) => account.id === reference.studentAccountId);
}

export function canonicalizeStudentReference<T extends StudentIdentityReference>(reference: T, accounts: StudentIdentityAccount[]): T {
  const account = resolveCanonicalStudentAccount(reference, accounts);
  if (!account) return { ...reference };
  return {
    ...reference,
    studentAccountId: account.id,
    studentName: account.studentName,
    familyName: reference.familyName !== undefined ? account.studentName : reference.familyName,
    ...(reference.studentEmail !== undefined ? { studentEmail: account.email ?? reference.studentEmail } : {}),
    ...(reference.phone !== undefined ? { phone: account.phone ?? reference.phone } : {})
  };
}

export function planStudentRename<TBooking extends StudentIdentityReference, TBill extends StudentIdentityReference>(
  input: StudentRenamePlanInput<TBooking, TBill>
) {
  const account = input.accounts.find((item) => item.id === input.accountId);
  if (!account) throw new Error("Account not found");

  const oldName = account.studentName.trim();
  const newName = input.newStudentName.trim();
  if (!newName) throw new Error("Student name is required");
  const shouldUpdate = (item: StudentIdentityReference) => item.studentAccountId === input.accountId;
  const updateReference = <T extends StudentIdentityReference>(item: T, bill: boolean): T => {
    if (!shouldUpdate(item)) return { ...item };
    return {
      ...item,
      studentAccountId: input.accountId,
      studentName: newName,
      familyName: newName,
      ...(item.studentEmail !== undefined ? { studentEmail: input.newEmail } : {}),
      ...(item.phone !== undefined ? { phone: input.newPhone } : {}),
      ...(bill && typeof item.classCount === "number"
        ? { message: `${newName}: ${item.classCount} completed classes ready to bill` }
        : {})
    };
  };

  return {
    account: {
      ...account,
      studentName: newName,
      email: input.newEmail,
      phone: input.newPhone,
      preregisteredName: account.preregisteredName || oldName
    },
    bookings: input.bookings.map((item) => updateReference(item, false)),
    bills: input.bills.map((item) => updateReference(item, true)),
    updatedBookingCount: input.bookings.filter(shouldUpdate).length,
    updatedBillCount: input.bills.filter(shouldUpdate).length
  };
}
