import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const storeSource = readFileSync("lib/projectStore.ts", "utf8");
const appSource = readFileSync("components/ClubApp.tsx", "utf8");
const cutoffMigration = readFileSync("supabase/migrations/20260910210000_parent_cancellation_cutoff.sql", "utf8");
const disableMigration = readFileSync("supabase/migrations/20260910215000_disable_parent_cancellation.sql", "utf8");

const parentStoreMutation = storeSource.slice(
  storeSource.indexOf("export async function cancelBookingAsParent"),
  storeSource.indexOf("export async function cancelBookingAsClub")
);

test("current Parent App and business layer expose no cancellation mutation", () => {
  expect(appSource).not.toContain("cancelBookingAsParent");
  expect(appSource).not.toContain("async function cancelParentClass");
  expect(appSource).not.toContain("ParentClassCompleteModal");
  expect(parentStoreMutation).toContain('throw new Error("Parent cancellation is not available. Please contact the club assistant.")');
  expect(parentStoreMutation).not.toContain("supabase.rpc");
  expect(parentStoreMutation).not.toContain("updateRow(");
});

test("stale parent RPC calls and direct cancellation updates are rejected for every class time", () => {
  expect(disableMigration).toContain("create or replace function public.cancel_booking_as_parent");
  expect(disableMigration).toContain("raise exception 'Parent cancellation is not available. Please contact the club assistant.'");
  expect(disableMigration).toContain("if coalesce(v_actor, '') <> 'club' then");
  expect(disableMigration).not.toContain("interval '12 hours'");
  expect(disableMigration).not.toContain("v_starts_at");
});

test("club cancellation keeps its separate unrestricted workflow", () => {
  expect(cutoffMigration).toContain("create or replace function public.cancel_booking_as_club");
  expect(cutoffMigration).toContain("set_config('rswtta.cancellation_actor', 'club', true)");
  expect(storeSource).toContain('supabase.rpc("cancel_booking_as_club"');
  expect(disableMigration).not.toContain("create or replace function public.cancel_booking_as_club");
});
