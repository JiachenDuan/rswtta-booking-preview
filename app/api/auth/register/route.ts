import { NextRequest, NextResponse } from "next/server";
import { createParentAccount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const required = ["studentName", "email", "phone", "password"];

  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 });
    }
  }

  if (String(body.password).length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const result = createParentAccount({
    studentName: String(body.studentName),
    email: String(body.email),
    phone: String(body.phone),
    password: String(body.password)
  });

  return NextResponse.json({
    account: result.account,
    confirmationCode: result.confirmationCode,
    alreadyExists: result.alreadyExists,
    message: "Confirmation email is simulated in this MVP."
  });
}
