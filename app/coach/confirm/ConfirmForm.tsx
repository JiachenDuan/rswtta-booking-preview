"use client";

import { useActionState } from "react";
import { coachConfirmAction } from "../actions";
import { initialCoachActionState } from "@/lib/coachAuth/actionState";

export function ConfirmForm({ code, tokenHash, type }: { code: string; tokenHash: string; type: string }) {
  const [state, action, pending] = useActionState(coachConfirmAction, initialCoachActionState);
  return (
    <form action={action} className="coach-form">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <label>New password · 新密码<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
      <label>Confirm password · 确认密码<input name="confirmPassword" type="password" minLength={12} autoComplete="new-password" required /></label>
      <p className="coach-hint">Use at least 12 characters. 至少使用 12 个字符。</p>
      <button className="coach-primary" type="submit" disabled={pending}>{pending ? "Securing account… · 正在设置…" : "Set password · 设置密码"}</button>
      {state.status !== "idle" ? <p className={`coach-message ${state.status}`} role="alert">{state.message}</p> : null}
    </form>
  );
}
