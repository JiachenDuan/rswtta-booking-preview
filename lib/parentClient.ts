import { supabase } from "@/lib/supabase";
import type { Booking, ParentAccount } from "@/lib/types";
import type { ParentCancellationScope } from "@/lib/parentCancellation";

export const parentSessionStorageKey = "rswtta-parent-session-token";
const parentClientKeyStorageKey = "rswtta-parent-client-key";

export type ParentDashboard = {
  account: ParentAccount;
  bookings: Booking[];
  calendarBookings: Booking[];
  serverNow: string;
};

export type ParentSession = ParentDashboard & {
  sessionToken: string;
  refreshToken: string;
  expiresAt: string;
};

type RpcResponse<T> = { data: T | null; error: { message: string } | null };
type StoredParentSession = Pick<ParentSession, "sessionToken" | "refreshToken" | "expiresAt">;

function genericAuthError() {
  return new Error("Unable to sign in. Check your username and password.");
}

function requireData<T>(response: RpcResponse<T>, fallback: string): T {
  if (response.error || response.data == null) throw new Error(fallback);
  return response.data;
}

function browserStorage() {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function parentClientKey() {
  const storage = browserStorage();
  const existing = storage?.getItem(parentClientKeyStorageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  storage?.setItem(parentClientKeyStorageKey, created);
  return created;
}

export function storeParentSession(session: StoredParentSession) {
  browserStorage()?.setItem(parentSessionStorageKey, JSON.stringify(session));
}

export function readParentSession(): StoredParentSession | null {
  const raw = browserStorage()?.getItem(parentSessionStorageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredParentSession>;
    return parsed.sessionToken && parsed.refreshToken && parsed.expiresAt ? parsed as StoredParentSession : null;
  } catch {
    return null;
  }
}

export function clearStoredParentSession() {
  browserStorage()?.removeItem(parentSessionStorageKey);
}

export async function loginParentSession(username: string, password: string): Promise<ParentSession> {
  const response = await supabase.rpc("parent_session_login", {
    p_username: username.trim(),
    p_password: password,
    p_client_key: parentClientKey()
  });
  if (response.error || !response.data) throw genericAuthError();
  const session = response.data as unknown as ParentSession;
  storeParentSession(session);
  return session;
}

export async function refreshParentSession(sessionToken: string): Promise<ParentSession> {
  const stored = readParentSession();
  if (!stored || stored.sessionToken !== sessionToken) throw new Error("Your session expired. Please sign in again.");
  const response = await supabase.rpc("parent_session_refresh", {
    p_session_token: stored.sessionToken,
    p_refresh_token: stored.refreshToken,
    p_client_key: parentClientKey()
  });
  const session = requireData(response as RpcResponse<ParentSession>, "Your session expired. Please sign in again.");
  storeParentSession(session);
  return session;
}

export async function logoutParentSession(sessionToken: string) {
  const response = await supabase.rpc("parent_session_logout", { p_session_token: sessionToken });
  if (response.error) throw new Error("Could not sign out safely. Please try again.");
  clearStoredParentSession();
}

export async function updateParentProfile(
  sessionToken: string,
  input: { studentName: string; parentName: string; email: string; phone: string }
): Promise<ParentDashboard> {
  const response = await supabase.rpc("parent_update_profile", {
    p_session_token: sessionToken,
    p_profile: input
  });
  return requireData(response as RpcResponse<ParentDashboard>, "Could not update student info.");
}

export async function completeParentProfile(
  sessionToken: string,
  input: { studentName: string; parentName: string; email: string; phone: string; password: string }
): Promise<ParentDashboard> {
  const response = await supabase.rpc("parent_complete_profile", {
    p_session_token: sessionToken,
    p_profile: input
  });
  return requireData(response as RpcResponse<ParentDashboard>, "Could not complete profile setup.");
}

export async function requestParentPasswordReset(username: string) {
  const response = await supabase.rpc("parent_request_password_reset", { p_username: username.trim() });
  return requireData(response as RpcResponse<{ accepted: boolean; queued: boolean }>, "Could not submit password reset request.");
}

export async function requestParentBooking(
  sessionToken: string,
  input: Pick<Booking, "requestedCoach" | "assignedCoach" | "program" | "dateLabel" | "timeLabel" | "startsAt" | "priceCents" | "parentNote">
): Promise<ParentDashboard> {
  const response = await supabase.rpc("parent_request_booking", {
    p_session_token: sessionToken,
    p_idempotency_key: crypto.randomUUID(),
    p_values: input
  });
  return requireData(response as RpcResponse<ParentDashboard>, "Could not save booking request.");
}

export async function requestParentGroupClass(sessionToken: string, selectedBookingId: string): Promise<ParentDashboard> {
  const response = await supabase.rpc("parent_request_group_class", {
    p_session_token: sessionToken,
    p_selected_booking_id: selectedBookingId,
    p_idempotency_key: crypto.randomUUID()
  });
  return requireData(response as RpcResponse<ParentDashboard>, "Could not save group class request.");
}

export async function completeParentBooking(
  sessionToken: string,
  booking: Pick<Booking, "id" | "updatedAt">
): Promise<ParentDashboard> {
  const response = await supabase.rpc("parent_complete_booking", {
    p_session_token: sessionToken,
    p_selected_booking_id: booking.id,
    p_expected_selected_version: booking.updatedAt,
    p_idempotency_key: crypto.randomUUID()
  });
  return requireData(response as RpcResponse<ParentDashboard>, "Could not mark class complete.");
}

async function issueParentOperationNonce(sessionToken: string) {
  const response = await supabase.rpc("parent_issue_operation_nonce", {
    p_session_token: sessionToken,
    p_operation: "cancel_booking_occurrences"
  });
  return requireData(response as RpcResponse<{ operationNonce: string }>, "Could not authorize cancellation.");
}

export async function cancelParentRecurring(
  sessionToken: string,
  booking: Pick<Booking, "id" | "updatedAt" | "seriesId" | "recurrenceOriginalStartsAt" | "startsAt">,
  scope: ParentCancellationScope,
  idempotencyKey: string,
  expectedEligibleCount: number
): Promise<ParentDashboard & { cancelledCount: number }> {
  const nonce = await issueParentOperationNonce(sessionToken);
  const response = await supabase.rpc("parent_cancel_booking_occurrences", {
    p_session_token: sessionToken,
    p_operation_nonce: nonce.operationNonce,
    p_selected_booking_id: booking.id,
    p_scope: scope,
    p_idempotency_key: idempotencyKey,
    p_expected_selected_version: booking.updatedAt,
    p_expected_series_id: booking.seriesId ?? null,
    p_expected_original_starts_at: booking.recurrenceOriginalStartsAt ?? booking.startsAt,
    p_expected_eligible_count: expectedEligibleCount
  });
  return requireData(
    response as RpcResponse<ParentDashboard & { cancelledCount: number }>,
    "Could not cancel the selected class or its future occurrences."
  );
}
