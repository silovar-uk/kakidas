import { useEffect, useRef, useState } from "react";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import type { MemoEntryCounts, MemoSyncMetaRow } from "../types/memo";

export type CloudUploadTarget = {
  id: string;
  title: string;
  entry_counts: MemoEntryCounts;
  sync_meta: MemoSyncMetaRow;
};

type CloudUploadDialogProps = {
  targets: CloudUploadTarget[];
  open: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
};

export function CloudUploadDialog({
  targets,
  open,
  isSubmitting = false,
  onClose,
  onConfirm,
}: CloudUploadDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }

    const releaseScrollLock = lockBodyScroll();
    window.requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      releaseScrollLock();
    };
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    setError(null);

    try {
      await onConfirm();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "クラウドへの送信に失敗しました。",
      );
    }
  };

  return (
    <div className="cloud-dialog" role="presentation">
      <button
        type="button"
        className="cloud-dialog__backdrop"
        onClick={onClose}
        aria-label="送信確認を閉じる"
        disabled={isSubmitting}
      />

      <section
        ref={panelRef}
        className="cloud-dialog__panel cloud-dialog__panel--upload"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-upload-title"
        tabIndex={-1}
      >
        <h2 id="cloud-upload-title">この {targets.length}件をクラウドへ送る</h2>
        <p className="cloud-dialog__body">
          下のメモだけが、ログイン中のアカウントのクラウド領域に保存されます。
          この端末のローカル保存は残ります。
        </p>

        <ul className="cloud-upload-list">
          {targets.map((target) => (
            <li key={target.id}>
              <strong>{target.title}</strong>
              <span>
                単語 {target.entry_counts.word}件 ／ 文 {target.entry_counts.sentence}件 ／ 段落 {target.entry_counts.paragraph}件
              </span>
            </li>
          ))}
        </ul>

        {error ? <p className="error-message cloud-dialog__error">{error}</p> : null}

        <div className="cloud-dialog__actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={isSubmitting}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting || targets.length === 0}
          >
            {isSubmitting ? "送信中…" : `${targets.length}件を送る`}
          </button>
        </div>
      </section>
    </div>
  );
}
