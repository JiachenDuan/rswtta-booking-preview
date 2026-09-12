import type { Booking } from "@/lib/types";

export type GroupOccurrenceAction = "update" | "cancel";
export type GroupOccurrenceScope = "single" | "future";

export function isGroupBlock(booking: Booking) {
  return booking.program === "Group class" && booking.studentName.trim().toLowerCase() === "group class";
}

export function isFutureActiveGroupBlock(booking: Booking, now = new Date()) {
  return (
    isGroupBlock(booking) &&
    booking.status !== "cancelled" &&
    booking.status !== "coach_confirmed" &&
    new Date(booking.startsAt).getTime() > now.getTime()
  );
}

function originalTime(booking: Booking) {
  return new Date(booking.recurrenceOriginalStartsAt || booking.startsAt).getTime();
}

/** Selects complete group units by immutable series/occurrence identity, never by names or mutable current times. */
export function selectGroupOccurrenceTargets(
  bookings: Booking[],
  selected: Booking,
  scope: GroupOccurrenceScope,
  now = new Date()
) {
  if (!isFutureActiveGroupBlock(selected, now)) throw new Error("Select a future active group class block");
  if (!selected.groupClassId || !selected.seriesId || !selected.recurrenceOccurrenceId || !selected.recurrenceOriginalStartsAt) {
    throw new Error("Group occurrence identity is incomplete");
  }

  const boundary = originalTime(selected);
  const blocks = scope === "single"
    ? [selected]
    : bookings.filter((booking) =>
        isFutureActiveGroupBlock(booking, now) &&
        booking.seriesId === selected.seriesId &&
        originalTime(booking) >= boundary
      );
  const groupIds = new Set(blocks.map((booking) => booking.groupClassId).filter(Boolean));
  const rows = bookings.filter((booking) => Boolean(booking.groupClassId && groupIds.has(booking.groupClassId)));
  const completeGroupIds = new Set(rows.filter(isGroupBlock).map((booking) => booking.groupClassId));
  if (blocks.length === 0 || completeGroupIds.size !== groupIds.size) throw new Error("Group occurrence membership is incomplete");
  for (const groupClassId of groupIds) {
    if (rows.filter((booking) => booking.groupClassId === groupClassId && isGroupBlock(booking)).length !== 1) {
      throw new Error("Each group occurrence must have exactly one group block");
    }
  }
  return { blocks, rows };
}

export function expectedGroupOccurrenceRows(rows: Booking[]) {
  return rows.map((booking) => ({
    id: booking.id,
    groupClassId: booking.groupClassId,
    seriesId: booking.seriesId,
    recurrenceOccurrenceId: booking.recurrenceOccurrenceId,
    recurrenceOriginalStartsAt: booking.recurrenceOriginalStartsAt,
    startsAt: booking.startsAt,
    status: booking.status,
    program: booking.program,
    studentAccountId: booking.studentAccountId ?? null,
    updatedAt: booking.updatedAt
  }));
}

export function groupOccurrenceTargetStartsAt(block: Booking, selected: Booking, selectedTargetStartsAt: string) {
  const selectedOriginal = new Date(selected.recurrenceOriginalStartsAt || selected.startsAt).getTime();
  const blockOriginal = new Date(block.recurrenceOriginalStartsAt || block.startsAt).getTime();
  const seriesOffset = new Date(selectedTargetStartsAt).getTime() - selectedOriginal;
  return new Date(blockOriginal + seriesOffset).toISOString();
}

export function groupOccurrenceScheduleWouldChange(
  blocks: Booking[],
  selected: Booking,
  selectedTargetStartsAt: string,
  targetTimeLabel: string
) {
  return blocks.some((block) =>
    block.startsAt !== groupOccurrenceTargetStartsAt(block, selected, selectedTargetStartsAt) ||
    block.timeLabel !== targetTimeLabel
  );
}
