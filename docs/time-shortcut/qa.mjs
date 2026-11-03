// Dedicated browser acceptance test for Alt+; in real React-controlled editors.
// Runs against a fresh, isolated IndexedDB origin; never touches real user data.
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
    viewport: { width: 1366, height: 768 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: /新しいメモ/ }).first().click();
  await page.waitForURL(/\/memos\//);
  await page.keyboard.press("Control+Shift+1");

  const pending = page.locator(".entry-column--sentence .outline__edit--pending");
  await pending.waitFor({ state: "visible" });
  await pending.fill("前XX後");
  await pending.evaluate(el => el.setSelectionRange(1, 3));
  await pending.press("Alt+Semicolon");
  const inserted = await pending.inputValue();
  assert.match(inserted, /^前\d{2}:\d{2}後$/, "selected text is replaced at the caret");
  assert.equal(await pending.evaluate(el => el.selectionStart), 6, "caret remains after HH:mm");

  await pending.press("Control+z");
  assert.equal(await pending.inputValue(), "前XX後", "Ctrl+Z restores the prior input");

  await pending.fill("議題: ");
  await pending.press("End");
  await pending.press("Alt+Semicolon");
  assert.match(await pending.inputValue(), /^議題: \d{2}:\d{2}$/);
  await pending.press("Enter");
  await page.locator(".entry-column--sentence .outline__content").filter({ hasText: /^議題:/ }).first().waitFor();
  // Leave time for IndexedDB transaction completion before navigating.
  await page.waitForTimeout(700);
  await page.reload();
  await page.locator(".entry-column--sentence [data-outline-id]").first().waitFor();
  const savedRows = await page.locator(".entry-column--sentence [data-outline-id]").evaluateAll(rows =>
    rows.map(row => row.querySelector("textarea")?.value ?? row.querySelector(".outline__content")?.textContent ?? "")
  );
  assert.equal(savedRows.some(value => /^議題: \d{2}:\d{2}$/.test(value)), true,
    "saved row survives reload: " + JSON.stringify(savedRows));

  const editorRow = page.locator(".entry-column--sentence .outline__content").filter({ hasText: /^議題:/ }).first();
  await editorRow.click();
  const savedEditor = page.locator(".entry-column--sentence .outline__edit:not(.outline__edit--pending)").first();
  await savedEditor.waitFor({ state: "visible" });
  await savedEditor.press("End");
  await savedEditor.press("Alt+Semicolon");
  const editorState = await page.evaluate(() => ({
    activeTag: document.activeElement?.tagName,
    activeClass: document.activeElement?.className,
    fields: [...document.querySelectorAll(".entry-column--sentence textarea")].map(el => ({
      className: el.className, value: el.value, focused: document.activeElement === el,
    })),
    rows: [...document.querySelectorAll(".entry-column--sentence [data-outline-id]")].map(el =>
      el.querySelector(".outline__content")?.textContent ?? el.querySelector("textarea")?.value ?? ""),
  }));
  assert.equal(await savedEditor.count(), 1, "existing editor stays open after time insertion: " + JSON.stringify(editorState));
  assert.match(await savedEditor.inputValue(), /^議題: \d{2}:\d{2}\d{2}:\d{2}$/, "existing row editor accepts timestamp");

  await page.keyboard.press("Control+k");
  const command = page.getByRole("button", { name: /現在時刻を挿入/ }).first();
  await command.click();
  assert.match(await savedEditor.inputValue(), /^議題: \d{2}:\d{2}\d{2}:\d{2}\d{2}:\d{2}$/, "command palette restores prior caret");

  await page.keyboard.press("Control+Shift+3");
  const reference = page.locator(".entry-column--word textarea.entry-composer__textarea").first();
  await reference.waitFor({ state: "visible" });
  assert.equal(await reference.getAttribute("data-kakidas-time-input"), null, "reference URL field is excluded");
  await reference.fill("https://example.com/");
  await reference.press("Alt+Semicolon");
  assert.equal(await reference.inputValue(), "https://example.com/", "Alt+; does not modify URLs");

  await context.close();
  console.log("OK: Alt+; selection, Undo, save, existing row, palette, URL protection");
} finally {
  await browser.close();
}
