export function CoachUnavailable() {
  return (
    <main className="coach-auth-page">
      <section className="coach-auth-card coach-unavailable" aria-labelledby="coach-unavailable-title">
        <span className="coach-kicker">COACH · 教练</span>
        <h1 id="coach-unavailable-title">Coach access is not available yet</h1>
        <h2>教练入口尚未开放</h2>
        <p>The secure Coach portal is disabled until authentication prerequisites are complete.</p>
        <p>完成身份验证配置后，安全教练门户才会开放。</p>
      </section>
    </main>
  );
}
