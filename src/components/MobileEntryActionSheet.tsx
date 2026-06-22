import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";
import { type EntryKind, type EntryTreeNode, ENTRY_KIND_LABEL } from "../types/memo";

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
 * モバイルは、カード内に小さい操作ボタンを並べず、
 * Workflowyのように「項目を選ぶ → 下から操作する」流れへ寄せる。
 *
 * - ⋯ タップ または 項目の長押しで開く
 * - コピー・子追加・順番・階層・削除を片手で操作できる
 * - シート表示中は背景のスクロールを止める
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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCopyStatus(null);
  }, [entry?.id]);

  useEffect(() => {
    if (!entry) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [entry, onClose]);

  if (!entry) return null;

  const run = async (action: () => Promise<unknown> | unknown) => {
    if (disabled || isWorking) return;

    setIsWorking(true);

    try {
      await action();
      onClose();
    } finally {
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

  const requestDelete = async () => {
    // 子を持つ親だけ、EntryColumn側で確認する。
    // それ以外は即時削除してUndoトーストを表示する。
    await run(() => onDelete(entry.id));
  };

  return (
    <div className="mobile-action-sheet" role="presentation">
      <button
        type="button"
        className="mobile-action-sheet__backdrop"
        aria-label="操作メニューを閉じる"
        onClick={onClose}
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
            <p>{ENTRY_KIND_LABEL[kind]}を整える</p>
            <h2 id="mobile-action-sheet-title">{entry.content}</h2>
          </div>

          <button
            type="button"
            className="icon-button mobile-action-sheet__close"
            onClick={onClose}
            aria-label="閉じる"
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
          onClick={() => void requestDelete()}
          disabled={disabled || isWorking}
        >
          この項目を削除
        </button>
      </section>
    </div>
  );
}
