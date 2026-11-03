import test from "node:test";
import assert from "node:assert/strict";
import {
  formatLocalClockTime,
  insertTimeIntoField,
  isTimeInsertField,
  matchesInsertTimeShortcut,
} from "../src/lib/timeShortcut.js";

function key(overrides = {}) {
  return {
    altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
    code: "Semicolon", key: ";", repeat: false, isComposing: false,
    keyCode: 186, getModifierState: () => false, ...overrides,
  };
}

test("Alt + ; works by physical Semicolon key or generated character", () => {
  assert.equal(matchesInsertTimeShortcut(key()), true);
  assert.equal(matchesInsertTimeShortcut(key({ code: "Unidentified", key: ";" })), true);
  assert.equal(matchesInsertTimeShortcut(key({ code: "KeyM", key: "m" })), false);
  for (const overrides of [
    { altKey: false }, { ctrlKey: true }, { metaKey: true },
    { shiftKey: true }, { repeat: true }, { isComposing: true },
    { key: "Process" }, { keyCode: 229 },
    { getModifierState: () => true },
  ]) {
    assert.equal(matchesInsertTimeShortcut(key(overrides)), false);
  }
});

test("local time uses two-digit 24-hour HH:mm", () => {
  assert.equal(formatLocalClockTime(new Date(2026, 10, 3, 9, 4)), "09:04");
  assert.equal(formatLocalClockTime(new Date(2026, 10, 3, 23, 59)), "23:59");
});

function textarea(value, start, end = start, enabled = true) {
  const listeners = new Map();
  const field = {
    tagName: "TEXTAREA", disabled: !enabled, readOnly: false,
    value, selectionStart: start, selectionEnd: end, events: 0,
    hasAttribute: name => name === "data-kakidas-time-input",
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatchEvent(event) {
      this.events++;
      listeners.get(event.type)?.(event);
      return true;
    },
  };
  return field;
}

test("only enabled opt-in memo textareas accept timestamps", () => {
  assert.equal(isTimeInsertField(textarea("", 0)), true);
  assert.equal(isTimeInsertField(textarea("", 0, 0, false)), false);
  assert.equal(isTimeInsertField({ tagName: "INPUT", hasAttribute: () => true }), false);
  assert.equal(isTimeInsertField({ tagName: "TEXTAREA", hasAttribute: () => false }), false);
});

test("native insertion respects caret and replaces selection with one input event", () => {
  const field = textarea("before | after", 7, 8);
  const doc = {
    execCommand(command, ui, time) {
      assert.equal(command, "insertText");
      assert.equal(ui, false);
      const start = field.selectionStart, end = field.selectionEnd;
      field.value = field.value.slice(0, start) + time + field.value.slice(end);
      field.setSelectionRange(start + time.length, start + time.length);
      field.dispatchEvent(new Event("input"));
      return true;
    },
  };
  assert.equal(insertTimeIntoField(field, "16:49", doc), true);
  assert.equal(field.value, "before 16:49 after");
  assert.equal(field.selectionStart, 12);
  assert.equal(field.events, 1);
});

test("unsupported native command falls back to regular input event", () => {
  const field = textarea("議事録", 3);
  assert.equal(insertTimeIntoField(field, "16:49", { execCommand: () => false }), true);
  assert.equal(field.value, "議事16:49録");
  assert.equal(field.selectionStart, 8);
  assert.equal(field.events, 1);
});

test("disabled or non-opt-in fields remain unchanged", () => {
  const field = textarea("stay", 2, 2, false);
  assert.equal(insertTimeIntoField(field, "16:49", { execCommand: () => true }), false);
  assert.equal(field.value, "stay");
});
