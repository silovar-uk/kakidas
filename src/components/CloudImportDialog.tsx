import { useEffect, useRef, useState } from "react";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import type { MemoCloudSnapshot } from "../types/memo";

type CloudImportDialogProps = {
  open: boolean;
  snapshot: MemoCloudSnapshot | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onKeepLocal: () => void;
  onImportCopy: () => Promise<void> | void;
};

/**
 * 同じIDのローカルメモが存在する場合だけ表示する安全確認。
 * 上書きは提供せず、ローカルを残すかクラウド版を複製するかだけを選べる。
 */
export function CloudImportDialog({
  open,
  snapshot,
  isSubmitting = false,
  onClose,
  onKeepLocal,
  onImportCopy,
}: CloudImportDialogProps) {
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

  if (!open || !snapshot) return null;

  const handleImportCopy = async () => {
    setError(null);

    try {
      await onImportCopy();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "クラウド版を複製して取り込めませんでした。",
      );
    }
  };

  return (
    <div className="cloud-dialog cloud-dialog--nested" role="presentation">
      <button
        type="button"
        className="cloud-dialog__backdrop"
        onClick={onClose}
        aria-label="取り込み方法の選択を閉じる"
        disabled={isSubmitting}
      />

      <section
        ref={panelRef}
        className="cloud-dialog__panel cloud-dialog__panel--import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-import-title"
        tabIndex={-1}
      >
        <button
          type="button"
          className="icon-button cloud-dialog__close"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="取り込み方法の選択を閉じる"
        >
          ×
        </button>
        <p className="cloud-dialog__eyebrow">LOCAL COPY EXISTS</p>
        <h2 id="cloud-import-title">このメモは、この端末にもあります。</h2>
        <p className="cloud-dialog__body">
          勝手に上書きはしません。ローカル版を残すか、クラウド版を別のメモとして取り込むかを選んでください。
        </p>

        <div className="cloud-import-preview">
          <strong>{snapshot.memo.title}</strong>
          <span>
            クラウドの最終更新 {new Intl.DateTimeFormat("ja-JP", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(snapshot.memo.updated_at))}
          </span>
        </div>

        {error ? <p className="error-message cloud-dialog__error">{error}</p> : null}

        <div className="cloud-dialog__actions cloud-dialog__actions--stacked">
          <button
            type="button"
            className="secondary-button"
            disabled={isSubmitting}
            onClick={onKeepLocal}
          >
            ローカル版を残す
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={isSubmitting}
            onClick={() => void handleImportCopy()}
          >
            {isSubmitting ? "取り込み中…" : "クラウド版を複製して取り込む"}
          </button>
        </div>
      </section>
    </div>
  );
}
