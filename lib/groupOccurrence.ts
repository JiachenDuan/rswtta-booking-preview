import type { Booking, ParentAccount } from "@/lib/types";

export type GroupOccurrenceAction = "update" | "cancel";
export type GroupOccurrenceScope = "single" | "future";
export type GroupEnrollmentScope = GroupOccurrenceScope;
export type GroupEnrollmentPreflight = {
  blockingReasons: string[];
  priceCents: number;
  status: Booking["status"];
};

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

/** Past enrollment is deliberately narrower than recurring management: one canonical, non-cancelled block only. */
export function isPastActiveGroupBlock(booking: Booking, now = new Date()) {
  return (
    isGroupBlock(booking) &&
    booking.status !== "cancelled" &&
    new Date(booking.startsAt).getTime() <= now.getTime() &&
    Boolean(booking.groupClassId && booking.seriesId && booking.recurrenceOccurrenceId && booking.recurrenceOriginalStartsAt)
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

export function selectGroupEnrollmentTargets(
  bookings: Booking[],
  selected: Booking,
  scope: GroupEnrollmentScope,
  now = new Date()
) {
  if (isPastActiveGroupBlock(selected, now)) {
    if (scope !== "single") throw new Error("Past group enrollment is limited to this group class only");
    const canonicalBlocks = bookings.filter((booking) => isGroupBlock(booking) && booking.groupClassId === selected.groupClassId);
    if (canonicalBlocks.length !== 1 || canonicalBlocks[0].id !== selected.id) {
      throw new Error("Past group occurrence must have exactly one canonical group block");
    }
    return { blocks: [selected], rows: bookings.filter((booking) => booking.groupClassId === selected.groupClassId) };
  }
  return selectGroupOccurrenceTargets(bookings, selected, scope, now);
}

function enrollmentBookingEndsAt(booking: Booking) {
  const match = booking.timeLabel.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i);
  if (!match) return new Date(booking.startsAt).getTime() + 60 * 60 * 1000;
  let hour = Number(match[4]) % 12;
  if (match[6].toUpperCase() === "PM") hour += 12;
  const end = new Date(booking.startsAt);
  end.setHours(hour, Number(match[5] || 0), 0, 0);
  if (end.getTime() <= new Date(booking.startsAt).getTime()) end.setDate(end.getDate() + 1);
  return end.getTime();
}

export function groupEnrollmentPreflight(bookings: Booking[], selected: Booking, studentAccountId: string): GroupEnrollmentPreflight {
  const groupRows = bookings.filter((booking) => booking.groupClassId === selected.groupClassId);
  const blockingReasons: string[] = [];
  if (groupRows.some((booking) => booking.program === "Group enrollment" && booking.studentAccountId === studentAccountId)) {
    blockingReasons.push("This student already has active or cancelled enrollment history for this occurrence.");
  }
  const startsAt = new Date(selected.startsAt).getTime();
  const endsAt = enrollmentBookingEndsAt(selected);
  if (bookings.some((booking) =>
    booking.studentAccountId === studentAccountId && booking.status !== "cancelled" &&
    new Date(booking.startsAt).getTime() < endsAt && enrollmentBookingEndsAt(booking) > startsAt
  )) blockingReasons.push("This student has another class that overlaps this occurrence.");

  const capacitySource = selected as Booking & { capacity?: number | string; maxCapacity?: number | string };
  const rawCapacity = capacitySource.capacity ?? capacitySource.maxCapacity;
  if (rawCapacity !== undefined) {
    const capacity = Number(rawCapacity);
    const activeRoster = groupRows.filter((booking) => booking.program === "Group enrollment" && booking.status !== "cancelled").length;
    if (!Number.isInteger(capacity) || capacity < 1) blockingReasons.push("This group occurrence has an invalid capacity value.");
    else if (activeRoster >= capacity) blockingReasons.push("This group occurrence is at capacity.");
  }
  const establishedPrice = groupRows
    .filter((booking) => booking.program === "Group enrollment" && booking.priceCents > 0)
    .sort((left, right) => {
      const createdOrder = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return createdOrder || left.id.localeCompare(right.id);
    })[0]?.priceCents;
  return {
    blockingReasons,
    priceCents: establishedPrice ?? 7500,
    status: selected.status === "coach_confirmed" ? "coach_confirmed" : "club_confirmed"
  };
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

export function searchGroupEnrollmentAccounts(accounts: ParentAccount[], query: string, excludedAccountIds: Set<string>) {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  return accounts
    .filter((account) => !excludedAccountIds.has(account.id))
    .filter((account) => account.studentName.trim().toLowerCase().includes(key) || account.id.toLowerCase().includes(key))
    .slice(0, 8);
}
