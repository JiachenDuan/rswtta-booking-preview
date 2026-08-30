"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  LayoutDashboard,
  Mail,
  Phone,
  RefreshCcw,
  Table2,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import type { BillNotification, Booking, BookingStatus } from "@/lib/db";

const coaches = ["Coach A", "Coach B"];
const calendarSlots = [
  { day: "Mon", dayZh: "周一", dateLabel: "Mon Sep 1", timeLabel: "4:30 PM", startsAt: "2026-09-01T16:30:00-07:00" },
  { day: "Tue", dayZh: "周二", dateLabel: "Tue Sep 2", timeLabel: "5:15 PM", startsAt: "2026-09-02T17:15:00-07:00" },
  { day: "Wed", dayZh: "周三", dateLabel: "Wed Sep 3", timeLabel: "6:00 PM", startsAt: "2026-09-03T18:00:00-07:00" },
  { day: "Thu", dayZh: "周四", dateLabel: "Thu Sep 4", timeLabel: "4:30 PM", startsAt: "2026-09-04T16:30:00-07:00" },
  { day: "Sat", dayZh: "周六", dateLabel: "Sat Sep 6", timeLabel: "10:00 AM", startsAt: "2026-09-06T10:00:00-07:00" }
];
const calendarDays = [
  { day: "Mon", dayZh: "周一", dateLabel: "Mon Sep 1", dateZh: "9月1日" },
  { day: "Tue", dayZh: "周二", dateLabel: "Tue Sep 2", dateZh: "9月2日" },
  { day: "Wed", dayZh: "周三", dateLabel: "Wed Sep 3", dateZh: "9月3日" },
  { day: "Thu", dayZh: "周四", dateLabel: "Thu Sep 4", dateZh: "9月4日" },
  { day: "Fri", dayZh: "周五", dateLabel: "Fri Sep 5", dateZh: "9月5日" },
  { day: "Sat", dayZh: "周六", dateLabel: "Sat Sep 6", dateZh: "9月6日" }
];
const calendarTimes = ["4:30 PM", "5:15 PM", "6:00 PM", "7:00 PM"];
const dayStartDates: Record<string, string> = {
  "Mon Sep 1": "2026-09-01",
  "Tue Sep 2": "2026-09-02",
  "Wed Sep 3": "2026-09-03",
  "Thu Sep 4": "2026-09-04",
  "Fri Sep 5": "2026-09-05",
  "Sat Sep 6": "2026-09-06"
};
const timeStartHours: Record<string, string> = {
  "4:30 PM": "16:30:00",
  "5:15 PM": "17:15:00",
  "6:00 PM": "18:00:00",
  "7:00 PM": "19:00:00"
};

const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const demoBookingKey = "rswtta-demo-bookings";
const demoBillKey = "rswtta-demo-bills";

const demoBookings: Booking[] = [
  {
    id: "demo-1",
    studentName: "Ethan Chen",
    familyName: "Chen Family",
    studentEmail: "parent@example.com",
    phone: "(650) 555-0188",
    requestedCoach: "Coach A",
    assignedCoach: "Coach A",
    program: "Private lesson",
    dateLabel: "Mon Sep 1",
    timeLabel: "4:30 PM",
    startsAt: "2026-09-01T16:30:00-07:00",
    priceCents: 15000,
    status: "club_confirmed",
    parentNote: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function statusText(status: BookingStatus) {
  const labels: Record<BookingStatus, string> = {
    requested: "已请求 / Requested",
    club_confirmed: "已确认 / Club confirmed",
    change_requested: "改期请求 / Change requested",
    cancelled: "已取消 / Cancelled",
    coach_confirmed: "教练确认完成 / Coach completed"
  };
  return labels[status];
}

function canParentChange(booking: Booking) {
  const starts = new Date(booking.startsAt).getTime();
  return starts - Date.now() > 12 * 60 * 60 * 1000 && ["requested", "club_confirmed"].includes(booking.status);
}

function makeStartsAt(dateLabel: string, timeLabel: string) {
  return `${dayStartDates[dateLabel]}T${timeStartHours[timeLabel]}-07:00`;
}

function findSlot(dateLabel: string, timeLabel: string) {
  const existing = calendarSlots.find((slot) => slot.dateLabel === dateLabel && slot.timeLabel === timeLabel);
  if (existing) return existing;
  const day = calendarDays.find((item) => item.dateLabel === dateLabel) ?? calendarDays[0];
  return {
    day: day.day,
    dayZh: day.dayZh,
    dateLabel,
    timeLabel,
    startsAt: makeStartsAt(dateLabel, timeLabel)
  };
}

export function ClubApp() {
  const [mode, setMode] = useState<"parent" | "club">("parent");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bills, setBills] = useState<BillNotification[]>([]);
  const [notice, setNotice] = useState("数据库已连接 / Backend database connected.");
  const [studentName, setStudentName] = useState("Ethan Chen");
  const [familyName, setFamilyName] = useState("Chen Family");
  const [studentEmail, setStudentEmail] = useState("parent@example.com");
  const [phone, setPhone] = useState("(650) 555-0188");
  const [requestedCoach, setRequestedCoach] = useState(coaches[0]);
  const [selectedSlot, setSelectedSlot] = useState(calendarSlots[0]);
  const [saving, setSaving] = useState(false);

  const parentBookings = useMemo(
    () => bookings.filter((booking) => booking.familyName === familyName || booking.phone === phone || booking.studentEmail === studentEmail),
    [bookings, familyName, phone, studentEmail]
  );

  const completedTotal = parentBookings
    .filter((booking) => booking.status === "coach_confirmed")
    .reduce((sum, booking) => sum + booking.priceCents, 0);

  async function loadAll() {
    if (demoMode) {
      const storedBookings = window.localStorage.getItem(demoBookingKey);
      const storedBills = window.localStorage.getItem(demoBillKey);
      setBookings(storedBookings ? (JSON.parse(storedBookings) as Booking[]) : demoBookings);
      setBills(storedBills ? (JSON.parse(storedBills) as BillNotification[]) : []);
      return;
    }

    const [bookingResponse, billResponse] = await Promise.all([
      fetch("/api/bookings", { cache: "no-store" }),
      fetch("/api/bills/weekly", { cache: "no-store" })
    ]);
    const bookingData = (await bookingResponse.json()) as { bookings: Booking[] };
    const billData = (await billResponse.json()) as { bills: BillNotification[] };
    setBookings(bookingData.bookings);
    setBills(billData.bills);
  }

  async function requestBooking(parentNote = "") {
    setSaving(true);
    setNotice("正在保存家长请求 / Saving parent request...");
    try {
      if (demoMode) {
        const booking: Booking = {
          id: crypto.randomUUID(),
          studentName,
          familyName,
          studentEmail,
          phone,
          requestedCoach,
          assignedCoach: requestedCoach,
          program: requestedCoach === "Coach A" ? "Private lesson" : "Group lesson",
          dateLabel: selectedSlot.dateLabel,
          timeLabel: selectedSlot.timeLabel,
          startsAt: selectedSlot.startsAt,
          priceCents: requestedCoach === "Coach A" ? 15000 : 7500,
          status: "requested",
          parentNote,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const next = [booking, ...bookings];
        window.localStorage.setItem(demoBookingKey, JSON.stringify(next));
        setBookings(next);
        setNotice("请求已保存 / Request saved. Club can confirm coach and time.");
        setMode("club");
        return;
      }

      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName,
          familyName,
          studentEmail,
          phone,
          requestedCoach,
          program: requestedCoach === "Coach A" ? "Private lesson" : "Group lesson",
          dateLabel: selectedSlot.dateLabel,
          timeLabel: selectedSlot.timeLabel,
          startsAt: selectedSlot.startsAt,
          priceCents: requestedCoach === "Coach A" ? 15000 : 7500,
          parentNote
        })
      });

      if (!response.ok) throw new Error("Booking request failed");
      await loadAll();
      setNotice("家长请求已保存 / Parent request saved. Club can confirm coach and time.");
      setMode("club");
    } catch {
      setNotice("无法保存预约请求 / Could not save booking request.");
    } finally {
      setSaving(false);
    }
  }

  async function updateBooking(
    id: string,
    status: BookingStatus,
    assignedCoach?: string,
    schedule?: { dateLabel: string; timeLabel: string; startsAt: string; parentNote?: string }
  ) {
    setNotice(`Updating status to ${statusText(status)}...`);
    if (demoMode) {
      const next = bookings.map((booking) =>
        booking.id === id
          ? {
              ...booking,
              status,
              assignedCoach: assignedCoach ?? booking.assignedCoach,
              dateLabel: schedule?.dateLabel ?? booking.dateLabel,
              timeLabel: schedule?.timeLabel ?? booking.timeLabel,
              startsAt: schedule?.startsAt ?? booking.startsAt,
              parentNote: schedule?.parentNote ?? booking.parentNote,
              updatedAt: new Date().toISOString()
            }
          : booking
      );
      window.localStorage.setItem(demoBookingKey, JSON.stringify(next));
      setBookings(next);
      setNotice(`Saved: ${statusText(status)}. Parent and club views now match.`);
      return;
    }

    const response = await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, assignedCoach, ...schedule })
    });

    if (response.ok) {
      await loadAll();
      setNotice(`Saved: ${statusText(status)}. Parent and club views now match.`);
    } else {
      setNotice("无法更新课程 / Could not update booking.");
    }
  }

  async function generateBills() {
    setNotice("Generating weekly student bill notifications...");
    if (demoMode) {
      const completed = bookings.filter((booking) => booking.status === "coach_confirmed");
      const grouped = new Map<string, BillNotification>();

      for (const booking of completed) {
        const key = `${booking.studentName}-${booking.familyName}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.classCount += 1;
          existing.amountCents += booking.priceCents;
          existing.message = `${booking.studentName}: ${existing.classCount} completed classes ready to bill`;
        } else {
          grouped.set(key, {
            id: crypto.randomUUID(),
            studentName: booking.studentName,
            familyName: booking.familyName,
            classCount: 1,
            amountCents: booking.priceCents,
            message: `${booking.studentName}: 1 completed class ready to bill`,
            createdAt: new Date().toISOString()
          });
        }
      }

      const next = [...grouped.values(), ...bills];
      window.localStorage.setItem(demoBillKey, JSON.stringify(next));
      setBills(next);
      setNotice("账单提醒已生成 / Bill notifications generated from coach-completed classes.");
      return;
    }

    const response = await fetch("/api/bills/weekly", { method: "POST" });
    if (response.ok) {
      await loadAll();
      setNotice("账单提醒已生成 / Bill notifications generated from coach-completed classes.");
    } else {
      setNotice("无法生成账单 / Could not generate bills.");
    }
  }

  useEffect(() => {
    loadAll();
    const interval = window.setInterval(loadAll, 5000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="shell simple-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">
            <Table2 size={22} />
          </div>
          <div>
            <strong>Rising Star World</strong>
            <span>Table Tennis</span>
          </div>
        </div>

        <nav className="nav-list">
          <button className={mode === "parent" ? "nav-item active" : "nav-item"} onClick={() => setMode("parent")}>
            <Phone size={18} />
            <span>家长 Parent</span>
          </button>
          <button className={mode === "club" ? "nav-item active" : "nav-item"} onClick={() => setMode("club")}>
            <LayoutDashboard size={18} />
            <span>俱乐部 Club</span>
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">核心预约流程 / Core booking flow</p>
            <h1>{mode === "parent" ? "家长预约课程" : "俱乐部确认课程"}</h1>
            <p className="screen-subtitle">
              {mode === "parent"
                ? "家长端 / Parent App: view club calendar, request class, check confirmed classes"
                : "俱乐部端 / Club App: confirm requests, mark completed, generate bills"}
            </p>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
            </button>
            <div className="mode-switch" aria-label="Switch app view">
              <button className={mode === "parent" ? "selected" : ""} onClick={() => setMode("parent")}>
                家长 Parent
              </button>
              <button className={mode === "club" ? "selected" : ""} onClick={() => setMode("club")}>
                俱乐部 Club
              </button>
            </div>
          </div>
        </header>

        <section className="system-banner">
          <strong>流程 / Journey</strong>
          <span>家长请求 → 俱乐部确认 → 教练确认完成 → 生成账单提醒</span>
          {demoMode ? <span>GitHub preview mode</span> : null}
        </section>

        {mode === "parent" ? (
          <ParentApp
            bookings={parentBookings}
            allBookings={bookings}
            completedTotal={completedTotal}
            notice={notice}
            studentName={studentName}
            familyName={familyName}
            studentEmail={studentEmail}
            phone={phone}
            requestedCoach={requestedCoach}
            selectedSlot={selectedSlot}
            saving={saving}
            onStudentNameChange={setStudentName}
            onFamilyNameChange={setFamilyName}
            onStudentEmailChange={setStudentEmail}
            onPhoneChange={setPhone}
            onCoachChange={setRequestedCoach}
            onSlotChange={setSelectedSlot}
            onRequestBooking={() => requestBooking()}
            onChangeRequest={(booking) => {
              if (!canParentChange(booking)) {
                setNotice("12小时内不能线上改期或取消 / Less than 12 hours: please contact the club.");
                return;
              }
              updateBooking(booking.id, "change_requested", requestedCoach, {
                dateLabel: selectedSlot.dateLabel,
                timeLabel: selectedSlot.timeLabel,
                startsAt: selectedSlot.startsAt,
                parentNote: `家长申请改期 / Parent requested change from ${booking.dateLabel} ${booking.timeLabel}`
              });
            }}
            onCancel={(booking) => {
              if (!canParentChange(booking)) {
                setNotice("12小时内不能线上改期或取消 / Less than 12 hours: please contact the club.");
                return;
              }
              updateBooking(booking.id, "cancelled");
            }}
          />
        ) : (
          <ClubAppView
            bookings={bookings}
            selectedSlot={selectedSlot}
            bills={bills}
            notice={notice}
            requestedCoach={requestedCoach}
            onSlotChange={setSelectedSlot}
            onConfirm={(booking, coach) => updateBooking(booking.id, "club_confirmed", coach)}
            onCoachComplete={(booking) => updateBooking(booking.id, "coach_confirmed", booking.assignedCoach)}
            onGenerateBills={generateBills}
          />
        )}
      </section>
    </main>
  );
}

function ParentApp({
  bookings,
  allBookings,
  completedTotal,
  notice,
  studentName,
  familyName,
  studentEmail,
  phone,
  requestedCoach,
  selectedSlot,
  saving,
  onStudentNameChange,
  onFamilyNameChange,
  onStudentEmailChange,
  onPhoneChange,
  onCoachChange,
  onSlotChange,
  onRequestBooking,
  onChangeRequest,
  onCancel
}: {
  bookings: Booking[];
  allBookings: Booking[];
  completedTotal: number;
  notice: string;
  studentName: string;
  familyName: string;
  studentEmail: string;
  phone: string;
  requestedCoach: string;
  selectedSlot: (typeof calendarSlots)[number];
  saving: boolean;
  onStudentNameChange: (value: string) => void;
  onFamilyNameChange: (value: string) => void;
  onStudentEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onCoachChange: (value: string) => void;
  onSlotChange: (value: (typeof calendarSlots)[number]) => void;
  onRequestBooking: () => void;
  onChangeRequest: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
}) {
  return (
    <section className="calendar-first">
      <section className="section-block calendar-core">
        <div className="section-head">
          <div>
            <p className="eyebrow">俱乐部日历 / Club calendar</p>
            <h2>查看教练课表并请求上课</h2>
            <p className="section-subtitle">家长端 / Parent App: see the whole coach schedule, then tap a time to request class.</p>
          </div>
          <span className="status-chip good">{bookings.length} 课程 / classes</span>
        </div>
        <div className="booking-toolbar">
          <div className="coach-toggle">
            {coaches.map((coach) => (
              <button className={requestedCoach === coach ? "selected" : ""} key={coach} onClick={() => onCoachChange(coach)}>
                {coach}
              </button>
            ))}
          </div>
          <button className="primary-button wide-button" disabled={saving} onClick={onRequestBooking}>
            <CalendarDays size={18} />
            {saving ? "保存中 / Saving..." : `请求预约 / Request ${requestedCoach} ${selectedSlot.dateLabel} ${selectedSlot.timeLabel}`}
          </button>
        </div>
        <div className="calendar-board">
          <ClubCalendar
            bookings={allBookings}
            selectedSlot={selectedSlot}
            requestedCoach={requestedCoach}
            onSlotChange={onSlotChange}
          />
        </div>
        <p className="system-note">{notice}</p>
      </section>

      <section className="support-grid">
        <section className="section-block">
          <div className="section-head">
            <div>
              <p className="eyebrow">学生资料 / Student info</p>
              <h2>基础登录信息</h2>
              <p className="section-subtitle">Basic email and phone / 基本邮箱和电话</p>
            </div>
          </div>
          <div className="simple-form">
            <label>
              <span>学生 / Student</span>
              <div className="input-shell">
                <UserRound size={18} />
                <input value={studentName} onChange={(event) => onStudentNameChange(event.target.value)} />
              </div>
            </label>
            <label>
              <span>家庭 / Family</span>
              <div className="input-shell">
                <UsersRound size={18} />
                <input value={familyName} onChange={(event) => onFamilyNameChange(event.target.value)} />
              </div>
            </label>
            <label>
              <span>邮箱 / Email</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={studentEmail} onChange={(event) => onStudentEmailChange(event.target.value)} />
              </div>
            </label>
            <label>
              <span>电话 / Phone</span>
              <div className="input-shell">
                <Phone size={18} />
                <input value={phone} onChange={(event) => onPhoneChange(event.target.value)} />
              </div>
            </label>
          </div>
        </section>

        <section className="section-block">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">我的课程 / My classes</p>
              <h2>请求、确认、完成</h2>
              <p className="section-subtitle">12小时前可线上改期或取消 / Changes allowed more than 12 hours before class.</p>
            </div>
          </div>
          <div className="mini-ledger">
            <div>
              <span>已请求 / Requested</span>
              <strong>{bookings.filter((booking) => booking.status === "requested" || booking.status === "change_requested").length}</strong>
            </div>
            <div>
              <span>已确认 / Confirmed</span>
              <strong>{bookings.filter((booking) => booking.status === "club_confirmed").length}</strong>
            </div>
            <div>
              <span>已计费 / Bill</span>
              <strong>{dollars(completedTotal)}</strong>
            </div>
          </div>
          <BookingList bookings={bookings} parentActions onChangeRequest={onChangeRequest} onCancel={onCancel} />
        </section>
      </section>
    </section>
  );
}

function ClubCalendar({
  bookings,
  selectedSlot,
  requestedCoach,
  onSlotChange
}: {
  bookings: Booking[];
  selectedSlot: (typeof calendarSlots)[number];
  requestedCoach: string;
  onSlotChange: (value: (typeof calendarSlots)[number]) => void;
}) {
  return (
    <div className="week-calendar" aria-label="Club calendar view">
      <div className="calendar-corner">Time<br />时间</div>
      {calendarDays.map((day) => (
        <div className="calendar-day-head" key={day.dateLabel}>
          <strong>{day.day}</strong>
          <span>{day.dayZh}</span>
        </div>
      ))}

      {calendarTimes.map((timeLabel) => (
        <Fragment key={timeLabel}>
          <div className="calendar-time" key={`${timeLabel}-label`}>
            <strong>{timeLabel}</strong>
          </div>
          {calendarDays.map((day) => {
            const startsAt = makeStartsAt(day.dateLabel, timeLabel);
            const slotBookings = bookings.filter((booking) => booking.startsAt === startsAt && booking.status !== "cancelled");
            const slot = findSlot(day.dateLabel, timeLabel);
            const selected = selectedSlot.startsAt === startsAt;
            return (
              <button
                className={selected ? "calendar-cell selected" : "calendar-cell"}
                key={startsAt}
                onClick={() => onSlotChange(slot)}
              >
                {slotBookings.length === 0 ? (
                  <span className="open-slot">可预约<br />Available</span>
                ) : (
                  slotBookings.map((booking) => (
                    <span className={`calendar-booking ${booking.status}`} key={booking.id}>
                      <strong>{booking.assignedCoach}</strong>
                      <small>{booking.studentName}</small>
                      <em>{statusText(booking.status)}</em>
                    </span>
                  ))
                )}
                {selected ? <span className="selected-label">已选择 / {requestedCoach} selected</span> : null}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function ClubAppView({
  bookings,
  selectedSlot,
  bills,
  notice,
  requestedCoach,
  onSlotChange,
  onConfirm,
  onCoachComplete,
  onGenerateBills
}: {
  bookings: Booking[];
  selectedSlot: (typeof calendarSlots)[number];
  bills: BillNotification[];
  notice: string;
  requestedCoach: string;
  onSlotChange: (value: (typeof calendarSlots)[number]) => void;
  onConfirm: (booking: Booking, coach: string) => void;
  onCoachComplete: (booking: Booking) => void;
  onGenerateBills: () => void;
}) {
  const requested = bookings.filter((booking) => booking.status === "requested" || booking.status === "change_requested");
  const confirmed = bookings.filter((booking) => booking.status === "club_confirmed");
  const completed = bookings.filter((booking) => booking.status === "coach_confirmed");

  return (
    <section className="calendar-first">
      <section className="section-block calendar-core">
        <div className="section-head">
          <div>
            <p className="eyebrow">俱乐部日历 / Club calendar</p>
            <h2>确认请求并完成课程</h2>
            <p className="section-subtitle">俱乐部端 / Club App: requested, confirmed, and completed classes all live on the calendar.</p>
          </div>
          <span className="status-chip">{requested.length} 待确认 / pending</span>
        </div>
        <div className="calendar-board">
          <ClubCalendar
            bookings={bookings}
            selectedSlot={selectedSlot}
            requestedCoach={requestedCoach}
            onSlotChange={onSlotChange}
          />
        </div>
        <p className="system-note">{notice}</p>
      </section>

      <section className="support-grid">
        <section className="section-block">
          <div className="section-head">
            <div>
              <p className="eyebrow">待确认 / Requests</p>
              <h2>确认时间和教练</h2>
              <p className="section-subtitle">Confirm class time and coach / 确认上课时间和教练</p>
            </div>
          </div>
          <div className="request-stack">
            {requested.map((booking) => (
              <article className="flow-card" key={booking.id}>
                <div>
                  <span className={`status-chip ${booking.status}`}>{statusText(booking.status)}</span>
                  <h3>{booking.studentName}</h3>
                  <p>
                    请求 / Wants {booking.requestedCoach}: {booking.dateLabel} {booking.timeLabel}
                  </p>
                  {booking.parentNote ? <p>{booking.parentNote}</p> : null}
                </div>
                <div className="confirm-actions">
                  <button className="accept" onClick={() => onConfirm(booking, "Coach A")}>
                    <Check size={17} />
                    Coach A
                  </button>
                  <button className="accept" onClick={() => onConfirm(booking, "Coach B")}>
                    <Check size={17} />
                    Coach B
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section-block">
          <div className="section-head">
            <div>
              <p className="eyebrow">教练完成 / Coach complete</p>
              <h2>确认课程完成</h2>
              <p className="section-subtitle">Only coach-confirmed classes count toward billing / 教练确认完成后才计费</p>
            </div>
            <span className="status-chip good">{confirmed.length} ready</span>
          </div>
          <div className="request-stack">
            {confirmed.map((booking) => (
              <article className="flow-card" key={booking.id}>
                <div>
                  <h3>{booking.studentName}</h3>
                  <p>
                    {booking.assignedCoach}: {booking.dateLabel} {booking.timeLabel}
                  </p>
                </div>
                <button className="primary-button" onClick={() => onCoachComplete(booking)}>
                  <Check size={18} />
                  完成 / Complete
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="section-block">
          <div className="section-head">
            <div>
              <p className="eyebrow">双周账单 / Billing</p>
              <h2>生成学生账单提醒</h2>
              <p className="section-subtitle">Bill from coach-completed classes / 根据教练确认完成课程生成</p>
            </div>
            <button className="filter-button" onClick={onGenerateBills}>
              <RefreshCcw size={17} />
              生成 / Generate
            </button>
          </div>
          <div className="mini-ledger">
            <div>
              <span>已完成 / Completed</span>
              <strong>{completed.length}</strong>
            </div>
            <div>
              <span>待计费 / To bill</span>
              <strong>{dollars(completed.reduce((sum, booking) => sum + booking.priceCents, 0))}</strong>
            </div>
          </div>
          <div className="bill-list">
            {bills.map((bill) => (
              <article className="bill-row" key={bill.id}>
                <div>
                  <h3>{bill.studentName}</h3>
                  <p>{bill.message}</p>
                </div>
                <div>
                  <strong>{dollars(bill.amountCents)}</strong>
                  <span>{bill.classCount} classes</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </section>
  );
}

function BookingList({
  bookings,
  parentActions,
  onChangeRequest,
  onCancel
}: {
  bookings: Booking[];
  parentActions?: boolean;
  onChangeRequest?: (booking: Booking) => void;
  onCancel?: (booking: Booking) => void;
}) {
  if (bookings.length === 0) {
    return <p className="empty-state">No classes yet.</p>;
  }

  return (
    <div className="appointment-list compact-list">
      {bookings.map((booking) => (
        <article className="appointment-row simple-row" key={booking.id}>
          <div className="avatar">
            <UserRound size={18} />
          </div>
          <div>
            <h3>{booking.studentName}</h3>
            <p>
              {booking.dateLabel} {booking.timeLabel} with {booking.assignedCoach}
            </p>
          </div>
          <strong className={booking.status}>{statusText(booking.status)}</strong>
          {parentActions ? (
            <div className="row-actions parent-actions">
              <button disabled={!canParentChange(booking)} onClick={() => onChangeRequest?.(booking)}>
                <RefreshCcw size={15} />
              </button>
              <button disabled={!canParentChange(booking)} onClick={() => onCancel?.(booking)}>
                <X size={15} />
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
