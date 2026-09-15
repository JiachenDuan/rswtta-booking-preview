"use server";

import { redirect } from "next/navigation";
import { createCoachSupabaseClient } from "@/lib/coachAuth/server";
import { coachAuthConfiguration, isCoachAuthEnabled } from "@/lib/coachAuth/config";
import type { CoachActionState } from "@/lib/coachAuth/actionState";

function unavailable(): CoachActionState {
  return { status: "error", message: "Coach access is unavailable. 教练入口暂不可用。" };
}

export async function coachLoginAction(_state: CoachActionState, formData: FormData): Promise<CoachActionState> {
  if (!isCoachAuthEnabled()) return unavailable();
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
  redirect("/coach");
}

export async function coachResetAction(_state: CoachActionState, formData: FormData): Promise<CoachActionState> {
  if (!isCoachAuthEnabled()) return unavailable();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const generic = { status: "success" as const, message: "If this email is eligible, a reset link will be sent. 如该邮箱符合条件，我们会发送重置链接。" };
  if (!email) return generic;
  try {
    const configuration = coachAuthConfiguration();
    if (!configuration) return unavailable();
    const supabase = await createCoachSupabaseClient();
    const redirectTo = new URL("/coach/confirm", configuration.siteUrl).toString();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  } catch {
    // Keep the same response to avoid disclosing whether a coach account exists.
  }
  return generic;
}

const confirmationTypes = new Set(["invite", "recovery"]);

export async function coachConfirmAction(_state: CoachActionState, formData: FormData): Promise<CoachActionState> {
  if (!isCoachAuthEnabled()) return unavailable();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (password.length < 12) return { status: "error", message: "Use at least 12 characters. 密码至少需要 12 个字符。" };
  if (password !== confirmPassword) return { status: "error", message: "Passwords do not match. 两次输入的密码不一致。" };

  try {
    const supabase = await createCoachSupabaseClient();
    const code = String(formData.get("code") ?? "");
    const tokenHash = String(formData.get("token_hash") ?? "");
    const type = String(formData.get("type") ?? "");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else if (tokenHash && confirmationTypes.has(type)) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "invite" | "recovery" });
      if (error) throw error;
    } else {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return { status: "error", message: "This secure link is missing or expired. 安全链接无效或已过期。" };
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) throw updateError;
    const { error: invitationError } = await supabase.rpc("operator_accept_invitation", {
      p_request_id: crypto.randomUUID()
    });
    if (invitationError) throw invitationError;
  } catch {
    return { status: "error", message: "This secure link is invalid or expired. Please request a new one. 安全链接无效或已过期，请重新申请。" };
  }
  redirect("/coach");
}

export async function coachLogoutAction(): Promise<void> {
  if (!isCoachAuthEnabled()) redirect("/coach/login");
  try {
    const supabase = await createCoachSupabaseClient();
    await supabase.auth.signOut();
  } finally {
    redirect("/coach/login");
  }
}
