// First-child Enter, explicit fold shortcuts and top-aligned numbering in one browser QA.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + "/").href : import.meta.url;
const { chromium } = createRequire(base)("playwright");
const url = process.env.BASE_URL || "http://127.0.0.1:4173/";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  context.setDefaultTimeout(9000);
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: /新しいメモ/ }).first().click();
  await page.waitForURL(/\/memos\//);
  await page.keyboard.press("Control+Shift+1");
  const saved = page.locator(".entry-column--sentence .outline__item[data-outline-id]");
  const pending = page.locator(".entry-column--sentence .outline__edit--pending");
  const editor = page.locator(".entry-column--sentence .outline__edit:not(.outline__edit--pending)");
  const item = text => saved.filter({ has: page.locator(".outline__content", { hasText: text }) }).first();
  const contents = () => saved.evaluateAll(items => items.map(el =>
    el.querySelector("textarea")?.value ?? el.querySelector(".outline__content")?.textContent ?? ""));
  const add = async text => { await pending.fill(text); await pending.press("Enter"); await item(text).waitFor({ state: "visible" }); };
  await add("親");
  await add("既存の子");
  const parentId = await item("親").getAttribute("data-outline-id");
  await item("既存の子").focus();
  await page.keyboard.press("Tab");
  await page.waitForFunction(id => !!document.querySelector(`[data-outline-parent-id="${id}"]`), parentId);
  assert.equal(await item("既存の子").getAttribute("data-outline-parent-id"), parentId);
  await item("親").focus();

  // Ctrl+Alt+Up closes; Ctrl+Alt+Down opens. Repeating either direction is idempotent.
  await page.keyboard.press("Control+Alt+ArrowUp");
  await item("親").waitFor();
  assert.equal(await item("親").getAttribute("aria-expanded"), "false", "Up collapses");
  assert.equal(await item("既存の子").count(), 0, "collapsed child is hidden");
  await page.keyboard.press("Control+Alt+ArrowUp");
  assert.equal(await item("親").getAttribute("aria-expanded"), "false", "Up is not a toggle");
  await page.keyboard.press("Control+Alt+ArrowDown");
  await item("既存の子").waitFor();
  assert.equal(await item("親").getAttribute("aria-expanded"), "true", "Down expands");
  await page.keyboard.press("Control+Alt+ArrowDown");
  assert.equal(await item("親").getAttribute("aria-expanded"), "true", "Down is not a toggle");

  // Selected parent Enter inserts a first CHILD, preserving existing child ID.
  const originalChildId = await item("既存の子").getAttribute("data-outline-id");
  await item("親").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 3);
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "");
  await editor.fill("新3.1");
  await item("親").focus();
  await item("新3.1").waitFor({ state: "visible" });
  assert.deepEqual(await contents(), ["親", "新3.1", "既存の子"]);
  assert.equal(await item("新3.1").getAttribute("data-outline-parent-id"), parentId);
  assert.equal(await item("既存の子").getAttribute("data-outline-id"), originalChildId);

  // The numbering itself is derived from sibling order; no IDs or row content are rewritten.
  await page.getByRole("button", { name: "階層番号で表示" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".entry-column--sentence .outline__marker")]
    .some(el => el.textContent.trim() === "1.1"));
  assert.equal((await item("新3.1").locator(".outline__marker").first().textContent())?.trim(), "1.1");
  assert.equal((await item("既存の子").locator(".outline__marker").first().textContent())?.trim(), "1.2");

  // A collapsed parent Enter opens its children and inserts ahead of 1.1.
  await item("親").focus();
  await page.keyboard.press("Control+Alt+ArrowUp");
  assert.equal(await item("親").getAttribute("aria-expanded"), "false");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 4);
  assert.equal(await item("親").getAttribute("aria-expanded"), "true", "Enter auto-expands");
  await editor.waitFor();
  assert.equal(await editor.evaluate(el => document.activeElement === el), true, "focus moves to first child");
  await editor.fill("折り畳みから作成");
  await item("親").focus();
  await item("折り畳みから作成").waitFor();
  assert.deepEqual(await contents(), ["親", "折り畳みから作成", "新3.1", "既存の子"]);

  // Arrow folding from inside the actual editor preserves its focus and text.
  const activeParent = page.locator(`[data-outline-id="${parentId}"]`);
  await item("親").locator(".outline__content").click();
  await editor.waitFor();
  const beforeValue = await editor.inputValue();
  await editor.press("Control+Alt+ArrowUp");
  assert.equal(await activeParent.getAttribute("aria-expanded"), "false");
  assert.equal(await editor.evaluate(el => document.activeElement === el), true);
  await editor.press("Control+Alt+ArrowDown");
  assert.equal(await activeParent.getAttribute("aria-expanded"), "true");
  assert.equal(await editor.inputValue(), beforeValue);
  await editor.press("Escape");

  // Leading Enter retains the preexisting rule even for a parent with children.
  await item("親").locator(".outline__content").click();
  await editor.waitFor();
  await editor.press("Home");
  await editor.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 5);
  const first = saved.first();
  assert.equal(await first.getAttribute("data-outline-parent-id"), "", "leading Enter makes a root sibling above");
  assert.equal(await item("親").getAttribute("data-outline-id"), parentId, "parent ID remains stable");

  // Number/bullet baseline stays at the first text line across long wrapped content.
  await item("既存の子").locator(".outline__content").click();
  await editor.waitFor();
  const long = "非常に長い文章の折り返しでも番号が最初の行に揃うことを確認する。".repeat(7);
  await editor.fill(long);
  await item("親").focus();
  await item("非常に長い文章").waitFor();
  const geometry = async () => item("非常に長い文章").evaluate(el => {
    const marker = el.querySelector(".outline__marker");
    const text = el.querySelector(".outline__content");
    const a = marker.getBoundingClientRect();
    const b = text.getBoundingClientRect();
    return { markerTop:a.top, textTop:b.top, markerHeight:a.height, textHeight:b.height,
      rowAlign:getComputedStyle(el).alignItems, markerAlign:getComputedStyle(marker).alignItems,
      markerPaddingTop:parseFloat(getComputedStyle(marker).paddingTop) };
  });
  const desktop = await geometry();
  assert.ok(desktop.textHeight > 45, "long text must actually wrap on desktop");
  assert.ok(Math.abs(desktop.markerTop - desktop.textTop) <= 2, "desktop marker anchored to first line");
  assert.equal(desktop.rowAlign, "flex-start");
  assert.equal(desktop.markerAlign, "flex-start");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await geometry();
  assert.ok(mobile.textHeight > 70, "long text wraps on mobile");
  assert.ok(Math.abs(mobile.markerTop - mobile.textTop) <= 2, "mobile marker anchored to first line");
  assert.ok(mobile.markerHeight >= 44, "mobile marker retains 44px touch target");
  assert.ok(mobile.markerPaddingTop >= 9, "mobile text and marker top padding align");

  await page.reload();
  await item("親").waitFor();
  assert.deepEqual((await contents()).filter(Boolean), ["親", "折り畳みから作成", "新3.1", long],
    "nested order and content persist after reload");
  console.log("OK first child Enter, collapsed insertion, Ctrl+Alt folding, leading Enter, number order, long text top alignment PC/mobile");
  await context.close();
} finally {
  await browser.close();
}
