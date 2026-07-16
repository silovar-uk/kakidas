import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getRecommendedMemoTags,
  type MemoTagSummary,
} from "../lib/memoTags";
import { normalizeMemoTag } from "../types/memo";

type MemoTagControlProps = {
  tag: string | null;
  suggestions: MemoTagSummary[];
  disabled?: boolean;
  onSave: (tag: string | null) => Promise<void>;
};

/**
 * メモにはタグをひとつだけ置く。自由入力を主役にし、既存タグは候補として添える。
 * 入力中に勝手に保存せず、Enter・候補タップ・保存ボタンで確定する。
 */
export function MemoTagControl({
  tag,
  suggestions,
  disabled = false,
  onSave,
}: MemoTagControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(tag ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setValue(tag ?? "");
    }
  }, [isEditing, tag]);

  const recommended = useMemo(
    () => getRecommendedMemoTags(suggestions, value),
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

    const nextTag = normalizeMemoTag(nextValue);
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
        caught instanceof Error
          ? caught.message
          : "タグを保存できませんでした。",
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

  if (!isEditing) {
    return (
      <div className="memo-tag-control" aria-label="メモのタグ">
        {tag ? (
          <>
            <button
              type="button"
              className="memo-tag-chip memo-tag-chip--editable"
              disabled={disabled}
              onClick={() => {
                setErrorMessage(null);
                setIsEditing(true);
              }}
              aria-label={`タグ「${tag}」を編集`}
            >
              #{tag}
            </button>
            <button
              type="button"
              className="memo-tag-control__remove"
              disabled={disabled}
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
            onClick={() => {
              setErrorMessage(null);
              setIsEditing(true);
            }}
          >
            ＋ タグ
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="memo-tag-control memo-tag-control--editing" aria-label="タグを編集">
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
            placeholder="例：面接"
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
        <p className="memo-tag-control__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {recommended.length > 0 ? (
        <div className="memo-tag-control__suggestions" aria-label="過去のタグ候補">
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
