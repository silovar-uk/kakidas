import test from "node:test";
import assert from "node:assert/strict";
import { positionForBlankEnter, canBackspaceDeleteBlank, isTrulyEmptyEditor } from "../src/lib/outlineBlank.js";

const row = (id, parent_id = null, sort_order = 0, content = id, extra = {}) => ({
  id, parent_id, sort_order, content, created_at: "2026-11-03",
  kind: "sentence", heading: "", tag: null, note: "", link_url: "",
  satisfaction: 0, is_completed: false, has_children: false, child_count: 0, ...extra,
});

test("Enter at the first character inserts above without changing the original row", () => {
  const source = [row("a"), row("child", "a"), row("b", null, 1), row("c", null, 2)];
  assert.deepEqual(positionForBlankEnter(source, "b", true), { parentId: null, index: 1 });
  assert.deepEqual(positionForBlankEnter(source, "b", false), { parentId: null, index: 2 });
  assert.equal(source[2].id, "b");
});

test("Nested and filtered/completed siblings use persisted index, not visible rank", () => {
  const source = [
    row("root"), row("first", "root", 0), row("hidden", "root", 1, "", { is_completed: true }),
    row("current", "root", 2), row("other", null, 1),
  ];
  assert.deepEqual(positionForBlankEnter(source, "current", true), { parentId: "root", index: 2 });
  assert.deepEqual(positionForBlankEnter(source, "current", false), { parentId: "root", index: 3 });
});

test("A saved blank row always adds its next blank after itself", () => {
  assert.deepEqual(positionForBlankEnter([row("empty", null, 0, "")], "empty", false), { parentId: null, index: 1 });
  assert.equal(positionForBlankEnter([], "missing", true), null);
});

test("Backspace can only delete an actually empty, unadorned leaf", () => {
  const empty = row("empty", null, 0, "");
  assert.equal(canBackspaceDeleteBlank(empty), true);
  assert.equal(canBackspaceDeleteBlank(row("text")), false);
  assert.equal(canBackspaceDeleteBlank(row("spaces", null, 0, " ")), false);
  for (const extra of [
    { has_children: true }, { child_count: 2 }, { tag: "重要" },
    { note: "メモ" }, { link_url: "https://example.com" },
    { heading: "見出し" }, { satisfaction: 3 }, { is_completed: true },
  ]) {
    assert.equal(canBackspaceDeleteBlank({ ...empty, ...extra }), false, JSON.stringify(extra));
  }
  assert.equal(canBackspaceDeleteBlank(empty, 1), false);
});

test("A textarea must have no content and no selection before Backspace removes its row", () => {
  assert.equal(isTrulyEmptyEditor("", 0, 0), true);
  assert.equal(isTrulyEmptyEditor(" ", 0, 0), false);
  assert.equal(isTrulyEmptyEditor("abc", 0, 3), false);
});


test("Enter on a parent inserts a new first child before existing 3.1", () => {
  const data = [
    row("parent", null, 2, "3 企画"),
    row("childA", "parent", 0, "既存3.1"),
    row("childB", "parent", 1, "既存3.2"),
    row("nextRoot", null, 3, "4 完了"),
  ];
  assert.deepEqual(positionForBlankEnter(data, "parent", false), { parentId: "parent", index: 0 });
  // 行頭編集だけは既存のルールを優先：新3は親の上。
  assert.deepEqual(positionForBlankEnter(data, "parent", true), { parentId: null, index: 0 });
  assert.deepEqual(positionForBlankEnter(data, "childA", false), { parentId: "parent", index: 1 });
});

test("Collapsed or completed children are still counted, and nested parents work", () => {
  const data = [
    row("root", null, 0, "root", { has_children: true }),
    row("completed", "root", 0, "hidden", { is_completed: true }),
    row("subParent", "root", 1, "sub", { has_children: true }),
    row("grandchild", "subParent", 0, "grandchild"),
  ];
  assert.deepEqual(positionForBlankEnter(data, "root", false), { parentId: "root", index: 0 });
  assert.deepEqual(positionForBlankEnter(data, "subParent", false), { parentId: "subParent", index: 0 });
  assert.deepEqual(positionForBlankEnter(data, "grandchild", false), { parentId: "subParent", index: 1 });
});
