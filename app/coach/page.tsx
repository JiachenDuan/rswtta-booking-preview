import { redirect } from "next/navigation";
import { CoachUnavailable } from "./Unavailable";
import { coachLogoutAction } from "./actions";
import { isCoachAuthEnabled } from "@/lib/coachAuth/config";
import { createCoachSupabaseClient } from "@/lib/coachAuth/server";
import { normalizeCoachProfile, normalizeCoachSchedule, partitionCoachSchedule, type CoachScheduleItem } from "@/lib/coachAuth/data";

export const dynamic = "force-dynamic";

function ScheduleList({ items, empty }: { items: CoachScheduleItem[]; empty: string }) {
  if (!items.length) return <p className="coach-empty">{empty}</p>;
  return <ul className="coach-schedule-list">{items.map((item, index) => {
    const start = new Date(item.startsAt);
    const end = item.endsAt ? new Date(item.endsAt) : null;
    return <li key={`${item.startsAt}-${index}`}>
      <time dateTime={item.startsAt}>{start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}<strong>{start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}{end ? ` – ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</strong></time>
      <div><h3>{item.className}</h3><p>{item.studentName}{item.location ? ` · ${item.location}` : ""}</p><span>{item.status}</span></div>
    </li>;
  })}</ul>;
}

export default async function CoachPage() {
  if (!isCoachAuthEnabled()) return <CoachUnavailable />;
  let supabase;
  try { supabase = await createCoachSupabaseClient(); } catch { return <CoachUnavailable />; }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) redirect("/coach/login");

  const [profileResult, scheduleResult] = await Promise.all([
    supabase.rpc("coach_my_profile"),
    supabase.rpc("coach_my_schedule")
  ]);
  const profileRows = Array.isArray(profileResult.data) ? profileResult.data : [];
  if (profileResult.error || profileRows.length !== 1) {
    return (
      <main className="coach-auth-page">
        <section className="coach-auth-card" aria-labelledby="coach-ineligible-title">
          <span className="coach-kicker">COACH · 教练</span>
          <h1 id="coach-ineligible-title">Coach access is not active</h1>
          <h2>教练权限未启用</h2>
          <p>This account is not bound to an active accepted Coach membership, or its access is suspended.</p>
          <p>此账户尚未绑定已接受的有效教练身份，或权限已暂停。</p>
          <form action={coachLogoutAction}><button className="coach-secondary" type="submit">Sign out · 退出</button></form>
        </section>
      </main>
    );
  }
  const profile = normalizeCoachProfile(profileResult.data, userData.user.email ?? "");
  const schedule = scheduleResult.error ? { upcoming: [], past: [] } : partitionCoachSchedule(normalizeCoachSchedule(scheduleResult.data));
  const unavailable = Boolean(profileResult.error || scheduleResult.error);

  return (
    <main className="coach-shell">
      <header className="coach-header">
        <div><span className="coach-kicker">RISING STARS · COACH</span><h1>{profile.displayName}</h1><p>{profile.email}</p></div>
        <form action={coachLogoutAction}><button className="coach-secondary" type="submit">Sign out · 退出</button></form>
      </header>
      <section className="coach-intro"><h2>My schedule · 我的课程</h2><p>Only your assigned sessions are shown. 仅显示分配给您的课程。</p></section>
      {unavailable ? <div className="coach-message error" role="alert">Schedule is temporarily unavailable. 课程安排暂时不可用。</div> : (
        <div className="coach-schedule-grid">
          <section><h2>Upcoming · 即将开始</h2><ScheduleList items={schedule.upcoming} empty="No upcoming sessions · 暂无即将开始的课程" /></section>
          <section><h2>Past · 已结束</h2><ScheduleList items={schedule.past} empty="No past sessions · 暂无已结束的课程" /></section>
        </div>
      )}
    </main>
  );
}
