import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import { EntryActionsPanel, type EntryActions } from "./EntryInspector";
import type { EntryMetaKind } from "./EntryMetaCard";
import type { EntryTagSummary } from "../lib/memoTags";
import { type EntryKind, type EntryTreeNode } from "../types/memo";

type MobileEntryActionSheetProps = {
  entry: EntryTreeNode | null;
  kind: EntryKind;
  /** 見出しに振り番を含めるか。 */
  showEntryNumbers: boolean;
  /** タグでまとめる表示では、親のグループ内番号を受け取る。 */
  displayNumber?: string;
  disabled?: boolean;
  tagSuggestions: EntryTagSummary[];
  actions: EntryActions;
  onClose: () => void;
  /** 気持ち・リンク・タグは、シートを閉じてから画面の上半分のカードで書く。 */
  onRequestMeta: (entryId: string, meta: EntryMetaKind) => void;
};

/**
 * アウトライン / 段落 / 参考URLのスマホ操作シート。
 * 項目の詳細(PCの小窓)と同じ中身・同じ順番で、「動かす」を一番上に置く。
 */
export function MobileEntryActionSheet({
  entry,
  kind,
  showEntryNumbers,
  displayNumber,
  disabled = false,
  tagSuggestions,
  actions,
  onClose,
  onRequestMeta,
}: MobileEntryActionSheetProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
  }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!entry || typeof document === "undefined") return null;

  const visibleNumber = displayNumber ?? entry.outline_number;
  const titleText = kind === "paragraph" && entry.heading ? entry.heading : entry.content;
  const close = () => onCloseRef.current();

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
            <p>操作</p>
            <h2 id="mobile-action-sheet-title">
              {showEntryNumbers ? `${visibleNumber} ${titleText}` : titleText}
            </h2>
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

        <EntryActionsPanel
          entry={entry}
          kind={kind}
          variant="sheet"
          disabled={disabled}
          tagSuggestions={tagSuggestions}
          actions={actions}
          onClose={close}
          onRequestMeta={onRequestMeta}
        />

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
