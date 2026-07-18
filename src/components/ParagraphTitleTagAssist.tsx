import { useEffect } from "react";
import { normalizeEntryTag } from "../types/memo";

const ASSIST_BUTTON_CLASS = "paragraph-title-tag-assist";
const TAG_POPOVER_SELECTOR = [
  ".entry-composer__tag-popover",
  ".entry-tag-control__popover",
].join(", ");

/** Reactの制御入力へ、通常の入力操作と同じ経路で値を渡す。 */
function setControlledInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

  if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function readParagraphTitle(popover: Element): string | null {
  const composer = popover.closest(".entry-composer");
  const composerTitle = composer?.querySelector<HTMLInputElement>(
    ".entry-composer__paragraph-title",
  )?.value;

  if (composerTitle !== undefined) {
    return normalizeEntryTag(composerTitle);
  }

  const entry = popover.closest(".entry-item");
  const savedTitle = entry?.querySelector<HTMLElement>(
    ".entry-item__heading, .entry-item__compact-heading",
  )?.textContent;

  return normalizeEntryTag(savedTitle);
}

/**
 * 新規段落ではタグを選択状態へ確定し、保存済み段落ではその場でDB保存する。
 * Reactの入力stateが更新された次の描画後に既存の決定ボタンを押すことで、
 * タグ入力欄へ留まる中間状態を作らない。
 */
function applyParagraphTitleDirectly(
  popover: Element,
  input: HTMLInputElement,
  title: string,
  assistButton: HTMLButtonElement,
) {
  const actionSelector = popover.matches(".entry-composer__tag-popover")
    ? ".entry-composer__tag-apply"
    : ".entry-tag-control__save";

  assistButton.disabled = true;
  setControlledInputValue(input, title);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const actionButton = popover.querySelector<HTMLButtonElement>(actionSelector);

      if (!actionButton || actionButton.disabled) {
        assistButton.disabled = false;
        return;
      }

      actionButton.click();
    });
  });
}

function syncAssistButton(popover: Element) {
  const input = popover.querySelector<HTMLInputElement>(
    'input[aria-label="項目タグ"]',
  );
  const title = readParagraphTitle(popover);
  const existing = popover.querySelector<HTMLButtonElement>(
    `.${ASSIST_BUTTON_CLASS}`,
  );

  if (!input || !title) {
    existing?.remove();
    return;
  }

  const button = existing ?? document.createElement("button");

  if (!existing) {
    button.type = "button";
    button.className = ASSIST_BUTTON_CLASS;
    button.textContent = "段落名をタグにする";
    button.setAttribute("aria-label", "段落名をこの項目のタグとして直接設定");
    button.title = "段落名をタグとして直接設定";
    button.addEventListener("pointerdown", (event) => {
      // 入力欄のblurでポップオーバーが先に閉じることを防ぐ。
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      const currentPopover = button.closest(TAG_POPOVER_SELECTOR);
      const currentInput = currentPopover?.querySelector<HTMLInputElement>(
        'input[aria-label="項目タグ"]',
      );
      const currentTitle = currentPopover
        ? readParagraphTitle(currentPopover)
        : null;

      if (!currentPopover || !currentInput || !currentTitle) return;
      applyParagraphTitleDirectly(currentPopover, currentInput, currentTitle, button);
    });

    input.insertAdjacentElement("afterend", button);
  }

  if (button.dataset.paragraphTitle !== title) {
    button.dataset.paragraphTitle = title;
  }
}

function syncAllAssistButtons() {
  document.querySelectorAll(TAG_POPOVER_SELECTOR).forEach(syncAssistButton);
}

/**
 * 新規段落と保存済み段落は別々のタグUIを使っている。
 * どちらのポップオーバーにも同じ直接設定操作を付け、段落以外には表示しない。
 */
export function ParagraphTitleTagAssist() {
  useEffect(() => {
    let frame: number | null = null;

    const scheduleSync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        syncAllAssistButtons();
      });
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", scheduleSync, true);
    document.addEventListener("click", scheduleSync, true);
    scheduleSync();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("input", scheduleSync, true);
      document.removeEventListener("click", scheduleSync, true);
      document
        .querySelectorAll(`.${ASSIST_BUTTON_CLASS}`)
        .forEach((button) => button.remove());
    };
  }, []);

  return null;
}
