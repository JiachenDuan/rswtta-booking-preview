import { NextRequest, NextResponse } from "next/server";
import { BookingStatus, updateBooking } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set<BookingStatus>(["requested", "club_confirmed", "change_requested", "cancelled", "coach_confirmed"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  const status = String(body.status) as BookingStatus;

  if (!statuses.has(status)) {
    return NextResponse.json({ error: "Invalid booking status" }, { status: 400 });
  }

  const booking = updateBooking(id, {
    status,
    assignedCoach: body.assignedCoach ? String(body.assignedCoach) : undefined,
    dateLabel: body.dateLabel ? String(body.dateLabel) : undefined,
    timeLabel: body.timeLabel ? String(body.timeLabel) : undefined,
    startsAt: body.startsAt ? String(body.startsAt) : undefined,
    parentNote: body.parentNote ? String(body.parentNote) : undefined
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json({ booking });
}
