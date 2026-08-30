"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
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
import {
  createBillNotification,
  createBooking,
  listBillNotifications,
  listBookings,
  loginParentAccount,
  registerParentAccount,
  updateBooking as updateStoredBooking
} from "@/lib/projectStore";
import type { BillNotification, Booking, BookingStatus, ParentAccount } from "@/lib/types";

const coaches = ["Coach A", "Coach B", "Coach Tian Ye", "Coach Jorden"] as const;
const clubCalendarTabs = ["Combined", ...coaches] as const;
const calendarTimes = ["4:30 PM", "5:15 PM", "6:00 PM", "7:00 PM"];
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayNamesZh = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
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

type ClubCalendarTab = (typeof clubCalendarTabs)[number];
type ExportPeriod = "weekly" | "monthly";

const parentSessionKey = "rswtta-parent-session";
const clubSessionKey = "rswtta-club-session";
const clubEmail = "rswtta@gmail.com";
const clubPassword = "rswtta888";

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
    change_requested: "改期/取消请求 / Change/cancel requested",
    cancelled: "已取消 / Cancelled",
    coach_confirmed: "教练确认完成 / Coach completed"
  };
  return labels[status];
}

function isMoreThan12HoursBeforeClass(booking: Booking) {
  const starts = new Date(booking.startsAt).getTime();
  return starts - Date.now() > 12 * 60 * 60 * 1000;
}

function canParentRequestChange(booking: Booking) {
  return ["requested", "club_confirmed"].includes(booking.status);
}

function isCancellationRequest(booking: Booking) {
  const note = booking.parentNote.toLowerCase();
  return booking.status === "change_requested" && (note.includes("cancel") || booking.parentNote.includes("取消"));
}

function lessonProgram(coach: string) {
  return coach === "Coach A" || coach === "Coach Tian Ye" ? "Private lesson" : "Group lesson";
}

function lessonPriceCents(coach: string) {
  return coach === "Coach A" || coach === "Coach Tian Ye" ? 15000 : 7500;
}

function coachTabText(tab: ClubCalendarTab) {
  return tab === "Combined" ? "全部 / Combined" : tab.replace("Coach ", "");
}

function csvValue(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
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
  const [requestedCoach, setRequestedCoach] = useState<string>(coaches[0]);
  const [clubCalendarTab, setClubCalendarTab] = useState<ClubCalendarTab>("Combined");
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
    const result = await registerParentAccount(input);
    applyParentSession(result.account);
  }

  async function loginParent(identifier: string, password: string) {
    const account = await loginParentAccount(identifier, password);
    applyParentSession(account);
  }

  async function loginUnified(identifier: string, password: string) {
    if (identifier.trim().toLowerCase() === clubEmail) {
      if (password !== clubPassword) {
        throw new Error("Wrong club password");
      }
      setClubAuthenticated(true);
      window.localStorage.setItem(clubSessionKey, "true");
      setMode("club");
      return;
    }

    await loginParent(identifier, password);
    setMode("parent");
  }

  async function loadAll() {
    try {
      const [nextBookings, nextBills] = await Promise.all([listBookings(), listBillNotifications()]);
      setBookings(nextBookings);
      setBills(nextBills);
      setNotice("Supabase 已连接 / Supabase backend connected.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "数据库暂时不可用 / Database is not ready.");
    }
  }

  function recurringSlots() {
    if (!recurring) return [selectedSlot];

    return Array.from({ length: recurringWeeks }, (_, index) => {
      const date = addDays(selectedSlot.date, index * 7);
      const dayIndex = (date.getDay() + 6) % 7;
      return makeCalendarSlot(makeCalendarDay(date, dayIndex), selectedSlot.timeLabel);
    }).filter((slot) => new Date(slot.startsAt) <= maxCalendarDate);
  }

  async function requestBooking(parentNote = "") {
    const slots = recurringSlots();
    setSaving(true);
    setNotice("正在保存家长请求 / Saving parent request...");
    try {
      await Promise.all(
        slots.map((slot) =>
          createBooking({
            studentName,
            familyName,
            studentEmail,
            phone,
            requestedCoach,
            assignedCoach: requestedCoach,
            program: lessonProgram(requestedCoach),
            dateLabel: slot.dateLabel,
            timeLabel: slot.timeLabel,
            startsAt: slot.startsAt,
            priceCents: lessonPriceCents(requestedCoach),
            parentNote: recurring ? `每周重复预约 / Weekly recurring request. ${parentNote}` : parentNote
          })
        )
      );

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
    try {
      await updateStoredBooking(id, { status, assignedCoach, ...schedule });
      await loadAll();
      setNotice(`Saved: ${statusText(status)}. Parent and club views now match.`);
    } catch {
      setNotice("无法更新课程 / Could not update booking.");
    }
  }

  async function generateBills() {
    setNotice("Generating weekly student bill notifications...");
    try {
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

      await Promise.all(
        [...grouped.values()].map((bill) =>
          createBillNotification({
            studentName: bill.studentName,
            familyName: bill.familyName,
            classCount: bill.classCount,
            amountCents: bill.amountCents,
            message: bill.message
          })
        )
      );
      await loadAll();
      setNotice("账单提醒已生成 / Bill notifications generated from coach-completed classes.");
    } catch {
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
            <strong>Rising Stars World</strong>
            <span>Table Tennis Academy</span>
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
          <strong>状态 / Status</strong>
          <span>家长请求 → 俱乐部确认 → 教练完成</span>
          <span>真实数据库 / Live database</span>
        </section>

        {mode === "parent" && !parentSession ? (
          <UnifiedAuth
            onRegister={registerParent}
            onLogin={loginUnified}
          />
        ) : mode === "parent" && parentSession ? (
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
              updateBooking(booking.id, "change_requested", requestedCoach, {
                dateLabel: selectedSlot.dateLabel,
                timeLabel: selectedSlot.timeLabel,
                startsAt: selectedSlot.startsAt,
                parentNote: isMoreThan12HoursBeforeClass(booking)
                  ? `家长申请改期 / Parent requested change from ${booking.dateLabel} ${booking.timeLabel}`
                  : `12小时内改期请求 / Late change request from ${booking.dateLabel} ${booking.timeLabel}`
              });
            }}
            onCancel={(booking) => {
              if (!isMoreThan12HoursBeforeClass(booking)) {
                updateBooking(booking.id, "change_requested", booking.assignedCoach, {
                  dateLabel: booking.dateLabel,
                  timeLabel: booking.timeLabel,
                  startsAt: booking.startsAt,
                  parentNote: `12小时内取消请求 / Late cancellation request for ${booking.dateLabel} ${booking.timeLabel}`
                });
                return;
              }
              updateBooking(booking.id, "cancelled");
            }}
          />
        ) : mode === "club" && !clubAuthenticated ? (
          <UnifiedAuth
            onRegister={registerParent}
            onLogin={loginUnified}
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
            activeCalendarTab={clubCalendarTab}
            onSlotChange={setSelectedSlot}
            onCalendarTabChange={setClubCalendarTab}
            onPreviousWeek={() => setVisibleWeekStart((week) => addDays(week, -7))}
            onNextWeek={() => setVisibleWeekStart((week) => addDays(week, 7))}
            onToday={() => {
              setVisibleWeekStart(initialWeekStart);
              setSelectedSlot(initialCalendarSlot);
            }}
            onConfirm={(booking, coach) => updateBooking(booking.id, "club_confirmed", coach)}
            onApproveCancel={(booking) => updateBooking(booking.id, "cancelled", booking.assignedCoach)}
            onCoachComplete={(booking) => updateBooking(booking.id, "coach_confirmed", booking.assignedCoach)}
          />
        )}
      </section>
    </main>
  );
}

function UnifiedAuth({
  onRegister,
  onLogin
}: {
  onRegister: (input: { studentName: string; email: string; phone: string; password: string }) => Promise<void>;
  onLogin: (identifier: string, password: string) => Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [studentName, setStudentName] = useState("Ethan Chen");
  const [email, setEmail] = useState("parent@example.com");
  const [phone, setPhone] = useState("(650) 555-0188");
  const [password, setPassword] = useState("parent123");
  const [identifier, setIdentifier] = useState("parent@example.com");
  const [notice, setNotice] = useState("家长用学生账号登录；俱乐部用管理邮箱登录 / Parents use student account; club uses manager email.");
  const [busy, setBusy] = useState(false);

  async function handleRegister() {
    setBusy(true);
    try {
      await onRegister({ studentName, email, phone, password });
      setNotice("注册完成 / Registration complete.");
    } catch {
      setNotice("注册失败 / Registration failed.");
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
      setNotice("登录失败 / Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-panel">
      <div className="auth-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">统一登录 / One login</p>
            <h2>统一登录入口</h2>
            <p className="section-subtitle">家长注册学生账号；俱乐部用 rswtta@gmail.com 登录 / One login page for parent and club.</p>
          </div>
        </div>

        <div className="mode-switch auth-switch">
          <button type="button" className={authMode === "register" ? "selected" : ""} onClick={() => setAuthMode("register")}>
            注册 Register
          </button>
          <button type="button" className={authMode === "login" ? "selected" : ""} onClick={() => setAuthMode("login")}>
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
            <button type="button" className="primary-button auth-submit" disabled={busy} onClick={handleRegister}>
              <UserPlus size={18} />
              注册 / Register
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
            <button type="button" className="primary-button auth-submit" disabled={busy} onClick={handleLogin}>
              <LogIn size={18} />
              登录 / Login
            </button>
            <p className="helper-line">Club 使用管理邮箱登录 / Club uses manager email login.</p>
          </div>
        ) : null}

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
              <p className="section-subtitle">超过12小时可取消；12小时内会发送请求给club确认 / Inside 12 hours sends a club approval request.</p>
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
  visibleCoachTab = "Combined",
  calendarDays,
  onSlotChange,
  onCoachComplete
}: {
  bookings: Booking[];
  selectedSlot: CalendarSlot;
  requestedCoach: string;
  visibleCoachTab?: ClubCalendarTab;
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
            const slotBookings = bookings.filter((booking) => {
              const matchesSlot = booking.startsAt === startsAt && booking.status !== "cancelled";
              const matchesCoach =
                visibleCoachTab === "Combined" || booking.assignedCoach === visibleCoachTab || booking.requestedCoach === visibleCoachTab;
              return matchesSlot && matchesCoach;
            });
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
  activeCalendarTab,
  onSlotChange,
  onCalendarTabChange,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onConfirm,
  onApproveCancel,
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
  activeCalendarTab: ClubCalendarTab;
  onSlotChange: (value: CalendarSlot) => void;
  onCalendarTabChange: (value: ClubCalendarTab) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onConfirm: (booking: Booking, coach: string) => void;
  onApproveCancel: (booking: Booking) => void;
  onCoachComplete: (booking: Booking) => void;
}) {
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod>("weekly");
  const requested = bookings.filter((booking) => booking.status === "requested" || booking.status === "change_requested");
  const confirmed = bookings.filter((booking) => booking.status === "club_confirmed");

  function exportCompletedClassReport() {
    const anchorDate = selectedSlot.date;
    const periodStart = exportPeriod === "weekly" ? startOfWeek(anchorDate) : startOfMonth(anchorDate);
    const periodEnd = exportPeriod === "weekly" ? endOfDay(addDays(periodStart, 6)) : endOfMonth(anchorDate);
    const periodTitle =
      exportPeriod === "weekly"
        ? `${dateLabel(periodStart)} - ${dateLabel(periodEnd)}`
        : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(anchorDate);

    const inPeriod = bookings.filter((booking) => {
      const startsAt = new Date(booking.startsAt);
      return startsAt >= periodStart && startsAt <= periodEnd && booking.status !== "cancelled";
    });

    const grouped = new Map<
      string,
      {
        studentName: string;
        email: string;
        phone: string;
        completedCount: number;
        notCoachConfirmedCount: number;
        completedAmountCents: number;
      }
    >();

    for (const booking of inPeriod) {
      const key = `${booking.studentName}|${booking.studentEmail}|${booking.phone}`;
      const existing =
        grouped.get(key) ??
        {
          studentName: booking.studentName,
          email: booking.studentEmail,
          phone: booking.phone,
          completedCount: 0,
          notCoachConfirmedCount: 0,
          completedAmountCents: 0
        };

      if (booking.status === "coach_confirmed") {
        existing.completedCount += 1;
        existing.completedAmountCents += booking.priceCents;
      } else {
        existing.notCoachConfirmedCount += 1;
      }

      grouped.set(key, existing);
    }

    const summaryRows = [
      ["Student", "Email", "Phone", "Completed classes", "Not coach final confirmed", "Completed bill amount"],
      ...[...grouped.values()].map((row) => [
        row.studentName,
        row.email,
        row.phone,
        row.completedCount,
        row.notCoachConfirmedCount,
        dollars(row.completedAmountCents)
      ])
    ];

    const detailRows = [
      ["Date", "Time", "Student", "Coach", "Status", "Price", "Parent note"],
      ...inPeriod
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
        .map((booking) => [
          booking.dateLabel,
          booking.timeLabel,
          booking.studentName,
          booking.assignedCoach,
          statusText(booking.status),
          dollars(booking.priceCents),
          booking.parentNote
        ])
    ];

    const csv = [
      ["RSWTTA class report", periodTitle],
      ["Report type", exportPeriod],
      [],
      ["Summary by student"],
      ...summaryRows,
      [],
      ["Class details"],
      ...detailRows
    ]
      .map((row) => row.map((cell) => csvValue(cell)).join(","))
      .join("\n");

    downloadTextFile(`rswtta-${exportPeriod}-classes-${periodStart.toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
  }

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
        <div className="calendar-tabs" aria-label="Coach calendar views">
          {clubCalendarTabs.map((tab) => (
            <button className={activeCalendarTab === tab ? "selected" : ""} key={tab} onClick={() => onCalendarTabChange(tab)}>
              {coachTabText(tab)}
            </button>
          ))}
        </div>
        <div className="calendar-board">
          <ClubCalendar
            bookings={bookings}
            selectedSlot={selectedSlot}
            requestedCoach={requestedCoach}
            visibleCoachTab={activeCalendarTab}
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
              <p className="eyebrow">下载表格 / Export</p>
              <h2>下载 completed class 汇总</h2>
              <p className="section-subtitle">Weekly or monthly CSV for Excel / 按学生统计完成课和未最终确认课</p>
            </div>
          </div>
          <div className="export-panel">
            <div className="export-toggle" aria-label="Report period">
              <button className={exportPeriod === "weekly" ? "selected" : ""} onClick={() => setExportPeriod("weekly")}>
                每周 / Weekly
              </button>
              <button className={exportPeriod === "monthly" ? "selected" : ""} onClick={() => setExportPeriod("monthly")}>
                每月 / Monthly
              </button>
            </div>
            <button className="primary-button wide-button" onClick={exportCompletedClassReport}>
              <Download size={18} />
              下载 Excel CSV / Download
            </button>
          </div>
        </section>

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
                {isCancellationRequest(booking) ? (
                  <button className="decline" onClick={() => onApproveCancel(booking)}>
                    <X size={17} />
                    批准取消 / Approve cancel
                  </button>
                ) : (
                  <div className="confirm-actions">
                    {coaches.map((coach) => (
                      <button className="accept" key={coach} onClick={() => onConfirm(booking, coach)}>
                        <Check size={17} />
                        {coach.replace("Coach ", "")}
                      </button>
                    ))}
                  </div>
                )}
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
              <button disabled={!canParentRequestChange(booking)} onClick={() => onChangeRequest?.(booking)}>
                <RefreshCcw size={15} />
              </button>
              <button disabled={!canParentRequestChange(booking)} onClick={() => onCancel?.(booking)}>
                <X size={15} />
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
