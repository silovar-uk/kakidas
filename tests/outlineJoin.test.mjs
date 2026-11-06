import test from "node:test";
import assert from "node:assert/strict";
import { planOutlineEndDelete } from "../src/lib/outlineJoin.js";

const row = (id, order, content = id, parent_id = null, extra = {}) => ({
  id, sort_order: order, content, parent_id, created_at: "2026-11-06",
  kind: "sentence", has_children: false, child_count: 0, heading: "", tag: null,
  note: "", link_url: "", satisfaction: 0, is_completed: false, ...extra,
});
test("Delete at end can join the immediately following sibling", () => {
  const rows = [row("a", 0, "前"), row("b", 1, "後")];
  assert.deepEqual(planOutlineEndDelete(rows, rows, "a"), {
    kind: "join", nextId: "b", nextContent: "後", isBlank: false
  });
});
test("an empty next bullet is removed rather than consuming other rows", () => {
  const rows = [row("a", 0, "前"), row("b", 1, ""), row("c", 2, "後")];
  assert.deepEqual(planOutlineEndDelete(rows, rows, "a"), {
    kind: "join", nextId: "b", nextContent: "", isBlank: true
  });
  assert.equal(planOutlineEndDelete(rows, rows, "c").kind, "none");
});
test("different hierarchy is never flattened silently", () => {
  const rows = [row("a", 0), row("child", 0, "子", "a"), row("b", 1)];
  assert.equal(planOutlineEndDelete(rows, rows, "a").kind, "blocked");
  assert.equal(planOutlineEndDelete(rows, rows, "child").kind, "blocked");
});
test("hidden completed sibling is never skipped", () => {
  const rows = [row("a", 0), row("hidden", 1, "完了", null, { is_completed: true }), row("b", 2)];
  assert.equal(planOutlineEndDelete(rows, [rows[0], rows[2]], "a").kind, "blocked");
});
test("annotated/linked/completed/parent next rows are protected", () => {
  const first = row("a", 0);
  const variations = [
    { has_children: true }, { child_count: 1 }, { tag: "要確認" },
    { note: "備考" }, { link_url: "https://example.com" }, { heading: "見出し" },
    { satisfaction: 1 }, { is_completed: true }
  ];
  for (const extra of variations) {
    const rows = [first, row("b", 1, "", null, extra)];
    assert.equal(planOutlineEndDelete(rows, rows, "a").kind, "blocked", JSON.stringify(extra));
  }
  const rows = [first, row("b", 1, "本文")];
  assert.equal(planOutlineEndDelete(rows, rows, "a", 1).kind, "blocked");
});
test("only consecutive siblings in stored order can join", () => {
  const rows = [row("a", 0), row("b", 1), row("c", 2)];
  assert.equal(planOutlineEndDelete(rows, [rows[0], rows[2]], "a").kind, "blocked");
  assert.equal(planOutlineEndDelete(rows, [rows[1], rows[0], rows[2]], "a").kind, "blocked");
});
