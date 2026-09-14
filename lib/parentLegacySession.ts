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

type StoredSession = Pick<ParentLegacySession, "sessionToken" | "expiresAt">;
type RpcResponse<T> = { data: T | null; error: { message: string } | null };

function storage() {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function parentLegacyClientKey() {
  const current = storage()?.getItem(parentLegacyClientKeyStorageKey);
  if (current) return current;
  const created = crypto.randomUUID();
  storage()?.setItem(parentLegacyClientKeyStorageKey, created);
  return created;
}

function requireData<T>(response: RpcResponse<T>, fallback: string): T {
  if (response.error || response.data == null) throw new Error(fallback);
  return response.data;
}

export function storeParentLegacySession(session: StoredSession) {
  storage()?.setItem(parentLegacySessionStorageKey, JSON.stringify(session));
}

export function readParentLegacySession(): StoredSession | null {
  const raw = storage()?.getItem(parentLegacySessionStorageKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    return value.sessionToken && value.expiresAt ? (value as StoredSession) : null;
  } catch {
    return null;
  }
}

export function clearParentLegacySession() {
  storage()?.removeItem(parentLegacySessionStorageKey);
}

export async function loginParentLegacySession(identifier: string, password: string): Promise<ParentLegacySession> {
  const response = await supabase.rpc("parent_legacy_session_login", {
    p_identifier: identifier.trim(),
    p_password: password,
    p_client_key: parentLegacyClientKey()
  });
  const session = requireData(response as RpcResponse<ParentLegacySession>, "Unable to sign in. Check your email and password.");
  storeParentLegacySession(session);
  return session;
}

export async function resumeParentLegacySession(sessionToken: string): Promise<ParentLegacyDashboard> {
  const response = await supabase.rpc("parent_legacy_session_resume", {
    p_session_token: sessionToken,
    p_client_key: parentLegacyClientKey()
  });
  return requireData(response as RpcResponse<ParentLegacyDashboard>, "Your Parent session expired. Please sign in again.");
}

export async function logoutParentLegacySession(sessionToken: string) {
  const response = await supabase.rpc("parent_legacy_session_logout", {
    p_session_token: sessionToken,
    p_client_key: parentLegacyClientKey()
  });
  if (response.error) throw new Error("Could not sign out safely. Please try again.");
  clearParentLegacySession();
}
