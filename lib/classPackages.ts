import type { PackageHoursBalance, ParentAccount } from "@/lib/types";

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

export function classPackageAccountRows(accounts: ParentAccount[], balances: PackageHoursBalance[]) {
  const nameCounts = new Map<string, number>();
  const balancesByAccountId = new Map(balances.map((balance) => [balance.studentAccountId, balance]));
  for (const account of accounts) {
    const key = account.studentName.trim().toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return accounts.map((account): ClassPackageAccountRow => {
    const balance = balancesByAccountId.get(account.id);
    return {
      account,
      // The RPC returns every account with COALESCE(SUM(...), 0). This fallback is only
      // for the initial render before that response arrives; it never infers booking credits.
      balanceMinutes: balance?.balanceMinutes ?? 0,
      lastUpdatedAt: balance?.lastPackageUpdate ?? null,
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
