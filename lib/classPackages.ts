import type {
  Booking,
  PackageBalance,
  PackageCategory,
  PackageLedgerEvent,
  PackageUnitBasis,
  ParentAccount
} from "@/lib/types";
import { TIAN_YE_COACH_ID } from "@/lib/coachPolicy";

export const DEFAULT_PACKAGE_OPENING_AMOUNT = 0;
export const PACKAGE_HOUR_INCREMENT = 0.5;
export const MAX_PACKAGE_HOURS = 500;
export const MAX_GROUP_CLASS_CREDITS = 10000;

export const PACKAGE_CATEGORIES: readonly PackageCategory[] = [
  "coach_director_private",
  "national_coach_private",
  "group_class"
] as const;

export const PACKAGE_UNIT_BASIS: Record<PackageCategory, PackageUnitBasis> = {
  coach_director_private: "hours",
  national_coach_private: "hours",
  group_class: "class_credit"
};

export const PACKAGE_CATEGORY_LABELS: Record<PackageCategory, { en: string; zh: string }> = {
  coach_director_private: { en: "Coach Director private lessons", zh: "教练主管私教课" },
  national_coach_private: { en: "National Coach private lessons", zh: "国家级教练私教课" },
  group_class: { en: "Group Class package", zh: "团体课课时包" }
};

export type ClassPackageAccountRow = {
  account: ParentAccount;
  packages: Record<PackageCategory, PackageBalance>;
  duplicateName: boolean;
};

export function openingAmountToBaseUnits(category: PackageCategory, amount: number) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Opening amount must be nonnegative.");
  if (PACKAGE_UNIT_BASIS[category] === "class_credit") {
    if (!Number.isInteger(amount) || amount > MAX_GROUP_CLASS_CREDITS) throw new Error(`Class credits must be whole numbers from 0 to ${MAX_GROUP_CLASS_CREDITS}.`);
    return amount;
  }
  if (amount > MAX_PACKAGE_HOURS || amount % PACKAGE_HOUR_INCREMENT !== 0) {
    throw new Error(`Hours must be 0-${MAX_PACKAGE_HOURS} in ${PACKAGE_HOUR_INCREMENT}-hour increments.`);
  }
  return amount * 60;
}

export function baseUnitsToDisplay(category: PackageCategory, amountBaseUnits: number) {
  if (PACKAGE_UNIT_BASIS[category] === "class_credit") return String(amountBaseUnits);
  const hours = amountBaseUnits / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function emptyPackageBalance(studentAccountId: string, category: PackageCategory): PackageBalance {
  return {
    packageId: null,
    studentAccountId,
    category,
    unitBasis: PACKAGE_UNIT_BASIS[category],
    openingAmountBaseUnits: 0,
    adjustmentAmountBaseUnits: 0,
    usageAmountBaseUnits: 0,
    remainingAmountBaseUnits: 0,
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
  return rows.filter(({ account }) => account.studentName.toLocaleLowerCase().includes(normalized) || account.id.toLocaleLowerCase().includes(normalized));
}

export function safeAccountSuffix(accountId: string) {
  const compact = accountId.replace(/[^a-z0-9]/gi, "");
  return compact.slice(-6) || accountId.slice(-6);
}

/** Pure audit helper. SQL is authoritative for persisted package operations. */
export function summarizePackageEvents(events: PackageLedgerEvent[]) {
  let openingAmountBaseUnits = 0;
  let adjustmentAmountBaseUnits = 0;
  let usageAmountBaseUnits = 0;
  let remainingAmountBaseUnits = 0;
  let version = 0;
  let category: PackageCategory | null = null;
  let unitBasis: PackageUnitBasis | null = null;
  for (const event of [...events].sort((left, right) => left.version - right.version)) {
    if (event.version !== version + 1) throw new Error("Package event versions must be contiguous.");
    if ((category && event.category !== category) || (unitBasis && event.unitBasis !== unitBasis) || PACKAGE_UNIT_BASIS[event.category] !== event.unitBasis) throw new Error("Package category/unit basis mismatch.");
    category = event.category;
    unitBasis = event.unitBasis;
    version = event.version;
    if (event.eventType === "opening_set") {
      if (event.oldOpeningAmountBaseUnits !== openingAmountBaseUnits || event.newOpeningAmountBaseUnits === null) throw new Error("Opening event is stale or incomplete.");
      openingAmountBaseUnits = event.newOpeningAmountBaseUnits;
    } else if (event.eventType === "adjustment") adjustmentAmountBaseUnits += event.amountBaseUnits;
    else usageAmountBaseUnits += -event.amountBaseUnits;
    remainingAmountBaseUnits += event.amountBaseUnits;
  }
  return { openingAmountBaseUnits, adjustmentAmountBaseUnits, usageAmountBaseUnits, remainingAmountBaseUnits, version };
}

export type PackageConsumptionResolution = {
  eligible: boolean;
  reason: "eligible" | "ineligible_status" | "missing_coach" | "invalid_duration" | "missing_starts_at";
  category: PackageCategory | null;
  unitBasis: PackageUnitBasis | null;
  consumptionAmount: number;
  amountBaseUnits: number;
  stableOccurrenceId: string | null;
};

function normalizedIdentity(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isTianYeAlias(value: unknown) {
  return ["coachtianye", "tianye", "coachtian", "headcoachtian"].includes(normalizedIdentity(value));
}

function explicitCoachId(booking: Partial<Booking>) {
  return [booking.assignedCoachId, booking.coachId, booking.requestedCoachId].find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function durationHours(timeLabel: unknown) {
  const match = String(timeLabel ?? "").match(/^\s*(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*$/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = hours * 60;
  return hours > 0 && hours < 24 && Number.isInteger(minutes) ? hours : null;
}

/**
 * Pure mirror of public.resolve_class_package_consumption(jsonb). SQL is authoritative.
 * It classifies only and never writes or debits a package.
 */
export function resolveClassPackageConsumption(booking: Partial<Booking>): PackageConsumptionResolution {
  const stableOccurrenceId = booking.recurrenceOccurrenceId?.trim() || booking.groupClassId?.trim() || booking.id?.trim() || null;
  const program = String(booking.program ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const isGroup = Boolean(booking.groupClassId?.trim()) || program === "group class" || program === "group enrollment";
  const eligible = booking.status === "coach_confirmed";
  if (isGroup) return { eligible, reason: eligible ? "eligible" : "ineligible_status", category: "group_class", unitBasis: "class_credit", consumptionAmount: 1, amountBaseUnits: 1, stableOccurrenceId };

  if (!booking.startsAt || !Number.isFinite(Date.parse(booking.startsAt))) return { eligible: false, reason: "missing_starts_at", category: null, unitBasis: null, consumptionAmount: 0, amountBaseUnits: 0, stableOccurrenceId };
  const coachId = explicitCoachId(booking);
  const coachName = booking.assignedCoach?.trim() || booking.requestedCoach?.trim() || "";
  if (!coachId && !coachName) return { eligible: false, reason: "missing_coach", category: null, unitBasis: null, consumptionAmount: 0, amountBaseUnits: 0, stableOccurrenceId };
  const hours = durationHours(booking.timeLabel);
  if (hours === null) return { eligible: false, reason: "invalid_duration", category: null, unitBasis: null, consumptionAmount: 0, amountBaseUnits: 0, stableOccurrenceId };
  const category: PackageCategory = coachId ? (coachId === TIAN_YE_COACH_ID ? "coach_director_private" : "national_coach_private") : (isTianYeAlias(coachName) ? "coach_director_private" : "national_coach_private");
  return { eligible, reason: eligible ? "eligible" : "ineligible_status", category, unitBasis: "hours", consumptionAmount: hours, amountBaseUnits: hours * 60, stableOccurrenceId };
}
