import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { type EntryKind, type EntryRow } from "../types/memo";

type EntryItemProps = {
  entry: EntryRow;
  kind: EntryKind;
  disabled?: boolean;
  onUpdate: (entryId: string, content: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
};

export function EntryItem({
  entry,
  kind,
  disabled = false,
  onUpdate,
  onDelete,
}: EntryItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(entry.content);
  const [isComposing, setIsComposing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const isParagraph = kind === "paragraph";

  useEffect(() => {
    setValue(entry.content);
  }, [entry.content]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const save = async () => {
    const nextValue = value.trim();

    if (!nextValue || nextValue === entry.content || isSaving) {
      setValue(entry.content);
      setIsEditing(false);
      return;
    }

    setIsSaving(true);

    try {
      await onUpdate(entry.id, nextValue);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const cancel = () => {
    setValue(entry.content);
    setIsEditing(false);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing || isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (!isParagraph && event.key === "Enter") {
      event.preventDefault();
      void save();
      return;
    }

    if (
      isParagraph &&
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      void save();
    }
  };

  const remove = async () => {
    const confirmed = window.confirm("この項目を削除しますか？");

    if (!confirmed) return;

    await onDelete(entry.id);
  };

  if (isEditing) {
    return (
      <article className="entry-item entry-item--editing">
        {isParagraph ? (
          <textarea
            ref={(element) => {
              inputRef.current = element;
            }}
            value={value}
            disabled={disabled || isSaving}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onBlur={() => void save()}
            rows={4}
            aria-label="Paragraphを編集"
          />
        ) : (
          <input
            ref={(element) => {
              inputRef.current = element;
            }}
            value={value}
            disabled={disabled || isSaving}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onBlur={() => void save()}
            aria-label={`${kind}を編集`}
          />
        )}

        <div className="entry-item__edit-actions">
          <button
            type="button"
            className="text-button"
            onMouseDown={cancel}
          >
            取り消す
          </button>

          <button
            type="button"
            className="text-button text-button--strong"
            onMouseDown={() => void save()}
          >
            保存
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="entry-item">
      <button
        type="button"
        className="entry-item__content"
        onClick={() => setIsEditing(true)}
        disabled={disabled}
        aria-label="編集する"
      >
        {entry.content}
      </button>

      <button
        type="button"
        className="icon-button entry-item__delete"
        onClick={() => void remove()}
        disabled={disabled}
        aria-label="削除する"
        title="削除する"
      >
        ×
      </button>
    </article>
  );
}
