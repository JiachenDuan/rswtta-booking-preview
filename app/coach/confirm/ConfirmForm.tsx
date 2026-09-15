"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createCoachSupabaseBrowserClient } from "@/lib/coachAuth/browser";
import {
  invitationCompletionErrorMessage,
  parseCoachConfirmationInput,
  passwordUpdateErrorMessage
} from "@/lib/coachAuth/confirmation";

type FormStatus = "loading" | "ready" | "submitting" | "error" | "password-set-error";

const invalidLinkMessage =
  "This secure link is invalid or expired. Please request a new one. 安全链接无效或已过期，请重新申请。";

function cleanConfirmationUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("code");
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

export function ConfirmForm({ code, tokenHash, type }: { code: string; tokenHash: string; type: string }) {
  const [status, setStatus] = useState<FormStatus>("loading");
  const [message, setMessage] = useState("");
  const initialization = useRef<Promise<void> | null>(null);
  const supabase = useRef<ReturnType<typeof createCoachSupabaseBrowserClient> | null>(null);

  useEffect(() => {
    if (!initialization.current) {
      initialization.current = (async () => {
        const client = createCoachSupabaseBrowserClient();
        supabase.current = client;
        const confirmation = parseCoachConfirmationInput({ code, tokenHash, type, hash: window.location.hash });
        if (confirmation.kind === "error") throw new Error("Invalid confirmation callback");

        let error: { message?: string } | null = null;
        if (confirmation.kind === "implicit") {
          ({ error } = await client.auth.setSession({
            access_token: confirmation.accessToken,
            refresh_token: confirmation.refreshToken
          }));
        } else if (confirmation.kind === "pkce") {
          ({ error } = await client.auth.exchangeCodeForSession(confirmation.code));
        } else if (confirmation.kind === "otp") {
          ({ error } = await client.auth.verifyOtp({
            token_hash: confirmation.tokenHash,
            type: confirmation.type
          }));
        }
        if (error) throw error;

        const { data, error: userError } = await client.auth.getUser();
        if (userError || !data.user) throw userError ?? new Error("Missing confirmation session");
        cleanConfirmationUrl();
        setStatus("ready");
      })().catch(() => {
        setMessage(invalidLinkMessage);
        setStatus("error");
      });
    }
  }, [code, tokenHash, type]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "ready" || !supabase.current) return;
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (password.length < 12) {
      setMessage("Use at least 12 characters. 密码至少需要 12 个字符。");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match. 两次输入的密码不一致。");
      return;
    }

    setStatus("submitting");
    setMessage("");
    let passwordUpdated = false;
    try {
      const { error: updateError } = await supabase.current.auth.updateUser({ password });
      if (updateError) {
        setMessage(passwordUpdateErrorMessage(updateError));
        setStatus(updateError.code === "session_not_found" || updateError.code === "refresh_token_not_found" ? "error" : "ready");
        return;
      }
      passwordUpdated = true;

      const { error: invitationError } = await supabase.current.rpc("operator_accept_invitation", {
        p_request_id: crypto.randomUUID()
      });
      if (invitationError) throw invitationError;
      window.location.assign("/club");
    } catch {
      setMessage(passwordUpdated ? invitationCompletionErrorMessage : passwordUpdateErrorMessage(null));
      setStatus(passwordUpdated ? "password-set-error" : "ready");
    }
  }

  if (status === "loading") {
    return <p className="coach-message" role="status">Verifying secure link… · 正在验证安全链接…</p>;
  }
  if (status === "error") {
    return (
      <div className="coach-message error" role="alert">
        <p>{message || invalidLinkMessage}</p>
        <Link href="/coach/login">Return to sign in · 返回登录</Link>
      </div>
    );
  }
  if (status === "password-set-error") {
    return (
      <div className="coach-message success" role="alert">
        <p>{message}</p>
        <Link href="/coach/login">Sign in · 登录</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="coach-form">
      <label>New password · 新密码<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
      <label>Confirm password · 确认密码<input name="confirmPassword" type="password" minLength={12} autoComplete="new-password" required /></label>
      <p className="coach-hint">Use at least 12 characters. 至少使用 12 个字符。</p>
      <button className="coach-primary" type="submit" disabled={status === "submitting"}>{status === "submitting" ? "Securing account… · 正在设置…" : "Set password · 设置密码"}</button>
      {message ? <p className="coach-message error" role="alert">{message}</p> : null}
    </form>
  );
}
