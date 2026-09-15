import Link from "next/link";
import { coachAuthConfiguration, isCoachAuthEnabled } from "@/lib/coachAuth/config";
import { CoachUnavailable } from "../Unavailable";
import { ConfirmForm } from "./ConfirmForm";

export const dynamic = "force-dynamic";

export default async function CoachConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isCoachAuthEnabled() || !coachAuthConfiguration()) return <CoachUnavailable />;
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const code = value("code");
  const tokenHash = value("token_hash");
  const type = value("type");
  const hasSecureContext = Boolean(code || (tokenHash && (type === "invite" || type === "recovery")));

  return (
    <main className="coach-auth-page">
      <section className="coach-auth-card" aria-labelledby="coach-confirm-title">
        <span className="coach-kicker">SECURE ACCOUNT · 安全账户</span>
        <h1 id="coach-confirm-title">Set your password</h1>
        <p className="coach-chinese-title">设置密码</p>
        {hasSecureContext ? <ConfirmForm code={code} tokenHash={tokenHash} type={type} /> : (
          <div className="coach-message error" role="alert">
            <p>This secure link is missing or expired. Request a new reset link.</p>
            <p>安全链接无效或已过期，请重新申请。</p>
            <Link href="/coach/login">Return to sign in · 返回登录</Link>
          </div>
        )}
      </section>
    </main>
  );
}
