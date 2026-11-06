import test from "node:test";
import assert from "node:assert/strict";
import { isReferenceSubmitShortcut } from "../src/lib/referenceSubmitShortcut.js";

const key = (patch = {}) => ({
  key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  nativeEvent: { isComposing: false, keyCode: 13 }, ...patch,
});

test("Ctrl+Enter and Command+Enter save a URL with or without a note", () => {
  assert.equal(isReferenceSubmitShortcut(key({ ctrlKey: true })), true);
  assert.equal(isReferenceSubmitShortcut(key({ metaKey: true })), true);
});

test("ordinary Enter stays a newline in the reference note", () => {
  assert.equal(isReferenceSubmitShortcut(key()), false);
});

test("Shift/Alt chords are not mistaken for submit", () => {
  assert.equal(isReferenceSubmitShortcut(key({ ctrlKey: true, shiftKey: true })), false);
  assert.equal(isReferenceSubmitShortcut(key({ ctrlKey: true, altKey: true })), false);
});

test("IME conversion cannot trigger URL save", () => {
  const shortcut = key({ ctrlKey: true });
  assert.equal(isReferenceSubmitShortcut(shortcut, true), false);
  assert.equal(isReferenceSubmitShortcut(key({ ctrlKey: true, isComposing: true })), false);
  assert.equal(isReferenceSubmitShortcut(key({ ctrlKey: true, nativeEvent: { isComposing: true } })), false);
  assert.equal(isReferenceSubmitShortcut(key({ ctrlKey: true, nativeEvent: { keyCode: 229 } })), false);
});

test("a non-Enter key never submits a reference", () => {
  assert.equal(isReferenceSubmitShortcut(key({ key: "Tab", ctrlKey: true })), false);
  assert.equal(isReferenceSubmitShortcut(key({ key: "NumpadEnter", ctrlKey: true })), false);
});
