import { supabase } from "@/lib/supabase";
import { parentLegacyClientKey, type ParentLegacyDashboard } from "@/lib/parentLegacySession";
import { isParentLegacyDashboard, normalizeParentLegacyDashboard } from "@/lib/parentLegacyDashboard";
import type { Booking } from "@/lib/types";

export type ParentMutationResult = ParentLegacyDashboard & { changedBooking?: Booking };

type RpcResponse = { data: unknown; error: { message: string } | null };
function dashboard(response: RpcResponse, fallback: string): ParentMutationResult {
  if (response.error || !response.data || typeof response.data !== "object" || !isParentLegacyDashboard(response.data)) {
    throw new Error(response.error?.message || fallback);
  }
  return normalizeParentLegacyDashboard(response.data as ParentMutationResult);
}
function proof(sessionToken: string) {
  if (!sessionToken) throw new Error("A verified Parent session is required.");
  return { p_session_token: sessionToken, p_client_key: parentLegacyClientKey() };
}

export async function updateVerifiedParentProfile(sessionToken: string, profile: { studentName: string; parentName: string; email: string; phone: string }) {
  return dashboard(await supabase.rpc("parent_verified_update_profile", { ...proof(sessionToken), p_profile: profile }), "Could not update this Parent profile.");
}

export async function requestVerifiedParentPrivateBooking(sessionToken: string, values: Omit<Booking, "id" | "status" | "createdAt" | "updatedAt">) {
  return dashboard(await supabase.rpc("parent_verified_request_private_booking", { ...proof(sessionToken), p_request_id: crypto.randomUUID(), p_values: values }), "Could not request this class.");
}

export async function requestVerifiedParentGroupClass(sessionToken: string, groupBookingId: string) {
  return dashboard(await supabase.rpc("parent_verified_request_group_class", { ...proof(sessionToken), p_request_id: crypto.randomUUID(), p_group_booking_id: groupBookingId }), "Could not request this group class.");
}

function virtualValues(booking: Booking) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = booking;
  return values;
}

export async function cancelVerifiedParentBooking(sessionToken: string, booking: Booking) {
  const virtual = booking.id.startsWith("virtual-");
  return dashboard(await supabase.rpc("parent_verified_cancel_booking", { ...proof(sessionToken), p_booking_id: virtual ? null : booking.id, p_virtual_values: virtual ? virtualValues(booking) : null }), "Could not cancel this class.");
}

export async function completeVerifiedParentBooking(sessionToken: string, booking: Booking) {
  const virtual = booking.id.startsWith("virtual-");
  return dashboard(await supabase.rpc("parent_verified_complete_booking", { ...proof(sessionToken), p_booking_id: virtual ? null : booking.id, p_virtual_values: virtual ? virtualValues(booking) : null }), "Could not complete this class.");
}
