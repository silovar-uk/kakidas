import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOutlineLines, normalizeOutlineItems, rowsFromOutlinePaste, itemsFromOutlinePaste, serializeOutlineItems } from "../src/lib/outlinePaste.js";

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

test("Tab1個は子・2個は孫・同じTab数は兄弟になる", () => {
  assert.deepEqual(normalizeOutlineItems("市場調査\n\t国内\n\t\t市場規模\n\t\t成長率\n\t海外\n競合分析"), [
    {content:"市場調査",depth:0},{content:"国内",depth:1},
    {content:"市場規模",depth:2},{content:"成長率",depth:2},
    {content:"海外",depth:1},{content:"競合分析",depth:0},
  ]);
});
test("コピー元の第3階層からでも相対階層として貼れる", () => {
  assert.deepEqual(normalizeOutlineItems("\t\t起点\n\t\t\t子\n\t\t次の兄弟"),[
    {content:"起点",depth:0},{content:"子",depth:1},{content:"次の兄弟",depth:0},
  ]);
});
test("親が存在しない深い字下げは1段ずつに丸め、同インデントは兄弟を維持",()=>{
  assert.deepEqual(normalizeOutlineItems("親\n\t\t\t子A\n\t\t\t子B\n\t\t子C\n親2"),[
    {content:"親",depth:0},{content:"子A",depth:1},{content:"子B",depth:1},
    {content:"子C",depth:1},{content:"親2",depth:0},
  ]);
});
test("空白行と番号付きのTabを解釈し、文章内のTabは残す",()=>{
  assert.deepEqual(normalizeOutlineItems("  - 親\n\t1. 子\n\n\t\t・ 孫\n親\t補足"),[
    {content:"親",depth:0},{content:"子",depth:1},{content:"孫",depth:2},
    {content:"親\t補足",depth:0},
  ]);
});
test("複数行ペーストでは既存テキスト前後を残しつつ階層を保つ",()=>{
  assert.deepEqual(itemsFromOutlinePaste("前後",1,1,"A\n\tB"),[
    {content:"前A",depth:0},{content:"B後",depth:1},
  ]);
  assert.equal(itemsFromOutlinePaste("",0,0,"\t単独"),null);
});
test("Tabアウトラインは読み込みと書き出しを往復できる",()=>{
  const original="市場\n\t国内\n\t\t成長率\n\t海外\n競合";
  const items=normalizeOutlineItems(original);
  assert.equal(serializeOutlineItems(items),original);
  assert.deepEqual(normalizeOutlineItems(serializeOutlineItems(items)),items);
});
