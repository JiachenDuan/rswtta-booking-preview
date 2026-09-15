"use client";

import { type FormEvent, useActionState, useEffect, useRef, useState } from "react";
import { coachResetAction } from "../actions";
import { initialCoachActionState, type CoachActionState } from "@/lib/coachAuth/actionState";
import { createCoachSupabaseBrowserClient } from "@/lib/coachAuth/browser";

function Message({ state }: { state: CoachActionState }) {
  if (state.status === "idle") return null;
  return <p className={`coach-message ${state.status}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>;
}

export function LoginForms() {
  const [resetMode, setResetMode] = useState(false);
  const [loginState, setLoginState] = useState<CoachActionState>(initialCoachActionState);
  const [loginPending, setLoginPending] = useState(false);
  const [resetState, resetAction, resetPending] = useActionState(coachResetAction, initialCoachActionState);
  const supabase = useRef<ReturnType<typeof createCoachSupabaseBrowserClient> | null>(null);

  useEffect(() => {
    try {
      const client = createCoachSupabaseBrowserClient();
      supabase.current = client;
      void client.auth.getSession().then(({ data }) => {
        if (data.session) window.location.replace("/club");
      });
    } catch {
      setLoginState({ status: "error", message: "Sign-in is temporarily unavailable. 登录暂时不可用。" });
    }
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginPending || !supabase.current) return;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!email || !password) {
      setLoginState({ status: "error", message: "Enter your email and password. 请输入邮箱和密码。" });
      return;
    }

    setLoginPending(true);
    setLoginState(initialCoachActionState);
    try {
      const { error } = await supabase.current.auth.signInWithPassword({ email, password });
      if (error) {
        setLoginState({ status: "error", message: "Unable to sign in with those details. 登录信息不正确。" });
        setLoginPending(false);
        return;
      }
      window.location.assign("/club");
    } catch {
      setLoginState({ status: "error", message: "Sign-in is temporarily unavailable. 登录暂时不可用。" });
      setLoginPending(false);
    }
  }

  if (resetMode) {
    return (
      <form action={resetAction} className="coach-form">
        <label>Email · 邮箱<input name="email" type="email" autoComplete="email" required /></label>
        <button className="coach-primary" type="submit" disabled={resetPending}>{resetPending ? "Sending… · 正在发送…" : "Request reset · 申请重置"}</button>
        <Message state={resetState} />
        <button className="coach-link-button" type="button" onClick={() => setResetMode(false)}>Back to sign in · 返回登录</button>
      </form>
    );
  }

  return (
    <form onSubmit={login} className="coach-form">
      <label>Email · 邮箱<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password · 密码<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="coach-primary" type="submit" disabled={loginPending}>{loginPending ? "Signing in… · 正在登录…" : "Sign in · 登录"}</button>
      <Message state={loginState} />
      <button className="coach-link-button" type="button" onClick={() => setResetMode(true)}>Forgot password? · 忘记密码？</button>
    </form>
  );
}
