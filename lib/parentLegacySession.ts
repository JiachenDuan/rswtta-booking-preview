import {
  parentLegacySessionVersion,
  parseParentLegacyStoredSession,
  safeStorageRead,
  safeStorageRemove,
  safeStorageWrite
} from "@/lib/parentSessionStorage";
import { supabase } from "@/lib/supabase";
import type { Booking, ParentAccount } from "@/lib/types";

export const parentLegacySessionStorageKey = "rswtta-parent-legacy-session";
const parentLegacyClientKeyStorageKey = "rswtta-parent-legacy-client-key";

export type ParentLegacyDashboard = {
  account: ParentAccount;
  bookings: Booking[];
  calendarBookings: Booking[];
  serverNow: string;
};

export type ParentLegacySession = ParentLegacyDashboard & {
  sessionToken: string;
  expiresAt: string;
};

type StoredSession = Pick<ParentLegacySession, "sessionToken" | "expiresAt"> & { version?: number };
type RpcResponse<T> = { data: T | null; error: { message: string } | null };

let memoryClientKey = "";

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function parentLegacyClientKey() {
  if (memoryClientKey) return memoryClientKey;
  const current = safeStorageRead(storage(), parentLegacyClientKeyStorageKey).value;
  if (current) {
    memoryClientKey = current;
    return current;
  }
  memoryClientKey = crypto.randomUUID();
  safeStorageWrite(storage(), parentLegacyClientKeyStorageKey, memoryClientKey);
  return memoryClientKey;
}

function requireData<T>(response: RpcResponse<T>, fallback: string): T {
  if (response.error || response.data == null) throw new Error(fallback);
  return response.data;
}

function storeSession(session: StoredSession) {
  safeStorageWrite(storage(), parentLegacySessionStorageKey, JSON.stringify({ ...session, version: parentLegacySessionVersion }));
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredSession>;
  const expiresAt = typeof candidate.expiresAt === "string" ? Date.parse(candidate.expiresAt) : Number.NaN;
  return typeof candidate.sessionToken === "string"
    && candidate.sessionToken.length > 0
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now();
}

function isDashboard(value: unknown): value is ParentLegacyDashboard {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParentLegacyDashboard>;
  return Boolean(
    candidate.account
    && typeof candidate.account.id === "string"
    && typeof candidate.account.studentName === "string"
    && typeof candidate.account.parentName === "string"
    && typeof candidate.account.email === "string"
    && typeof candidate.account.phone === "string"
    && typeof candidate.account.profileSetupRequired === "boolean"
  )
    && Array.isArray(candidate.bookings)
    && Array.isArray(candidate.calendarBookings)
    && typeof candidate.serverNow === "string"
    && Number.isFinite(Date.parse(candidate.serverNow));
}

function requireDashboard(response: RpcResponse<ParentLegacyDashboard>, fallback: string) {
  const dashboard = requireData(response, fallback);
  if (!isDashboard(dashboard)) throw new Error(fallback);
  return dashboard;
}

export function readParentLegacySessionState(): { session: StoredSession | null; hadStored: boolean; storageFailed: boolean } {
  const result = safeStorageRead(storage(), parentLegacySessionStorageKey);
  if (result.failed) return { session: null, hadStored: false, storageFailed: true };
  if (!result.value) return { session: null, hadStored: false, storageFailed: false };
  const session = parseParentLegacyStoredSession(result.value);
  if (session) return { session, hadStored: true, storageFailed: false };
  clearParentLegacySession();
  return { session: null, hadStored: true, storageFailed: false };
}

export function readParentLegacySession(): StoredSession | null {
  return readParentLegacySessionState().session;
}

export function clearParentLegacySession() {
  safeStorageRemove(storage(), parentLegacySessionStorageKey);
}

export async function loginParentLegacySession(identifier: string, password: string): Promise<ParentLegacySession> {
  const response = await supabase.rpc("parent_legacy_session_login", {
    p_identifier: identifier.trim(),
    p_password: password,
    p_client_key: parentLegacyClientKey()
  });
  const session = requireDashboard(response as RpcResponse<ParentLegacySession>, "Unable to sign in. Check your email and password.") as ParentLegacySession;
  if (!isStoredSession(session)) {
    throw new Error("Unable to sign in. Check your email and password.");
  }
  storeSession({ sessionToken: session.sessionToken, expiresAt: session.expiresAt });
  return session;
}

export async function resumeParentLegacySession(sessionToken: string): Promise<ParentLegacyDashboard> {
  const response = await supabase.rpc("parent_legacy_session_resume", {
    p_session_token: sessionToken,
    p_client_key: parentLegacyClientKey()
  });
  return requireDashboard(response as RpcResponse<ParentLegacyDashboard>, "Your Parent session expired. Please sign in again.");
}

export async function logoutParentLegacySession(sessionToken: string) {
  const response = await supabase.rpc("parent_legacy_session_logout", {
    p_session_token: sessionToken,
    p_client_key: parentLegacyClientKey()
  });
  if (response.error) throw new Error("Could not sign out safely. Please try again.");
  clearParentLegacySession();
}
