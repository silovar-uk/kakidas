const INDIVIDUAL_COPY_BUTTON_SELECTOR = [
  ".structure-action--copy",
  ".mobile-action-sheet__copy",
].join(", ");
const ENTRY_ITEM_SELECTOR = ".entry-item";
const MOBILE_OPEN_ENTRY_SELECTOR = ".entry-item--mobile-action-open";
const PENDING_INDIVIDUAL_COPY_WINDOW_MS = 1_500;

let pendingIndividualCopyText: string | null = null;
let pendingIndividualCopyTimer: number | null = null;

function readTrimmedText(element: Element | null | undefined): string {
  return element?.textContent?.trim() ?? "";
}

function readEntryTag(entryItem: Element): string {
  const chip = entryItem.querySelector<HTMLElement>(".entry-item__tag-chip");
  const chipLabel = chip?.getAttribute("aria-label")?.replace(/^タグ\s*/, "").trim();

  if (chipLabel) return chipLabel;

  // タグ別表示ではカード内の重複タグを隠しているため、親グループの見出しから読む。
  const groupLabel = entryItem
    .closest(".entry-list__tag-group--tag")
    ?.querySelector<HTMLElement>(".entry-list__tag-group-add-label");

  return readTrimmedText(groupLabel).replace(/^#/, "").trim();
}

function readEntryLink(entryItem: Element): string {
  const link = entryItem.querySelector<HTMLAnchorElement>(
    ".entry-item__link-trigger--active[href]",
  );

  return link?.href.trim() ?? "";
}

/**
 * 個別コピーは、再利用しやすい順で段落名・本文・タグ・リンクを並べる。
 * 未設定の項目は除外し、本文内の改行はそのまま保つ。
 */
function formatEntryCopyText(entryItem: Element): string {
  const heading = readTrimmedText(
    entryItem.querySelector(".entry-item__heading, .entry-item__compact-heading"),
  );
  const content = readTrimmedText(
    entryItem.querySelector(".entry-item__content-text, .entry-item__compact-content > span"),
  );
  const tag = readEntryTag(entryItem);
  const link = readEntryLink(entryItem);

  return [heading, content, tag ? `#${tag}` : "", link]
    .filter(Boolean)
    .join("\n");
}

function clearPendingIndividualCopyText() {
  pendingIndividualCopyText = null;

  if (pendingIndividualCopyTimer !== null) {
    window.clearTimeout(pendingIndividualCopyTimer);
    pendingIndividualCopyTimer = null;
  }
}

/**
 * Reactのコピー処理より先に対象カードを記録する。
 * モバイルの操作シートはPortal内にあるため、背景側のopen項目を対象にする。
 */
function rememberIndividualCopyTarget(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;

  const copyButton = event.target.closest(INDIVIDUAL_COPY_BUTTON_SELECTOR);
  if (!copyButton) return;

  const entryItem = copyButton.closest(ENTRY_ITEM_SELECTOR) ??
    document.querySelector(MOBILE_OPEN_ENTRY_SELECTOR);
  if (!entryItem) return;

  const nextText = formatEntryCopyText(entryItem);
  if (!nextText) return;

  clearPendingIndividualCopyText();
  pendingIndividualCopyText = nextText;
  pendingIndividualCopyTimer = window.setTimeout(
    clearPendingIndividualCopyText,
    PENDING_INDIVIDUAL_COPY_WINDOW_MS,
  );
}

if (typeof document !== "undefined") {
  document.addEventListener("click", rememberIndividualCopyTarget, true);
}

function consumeClipboardText(fallbackText: string): string {
  if (!pendingIndividualCopyText) return fallbackText;

  const nextText = pendingIndividualCopyText;
  clearPendingIndividualCopyText();
  return nextText;
}

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
  const clipboardText = consumeClipboardText(text);
  const shouldTrySelectionFirst =
    preferSelectionFallback || isAppleTouchBrowser();

  if (shouldTrySelectionFirst && copyWithTemporaryTextarea(clipboardText)) {
    return;
  }

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(clipboardText);
      return;
    } catch {
      // Safari 等で Clipboard API が拒否された場合は、下のフォールバックを使う。
    }
  }

  if (!shouldTrySelectionFirst && copyWithTemporaryTextarea(clipboardText)) {
    return;
  }

  throw new Error(
    "コピーできませんでした。ブラウザの再読み込み後、もう一度お試しください。",
  );
}
