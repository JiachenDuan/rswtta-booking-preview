import type { ParentAccount } from "@/lib/types";

export const parentSetupSessionVersion = 1;
export const parentLegacySessionVersion = 1;

export type StorageReadResult = {
  value: string | null;
  failed: boolean;
};

type StoredLegacySession = {
  version?: number;
  sessionToken: string;
  expiresAt: string;
};

type StoredParentSetup = {
  version: number;
  account: ParentAccount;
};

export function safeStorageRead(storage: Storage | null, key: string): StorageReadResult {
  if (!storage) return { value: null, failed: true };
  try {
    return { value: storage.getItem(key), failed: false };
  } catch {
    return { value: null, failed: true };
  }
}

export function safeStorageWrite(storage: Storage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(storage: Storage | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function isParentAccount(value: unknown): value is ParentAccount {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParentAccount>;
  return typeof candidate.id === "string"
    && candidate.id.length > 0
    && typeof candidate.studentName === "string"
    && typeof candidate.parentName === "string"
    && typeof candidate.email === "string"
    && typeof candidate.phone === "string"
    && typeof candidate.confirmed === "boolean"
    && typeof candidate.profileSetupRequired === "boolean"
    && typeof candidate.createdAt === "string"
    && Number.isFinite(Date.parse(candidate.createdAt))
    && (candidate.preregisteredName === undefined || typeof candidate.preregisteredName === "string")
    && (candidate.loginAlias === undefined || typeof candidate.loginAlias === "string")
    && (candidate.clubPreregistered === undefined || typeof candidate.clubPreregistered === "boolean");
}

export function parseParentSetupAccount(raw: string | null): ParentAccount | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const versioned = parsed as Partial<StoredParentSetup>;
    const account = versioned?.version === parentSetupSessionVersion ? versioned.account : parsed;
    return isParentAccount(account) && account.profileSetupRequired === true ? account : null;
  } catch {
    return null;
  }
}

export function serializeParentSetupAccount(account: ParentAccount): string {
  return JSON.stringify({ version: parentSetupSessionVersion, account } satisfies StoredParentSetup);
}

export function parseParentLegacyStoredSession(raw: string | null, now = Date.now()): StoredLegacySession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<StoredLegacySession>;
    if (candidate.version !== undefined && candidate.version !== parentLegacySessionVersion) return null;
    const expiresAt = typeof candidate.expiresAt === "string" ? Date.parse(candidate.expiresAt) : Number.NaN;
    if (
      typeof candidate.sessionToken !== "string"
      || candidate.sessionToken.length === 0
      || !Number.isFinite(expiresAt)
      || expiresAt <= now
    ) return null;
    return { version: candidate.version, sessionToken: candidate.sessionToken, expiresAt: candidate.expiresAt as string };
  } catch {
    return null;
  }
}
