import { chromium } from "@playwright/test";

const base = process.env.PARENT_SESSION_BASE_URL ?? "http://127.0.0.1:3101";
const backend = process.env.PARENT_SESSION_BACKEND_PATTERN ?? "**/rest/v1/**";
const now = new Date().toISOString();
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const recoveryText = "Your saved Parent session was invalid or expired. Please sign in again.";
const account = {
  id: "f9200000-0000-4000-8000-000000000001",
  studentName: "Synthetic Fresh Parent",
  parentName: "Synthetic",
  email: "synthetic@example.test",
  phone: "0000000000",
  confirmed: true,
  profileSetupRequired: false,
  createdAt: now,
  updatedAt: now
};
// The production dashboard deliberately removes private fields such as parentNote
// from other families' calendar rows. This exact shape previously crashed render.
const redactedCalendarBooking = {
  id: "f9200000-0000-4000-8000-000000000002",
  studentName: "",
  familyName: "",
  studentEmail: "",
  phone: "",
  requestedCoach: "Coach Tian Ye",
  assignedCoach: "Coach Tian Ye",
  program: "Private lesson",
  dateLabel: "Tue, Sep 15, 2026",
  timeLabel: "11 AM - 12 PM",
  startsAt: "2026-09-15T18:00:00.000Z",
  priceCents: 15000,
  status: "change_requested",
  createdAt: now,
  updatedAt: now
};
const dashboard = { account, bookings: [], calendarBookings: [redactedCalendarBooking], serverNow: now };

async function contextFor(browser) {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
  });
}

async function mockBackend(page, calls) {
  await page.route(backend, (route) => {
    const url = route.request().url();
    if (url.includes("/rpc/parent_legacy_session_login")) {
      calls.push("login");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...dashboard, sessionToken: "a".repeat(64), expiresAt: future }) });
    }
    if (url.includes("/rpc/parent_legacy_session_resume")) {
      calls.push("resume");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboard) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function dashboardState(page) {
  return {
    logout: await page.getByRole("button", { name: "Logout" }).isVisible().catch(() => false),
    dashboard: await page.getByRole("heading", { name: "Class calendar" }).isVisible().catch(() => false),
    genericError: await page.getByText("THIS PAGE COULDN’T LOAD").isVisible().catch(() => false)
  };
}

async function recoveryState(page) {
  return {
    login: await page.getByRole("heading", { name: "Login" }).isVisible().catch(() => false),
    recovery: await page.getByText(recoveryText).isVisible().catch(() => false),
    genericError: await page.getByText("THIS PAGE COULDN’T LOAD").isVisible().catch(() => false)
  };
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  {
    const context = await contextFor(browser);
    const page = await context.newPage();
    const errors = [];
    const calls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockBackend(page, calls);
    await page.goto(`${base}/parent?verify=fresh-login`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Username" }).fill("synthetic@example.test");
    await page.getByRole("textbox", { name: /Password/ }).fill("synthetic-only");
    await page.getByRole("button", { name: "Login", exact: true }).last().click();
    await page.getByRole("button", { name: "Logout" }).waitFor({ state: "visible" });
    const immediate = await dashboardState(page);
    const stored = await page.evaluate(() => {
      const value = JSON.parse(sessionStorage.getItem("rswtta-parent-legacy-session"));
      return { keys: Object.keys(value).sort(), version: value.version, tokenLength: value.sessionToken.length, expiresAt: value.expiresAt };
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Logout" }).waitFor({ state: "visible" });
    const reload = await dashboardState(page);
    results.push({ scenario: "fresh-login-reload", immediate, reload, stored, calls, errors });
    await context.close();
  }

  for (const scenario of ["malformed", "expired"]) {
    const context = await contextFor(browser);
    await context.addInitScript((kind) => {
      if (kind === "malformed") localStorage.setItem("rswtta-parent-session", "{");
      else sessionStorage.setItem("rswtta-parent-legacy-session", JSON.stringify({ sessionToken: "expired", expiresAt: "2000-01-01T00:00:00.000Z" }));
    }, scenario);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockBackend(page, []);
    await page.goto(`${base}/parent?verify=${scenario}`, { waitUntil: "networkidle" });
    results.push({ scenario, state: await recoveryState(page), errors });
    await context.close();
  }
} finally {
  await browser.close();
}

const fresh = results.find((item) => item.scenario === "fresh-login-reload");
const recoveries = results.filter((item) => item.scenario !== "fresh-login-reload");
const passed = Boolean(
  fresh
  && fresh.immediate.logout && fresh.immediate.dashboard && !fresh.immediate.genericError
  && fresh.reload.logout && fresh.reload.dashboard && !fresh.reload.genericError
  && fresh.calls.includes("login") && fresh.calls.includes("resume")
  && fresh.errors.length === 0
  && recoveries.every((item) => item.state.login && item.state.recovery && !item.state.genericError && item.errors.length === 0)
);
console.log(JSON.stringify({ base, results, passed }, null, 2));
if (!passed) process.exitCode = 1;
