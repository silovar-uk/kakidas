import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getRecommendedEntryTags,
  type EntryTagSummary,
} from "../lib/memoTags";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";
import { normalizeEntryTag } from "../types/memo";

type EntryTagControlVariant = "chip" | "icon";

type EntryTagControlProps = {
  tag: string | null;
  suggestions: EntryTagSummary[];
  /** iconは右側の操作列向け。タグの有無にかかわらず編集画面を開く。 */
  variant?: EntryTagControlVariant;
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
 * 項目にはタグをひとつだけ置く。
 * 通常表示は色付きチップ、グループ内・タグなしは操作列のアイコンで扱う。
 */
export function EntryTagControl({
  tag,
  suggestions,
  variant = "chip",
  disabled = false,
  onSave,
}: EntryTagControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(tag ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) setValue(tag ?? "");
  }, [isEditing, tag]);

  const recommended = useMemo(
    () => getRecommendedEntryTags(suggestions, value),
    [suggestions, value],
  );

  const closeWithoutSaving = () => {
    if (isSaving) return;
    setValue(tag ?? "");
    setErrorMessage(null);
    setIsEditing(false);
  };

  const save = async (nextValue = value) => {
    if (disabled || isSaving) return;

    const nextTag = normalizeEntryTag(nextValue);
    if (nextTag === tag) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await onSave(nextTag);
      setIsEditing(false);
    } catch (caught) {
      setErrorMessage(
        caught instanceof Error ? caught.message : "タグを保存できませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeWithoutSaving();
  };

  const openEditor = () => {
    setErrorMessage(null);
    setIsEditing(true);
  };

  const toneClassName = getEntryTagToneClassName(tag);
  const rootClassName = `entry-tag-control memo-tag-control entry-tag-control--${variant}${
    tag ? " entry-tag-control--has-tag" : ""
  }`;

  if (!isEditing) {
    if (variant === "icon") {
      const label = tag ? `タグ「${tag}」を編集` : "タグを設定";

      return (
        <div className={rootClassName} aria-label="項目のタグ">
          <button
            type="button"
            className={`entry-tag-control__icon ${tag ? toneClassName : ""}`}
            disabled={disabled}
            onClick={openEditor}
            aria-label={label}
            title={label}
          >
            <TagIcon />
          </button>
        </div>
      );
    }

    return (
      <div className={rootClassName} aria-label="項目のタグ">
        {tag ? (
          <>
            <button
              type="button"
              className={`memo-tag-chip memo-tag-chip--editable ${toneClassName}`}
              disabled={disabled}
              onClick={openEditor}
              aria-label={`タグ「${tag}」を編集`}
            >
              #{tag}
            </button>
            <button
              type="button"
              className="memo-tag-control__remove"
              disabled={disabled || isSaving}
              onClick={() => void save("")}
              aria-label={`タグ「${tag}」を外す`}
              title="タグを外す"
            >
              ×
            </button>
          </>
        ) : (
          <button
            type="button"
            className="memo-tag-control__add"
            disabled={disabled}
            onClick={openEditor}
          >
            ＋ タグ
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${rootClassName} entry-tag-control--editing memo-tag-control--editing`}
      aria-label="項目のタグを編集"
    >
      <form className="memo-tag-control__form" onSubmit={handleSubmit}>
        <label>
          <span>タグ</span>
          <input
            value={value}
            onChange={(event) => {
              setErrorMessage(null);
              setValue(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="例：後日対応"
            maxLength={30}
            autoFocus
            disabled={disabled || isSaving}
          />
        </label>
        <button
          type="submit"
          className="memo-tag-control__save"
          disabled={disabled || isSaving}
        >
          {isSaving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="memo-tag-control__cancel"
          disabled={isSaving}
          onClick={closeWithoutSaving}
        >
          キャンセル
        </button>
      </form>

      {errorMessage ? (
        <p className="memo-tag-control__error" role="alert">{errorMessage}</p>
      ) : null}

      {recommended.length > 0 ? (
        <div className="memo-tag-control__suggestions" aria-label="過去の項目タグ候補">
          <span>候補</span>
          <div>
            {recommended.map((summary) => (
              <button
                key={summary.key}
                type="button"
                disabled={disabled || isSaving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void save(summary.label)}
              >
                #{summary.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
