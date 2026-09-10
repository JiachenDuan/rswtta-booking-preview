import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const storeSource = readFileSync("lib/projectStore.ts", "utf8");
const appSource = readFileSync("components/ClubApp.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260910210000_parent_cancellation_cutoff.sql", "utf8");

const parentStoreMutation = storeSource.slice(
  storeSource.indexOf("export async function cancelBookingAsParent"),
  storeSource.indexOf("export async function cancelBookingAsClub")
);
const parentHandler = appSource.slice(
  appSource.indexOf("async function cancelParentClass"),
  appSource.indexOf("async function addGroupDropIn")
);

test("direct parent handler calls an atomic database-clock RPC for persisted and virtual bookings", () => {
  expect(parentStoreMutation).toContain('supabase.rpc("cancel_booking_as_parent"');
  expect(parentStoreMutation).toContain('p_booking_id: isVirtual ? null : booking.id');
  expect(parentStoreMutation).toContain('p_virtual_values: isVirtual ? virtualCancellationValues(booking) : null');
  expect(parentStoreMutation).not.toContain("Date.now()");
  expect(parentStoreMutation).not.toContain("updateRow(");
  expect(parentHandler).toContain('cancelBookingAsParent(booking, parentSession?.id ?? "")');
});

test("database mutation rechecks ownership, status, past time, and the inclusive 12-hour boundary", () => {
  expect(migration).toContain("v_current_time timestamptz := clock_timestamp()");
  expect(migration).toContain("v_starts_at <= v_current_time then");
  expect(migration).toContain("v_starts_at <= v_current_time + interval '12 hours' then");
  expect(migration).toContain("coalesce(v_values->>'studentAccountId', '') <> btrim(p_student_account_id)");
  expect(migration).toContain("coalesce(v_values->>'status', '') not in ('requested', 'club_confirmed')");
});

test("stale direct updates are rejected while club cancellation keeps a separate unrestricted workflow", () => {
  expect(migration).toContain("Booking cancellations must use the parent or club cancellation workflow");
  expect(migration).toContain("coalesce(v_actor, '') not in ('parent', 'club')");
  expect(migration).toContain("create or replace function public.cancel_booking_as_club");
  expect(storeSource).toContain('supabase.rpc("cancel_booking_as_club"');
  expect(parentHandler).not.toContain("createBooking(");
});
