import test from "node:test";
import assert from "node:assert/strict";
import { resolveParagraphInsertionIndex } from "../src/lib/paragraphInsertion.js";
const entries = [{id:"a"}, {id:"b"}, {id:"c"}];
test("normal paragraph creation requests transactional append, including empty and stale lists", () => {
  assert.equal(resolveParagraphInsertionIndex(entries, null), undefined);
  assert.equal(resolveParagraphInsertionIndex([], null), undefined);
  assert.equal(resolveParagraphInsertionIndex(entries, "deleted"), undefined);
});
test("only an explicit outline-derived anchor requests insertion", () => {
  assert.equal(resolveParagraphInsertionIndex(entries, "^"), 0);
  assert.equal(resolveParagraphInsertionIndex(entries, "a"), 1);
  assert.equal(resolveParagraphInsertionIndex(entries, "c"), 3);
});
