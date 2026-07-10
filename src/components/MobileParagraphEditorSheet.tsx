import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";
import {
  type EntryTreeNode,
  type EntryUpdate,
  normalizeLinkUrlForSave,
} from "../types/memo";

type MobileParagraphEditorFocus = "heading" | "content" | "note" | "link";

type MobileParagraphEditorSheetProps = {
  entry: EntryTreeNode | null;
  /** 見出しに振り番を含めるか。 */
  showEntryNumbers: boolean;
  /** タグでまとめる表示では、親からグループ内番号を受け取る。 */
  displayNumber?: string;
  initialFocus: MobileParagraphEditorFocus;
  disabled?: boolean;
  onClose: () => void;
  onSave: (entryId: string, patch: EntryUpdate) => Promise<unknown> | unknown;
};

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.4 13.6a4.3 4.3 0 0 0 6.1 0l2.3-2.3a4.3 4.3 0 0 0-6.1-6.1l-1.3 1.3" />
      <path d="M13.6 10.4a4.3 4.3 0 0 0-6.1 0l-2.3 2.3a4.3 4.3 0 0 0 6.1 6.1l1.3-1.3" />
    </svg>
  );
}

function readCssPixel(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * スマホの段落編集専用シート。
 * 画面全体のスクロールを止め、段落本文だけを必要な高さまで伸ばす。
 * 長文だけは本文欄の内部スクロールへ切り替えるため、キーボード中に
 * 背景の一覧が少しずつ押し上がる挙動を避けられる。
 */
export function MobileParagraphEditorSheet({
  entry,
  showEntryNumbers,
  displayNumber,
  initialFocus,
  disabled = false,
  onClose,
  onSave,
}: MobileParagraphEditorSheetProps) {
  const [content, setContent] = useState(() => entry?.content ?? "");
  const [heading, setHeading] = useState(() => entry?.heading ?? "");
  const [note, setNote] = useState(() => entry?.note ?? "");
  const [linkUrl, setLinkUrl] = useState(() => entry?.link_url ?? "");
  const [showNoteEditor, setShowNoteEditor] = useState(
    () => initialFocus === "note" || Boolean(entry?.note.trim()),
  );
  const [showLinkEditor, setShowLinkEditor] = useState(
    () => initialFocus === "link" || Boolean(entry?.link_url.trim()),
  );
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const dialogRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!entry) return;

    setContent(entry.content);
    setHeading(entry.heading);
    setNote(entry.note);
    setLinkUrl(entry.link_url);
    setShowNoteEditor(initialFocus === "note" || Boolean(entry.note.trim()));
    setShowLinkEditor(initialFocus === "link" || Boolean(entry.link_url.trim()));
    setLinkError(null);
    setIsSaving(false);
    setIsComposing(false);
    isComposingRef.current = false;
  }, [entry?.id, entry?.content, entry?.heading, entry?.link_url, entry?.note, initialFocus]);

  useEffect(() => {
    if (!entry) return;

    const releaseScrollLock = lockBodyScroll();
    const close = () => onCloseRef.current();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) close();
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

    return () => {
      releaseScrollLock();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("popstate", close);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      desktopMediaQuery.removeEventListener("change", onViewportChange);
    };
  }, [entry, isSaving]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  const adjustTextareaHeight = ({ allowShrink = false } = {}) => {
    const textarea = contentRef.current;
    if (!textarea) return;

    const computedStyle = window.getComputedStyle(textarea);
    const minHeight = readCssPixel(computedStyle.minHeight) ?? 240;
    const maxHeight = readCssPixel(computedStyle.maxHeight) ?? Number.POSITIVE_INFINITY;
    const currentHeight = textarea.getBoundingClientRect().height;

    // 編集を開始した直後だけ自然高を測り直す。入力中は伸ばすだけにする。
    if (allowShrink) {
      textarea.style.height = "auto";
    }

    const contentHeight = textarea.scrollHeight;
    const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

    if (allowShrink || nextHeight > currentHeight + 0.5) {
      textarea.style.height = `${nextHeight}px`;
    }

    const nextOverflow = contentHeight > maxHeight + 0.5 ? "auto" : "hidden";
    if (textarea.style.overflowY !== nextOverflow) {
      textarea.style.overflowY = nextOverflow;
    }
  };

  const scheduleTextareaResize = ({ allowShrink = false } = {}) => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      adjustTextareaHeight({ allowShrink });
    });
  };

  useEffect(() => {
    if (!entry) return;

    const frame = window.requestAnimationFrame(() => {
      scheduleTextareaResize({ allowShrink: true });

      if (initialFocus === "heading") {
        headingRef.current?.focus();
      } else if (initialFocus === "note") {
        noteRef.current?.focus();
      } else if (initialFocus === "link") {
        linkRef.current?.focus();
      } else {
        contentRef.current?.focus();
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [entry?.id, initialFocus, showLinkEditor, showNoteEditor]);

  if (!entry || typeof document === "undefined") return null;

  const visibleNumber = displayNumber ?? entry.outline_number;
  const trimmedContent = content.trim();
  const canSave = trimmedContent.length > 0 && !disabled && !isSaving;

  const close = () => onCloseRef.current();

  const save = async () => {
    if (!canSave) return;

    let normalizedLink = "";

    try {
      normalizedLink = normalizeLinkUrlForSave(linkUrl);
      setLinkError(null);
    } catch (error) {
      setShowLinkEditor(true);
      setLinkError(error instanceof Error ? error.message : "リンクのURLを確認してください。");
      return;
    }

    const patch: EntryUpdate = {};
    if (trimmedContent !== entry.content) patch.content = trimmedContent;
    if (heading.trim() !== entry.heading) patch.heading = heading.trim();
    if (note.trim() !== entry.note) patch.note = note.trim();
    if (normalizedLink !== entry.link_url) patch.link_url = normalizedLink;

    setIsSaving(true);

    try {
      if (Object.keys(patch).length > 0) {
        await onSave(entry.id, patch);
      }
      close();
    } catch {
      // 親の保存エラー表示を妨げず、編集内容はシート内に残す。
    } finally {
      setIsSaving(false);
    }
  };

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(event.target.value);

    if (!isComposingRef.current) {
      scheduleTextareaResize();
    }
  };

  const handleContentKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  const handleNoteKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  const handleLinkKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };

  const sheet = (
    <div className="mobile-paragraph-editor" role="presentation">
      <button
        type="button"
        className="mobile-paragraph-editor__backdrop"
        aria-label="段落編集を閉じる"
        disabled={isSaving}
        onPointerDown={close}
      />

      <section
        ref={dialogRef}
        className="mobile-paragraph-editor__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-paragraph-editor-title"
        tabIndex={-1}
      >
        <div className="mobile-paragraph-editor__grabber" aria-hidden="true" />

        <header className="mobile-paragraph-editor__header">
          <button
            type="button"
            className="mobile-paragraph-editor__cancel"
            disabled={isSaving}
            onClick={close}
          >
            閉じる
          </button>

          <div className="mobile-paragraph-editor__heading">
            <p>段落を編集</p>
            <h2 id="mobile-paragraph-editor-title">
              {entry.heading || `${showEntryNumbers ? `${visibleNumber} ` : ""}全文を見ながら書く`}
            </h2>
          </div>

          <button
            type="button"
            className="mobile-paragraph-editor__save"
            disabled={!canSave}
            onClick={() => void save()}
          >
            {isSaving ? "保存中…" : "保存"}
          </button>
        </header>

        <div className="mobile-paragraph-editor__body">
          <div className="mobile-paragraph-editor__context" aria-label="項目の情報">
            {showEntryNumbers ? <span>{visibleNumber}</span> : null}
            {entry.tag ? (
              <span className={`mobile-paragraph-editor__tag ${getEntryTagToneClassName(entry.tag)}`}>
                #{entry.tag}
              </span>
            ) : null}
          </div>

          <label className="mobile-paragraph-editor__title-field">
            <span>段落タイトル（任意）</span>
            <input
              ref={headingRef}
              type="text"
              value={heading}
              disabled={disabled || isSaving}
              placeholder="タイトルを入れる"
              onChange={(event) => setHeading(event.target.value)}
              aria-label="段落タイトルを編集"
            />
          </label>

          <textarea
            ref={contentRef}
            className="mobile-paragraph-editor__textarea"
            value={content}
            disabled={disabled || isSaving}
            rows={8}
            onChange={handleContentChange}
            onKeyDown={handleContentKeyDown}
            onCompositionStart={() => {
              setIsComposing(true);
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              setIsComposing(false);
              isComposingRef.current = false;
              scheduleTextareaResize();
            }}
            aria-label="段落を編集"
          />

          <div className="mobile-paragraph-editor__meta-actions" aria-label="補助情報">
            <button
              type="button"
              className={showNoteEditor || note.trim() ? "is-active" : ""}
              disabled={disabled || isSaving}
              onClick={() => {
                setShowNoteEditor((open) => !open);
                setShowLinkEditor(false);
              }}
            >
              気持ち{note.trim() ? "・備考" : "を追加"}
            </button>
            <button
              type="button"
              className={showLinkEditor || linkUrl.trim() ? "is-active" : ""}
              disabled={disabled || isSaving}
              onClick={() => {
                setShowLinkEditor((open) => !open);
                setShowNoteEditor(false);
              }}
            >
              <LinkIcon />
              リンク{linkUrl.trim() ? "" : "を追加"}
            </button>
          </div>

          {showNoteEditor ? (
            <label className="mobile-paragraph-editor__field">
              <span>気持ち・備考</span>
              <textarea
                ref={noteRef}
                value={note}
                disabled={disabled || isSaving}
                rows={3}
                placeholder="そのときの気持ち・補足"
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={handleNoteKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
              />
            </label>
          ) : null}

          {showLinkEditor ? (
            <label className="mobile-paragraph-editor__field">
              <span>リンク</span>
              <div className="mobile-paragraph-editor__link-input">
                <LinkIcon />
                <input
                  ref={linkRef}
                  type="url"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={linkUrl}
                  disabled={disabled || isSaving}
                  placeholder="https://..."
                  aria-invalid={linkError ? true : undefined}
                  onChange={(event) => {
                    setLinkUrl(event.target.value);
                    setLinkError(null);
                  }}
                  onKeyDown={handleLinkKeyDown}
                />
                {linkUrl ? (
                  <button
                    type="button"
                    disabled={disabled || isSaving}
                    onClick={() => {
                      setLinkUrl("");
                      setLinkError(null);
                    }}
                    aria-label="リンクを外す"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {linkError ? <em role="alert">{linkError}</em> : null}
            </label>
          ) : null}

          <p className="mobile-paragraph-editor__shortcut">⌘ / Ctrl + Enter で保存</p>
        </div>
      </section>
    </div>
  );

  return createPortal(sheet, document.body);
}
