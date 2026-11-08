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

  // 構造だけを選択中の「完了」は次の行へ進むが、キーボードは出さない。
  await page.setViewportSize({ width: 320, height: 667 });
  const parent = rows.filter({ has: page.locator(".outline__content", { hasText: "親" }) }).first();
  await parent.locator(".outline__mobile-actions").click();
  await toolbar.waitFor({ state: "visible" });
  const controls = toolbar.locator("button");
  assert.equal(await controls.count(), 7, "7 actions in one toolbar row");
  const sizes = await controls.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
  assert.ok(sizes.every(width => width >= 43.9), "320px viewport keeps 44px touch targets: " + JSON.stringify(sizes));
  assert.equal(await toolbar.locator("button svg").count(), 7, "all symbols use SVG, not text arrows");
  await toolbar.getByRole("button", { name: "この項目を完了にする" }).click();
  await parent.waitFor({ state: "detached" });
  assert.equal(await editor.count(), 0, "selection-only completion does not open software keyboard");
  await toolbar.waitFor({ state: "visible" });
  assert.match(await toolbar.getAttribute("aria-label") || "", /子を更新/, "next unfinished row selected");

  // 編集中の完了は変更内容を保存し、次の一文の入力へ進む。
  const remaining = rows.filter({ has: page.locator(".outline__content", { hasText: "子を更新" }) }).first();
  await remaining.locator(".outline__content").click();
  await editor.fill("子を書き直して完了");
  await toolbar.getByRole("button", { name: "この項目を完了にする" }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll(".outline__content")].some(el => el.textContent?.includes("子を書き直して完了")));
  await pending.waitFor({ state: "visible" });
  assert.equal(await pending.evaluate(el => document.activeElement === el), true, "completion advances writing to pending item");

  // 新規行も一度のタップで保存と完了をまとめて行う。
  await pending.fill("新規で完了");
  await toolbar.getByRole("button", { name: "この項目を完了にする" }).click();
  await pending.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".outline__edit--pending")?.value === "");
  assert.equal(await page.locator(".outline__content").filter({ hasText: "新規で完了" }).count(), 0, "newly completed row is hidden");
  console.log("PASS mobile outline contextual toolbar: SVG icons, 320px sizing, completion and focus flows");
  await context.close();
} finally {
  await browser.close();
}
