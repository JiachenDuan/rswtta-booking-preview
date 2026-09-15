import { coachAuthConfiguration, isOperatorAuthEnabled } from "@/lib/coachAuth/config";
import { CoachUnavailable } from "../Unavailable";
import { ConfirmForm } from "./ConfirmForm";

export const dynamic = "force-dynamic";

export default async function CoachConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isOperatorAuthEnabled() || !coachAuthConfiguration()) return <CoachUnavailable />;
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const code = value("code");
  const tokenHash = value("token_hash");
  const type = value("type");
  return (
    <main className="coach-auth-page">
      <section className="coach-auth-card" aria-labelledby="coach-confirm-title">
        <span className="coach-kicker">SECURE ACCOUNT · 安全账户</span>
        <h1 id="coach-confirm-title">Set your password</h1>
        <p className="coach-chinese-title">设置密码</p>
        <ConfirmForm code={code} tokenHash={tokenHash} type={type} />
      </section>
    </main>
  );
}
