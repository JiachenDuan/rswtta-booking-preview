import { LayoutDashboard, Phone, Table2 } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <main className="portal-shell">
      <section className="portal-hero">
        <div className="brand portal-brand">
          <div className="brand-mark">
            <Table2 size={22} />
          </div>
          <div>
            <strong>Rising Stars World</strong>
            <span>Table Tennis Academy</span>
          </div>
        </div>
        <div className="portal-copy">
          <p className="eyebrow">选择入口 / Choose app</p>
          <h1>Rising Stars World</h1>
          <p className="screen-subtitle">Parent booking and club management are now separate app entrances.</p>
        </div>
        <div className="portal-actions">
          <Link className="portal-link parent" href="/parent">
            <Phone size={22} />
            <span>
              <strong>家长 App / Parent App</strong>
              <small>Book classes, request changes, and view bills.</small>
            </span>
          </Link>
          <Link className="portal-link club" href="/club">
            <LayoutDashboard size={22} />
            <span>
              <strong>俱乐部 App / Club App</strong>
              <small>Confirm classes, mark completion, and export reports.</small>
            </span>
          </Link>
        </div>
      </section>
    </main>
  );
}
