import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const TEMPORARY_MEMO_TRIGGER_SELECTOR =
  ".temporary-memo-trigger:not(:disabled)";
const TEMPORARY_MEMO_CLOSE_SELECTOR = ".temporary-memo-panel__close";
const TEMPORARY_MEMO_TEXTAREA_SELECTOR = ".temporary-memo-panel__textarea";
const OTHER_MODAL_SELECTOR =
  '[role="dialog"][aria-modal="true"]:not(.temporary-memo-panel)';

/**
 * Alt＋Qで、一時メモをクリック操作と同じ経路で開閉する。
 * 保存処理はTemporaryMemoDock側へ任せ、開いた直後だけ入力欄へ素早く移る。
 */
export function TemporaryMemoShortcut() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pathname.startsWith("/memos/")) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.repeat ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "q"
      ) {
        return;
      }

      const closeButton = document.querySelector<HTMLButtonElement>(
        TEMPORARY_MEMO_CLOSE_SELECTOR,
      );

      if (closeButton) {
        event.preventDefault();
        event.stopPropagation();
        closeButton.click();
        return;
      }

      // クラウド確認やショートカット説明など、別のモーダルの上には開かない。
      if (document.querySelector(OTHER_MODAL_SELECTOR)) return;

      const trigger = document.querySelector<HTMLButtonElement>(
        TEMPORARY_MEMO_TRIGGER_SELECTOR,
      );
      if (!trigger) return;

      event.preventDefault();
      event.stopPropagation();
      trigger.click();

      window.requestAnimationFrame(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          TEMPORARY_MEMO_TEXTAREA_SELECTOR,
        );
        if (!textarea) return;

        textarea.focus({ preventScroll: true });
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [pathname]);

  return null;
}
