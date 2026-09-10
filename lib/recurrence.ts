import type { Booking } from "@/lib/types";

export type RecurrenceScope = "single" | "future" | "all";
export type RecurrenceIdentity = Pick<Booking, "seriesId" | "recurrenceOccurrenceId" | "recurrenceOriginalStartsAt">;

function stablePart(value: string) {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function occurrenceId(seriesId: string, originalStartsAt: string) {
  return `${seriesId}@${new Date(originalStartsAt).toISOString()}`;
}

export function recurrenceIdentity(seriesId: string, originalStartsAt: string): RecurrenceIdentity {
  const original = new Date(originalStartsAt).toISOString();
  return { seriesId, recurrenceOriginalStartsAt: original, recurrenceOccurrenceId: occurrenceId(seriesId, original) };
}

export function newSeriesId() {
  return `series:${crypto.randomUUID()}`;
}

export function importedSeriesId(coach: string, owner: string, source: string) {
  return ["import", coach, owner, source].map(stablePart).join(":");
}

export function legacyImportedSeriesId(booking: Pick<Booking, "parentNote" | "assignedCoach" | "requestedCoach" | "studentAccountId" | "program">) {
  const source = booking.parentNote.match(/\(([^)]+)\)/)?.[1];
  const note = booking.parentNote.toLowerCase();
  if (!source || !note.includes("recurring") || !note.includes("class")) return undefined;
  return importedSeriesId(booking.assignedCoach || booking.requestedCoach, booking.studentAccountId || booking.program, source);
}

export function withDerivedRecurringIdentity<T extends Booking>(booking: T): T {
  if (booking.seriesId && booking.recurrenceOccurrenceId && booking.recurrenceOriginalStartsAt) return booking;
  const seriesId = booking.seriesId || legacyImportedSeriesId(booking);
  if (!seriesId) return booking;
  return { ...booking, ...recurrenceIdentity(seriesId, booking.recurrenceOriginalStartsAt || booking.startsAt) };
}

export function stableBookingEntityId(booking: Booking) {
  return booking.recurrenceOccurrenceId || booking.id;
}

export function recurringFieldsForSlots(slots: Array<{ startsAt: string }>, seriesId = newSeriesId()) {
  return slots.map((slot) => recurrenceIdentity(seriesId, slot.startsAt));
}

export type RescheduleChange = {
  id?: string;
  oldStartsAt: string;
  newStartsAt: string;
  values: Booking;
};

/** Pure planner used by the UI and regressions; storage applies this list atomically. */
export function planRecurringReschedule(bookings: Booking[], selected: Booking, selectedStartsAt: string, scope: RecurrenceScope): RescheduleChange[] {
  const chosen = withDerivedRecurringIdentity(selected);
  const originalBoundary = new Date(chosen.recurrenceOriginalStartsAt || chosen.startsAt).getTime();
  const selectedSeriesId = chosen.seriesId;

  let occurrenceRoots: Booking[];
  if (scope === "single" || !selectedSeriesId) {
    occurrenceRoots = [chosen];
  } else {
    occurrenceRoots = bookings
      .map(withDerivedRecurringIdentity)
      .filter((item) => item.seriesId === selectedSeriesId)
      .filter((item) => item.id === chosen.id || (item.status !== "cancelled" && item.status !== "coach_confirmed"))
      .filter((item) => scope === "all" || new Date(item.recurrenceOriginalStartsAt || item.startsAt).getTime() >= originalBoundary);
  }

  const rootOccurrenceIds = new Set(occurrenceRoots.map((item) => item.recurrenceOccurrenceId || item.id));
  const groupIds = new Set(occurrenceRoots.map((item) => item.groupClassId).filter(Boolean));
  const targets = bookings
    .map(withDerivedRecurringIdentity)
    .filter((item) => rootOccurrenceIds.has(item.recurrenceOccurrenceId || item.id) || Boolean(item.groupClassId && groupIds.has(item.groupClassId)));
  if (!targets.some((item) => (item.recurrenceOccurrenceId || item.id) === (chosen.recurrenceOccurrenceId || chosen.id))) targets.push(chosen);

  const rootNewStarts = new Map<string, string>();
  const selectedDeltaMs = new Date(selectedStartsAt).getTime() - new Date(chosen.startsAt).getTime();
  for (const root of occurrenceRoots) {
    const key = root.recurrenceOccurrenceId || root.id;
    rootNewStarts.set(
      key,
      scope === "single"
        ? new Date(selectedStartsAt).toISOString()
        : new Date(new Date(root.startsAt).getTime() + selectedDeltaMs).toISOString()
    );
  }

  return targets.map((target) => {
    const root = occurrenceRoots.find((item) =>
      (item.recurrenceOccurrenceId || item.id) === (target.recurrenceOccurrenceId || target.id) ||
      Boolean(item.groupClassId && item.groupClassId === target.groupClassId)
    ) || chosen;
    const rootKey = root.recurrenceOccurrenceId || root.id;
    const rootNext = rootNewStarts.get(rootKey) || new Date(selectedStartsAt).toISOString();
    const offset = new Date(target.startsAt).getTime() - new Date(root.startsAt).getTime();
    const newStartsAt = new Date(new Date(rootNext).getTime() + offset).toISOString();
    return {
      id: target.id.startsWith("virtual-") ? undefined : target.id,
      oldStartsAt: target.startsAt,
      newStartsAt,
      values: { ...target, startsAt: newStartsAt }
    };
  });
}
