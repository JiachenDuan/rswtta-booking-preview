"use server";

import { redirect } from "next/navigation";
import { createCoachRecoverySupabaseClient, createCoachSupabaseClient } from "@/lib/coachAuth/server";
import { coachAuthConfiguration, isOperatorAuthEnabled } from "@/lib/coachAuth/config";
import type { CoachActionState } from "@/lib/coachAuth/actionState";

function unavailable(): CoachActionState {
  return { status: "error", message: "Club operator access is unavailable. 俱乐部员工入口暂不可用。" };
}

export async function coachLoginAction(_state: CoachActionState, formData: FormData): Promise<CoachActionState> {
  if (!isOperatorAuthEnabled()) return unavailable();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { status: "error", message: "Enter your email and password. 请输入邮箱和密码。" };

  try {
    const supabase = await createCoachSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { status: "error", message: "Unable to sign in with those details. 登录信息不正确。" };
  } catch {
    return { status: "error", message: "Sign-in is temporarily unavailable. 登录暂时不可用。" };
  }
  redirect("/club");
}

export async function coachResetAction(_state: CoachActionState, formData: FormData): Promise<CoachActionState> {
  if (!isOperatorAuthEnabled()) return unavailable();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const generic = { status: "success" as const, message: "If this email is eligible, a reset link will be sent. 如该邮箱符合条件，我们会发送重置链接。" };
  if (!email) return generic;
  try {
    const configuration = coachAuthConfiguration();
    if (!configuration) return unavailable();
    const supabase = createCoachRecoverySupabaseClient();
    const redirectTo = new URL("/coach/confirm", configuration.siteUrl).toString();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  } catch {
    // Keep the same response to avoid disclosing whether an operator account exists.
  }
  return generic;
}

export async function coachLogoutAction(): Promise<void> {
  if (!isOperatorAuthEnabled()) redirect("/coach/login");
  try {
    const supabase = await createCoachSupabaseClient();
    await supabase.auth.signOut();
  } finally {
    redirect("/coach/login");
  }
}
