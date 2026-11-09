// Intentional blank-row UX: isolated browser acceptance, never uses real user data.
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
    viewport: { width: 1366, height: 768 }, locale: "ja-JP", timezoneId: "Asia/Tokyo",
  });
  context.setDefaultTimeout(9000);
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: /新しいメモ/ }).first().click();
  await page.waitForURL(/\/memos\//);
  await page.keyboard.press("Control+Shift+1");
  const rows = page.locator(".entry-column--sentence .outline__item[data-outline-id]");
  const pending = page.locator(".entry-column--sentence .outline__edit--pending");
  const activeEditor = page.locator(".entry-column--sentence .outline__edit:not(.outline__edit--pending)");
  const rowData = () => rows.evaluateAll(elements => elements.map(el => ({
    id: el.dataset.outlineId,
    parent: el.dataset.outlineParentId,
    value: el.querySelector("textarea")?.value ?? el.querySelector(".outline__content")?.textContent ?? "",
  })));
  await pending.waitFor({ state: "visible" });
  assert.equal(await pending.getAttribute("placeholder"), null, "pending has no visible placeholder");

  // A committed blank pending row is a persisted item, even if its content is empty.
  await pending.fill("Original");
  await pending.press("Enter");
  await page.locator(".outline__content").filter({ hasText: "Original" }).first().waitFor();
  await pending.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 2);
  const original = (await rowData()).find(row => row.value === "Original");
  assert.ok(original, "original row persisted");
  assert.equal((await rowData()).filter(row => row.value === "").length, 1, "blank pending was committed");
  const firstEmptyId = (await rowData())[1].id;

  // Enter at offset 0 inserts ABOVE, without moving/replacing the original ID.
  await rows.filter({ has: page.locator(".outline__content", { hasText: "Original" }) }).first().locator(".outline__content").click();
  await activeEditor.waitFor();
  await activeEditor.press("Home");
  await activeEditor.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 3);
  const afterHead = await rowData();
  assert.deepEqual(afterHead.map(row => row.value), ["", "Original", ""]);
  assert.equal(afterHead[1].id, original.id, "original ID stays unchanged");
  assert.equal(afterHead[2].id, firstEmptyId, "previous empty item is not replaced");
  assert.equal(await activeEditor.inputValue(), "", "the inserted row is focused for writing");
  assert.equal(await activeEditor.evaluate(el => document.activeElement === el), true);

  // Enter on a saved blank inserts ANOTHER persisted blank, not a throwaway draft.
  await activeEditor.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 4);
  const afterRepeat = await rowData();
  assert.deepEqual(afterRepeat.map(row => row.value), ["", "", "Original", ""]);
  const removedId = afterRepeat[1].id;
  await activeEditor.press("Backspace");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 3);
  assert.equal((await rowData()).some(row => row.id === removedId), false, "Backspace removes blank");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 4);
  assert.equal((await rowData()).some(row => row.id === removedId), true, "Ctrl+Z restores same ID");

  // Non-leading Enter inserts after the existing row without splitting text.
  await rows.filter({ has: page.locator(".outline__content", { hasText: "Original" }) }).first().locator(".outline__content").click();
  await activeEditor.waitFor();
  await activeEditor.evaluate(el => el.setSelectionRange(4, 4));
  await activeEditor.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 5);
  assert.equal((await rowData()).find(row => row.id === original.id)?.value, "Original");

  // Remove the new blank with Undo as a separate checkpoint, then reload.
  const currentlyEmptyId = (await rowData())[3].id;
  await activeEditor.press("Backspace");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 4);
  assert.equal((await rowData()).some(row => row.id === currentlyEmptyId), false);
  await page.reload();
  await rows.first().waitFor();
  assert.equal((await rowData()).filter(row => row.value === "").length, 3, "all intentional blanks survive reload");
  assert.equal(await page.getByText("空の項目", { exact: true }).count(), 0);
  assert.equal(await page.locator(".outline__empty-placeholder").count(), 0);

  // Numbered mode excludes saved empty rows and renumbers during inline edits.
  await page.getByRole("button", { name: "階層番号で表示" }).click();
  const markerLabels = () => rows.evaluateAll(elements => elements.map(el =>
    el.querySelector(".outline__marker")?.textContent?.trim() ?? ""));
  assert.deepEqual(await markerLabels(), ["", "", "1", ""],
    "blank rows are present but do not consume numbered positions");
  await rows.nth(1).locator(".outline__content").click();
  await activeEditor.waitFor();
  await activeEditor.fill("New idea");
  assert.deepEqual(await markerLabels(), ["", "1", "2", ""],
    "numbers respond immediately to typing into an empty saved row");
  await activeEditor.fill("");
  assert.deepEqual(await markerLabels(), ["", "", "1", ""],
    "clearing an edited row restores blank numbering without removing the row");
  await rows.filter({ has: page.locator(".outline__content", { hasText: "Original" }) }).first().locator(".outline__content").click();

  // Backspace on text only edits characters; it never removes the row.
  await rows.filter({ has: page.locator(".outline__content", { hasText: "Original" }) }).first().locator(".outline__content").click();
  await activeEditor.press("End");
  await activeEditor.press("Backspace");
  assert.equal(await activeEditor.inputValue(), "Origina");
  assert.equal(await rows.count(), 4);

  // Fast typing immediately after Enter must go to the new row, even before IndexedDB resolves.
  await page.goto(url);
  await page.getByRole("button", { name: /新しいメモ/ }).first().click();
  await page.waitForURL(address => address.pathname.startsWith("/memos/"));
  await page.keyboard.press("Control+Shift+1");
  await pending.fill("最初の行");
  await pending.press("Enter");
  await page.locator(".outline__content").filter({ hasText: "最初の行" }).first().waitFor();
  await rows.filter({ has: page.locator(".outline__content", { hasText: "最初の行" }) }).first().locator(".outline__content").click();
  await activeEditor.fill("変更した行");
  await activeEditor.press("End");
  await activeEditor.press("Enter");
  await page.keyboard.type("すばやく入力");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const rowElements = [...document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]")];
    return rowElements.length === 4 && rowElements.some(el =>
      (el.querySelector(".outline__content")?.textContent ?? "") === "すばやく入力");
  }, undefined, { timeout: 9000 });
  const rapid = await rowData();
  assert.deepEqual(rapid.map(row => row.value), ["変更した行", "すばやく入力", "", ""],
    "rapid typing and consecutive Enter preserve text and each blank");
  // Ctrl+Z on a newly created blank restores the previous row count.
  await activeEditor.waitFor({ state: "visible" });
  assert.equal(await activeEditor.inputValue(), "");
  await activeEditor.press("Control+z");
  await page.waitForFunction(() => document.querySelectorAll(".entry-column--sentence .outline__item[data-outline-id]").length === 3);
  assert.deepEqual((await rowData()).map(row => row.value), ["変更した行", "すばやく入力", ""],
    "Ctrl+Z removes only the most recently inserted blank");
  await page.reload();
  await rows.first().waitFor();
  assert.deepEqual((await rowData()).map(row => row.value), ["変更した行", "すばやく入力", ""],
    "rapid changes remain after reload");

  await context.close();
  console.log("OK blank rows: leading Enter, pending save, repeated Enter, Backspace, Undo, caret, reload, placeholder and text protection");
} finally {
  await browser.close();
}
