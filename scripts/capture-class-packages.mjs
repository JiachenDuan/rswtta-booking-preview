import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.APP_URL ?? "https://rswtta-booking-preview.vercel.app/club";
const outputDir = process.env.OUTPUT_DIR ?? "artifacts/class-packages";
await mkdir(outputDir, { recursive: true });

const enterLegacyClubSession = async (page) => {
  // This mirrors the currently accepted legacy Club session risk; it is not trusted auth.
  await page.addInitScript(() => localStorage.setItem("rswtta-club-session", "true"));
};

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  await enterLegacyClubSession(desktop);
  await desktop.goto(baseURL, { waitUntil: "networkidle" });
  await desktop.getByRole("button", { name: /Class packages/ }).click();
  await desktop.getByRole("heading", { name: /Explicit package hours by account and category/ }).waitFor();
  await desktop.waitForFunction(() =>
    document.querySelector(".package-account-list")?.getAttribute("aria-busy") === "false" &&
    document.querySelectorAll(".package-account-row").length === 65
  , undefined, { timeout: 15000 });
  await desktop.screenshot({ path: `${outputDir}/class-packages-desktop.png`, fullPage: false });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await enterLegacyClubSession(mobile);
  await mobile.goto(baseURL, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: /Class packages/ }).click();
  await mobile.getByRole("heading", { name: /Explicit package hours by account and category/ }).waitFor();
  await mobile.waitForFunction(() =>
    document.querySelector(".package-account-list")?.getAttribute("aria-busy") === "false" &&
    document.querySelectorAll(".package-account-row").length === 65
  , undefined, { timeout: 15000 });
  await mobile.screenshot({ path: `${outputDir}/class-packages-mobile.png`, fullPage: false });
  await mobile.locator(".package-account-row").first().getByRole("button", { name: /Manage/ }).first().click();
  await mobile.getByRole("dialog").waitFor();
  await mobile.screenshot({ path: `${outputDir}/class-packages-mobile-manage.png`, fullPage: false });
} finally {
  await browser.close();
}
console.log(`Saved screenshots from ${baseURL} to ${outputDir}`);
