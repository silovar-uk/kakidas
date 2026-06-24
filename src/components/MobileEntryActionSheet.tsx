import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import { type EntryKind, type EntryTreeNode, supportsHierarchy } from "../types/memo";

type MobileEntryActionSheetProps = {
  entry: EntryTreeNode | null;
  kind: EntryKind;
  /** 見出しに振り番を含めるか。 */
  showEntryNumbers: boolean;
  disabled?: boolean;
  onClose: () => void;
  onToggleCompleted: (entryId: string) => Promise<unknown> | unknown;
  onAddChild: (entryId: string) => Promise<unknown> | unknown;
  onIndent: (entryId: string) => Promise<unknown> | unknown;
  onOutdent: (entryId: string) => Promise<unknown> | unknown;
  onMove: (entryId: string, direction: "up" | "down") => Promise<unknown> | unknown;
  onDelete: (entryId: string) => Promise<unknown> | unknown;
};

/**
 * 単語 / 文のモバイル操作シート。
 * 個別コピーは置かず、完了・階層操作・削除だけへ絞る。
 */
export function MobileEntryActionSheet({
  entry,
  kind,
  showEntryNumbers,
  disabled = false,
  onClose,
  onToggleCompleted,
  onAddChild,
  onIndent,
  onOutdent,
  onMove,
  onDelete,
}: MobileEntryActionSheetProps) {
  const [isWorking, setIsWorking] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setIsWorking(false);
  }, [entry?.id]);

  useEffect(() => {
    if (!entry) return;

    const releaseScrollLock = lockBodyScroll();
    const close = () => onCloseRef.current();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") close();
    };
    const desktopMediaQuery = window.matchMedia("(min-width: 921px)");
    const onViewportChange = () => {
      if (desktopMediaQuery.matches) close();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", close, { once: true });
    window.addEventListener("popstate", close);
    document.addEventListener("visibilitychange", onVisibilityChange);
    desktopMediaQuery.addEventListener("change", onViewportChange);

    window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      releaseScrollLock();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("popstate", close);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      desktopMediaQuery.removeEventListener("change", onViewportChange);
    };
  }, [entry]);

  if (!entry || typeof document === "undefined") return null;

  const isHierarchical = supportsHierarchy(kind);
  const close = () => onCloseRef.current();

  const run = async (action: () => Promise<unknown> | unknown) => {
    if (disabled || isWorking) return;

    setIsWorking(true);

    try {
      await action();
    } catch {
      // 保存・削除処理側のエラー表示を妨げない。
    } finally {
      close();
      setIsWorking(false);
    }
  };

  const sheet = (
    <div className="mobile-action-sheet" role="presentation">
      <button
        type="button"
        className="mobile-action-sheet__backdrop"
        aria-label="操作メニューを閉じる"
        onPointerDown={close}
      />

      <section
        ref={dialogRef}
        className="mobile-action-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-action-sheet-title"
        tabIndex={-1}
      >
        <div className="mobile-action-sheet__grabber" aria-hidden="true" />

        <header className="mobile-action-sheet__header">
          <div>
            <p>操作</p>
            <h2 id="mobile-action-sheet-title">
              {showEntryNumbers ? `${entry.outline_number} ${entry.content}` : entry.content}
            </h2>
          </div>

          <button
            type="button"
            className="icon-button mobile-action-sheet__close"
            onClick={close}
            aria-label="操作メニューを閉じる"
          >
            ×
          </button>
        </header>

        <button
          type="button"
          className={`mobile-action-sheet__complete ${
            entry.is_completed ? "mobile-action-sheet__complete--active" : ""
          }`}
          onClick={() => void run(() => onToggleCompleted(entry.id))}
          disabled={disabled || isWorking}
        >
          <span aria-hidden="true">✓</span>
          {entry.is_completed ? "未完了に戻す" : "完了にする"}
        </button>

        {isHierarchical ? (
          <>
            <button
              type="button"
              className="mobile-action-sheet__primary"
              onClick={() => void run(() => onAddChild(entry.id))}
              disabled={disabled || isWorking}
            >
              <span aria-hidden="true">＋</span>
              下に追加
            </button>

            <div className="mobile-action-sheet__grid mobile-action-sheet__grid--operations">
              <button
                type="button"
                className="mobile-action-sheet__tile"
                onClick={() => void run(() => onMove(entry.id, "up"))}
                disabled={disabled || isWorking || !entry.can_move_up}
              >
                <span aria-hidden="true">↑</span>
                上へ移動
              </button>

              <button
                type="button"
                className="mobile-action-sheet__tile"
                onClick={() => void run(() => onMove(entry.id, "down"))}
                disabled={disabled || isWorking || !entry.can_move_down}
              >
                <span aria-hidden="true">↓</span>
                下へ移動
              </button>

              <button
                type="button"
                className="mobile-action-sheet__tile"
                onClick={() => void run(() => onOutdent(entry.id))}
                disabled={disabled || isWorking || !entry.can_outdent}
              >
                <span aria-hidden="true">←</span>
                左へ戻す
              </button>

              <button
                type="button"
                className="mobile-action-sheet__tile"
                onClick={() => void run(() => onIndent(entry.id))}
                disabled={disabled || isWorking || !entry.can_indent}
              >
                <span aria-hidden="true">→</span>
                右へ下げる
              </button>
            </div>
          </>
        ) : null}

        <button
          type="button"
          className="mobile-action-sheet__delete"
          onClick={() => void run(() => onDelete(entry.id))}
          disabled={disabled || isWorking}
        >
          削除
        </button>

        <button
          type="button"
          className="mobile-action-sheet__dismiss"
          onClick={close}
        >
          閉じる
        </button>
      </section>
    </div>
  );

  return createPortal(sheet, document.body);
}
