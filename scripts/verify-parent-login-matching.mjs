import { chromium, webkit } from "@playwright/test";
import { pbkdf2Sync } from "node:crypto";

const base = process.env.PARENT_LOGIN_BASE_URL ?? "http://127.0.0.1:3101";
const browserName = process.env.PARENT_LOGIN_BROWSER ?? "chromium";
const browserType = browserName === "webkit" ? webkit : chromium;
const now = "2026-09-14T17:00:00.000Z";
const saltBytes = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1));
const completedPassword = "synthetic-completed-only";
const completedPasswordHash = pbkdf2Sync(completedPassword, saltBytes, 100000, 32, "sha256").toString("base64");
const completedAccountId = "a1000000-0000-4000-8000-000000000003";
const accounts = [
  {
    id: "a1000000-0000-4000-8000-000000000001",
    studentName: "Alex Ma",
    parentName: "",
    email: "alex.ma@example.test",
    phone: "",
    loginAlias: "alex-ma-1001",
    confirmed: false,
    profileSetupRequired: true,
    clubPreregistered: false,
    createdAt: now
  },
  {
    id: "a1000000-0000-4000-8000-000000000002",
    studentName: "Alex Li",
    parentName: "",
    email: "alex.li@example.test",
    phone: "",
    loginAlias: "alex-li-1002",
    confirmed: false,
    profileSetupRequired: true,
    clubPreregistered: true,
    createdAt: now
  },
  {
    id: "a1000000-0000-4000-8000-000000000004",
    studentName: "Casey Lee",
    parentName: "",
    email: "casey.one@example.test",
    phone: "",
    loginAlias: "casey-one-1004",
    confirmed: false,
    profileSetupRequired: true,
    clubPreregistered: false,
    createdAt: now
  },
  {
    id: "a1000000-0000-4000-8000-000000000005",
    studentName: "Ｃａｓｅｙ  Lee",
    parentName: "",
    email: "casey.two@example.test",
    phone: "",
    loginAlias: "casey-two-1005",
    confirmed: false,
    profileSetupRequired: true,
    clubPreregistered: true,
    createdAt: now
  },
  {
    id: completedAccountId,
    studentName: "Alex Wu",
    parentName: "Synthetic Parent",
    email: "alex.wu@example.test",
    phone: "+16505551003",
    loginAlias: "alex-wu-1003",
    passwordSalt: saltBytes.toString("base64"),
    passwordHash: completedPasswordHash,
    confirmed: true,
    profileSetupRequired: false,
    clubPreregistered: true,
    createdAt: now,
    updatedAt: now
  }
];

const completedAccount = accounts.find(({ id }) => id === completedAccountId);
if (!completedAccount) throw new Error("completed synthetic account missing");

const redactedCalendarBooking = {
  id: "b1000000-0000-4000-8000-000000000002",
  studentName: "",
  familyName: "",
  studentEmail: "",
  phone: "",
  requestedCoach: "National A",
  assignedCoach: "National A",
  program: "Private lesson",
  dateLabel: "Tue, Sep 15, 2026",
  timeLabel: "11 AM - 12 PM",
  startsAt: "2026-09-15T18:00:00.000Z",
  priceCents: 15000,
  status: "change_requested",
  createdAt: now,
  updatedAt: now
};
const completedDashboard = {
  account: completedAccount,
  bookings: [],
  calendarBookings: [redactedCalendarBooking],
  serverNow: now
};

function localRows() {
  return {
    bookings: [{
      id: "b1000000-0000-4000-8000-000000000001",
      project_table_id: "local",
      values: {
        id: "b1000000-0000-4000-8000-000000000001",
        studentAccountId: completedAccountId,
        studentName: "Alex Wu",
        familyName: "Alex Wu",
        studentEmail: "alex.wu@example.test",
        phone: "+16505551003",
        requestedCoach: "National A",
        assignedCoach: "National A",
        program: "Private lesson",
        dateLabel: "Tue, Sep 15, 2026",
        timeLabel: "9 AM - 10 AM",
        startsAt: "2026-09-15T16:00:00.000Z",
        priceCents: 10000,
        status: "change_requested",
        createdAt: now,
        updatedAt: now
      },
      created_at: now,
      updated_at: now
    }],
    bill_notifications: [],
    activity_logs: [],
    parent_accounts: accounts.map((values) => ({
      id: values.id,
      project_table_id: "local",
      values,
      created_at: now,
      updated_at: now
    }))
  };
}

async function installSyntheticState(context) {
  await context.addInitScript((rows) => {
    localStorage.setItem("rswtta-local-data", JSON.stringify(rows));
  }, localRows());
}

async function mockIsolatedBackend(page, calls) {
  await page.route("**://127.0.0.1:4444/**", async (route) => {
    const request = route.request();
    const url = request.url();
    const corsHeaders = {
      "access-control-allow-origin": base,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "apikey, authorization, content-profile, content-type, x-client-info, x-supabase-api-version"
    };
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders, body: "" });
    }
    if (url.includes("/rpc/parent_legacy_setup_login")) {
      const body = route.request().postDataJSON();
      calls.push({ rpc: "setup-login", identifier: body.p_identifier });
      const normalized = String(body.p_identifier ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
      const matches = accounts.filter((candidate) => candidate.profileSetupRequired && (candidate.loginAlias === normalized || candidate.studentName.toLocaleLowerCase("en-US") === normalized));
      if (matches.length !== 1) return route.fulfill({ status: 400, contentType: "application/json", headers: corsHeaders, body: JSON.stringify({ message: "Invalid login" }) });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({ sessionToken: "s".repeat(64), account: matches[0], setupOnly: true })
      });
    }
    if (url.includes("/rpc/parent_legacy_session_login")) {
      const body = route.request().postDataJSON();
      calls.push({ rpc: "session-login", identifier: body.p_identifier });
      if (String(body.p_identifier).trim().toLowerCase() !== completedAccount.email || body.p_password !== completedPassword) {
        return route.fulfill({ status: 400, contentType: "application/json", headers: corsHeaders, body: JSON.stringify({ message: "Invalid login" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders, body: JSON.stringify({ ...completedDashboard, sessionToken: "c".repeat(64), expiresAt: "2026-09-15T05:00:00.000Z" }) });
    }
    if (url.includes("/rpc/parent_legacy_session_resume")) {
      calls.push({ rpc: "session-resume" });
      return route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders, body: JSON.stringify(completedDashboard) });
    }
    return route.fulfill({ status: 503, contentType: "application/json", headers: corsHeaders, body: JSON.stringify({ message: "isolated backend" }) });
  });
}

function contextOptions(mobile) {
  return mobile ? {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
  } : { viewport: { width: 1440, height: 1000 } };
}

function captureErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    const expectedIsolatedBackendFailure = text.includes("127.0.0.1:4444") || text.includes("503 (Service Unavailable)");
    if (message.type() === "error" && !expectedIsolatedBackendFailure) consoleErrors.push(text);
  });
  return { pageErrors, consoleErrors };
}

async function runSetupScenario(browser, { mobile, submit }) {
  const context = await browser.newContext(contextOptions(mobile));
  await installSyntheticState(context);
  const page = await context.newPage();
  const errors = captureErrors(page);
  const calls = [];
  await mockIsolatedBackend(page, calls);
  await page.goto(`${base}/parent?verify=login-${mobile ? "mobile" : "desktop"}-${submit}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("checkbox", { name: "Pre-registered student" }).check();
  const username = page.getByRole("textbox", { name: "Username" });
  const password = page.getByRole("textbox", { name: /Password/ });
  const login = page.getByRole("button", { name: "Login", exact: true }).last();

  const emptyDisabled = await login.isDisabled();
  await password.fill("synthetic-only");
  const emptyIdentifierDisabled = await login.isDisabled();
  await password.press("Enter");
  const callsAfterEmptyEnter = calls.length;

  await username.fill("Alex");
  await page.getByText("No unique account matches", { exact: true }).waitFor();
  const firstOnlyDisabled = await login.isDisabled();
  await password.press("Enter");
  const callsAfterFirstOnlyEnter = calls.length;
  const firstOnlyBody = await page.locator("body").innerText();

  await username.fill("Casey Lee");
  const ambiguousDisabled = await login.isDisabled();
  await password.press("Enter");
  const callsAfterAmbiguousEnter = calls.length;

  await username.fill(" ＡＬＥＸ\u3000  ma ");
  await page.getByText("Username recognized. Enter your password to continue.", { exact: true }).waitFor();
  await password.fill("");
  const exactEmptyPasswordDisabled = await login.isDisabled();
  await password.press("Enter");
  const callsAfterEmptyPasswordEnter = calls.length;
  await password.fill("synthetic-only");
  const exactPasswordEnabled = await login.isEnabled();
  const exactBody = await page.locator("body").innerText();
  if (submit === "enter") await password.press("Enter");
  else await login.click();
  try {
    await page.getByRole("heading", { name: "Complete your student account" }).waitFor({ timeout: 15000 });
  } catch (error) {
    throw new Error(`setup flow failed: ${JSON.stringify({ calls, pageErrors: errors.pageErrors, consoleErrors: errors.consoleErrors, body: (await page.locator("body").innerText()).slice(0, 2000) })}`, { cause: error });
  }
  const stored = await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem("rswtta-parent-session"));
    return { id: parsed.account?.id ?? parsed.id, keys: Object.keys(parsed).sort() };
  });

  const result = {
    kind: "setup",
    viewport: mobile ? "mobile-safari-shaped" : "desktop",
    submit,
    legacyClubPreregistered: accounts[0].clubPreregistered,
    emptyDisabled,
    emptyIdentifierDisabled,
    firstOnlyDisabled,
    ambiguousDisabled,
    exactEmptyPasswordDisabled,
    exactPasswordEnabled,
    callsBeforeValidSubmit: {
      empty: callsAfterEmptyEnter,
      firstOnly: callsAfterFirstOnlyEnter,
      ambiguous: callsAfterAmbiguousEnter,
      emptyPassword: callsAfterEmptyPasswordEnter
    },
    firstOnlyDisclosedAlexMa: firstOnlyBody.includes("Alex Ma"),
    firstOnlyDisclosedAlexLi: firstOnlyBody.includes("Alex Li"),
    exactDisclosedAlexLi: exactBody.includes("Alex Li"),
    setupVisible: true,
    stored,
    calls,
    ...errors
  };
  await context.close();
  return result;
}

async function runCompletedReloadScenario(browser) {
  const context = await browser.newContext(contextOptions(false));
  await installSyntheticState(context);
  const page = await context.newPage();
  const errors = captureErrors(page);
  const calls = [];
  await mockIsolatedBackend(page, calls);
  await page.goto(`${base}/parent?verify=completed-reload`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Username" }).fill("alex.wu@example.test");
  await page.getByRole("textbox", { name: /Password/ }).fill(completedPassword);
  await page.getByRole("button", { name: "Login", exact: true }).last().click();
  await page.getByRole("button", { name: "Logout", exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Logout", exact: true }).waitFor();
  const stored = await page.evaluate(() => {
    const parsed = JSON.parse(sessionStorage.getItem("rswtta-parent-legacy-session"));
    return { keys: Object.keys(parsed).sort(), tokenLength: parsed.sessionToken.length, version: parsed.version };
  });
  const result = {
    kind: "completed-login-dashboard-reload",
    redactedParentNote: !("parentNote" in redactedCalendarBooking),
    stored,
    calls,
    dashboardVisible: await page.getByRole("heading", { name: "Class calendar" }).isVisible().catch(() => false),
    setupVisible: await page.getByRole("heading", { name: "Complete your student account" }).isVisible().catch(() => false),
    ...errors
  };
  await context.close();
  return result;
}

const browser = await browserType.launch({ headless: true });
let results;
try {
  results = [
    await runSetupScenario(browser, { mobile: false, submit: "enter" }),
    await runSetupScenario(browser, { mobile: true, submit: "button" }),
    await runCompletedReloadScenario(browser)
  ];
} finally {
  await browser.close();
}
const passed = results.every((result) =>
  result.pageErrors.length === 0
  && result.consoleErrors.length === 0
  && (result.kind === "setup"
    ? result.legacyClubPreregistered === false
      && result.emptyDisabled
      && result.emptyIdentifierDisabled
      && result.firstOnlyDisabled
      && result.ambiguousDisabled
      && result.exactEmptyPasswordDisabled
      && result.exactPasswordEnabled
      && Object.values(result.callsBeforeValidSubmit).every((count) => count === 0)
      && !result.firstOnlyDisclosedAlexMa
      && !result.firstOnlyDisclosedAlexLi
      && !result.exactDisclosedAlexLi
      && result.setupVisible
      && result.stored.id === accounts[0].id
      && result.calls.length === 1
    : result.redactedParentNote
      && result.dashboardVisible
      && result.stored.version === 1
      && result.stored.tokenLength === 64
      && result.calls.map(({ rpc }) => rpc).join(",") === "session-login,session-resume"
      && !result.setupVisible)
);
console.log(JSON.stringify({ base, browserName, results, passed }, null, 2));
if (!passed) process.exitCode = 1;
