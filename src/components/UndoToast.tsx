type UndoToastProps = {
  message: string;
  isUndoing?: boolean;
  onUndo: () => void;
  onDismiss: () => void;
  kind: "word" | "sentence" | "paragraph";
  /** 見える字。省略時は「元に戻す」(削除の通知)。 */
  actionLabel?: string;
  /** 読み上げ名。見える字が短いとき(「戻す」)に、何を戻すかを伝える。 */
  actionAriaLabel?: string;
  dismissAriaLabel?: string;
};

/**
 * 削除・移動の直後だけ出る、軽量な復元導線。
 * 毎回の確認ダイアログで書き出しを止めないためのUndoトースト。
 */
export function UndoToast({
  message,
  isUndoing = false,
  onUndo,
  onDismiss,
  kind,
  actionLabel = "元に戻す",
  actionAriaLabel,
  dismissAriaLabel = "削除の通知を閉じる",
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
          aria-label={actionAriaLabel}
        >
          {isUndoing ? "復元中…" : actionLabel}
        </button>
        <button
          type="button"
          className="undo-toast__close"
          onClick={onDismiss}
          disabled={isUndoing}
          aria-label={dismissAriaLabel}
        >
          ×
        </button>
      </div>
    </div>
  );
}
