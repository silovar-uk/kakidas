import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import {
  type EntryKind,
  type EntryTreeNode,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_MOVE_TARGETS,
} from "../types/memo";

type MobileEntryActionSheetProps = {
  entry: EntryTreeNode | null;
  kind: EntryKind;
  /** 見出しに振り番を含めるか。 */
  showEntryNumbers: boolean;
  /** タグでまとめる表示では、親のグループ内番号を受け取る。 */
  displayNumber?: string;
  disabled?: boolean;
  onClose: () => void;
  onToggleCompleted: (entryId: string) => Promise<unknown> | unknown;
  /** falseを返した場合は、確認を取り消したものとしてシートを閉じない。 */
  onMoveToKind: (
    entryId: string,
    targetKind: EntryKind,
  ) => Promise<unknown | false> | unknown | false;
  /** 「…」から本文をそのままコピーする。 */
  onCopy: (entryId: string) => Promise<unknown | false> | unknown | false;
  /** 元の項目を残したまま、新しいメモの起点として複製する。 */
  onCreateMemoFromEntry: (entryId: string) => Promise<unknown | false> | unknown | false;
  onDelete: (entryId: string) => Promise<unknown> | unknown;
};

/**
 * 単語 / 文 / 段落のモバイル操作シート。
 * 「…」から本文を個別コピーできる。コピー後はシートを閉じる。
 */
export function MobileEntryActionSheet({
  entry,
  kind,
  showEntryNumbers,
  displayNumber,
  disabled = false,
  onClose,
  onToggleCompleted,
  onMoveToKind,
  onCopy,
  onCreateMemoFromEntry,
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

  const moveTargets = ENTRY_KIND_MOVE_TARGETS[kind];
  const visibleNumber = displayNumber ?? entry.outline_number;
  const titleText = kind === "paragraph" && entry.heading ? entry.heading : entry.content;
  const close = () => onCloseRef.current();

  const run = async (
    action: () => Promise<unknown | false> | unknown | false,
    { keepOpen = false }: { keepOpen?: boolean } = {},
  ) => {
    if (disabled || isWorking) return;

    setIsWorking(true);

    let shouldClose = !keepOpen;

    try {
      const result = await action();
      // 確認をキャンセルした場合は、操作内容を見直せるようシートを残す。
      shouldClose = !keepOpen && result !== false;
    } catch {
      // 保存・削除処理側のエラー表示を妨げない。
      shouldClose = false;
    } finally {
      if (shouldClose) close();
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
              {showEntryNumbers ? `${visibleNumber} ${titleText}` : titleText}
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

        <button
          type="button"
          className="mobile-action-sheet__copy"
          onClick={() => void run(() => onCopy(entry.id))}
          disabled={disabled || isWorking}
        >
          <span aria-hidden="true">⧉</span>
          コピー
        </button>

        <button
          type="button"
          className="mobile-action-sheet__derive"
          onClick={() => void run(() => onCreateMemoFromEntry(entry.id))}
          disabled={disabled || isWorking}
        >
          <span aria-hidden="true">↗</span>
          新しいメモにする
        </button>

        {moveTargets.length > 0 ? (
          <section className="mobile-action-sheet__section" aria-label="区分を移動">
            <p className="mobile-action-sheet__section-label">移動先</p>
            <div className="mobile-action-sheet__grid">
              {moveTargets.map((targetKind) => (
                <button
                  key={targetKind}
                  type="button"
                  className={`mobile-action-sheet__tile mobile-action-sheet__tile--kind mobile-action-sheet__tile--kind-${targetKind}`}
                  onClick={() =>
                    void run(() => onMoveToKind(entry.id, targetKind))
                  }
                  disabled={disabled || isWorking}
                >
                  {ENTRY_KIND_LABEL[targetKind]}へ移動
                </button>
              ))}
            </div>
          </section>
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
