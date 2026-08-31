"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  Phone,
  Plus,
  RefreshCcw,
  Search,
  Table2,
  UserPlus,
  UserRound,
  X
} from "lucide-react";
import {
  completeParentProfileSetup,
  createBillNotification,
  createBooking,
  listBillNotifications,
  listBookings,
  listParentAccounts,
  loginParentAccount,
  registerParentAccount,
  resetPasswordForEmail,
  updateUserPassword,
  updateBooking as updateStoredBooking
} from "@/lib/projectStore";
import { supabase } from "@/lib/supabase";
import type { BillNotification, Booking, BookingStatus, ParentAccount } from "@/lib/types";

const coaches = ["Coach Tian Ye", "Coach Jorden", "Coach A", "Coach B"] as const;
const clubCalendarTabs = [...coaches, "Combined"] as const;
const calendarTimes = [
  "7 AM",
  "8 AM",
  "9 AM",
  "10 AM",
  "11 AM",
  "12 PM",
  "1 PM",
  "2 PM",
  "3 PM",
  "4 PM",
  "5 PM",
  "6 PM",
  "7 PM",
  "8 PM",
  "9 PM",
  "10 PM"
];
const durationOptions = [30, 60, 90, 120];
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayNamesZh = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
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
type AuthMode = "login" | "register" | "forgot" | "updatePassword";
type Language = "en" | "zh";

const parentSessionKey = "rswtta-parent-session";
const clubSessionKey = "rswtta-club-session";
const clubEmail = "rswtta@gmail.com";
const clubPassword = "rswtta888";
const preregisteredPasswordTemplate = ["rs", "wt", "ta"].join("");

function copy(language: Language, english: string, chinese: string) {
  return language === "zh" ? chinese : english;
}

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function statusText(status: BookingStatus, language: Language = "en") {
  const labels: Record<BookingStatus, { en: string; zh: string }> = {
    requested: { en: "Requested", zh: "已请求" },
    club_confirmed: { en: "Club confirmed", zh: "已确认" },
    change_requested: { en: "Change/cancel requested", zh: "改期/取消请求" },
    cancelled: { en: "Cancelled", zh: "已取消" },
    coach_confirmed: { en: "Coach completed", zh: "教练确认完成" }
  };
  return labels[status][language];
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

function coachTabText(tab: ClubCalendarTab, language: Language) {
  return tab === "Combined" ? copy(language, "Combined", "全部") : tab.replace("Coach ", "");
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

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
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

function timeLabel(date: Date) {
  const text = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
  return text.replace(":00", "");
}

function parseClockLabel(label: string) {
  const match = label.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return [13, 0] as const;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return [hours, minutes] as const;
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
  const [hours, minutes] = parseClockLabel(timeLabel);
  const starts = new Date(date);
  starts.setHours(hours, minutes, 0, 0);
  return starts.toISOString();
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function makeSlotFromInput(dateValue: string, timeValue: string): CalendarSlot {
  const date = dateFromInputValue(dateValue);
  const dayIndex = (date.getDay() + 6) % 7;
  return makeCalendarSlot(makeCalendarDay(date, dayIndex), timeValue);
}

function rangeEndLabel(slot: CalendarSlot, durationMinutes: number) {
  return timeLabel(addMinutes(new Date(slot.startsAt), durationMinutes));
}

function rangeLabel(slot: CalendarSlot, durationMinutes: number) {
  return `${slot.timeLabel} - ${rangeEndLabel(slot, durationMinutes)}`;
}

function compactTimeRange(label: string) {
  const [start, end] = label.split(" - ");
  if (!start || !end) return label;
  const startMatch = start.match(/^(.+?)\s(AM|PM)$/);
  const endMatch = end.match(/^(.+?)\s(AM|PM)$/);
  if (startMatch && endMatch && startMatch[2] === endMatch[2]) {
    return `${startMatch[1]}-${endMatch[1]} ${endMatch[2]}`;
  }
  return `${start}-${end}`;
}

function compactRangeLabel(slot: CalendarSlot, durationMinutes: number) {
  return compactTimeRange(rangeLabel(slot, durationMinutes));
}

function endTimeOptions(slot: CalendarSlot) {
  const starts = new Date(slot.startsAt);
  const finalEnd = new Date(starts);
  finalEnd.setHours(22, 0, 0, 0);
  if (finalEnd <= starts) finalEnd.setHours(23, 0, 0, 0);

  const options: { label: string; duration: number }[] = [];
  for (let cursor = addMinutes(starts, 30); cursor <= finalEnd; cursor = addMinutes(cursor, 30)) {
    options.push({
      label: timeLabel(cursor),
      duration: Math.round((cursor.getTime() - starts.getTime()) / 60000)
    });
  }
  return options;
}

function bookingEndDate(booking: Booking) {
  const starts = new Date(booking.startsAt);
  const [, endLabel] = booking.timeLabel.split(" - ");
  if (!endLabel) return addMinutes(starts, 60);
  const [hours, minutes] = parseClockLabel(endLabel);
  const ends = new Date(starts);
  ends.setHours(hours, minutes, 0, 0);
  return ends <= starts ? addMinutes(starts, 60) : ends;
}

function bookingMatchesCoach(booking: Booking, coach: string) {
  return booking.assignedCoach === coach || booking.requestedCoach === coach;
}

function isBlockedTime(booking: Booking) {
  return booking.program === "Unavailable";
}

function rangesOverlap(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function isRangeUnavailable(bookings: Booking[], coach: string, slot: CalendarSlot, durationMinutes: number) {
  const starts = new Date(slot.startsAt);
  const ends = addMinutes(starts, durationMinutes);
  return bookings.some((booking) => {
    if (booking.status === "cancelled" || !bookingMatchesCoach(booking, coach)) return false;
    return rangesOverlap(starts, ends, new Date(booking.startsAt), bookingEndDate(booking));
  });
}

function isRangeUnavailableExceptBooking(bookings: Booking[], coach: string, slot: CalendarSlot, durationMinutes: number, bookingId: string) {
  return isRangeUnavailable(bookings.filter((booking) => booking.id !== bookingId), coach, slot, durationMinutes);
}

function bookingDurationHours(booking: Booking) {
  const durationMinutes = Math.max(30, Math.round((bookingEndDate(booking).getTime() - new Date(booking.startsAt).getTime()) / 60000));
  return durationMinutes / 60;
}

function eventHeightStyle(hours: number) {
  return { height: `calc(${hours} * var(--calendar-hour-height) - 10px)` };
}

function coachLaneIndex(booking: Booking) {
  const index = coaches.findIndex((coach) => bookingMatchesCoach(booking, coach));
  return index >= 0 ? index : coaches.length;
}

function calendarEventStyle(booking: Booking, useCoachLane: boolean, cellStart?: Date) {
  const startOffsetMinutes = cellStart
    ? Math.max(0, Math.round((new Date(booking.startsAt).getTime() - cellStart.getTime()) / 60000))
    : 0;
  const baseStyle = {
    ...eventHeightStyle(bookingDurationHours(booking)),
    top: `calc(4px + (${startOffsetMinutes} / 60) * var(--calendar-hour-height))`
  };
  if (!useCoachLane) return baseStyle;

  return {
    ...baseStyle,
    left: `calc(4px + ${coachLaneIndex(booking)} * ((100% - 8px) / ${coaches.length}))`,
    right: "auto",
    width: `calc((100% - 8px) / ${coaches.length} - 3px)`
  };
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
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return makeCalendarDay(date, (date.getDay() + 6) % 7);
  });
}

function repeatedCalendarSlots(baseSlot: CalendarSlot, weeks: number) {
  return Array.from({ length: weeks }, (_, index) => {
    const date = addDays(baseSlot.date, index * 7);
    const dayIndex = (date.getDay() + 6) % 7;
    return makeCalendarSlot(makeCalendarDay(date, dayIndex), baseSlot.timeLabel);
  }).filter((slot) => new Date(slot.startsAt) <= maxCalendarDate);
}

function weekLabel(days: CalendarDay[], language: Language) {
  const first = days[0];
  const last = days[days.length - 1];
  const year = first.date.getFullYear() === last.date.getFullYear() ? first.date.getFullYear() : `${first.date.getFullYear()}-${last.date.getFullYear()}`;
  return copy(language, `${first.monthLabel} - ${last.monthLabel}, ${year}`, `${year}年 ${first.dateZh} - ${last.dateZh}`);
}

const minCalendarDate = addMonths(today, -3);
const maxCalendarDate = new Date(2026, 11, 31);
const initialWeekStart = today;
const initialCalendarDay = makeCalendarDay(today, (today.getDay() + 6) % 7);
const initialCalendarSlot = makeCalendarSlot(initialCalendarDay, "7 PM");

export function ClubApp() {
  const [mode, setMode] = useState<"parent" | "club">("parent");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bills, setBills] = useState<BillNotification[]>([]);
  const [students, setStudents] = useState<ParentAccount[]>([]);
  const [language, setLanguage] = useState<Language>("en");
  const [notice, setNotice] = useState("");
  const [parentSession, setParentSession] = useState<ParentAccount | null>(null);
  const [clubAuthenticated, setClubAuthenticated] = useState(false);
  const [studentName, setStudentName] = useState("Ethan Chen");
  const [familyName, setFamilyName] = useState("Chen Family");
  const [studentEmail, setStudentEmail] = useState("parent@example.com");
  const [phone, setPhone] = useState("(650) 555-0188");
  const [requestedCoach, setRequestedCoach] = useState<string>(coaches[0]);
  const [clubCalendarTab, setClubCalendarTab] = useState<ClubCalendarTab>("Coach Tian Ye");
  const [visibleWeekStart, setVisibleWeekStart] = useState(initialWeekStart);
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot>(initialCalendarSlot);
  const [selectedSlots, setSelectedSlots] = useState<CalendarSlot[]>([initialCalendarSlot]);
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState(60);
  const [showRequestConfirm, setShowRequestConfirm] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
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

  function replaceSelectedSlot(slot: CalendarSlot) {
    setSelectedSlot(slot);
    setSelectedSlots([slot]);
  }

  function selectSingleSlot(slot: CalendarSlot) {
    setSelectedSlot(slot);
    setSelectedSlots([slot]);
  }

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
    setMode("parent");
  }

  async function loginParent(identifier: string, password: string) {
    const account = await loginParentAccount(identifier, password);
    applyParentSession(account);
  }

  async function requestPasswordReset(email: string) {
    await resetPasswordForEmail(email);
  }

  async function updatePassword(password: string) {
    await updateUserPassword(password);
  }

  async function completeFirstLoginSetup(input: { email: string; phone: string; password: string }) {
    if (!parentSession) return;
    const account = await completeParentProfileSetup({
      accountId: parentSession.id,
      email: input.email,
      phone: input.phone,
      password: input.password
    });
    applyParentSession(account);
    await loadAll();
    setNotice(copy(language, "Profile setup complete. You can now use the dashboard.", "资料设置完成。现在可以使用主页。"));
  }

  async function loginClub(identifier: string, password: string) {
    if (identifier.trim().toLowerCase() !== clubEmail || password !== clubPassword) {
      throw new Error("Wrong club login");
    }
    setClubAuthenticated(true);
    window.localStorage.setItem(clubSessionKey, "true");
    setMode("club");
  }

  async function loginUnified(identifier: string, password: string) {
    if (identifier.trim().toLowerCase() === clubEmail) {
      await loginClub(identifier, password);
      return;
    }
    await loginParent(identifier, password);
    setMode("parent");
  }

  async function loadAll() {
    try {
      const [nextBookings, nextBills, nextStudents] = await Promise.all([listBookings(), listBillNotifications(), listParentAccounts()]);
      setBookings(nextBookings);
      setBills(nextBills);
      setStudents(nextStudents);
      setNotice(copy(language, "Supabase backend connected.", "Supabase 已连接。"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy(language, "Database is not ready.", "数据库暂时不可用。"));
    }
  }

  async function requestBooking(parentNote = "") {
    const slots = [selectedSlot];
    if (isRangeUnavailable(bookings, requestedCoach, selectedSlot, selectedDurationMinutes)) {
      setNotice(copy(language, "That coach is not available at the selected time.", "该教练这个时间不可预约。"));
      return;
    }
    setSaving(true);
    setNotice(copy(language, "Saving parent request...", "正在保存家长请求..."));
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
            timeLabel: rangeLabel(slot, selectedDurationMinutes),
            startsAt: slot.startsAt,
            priceCents: lessonPriceCents(requestedCoach),
            parentNote
          })
        )
      );

      await loadAll();
      setNotice(copy(language, `Saved ${slots.length} request${slots.length === 1 ? "" : "s"}.`, `已保存 ${slots.length} 个请求。`));
    } catch {
      setNotice(copy(language, "Could not save booking request.", "无法保存预约请求。"));
    } finally {
      setSaving(false);
    }
  }

  async function addClubClass(student: ParentAccount, coach: string, slots: CalendarSlot[], durationMinutes: number) {
    const unavailableSlot = slots.find((slot) => isRangeUnavailable(bookings, coach, slot, durationMinutes));
    if (unavailableSlot) {
      setNotice(copy(language, "That coach already has a class at the selected time.", "该教练这个时间已有课程。"));
      return;
    }
    setSaving(true);
    setNotice(copy(language, "Adding class...", "正在添加课程..."));
    try {
      await Promise.all(
        slots.map((slot) =>
          createBooking({
            studentName: student.studentName,
            familyName: student.studentName,
            studentEmail: student.email,
            phone: student.phone,
            requestedCoach: coach,
            assignedCoach: coach,
            program: lessonProgram(coach),
            dateLabel: slot.dateLabel,
            timeLabel: rangeLabel(slot, durationMinutes),
            startsAt: slot.startsAt,
            priceCents: lessonPriceCents(coach),
            parentNote: copy(language, "Added by club", "俱乐部添加")
          }).then((booking) => updateStoredBooking(booking.id, { status: "club_confirmed", assignedCoach: coach }))
        )
      );
      await loadAll();
      setNotice(copy(language, `Added ${slots.length} class${slots.length === 1 ? "" : "es"}.`, `已添加 ${slots.length} 节课。`));
    } catch {
      setNotice(copy(language, "Could not add class.", "无法添加课程。"));
    } finally {
      setSaving(false);
    }
  }

  async function addClubTryoutClass(input: { studentName: string; phone: string; note: string }, coach: string, slots: CalendarSlot[], durationMinutes: number) {
    const unavailableSlot = slots.find((slot) => isRangeUnavailable(bookings, coach, slot, durationMinutes));
    if (unavailableSlot) {
      setNotice(copy(language, "That coach already has a class at the selected time.", "该教练这个时间已有课程。"));
      return;
    }
    setSaving(true);
    setNotice(copy(language, "Adding tryout class...", "正在添加体验课..."));
    try {
      await Promise.all(
        slots.map((slot) =>
          createBooking({
            studentName: input.studentName,
            familyName: input.studentName,
            studentEmail: "",
            phone: input.phone,
            requestedCoach: coach,
            assignedCoach: coach,
            program: lessonProgram(coach),
            dateLabel: slot.dateLabel,
            timeLabel: rangeLabel(slot, durationMinutes),
            startsAt: slot.startsAt,
            priceCents: lessonPriceCents(coach),
            parentNote: input.note ? `Tryout: ${input.note}` : "Tryout class"
          }).then((booking) => updateStoredBooking(booking.id, { status: "club_confirmed", assignedCoach: coach }))
        )
      );
      await loadAll();
      setNotice(copy(language, `Added ${slots.length} tryout class${slots.length === 1 ? "" : "es"}.`, `已添加 ${slots.length} 节体验课。`));
    } catch {
      setNotice(copy(language, "Could not add tryout class.", "无法添加体验课。"));
    } finally {
      setSaving(false);
    }
  }

  async function blockCoachTime(coach: string, slots: CalendarSlot[], durationMinutes: number) {
    const unavailableSlot = slots.find((slot) => isRangeUnavailable(bookings, coach, slot, durationMinutes));
    if (unavailableSlot) {
      setNotice(copy(language, "That coach already has a class or blocked time there.", "该教练这个时间已有课程或不可用时间。"));
      return;
    }
    setSaving(true);
    setNotice(copy(language, "Blocking coach time...", "正在设置教练不可用时间..."));
    try {
      await Promise.all(
        slots.map((slot) =>
          createBooking({
            studentName: copy(language, "Coach unavailable", "教练不可用"),
            familyName: "Club",
            studentEmail: "",
            phone: "",
            requestedCoach: coach,
            assignedCoach: coach,
            program: "Unavailable",
            dateLabel: slot.dateLabel,
            timeLabel: rangeLabel(slot, durationMinutes),
            startsAt: slot.startsAt,
            priceCents: 0,
            parentNote: copy(language, "Blocked by club manager", "俱乐部管理员设置不可用")
          }).then((booking) => updateStoredBooking(booking.id, { status: "club_confirmed", assignedCoach: coach }))
        )
      );
      await loadAll();
      setNotice(copy(language, `Blocked ${slots.length} coach time${slots.length === 1 ? "" : "s"}.`, `已保存 ${slots.length} 个教练不可用时间。`));
    } catch {
      setNotice(copy(language, "Could not block coach time.", "无法保存教练不可用时间。"));
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
    setNotice(`${copy(language, "Updating status to", "正在更新状态为")} ${statusText(status, language)}...`);
    try {
      await updateStoredBooking(id, { status, assignedCoach, ...schedule });
      await loadAll();
      setNotice(`${copy(language, "Saved", "已保存")}: ${statusText(status, language)}.`);
    } catch {
      setNotice(copy(language, "Could not update booking.", "无法更新课程。"));
    }
  }

  async function completeParentClass(booking: Booking) {
    setNotice(copy(language, "Marking class complete...", "正在标记课程完成..."));
    try {
      if (booking.id.startsWith("virtual-")) {
        const created = await createBooking({
          studentName: booking.studentName,
          familyName: booking.familyName,
          studentEmail: booking.studentEmail,
          phone: booking.phone,
          requestedCoach: booking.requestedCoach,
          assignedCoach: booking.assignedCoach,
          program: booking.program,
          dateLabel: booking.dateLabel,
          timeLabel: booking.timeLabel,
          startsAt: booking.startsAt,
          priceCents: booking.priceCents,
          parentNote: `${booking.parentNote} Marked complete by student.`
        });
        await updateStoredBooking(created.id, { status: "coach_confirmed", assignedCoach: booking.assignedCoach });
      } else {
        await updateStoredBooking(booking.id, { status: "coach_confirmed", assignedCoach: booking.assignedCoach });
      }
      await loadAll();
      setNotice(copy(language, "Class marked complete.", "课程已标记完成。"));
    } catch {
      setNotice(copy(language, "Could not mark class complete.", "无法标记课程完成。"));
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
      setNotice(copy(language, "Bill notifications generated from coach-completed classes.", "账单提醒已生成。"));
    } catch {
      setNotice(copy(language, "Could not generate bills.", "无法生成账单。"));
    }
  }

  useEffect(() => {
    const storedParent = window.localStorage.getItem(parentSessionKey);
    const storedClub = window.localStorage.getItem(clubSessionKey) === "true";
    if (storedParent) {
      applyParentSession(JSON.parse(storedParent) as ParentAccount);
      setMode("parent");
    }
    if (storedClub) {
      setClubAuthenticated(true);
      setMode("club");
    }
    loadAll();
    const interval = window.setInterval(loadAll, 30000);
    const clock = window.setInterval(() => setCurrentTime(new Date()), 60000);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(clock);
    };
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

      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Rising Stars World</p>
            <h1>
              {mode === "parent"
                ? copy(language, "Parent booking", "家长预约课程")
                : copy(language, "Club dashboard", "俱乐部确认课程")}
            </h1>
            <p className="screen-subtitle">
              {mode === "parent"
                ? copy(language, "Request classes and manage your schedule.", "预约课程并管理时间。")
                : copy(language, "Confirm requests and manage classes.", "确认请求并管理课程。")}
            </p>
          </div>
          <div className="top-actions">
            <div className="mode-switch language-switch" aria-label="Language">
              <button className={language === "en" ? "selected" : ""} onClick={() => setLanguage("en")}>
                Eng
              </button>
              <button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}>
                中文
              </button>
            </div>
            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
            </button>
            {mode === "parent" && parentSession ? (
              <button
                className="filter-button"
                onClick={() => {
                  setParentSession(null);
                  window.localStorage.removeItem(parentSessionKey);
                  setMode("parent");
                }}
              >
                <LogOut size={17} />
                {copy(language, "Logout", "退出")}
              </button>
            ) : null}
            {mode === "club" && clubAuthenticated ? (
              <button
                className="filter-button"
                onClick={() => {
                  setClubAuthenticated(false);
                  window.localStorage.removeItem(clubSessionKey);
                  setMode("parent");
                }}
              >
                <LogOut size={17} />
                {copy(language, "Logout", "退出")}
              </button>
            ) : null}
          </div>
        </header>

        {!parentSession && !clubAuthenticated ? (
          <UnifiedAuth
            initialAuthMode="login"
            intent="parent"
            language={language}
            onRegister={registerParent}
            onLogin={loginUnified}
            onRequestPasswordReset={requestPasswordReset}
            onUpdatePassword={updatePassword}
          />
        ) : mode === "parent" && parentSession?.profileSetupRequired ? (
          <FirstLoginSetup
            account={parentSession}
            language={language}
            onComplete={completeFirstLoginSetup}
            onLogout={() => {
              setParentSession(null);
              window.localStorage.removeItem(parentSessionKey);
              setMode("parent");
            }}
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
            selectedSlots={selectedSlots}
            selectedDurationMinutes={selectedDurationMinutes}
            calendarDays={calendarDays}
            currentTime={currentTime}
            weekLabel={weekLabel(calendarDays, language)}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            saving={saving}
            language={language}
            onStudentNameChange={(value) => {
              setStudentName(value);
              setFamilyName(value);
            }}
            onStudentEmailChange={setStudentEmail}
            onPhoneChange={setPhone}
            onCoachChange={setRequestedCoach}
            onSlotChange={(slot) => {
              selectSingleSlot(slot);
              setShowRequestConfirm(true);
            }}
            onDurationChange={setSelectedDurationMinutes}
            onPreviousWeek={() => setVisibleWeekStart((week) => addDays(week, -7))}
            onNextWeek={() => setVisibleWeekStart((week) => addDays(week, 7))}
            onToday={() => {
              setVisibleWeekStart(initialWeekStart);
              replaceSelectedSlot(initialCalendarSlot);
            }}
            onChangeRequest={(booking) => {
              updateBooking(booking.id, "change_requested", requestedCoach, {
                dateLabel: selectedSlot.dateLabel,
                timeLabel: rangeLabel(selectedSlot, selectedDurationMinutes),
                startsAt: selectedSlot.startsAt,
                parentNote: isMoreThan12HoursBeforeClass(booking)
                  ? `${copy(language, "Parent requested change from", "家长申请改期，原时间")} ${booking.dateLabel} ${booking.timeLabel}`
                  : `${copy(language, "Late change request from", "12小时内改期请求，原时间")} ${booking.dateLabel} ${booking.timeLabel}`
              });
            }}
            onCancel={(booking) => {
              if (!isMoreThan12HoursBeforeClass(booking)) {
                updateBooking(booking.id, "change_requested", booking.assignedCoach, {
                  dateLabel: booking.dateLabel,
                  timeLabel: booking.timeLabel,
                  startsAt: booking.startsAt,
                  parentNote: `${copy(language, "Late cancellation request for", "12小时内取消请求")} ${booking.dateLabel} ${booking.timeLabel}`
                });
                return;
              }
              updateBooking(booking.id, "cancelled");
            }}
            onComplete={completeParentClass}
          />
        ) : (
          <ClubAppView
            bookings={bookings}
            students={students}
            selectedSlot={selectedSlot}
            selectedSlots={selectedSlots}
            selectedDurationMinutes={selectedDurationMinutes}
            calendarDays={calendarDays}
            currentTime={currentTime}
            weekLabel={weekLabel(calendarDays, language)}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            notice={notice}
            requestedCoach={requestedCoach}
            activeCalendarTab={clubCalendarTab}
            saving={saving}
            language={language}
            onSlotChange={selectSingleSlot}
            onDurationChange={setSelectedDurationMinutes}
            onCalendarTabChange={setClubCalendarTab}
            onPreviousWeek={() => setVisibleWeekStart((week) => addDays(week, -7))}
            onNextWeek={() => setVisibleWeekStart((week) => addDays(week, 7))}
            onToday={() => {
              setVisibleWeekStart(initialWeekStart);
              replaceSelectedSlot(initialCalendarSlot);
            }}
            onConfirm={(booking, coach) => updateBooking(booking.id, "club_confirmed", coach)}
            onApproveCancel={(booking) => updateBooking(booking.id, "cancelled", booking.assignedCoach)}
            onCancelClass={(booking) => updateBooking(booking.id, "cancelled", booking.assignedCoach)}
            onCoachComplete={(booking) => updateBooking(booking.id, "coach_confirmed", booking.assignedCoach)}
            onUpdateClassTime={(booking, slot, durationMinutes) =>
              updateBooking(booking.id, "club_confirmed", booking.assignedCoach, {
                dateLabel: slot.dateLabel,
                timeLabel: rangeLabel(slot, durationMinutes),
                startsAt: slot.startsAt
              })
            }
            onAddClass={addClubClass}
            onAddTryoutClass={addClubTryoutClass}
            onBlockTime={blockCoachTime}
          />
        )}
        {showRequestConfirm ? (
          <ConfirmRequestModal
            language={language}
            studentName={studentName}
            coach={requestedCoach}
            slot={selectedSlot}
            durationMinutes={selectedDurationMinutes}
            unavailable={isRangeUnavailable(bookings, requestedCoach, selectedSlot, selectedDurationMinutes)}
            recurring={false}
            recurringWeeks={1}
            saving={saving}
            onDurationChange={setSelectedDurationMinutes}
            onCancel={() => setShowRequestConfirm(false)}
            onConfirm={async () => {
              await requestBooking();
              setShowRequestConfirm(false);
            }}
          />
        ) : null}
      </section>
    </main>
  );
}

function UnifiedAuth({
  initialAuthMode,
  intent,
  language,
  onRegister,
  onLogin,
  onRequestPasswordReset,
  onUpdatePassword
}: {
  initialAuthMode: "login" | "register";
  intent: "parent" | "club";
  language: Language;
  onRegister: (input: { studentName: string; email: string; phone: string; password: string }) => Promise<void>;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onRequestPasswordReset: (email: string) => Promise<void>;
  onUpdatePassword: (password: string) => Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<AuthMode>(initialAuthMode);
  const [studentName, setStudentName] = useState("Ethan Chen");
  const [email, setEmail] = useState("parent@example.com");
  const [phone, setPhone] = useState("(650) 555-0188");
  const [password, setPassword] = useState(intent === "club" ? clubPassword : "parent123");
  const [newPassword, setNewPassword] = useState("");
  const [identifier, setIdentifier] = useState(intent === "club" ? clubEmail : "Ethan Chen");
  const [notice, setNotice] = useState(
    intent === "club"
      ? copy(language, "Club login opens the dashboard.", "俱乐部登录会直接进入管理界面。")
      : copy(language, "Login with username and password.", "请用用户名和密码登录。")
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const isRecoveryLink =
      window.location.hash.includes("type=recovery") || window.location.search.includes("type=recovery");
    setAuthMode(isRecoveryLink && intent === "parent" ? "updatePassword" : initialAuthMode);
    if (intent === "club") {
      setIdentifier(clubEmail);
      setPassword(clubPassword);
      setNotice(copy(language, "Club login opens the dashboard.", "俱乐部登录会直接进入管理界面。"));
    }
  }, [initialAuthMode, intent]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && intent === "parent") {
        setAuthMode("updatePassword");
        setNotice(copy(language, "Enter a new password.", "请输入新密码。"));
      }
    });
    return () => data.subscription.unsubscribe();
  }, [intent]);

  async function handleRegister() {
    setBusy(true);
    try {
      await onRegister({ studentName, email, phone, password });
      setNotice(copy(language, "Registration complete.", "注册完成。"));
    } catch {
      setNotice(copy(language, "Registration failed.", "注册失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setBusy(true);
    try {
      await onLogin(identifier, password);
      setNotice(copy(language, "Login successful.", "登录成功。"));
    } catch {
      setNotice(copy(language, "Login failed.", "登录失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetRequest() {
    setBusy(true);
    try {
      await onRequestPasswordReset(email);
      setNotice(copy(language, "Password reset email sent. Check the Supabase email.", "重置邮件已发送。请查看 Supabase 邮件。"));
    } catch {
      setNotice(copy(language, "Could not send password reset email.", "无法发送重置邮件。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdatePassword() {
    setBusy(true);
    try {
      await onUpdatePassword(newPassword);
      setNewPassword("");
      setAuthMode("login");
      setNotice(copy(language, "Password updated. You can log in with the new password.", "密码已更新。请用新密码登录。"));
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch {
      setNotice(copy(language, "Could not update password. Open the latest reset link and try again.", "无法更新密码。请打开最新重置链接再试。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-panel">
      <div className="auth-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">{intent === "club" ? "Club App" : "Parent App"}</p>
            <h2>{intent === "club" ? copy(language, "Club login", "俱乐部登录") : copy(language, "Login", "登录")}</h2>
            <p className="section-subtitle">
              {intent === "club"
                ? copy(language, "Club manager login opens the club app.", "俱乐部输入管理邮箱后进入 Club 界面。")
                : copy(language, "Parents book classes. Club preset email/password opens the club view.", "家长预约课程。Club 预设邮箱和密码进入俱乐部界面。")}
            </p>
          </div>
        </div>

        {intent === "parent" ? (
          <div className="mode-switch auth-switch">
            <button type="button" className={authMode === "login" ? "selected" : ""} onClick={() => setAuthMode("login")}>
              {copy(language, "Login", "登录")}
            </button>
            <button type="button" className={authMode === "register" ? "selected" : ""} onClick={() => setAuthMode("register")}>
              {copy(language, "Register", "注册")}
            </button>
          </div>
        ) : null}

        {authMode === "register" && intent === "parent" ? (
          <div className="simple-form auth-form">
            <label>
              <span>{copy(language, "Student name", "学生名字")}</span>
              <div className="input-shell">
                <UserRound size={18} />
                <input value={studentName} onChange={(event) => setStudentName(event.target.value)} />
              </div>
            </label>
            <label>
              <span>{copy(language, "Email", "邮箱")}</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
            </label>
            <label>
              <span>{copy(language, "Phone", "电话")}</span>
              <div className="input-shell">
                <Phone size={18} />
                <input value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
            </label>
            <label>
              <span>{copy(language, "Password", "密码")}</span>
              <PasswordField value={password} onChange={setPassword} />
            </label>
            <button type="button" className="primary-button auth-submit" disabled={busy} onClick={handleRegister}>
              <UserPlus size={18} />
              {copy(language, "Register", "注册")}
            </button>
          </div>
        ) : null}

        {authMode === "login" ? (
          <div className="simple-form auth-form">
            <label>
              <span>{intent === "club" ? copy(language, "Club email", "俱乐部邮箱") : copy(language, "Username", "用户名")}</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
              </div>
            </label>
            <label>
              <span>{copy(language, "Password", "密码")}</span>
              <PasswordField value={password} onChange={setPassword} />
            </label>
            <button type="button" className="primary-button auth-submit" disabled={busy} onClick={handleLogin}>
              <LogIn size={18} />
              {copy(language, "Login", "登录")}
            </button>
            {intent === "parent" ? (
              <button type="button" className="text-button auth-submit" disabled={busy} onClick={() => setAuthMode("forgot")}>
                {copy(language, "Forgot password?", "忘记密码？")}
              </button>
            ) : null}
            <p className="helper-line">
              {intent === "club"
                ? copy(language, "Login opens Club App.", "登录后进入 Club App。")
                : copy(language, "For preregistered students, username is the student name from the roster.", "预注册学生的用户名就是名单里的学生名字。")}
            </p>
          </div>
        ) : null}

        {authMode === "forgot" && intent === "parent" ? (
          <div className="simple-form auth-form">
            <label>
              <span>{copy(language, "Email", "邮箱")}</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
            </label>
            <button type="button" className="primary-button auth-submit" disabled={busy} onClick={handleResetRequest}>
              <Mail size={18} />
              {copy(language, "Send reset email", "发送重置邮件")}
            </button>
            <button type="button" className="text-button auth-submit" disabled={busy} onClick={() => setAuthMode("login")}>
              {copy(language, "Back to login", "返回登录")}
            </button>
            <p className="helper-line">{copy(language, "MVP can use the default Supabase email. Production needs custom SMTP in Supabase Auth.", "MVP 可以使用 Supabase 默认邮件；生产环境需要在 Supabase Auth 配置 custom SMTP。")}</p>
          </div>
        ) : null}

        {authMode === "updatePassword" && intent === "parent" ? (
          <div className="simple-form auth-form">
            <label>
              <span>{copy(language, "New password", "新密码")}</span>
              <PasswordField value={newPassword} onChange={setNewPassword} />
            </label>
            <button type="button" className="primary-button auth-submit" disabled={busy || newPassword.length < 6} onClick={handleUpdatePassword}>
              <KeyRound size={18} />
              {copy(language, "Update password", "更新密码")}
            </button>
            <p className="helper-line">{copy(language, "Open this page from the latest Supabase reset email.", "请从最新的 Supabase 重置邮件打开这个页面。")}</p>
          </div>
        ) : null}

        <p className="system-note">{notice}</p>
      </div>
    </section>
  );
}

function FirstLoginSetup({
  account,
  language,
  onComplete,
  onLogout
}: {
  account: ParentAccount;
  language: Language;
  onComplete: (input: { email: string; phone: string; password: string }) => Promise<void>;
  onLogout: () => void;
}) {
  const [email, setEmail] = useState(account.email);
  const [phone, setPhone] = useState(account.phone);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState(copy(language, "Please finish setup before opening the dashboard.", "请先完成资料设置，才能进入主页。"));
  const [busy, setBusy] = useState(false);
  const emailReady = email.trim().includes("@");
  const phoneReady = phone.trim().replace(/\D/g, "").length >= 7;
  const passwordReady = password.length >= 6 && password !== preregisteredPasswordTemplate && password === confirmPassword;
  const ready = emailReady && phoneReady && passwordReady;

  async function handleComplete() {
    if (!ready) {
      setNotice(copy(language, "Email, phone, and matching new password are required.", "必须填写邮箱、电话，并输入一致的新密码。"));
      return;
    }
    setBusy(true);
    try {
      await onComplete({ email, phone, password });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : copy(language, "Could not save profile setup.", "无法保存资料设置。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-panel">
      <div className="auth-card setup-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">First login setup</p>
            <h2>{copy(language, "Complete your student account", "完成学生账号设置")}</h2>
            <p className="section-subtitle">
              {copy(
                language,
                `${account.studentName}, update your password and add contact info before using the dashboard.`,
                `${account.studentName}，请先更新密码并填写联系方式，然后才能使用主页。`
              )}
            </p>
          </div>
        </div>
        <div className="setup-lockout">
          {copy(language, "Dashboard is locked until email and phone are filled out.", "填写邮箱和电话前，主页会保持锁定。")}
        </div>
        <div className="simple-form auth-form">
          <label>
            <span>{copy(language, "Student name", "学生名字")}</span>
            <div className="input-shell">
              <UserRound size={18} />
              <input value={account.studentName} readOnly />
            </div>
          </label>
          <label>
            <span>{copy(language, "Email required", "邮箱（必填）")}</span>
            <div className="input-shell">
              <Mail size={18} />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@example.com" />
            </div>
          </label>
          <label>
            <span>{copy(language, "Phone required", "电话（必填）")}</span>
            <div className="input-shell">
              <Phone size={18} />
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(650) 555-0000" />
            </div>
          </label>
          <label>
            <span>{copy(language, "New password", "新密码")}</span>
            <PasswordField value={password} onChange={setPassword} />
          </label>
          <label>
            <span>{copy(language, "Confirm new password", "确认新密码")}</span>
            <PasswordField value={confirmPassword} onChange={setConfirmPassword} />
          </label>
          <button type="button" className="primary-button auth-submit" disabled={busy || !ready} onClick={handleComplete}>
            <Check size={18} />
            {copy(language, "Save and open dashboard", "保存并进入主页")}
          </button>
          <button type="button" className="text-button auth-submit" disabled={busy} onClick={onLogout}>
            {copy(language, "Logout", "退出")}
          </button>
          <p className="helper-line">{copy(language, "Password must be at least 6 characters and cannot stay as the temporary password.", "密码至少 6 位，不能继续使用临时密码。")}</p>
        </div>
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
  selectedSlots,
  selectedDurationMinutes,
  calendarDays,
  currentTime,
  weekLabel,
  canGoPrevious,
  canGoNext,
  saving,
  language,
  onStudentNameChange,
  onStudentEmailChange,
  onPhoneChange,
  onCoachChange,
  onSlotChange,
  onDurationChange,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onChangeRequest,
  onCancel,
  onComplete
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
  selectedSlots: CalendarSlot[];
  selectedDurationMinutes: number;
  calendarDays: CalendarDay[];
  currentTime: Date;
  weekLabel: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  saving: boolean;
  language: Language;
  onStudentNameChange: (value: string) => void;
  onStudentEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onCoachChange: (value: string) => void;
  onSlotChange: (value: CalendarSlot) => void;
  onDurationChange: (value: number) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onChangeRequest: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  onComplete: (booking: Booking) => void;
}) {
  const [selectedParentBooking, setSelectedParentBooking] = useState<Booking | null>(null);
  return (
    <section className="calendar-first">
      <section className="section-block calendar-core">
        <div className="section-head">
          <div>
            <p className="eyebrow">{copy(language, "Club calendar", "俱乐部日历")}</p>
            <h2>{copy(language, "Select a time and request class", "选择时间并请求上课")}</h2>
            <p className="section-subtitle">{copy(language, "Pick a start time and duration for the selected coach.", "为所选教练选择开始时间和时长。")}</p>
          </div>
          <span className="status-chip good">{bookings.length} {copy(language, "classes", "课程")}</span>
        </div>
        <CalendarControls
          weekLabel={weekLabel}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          language={language}
          onPreviousWeek={onPreviousWeek}
          onNextWeek={onNextWeek}
          onToday={onToday}
        />
        <div className="calendar-tabs" aria-label="Coach calendar views">
          {coaches.map((coach) => (
            <button className={requestedCoach === coach ? "selected" : ""} key={coach} onClick={() => onCoachChange(coach)}>
              {coach.replace("Coach ", "")}
            </button>
          ))}
        </div>
        <div className="calendar-board">
          <ClubCalendar
            bookings={allBookings}
            selectedSlot={selectedSlot}
            selectedSlots={selectedSlots}
            selectionDurationMinutes={selectedDurationMinutes}
            requestedCoach={requestedCoach}
            visibleCoachTab={requestedCoach as ClubCalendarTab}
            calendarDays={calendarDays}
            currentTime={currentTime}
            language={language}
            ownBookings={bookings}
            blockUnavailable
            privacyMode
            onSlotChange={onSlotChange}
            onBookingSelect={setSelectedParentBooking}
          />
        </div>
        <p className="system-note">{notice}</p>
      </section>

      <section className="support-grid">
        <section className="section-block">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy(language, "Student info", "学生资料")}</p>
              <h2>{copy(language, "Basic login info", "基础登录信息")}</h2>
              <p className="section-subtitle">{copy(language, "Email and phone", "邮箱和电话")}</p>
            </div>
          </div>
          <div className="simple-form">
            <label>
              <span>{copy(language, "Student", "学生")}</span>
              <div className="input-shell">
                <UserRound size={18} />
                <input value={studentName} onChange={(event) => onStudentNameChange(event.target.value)} />
              </div>
            </label>
            <label>
              <span>{copy(language, "Email", "邮箱")}</span>
              <div className="input-shell">
                <Mail size={18} />
                <input value={studentEmail} onChange={(event) => onStudentEmailChange(event.target.value)} />
              </div>
            </label>
            <label>
              <span>{copy(language, "Phone", "电话")}</span>
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
              <p className="eyebrow">{copy(language, "My classes", "我的课程")}</p>
              <h2>{copy(language, "Requested, confirmed, completed", "请求、确认、完成")}</h2>
              <p className="section-subtitle">{copy(language, "Cancel more than 12 hours before class. Inside 12 hours sends a club approval request.", "超过 12 小时可取消；12 小时内会发送请求给 club 确认。")}</p>
            </div>
          </div>
          <div className="mini-ledger">
            <div>
              <span>{copy(language, "Requested", "已请求")}</span>
              <strong>{bookings.filter((booking) => booking.status === "requested" || booking.status === "change_requested").length}</strong>
            </div>
            <div>
              <span>{copy(language, "Confirmed", "已确认")}</span>
              <strong>{bookings.filter((booking) => booking.status === "club_confirmed").length}</strong>
            </div>
            <div>
              <span>{copy(language, "Bill", "已计费")}</span>
              <strong>{dollars(completedTotal)}</strong>
            </div>
          </div>
          <BookingList bookings={bookings} parentActions language={language} onChangeRequest={onChangeRequest} onCancel={onCancel} onComplete={onComplete} />
          {selectedParentBooking ? (
            <ParentClassCompleteModal
              booking={selectedParentBooking}
              language={language}
              onClose={() => setSelectedParentBooking(null)}
              onComplete={() => {
                onComplete(selectedParentBooking);
                setSelectedParentBooking(null);
              }}
            />
          ) : null}
        </section>
      </section>
    </section>
  );
}

function CalendarControls({
  weekLabel,
  canGoPrevious,
  canGoNext,
  language,
  onPreviousWeek,
  onNextWeek,
  onToday
}: {
  weekLabel: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  language: Language;
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
        <span>{copy(language, "3 months back through Dec 31", "前三个月 - 到12月31日")}</span>
      </div>
      <button className="filter-button" onClick={onToday}>
        {copy(language, "Today", "今天")}
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
  selectedSlots,
  selectionDurationMinutes,
  requestedCoach,
  visibleCoachTab = "Combined",
  calendarDays,
  currentTime,
  language,
  ownBookings = [],
  blockUnavailable = false,
  privacyMode = false,
  onSlotChange,
  onBookingSelect
}: {
  bookings: Booking[];
  selectedSlot: CalendarSlot;
  selectedSlots: CalendarSlot[];
  selectionDurationMinutes: number;
  requestedCoach: string;
  visibleCoachTab?: ClubCalendarTab;
  calendarDays: CalendarDay[];
  currentTime: Date;
  language: Language;
  ownBookings?: Booking[];
  blockUnavailable?: boolean;
  privacyMode?: boolean;
  onSlotChange: (value: CalendarSlot) => void;
  onBookingSelect?: (booking: Booking) => void;
}) {
  const ownBookingIds = new Set(ownBookings.map((booking) => booking.id));
  return (
    <div className="week-calendar" aria-label="Club calendar view">
      <div className="calendar-corner" aria-hidden="true" />
      {calendarDays.map((day) => (
        <div className={day.isToday ? "calendar-day-head today" : "calendar-day-head"} key={day.dateLabel}>
          <span className="day-zh">{copy(language, day.day, day.dayZh)}</span>
          <strong>{day.dateNumber}</strong>
          <span>{copy(language, day.monthLabel, day.dateZh)}</span>
        </div>
      ))}

      {calendarTimes.map((timeLabel) => (
        <Fragment key={timeLabel}>
          <div className="calendar-time" key={`${timeLabel}-label`}>
            <strong>{timeLabel}</strong>
          </div>
          {calendarDays.map((day) => {
            const startsAt = makeStartsAt(day.date, timeLabel);
            const [startHour, startMinute] = parseClockLabel(timeLabel);
            const nextTime = calendarTimes[calendarTimes.indexOf(timeLabel) + 1];
            const [nextHour, nextMinute] = nextTime ? parseClockLabel(nextTime) : [startHour + 1, startMinute];
            const cellStart = new Date(startsAt);
            const cellEnd = addMinutes(cellStart, (nextHour * 60 + nextMinute) - (startHour * 60 + startMinute));
            const slotBookings = bookings.filter((booking) => {
              if (booking.status === "cancelled") return false;
              const matchesCoach =
                visibleCoachTab === "Combined" || booking.assignedCoach === visibleCoachTab || booking.requestedCoach === visibleCoachTab;
              const bookingStart = new Date(booking.startsAt);
              return bookingStart >= cellStart && bookingStart < cellEnd && (matchesCoach || ownBookingIds.has(booking.id));
            });
            const overlappingBookings = bookings.filter((booking) => {
              if (booking.status === "cancelled") return false;
              return (
                bookingMatchesCoach(booking, requestedCoach) &&
                rangesOverlap(
                  new Date(startsAt),
                  addMinutes(new Date(startsAt), selectionDurationMinutes),
                  new Date(booking.startsAt),
                  bookingEndDate(booking)
                )
              );
            });
            const selectableBooking = slotBookings.find((booking) => booking.status !== "cancelled");
            const slot = makeCalendarSlot(day, timeLabel);
            const hasVisibleBooking = slotBookings.length > 0;
            const selected = !hasVisibleBooking && selectedSlots.some((item) => item.startsAt === startsAt);
            const unavailableBookings = overlappingBookings.filter((booking) => !ownBookingIds.has(booking.id));
            const unavailableDisplayBooking = unavailableBookings.find((booking) => booking.startsAt === startsAt);
            const blockedUnavailable = unavailableDisplayBooking && isBlockedTime(unavailableDisplayBooking) ? unavailableDisplayBooking : undefined;
            const unavailable = blockUnavailable && unavailableBookings.length > 0;
            const useCoachLanes = visibleCoachTab === "Combined" && slotBookings.length > 1;
            const actionable = Boolean(onBookingSelect && selectableBooking && !useCoachLanes);
            const startTotal = startHour * 60 + startMinute;
            const endTotal = nextHour * 60 + nextMinute;
            const currentTotal = currentTime.getHours() * 60 + currentTime.getMinutes();
            const showCurrentTime = day.isToday && currentTotal >= startTotal && currentTotal < endTotal;
            const currentTimeTop = `${((currentTotal - startTotal) / (endTotal - startTotal)) * 100}%`;
            return (
              <button
                className={[
                  "calendar-cell",
                  selected || slotBookings.length > 0 || unavailableDisplayBooking ? "has-event" : "",
                  selected ? "selected" : "",
                  unavailable ? "unavailable" : "",
                  actionable ? "actionable" : ""
                ].filter(Boolean).join(" ")}
                key={startsAt}
                disabled={unavailable && !actionable}
                onClick={() => {
                  if (unavailable && !actionable) return;
                  if (useCoachLanes) return;
                  if (onBookingSelect && selectableBooking) {
                    onBookingSelect(selectableBooking);
                    return;
                  }
                  onSlotChange(slot);
                }}
              >
                {showCurrentTime ? (
                  <span className="current-time-line" style={{ top: currentTimeTop }}>
                    <span>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(currentTime)}</span>
                  </span>
                ) : null}
                {privacyMode && unavailableDisplayBooking ? (
                  <span className="calendar-booking unavailable-private spanning-event" style={calendarEventStyle(unavailableDisplayBooking, false, cellStart)}>
                    <strong>{blockedUnavailable ? copy(language, "Not working", "不可用") : copy(language, "Not available", "不可预约")}</strong>
                    <small>{blockedUnavailable ? compactTimeRange(blockedUnavailable.timeLabel) : compactTimeRange(unavailableDisplayBooking.timeLabel)}</small>
                  </span>
                ) : slotBookings.length === 0 ? (
                  <span className="open-slot" aria-hidden="true" />
                ) : (
                  [...slotBookings]
                    .sort(
                      (left, right) => coachLaneIndex(left) - coachLaneIndex(right)
                    )
                    .map((booking) => (
                    <span
                      className={`calendar-booking ${booking.status}${isBlockedTime(booking) ? " blocked-time" : ""}${useCoachLanes ? " coach-lane" : ""} spanning-event`}
                      key={booking.id}
                      style={calendarEventStyle(booking, useCoachLanes, cellStart)}
                      onClick={(event) => {
                        if (!onBookingSelect) return;
                        event.stopPropagation();
                        onBookingSelect(booking);
                      }}
                    >
                      <strong>{isBlockedTime(booking) ? copy(language, "Not working", "不可用") : booking.studentName}</strong>
                      <small>{isBlockedTime(booking) ? compactTimeRange(booking.timeLabel) : compactTimeRange(booking.timeLabel)}</small>
                      <em>{isBlockedTime(booking) ? copy(language, "Blocked time", "不可预约时间") : statusText(booking.status, language)}</em>
                    </span>
                  ))
                )}
                {selected && slotBookings.length === 0 && !unavailableDisplayBooking ? (
                  <span className="selected-label spanning-event" style={eventHeightStyle(selectionDurationMinutes / 60)}>
                    <strong>{compactRangeLabel(slot, selectionDurationMinutes)}</strong>
                  </span>
                ) : null}
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
  students,
  selectedSlot,
  selectedSlots,
  selectedDurationMinutes,
  calendarDays,
  currentTime,
  weekLabel,
  canGoPrevious,
  canGoNext,
  notice,
  requestedCoach,
  activeCalendarTab,
  saving,
  language,
  onSlotChange,
  onDurationChange,
  onCalendarTabChange,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onConfirm,
  onApproveCancel,
  onCancelClass,
  onCoachComplete,
  onUpdateClassTime,
  onAddClass,
  onAddTryoutClass,
  onBlockTime
}: {
  bookings: Booking[];
  students: ParentAccount[];
  selectedSlot: CalendarSlot;
  selectedSlots: CalendarSlot[];
  selectedDurationMinutes: number;
  calendarDays: CalendarDay[];
  currentTime: Date;
  weekLabel: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  notice: string;
  requestedCoach: string;
  activeCalendarTab: ClubCalendarTab;
  saving: boolean;
  language: Language;
  onSlotChange: (value: CalendarSlot) => void;
  onDurationChange: (value: number) => void;
  onCalendarTabChange: (value: ClubCalendarTab) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onConfirm: (booking: Booking, coach: string) => void;
  onApproveCancel: (booking: Booking) => void;
  onCancelClass: (booking: Booking) => void;
  onCoachComplete: (booking: Booking) => void;
  onUpdateClassTime: (booking: Booking, slot: CalendarSlot, durationMinutes: number) => void;
  onAddClass: (student: ParentAccount, coach: string, slots: CalendarSlot[], durationMinutes: number) => Promise<void>;
  onAddTryoutClass: (input: { studentName: string; phone: string; note: string }, coach: string, slots: CalendarSlot[], durationMinutes: number) => Promise<void>;
  onBlockTime: (coach: string, slots: CalendarSlot[], durationMinutes: number) => Promise<void>;
}) {
  const defaultExportStart = dateInputValue(startOfWeek(selectedSlot.date));
  const defaultExportEnd = dateInputValue(addDays(startOfWeek(selectedSlot.date), 6));
  const [exportStartDate, setExportStartDate] = useState(defaultExportStart);
  const [exportEndDate, setExportEndDate] = useState(defaultExportEnd);
  const [studentQuery, setStudentQuery] = useState("");
  const [addCoach, setAddCoach] = useState<string>(activeCalendarTab === "Combined" ? coaches[0] : activeCalendarTab);
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [selectedAddStudent, setSelectedAddStudent] = useState<ParentAccount | null>(null);
  const [selectedClubBooking, setSelectedClubBooking] = useState<Booking | null>(null);
  const visibleBookings = bookings.filter((booking) => activeCalendarTab === "Combined" || bookingMatchesCoach(booking, activeCalendarTab));
  const requested = visibleBookings.filter((booking) => !isBlockedTime(booking) && (booking.status === "requested" || booking.status === "change_requested"));
  const confirmed = visibleBookings.filter((booking) => booking.status === "club_confirmed" && !isBlockedTime(booking));
  const studentDirectory = useMemo(() => {
    const byKey = new Map<string, ParentAccount>();
    for (const student of students) {
      byKey.set(student.email || student.phone || student.id, student);
    }
    for (const booking of bookings) {
      const key = booking.studentEmail || booking.phone || booking.studentName;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        id: key,
        studentName: booking.studentName,
        email: booking.studentEmail,
        phone: booking.phone,
        confirmed: true,
        profileSetupRequired: false,
        createdAt: booking.createdAt
      });
    }
    return [...byKey.values()].sort((left, right) => left.studentName.localeCompare(right.studentName));
  }, [bookings, students]);
  const filteredStudents = studentDirectory.filter((student) => {
    const query = studentQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      student.studentName.toLowerCase().includes(query) ||
      student.email.toLowerCase().includes(query) ||
      student.phone.toLowerCase().includes(query)
    );
  });

  useEffect(() => {
    if (activeCalendarTab !== "Combined") {
      setAddCoach(activeCalendarTab);
    }
  }, [activeCalendarTab]);

  function exportClassReport() {
    const periodStart = dateFromInputValue(exportStartDate);
    const periodEnd = endOfDay(dateFromInputValue(exportEndDate));
    const periodTitle = `${dateLabel(periodStart)} - ${dateLabel(periodEnd)}`;

    const inPeriod = bookings.filter((booking) => {
      const startsAt = new Date(booking.startsAt);
      return (
        startsAt >= periodStart &&
        startsAt <= periodEnd &&
        !isBlockedTime(booking) &&
        (booking.status === "club_confirmed" || booking.status === "coach_confirmed")
      );
    });

    const studentsByKey = new Map<
      string,
      {
        studentName: string;
        bookings: Booking[];
      }
    >();

    for (const booking of inPeriod) {
      const key = `${booking.studentName}|${booking.studentEmail}|${booking.phone}`;
      const existing =
        studentsByKey.get(key) ??
        {
          studentName: booking.studentName,
          bookings: []
        };

      existing.bookings.push(booking);
      studentsByKey.set(key, existing);
    }

    const summaryRows = [
      ["Student", "Confirmed not completed", "Coach completed", "Total classes", "Completed amount"],
      ...[...studentsByKey.values()]
        .sort((left, right) => left.studentName.localeCompare(right.studentName))
        .map((student) => {
          const confirmedCount = student.bookings.filter((booking) => booking.status === "club_confirmed").length;
          const completed = student.bookings.filter((booking) => booking.status === "coach_confirmed");
          return [
            student.studentName,
            confirmedCount,
            completed.length,
            student.bookings.length,
            dollars(completed.reduce((sum, booking) => sum + booking.priceCents, 0))
          ];
        })
    ];

    const studentDetailRows = [...studentsByKey.values()]
      .sort((left, right) => left.studentName.localeCompare(right.studentName))
      .flatMap((student) => {
        const completed = student.bookings.filter((booking) => booking.status === "coach_confirmed");
        const rows = [
          [],
          ["========================================"],
          [`STUDENT: ${student.studentName}`],
          ["========================================"],
          ["Date", "Time", "Coach", "Status", "Price", "Parent note"],
          ...student.bookings
            .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
            .map((booking) => [
              booking.dateLabel,
              booking.timeLabel,
              booking.assignedCoach,
              statusText(booking.status),
              dollars(booking.priceCents),
              booking.parentNote
            ]),
          ["Student total", "", "", "", dollars(completed.reduce((sum, booking) => sum + booking.priceCents, 0)), ""]
        ];
        return rows;
      });

    const csv = [
      ["RSWTTA class report", periodTitle],
      ["Date range", `${exportStartDate} to ${exportEndDate}`],
      [],
      ["Student summary"],
      ...summaryRows,
      [],
      ["Class details by student"],
      ...studentDetailRows
    ]
      .map((row) => row.map((cell) => csvValue(cell)).join(","))
      .join("\n");

    downloadTextFile(`rswtta-classes-${exportStartDate}-to-${exportEndDate}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
  }

  return (
    <section className="calendar-first">
      <section className="section-block calendar-core">
        <div className="section-head">
          <div>
            <p className="eyebrow">{copy(language, "Club calendar", "俱乐部日历")}</p>
            <h2>{copy(language, "Confirm requests and manage classes", "确认请求并管理课程")}</h2>
            <p className="section-subtitle">{copy(language, "Click one or more blocks, then add a student or confirm requests.", "点击一个或多个时间段，然后添加学生或确认请求。")}</p>
          </div>
          <span className="status-chip">{requested.length} {copy(language, "pending", "待确认")}</span>
        </div>
        <CalendarControls
          weekLabel={weekLabel}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          language={language}
          onPreviousWeek={onPreviousWeek}
          onNextWeek={onNextWeek}
          onToday={onToday}
        />
        <div className="calendar-tabs" aria-label="Coach calendar views">
          {clubCalendarTabs.map((tab) => (
            <button className={activeCalendarTab === tab ? "selected" : ""} key={tab} onClick={() => onCalendarTabChange(tab)}>
              {coachTabText(tab, language)}
            </button>
          ))}
        </div>
        <div className="calendar-board">
          <ClubCalendar
            bookings={bookings}
            selectedSlot={selectedSlot}
            selectedSlots={selectedSlots}
            selectionDurationMinutes={selectedDurationMinutes}
            requestedCoach={requestedCoach}
            visibleCoachTab={activeCalendarTab}
            calendarDays={calendarDays}
            currentTime={currentTime}
            language={language}
            onSlotChange={(slot) => {
              onSlotChange(slot);
              if (activeCalendarTab !== "Combined") {
                setAddCoach(activeCalendarTab);
              }
              setShowAddClassModal(true);
            }}
            onBookingSelect={setSelectedClubBooking}
          />
        </div>
        <p className="system-note">{notice}</p>
      </section>

      <section className="support-grid">
        <section className="section-block support-export">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy(language, "Export", "下载表格")}</p>
              <h2>{copy(language, "Download student class details", "下载学生课程明细")}</h2>
              <p className="section-subtitle">{copy(language, "Confirmed and coach-completed classes grouped by student.", "按学生分组导出已确认和已完成课程。")}</p>
            </div>
          </div>
          <div className="export-panel">
            <div className="export-date-grid">
              <label>
                <span>{copy(language, "Start", "开始")}</span>
                <input className="modal-input" type="date" value={exportStartDate} onChange={(event) => setExportStartDate(event.target.value)} />
              </label>
              <label>
                <span>{copy(language, "End", "结束")}</span>
                <input className="modal-input" type="date" value={exportEndDate} onChange={(event) => setExportEndDate(event.target.value)} />
              </label>
            </div>
            <button className="primary-button wide-button" onClick={exportClassReport}>
              <Download size={18} />
              {copy(language, "Download CSV", "下载 CSV")}
            </button>
          </div>
        </section>

        <section className="section-block support-requests">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy(language, "Requests", "待确认")}</p>
              <h2>{copy(language, "Confirm time and coach", "确认时间和教练")}</h2>
              <p className="section-subtitle">{copy(language, "Confirm class time and coach", "确认上课时间和教练")}</p>
            </div>
          </div>
          <div className="request-stack">
            {requested.map((booking) => (
              <article className="flow-card" key={booking.id}>
                <div>
                  <span className={`status-chip ${booking.status}`}>{statusText(booking.status, language)}</span>
                  <h3>{booking.studentName}</h3>
                  <p>
                    {copy(language, "Wants", "请求")} {booking.requestedCoach}: {booking.dateLabel} {booking.timeLabel}
                  </p>
                  {booking.parentNote ? <p>{booking.parentNote}</p> : null}
                </div>
                {isCancellationRequest(booking) ? (
                  <button className="decline" onClick={() => onApproveCancel(booking)}>
                    <X size={17} />
                    {copy(language, "Approve cancel", "批准取消")}
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

        <section className="section-block support-complete">
          <div className="section-head">
            <div>
              <p className="eyebrow">{copy(language, "Coach complete", "教练完成")}</p>
              <h2>{copy(language, "Complete from calendar", "从日历点击完成")}</h2>
              <p className="section-subtitle">{copy(language, "Confirmed classes can be completed directly from the calendar.", "已确认课程可直接在日历完成。")}</p>
            </div>
            <span className="status-chip good">{confirmed.length} {copy(language, "ready", "可完成")}</span>
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
                  {copy(language, "Complete", "完成")}
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>
      {showAddClassModal ? (
        <ClubAddClassModal
          language={language}
          students={filteredStudents}
          studentQuery={studentQuery}
          selectedStudent={selectedAddStudent}
          coach={addCoach}
          slot={selectedSlot}
          durationMinutes={selectedDurationMinutes}
          unavailable={isRangeUnavailable(bookings, addCoach, selectedSlot, selectedDurationMinutes)}
          saving={saving}
          onCoachChange={setAddCoach}
          onDurationChange={onDurationChange}
          onStudentQueryChange={setStudentQuery}
          onStudentSelect={setSelectedAddStudent}
          onCancel={() => setShowAddClassModal(false)}
          onConfirm={async (durationMinutes, recurring, weeks) => {
            const slots = recurring ? repeatedCalendarSlots(selectedSlot, weeks) : [selectedSlot];
            if (selectedAddStudent) {
              await onAddClass(selectedAddStudent, addCoach, slots, durationMinutes);
            }
            setShowAddClassModal(false);
            setSelectedAddStudent(null);
            setStudentQuery("");
          }}
          onTryoutConfirm={async (input, durationMinutes, recurring, weeks) => {
            await onAddTryoutClass(input, addCoach, recurring ? repeatedCalendarSlots(selectedSlot, weeks) : [selectedSlot], durationMinutes);
            setShowAddClassModal(false);
            setSelectedAddStudent(null);
            setStudentQuery("");
          }}
          onBlockTime={async (durationMinutes, recurring, weeks) => {
            await onBlockTime(addCoach, recurring ? repeatedCalendarSlots(selectedSlot, weeks) : [selectedSlot], durationMinutes);
            setShowAddClassModal(false);
            setSelectedAddStudent(null);
            setStudentQuery("");
          }}
        />
      ) : null}
      {selectedClubBooking ? (
        <ClubBookingActionModal
          booking={selectedClubBooking}
          bookings={bookings}
          language={language}
          onClose={() => setSelectedClubBooking(null)}
          onCancel={() => {
            onCancelClass(selectedClubBooking);
            setSelectedClubBooking(null);
          }}
          onComplete={
            selectedClubBooking.status === "club_confirmed"
              ? () => {
                  onCoachComplete(selectedClubBooking);
                  setSelectedClubBooking(null);
                }
              : undefined
          }
          onUpdateTime={(slot, durationMinutes) => {
            onUpdateClassTime(selectedClubBooking, slot, durationMinutes);
            setSelectedClubBooking(null);
          }}
        />
      ) : null}
    </section>
  );
}

function ClubAddClassModal({
  language,
  students,
  studentQuery,
  selectedStudent,
  coach,
  slot,
  durationMinutes,
  unavailable,
  saving,
  onCoachChange,
  onDurationChange,
  onStudentQueryChange,
  onStudentSelect,
  onCancel,
  onConfirm,
  onTryoutConfirm,
  onBlockTime
}: {
  language: Language;
  students: ParentAccount[];
  studentQuery: string;
  selectedStudent: ParentAccount | null;
  coach: string;
  slot: CalendarSlot;
  durationMinutes: number;
  unavailable: boolean;
  saving: boolean;
  onCoachChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onStudentQueryChange: (value: string) => void;
  onStudentSelect: (value: ParentAccount) => void;
  onCancel: () => void;
  onConfirm: (durationMinutes: number, recurring: boolean, weeks: number) => void;
  onTryoutConfirm: (input: { studentName: string; phone: string; note: string }, durationMinutes: number, recurring: boolean, weeks: number) => void;
  onBlockTime: (durationMinutes: number, recurring: boolean, weeks: number) => void;
}) {
  const [mode, setMode] = useState<"class" | "block">("class");
  const [studentMode, setStudentMode] = useState<"enrolled" | "tryout">("enrolled");
  const [tryoutName, setTryoutName] = useState("");
  const [tryoutPhone, setTryoutPhone] = useState("");
  const [tryoutNote, setTryoutNote] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const canAddClass = studentMode === "enrolled" ? Boolean(selectedStudent) : tryoutName.trim().length > 0;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="club-add-class-title">
        <div className="section-head compact">
          <div>
            <p className="eyebrow">{copy(language, "Add class", "添加课程")}</p>
            <h2 id="club-add-class-title">{copy(language, mode === "class" ? "Add class for student" : "Block coach time", mode === "class" ? "给学生添加课程" : "设置教练不可用")}</h2>
          </div>
        </div>
        <div className="mode-switch modal-mode-switch" aria-label="Club calendar action">
          <button type="button" className={mode === "class" ? "selected" : ""} onClick={() => setMode("class")}>
            {copy(language, "Add class", "添加课程")}
          </button>
          <button type="button" className={mode === "block" ? "selected" : ""} onClick={() => setMode("block")}>
            {copy(language, "Block time", "不可用时间")}
          </button>
        </div>
        <dl className="confirm-summary">
          <div>
            <dt>{copy(language, "Coach", "教练")}</dt>
            <dd>
              <select className="modal-select" value={coach} onChange={(event) => onCoachChange(event.target.value)}>
                {coaches.map((coachOption) => (
                  <option key={coachOption} value={coachOption}>
                    {coachOption}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div>
            <dt>{copy(language, "Date", "日期")}</dt>
            <dd>{slot.dateLabel}</dd>
          </div>
          <div>
            <dt>{copy(language, "Time", "时间")}</dt>
            <dd>{rangeLabel(slot, durationMinutes)}</dd>
          </div>
        </dl>
        {mode === "class" ? (
          <div className="modal-duration-picker">
            <span>{copy(language, "Duration", "时长")}</span>
            <div className="duration-picker" aria-label="Duration">
              {durationOptions.map((minutes) => (
                <button
                  type="button"
                  className={durationMinutes === minutes ? "selected" : ""}
                  key={minutes}
                  onClick={() => onDurationChange(minutes)}
                >
                  {minutes} {copy(language, "min", "分钟")}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label className="modal-duration-picker">
            <span>{copy(language, "End time", "结束时间")}</span>
            <select className="modal-select" value={durationMinutes} onChange={(event) => onDurationChange(Number(event.target.value))}>
              {endTimeOptions(slot).map((option) => (
                <option key={option.duration} value={option.duration}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "class" ? (
          <div className="modal-student-search">
            <div className="mode-switch modal-mode-switch" aria-label="Student type">
              <button type="button" className={studentMode === "enrolled" ? "selected" : ""} onClick={() => setStudentMode("enrolled")}>
                {copy(language, "Enrolled", "已注册")}
              </button>
              <button type="button" className={studentMode === "tryout" ? "selected" : ""} onClick={() => setStudentMode("tryout")}>
                {copy(language, "Tryout", "体验课")}
              </button>
            </div>
            {studentMode === "enrolled" ? (
              <>
            <label>
              <span>{copy(language, "Student", "学生")}</span>
              <div className="input-shell">
                <Search size={18} />
                <input value={studentQuery} onChange={(event) => onStudentQueryChange(event.target.value)} />
              </div>
            </label>
            <div className="student-results modal-results">
              {students.length === 0 ? (
                <p className="empty-state">{copy(language, "No enrolled students found.", "未找到已注册学生。")}</p>
              ) : (
                students.slice(0, 6).map((student) => (
                  <button
                    type="button"
                    className={selectedStudent?.id === student.id ? "student-result selected" : "student-result"}
                    key={student.id}
                    onClick={() => onStudentSelect(student)}
                  >
                    <span>
                      <strong>{student.studentName}</strong>
                      <em>{student.email || student.phone}</em>
                    </span>
                    <Check size={17} />
                  </button>
                ))
              )}
            </div>
              </>
            ) : (
              <div className="tryout-fields">
                <label>
                  <span>{copy(language, "Student name", "学生姓名")}</span>
                  <input value={tryoutName} onChange={(event) => setTryoutName(event.target.value)} />
                </label>
                <label>
                  <span>{copy(language, "Phone", "电话")}</span>
                  <input value={tryoutPhone} onChange={(event) => setTryoutPhone(event.target.value)} />
                </label>
                <label>
                  <span>{copy(language, "Note", "备注")}</span>
                  <textarea value={tryoutNote} onChange={(event) => setTryoutNote(event.target.value)} />
                </label>
              </div>
            )}
          </div>
        ) : (
          <p className="modal-info">{copy(language, "Parents will not be able to book this coach during the selected time.", "家长不能预约该教练这个时间。")}</p>
        )}
        <div className="recurring-row modal-recurring">
          <label>
            <input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} />
            <span>{copy(language, "Weekly recurring", "每周重复")}</span>
          </label>
          <select value={weeks} onChange={(event) => setWeeks(Number(event.target.value))} disabled={!recurring}>
            <option value={4}>{copy(language, "4 weeks", "4 周")}</option>
            <option value={8}>{copy(language, "8 weeks", "8 周")}</option>
            <option value={12}>{copy(language, "12 weeks", "12 周")}</option>
            <option value={24}>{copy(language, "24 weeks", "24 周")}</option>
          </select>
        </div>
        {unavailable ? <p className="modal-warning">{copy(language, "This coach is not available for that duration.", "该教练这个时长不可预约。")}</p> : null}
        <div className="modal-actions">
          <button className="filter-button" onClick={onCancel} disabled={saving}>
            {copy(language, "Cancel", "取消")}
          </button>
          <button
            className="primary-button"
            onClick={() =>
              mode === "block"
                ? onBlockTime(durationMinutes, recurring, weeks)
                : studentMode === "tryout"
                  ? onTryoutConfirm({ studentName: tryoutName, phone: tryoutPhone, note: tryoutNote }, durationMinutes, recurring, weeks)
                  : onConfirm(durationMinutes, recurring, weeks)
            }
            disabled={saving || unavailable || (mode === "class" && !canAddClass)}
          >
            <Plus size={18} />
            {saving
              ? copy(language, mode === "block" ? "Blocking..." : "Adding...", mode === "block" ? "保存中..." : "添加中...")
              : copy(language, mode === "block" ? "Block time" : "Add class", mode === "block" ? "设置不可用" : "添加课程")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ClubBookingActionModal({
  booking,
  bookings,
  language,
  onClose,
  onCancel,
  onComplete,
  onUpdateTime
}: {
  booking: Booking;
  bookings: Booking[];
  language: Language;
  onClose: () => void;
  onCancel: () => void;
  onComplete?: () => void;
  onUpdateTime: (slot: CalendarSlot, durationMinutes: number) => void;
}) {
  const bookingStart = new Date(booking.startsAt);
  const [initialStartTime] = booking.timeLabel.split(" - ");
  const initialDurationMinutes = Math.max(30, Math.round((bookingEndDate(booking).getTime() - bookingStart.getTime()) / 60000));
  const [dateValue, setDateValue] = useState(dateInputValue(bookingStart));
  const [startTime, setStartTime] = useState(initialStartTime || timeLabel(bookingStart));
  const [durationMinutes, setDurationMinutes] = useState(durationOptions.includes(initialDurationMinutes) ? initialDurationMinutes : 60);
  const [confirmAction, setConfirmAction] = useState<"update" | "cancel" | null>(null);
  const editSlot = makeSlotFromInput(dateValue, startTime);
  const isFutureClass = !isBlockedTime(booking) && booking.status !== "cancelled" && booking.status !== "coach_confirmed" && bookingStart.getTime() > Date.now();
  const unavailable = isRangeUnavailableExceptBooking(bookings, booking.assignedCoach, editSlot, durationMinutes, booking.id);
  const updateChanged =
    editSlot.startsAt !== booking.startsAt ||
    rangeLabel(editSlot, durationMinutes) !== booking.timeLabel;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal class-action-modal" role="dialog" aria-modal="true" aria-labelledby="club-booking-actions-title">
        <button className="modal-close-icon" type="button" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="section-head compact class-action-head">
          <div>
            <p className="eyebrow">{copy(language, isBlockedTime(booking) ? "Blocked time" : "Class actions", isBlockedTime(booking) ? "不可用时间" : "课程操作")}</p>
            <h2 id="club-booking-actions-title">{isBlockedTime(booking) ? booking.assignedCoach : booking.studentName}</h2>
          </div>
          <span className={`status-chip ${booking.status}`}>
            {isBlockedTime(booking) ? copy(language, "Not bookable", "不可预约") : statusText(booking.status, language)}
          </span>
        </div>
        <dl className="confirm-summary">
          <div>
            <dt>{copy(language, "Coach", "教练")}</dt>
            <dd>{booking.assignedCoach}</dd>
          </div>
          <div>
            <dt>{copy(language, "Date", "日期")}</dt>
            <dd>{booking.dateLabel}</dd>
          </div>
          <div>
            <dt>{copy(language, "Time", "时间")}</dt>
            <dd>{booking.timeLabel}</dd>
          </div>
        </dl>
        {isFutureClass ? (
          <div className="modal-edit-time">
            <div className="modal-field-grid">
              <label>
                <span>{copy(language, "New date", "新日期")}</span>
                <input className="modal-input" type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} />
              </label>
              <label>
                <span>{copy(language, "Start time", "开始时间")}</span>
                <select className="modal-select" value={startTime} onChange={(event) => setStartTime(event.target.value)}>
                  {calendarTimes.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-duration-picker">
              <span>{copy(language, "New length", "新时长")}</span>
              <div className="duration-picker" aria-label="New class length">
                {durationOptions.map((minutes) => (
                  <button
                    type="button"
                    className={durationMinutes === minutes ? "selected" : ""}
                    key={minutes}
                    onClick={() => setDurationMinutes(minutes)}
                  >
                    {minutes}m
                  </button>
                ))}
              </div>
            </div>
            <p className={unavailable ? "modal-warning" : "modal-info"}>
              {unavailable
                ? copy(language, "That coach already has something at the new time.", "该教练新时间已有安排。")
                : `${copy(language, "New time", "新时间")}: ${editSlot.dateLabel} ${rangeLabel(editSlot, durationMinutes)}`}
            </p>
          </div>
        ) : null}
        {onComplete && !isBlockedTime(booking) ? (
          <button className="primary-button complete-hero-button" onClick={onComplete}>
            <Check size={22} />
            {copy(language, "Complete class", "完成课程")}
          </button>
        ) : null}
        <div className="modal-actions class-secondary-actions">
          {isFutureClass ? (
            <button className="primary-button secondary-red-button" disabled={unavailable || !updateChanged} onClick={() => setConfirmAction("update")}>
              <Check size={18} />
              {copy(language, "Update time", "更新时间")}
            </button>
          ) : null}
          <button className="decline secondary-danger-button" onClick={() => setConfirmAction("cancel")}>
            <X size={17} />
            {copy(language, isBlockedTime(booking) ? "Remove block" : "Cancel class", isBlockedTime(booking) ? "移除不可用" : "取消课程")}
          </button>
        </div>
        {confirmAction ? (
          <div className="action-confirm-panel">
            <strong>
              {confirmAction === "update"
                ? copy(language, "Confirm update time?", "确认更新时间？")
                : copy(language, isBlockedTime(booking) ? "Confirm remove block?" : "Confirm cancel class?", isBlockedTime(booking) ? "确认移除不可用时间？" : "确认取消课程？")}
            </strong>
            <p>
              {confirmAction === "update"
                ? `${editSlot.dateLabel} ${rangeLabel(editSlot, durationMinutes)}`
                : copy(language, "This prevents accidental manager taps.", "这是为了避免管理员误点。")}
            </p>
            <div className="modal-actions">
              <button className="filter-button" type="button" onClick={() => setConfirmAction(null)}>
                {copy(language, "Keep editing", "继续编辑")}
              </button>
              <button
                className={confirmAction === "update" ? "primary-button" : "decline"}
                type="button"
                onClick={() => {
                  if (confirmAction === "update") {
                    onUpdateTime(editSlot, durationMinutes);
                    return;
                  }
                  onCancel();
                }}
              >
                {copy(language, "Yes, confirm", "确认")}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ConfirmRequestModal({
  action = "request",
  language,
  studentName,
  coach,
  slot,
  durationMinutes,
  unavailable = false,
  recurring,
  recurringWeeks,
  saving,
  onDurationChange,
  onCancel,
  onConfirm
}: {
  action?: "request" | "add";
  language: Language;
  studentName: string;
  coach: string;
  slot: CalendarSlot;
  durationMinutes: number;
  unavailable?: boolean;
  recurring: boolean;
  recurringWeeks: number;
  saving: boolean;
  onDurationChange?: (value: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-booking-title">
        <div className="section-head compact">
          <div>
            <p className="eyebrow">{copy(language, action === "add" ? "Confirm class" : "Confirm request", action === "add" ? "确认课程" : "确认预约")}</p>
            <h2 id="confirm-booking-title">
              {copy(language, action === "add" ? "Add this class?" : "Send this class request?", action === "add" ? "添加这节课？" : "发送这个预约请求？")}
            </h2>
          </div>
        </div>
        <dl className="confirm-summary">
          <div>
            <dt>{copy(language, "Student", "学生")}</dt>
            <dd>{studentName}</dd>
          </div>
          <div>
            <dt>{copy(language, "Coach", "教练")}</dt>
            <dd>{coach}</dd>
          </div>
          <div>
            <dt>{copy(language, "Date", "日期")}</dt>
            <dd>{slot.dateLabel}</dd>
          </div>
          <div>
            <dt>{copy(language, "Time", "时间")}</dt>
            <dd>{rangeLabel(slot, durationMinutes)}</dd>
          </div>
          {recurring ? (
            <div>
              <dt>{copy(language, "Repeat", "重复")}</dt>
              <dd>{copy(language, `${recurringWeeks} weeks`, `${recurringWeeks} 周`)}</dd>
            </div>
          ) : null}
        </dl>
        {onDurationChange ? (
          <div className="modal-duration-picker">
            <span>{copy(language, "Duration", "时长")}</span>
            <div className="duration-picker" aria-label="Duration">
              {durationOptions.map((minutes) => (
                <button
                  type="button"
                  className={durationMinutes === minutes ? "selected" : ""}
                  key={minutes}
                  onClick={() => onDurationChange(minutes)}
                >
                  {minutes} {copy(language, "min", "分钟")}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {unavailable ? <p className="modal-warning">{copy(language, "This time is not available.", "这个时间不可预约。")}</p> : null}
        <div className="modal-actions">
          <button className="filter-button" onClick={onCancel} disabled={saving}>
            {copy(language, "Cancel", "取消")}
          </button>
          <button className="primary-button" onClick={onConfirm} disabled={saving || unavailable}>
            <Check size={18} />
            {saving
              ? copy(language, action === "add" ? "Adding..." : "Sending...", action === "add" ? "添加中..." : "发送中...")
              : copy(language, action === "add" ? "Add class" : "Confirm request", action === "add" ? "添加课程" : "确认请求")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ParentClassCompleteModal({
  booking,
  language,
  onClose,
  onComplete
}: {
  booking: Booking;
  language: Language;
  onClose: () => void;
  onComplete: () => void;
}) {
  const canComplete = booking.status === "club_confirmed" && !isBlockedTime(booking);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="student-class-actions-title">
        <div className="section-head compact">
          <div>
            <p className="eyebrow">{copy(language, "Class actions", "课程操作")}</p>
            <h2 id="student-class-actions-title">{booking.studentName}</h2>
            <p className="section-subtitle">{copy(language, "Mark this class complete after it is finished.", "课程结束后可以标记完成。")}</p>
          </div>
          <span className={`status-chip ${booking.status}`}>{statusText(booking.status, language)}</span>
        </div>
        <dl className="confirm-summary">
          <div><dt>{copy(language, "Coach", "教练")}</dt><dd>{booking.assignedCoach}</dd></div>
          <div><dt>{copy(language, "Date", "日期")}</dt><dd>{booking.dateLabel}</dd></div>
          <div><dt>{copy(language, "Time", "时间")}</dt><dd>{booking.timeLabel}</dd></div>
        </dl>
        <div className="modal-actions">
          <button className="filter-button" onClick={onClose}>{copy(language, "Close", "关闭")}</button>
          <button className="primary-button" disabled={!canComplete} onClick={onComplete}>
            <Check size={18} />
            {copy(language, "Complete", "完成")}
          </button>
        </div>
      </section>
    </div>
  );
}

function BookingList({
  bookings,
  parentActions,
  language,
  onChangeRequest,
  onCancel,
  onComplete
}: {
  bookings: Booking[];
  parentActions?: boolean;
  language: Language;
  onChangeRequest?: (booking: Booking) => void;
  onCancel?: (booking: Booking) => void;
  onComplete?: (booking: Booking) => void;
}) {
  if (bookings.length === 0) {
    return <p className="empty-state">{copy(language, "No classes yet.", "还没有课程。")}</p>;
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
          <strong className={booking.status}>{statusText(booking.status, language)}</strong>
          {parentActions ? (
            <div className="row-actions parent-actions">
              <button disabled={booking.status !== "club_confirmed"} title={copy(language, "Complete", "完成")} onClick={() => onComplete?.(booking)}>
                <Check size={15} />
              </button>
              <button disabled={!canParentRequestChange(booking)} title={copy(language, "Request change", "申请改期")} onClick={() => onChangeRequest?.(booking)}>
                <RefreshCcw size={15} />
              </button>
              <button disabled={!canParentRequestChange(booking)} title={copy(language, "Cancel", "取消")} onClick={() => onCancel?.(booking)}>
                <X size={15} />
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
