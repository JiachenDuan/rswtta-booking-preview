import { NextResponse } from "next/server";
import { generateWeeklyBills, listBillNotifications } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ bills: listBillNotifications() });
}

export async function POST() {
  const bills = generateWeeklyBills();
  return NextResponse.json({ bills }, { status: 201 });
}
