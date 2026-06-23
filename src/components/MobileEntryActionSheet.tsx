import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyToClipboard } from "../lib/clipboard";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import {
  type EntryKind,
  type EntryTreeNode,
  ENTRY_KIND_LABEL,
} from "../types/memo";

type MobileEntryActionSheetProps = {
  entry: EntryTreeNode | null;
  kind: EntryKind;
  disabled?: boolean;
  onClose: () => void;
  onAddChild: (entryId: string) => Promise<unknown> | unknown;
  onIndent: (entryId: string) => Promise<unknown> | unknown;
  onOutdent: (entryId: string) => Promise<unknown> | unknown;
  onMove: (entryId: string, direction: "up" | "down") => Promise<unknown> | unknown;
  onDelete: (entryId: string) => Promise<unknown> | unknown;
};

/**
 * Word / Sentenceのモバイル操作シート。
 *
 * - 画面の通常レイアウトから切り離して body 直下へ Portal 表示する
 * - 画面遷移・タブ切替・画面非表示・ブラウザ戻るで必ず閉じる
 * - 操作の失敗時でもシートだけが前面に残らないよう、finallyで閉じる
 */
export function MobileEntryActionSheet({
  entry,
  kind,
  disabled = false,
  onClose,
  onAddChild,
  onIndent,
  onOutdent,
  onMove,
  onDelete,
}: MobileEntryActionSheetProps) {
  const [isWorking, setIsWorking] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setCopyStatus(null);
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

  const close = () => onCloseRef.current();

  const run = async (action: () => Promise<unknown> | unknown) => {
    if (disabled || isWorking) return;

    setIsWorking(true);

    try {
      await action();
    } catch {
      // 保存・削除処理側のエラー表示を妨げない。
      // 重要なのは、エラー時にも操作シートを前面に残さないこと。
    } finally {
      close();
      setIsWorking(false);
    }
  };

  const copyEntry = async () => {
    if (disabled || isWorking) return;

    try {
      await copyToClipboard(entry.content);
      setCopyStatus("コピーしました");
    } catch {
      setCopyStatus("コピーできませんでした");
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
            <p>{ENTRY_KIND_LABEL[kind]}の操作</p>
            <h2 id="mobile-action-sheet-title">{entry.content}</h2>
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
          className="mobile-action-sheet__copy"
          onClick={() => void copyEntry()}
          disabled={disabled || isWorking}
        >
          <span aria-hidden="true">⧉</span>
          この項目をコピー
        </button>
        <p className="mobile-action-sheet__copy-status" aria-live="polite">
          {copyStatus}
        </p>

        <button
          type="button"
          className="mobile-action-sheet__primary"
          onClick={() => void run(() => onAddChild(entry.id))}
          disabled={disabled || isWorking}
        >
          <span aria-hidden="true">＋</span>
          この項目の子を追加
        </button>

        <div className="mobile-action-sheet__section">
          <p className="mobile-action-sheet__section-label">順番</p>

          <div className="mobile-action-sheet__grid">
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
          </div>
        </div>

        <div className="mobile-action-sheet__section">
          <p className="mobile-action-sheet__section-label">階層</p>

          <div className="mobile-action-sheet__grid">
            <button
              type="button"
              className="mobile-action-sheet__tile"
              onClick={() => void run(() => onOutdent(entry.id))}
              disabled={disabled || isWorking || !entry.can_outdent}
            >
              <span aria-hidden="true">←</span>
              ひとつ戻す
            </button>

            <button
              type="button"
              className="mobile-action-sheet__tile"
              onClick={() => void run(() => onIndent(entry.id))}
              disabled={disabled || isWorking || !entry.can_indent}
            >
              <span aria-hidden="true">→</span>
              子にする
            </button>
          </div>
        </div>

        <button
          type="button"
          className="mobile-action-sheet__delete"
          onClick={() => void run(() => onDelete(entry.id))}
          disabled={disabled || isWorking}
        >
          この項目を削除
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
