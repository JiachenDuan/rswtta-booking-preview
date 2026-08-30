import { NextRequest, NextResponse } from "next/server";
import { loginParentAccount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const account = loginParentAccount(String(body.identifier ?? ""), String(body.password ?? ""));

  if (!account) {
    return NextResponse.json({ error: "Invalid login or email not confirmed" }, { status: 401 });
  }

  return NextResponse.json({ account });
}
