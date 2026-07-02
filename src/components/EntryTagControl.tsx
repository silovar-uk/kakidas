import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getRecommendedEntryTags,
  type EntryTagSummary,
} from "../lib/memoTags";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";
import { normalizeEntryTag } from "../types/memo";

type EntryTagControlProps = {
  tag: string | null;
  suggestions: EntryTagSummary[];
  disabled?: boolean;
  onSave: (tag: string | null) => Promise<void>;
};

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.8 4.8h7.5l6.9 6.9-6.6 6.6-7.8-7.8V4.8Z" />
      <path d="M8.4 8.4h.01" />
    </svg>
  );
}

/**
 * 項目タグの編集は、操作列のタグアイコンから開く小さなポップオーバーで行う。
 * 操作列の幅・カード高を変えず、PCでも一行レイアウトを崩さない。
 */
export function EntryTagControl({
  tag,
  suggestions,
  disabled = false,
  onSave,
}: EntryTagControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState(tag ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) setValue(tag ?? "");
  }, [isOpen, tag]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setValue(tag ?? "");
      setErrorMessage(null);
      setIsOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setValue(tag ?? "");
      setErrorMessage(null);
      setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen, tag]);

  const recommended = useMemo(
    () => getRecommendedEntryTags(suggestions, value),
    [suggestions, value],
  );

  const closeWithoutSaving = () => {
    if (isSaving) return;
    setValue(tag ?? "");
    setErrorMessage(null);
    setIsOpen(false);
  };

  const save = async (nextValue = value) => {
    if (disabled || isSaving) return;

    const nextTag = normalizeEntryTag(nextValue);
    if (nextTag === tag) {
      setIsOpen(false);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await onSave(nextTag);
      setIsOpen(false);
    } catch (caught) {
      setErrorMessage(
        caught instanceof Error ? caught.message : "タグを保存できませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeWithoutSaving();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };

  const label = tag ? `タグ「${tag}」を編集` : "タグを設定";
  const toneClassName = getEntryTagToneClassName(tag);

  return (
    <div
      ref={rootRef}
      className="entry-tag-control entry-tag-control--icon"
      aria-label="項目のタグ"
    >
      <button
        type="button"
        className={`entry-tag-control__icon ${tag ? toneClassName : ""}`}
        disabled={disabled || isSaving}
        onClick={() => {
          setErrorMessage(null);
          setValue(tag ?? "");
          setIsOpen((open) => !open);
        }}
        aria-label={label}
        aria-expanded={isOpen}
        title={label}
      >
        <TagIcon />
      </button>

      {isOpen ? (
        <>
          <button
            type="button"
            className="entry-tag-control__backdrop"
            aria-label="タグ入力を閉じる"
            onClick={closeWithoutSaving}
          />
          <section className="entry-tag-control__popover" role="dialog" aria-label="項目タグを編集">
            <div className="entry-tag-control__popover-header">
              <span>タグ</span>
              <button
                type="button"
                onClick={closeWithoutSaving}
                disabled={isSaving}
                aria-label="タグ入力を閉じる"
                title="閉じる"
              >
                ×
              </button>
            </div>

            <input
              ref={inputRef}
              value={value}
              onChange={(event) => {
                setErrorMessage(null);
                setValue(event.target.value);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="例：後日対応"
              maxLength={30}
              autoComplete="off"
              disabled={disabled || isSaving}
              aria-label="項目タグ"
              aria-invalid={errorMessage ? true : undefined}
            />

            {errorMessage ? (
              <p className="entry-tag-control__error" role="alert">{errorMessage}</p>
            ) : null}

            {recommended.length > 0 ? (
              <div className="entry-tag-control__suggestions" aria-label="過去の項目タグ候補">
                {recommended.map((summary) => (
                  <button
                    key={summary.key}
                    type="button"
                    className={getEntryTagToneClassName(summary.label)}
                    disabled={disabled || isSaving}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void save(summary.label)}
                  >
                    #{summary.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="entry-tag-control__popover-actions">
              {tag ? (
                <button
                  type="button"
                  className="entry-tag-control__clear"
                  disabled={disabled || isSaving}
                  onClick={() => void save("")}
                >
                  外す
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="entry-tag-control__save"
                disabled={disabled || isSaving}
                onClick={() => void save()}
              >
                {isSaving ? "保存中…" : "決定"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
