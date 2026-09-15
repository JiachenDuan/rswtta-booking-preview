export type ConfirmationType = "invite" | "recovery";

export type CoachConfirmationInput =
  | { kind: "implicit"; accessToken: string; refreshToken: string; type: ConfirmationType }
  | { kind: "pkce"; code: string }
  | { kind: "otp"; tokenHash: string; type: ConfirmationType }
  | { kind: "session" }
  | { kind: "error" };

function confirmationType(value: string | null): ConfirmationType | null {
  return value === "invite" || value === "recovery" ? value : null;
}

/**
 * Supabase's default templates redirect implicit invite/recovery sessions in the
 * URL fragment. Fragments never reach Server Components, so they must be parsed
 * in the browser before the URL is cleaned.
 */
export function parseCoachConfirmationInput(input: {
  code?: string;
  tokenHash?: string;
  type?: string;
  hash?: string;
}): CoachConfirmationInput {
  const hash = new URLSearchParams((input.hash ?? "").replace(/^#/, ""));
  if (hash.has("error") || hash.has("error_code") || hash.has("error_description")) return { kind: "error" };

  const accessToken = hash.get("access_token") ?? "";
  const refreshToken = hash.get("refresh_token") ?? "";
  const hashType = confirmationType(hash.get("type"));
  if (accessToken && refreshToken && hashType) {
    return { kind: "implicit", accessToken, refreshToken, type: hashType };
  }

  if (input.code) return { kind: "pkce", code: input.code };
  const queryType = confirmationType(input.type ?? null);
  if (input.tokenHash && queryType) return { kind: "otp", tokenHash: input.tokenHash, type: queryType };
  return { kind: "session" };
}

export type PasswordUpdateError = { code?: string; message?: string } | null | undefined;

export function passwordUpdateErrorMessage(error: PasswordUpdateError): string {
  const code = error?.code ?? "";
  const message = error?.message?.toLowerCase() ?? "";
  if (code === "weak_password" || message.includes("password")) {
    return "That password does not meet the security requirements. Choose a different password. 密码不符合安全要求，请更换密码。";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || message.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again. 尝试次数过多，请稍后重试。";
  }
  if (code === "session_not_found" || code === "refresh_token_not_found" || message.includes("session")) {
    return "This secure link has expired. Request a new reset link. 安全链接已过期，请重新申请。";
  }
  return "Could not set your password. Please try again. 无法设置密码，请重试。";
}

export const invitationCompletionErrorMessage =
  "Your password was set, but Club access could not finish. Sign in with your new password to continue. 密码已设置，但俱乐部权限未能完成，请使用新密码登录。";
