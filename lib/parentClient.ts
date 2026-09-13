import { supabase } from "@/lib/supabase";
import type { Booking, ParentAccount } from "@/lib/types";
import type { ParentCancellationScope } from "@/lib/parentCancellation";

export const parentSessionStorageKey = "rswtta-parent-session-token";

export type ParentDashboard = {
  account: ParentAccount;
  bookings: Booking[];
  calendarBookings: Booking[];
  serverNow: string;
};

export type ParentSession = ParentDashboard & { sessionToken: string };

type RpcResponse<T> = { data: T | null; error: { message: string } | null };

function genericAuthError() {
  return new Error("Unable to sign in. Check your username and password.");
}

function requireData<T>(response: RpcResponse<T>, fallback: string): T {
  if (response.error || response.data == null) throw new Error(fallback);
  return response.data;
}

export async function loginParentSession(username: string, password: string): Promise<ParentSession> {
  const response = await supabase.rpc("parent_session_login", {
    p_username: username.trim(),
    p_password: password
  });
  if (response.error || !response.data) throw genericAuthError();
  return response.data as unknown as ParentSession;
}

export async function refreshParentSession(sessionToken: string): Promise<ParentDashboard> {
  const response = await supabase.rpc("parent_session_refresh", { p_session_token: sessionToken });
  return requireData(response as RpcResponse<ParentDashboard>, "Your session expired. Please sign in again.");
}

export async function logoutParentSession(sessionToken: string) {
  const response = await supabase.rpc("parent_session_logout", { p_session_token: sessionToken });
  if (response.error) throw new Error("Could not sign out safely. Please try again.");
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
  // The server always returns success so account existence is not disclosed.
  await supabase.rpc("parent_request_password_reset", { p_username: username.trim() });
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

export async function cancelParentRecurring(
  sessionToken: string,
  booking: Pick<Booking, "id" | "updatedAt" | "recurrenceOriginalStartsAt" | "startsAt">,
  scope: ParentCancellationScope,
  idempotencyKey: string
): Promise<ParentDashboard & { cancelledCount: number }> {
  const response = await supabase.rpc("parent_cancel_booking_occurrences", {
    p_session_token: sessionToken,
    p_selected_booking_id: booking.id,
    p_scope: scope,
    p_idempotency_key: idempotencyKey,
    p_expected_selected_version: booking.updatedAt,
    p_expected_original_starts_at: booking.recurrenceOriginalStartsAt ?? booking.startsAt
  });
  return requireData(
    response as RpcResponse<ParentDashboard & { cancelledCount: number }>,
    "Could not cancel the selected class or its future occurrences."
  );
}
