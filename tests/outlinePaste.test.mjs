import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOutlineLines, rowsFromOutlinePaste } from "../src/lib/outlinePaste.js";

test("空行を無視して行単位で分割する", () => {
  assert.deepEqual(rowsFromOutlinePaste("", 0, 0, "市場調査\r\n\r\n競合分析\r\n事業戦略"), ["市場調査", "競合分析", "事業戦略"]);
});
test("行頭の箇条書き・番号を外すが、文中記号は保持する", () => {
  assert.deepEqual(normalizeOutlineLines(" - 市場調査\n• 競合分析\n1. 施策\n・ 運用\n価格 - 値引き"), ["市場調査", "競合分析", "施策", "運用", "価格 - 値引き"]);
});
test("カーソル前後の文字を保って独立した項目にする", () => {
  assert.deepEqual(rowsFromOutlinePaste("前後", 1, 1, "A\nB"), ["前A", "B後"]);
  assert.deepEqual(rowsFromOutlinePaste("前に何か後", 2, 4, "A\nB"), ["前にA", "B後"]);
});
test("一行や実質一行の貼り付けは通常ペーストを維持する", () => {
  assert.equal(rowsFromOutlinePaste("元", 1, 1, "追記"), null);
  assert.equal(rowsFromOutlinePaste("", 0, 0, "\n唯一\n\n"), null);
});
