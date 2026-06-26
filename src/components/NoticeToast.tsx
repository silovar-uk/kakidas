import { useEffect, useRef } from "react";

type NoticeToastProps = {
  /** 表示する一時通知。nullなら何も描画しない。 */
  message: string | null;
  /** 自動消去・手動消去の両方で呼ぶ。 */
  onDismiss: () => void;
  /** 0以下で自動消去を止められる。通常は5秒。 */
  autoDismissMs?: number;
  /** ダイアログ内など、置き場所固有の余白を足すための追加class。 */
  className?: string;
};

const DEFAULT_AUTO_DISMISS_MS = 5_000;

/**
 * 保存・コピー・削除などの完了を短時間だけ伝える通知。
 * 本文の流れを遮らず、数秒後に消え、必要なら×で即時に閉じられる。
 */
export function NoticeToast({
  message,
  onDismiss,
  autoDismissMs = DEFAULT_AUTO_DISMISS_MS,
  className = "",
}: NoticeToastProps) {
  // 親の再描画でコールバックの参照が変わっても、同じ通知のタイマーを延長しない。
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message || autoDismissMs <= 0) return;

    const timeoutId = window.setTimeout(() => {
      onDismissRef.current();
    }, autoDismissMs);

    return () => window.clearTimeout(timeoutId);
  }, [autoDismissMs, message]);

  if (!message) return null;

  const classes = ["notice", "notice--dismissible", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="status" aria-live="polite">
      <span className="notice__message">{message}</span>
      <button
        type="button"
        className="notice__dismiss"
        onClick={onDismiss}
        aria-label="通知を閉じる"
      >
        ×
      </button>
    </div>
  );
}
