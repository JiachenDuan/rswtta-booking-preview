import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.LOCAL_APP_URL ?? "http://127.0.0.1:4173/club";
const outputDir = "artifacts/class-packages";
await mkdir(outputDir, { recursive: true });

const seed = async (page) => {
  await page.addInitScript(() => {
    const now = "2026-09-12T12:00:00.000Z";
    const accountRows = [
      { id: "11111111-1111-4111-8111-111111110001", project_table_id: "local", created_at: now, updated_at: now, values: { studentName: "Aaron Lee", parentName: "", email: "alex1@example.test", phone: "5550001", confirmed: true, profileSetupRequired: false } },
      { id: "22222222-2222-4222-8222-222222220002", project_table_id: "local", created_at: now, updated_at: now, values: { studentName: "Aaron Lee", preregisteredName: "Aaron Lee", parentName: "", email: "", phone: "", confirmed: true, profileSetupRequired: true } },
      { id: "33333333-3333-4333-8333-333333330003", project_table_id: "local", created_at: now, updated_at: now, values: { studentName: "Maya Patel", parentName: "", email: "maya@example.test", phone: "5550003", confirmed: true, profileSetupRequired: false } }
    ];
    localStorage.setItem("rswtta-club-session", "true");
    localStorage.setItem("rswtta-local-data", JSON.stringify({ bookings: [], parent_accounts: accountRows, bill_notifications: [], activity_logs: [] }));
    // Deliberately no package-ledger seed: every account must start at exactly zero.
    localStorage.removeItem("rswtta-local-package-hours-ledger-v1");
  });
};

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  await seed(desktop);
  await desktop.goto(baseURL, { waitUntil: "networkidle" });
  await desktop.getByRole("button", { name: /Class packages/ }).click();
  await desktop.getByRole("heading", { name: /Prepaid hours by student account/ }).waitFor();
  await desktop.locator(".package-account-row").first().waitFor({ timeout: 15000 });
  await desktop.screenshot({ path: `${outputDir}/class-packages-desktop.png`, fullPage: false });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await seed(mobile);
  await mobile.goto(baseURL, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: /Class packages/ }).click();
  await mobile.getByRole("heading", { name: /Prepaid hours by student account/ }).waitFor();
  await mobile.locator(".package-account-row").first().waitFor({ timeout: 15000 });
  await mobile.screenshot({ path: `${outputDir}/class-packages-mobile.png`, fullPage: false });
  await mobile.locator(".package-account-row").first().getByRole("button", { name: /Add hours/ }).click();
  await mobile.getByRole("dialog").waitFor();
  await mobile.screenshot({ path: `${outputDir}/class-packages-mobile-add-hours.png`, fullPage: false });
} finally {
  await browser.close();
}
console.log(`Saved screenshots to ${outputDir}`);
