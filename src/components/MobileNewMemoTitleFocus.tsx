import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

type EditorNavigationState = {
  focusTitle?: boolean;
};

const MOBILE_EDITOR_QUERY = "(max-width: 920px)";
const TITLE_INPUT_SELECTOR = ".editor-page .memo-title-input";

/** 空のかぎ括弧を持つ初期タイトルだけを対象にする。 */
function getEmptyTitleCaretPosition(value: string): number | null {
  const openingQuoteIndex = value.lastIndexOf("「");

  if (openingQuoteIndex < 0) return null;
  if (value.indexOf("」", openingQuoteIndex + 1) !== openingQuoteIndex + 1) {
    return null;
  }

  return openingQuoteIndex + 1;
}

/**
 * iPhone Safariでは、focus直後にソフトウェアキーボードが開く過程で
 * setSelectionRangeの位置が末尾へ戻る場合がある。
 * 新規メモの初期タイトルに限り、キーボード展開後まで数回補正する。
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

      const timers: number[] = [];
      let frame: number | null = null;

      const placeCaret = () => {
        if (cancelled) return;
        // ユーザーが入力を始めた後は、カーソル位置を上書きしない。
        if (input.value !== initialValue) return;

        input.setSelectionRange(caretPosition, caretPosition);
      };

      const handleFocus = () => {
        placeCaret();
        frame = window.requestAnimationFrame(placeCaret);
      };

      input.addEventListener("focus", handleFocus);
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
