import { isOperatorAuthEnabled } from "@/lib/coachAuth/config";
import { CoachUnavailable } from "../Unavailable";
import { LoginForms } from "./LoginForms";

export const dynamic = "force-dynamic";

export default function CoachLoginPage() {
  if (!isOperatorAuthEnabled()) return <CoachUnavailable />;

  return (
    <main className="coach-auth-page">
      <section className="coach-auth-card" aria-labelledby="coach-login-title">
        <span className="coach-kicker">RISING STARS · CLUB ACCESS</span>
        <h1 id="coach-login-title">Club operator sign in</h1>
        <p className="coach-chinese-title">俱乐部员工登录</p>
        <p className="coach-muted">Private access for invited Club Admins and Coaches only. 仅限受邀俱乐部管理员和教练使用。</p>
        <LoginForms />
      </section>
    </main>
  );
}
