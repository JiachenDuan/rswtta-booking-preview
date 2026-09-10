import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import sharp from "sharp";

const source = readFileSync("components/ClubApp.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const originalPath = "public/brand/rising-stars-logo-original.jpg";
const emblemPath = "public/brand/rising-stars-emblem.webp";
const brandMarkup = source.slice(source.indexOf('<div className="brand">'), source.indexOf("</aside>"));

test("shared Parent and Club header uses the supplied recognizable emblem with fixed intrinsic dimensions", () => {
  expect(brandMarkup).toContain('src="/brand/rising-stars-emblem.webp"');
  expect(brandMarkup).toContain('alt="Rising Stars World Table Tennis Academy logo"');
  expect(brandMarkup).toContain("width={36}");
  expect(brandMarkup).toContain("height={36}");
  expect(brandMarkup).toContain("priority");
  expect(source).not.toContain("<Table2");
  expect(source).toContain('copy(language, "Parent booking", "家长预约课程")');
  expect(source).toContain('copy(language, "Club dashboard", "俱乐部确认课程")');
});

test("the supplied source is preserved byte-for-byte and the compact variant is square and optimized", async () => {
  const original = readFileSync(originalPath);
  expect(createHash("sha256").update(original).digest("hex")).toBe("52dcc9b74228b7cf19579182654e2aa5d62c9c3b605e31d6ba09c1fa84c15f7e");
  expect(await sharp(originalPath).metadata()).toMatchObject({ width: 800, height: 800, format: "jpeg" });
  expect(await sharp(emblemPath).metadata()).toMatchObject({ width: 288, height: 288, format: "webp" });
  expect(statSync(emblemPath).size).toBeLessThan(statSync(originalPath).size);
});

test("header icon keeps a white, unstretched 32–36px treatment without changing header copy", () => {
  const desktopMark = css.match(/\.brand-mark \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const iconRule = css.match(/\.brand-icon \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  expect(desktopMark).toContain("flex: 0 0 32px");
  expect(desktopMark).toContain("width: 32px");
  expect(desktopMark).toContain("height: 32px");
  expect(iconRule).toContain("width: 100%");
  expect(iconRule).toContain("height: 100%");
  expect(iconRule).toContain("background: #fff");
  expect(iconRule).toContain("object-fit: contain");
  expect(mobile).toMatch(/\.brand-mark \{[\s\S]*?flex-basis: 36px;[\s\S]*?width: 36px;[\s\S]*?height: 36px;/);
});
