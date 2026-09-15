import { redirect } from "next/navigation";
import { isCoachAuthEnabled } from "@/lib/coachAuth/config";
import { createCoachSupabaseClient } from "@/lib/coachAuth/server";
import { CoachUnavailable } from "../Unavailable";
import { LoginForms } from "./LoginForms";

export const dynamic = "force-dynamic";

export default async function CoachLoginPage() {
  if (!isCoachAuthEnabled()) return <CoachUnavailable />;
  try {
    const supabase = await createCoachSupabaseClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect("/coach");
  } catch {
    return <CoachUnavailable />;
  }

  return (
    <main className="coach-auth-page">
      <section className="coach-auth-card" aria-labelledby="coach-login-title">
        <span className="coach-kicker">RISING STARS · COACH</span>
        <h1 id="coach-login-title">Coach sign in</h1>
        <p className="coach-chinese-title">教练登录</p>
        <p className="coach-muted">Private access for invited coaches only. 仅限受邀教练使用。</p>
        <LoginForms />
      </section>
    </main>
  );
}
