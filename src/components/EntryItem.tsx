import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type EntryKind,
  type EntryTreeNode,
  supportsHierarchy,
} from "../types/memo";

type EntryItemProps = {
  entry: EntryTreeNode;
  kind: EntryKind;
  isStructureOpen: boolean;
  disabled?: boolean;
  onToggleStructure: (entryId: string) => void;
  onAddChild: (entryId: string) => void;
  onIndent: (entryId: string) => Promise<unknown>;
  onOutdent: (entryId: string) => Promise<unknown>;
  onMove: (entryId: string, direction: "up" | "down") => Promise<unknown>;
  onUpdate: (entryId: string, content: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
};

export function EntryItem({
  entry,
  kind,
  isStructureOpen,
  disabled = false,
  onToggleStructure,
  onAddChild,
  onIndent,
  onOutdent,
  onMove,
  onUpdate,
  onDelete,
}: EntryItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(entry.content);
  const [isComposing, setIsComposing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const isParagraph = kind === "paragraph";
  const isHierarchical = supportsHierarchy(kind);

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
    const descendantNotice = entry.child_count
      ? `\n子項目 ${entry.child_count}件も一緒に削除されます。`
      : "";

    const confirmed = window.confirm(
      `この項目を削除しますか？${descendantNotice}`,
    );

    if (!confirmed) return;

    await onDelete(entry.id);
  };

  const style = {
    "--entry-depth": Math.min(entry.depth, 6),
  } as CSSProperties;

  if (isEditing) {
    return (
      <article
        className={`entry-item entry-item--editing ${
          isHierarchical ? "entry-item--hierarchical" : ""
        }`}
        style={style}
      >
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
            onMouseDown={(event) => {
              event.preventDefault();
              cancel();
            }}
          >
            取り消す
          </button>

          <button
            type="button"
            className="text-button text-button--strong"
            onMouseDown={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            保存
          </button>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`entry-item ${
        isHierarchical ? "entry-item--hierarchical" : ""
      } ${isStructureOpen ? "entry-item--structure-open" : ""}`}
      style={style}
    >
      <div className="entry-item__row">
        {isHierarchical ? (
          <span className="entry-item__tree-marker" aria-hidden="true" />
        ) : null}

        <button
          type="button"
          className="entry-item__content"
          onClick={() => setIsEditing(true)}
          disabled={disabled}
          aria-label="編集する"
        >
          {entry.content}
        </button>

        {isHierarchical ? (
          <button
            type="button"
            className="icon-button entry-item__structure-button"
            onClick={() => onToggleStructure(entry.id)}
            disabled={disabled}
            aria-label={isStructureOpen ? "構造操作を閉じる" : "構造操作を開く"}
            aria-expanded={isStructureOpen}
            title="子の追加・並び替え・階層操作"
          >
            ⋯
          </button>
        ) : (
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
        )}
      </div>

      {isHierarchical && isStructureOpen ? (
        <div className="entry-item__structure-actions" aria-label="構造操作">
          <button
            type="button"
            className="structure-action structure-action--child"
            onClick={() => onAddChild(entry.id)}
            disabled={disabled}
          >
            ＋ 子を追加
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onMove(entry.id, "up")}
            disabled={disabled || !entry.can_move_up}
            title="同じ階層で上へ移動"
          >
            ↑ 上へ
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onMove(entry.id, "down")}
            disabled={disabled || !entry.can_move_down}
            title="同じ階層で下へ移動"
          >
            ↓ 下へ
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onOutdent(entry.id)}
            disabled={disabled || !entry.can_outdent}
            title="親と同じ階層に戻す"
          >
            ← 戻す
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onIndent(entry.id)}
            disabled={disabled || !entry.can_indent}
            title="ひとつ上の項目の子にする"
          >
            → 下げる
          </button>

          <button
            type="button"
            className="structure-action structure-action--danger"
            onClick={() => void remove()}
            disabled={disabled}
          >
            削除
          </button>
        </div>
      ) : null}
    </article>
  );
}
