"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  Mail,
  Phone,
  RefreshCcw,
  Table2,
  UserPlus,
  UserRound,
  X
} from "lucide-react";
import type { BillNotification, Booking, BookingStatus, ParentAccount } from "@/lib/db";

const coaches = ["Coach A", "Coach B"];
const calendarTimes = ["4:30 PM", "5:15 PM", "6:00 PM", "7:00 PM"];
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayNamesZh = ["周一", "周二", "周三", "周四", "周五", "周六"];
const timeParts: Record<string, [number, number]> = {
  "4:30 PM": [16, 30],
  "5:15 PM": [17, 15],
  "6:00 PM": [18, 0],
  "7:00 PM": [19, 0]
};
const today = new Date();
today.setHours(0, 0, 0, 0);

type CalendarDay = {
  day: string;
  dayZh: string;
  date: Date;
  dateLabel: string;
  dateZh: string;
  dateNumber: string;
  monthLabel: string;
  isToday: boolean;
};

type CalendarSlot = CalendarDay & {
  timeLabel: string;
  startsAt: string;
};

type DemoParentAccount = ParentAccount & {
  password: string;
  confirmationCode: string;
};

const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const demoBookingKey = "rswtta-demo-bookings";
const demoBillKey = "rswtta-demo-bills";
const demoParentAccountKey = "rswtta-demo-parent-accounts";
const parentSessionKey = "rswtta-parent-session";
const clubSessionKey = "rswtta-club-session";
const clubPassword = "club123";

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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + offset);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function dateZh(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function makeStartsAt(date: Date, timeLabel: string) {
  const [hours, minutes] = timeParts[timeLabel];
  const starts = new Date(date);
  starts.setHours(hours, minutes, 0, 0);
  return starts.toISOString();
}

function makeCalendarDay(date: Date, index: number): CalendarDay {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return {
    day: dayNames[index],
    dayZh: dayNamesZh[index],
    date,
    dateLabel: dateLabel(date),
    dateZh: dateZh(date),
    dateNumber: String(date.getDate()),
    monthLabel: monthLabel(date),
    isToday: normalized.getTime() === today.getTime()
  };
}

function makeCalendarSlot(day: CalendarDay, timeLabel: string): CalendarSlot {
  return {
    ...day,
    timeLabel,
    startsAt: makeStartsAt(day.date, timeLabel)
  };
}

function weekDays(weekStart: Date) {
  return dayNames.map((_, index) => makeCalendarDay(addDays(weekStart, index), index));
}

function weekLabel(days: CalendarDay[]) {
  const first = days[0];
  const last = days[days.length - 1];
  const year = first.date.getFullYear() === last.date.getFullYear() ? first.date.getFullYear() : `${first.date.getFullYear()}-${last.date.getFullYear()}`;
  return `${year}年 ${first.dateZh} - ${last.dateZh} / ${first.monthLabel} - ${last.monthLabel}, ${year}`;
}

const minCalendarDate = addMonths(today, -3);
const maxCalendarDate = addMonths(today, 3);
const initialWeekStart = startOfWeek(addDays(today, 1));
const initialCalendarDay = makeCalendarDay(addDays(initialWeekStart, 2), 2);
const initialCalendarSlot = makeCalendarSlot(initialCalendarDay, "7:00 PM");

export function ClubApp() {
  const [mode, setMode] = useState<"parent" | "club">("parent");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bills, setBills] = useState<BillNotification[]>([]);
  const [notice, setNotice] = useState("数据库已连接 / Backend database connected.");
  const [parentSession, setParentSession] = useState<ParentAccount | null>(null);
  const [clubAuthenticated, setClubAuthenticated] = useState(false);
  const [studentName, setStudentName] = useState("Ethan Chen");
  const [familyName, setFamilyName] = useState("Chen Family");
  const [studentEmail, setStudentEmail] = useState("parent@example.com");
  const [phone, setPhone] = useState("(650) 555-0188");
  const [requestedCoach, setRequestedCoach] = useState(coaches[0]);
  const [visibleWeekStart, setVisibleWeekStart] = useState(initialWeekStart);
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot>(initialCalendarSlot);
  const [recurring, setRecurring] = useState(false);
  const [recurringWeeks, setRecurringWeeks] = useState(4);
  const [saving, setSaving] = useState(false);
  const calendarDays = useMemo(() => weekDays(visibleWeekStart), [visibleWeekStart]);
  const canGoPrevious = addDays(visibleWeekStart, -7) >= startOfWeek(minCalendarDate);
  const canGoNext = addDays(visibleWeekStart, 7) <= startOfWeek(maxCalendarDate);

  const parentBookings = useMemo(
    () => bookings.filter((booking) => booking.familyName === familyName || booking.phone === phone || booking.studentEmail === studentEmail),
    [bookings, familyName, phone, studentEmail]
  );

  const completedTotal = parentBookings
    .filter((booking) => booking.status === "coach_confirmed")
    .reduce((sum, booking) => sum + booking.priceCents, 0);

  function applyParentSession(account: ParentAccount) {
    setParentSession(account);
    setStudentName(account.studentName);
    setFamilyName(account.studentName);
    setStudentEmail(account.email);
    setPhone(account.phone);
    window.localStorage.setItem(parentSessionKey, JSON.stringify(account));
  }

  async function registerParent(input: { studentName: string; email: string; phone: string; password: string }) {
    if (demoMode) {
      const accounts = JSON.parse(window.localStorage.getItem(demoParentAccountKey) ?? "[]") as DemoParentAccount[];
      const confirmationCode = String(Math.floor(100000 + Math.random() * 900000));
      const account: DemoParentAccount = {
        id: crypto.randomUUID(),
        studentName: input.studentName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        password: input.password,
        confirmationCode,
        confirmed: false,
        createdAt: new Date().toISOString()
      };
      const next = [account, ...accounts.filter((item) => item.email !== account.email)];
      window.localStorage.setItem(demoParentAccountKey, JSON.stringify(next));
      return { confirmationCode };
    }

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error("Registration failed");
    return (await response.json()) as { confirmationCode: string };
  }

  async function confirmParent(email: string, confirmationCode: string) {
    if (demoMode) {
      const accounts = JSON.parse(window.localStorage.getItem(demoParentAccountKey) ?? "[]") as DemoParentAccount[];
      const account = accounts.find((item) => item.email === email.toLowerCase() && item.confirmationCode === confirmationCode);
      if (!account) throw new Error("Invalid confirmation code");
      const confirmed = { ...account, confirmed: true };
      window.localStorage.setItem(
        demoParentAccountKey,
        JSON.stringify(accounts.map((item) => (item.id === account.id ? confirmed : item)))
      );
      applyParentSession(confirmed);
      return;
    }

    const response = await fetch("/api/auth/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, confirmationCode })
    });
    if (!response.ok) throw new Error("Confirmation failed");
    const data = (await response.json()) as { account: ParentAccount };
    applyParentSession(data.account);
  }

  async function loginParent(identifier: string, password: string) {
    if (demoMode) {
      const accounts = JSON.parse(window.localStorage.getItem(demoParentAccountKey) ?? "[]") as DemoParentAccount[];
      const account = accounts.find(
        (item) => (item.email === identifier.toLowerCase() || item.phone === identifier) && item.password === password && item.confirmed
      );
      if (!account) throw new Error("Invalid login");
      applyParentSession(account);
      return;
    }

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password })
    });
    if (!response.ok) throw new Error("Login failed");
    const data = (await response.json()) as { account: ParentAccount };
    applyParentSession(data.account);
  }

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

  function recurringSlots() {
    if (!recurring) return [selectedSlot];

    return Array.from({ length: recurringWeeks }, (_, index) => {
      const date = addDays(selectedSlot.date, index * 7);
      const dayIndex = Math.max(0, date.getDay() - 1);
      return makeCalendarSlot(makeCalendarDay(date, dayIndex), selectedSlot.timeLabel);
    }).filter((slot) => new Date(slot.startsAt) <= maxCalendarDate);
  }

  async function requestBooking(parentNote = "") {
    const slots = recurringSlots();
    setSaving(true);
    setNotice("正在保存家长请求 / Saving parent request...");
    try {
      if (demoMode) {
        const createdAt = new Date().toISOString();
        const nextBookings: Booking[] = slots.map((slot) => ({
          id: crypto.randomUUID(),
          studentName,
          familyName,
          studentEmail,
          phone,
          requestedCoach,
          assignedCoach: requestedCoach,
          program: requestedCoach === "Coach A" ? "Private lesson" : "Group lesson",
          dateLabel: slot.dateLabel,
          timeLabel: slot.timeLabel,
          startsAt: slot.startsAt,
          priceCents: requestedCoach === "Coach A" ? 15000 : 7500,
          status: "requested",
          parentNote: recurring ? `每周重复预约 / Weekly recurring request. ${parentNote}` : parentNote,
          createdAt,
          updatedAt: createdAt
        }));
        const next = [...nextBookings, ...bookings];
        window.localStorage.setItem(demoBookingKey, JSON.stringify(next));
        setBookings(next);
        setNotice(`已保存 ${nextBookings.length} 个请求 / Saved ${nextBookings.length} request${nextBookings.length === 1 ? "" : "s"}.`);
        setMode("club");
        return;
      }

      const responses = await Promise.all(
        slots.map((slot) =>
          fetch("/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studentName,
              familyName,
              studentEmail,
              phone,
              requestedCoach,
              program: requestedCoach === "Coach A" ? "Private lesson" : "Group lesson",
              dateLabel: slot.dateLabel,
              timeLabel: slot.timeLabel,
              startsAt: slot.startsAt,
              priceCents: requestedCoach === "Coach A" ? 15000 : 7500,
              parentNote: recurring ? `每周重复预约 / Weekly recurring request. ${parentNote}` : parentNote
            })
          })
        )
      );

      if (responses.some((response) => !response.ok)) throw new Error("Booking request failed");
      await loadAll();
      setNotice(`已保存 ${slots.length} 个请求 / Saved ${slots.length} request${slots.length === 1 ? "" : "s"}.`);
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
    const storedParent = window.localStorage.getItem(parentSessionKey);
    if (storedParent) {
      applyParentSession(JSON.parse(storedParent) as ParentAccount);
    }
    setClubAuthenticated(window.localStorage.getItem(clubSessionKey) === "true");
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
                : "俱乐部端 / Club App: confirm requests and mark classes completed"}
            </p>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
            </button>
            {mode === "parent" && parentSession ? (
              <button
                className="filter-button"
                onClick={() => {
                  setParentSession(null);
                  window.localStorage.removeItem(parentSessionKey);
                }}
              >
                <LogOut size={17} />
                退出 / Logout
              </button>
            ) : null}
            {mode === "club" && clubAuthenticated ? (
              <button
                className="filter-button"
                onClick={() => {
                  setClubAuthenticated(false);
                  window.localStorage.removeItem(clubSessionKey);
                }}
              >
                <LogOut size={17} />
                退出 / Logout
              </button>
            ) : null}
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
          <span>家长请求 → 俱乐部确认 → 教练点击课程完成</span>
          {demoMode ? <span>GitHub preview mode</span> : null}
        </section>

        {mode === "parent" && !parentSession ? (
          <ParentAuth
            onRegister={registerParent}
            onConfirm={confirmParent}
            onLogin={loginParent}
          />
        ) : mode === "parent" ? (
          <ParentApp
            bookings={parentBookings}
            allBookings={bookings}
            completedTotal={completedTotal}
            notice={notice}
            studentName={studentName}
            studentEmail={studentEmail}
            phone={phone}
            requestedCoach={requestedCoach}
            selectedSlot={selectedSlot}
            calendarDays={calendarDays}
            weekLabel={weekLabel(calendarDays)}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            recurring={recurring}
            recurringWeeks={recurringWeeks}
            saving={saving}
            onStudentNameChange={(value) => {
              setStudentName(value);
              setFamilyName(value);
            }}
            onStudentEmailChange={setStudentEmail}
            onPhoneChange={setPhone}
            onCoachChange={setRequestedCoach}
            onSlotChange={setSelectedSlot}
            onPreviousWeek={() => setVisibleWeekStart((week) => addDays(week, -7))}
            onNextWeek={() => setVisibleWeekStart((week) => addDays(week, 7))}
            onToday={() => {
              setVisibleWeekStart(initialWeekStart);
              setSelectedSlot(initialCalendarSlot);
            }}
            onRecurringChange={setRecurring}
            onRecurringWeeksChange={setRecurringWeeks}
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
        ) : !clubAuthenticated ? (
          <ClubLogin
            onLogin={() => {
              setClubAuthenticated(true);
              window.localStorage.setItem(clubSessionKey, "true");
            }}
          />
        ) : (
          <ClubAppView
            bookings={bookings}
            selectedSlot={selectedSlot}
            calendarDays={calendarDays}
            weekLabel={weekLabel(calendarDays)}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            notice={notice}
            requestedCoach={requestedCoach}
            onSlotChange={setSelectedSlot}
            onPreviousWeek={() => setVisibleWeekStart((week) => addDays(week, -7))}
            onNextWeek={() => setVisibleWeekStart((week) => addDays(week, 7))}
            onToday={() => {
              setVisibleWeekStart(initialWeekStart);
              setSelectedSlot(initialCalendarSlot);
            }}
            onConfirm={(booking, coach) => updateBooking(booking.id, "club_confirmed", coach)}
            onCoachComplete={(booking) => updateBooking(booking.id, "coach_confirmed", booking.assignedCoach)}
          />
        )}
      </section>
    </main>
  );
}

function ParentAuth({
  onRegister,
  onConfirm,
  onLogin
}: {
  onRegister: (input: { studentName: string; email: string; phone: string; password: string }) => Promise<{ confirmationCode: string }>;
  onConfirm: (email: string, confirmationCode: string) => Promise<void>;
  onLogin: (identifier: string, password: string) => Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<"login" | "register" | "confirm">("register");
  const [studentName, setStudentName] = useState("Ethan Chen");
  const [email, setEmail] = useState("parent@example.com");
  const [phone, setPhone] = useState("(650) 555-0188");
  const [password, setPassword] = useState("parent123");
  const [identifier, setIdentifier] = useState("parent@example.com");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("parent@example.com");
  const [notice, setNotice] = useState("请注册学生账号 / Register student account.");
  const [busy, setBusy] = useState(false);

  async function handleRegister() {
    setBusy(true);
    try {
      const result = await onRegister({ studentName, email, phone, password });
      setPendingEmail(email);
      setConfirmationCode(result.confirmationCode);
      await onConfirm(email, result.confirmationCode);
      setNotice("注册和确认已完成 / Registration verified.");
    } catch {
      setNotice("注册失败 / Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm(pendingEmail, confirmationCode);
      setNotice("注册完成 / Registration complete.");
    } catch {
      setNotice("确认码不正确 / Invalid confirmation code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setBusy(true);
    try {
      await onLogin(identifier, password);
      setNotice("登录成功 / Login successful.");
    } catch {
      setNotice("登录失败或邮箱未确认 / Login failed or email not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-panel">
      <div className="auth-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">家长登录 / Parent login</p>
            <h2>先注册学生账号</h2>
            <p className="section-subtitle">注册后确认邮箱，登录后查看 club coach calendar。</p>
          </div>
        </div>

        <div className="mode-switch auth-switch">
          <button className={authMode === "register" ? "selected" : ""} onClick={() => setAuthMode("register")}>
            注册 Register
          </button>
          <button className={authMode === "login" ? "selected" : ""} onClick={() => setAuthMode("login")}>
            登录 Login
          </button>
        </div>

        {authMode === "register" ? (
          <div className="simple-form auth-form">
            <label>
              <span>学生名字 / Student name</span>
              <div className="input-shell">
                <UserRound size={18} />
                <input value={studentName} onChange={(event) => setStudentName(event.target.value)} />
              </div>
            </label>
            <label>
              <span>邮箱 / Email</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
            </label>
            <label>
              <span>电话 / Phone</span>
              <div className="input-shell">
                <Phone size={18} />
                <input value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
            </label>
            <label>
              <span>密码 / Password</span>
              <PasswordField value={password} onChange={setPassword} />
            </label>
            <button className="primary-button auth-submit" disabled={busy} onClick={handleRegister}>
              <UserPlus size={18} />
              注册并完成确认 / Register
            </button>
          </div>
        ) : null}

        {authMode === "confirm" ? (
          <div className="simple-form auth-form">
            <label>
              <span>邮箱 / Email</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={pendingEmail} onChange={(event) => setPendingEmail(event.target.value)} />
              </div>
            </label>
            <label>
              <span>确认码 / Confirmation code</span>
              <div className="input-shell">
                <KeyRound size={18} />
                <input value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} />
              </div>
            </label>
            <button className="primary-button auth-submit" disabled={busy} onClick={handleConfirm}>
              <Check size={18} />
              完成注册 / Confirm
            </button>
          </div>
        ) : null}

        {authMode === "login" ? (
          <div className="simple-form auth-form">
            <label>
              <span>邮箱或电话 / Email or phone</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
              </div>
            </label>
            <label>
              <span>密码 / Password</span>
              <PasswordField value={password} onChange={setPassword} />
            </label>
            <button className="primary-button auth-submit" disabled={busy} onClick={handleLogin}>
              <LogIn size={18} />
              登录 / Login
            </button>
          </div>
        ) : null}

        <p className="system-note">{notice}</p>
      </div>
    </section>
  );
}

function ClubLogin({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("club123");
  const [notice, setNotice] = useState("Club 使用一个管理密码 / One club manager login.");

  return (
    <section className="auth-panel">
      <div className="auth-card compact-auth">
        <div className="section-head">
          <div>
            <p className="eyebrow">俱乐部登录 / Club login</p>
            <h2>管理 booking calendar</h2>
            <p className="section-subtitle">登录后确认 request，并点击 calendar class 完成课程。</p>
          </div>
        </div>
        <label className="solo-label">
          <span>管理密码 / Manager password</span>
          <PasswordField value={password} onChange={setPassword} />
        </label>
        <button
          className="primary-button auth-submit"
          onClick={() => {
            if (password !== clubPassword) {
              setNotice("密码不正确 / Wrong password.");
              return;
            }
            onLogin();
          }}
        >
          <LogIn size={18} />
          登录 Club / Login
        </button>
        <p className="system-note">{notice}</p>
      </div>
    </section>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="input-shell password-shell">
      <KeyRound size={18} />
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        className="password-toggle"
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "隐藏密码 / Hide password" : "显示密码 / Show password"}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function ParentApp({
  bookings,
  allBookings,
  completedTotal,
  notice,
  studentName,
  studentEmail,
  phone,
  requestedCoach,
  selectedSlot,
  calendarDays,
  weekLabel,
  canGoPrevious,
  canGoNext,
  recurring,
  recurringWeeks,
  saving,
  onStudentNameChange,
  onStudentEmailChange,
  onPhoneChange,
  onCoachChange,
  onSlotChange,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onRecurringChange,
  onRecurringWeeksChange,
  onRequestBooking,
  onChangeRequest,
  onCancel
}: {
  bookings: Booking[];
  allBookings: Booking[];
  completedTotal: number;
  notice: string;
  studentName: string;
  studentEmail: string;
  phone: string;
  requestedCoach: string;
  selectedSlot: CalendarSlot;
  calendarDays: CalendarDay[];
  weekLabel: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  recurring: boolean;
  recurringWeeks: number;
  saving: boolean;
  onStudentNameChange: (value: string) => void;
  onStudentEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onCoachChange: (value: string) => void;
  onSlotChange: (value: CalendarSlot) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onRecurringChange: (value: boolean) => void;
  onRecurringWeeksChange: (value: number) => void;
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
            <p className="section-subtitle">家长端 / Parent App: 可查看前三个月和后三个月，选择时间请求上课。</p>
          </div>
          <span className="status-chip good">{bookings.length} 课程 / classes</span>
        </div>
        <CalendarControls
          weekLabel={weekLabel}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          onPreviousWeek={onPreviousWeek}
          onNextWeek={onNextWeek}
          onToday={onToday}
        />
        <div className="calendar-board">
          <ClubCalendar
            bookings={allBookings}
            selectedSlot={selectedSlot}
            requestedCoach={requestedCoach}
            calendarDays={calendarDays}
            onSlotChange={onSlotChange}
          />
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
            {saving
              ? "保存中 / Saving..."
              : recurring
                ? `重复预约 / Weekly ${recurringWeeks} weeks ${selectedSlot.dayZh} ${selectedSlot.timeLabel}`
                : `请求预约 / Request ${requestedCoach} ${selectedSlot.dateLabel} ${selectedSlot.timeLabel}`}
          </button>
        </div>
        <div className="recurring-row">
          <label>
            <input type="checkbox" checked={recurring} onChange={(event) => onRecurringChange(event.target.checked)} />
            <span>每周重复预约 / Weekly recurring</span>
          </label>
          <select value={recurringWeeks} onChange={(event) => onRecurringWeeksChange(Number(event.target.value))} disabled={!recurring}>
            <option value={4}>4 周 / 4 weeks</option>
            <option value={8}>8 周 / 8 weeks</option>
            <option value={12}>12 周 / 12 weeks</option>
          </select>
          <span>
            当前选择 / Selected: {selectedSlot.dayZh} {selectedSlot.timeLabel} - 8:00 PM
          </span>
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

function CalendarControls({
  weekLabel,
  canGoPrevious,
  canGoNext,
  onPreviousWeek,
  onNextWeek,
  onToday
}: {
  weekLabel: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}) {
  return (
    <div className="calendar-controls">
      <button className="icon-button" disabled={!canGoPrevious} onClick={onPreviousWeek} aria-label="Previous week">
        <ChevronLeft size={18} />
      </button>
      <div>
        <strong>{weekLabel}</strong>
        <span>前三个月 - 后三个月 / 3 months back to 3 months forward</span>
      </div>
      <button className="filter-button" onClick={onToday}>
        今天 / Today
      </button>
      <button className="icon-button" disabled={!canGoNext} onClick={onNextWeek} aria-label="Next week">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function ClubCalendar({
  bookings,
  selectedSlot,
  requestedCoach,
  calendarDays,
  onSlotChange,
  onCoachComplete
}: {
  bookings: Booking[];
  selectedSlot: CalendarSlot;
  requestedCoach: string;
  calendarDays: CalendarDay[];
  onSlotChange: (value: CalendarSlot) => void;
  onCoachComplete?: (booking: Booking) => void;
}) {
  return (
    <div className="week-calendar" aria-label="Club calendar view">
      <div className="calendar-corner">Time<br />时间</div>
      {calendarDays.map((day) => (
        <div className={day.isToday ? "calendar-day-head today" : "calendar-day-head"} key={day.dateLabel}>
          <span className="day-zh">{day.dayZh}</span>
          <strong>{day.dateNumber}</strong>
          <span>{day.day} · {day.monthLabel}</span>
        </div>
      ))}

      {calendarTimes.map((timeLabel) => (
        <Fragment key={timeLabel}>
          <div className="calendar-time" key={`${timeLabel}-label`}>
            <strong>{timeLabel}</strong>
          </div>
          {calendarDays.map((day) => {
            const startsAt = makeStartsAt(day.date, timeLabel);
            const slotBookings = bookings.filter((booking) => booking.startsAt === startsAt && booking.status !== "cancelled");
            const completeTarget = slotBookings.find((booking) => booking.status === "club_confirmed");
            const slot = makeCalendarSlot(day, timeLabel);
            const selected = selectedSlot.startsAt === startsAt;
            const actionable = Boolean(onCoachComplete && completeTarget);
            return (
              <button
                className={[
                  "calendar-cell",
                  selected ? "selected" : "",
                  actionable ? "actionable" : ""
                ].filter(Boolean).join(" ")}
                key={startsAt}
                onClick={() => {
                  if (onCoachComplete && completeTarget) {
                    onCoachComplete(completeTarget);
                    return;
                  }
                  onSlotChange(slot);
                }}
              >
                {slotBookings.length === 0 ? (
                  <span className="open-slot">
                    <strong>{timeLabel}</strong>
                    <small>可预约 / Available</small>
                  </span>
                ) : (
                  slotBookings.map((booking) => (
                    <span className={`calendar-booking ${booking.status}`} key={booking.id}>
                      <strong>{booking.assignedCoach}</strong>
                      <small>{booking.studentName}</small>
                      <em>{statusText(booking.status)}</em>
                      {onCoachComplete && booking.status === "club_confirmed" ? <b>点击完成 / Click complete</b> : null}
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
  calendarDays,
  weekLabel,
  canGoPrevious,
  canGoNext,
  notice,
  requestedCoach,
  onSlotChange,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onConfirm,
  onCoachComplete
}: {
  bookings: Booking[];
  selectedSlot: CalendarSlot;
  calendarDays: CalendarDay[];
  weekLabel: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  notice: string;
  requestedCoach: string;
  onSlotChange: (value: CalendarSlot) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onConfirm: (booking: Booking, coach: string) => void;
  onCoachComplete: (booking: Booking) => void;
}) {
  const requested = bookings.filter((booking) => booking.status === "requested" || booking.status === "change_requested");
  const confirmed = bookings.filter((booking) => booking.status === "club_confirmed");

  return (
    <section className="calendar-first">
      <section className="section-block calendar-core">
        <div className="section-head">
          <div>
            <p className="eyebrow">俱乐部日历 / Club calendar</p>
            <h2>确认请求并完成课程</h2>
            <p className="section-subtitle">俱乐部端 / Club App: 点击已确认课程即可标记完成。</p>
          </div>
          <span className="status-chip">{requested.length} 待确认 / pending</span>
        </div>
        <CalendarControls
          weekLabel={weekLabel}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          onPreviousWeek={onPreviousWeek}
          onNextWeek={onNextWeek}
          onToday={onToday}
        />
        <div className="calendar-board">
          <ClubCalendar
            bookings={bookings}
            selectedSlot={selectedSlot}
            requestedCoach={requestedCoach}
            calendarDays={calendarDays}
            onSlotChange={onSlotChange}
            onCoachComplete={onCoachComplete}
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
              <h2>从日历点击完成</h2>
              <p className="section-subtitle">Confirmed classes can be completed directly from the calendar / 已确认课程可直接在日历完成</p>
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
