/**
 * Alt + ; inserts the local current time into opted-in memo textareas.
 * Keep the shortcut independent of React so every editor path shares the same rules.
 */
export function matchesInsertTimeShortcut(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return false;
  if (event.isComposing || event.key === "Process" || event.keyCode === 229) return false;
  if (event.getModifierState?.("AltGraph")) return false;
  return event.code === "Semicolon" || event.key === ";";
}

export function formatLocalClockTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function isTimeInsertField(target) {
  return target?.tagName === "TEXTAREA"
    && target.hasAttribute("data-kakidas-time-input")
    && !target.disabled
    && !target.readOnly;
}

/**
 * Prefer native insertText to preserve the browser's Undo history and normal
 * React onChange/autosave path. Fall back to the native value setter + input
 * event if execCommand is not supported by a particular browser.
 */
export function insertTimeIntoField(field, time, doc = field?.ownerDocument) {
  if (!isTimeInsertField(field)) return false;

  const before = field.value;
  const start = field.selectionStart;
  const end = field.selectionEnd;
  const expected = before.slice(0, start) + time + before.slice(end);
  let inputFired = false;
  const noteInput = () => { inputFired = true; };
  field.addEventListener("input", noteInput);
  let nativeInserted = false;
  try {
    nativeInserted = Boolean(doc?.execCommand?.("insertText", false, time));
  } catch {
    // Browsers without the legacy editing command use the fallback below.
  } finally {
    field.removeEventListener("input", noteInput);
  }

  if (!nativeInserted || field.value !== expected) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field), "value",
    )?.set;
    if (nativeSetter) nativeSetter.call(field, expected);
    else field.value = expected;
    field.setSelectionRange(start + time.length, start + time.length);
    inputFired = false;
  }

  // Some execCommand implementations do not dispatch input. React's controlled
  // field still needs the same event as ordinary typing to update its draft.
  if (!inputFired) field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
