"use client";

import { useActionState, useState } from "react";
import { coachLoginAction, coachResetAction } from "../actions";
import { initialCoachActionState } from "@/lib/coachAuth/actionState";

function Message({ state }: { state: typeof initialCoachActionState }) {
  if (state.status === "idle") return null;
  return <p className={`coach-message ${state.status}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>;
}

export function LoginForms() {
  const [resetMode, setResetMode] = useState(false);
  const [loginState, loginAction, loginPending] = useActionState(coachLoginAction, initialCoachActionState);
  const [resetState, resetAction, resetPending] = useActionState(coachResetAction, initialCoachActionState);

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
    <form action={loginAction} className="coach-form">
      <label>Email · 邮箱<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password · 密码<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="coach-primary" type="submit" disabled={loginPending}>{loginPending ? "Signing in… · 正在登录…" : "Sign in · 登录"}</button>
      <Message state={loginState} />
      <button className="coach-link-button" type="button" onClick={() => setResetMode(true)}>Forgot password? · 忘记密码？</button>
    </form>
  );
}
