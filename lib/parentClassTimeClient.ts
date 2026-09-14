import { supabase } from "@/lib/supabase";
import type { Booking } from "@/lib/types";
import { parentClassTimeSnapshot } from "@/lib/parentClassTime";
import { parentLegacyClientKey } from "@/lib/parentLegacySession";

export type ParentClassTimeResult = {
  account: unknown;
  bookings: Booking[];
  calendarBookings: Booking[];
  serverNow: string;
  updatedBooking: Booking;
  replayed: boolean;
};

type RpcResponse<T> = { data: T | null; error: { message: string } | null };

function requireData<T>(response: RpcResponse<T>, message: string) {
  if (response.error || response.data == null) throw new Error(message);
  return response.data;
}

export async function issueParentClassTimeNonce(sessionToken: string) {
  const response = await supabase.rpc("parent_issue_class_time_update_nonce", {
    p_session_token: sessionToken,
    p_client_key: parentLegacyClientKey()
  });
  return requireData(
    response as RpcResponse<{ operationNonce: string; expiresAt: string }>,
    "Could not authorize the class-time update."
  );
}

export async function updateParentClassTime(
  sessionToken: string,
  booking: Booking,
  target: { startsAt: string; dateLabel: string; timeLabel: string },
  idempotencyKey: string
) {
  if (!sessionToken) throw new Error("A verified Parent session is required.");
  const nonce = await issueParentClassTimeNonce(sessionToken);
  const expected = parentClassTimeSnapshot(booking);
  const response = await supabase.rpc("parent_update_booking_time", {
    p_session_token: sessionToken,
    p_client_key: parentLegacyClientKey(),
    p_operation_nonce: nonce.operationNonce,
    p_selected_booking_id: expected.id,
    p_idempotency_key: idempotencyKey,
    p_expected_updated_at: expected.updatedAt,
    p_expected_status: expected.status,
    p_expected_starts_at: expected.startsAt,
    p_expected_series_id: expected.seriesId ?? null,
    p_expected_occurrence_id: expected.recurrenceOccurrenceId ?? null,
    p_expected_original_starts_at: expected.recurrenceOriginalStartsAt ?? null,
    p_target_starts_at: target.startsAt,
    p_target_date_label: target.dateLabel,
    p_target_time_label: target.timeLabel
  });
  return requireData(
    response as RpcResponse<ParentClassTimeResult>,
    "Could not update this class time. No changes were saved."
  );
}
