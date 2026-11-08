// Mobile contextual outline toolbar regression: browser-local test memo only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + "/").href : import.meta.url;
const { chromium } = createRequire(base)("playwright");
const url = process.env.BASE_URL || "http://127.0.0.1:4173/";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    locale: "ja-JP", timezoneId: "Asia/Tokyo",
  });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: /新しいメモ/ }).first().click();
  await page.waitForURL(/\/memos\//);
  const pending = page.locator(".entry-column--sentence .outline__edit--pending");
  const rows = page.locator(".entry-column--sentence .outline__item[data-outline-id]");
  await pending.waitFor({ state: "visible" });
  await pending.fill("親");
  await pending.press("Enter");
  await page.locator(".outline__content").filter({ hasText: "親" }).first().waitFor();
  await pending.fill("子候補");
  await pending.press("Enter");
  await page.locator(".outline__content").filter({ hasText: "子候補" }).first().waitFor();

  const child = rows.filter({ has: page.locator(".outline__content", { hasText: "子候補" }) }).first();
  const childId = await child.getAttribute("data-outline-id");
  assert.ok(childId, "saved child row id");
  await child.locator(".outline__content").click();
  const toolbar = page.getByRole("toolbar", { name: /の構造を編集/ });
  await toolbar.waitFor({ state: "visible" });
  assert.equal(await page.locator(".editor-tabs").count(), 0, "tabs are replaced instead of stacked");
  const editor = page.locator(".entry-column--sentence .outline__edit:not(.outline__edit--pending)");
  await editor.fill("子を更新");
  await toolbar.getByRole("button", { name: "階層を1段下げる" }).click();
  await page.waitForFunction(id => document.querySelector(`[data-outline-id="${id}"]`)?.getAttribute("aria-level") === "2", childId);
  assert.equal(await editor.inputValue(), "子を更新", "unsaved text is retained");
  assert.equal(await editor.evaluate(el => document.activeElement === el), true, "editing focus survives indent");
  await toolbar.getByRole("button", { name: "階層を1段上げる" }).click();
  await page.waitForFunction(id => document.querySelector(`[data-outline-id="${id}"]`)?.getAttribute("aria-level") === "1", childId);
  assert.equal(await editor.evaluate(el => document.activeElement === el), true, "editing focus survives outdent");
  const boxes = await Promise.all([
    toolbar.boundingBox(), page.locator(".editor-header").boundingBox(),
  ]);
  assert.ok(boxes[0] && boxes[1], "mobile header and toolbar exist");
  assert.ok(boxes[0].height <= 46, "toolbar occupies one compact row");
  await toolbar.getByRole("button", { name: "この項目のその他の操作" }).click();
  await page.locator(".mobile-action-sheet__panel").waitFor({ state: "visible" });
  await page.locator(".mobile-action-sheet__close").click();
  await toolbar.getByRole("button", { name: "構造操作を終了" }).click();
  await page.locator(".editor-tabs").waitFor({ state: "visible" });
  console.log("PASS mobile outline contextual toolbar: edit, indent, outdent, focus, details, dismissal");
  await context.close();
} finally {
  await browser.close();
}
