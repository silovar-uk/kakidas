/**
 * Clipboard API が使える環境ではそちらを優先する。
 *
 * iOS Safari では、IndexedDB などの await をまたいだあとに
 * navigator.clipboard.writeText() を呼ぶと、ユーザー操作として扱われず
 * "The request is not allowed" になることがある。
 * そのため失敗時は textarea + execCommand の選択コピーへ必ずフォールバックする。
 */
export type CopyToClipboardOptions = {
  /**
   * クリックの前に非同期のデータ取得が入るケース向け。
   * 選択コピーを先に試すことで、モバイルブラウザの権限制約を避けやすくする。
   */
  preferSelectionFallback?: boolean;
};

function isAppleTouchBrowser(): boolean {
  const userAgent = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(userAgent);
  // iPadOS は Mac として見えることがある。
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  return isIOS || isIPadOS;
}

function copyWithTemporaryTextarea(text: string): boolean {
  if (typeof document.execCommand !== "function") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0.01";
  textarea.style.fontSize = "16px";
  textarea.style.pointerEvents = "none";

  const previouslyFocused = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();

    // ボタンを押した直後の見た目を保ちつつ、元のフォーカスへ戻す。
    try {
      previouslyFocused?.focus?.({ preventScroll: true });
    } catch {
      // フォーカスを戻せない要素でも、コピー結果には影響しない。
    }
  }
}

/**
 * モバイルでも失敗しにくいコピー処理。
 * Native Clipboard が拒否されても、テキスト選択方式を試してから失敗を返す。
 */
export async function copyToClipboard(
  text: string,
  { preferSelectionFallback = false }: CopyToClipboardOptions = {},
): Promise<void> {
  const shouldTrySelectionFirst =
    preferSelectionFallback || isAppleTouchBrowser();

  if (shouldTrySelectionFirst && copyWithTemporaryTextarea(text)) {
    return;
  }

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Safari 等で Clipboard API が拒否された場合は、下のフォールバックを使う。
    }
  }

  if (!shouldTrySelectionFirst && copyWithTemporaryTextarea(text)) {
    return;
  }

  throw new Error(
    "コピーできませんでした。ブラウザの再読み込み後、もう一度お試しください。",
  );
}
