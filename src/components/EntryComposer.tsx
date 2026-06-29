import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  type EntryKind,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_PLACEHOLDER,
} from "../types/memo";

export type EntryComposerHandle = {
  focus: (options?: { scroll?: boolean; delay?: number }) => void;
};

type EntryComposerProps = {
  kind: EntryKind;
  disabled?: boolean;
  targetLabel?: string | null;
  onClearTarget?: () => void;
  onSubmit: (content: string) => Promise<unknown> | unknown;
};

type ParagraphResizeOptions = {
  /**
   * 通常入力中は高さを縮めない。iPhone Safariでキーボード表示中に
   * ページ位置が少しずつ補正されるのを避けるため、縮小は送信後・blur時だけにする。
   */
  allowShrink?: boolean;
};

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
      onClearTarget,
      onSubmit,
    },
    ref,
  ) {
    const [value, setValue] = useState("");
    const [isComposing, setIsComposing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const paragraphResizeFrameRef = useRef<number | null>(null);
    const isComposingRef = useRef(false);
    const isParagraph = kind === "paragraph";
    const canSubmit = value.trim().length > 0 && !disabled && !isSubmitting;

    useEffect(() => {
      return () => {
        if (paragraphResizeFrameRef.current !== null) {
          window.cancelAnimationFrame(paragraphResizeFrameRef.current);
        }
      };
    }, []);

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

    const submit = async () => {
      const content = value.trim();

      if (!content || isSubmitting || disabled) return;

      setIsSubmitting(true);

      try {
        await onSubmit(content);
        setValue("");
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

        {isParagraph ? (
          <p id="paragraph-shortcut-hint" className="entry-composer__hint">
            Enterで改行。Shift＋Enter／Ctrl＋Enterで置く。
          </p>
        ) : null}
      </form>
    );
  },
);
