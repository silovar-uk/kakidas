type UndoToastProps = {
  message: string;
  isUndoing?: boolean;
  onUndo: () => void;
  onDismiss: () => void;
  kind: "word" | "sentence" | "paragraph";
};

/**
 * 削除直後だけ出る、軽量な復元導線。
 * 毎回の確認ダイアログで書き出しを止めないためのUndoトースト。
 */
export function UndoToast({
  message,
  isUndoing = false,
  onUndo,
  onDismiss,
  kind,
}: UndoToastProps) {
  return (
    <div
      className={`undo-toast undo-toast--${kind}`}
      role="status"
      aria-live="polite"
    >
      <span>{message}</span>
      <div className="undo-toast__actions">
        <button
          type="button"
          className="undo-toast__undo"
          onClick={onUndo}
          disabled={isUndoing}
        >
          {isUndoing ? "復元中…" : "元に戻す"}
        </button>
        <button
          type="button"
          className="undo-toast__close"
          onClick={onDismiss}
          disabled={isUndoing}
          aria-label="削除の通知を閉じる"
        >
          ×
        </button>
      </div>
    </div>
  );
}
