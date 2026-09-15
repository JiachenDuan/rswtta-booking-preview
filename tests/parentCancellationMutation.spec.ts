import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const storeSource = readFileSync("lib/projectStore.ts", "utf8");
const appSource = readFileSync("components/ClubApp.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260910220000_restore_parent_calendar_cancellation.sql", "utf8");
const verifiedClient = readFileSync("lib/parentVerifiedMutations.ts", "utf8");
const activationMigration = readFileSync("supabase/migrations/20260915130000_activation_auth_boundaries.sql", "utf8");

const parentStoreMutation = storeSource.slice(
  storeSource.indexOf("export async function cancelBookingAsParent"),
  storeSource.indexOf("export async function cancelBookingAsClub")
);
const parentHandler = appSource.slice(
  appSource.indexOf("async function cancelParentClass"),
  appSource.indexOf("async function completeParentClass")
);

test("Calendar cancellation uses one atomic database-clock RPC for persisted and virtual bookings", () => {
  expect(verifiedClient).toContain('supabase.rpc("parent_verified_cancel_booking"');
  expect(verifiedClient).toContain("p_booking_id: virtual ? null : booking.id");
  expect(verifiedClient).toContain("p_virtual_values: virtual ? virtualValues(booking) : null");
  expect(verifiedClient).not.toContain("accountId");
  expect(parentHandler).toContain("cancelVerifiedParentBooking(verifiedParentSessionToken, booking)");
  expect(activationMigration).toContain("rswtta_private.parent_verified_account(p_session_token,p_client_key)");
  expect(activationMigration).toContain("public.cancel_booking_as_parent(p_booking_id,v_account::text");
  expect(parentHandler).not.toContain("createBooking(");
});

test("database mutation rechecks ownership, status, past time, and the inclusive 12-hour boundary", () => {
  expect(migration).toContain("v_current_time timestamptz := clock_timestamp()");
  expect(migration).toContain("v_starts_at <= v_current_time then");
  expect(migration).toContain("v_starts_at <= v_current_time + interval '12 hours' then");
  expect(migration).toContain("coalesce(v_values->>'studentAccountId', '') <> btrim(p_student_account_id)");
  expect(migration).toContain("coalesce(v_values->>'status', '') not in ('requested', 'club_confirmed')");
});

test("direct generic updates remain rejected while club cancellation stays separate", () => {
  expect(migration).toContain("Booking cancellations must use the parent or club cancellation workflow");
  expect(migration).toContain("coalesce(v_actor, '') not in ('parent', 'club')");
  expect(migration).toContain("create or replace function public.cancel_booking_as_club");
  expect(migration).toContain("set_config('rswtta.cancellation_actor', 'club', true)");
  expect(storeSource).toContain('supabase.rpc("cancel_booking_as_club"');
});
