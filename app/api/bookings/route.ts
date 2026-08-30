import { NextRequest, NextResponse } from "next/server";
import { createBooking, listBookings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ bookings: listBookings() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const required = ["studentName", "familyName", "studentEmail", "phone", "requestedCoach", "program", "dateLabel", "timeLabel", "startsAt", "priceCents"];

  for (const field of required) {
    if (body[field] === undefined || body[field] === "") {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 });
    }
  }

  const booking = createBooking({
    studentName: String(body.studentName),
    familyName: String(body.familyName),
    studentEmail: String(body.studentEmail),
    phone: String(body.phone),
    requestedCoach: String(body.requestedCoach),
    assignedCoach: String(body.requestedCoach),
    program: String(body.program),
    dateLabel: String(body.dateLabel),
    timeLabel: String(body.timeLabel),
    startsAt: String(body.startsAt),
    priceCents: Number(body.priceCents),
    parentNote: String(body.parentNote ?? "")
  });

  return NextResponse.json({ booking }, { status: 201 });
}
