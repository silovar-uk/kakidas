import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type EntryCreateMetadata,
  type EntryKind,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_PLACEHOLDER,
  normalizeEntryTag,
  normalizeLinkUrlForSave,
} from "../types/memo";
import {
  getRecommendedEntryTags,
  type EntryTagSummary,
} from "../lib/memoTags";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";

export type EntryComposerHandle = {
  focus: (options?: { scroll?: boolean; delay?: number }) => void;
};

type EntryComposerProps = {
  kind: EntryKind;
  disabled?: boolean;
  /** 現在のメモで使われている項目タグ。新規入力時の候補だけに使う。 */
  tagSuggestions: EntryTagSummary[];
  /** 指定時は、このタグへ直接追加する専用入力として使う。 */
  fixedTag?: string;
  /** タグ見出し直下で使う、余白を抑えた入力面。 */
  compact?: boolean;
  /** タグ見出しから開いた専用入力を閉じる。 */
  onDismiss?: () => void;
  onSubmit: (
    content: string,
    metadata: EntryCreateMetadata,
  ) => Promise<unknown> | unknown;
};

type ParagraphResizeOptions = {
  /**
   * 通常入力中は高さを縮めない。iPhone Safariでキーボード表示中に
   * ページ位置が少しずつ補正されるのを避けるため、縮小は送信後・blur時だけにする。
   */
  allowShrink?: boolean;
};

type MetaPicker = "note" | "link" | "tag" | null;

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.8 4.8h7.5l6.9 6.9-6.6 6.6-7.8-7.8V4.8Z" />
      <path d="M8.4 8.4h.01" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.5 4.8h13v14.4H9.3l-3.8 2.4V4.8Z" />
      <path d="M8.3 9h7.4M8.3 12.6h5.4" />
    </svg>
  );
}

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
 * 単語・文はEnterで置く。長文を書く段落はEnterで改行し、
 * Shift + Enter / Ctrl + Enter または明示的な「置く」ボタンで確定する。
 * 日本語IMEの変換確定Enterは、保存操作として扱わない。
 */
export const EntryComposer = forwardRef<EntryComposerHandle, EntryComposerProps>(
  function EntryComposer(
    {
      kind,
      disabled = false,
      tagSuggestions,
      fixedTag,
      compact = false,
      onDismiss,
      onSubmit,
    },
    ref,
  ) {
    const [value, setValue] = useState("");
    const [headingValue, setHeadingValue] = useState("");
    const [tagValue, setTagValue] = useState("");
    const [noteValue, setNoteValue] = useState("");
    const [linkValue, setLinkValue] = useState("");
    const [tagDraft, setTagDraft] = useState("");
    const [noteDraft, setNoteDraft] = useState("");
    const [linkDraft, setLinkDraft] = useState("");
    const [activeMetaPicker, setActiveMetaPicker] = useState<MetaPicker>(null);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const tagInputRef = useRef<HTMLInputElement | null>(null);
    const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
    const linkInputRef = useRef<HTMLInputElement | null>(null);
    const metaPickerRef = useRef<HTMLDivElement | null>(null);
    const paragraphResizeFrameRef = useRef<number | null>(null);
    const isComposingRef = useRef(false);
    const isParagraph = kind === "paragraph";
    const lockedTag = normalizeEntryTag(fixedTag);
    const selectedTag = lockedTag ?? normalizeEntryTag(tagValue);
    const hasNote = noteValue.trim().length > 0;
    const hasLink = linkValue.trim().length > 0;
    const canSubmit = value.trim().length > 0 && !disabled && !isSubmitting;
    const recommendedTags = useMemo(
      () => getRecommendedEntryTags(tagSuggestions, tagDraft),
      [tagDraft, tagSuggestions],
    );

    function resetMetaDrafts() {
      setTagDraft(selectedTag ?? "");
      setNoteDraft(noteValue);
      setLinkDraft(linkValue);
      setLinkError(null);
    }

    function closeMetaPicker() {
      resetMetaDrafts();
      setActiveMetaPicker(null);
    }

    function openMetaPicker(picker: Exclude<MetaPicker, null>) {
      if (activeMetaPicker === picker) {
        closeMetaPicker();
        return;
      }

      resetMetaDrafts();
      setActiveMetaPicker(picker);
    }

    useEffect(() => {
      return () => {
        if (paragraphResizeFrameRef.current !== null) {
          window.cancelAnimationFrame(paragraphResizeFrameRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (!activeMetaPicker) return;

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (target && metaPickerRef.current?.contains(target)) return;
        closeMetaPicker();
      };

      const focusTarget = activeMetaPicker === "tag"
        ? tagInputRef.current
        : activeMetaPicker === "note"
          ? noteInputRef.current
          : linkInputRef.current;

      document.addEventListener("pointerdown", handlePointerDown);
      const frame = window.requestAnimationFrame(() => focusTarget?.focus());

      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        window.cancelAnimationFrame(frame);
      };
    }, [activeMetaPicker, linkValue, noteValue, selectedTag]);

    useImperativeHandle(ref, () => ({
      focus: ({ scroll = true, delay = 160 } = {}) => {
        if (scroll) {
          inputRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        window.setTimeout(() => inputRef.current?.focus(), delay);
      },
    }));

    const adjustParagraphTextareaHeight = ({
      allowShrink = false,
    }: ParagraphResizeOptions = {}) => {
      const textarea = inputRef.current;

      if (!(textarea instanceof HTMLTextAreaElement)) return;

      const computedStyle = window.getComputedStyle(textarea);
      const minHeight = readCssPixel(computedStyle.minHeight) ?? 132;
      const maxHeight =
        readCssPixel(computedStyle.maxHeight) ?? Number.POSITIVE_INFINITY;
      const currentHeight = textarea.getBoundingClientRect().height;

      /**
       * 縮める時だけ自然高を測り直す。入力中にこれを行うと、
       * `0px → 実寸` の連続レイアウト変化になり、iPhone Safariが
       * 画面のスクロール位置を少しずつ動かすことがある。
       */
      if (allowShrink) {
        textarea.style.height = "auto";
      }

      const contentHeight = textarea.scrollHeight;
      const nextHeight = Math.min(
        Math.max(contentHeight, minHeight),
        maxHeight,
      );
      const shouldGrow = nextHeight > currentHeight + 0.5;
      const shouldApplyHeight = allowShrink || shouldGrow;

      if (shouldApplyHeight) {
        textarea.style.height = `${nextHeight}px`;
      }

      const nextOverflow = contentHeight > maxHeight + 0.5 ? "auto" : "hidden";
      if (textarea.style.overflowY !== nextOverflow) {
        textarea.style.overflowY = nextOverflow;
      }
    };

    const scheduleParagraphTextareaResize = (
      options: ParagraphResizeOptions = {},
    ) => {
      if (!isParagraph) return;

      if (paragraphResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(paragraphResizeFrameRef.current);
      }

      paragraphResizeFrameRef.current = window.requestAnimationFrame(() => {
        paragraphResizeFrameRef.current = null;
        adjustParagraphTextareaHeight(options);
      });
    };

    const applyTag = (rawValue = tagDraft) => {
      setTagValue(normalizeEntryTag(rawValue) ?? "");
      setActiveMetaPicker(null);
      setLinkError(null);
    };

    const clearTag = () => {
      setTagValue("");
      setTagDraft("");
      setActiveMetaPicker(null);
    };

    const applyNote = () => {
      setNoteValue(noteDraft.trim());
      setActiveMetaPicker(null);
    };

    const clearNote = () => {
      setNoteValue("");
      setNoteDraft("");
      setActiveMetaPicker(null);
    };

    const applyLink = () => {
      try {
        setLinkValue(normalizeLinkUrlForSave(linkDraft));
        setLinkError(null);
        setActiveMetaPicker(null);
      } catch (error) {
        setLinkError(
          error instanceof Error ? error.message : "リンクのURLを確認してください。",
        );
      }
    };

    const clearLink = () => {
      setLinkValue("");
      setLinkDraft("");
      setLinkError(null);
      setActiveMetaPicker(null);
    };

    const submit = async () => {
      const content = value.trim();

      if (!content || isSubmitting || disabled) return;

      let normalizedLink = "";

      try {
        normalizedLink = normalizeLinkUrlForSave(linkValue);
      } catch (error) {
        setLinkDraft(linkValue);
        setLinkError(
          error instanceof Error ? error.message : "リンクのURLを確認してください。",
        );
        setActiveMetaPicker("link");
        return;
      }

      setIsSubmitting(true);

      try {
        await onSubmit(content, {
          heading: isParagraph ? headingValue.trim() : "",
          tag: selectedTag,
          note: noteValue.trim(),
          link_url: normalizedLink,
        });
        setValue("");
        setHeadingValue("");
        // 補助情報は新しい項目へ勝手に持ち越さない。
        setTagValue("");
        setNoteValue("");
        setLinkValue("");
        setTagDraft("");
        setNoteDraft("");
        setLinkDraft("");
        setLinkError(null);
        setActiveMetaPicker(null);
        // 送信後は空の基準高へ戻してよい。入力中だけ縮小を抑える。
        scheduleParagraphTextareaResize({ allowShrink: true });
        window.requestAnimationFrame(() => inputRef.current?.focus());
      } finally {
        setIsSubmitting(false);
      }
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit();
    };

    const handleHeadingKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "Enter") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    const handleKeyDown = (
      event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key !== "Enter") return;

      // 日本語IMEの変換確定Enterを「保存」に使わない。
      if (isComposing || event.nativeEvent.isComposing) return;

      if (isParagraph) {
        // 段落は長文入力が前提。Enterは改行としてそのまま通し、
        // 明示的なショートカットだけを「置く」に使う。
        if (!event.shiftKey && !event.ctrlKey) return;

        event.preventDefault();
        void submit();
        return;
      }

      event.preventDefault();
      void submit();
    };

    const handlePickerInputKeyDown = (
      event: KeyboardEvent<HTMLInputElement>,
      apply: () => void,
    ) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMetaPicker();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    };

    const handleNoteInputKeyDown = (
      event: KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMetaPicker();
        return;
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        applyNote();
      }
    };

    const handleChange = (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setValue(event.target.value);

      /**
       * IME変換中は高さ測定を保留する。変換の各候補更新でDOMを揺らさず、
       * 変換確定後に一度だけ伸長を判定する。
       */
      if (isParagraph && !isComposingRef.current) {
        scheduleParagraphTextareaResize();
      }
    };

    const handleCompositionStart = () => {
      isComposingRef.current = true;
      setIsComposing(true);
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      setIsComposing(false);
      scheduleParagraphTextareaResize();
    };

    const commonProps = {
      value,
      disabled: disabled || isSubmitting,
      placeholder: ENTRY_KIND_PLACEHOLDER[kind],
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
    };


    return (
      <form
        className={`entry-composer ${compact ? "entry-composer--tag-group" : ""}`}
        onSubmit={handleSubmit}
      >
        {lockedTag ? (
          <div className="entry-composer__tag-group-context">
            <span
              className={`entry-composer__tag-group-context-tag ${getEntryTagToneClassName(lockedTag)}`}
            >
              <TagIcon />
              <span>#{lockedTag}</span>
            </span>
            <span className="entry-composer__tag-group-context-copy">に追加</span>
            {onDismiss ? (
              <button
                type="button"
                className="entry-composer__tag-group-context-close"
                onClick={onDismiss}
                disabled={disabled || isSubmitting}
                aria-label={`タグ「${lockedTag}」への追加を閉じる`}
                title="閉じる"
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className={`entry-composer__control-row ${
            isParagraph ? "entry-composer__control-row--paragraph" : ""
          }`}
        >
          {isParagraph ? (
            <div className="entry-composer__paragraph-fields">
              <input
                className="entry-composer__paragraph-title"
                type="text"
                value={headingValue}
                disabled={disabled || isSubmitting}
                placeholder="段落タイトル（任意）"
                onChange={(event) => setHeadingValue(event.target.value)}
                onKeyDown={handleHeadingKeyDown}
                aria-label="段落タイトルを入力"
              />
              <textarea
                {...commonProps}
              ref={(element) => {
                inputRef.current = element;
              }}
              className="entry-composer__textarea"
              rows={4}
              aria-label={`${ENTRY_KIND_LABEL[kind]}を入力`}
              aria-describedby="paragraph-shortcut-hint"
                onBlur={() => scheduleParagraphTextareaResize({ allowShrink: true })}
              />
            </div>
          ) : (
            <input
              {...commonProps}
              ref={(element) => {
                inputRef.current = element;
              }}
              className="entry-composer__input"
              type="text"
              aria-label={`${ENTRY_KIND_LABEL[kind]}を入力`}
            />
          )}

          <button
            type="submit"
            className="entry-composer__submit"
            disabled={!canSubmit}
            aria-label={`${ENTRY_KIND_LABEL[kind]}を置く`}
          >
            {isSubmitting ? "…" : "置く"}
          </button>
        </div>

        <div className="entry-composer__meta-row">
          {isParagraph ? (
            <p id="paragraph-shortcut-hint" className="entry-composer__hint">
              Enterで改行。Shift＋Enter／Ctrl＋Enterで置く。
            </p>
          ) : null}

          <div className="entry-composer__meta-controls" ref={metaPickerRef}>
            <div className="entry-composer__meta-picker">
              <button
                type="button"
                className={`entry-composer__meta-trigger ${
                  hasNote ? "entry-composer__meta-trigger--active" : ""
                }`}
                disabled={disabled || isSubmitting}
                onClick={() => openMetaPicker("note")}
                aria-expanded={activeMetaPicker === "note"}
                aria-label={hasNote ? "気持ち・備考を変更" : "気持ち・備考を付ける"}
                title={hasNote ? "気持ち・備考を変更" : "気持ち・備考を付ける"}
              >
                <NoteIcon />
                <span>{hasNote ? "気持ちあり" : "気持ち"}</span>
              </button>

              {activeMetaPicker === "note" ? (
                <>
                  <button
                    type="button"
                    className="entry-composer__meta-backdrop"
                    aria-label="気持ち・備考入力を閉じる"
                    onClick={closeMetaPicker}
                  />
                  <div
                    className="entry-composer__meta-popover"
                    role="dialog"
                    aria-label="この項目の気持ち・備考を設定"
                  >
                    <div className="entry-composer__meta-popover-header">
                      <span>この項目の気持ち・備考</span>
                      <button
                        type="button"
                        onClick={closeMetaPicker}
                        aria-label="気持ち・備考入力を閉じる"
                        title="閉じる"
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      ref={noteInputRef}
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      onKeyDown={handleNoteInputKeyDown}
                      placeholder="例：あとで確認したい"
                      rows={3}
                      aria-label="気持ち・備考"
                    />
                    <div className="entry-composer__meta-popover-actions">
                      {hasNote || noteDraft.trim() ? (
                        <button type="button" onClick={clearNote}>
                          外す
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className="entry-composer__meta-apply"
                        onClick={applyNote}
                      >
                        決定
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="entry-composer__meta-picker">
              <button
                type="button"
                className={`entry-composer__meta-trigger ${
                  hasLink ? "entry-composer__meta-trigger--active" : ""
                }`}
                disabled={disabled || isSubmitting}
                onClick={() => openMetaPicker("link")}
                aria-expanded={activeMetaPicker === "link"}
                aria-label={hasLink ? "リンクを変更" : "リンクを付ける"}
                title={hasLink ? "リンクを変更" : "リンクを付ける"}
              >
                <LinkIcon />
                <span>{hasLink ? "リンクあり" : "リンク"}</span>
              </button>

              {activeMetaPicker === "link" ? (
                <>
                  <button
                    type="button"
                    className="entry-composer__meta-backdrop"
                    aria-label="リンク入力を閉じる"
                    onClick={closeMetaPicker}
                  />
                  <div
                    className="entry-composer__meta-popover"
                    role="dialog"
                    aria-label="この項目のリンクを設定"
                  >
                    <div className="entry-composer__meta-popover-header">
                      <span>この項目のリンク</span>
                      <button
                        type="button"
                        onClick={closeMetaPicker}
                        aria-label="リンク入力を閉じる"
                        title="閉じる"
                      >
                        ×
                      </button>
                    </div>
                    <input
                      ref={linkInputRef}
                      value={linkDraft}
                      onChange={(event) => {
                        setLinkDraft(event.target.value);
                        setLinkError(null);
                      }}
                      onKeyDown={(event) => handlePickerInputKeyDown(event, applyLink)}
                      placeholder="https://example.com"
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      aria-label="リンクのURL"
                      aria-invalid={linkError ? true : undefined}
                    />
                    {linkError ? (
                      <p className="entry-composer__meta-error" role="alert">
                        {linkError}
                      </p>
                    ) : null}
                    <div className="entry-composer__meta-popover-actions">
                      {hasLink || linkDraft.trim() ? (
                        <button type="button" onClick={clearLink}>
                          外す
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className="entry-composer__meta-apply"
                        onClick={applyLink}
                      >
                        決定
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {!lockedTag ? (
              <div className="entry-composer__tag-picker">
              <button
                type="button"
                className={`entry-composer__tag-trigger ${
                  selectedTag ? getEntryTagToneClassName(selectedTag) : ""
                }`}
                disabled={disabled || isSubmitting}
                onClick={() => openMetaPicker("tag")}
                aria-expanded={activeMetaPicker === "tag"}
                aria-label={selectedTag ? `タグ「${selectedTag}」を変更` : "タグを付ける"}
                title={selectedTag ? "タグを変更" : "タグを付ける"}
              >
                <TagIcon />
                <span>{selectedTag ? `#${selectedTag}` : "タグ"}</span>
              </button>

              {activeMetaPicker === "tag" ? (
                <>
                  <button
                    type="button"
                    className="entry-composer__meta-backdrop"
                    aria-label="タグ入力を閉じる"
                    onClick={closeMetaPicker}
                  />
                  <div
                    className="entry-composer__tag-popover"
                    role="dialog"
                    aria-label="項目タグを設定"
                  >
                    <div className="entry-composer__tag-popover-header">
                      <span>この項目のタグ</span>
                      <button
                        type="button"
                        onClick={closeMetaPicker}
                        aria-label="タグ入力を閉じる"
                        title="閉じる"
                      >
                        ×
                      </button>
                    </div>
                    <input
                      ref={tagInputRef}
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => handlePickerInputKeyDown(event, applyTag)}
                      placeholder="例：後日対応"
                      maxLength={30}
                      autoComplete="off"
                      aria-label="項目タグ"
                    />
                    {recommendedTags.length > 0 ? (
                      <div
                        className="entry-composer__tag-suggestions"
                        aria-label="過去の項目タグ候補"
                      >
                        {recommendedTags.map((summary) => (
                          <button
                            key={summary.key}
                            type="button"
                            className={getEntryTagToneClassName(summary.label)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyTag(summary.label)}
                          >
                            #{summary.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="entry-composer__tag-popover-actions">
                      {selectedTag ? (
                        <button type="button" onClick={clearTag}>
                          外す
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className="entry-composer__tag-apply"
                        onClick={() => applyTag()}
                      >
                        決定
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
              </div>
            ) : null}
          </div>
        </div>

      </form>
    );
  },
);
