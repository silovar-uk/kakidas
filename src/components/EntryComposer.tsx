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
  type EntryKind,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_PLACEHOLDER,
  normalizeEntryTag,
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
  targetLabel?: string | null;
  /** 現在のメモで使われている項目タグ。新規入力時の候補だけに使う。 */
  tagSuggestions: EntryTagSummary[];
  onClearTarget?: () => void;
  onSubmit: (content: string, tag: string | null) => Promise<unknown> | unknown;
};

type ParagraphResizeOptions = {
  /**
   * 通常入力中は高さを縮めない。iPhone Safariでキーボード表示中に
   * ページ位置が少しずつ補正されるのを避けるため、縮小は送信後・blur時だけにする。
   */
  allowShrink?: boolean;
};

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.8 4.8h7.5l6.9 6.9-6.6 6.6-7.8-7.8V4.8Z" />
      <path d="M8.4 8.4h.01" />
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
      targetLabel = null,
      tagSuggestions,
      onClearTarget,
      onSubmit,
    },
    ref,
  ) {
    const [value, setValue] = useState("");
    const [tagValue, setTagValue] = useState("");
    const [tagDraft, setTagDraft] = useState("");
    const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
    const [isComposing, setIsComposing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const tagInputRef = useRef<HTMLInputElement | null>(null);
    const tagPickerRef = useRef<HTMLDivElement | null>(null);
    const paragraphResizeFrameRef = useRef<number | null>(null);
    const isComposingRef = useRef(false);
    const isParagraph = kind === "paragraph";
    const selectedTag = normalizeEntryTag(tagValue);
    const canSubmit = value.trim().length > 0 && !disabled && !isSubmitting;
    const recommendedTags = useMemo(
      () => getRecommendedEntryTags(tagSuggestions, tagDraft),
      [tagDraft, tagSuggestions],
    );

    useEffect(() => {
      return () => {
        if (paragraphResizeFrameRef.current !== null) {
          window.cancelAnimationFrame(paragraphResizeFrameRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (!isTagPickerOpen) return;

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (target && tagPickerRef.current?.contains(target)) return;
        setIsTagPickerOpen(false);
        setTagDraft(selectedTag ?? "");
      };

      document.addEventListener("pointerdown", handlePointerDown);
      const frame = window.requestAnimationFrame(() => tagInputRef.current?.focus());

      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        window.cancelAnimationFrame(frame);
      };
    }, [isTagPickerOpen, selectedTag]);

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

    const closeTagPicker = () => {
      setTagDraft(selectedTag ?? "");
      setIsTagPickerOpen(false);
    };

    const applyTag = (rawValue = tagDraft) => {
      setTagValue(normalizeEntryTag(rawValue) ?? "");
      setIsTagPickerOpen(false);
    };

    const clearTag = () => {
      setTagValue("");
      setTagDraft("");
      setIsTagPickerOpen(false);
    };

    const submit = async () => {
      const content = value.trim();

      if (!content || isSubmitting || disabled) return;

      setIsSubmitting(true);

      try {
        await onSubmit(content, selectedTag);
        setValue("");
        // 新しい項目のタグは、次の項目へ勝手に持ち越さない。
        setTagValue("");
        setTagDraft("");
        setIsTagPickerOpen(false);
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

    const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeTagPicker();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        applyTag();
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
      placeholder: targetLabel
        ? `「${targetLabel}」の下に追加`
        : ENTRY_KIND_PLACEHOLDER[kind],
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
    };

    return (
      <form className="entry-composer" onSubmit={handleSubmit}>
        {targetLabel ? (
          <div className="entry-composer__target" role="status">
            <span>
              <strong>下に追加</strong>
              <span>{`「${targetLabel}」の下`}</span>
            </span>
            <button
              type="button"
              className="entry-composer__target-clear"
              onClick={onClearTarget}
              aria-label="追加先を解除"
              title="追加先を解除"
            >
              ×
            </button>
          </div>
        ) : null}

        <div
          className={`entry-composer__control-row ${
            isParagraph ? "entry-composer__control-row--paragraph" : ""
          }`}
        >
          {isParagraph ? (
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
          <div className="entry-composer__tag-picker" ref={tagPickerRef}>
            <button
              type="button"
              className={`entry-composer__tag-trigger ${
                selectedTag ? getEntryTagToneClassName(selectedTag) : ""
              }`}
              disabled={disabled || isSubmitting}
              onClick={() => {
                setTagDraft(selectedTag ?? "");
                setIsTagPickerOpen((open) => !open);
              }}
              aria-expanded={isTagPickerOpen}
              aria-label={selectedTag ? `タグ「${selectedTag}」を変更` : "タグを付ける"}
              title={selectedTag ? "タグを変更" : "タグを付ける"}
            >
              <TagIcon />
              <span>{selectedTag ? `#${selectedTag}` : "タグ"}</span>
            </button>

            {isTagPickerOpen ? (
              <>
                <button
                  type="button"
                  className="entry-composer__tag-backdrop"
                  aria-label="タグ入力を閉じる"
                  onClick={closeTagPicker}
                />
                <div className="entry-composer__tag-popover" role="dialog" aria-label="項目タグを設定">
                <div className="entry-composer__tag-popover-header">
                  <span>この項目のタグ</span>
                  <button
                    type="button"
                    onClick={closeTagPicker}
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
                  onKeyDown={handleTagInputKeyDown}
                  placeholder="例：後日対応"
                  maxLength={30}
                  autoComplete="off"
                  aria-label="項目タグ"
                />
                {recommendedTags.length > 0 ? (
                  <div className="entry-composer__tag-suggestions" aria-label="過去の項目タグ候補">
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
                  <button type="button" className="entry-composer__tag-apply" onClick={() => applyTag()}>
                    決定
                  </button>
                </div>
                </div>
              </>
            ) : null}
          </div>

          {isParagraph ? (
            <p id="paragraph-shortcut-hint" className="entry-composer__hint">
              Enterで改行。Shift＋Enter／Ctrl＋Enterで置く。
            </p>
          ) : null}
        </div>
      </form>
    );
  },
);
