import type { PackageHoursLedgerEntry, ParentAccount } from "@/lib/types";

export const DEFAULT_PACKAGE_HOURS = 0;
export const PACKAGE_HOUR_INCREMENT = 0.5;
export const MAX_PACKAGE_HOURS_PER_ENTRY = 500;

export type ClassPackageAccountRow = {
  account: ParentAccount;
  balanceMinutes: number;
  lastUpdatedAt: string | null;
  duplicateName: boolean;
};

export function hoursToMinutes(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_PACKAGE_HOURS_PER_ENTRY) {
    throw new Error(`Hours must be between ${PACKAGE_HOUR_INCREMENT} and ${MAX_PACKAGE_HOURS_PER_ENTRY}.`);
  }
  const minutes = hours * 60;
  if (!Number.isInteger(minutes) || minutes % (PACKAGE_HOUR_INCREMENT * 60) !== 0) {
    throw new Error(`Hours must use ${PACKAGE_HOUR_INCREMENT}-hour increments.`);
  }
  return minutes;
}

export function minutesToHoursText(minutes: number) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, "");
}

export function packageBalanceMinutes(entries: PackageHoursLedgerEntry[], accountId: string) {
  return entries
    .filter((entry) => entry.studentAccountId === accountId)
    .reduce((total, entry) => total + entry.deltaMinutes, 0);
}

export function classPackageAccountRows(accounts: ParentAccount[], entries: PackageHoursLedgerEntry[]) {
  const nameCounts = new Map<string, number>();
  for (const account of accounts) {
    const key = account.studentName.trim().toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return accounts.map((account): ClassPackageAccountRow => {
    const accountEntries = entries.filter((entry) => entry.studentAccountId === account.id);
    return {
      account,
      balanceMinutes: accountEntries.reduce((total, entry) => total + entry.deltaMinutes, 0),
      lastUpdatedAt: accountEntries.reduce<string | null>((latest, entry) => !latest || entry.createdAt > latest ? entry.createdAt : latest, null),
      duplicateName: (nameCounts.get(account.studentName.trim().toLocaleLowerCase()) ?? 0) > 1
    };
  });
}

export function searchClassPackageAccounts(rows: ClassPackageAccountRow[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return rows;
  return rows.filter(({ account }) =>
    account.studentName.toLocaleLowerCase().includes(normalized) || account.id.toLocaleLowerCase().includes(normalized)
  );
}

export function safeAccountSuffix(accountId: string) {
  const compact = accountId.replace(/[^a-z0-9]/gi, "");
  return compact.slice(-6) || accountId.slice(-6);
}

export function appendPackageLedgerEntry(
  entries: PackageHoursLedgerEntry[],
  input: Omit<PackageHoursLedgerEntry, "id" | "createdAt"> & { id?: string; createdAt?: string }
) {
  if (!input.studentAccountId.trim()) throw new Error("Student account ID is required.");
  if (!Number.isInteger(input.deltaMinutes) || input.deltaMinutes === 0) throw new Error("Ledger delta must be a non-zero integer number of minutes.");
  if (!input.actorId.trim() || !input.actorType.trim()) throw new Error("Actor audit metadata is required.");
  if (!input.idempotencyKey.trim()) throw new Error("Idempotency key is required.");
  const duplicate = entries.find((entry) => entry.idempotencyKey === input.idempotencyKey);
  if (duplicate) return { entries, entry: duplicate, inserted: false };

  const entry: PackageHoursLedgerEntry = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  return { entries: [...entries, entry], entry, inserted: true };
}
