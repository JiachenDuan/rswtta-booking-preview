import type { PackageBalance, PackageCategory, PackageLedgerEvent, ParentAccount } from "@/lib/types";

export const DEFAULT_PACKAGE_OPENING_HOURS = 0;
export const PACKAGE_HOUR_INCREMENT = 0.5;
export const MAX_PACKAGE_HOURS = 500;

export const PACKAGE_CATEGORIES: readonly PackageCategory[] = [
  "coach_director",
  "national_coach",
  "group_class"
] as const;

export const PACKAGE_CATEGORY_LABELS: Record<PackageCategory, { en: string; zh: string }> = {
  coach_director: { en: "Coach Director prepaid package", zh: "教练主管预付课时包" },
  national_coach: { en: "National Coach package", zh: "国家级教练课时包" },
  group_class: { en: "Group Class package", zh: "团体课课时包" }
};

export type ClassPackageAccountRow = {
  account: ParentAccount;
  packages: Record<PackageCategory, PackageBalance>;
  duplicateName: boolean;
};

export function openingHoursToMinutes(hours: number) {
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_PACKAGE_HOURS) {
    throw new Error(`Hours must be between 0 and ${MAX_PACKAGE_HOURS}.`);
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

export function emptyPackageBalance(studentAccountId: string, category: PackageCategory): PackageBalance {
  return {
    packageId: null,
    studentAccountId,
    category,
    openingMinutes: 0,
    adjustmentMinutes: 0,
    usageMinutes: 0,
    remainingMinutes: 0,
    version: 0,
    lastEventAt: null
  };
}

export function classPackageAccountRows(accounts: ParentAccount[], balances: PackageBalance[]) {
  const nameCounts = new Map<string, number>();
  const balancesByKey = new Map(balances.map((balance) => [`${balance.studentAccountId}:${balance.category}`, balance]));
  for (const account of accounts) {
    const key = account.studentName.trim().toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return accounts.map((account): ClassPackageAccountRow => ({
    account,
    packages: Object.fromEntries(PACKAGE_CATEGORIES.map((category) => [
      category,
      balancesByKey.get(`${account.id}:${category}`) ?? emptyPackageBalance(account.id, category)
    ])) as Record<PackageCategory, PackageBalance>,
    duplicateName: (nameCounts.get(account.studentName.trim().toLocaleLowerCase()) ?? 0) > 1
  }));
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

/** Pure audit helper used by direct tests; production totals are calculated by the RPC. */
export function summarizePackageEvents(events: PackageLedgerEvent[]) {
  let openingMinutes = 0;
  let adjustmentMinutes = 0;
  let usageMinutes = 0;
  let remainingMinutes = 0;
  let version = 0;
  for (const event of [...events].sort((left, right) => left.version - right.version)) {
    if (event.version !== version + 1) throw new Error("Package event versions must be contiguous.");
    version = event.version;
    if (event.eventType === "opening_set") {
      if (event.oldOpeningMinutes !== openingMinutes || event.newOpeningMinutes === null) throw new Error("Opening event is stale or incomplete.");
      openingMinutes = event.newOpeningMinutes;
    } else if (event.eventType === "adjustment") {
      adjustmentMinutes += event.amountMinutes;
    } else {
      usageMinutes += -event.amountMinutes;
    }
    remainingMinutes += event.amountMinutes;
  }
  return { openingMinutes, adjustmentMinutes, usageMinutes, remainingMinutes, version };
}
