import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

type EditorNavigationState = {
  focusTitle?: boolean;
};

const MOBILE_EDITOR_QUERY = "(max-width: 920px)";
const TITLE_INPUT_SELECTOR = ".editor-page .memo-title-input";
const EDITOR_TAB_SELECTOR = '.editor-tabs [role="tab"]';
const PARAGRAPH_COMPOSER_SELECTOR =
  ".entry-column--paragraph .entry-composer__textarea";

/** 空のかぎ括弧を持つ初期タイトルだけを対象にする。 */
function getEmptyTitleCaretPosition(value: string): number | null {
  const openingQuoteIndex = value.lastIndexOf("「");

  if (openingQuoteIndex < 0) return null;
  if (value.indexOf("」", openingQuoteIndex + 1) !== openingQuoteIndex + 1) {
    return null;
  }

  return openingQuoteIndex + 1;
}

function activateParagraphTab(): void {
  const paragraphTab = Array.from(
    document.querySelectorAll<HTMLButtonElement>(EDITOR_TAB_SELECTOR),
  ).find((tab) => tab.textContent?.includes("段落"));

  if (!paragraphTab || paragraphTab.getAttribute("aria-selected") === "true") {
    return;
  }

  paragraphTab.click();
}

function focusParagraphComposer(): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    PARAGRAPH_COMPOSER_SELECTOR,
  );
  if (!textarea) return false;

  textarea.focus({ preventScroll: true });
  const length = textarea.value.length;
  textarea.setSelectionRange(length, length);
  return document.activeElement === textarea;
}

/**
 * スマホの新規メモは段落を選んだ状態で始める。
 * 最初は日付タイトルのかぎ括弧内へフォーカスし、確定Enterで段落入力へ移る。
 * iPhone Safariではキーボード展開中にカーソル位置が末尾へ戻ることがあるため、
 * タイトル入力中だけ数回位置を補正する。
 */
export function MobileNewMemoTitleFocus() {
  const location = useLocation();
  const handledLocationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const navigationState = location.state as EditorNavigationState | null;

    if (!navigationState?.focusTitle) return;
    if (!location.pathname.startsWith("/memos/")) return;
    if (!window.matchMedia(MOBILE_EDITOR_QUERY).matches) return;
    if (handledLocationKeyRef.current === location.key) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let cleanupInput: (() => void) | null = null;

    const attach = (): boolean => {
      const input = document.querySelector<HTMLInputElement>(TITLE_INPUT_SELECTOR);
      if (!input) return false;

      const initialValue = input.value;
      const caretPosition = getEmptyTitleCaretPosition(initialValue);
      if (caretPosition === null) return false;

      // タイトルを入力している間も、入力先として見えている区分は段落にしておく。
      activateParagraphTab();

      const timers: number[] = [];
      let frame: number | null = null;

      const placeCaret = () => {
        if (cancelled) return;
        // ユーザーが入力を始めた後や段落へ移った後は、カーソル位置を上書きしない。
        if (input.value !== initialValue || document.activeElement !== input) return;

        input.setSelectionRange(caretPosition, caretPosition);
      };

      const handleFocus = () => {
        placeCaret();
        frame = window.requestAnimationFrame(placeCaret);
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || event.isComposing) return;

        event.preventDefault();
        activateParagraphTab();

        // 段落は初期表示済みなので、ユーザー操作中に直接focusして
        // ソフトウェアキーボードを閉じずに入力先だけ切り替える。
        if (focusParagraphComposer()) return;

        // 描画がまだ追いついていない場合だけ、次のフレームでもう一度試す。
        window.requestAnimationFrame(() => {
          focusParagraphComposer();
        });
      };

      input.addEventListener("focus", handleFocus);
      input.addEventListener("keydown", handleKeyDown);
      input.focus({ preventScroll: true });
      placeCaret();
      frame = window.requestAnimationFrame(placeCaret);

      // iOSのキーボード表示アニメーション後にも位置を確認する。
      [60, 180, 360, 560].forEach((delay) => {
        timers.push(window.setTimeout(placeCaret, delay));
      });

      handledLocationKeyRef.current = location.key;

      cleanupInput = () => {
        input.removeEventListener("focus", handleFocus);
        input.removeEventListener("keydown", handleKeyDown);
        if (frame !== null) window.cancelAnimationFrame(frame);
        timers.forEach((timer) => window.clearTimeout(timer));
      };

      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (!attach()) return;
        observer?.disconnect();
        observer = null;
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      cleanupInput?.();
    };
  }, [location.key, location.pathname, location.state]);

  return null;
}
