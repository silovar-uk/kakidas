import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from "react";
import { type EntryKind, ENTRY_KIND_GUIDE } from "../types/memo";

type EntryComposerProps = {
  kind: EntryKind;
  disabled?: boolean;
  onSubmit: (content: string) => Promise<unknown> | unknown;
};

export function EntryComposer({
  kind,
  disabled = false,
  onSubmit,
}: EntryComposerProps) {
  const [value, setValue] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isParagraph = kind === "paragraph";

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 132)}px`;
  };

  const submit = async () => {
    const content = value.trim();

    if (!content || isSubmitting || disabled) return;

    setIsSubmitting(true);

    try {
      await onSubmit(content);
      setValue("");
      window.requestAnimationFrame(adjustTextareaHeight);
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
      // Paragraphだけは Shift + Enter で改行。Enterは「置く」。
      if (event.shiftKey) return;

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

    if (isParagraph) {
      window.requestAnimationFrame(adjustTextareaHeight);
    }
  };

  const commonProps = {
    value,
    disabled: disabled || isSubmitting,
    placeholder: ENTRY_KIND_GUIDE[kind],
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onCompositionStart: () => setIsComposing(true),
    onCompositionEnd: () => setIsComposing(false),
  };

  return (
    <form className="entry-composer" onSubmit={handleSubmit}>
      {isParagraph ? (
        <textarea
          {...commonProps}
          ref={textareaRef}
          className="entry-composer__textarea"
          rows={4}
          aria-label="Paragraphを入力"
        />
      ) : (
        <input
          {...commonProps}
          className="entry-composer__input"
          type="text"
          aria-label={`${kind}を入力`}
        />
      )}

      <p className="entry-composer__hint">
        {isParagraph
          ? "Enterで置く ／ Shift + Enterで改行"
          : "Enterで置く"}
      </p>
    </form>
  );
}
