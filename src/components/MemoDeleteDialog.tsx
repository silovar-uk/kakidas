import { useEffect, useRef } from "react";
import { lockBodyScroll } from "../lib/bodyScrollLock";

type MemoDeleteDialogProps = {
  memo: { id: string; title: string } | null;
  isDeleting?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
};

/**
 * メモ一覧からの削除を、ブラウザ標準の confirm に頼らず明示的に確認する。
 * iPhone Safariでも確認画面と削除操作を安定させ、誤削除を防ぐ。
 */
export function MemoDeleteDialog({
  memo,
  isDeleting = false,
  onClose,
  onConfirm,
}: MemoDeleteDialogProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!memo) return;

    const releaseScrollLock = lockBodyScroll();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      releaseScrollLock();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isDeleting, memo, onClose]);

  if (!memo) return null;

  return (
    <div className="cloud-dialog memo-delete-dialog" role="presentation">
      <button
        type="button"
        className="cloud-dialog__backdrop"
        onClick={onClose}
        aria-label="メモの削除確認を閉じる"
        disabled={isDeleting}
      />

      <section
        ref={panelRef}
        className="cloud-dialog__panel memo-delete-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-delete-dialog-title"
        aria-describedby="memo-delete-dialog-description"
        tabIndex={-1}
      >
        <p className="memo-delete-dialog__eyebrow">DELETE MEMO</p>
        <h2 id="memo-delete-dialog-title">このメモを削除しますか？</h2>
        <div className="memo-delete-dialog__target">
          <strong>{memo.title}</strong>
        </div>
        <p id="memo-delete-dialog-description" className="cloud-dialog__body">
          この端末のメモ一覧から削除します。クラウドへ送ったコピーがある場合、クラウド上のメモは残ります。
        </p>
        <p className="memo-delete-dialog__hint">
          削除後に戻すには、事前に書き出したバックアップが必要です。
        </p>

        <div className="cloud-dialog__actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={isDeleting}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="danger-button memo-delete-dialog__confirm"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? "削除中…" : "削除する"}
          </button>
        </div>
      </section>
    </div>
  );
}
