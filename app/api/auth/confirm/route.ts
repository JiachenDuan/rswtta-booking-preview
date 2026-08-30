import { NextRequest, NextResponse } from "next/server";
import { confirmParentAccount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const account = confirmParentAccount(String(body.email ?? ""), String(body.confirmationCode ?? ""));

  if (!account) {
    return NextResponse.json({ error: "Invalid confirmation code" }, { status: 400 });
  }

  return NextResponse.json({ account });
}
