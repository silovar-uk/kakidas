import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { copyToClipboard } from "../lib/clipboard";
import { EntrySatisfactionControl } from "./EntrySatisfactionControl";
import { formatEntryCopyText } from "../lib/entryText";
import { formatEntryCreatedAt } from "../lib/formatDate";
import {
  type EntryKind,
  type EntryTreeNode,
  type EntryUpdate,
  supportsHierarchy,
} from "../types/memo";

type StructureShortcut = "indent" | "outdent" | "move-up" | "move-down";
type CopyFeedback = "copied" | "failed" | null;
type EditMode = "content" | "note" | null;

type EntryItemProps = {
  entry: EntryTreeNode;
  kind: EntryKind;
  isStructureOpen: boolean;
  isMobileActionOpen: boolean;
  showCreatedAt: boolean;
  /** 表示・個別コピーに振り番を含めるか。 */
  showEntryNumbers: boolean;
  disabled?: boolean;
  onOpenStructure: (entryId: string) => void;
  onAddChild: (entryId: string) => void;
  onIndent: (entryId: string) => Promise<unknown>;
  onOutdent: (entryId: string) => Promise<unknown>;
  onMove: (entryId: string, direction: "up" | "down") => Promise<unknown>;
  onUpdate: (entryId: string, patch: EntryUpdate) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
};

/**
 * 本文と任意の備考をまとめて扱う項目。
 * 備考が空のときは表示用の行を一切出さない。
 */
export function EntryItem({
  entry,
  kind,
  isStructureOpen,
  isMobileActionOpen,
  showCreatedAt,
  showEntryNumbers,
  disabled = false,
  onOpenStructure,
  onAddChild,
  onIndent,
  onOutdent,
  onMove,
  onUpdate,
  onDelete,
}: EntryItemProps) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [value, setValue] = useState(entry.content);
  const [noteValue, setNoteValue] = useState(entry.note);
  const [showNoteEditor, setShowNoteEditor] = useState(Boolean(entry.note.trim()));
  const [isComposing, setIsComposing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);

  const contentInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const structureActionInFlightRef = useRef(false);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  const isParagraph = kind === "paragraph";
  const isHierarchical = supportsHierarchy(kind);
  const hasNote = entry.note.trim().length > 0;
  const isEditing = editMode !== null;

  useEffect(() => {
    if (!isEditing) {
      setValue(entry.content);
      setNoteValue(entry.note);
      setShowNoteEditor(Boolean(entry.note.trim()));
    }
  }, [entry.content, entry.note, isEditing]);

  useEffect(() => {
    if (editMode === "content") {
      contentInputRef.current?.focus();
    }

    if (editMode === "note") {
      noteInputRef.current?.focus();
    }
  }, [editMode]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const beginContentEdit = () => {
    if (disabled) return;
    setValue(entry.content);
    setNoteValue(entry.note);
    setShowNoteEditor(Boolean(entry.note.trim()));
    setEditMode("content");
  };

  const beginNoteEdit = () => {
    if (disabled) return;
    setValue(entry.content);
    setNoteValue(entry.note);
    setShowNoteEditor(true);
    setEditMode("note");
  };

  const persist = async (exitEditing = true): Promise<boolean> => {
    const nextContent = value.trim();
    const nextNote = noteValue.trim();

    if (!nextContent) {
      setValue(entry.content);
      if (exitEditing) setEditMode(null);
      return false;
    }

    const patch: EntryUpdate = {};

    if (nextContent !== entry.content) patch.content = nextContent;
    if (nextNote !== entry.note) patch.note = nextNote;

    if (Object.keys(patch).length === 0) {
      if (exitEditing) setEditMode(null);
      return true;
    }

    setIsSaving(true);

    try {
      await onUpdate(entry.id, patch);
      if (exitEditing) setEditMode(null);
      return true;
    } finally {
      setIsSaving(false);
    }
  };

  const save = async () => {
    await persist(true);
  };

  const cancel = () => {
    setValue(entry.content);
    setNoteValue(entry.note);
    setShowNoteEditor(Boolean(entry.note.trim()));
    setEditMode(null);
  };

  const canRunStructureShortcut = (shortcut: StructureShortcut): boolean => {
    switch (shortcut) {
      case "indent":
        return entry.can_indent;
      case "outdent":
        return entry.can_outdent;
      case "move-up":
        return entry.can_move_up;
      case "move-down":
        return entry.can_move_down;
    }
  };

  const runStructureShortcut = async (shortcut: StructureShortcut) => {
    if (
      !isHierarchical ||
      disabled ||
      isSaving ||
      structureActionInFlightRef.current ||
      !canRunStructureShortcut(shortcut)
    ) {
      return;
    }

    structureActionInFlightRef.current = true;

    try {
      const canContinue = await persist(false);
      if (!canContinue) return;

      if (shortcut === "indent") await onIndent(entry.id);
      if (shortcut === "outdent") await onOutdent(entry.id);
      if (shortcut === "move-up") await onMove(entry.id, "up");
      if (shortcut === "move-down") await onMove(entry.id, "down");

      window.requestAnimationFrame(() => contentInputRef.current?.focus());
    } finally {
      structureActionInFlightRef.current = false;
    }
  };

  const getStructureShortcut = (
    event: Pick<
      KeyboardEvent<Element>,
      "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
    >,
  ): StructureShortcut | null => {
    if (!isHierarchical || disabled) return null;

    if (event.key === "Tab") return event.shiftKey ? "outdent" : "indent";

    const hasShiftedModifier =
      event.shiftKey && (event.ctrlKey || event.metaKey || event.altKey);

    if (!hasShiftedModifier) return null;
    if (event.key === "ArrowRight") return "indent";
    if (event.key === "ArrowLeft") return "outdent";
    if (event.key === "ArrowUp") return "move-up";
    if (event.key === "ArrowDown") return "move-down";

    return null;
  };

  const handleStructureShortcut = (event: KeyboardEvent<Element>): boolean => {
    const shortcut = getStructureShortcut(event);
    if (!shortcut) return false;

    event.preventDefault();
    void runStructureShortcut(shortcut);
    return true;
  };

  const handleContentKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing || isComposing) return;
    if (handleStructureShortcut(event)) return;

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

  const handleNoteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      void save();
    }
  };

  const handleReadOnlyKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    void handleStructureShortcut(event);
  };

  const handleEditorBlur = (event: FocusEvent<HTMLElement>) => {
    if (!isEditing || isSaving) return;

    const nextFocusedElement = event.relatedTarget as Node | null;
    if (nextFocusedElement && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    void save();
  };

  const setCopyResult = (result: CopyFeedback) => {
    setCopyFeedback(result);

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 1600);
  };

  const copyEntry = async () => {
    if (disabled) return;

    try {
      await copyToClipboard(formatEntryCopyText(entry, showEntryNumbers));
      setCopyResult("copied");
    } catch {
      setCopyResult("failed");
    }
  };

  const remove = async () => {
    await onDelete(entry.id);
  };

  const advanceSatisfaction = async (nextValue: number) => {
    await onUpdate(entry.id, { satisfaction: nextValue });
  };

  const style = {
    "--entry-depth": Math.min(entry.depth, 6),
  } as CSSProperties;

  const hierarchyKeyShortcuts = isHierarchical
    ? "Tab Shift+Tab Control+Shift+ArrowRight Control+Shift+ArrowLeft Control+Shift+ArrowUp Control+Shift+ArrowDown"
    : undefined;

  const copyLabel =
    copyFeedback === "copied"
      ? "コピーしました"
      : copyFeedback === "failed"
        ? "コピーできませんでした"
        : "この項目をコピー";

  const createdAtLabel = formatEntryCreatedAt(entry.created_at);

  if (isEditing) {
    return (
      <article
        className={`entry-item entry-item--editing ${
          isHierarchical ? "entry-item--hierarchical" : ""
        } ${entry.depth > 0 ? "entry-item--nested" : ""}`}
        style={style}
        onBlur={handleEditorBlur}
      >
        <div className="entry-item__editor-control">
          {showEntryNumbers ? (
            <span
              className="entry-item__number entry-item__number--editing"
              aria-hidden="true"
            >
              {entry.outline_number}
            </span>
          ) : null}

          {editMode === "content" ? (
            isParagraph ? (
              <textarea
                ref={(element) => {
                  contentInputRef.current = element;
                }}
                value={value}
                disabled={disabled || isSaving}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={handleContentKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                rows={4}
                aria-label="段落を編集"
              />
            ) : (
              <input
                ref={(element) => {
                  contentInputRef.current = element;
                }}
                value={value}
                disabled={disabled || isSaving}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={handleContentKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                aria-label="項目を編集"
                aria-keyshortcuts={hierarchyKeyShortcuts}
              />
            )
          ) : (
            <p className="entry-item__editing-content">{entry.content}</p>
          )}
        </div>

        {showNoteEditor ? (
          <div className="entry-item__note-editor">
            <div className="entry-item__note-editor-header">
              <label htmlFor={`entry-note-${entry.id}`}>備考</label>
              <button
                type="button"
                className="text-button entry-item__remove-note"
                disabled={disabled || isSaving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setNoteValue("");
                  setShowNoteEditor(false);
                }}
              >
                備考を消す
              </button>
            </div>
            <textarea
              id={`entry-note-${entry.id}`}
              ref={noteInputRef}
              value={noteValue}
              disabled={disabled || isSaving}
              onChange={(event) => setNoteValue(event.target.value)}
              onKeyDown={handleNoteKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              rows={3}
              placeholder="補足を書く"
              aria-label="備考を編集"
            />
          </div>
        ) : (
          <button
            type="button"
            className="entry-item__add-note"
            disabled={disabled || isSaving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setShowNoteEditor(true);
              setEditMode("note");
            }}
          >
            ＋ 備考を追加
          </button>
        )}

        {showCreatedAt ? (
          <time
            className="entry-item__created-at entry-item__created-at--editing"
            dateTime={entry.created_at}
            aria-label={`書いた日時 ${createdAtLabel}`}
          >
            作成 {createdAtLabel}
          </time>
        ) : null}

        <div className="entry-item__edit-actions">
          <button
            type="button"
            className="text-button text-button--danger"
            onMouseDown={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            削除
          </button>
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
      } ${entry.depth > 0 ? "entry-item--nested" : ""} ${
        isStructureOpen ? "entry-item--structure-open" : ""
      } ${isMobileActionOpen ? "entry-item--mobile-action-open" : ""}`}
      style={style}
    >
      <div className="entry-item__row">
        <div className="entry-item__body">
          <button
            type="button"
            className="entry-item__content"
            onClick={beginContentEdit}
            onKeyDown={handleReadOnlyKeyDown}
            disabled={disabled}
            aria-label={
              showEntryNumbers
                ? `${entry.outline_number} ${entry.content}を編集`
                : "編集する"
            }
            aria-keyshortcuts={hierarchyKeyShortcuts}
          >
            {showEntryNumbers ? (
              <span className="entry-item__number" aria-hidden="true">
                {entry.outline_number}
              </span>
            ) : null}
            <span className="entry-item__content-text">{entry.content}</span>
          </button>

          {hasNote ? (
            <button
              type="button"
              className="entry-item__note"
              onClick={beginNoteEdit}
              disabled={disabled}
              aria-label="備考を編集"
            >
              <span className="entry-item__note-label">備考</span>
              <span className="entry-item__note-text">{entry.note}</span>
            </button>
          ) : null}

          {showCreatedAt ? (
            <time
              className="entry-item__created-at"
              dateTime={entry.created_at}
              aria-label={`書いた日時 ${createdAtLabel}`}
            >
              作成 {createdAtLabel}
            </time>
          ) : null}
        </div>

        <div className="entry-item__quick-actions">
          <EntrySatisfactionControl
            value={entry.satisfaction}
            disabled={disabled}
            onChange={advanceSatisfaction}
          />

          <button
            type="button"
            className="icon-button entry-item__quick-action entry-item__copy"
            onClick={() => void copyEntry()}
            disabled={disabled}
            aria-label={copyLabel}
            title={copyLabel}
          >
            {copyFeedback === "copied" ? "✓" : copyFeedback === "failed" ? "!" : "⧉"}
          </button>

          <button
            type="button"
            className="entry-item__note-trigger"
            onClick={beginNoteEdit}
            disabled={disabled}
            aria-label={hasNote ? "備考を編集" : "備考を追加"}
            title={hasNote ? "備考を編集" : "備考を追加"}
          >
            {hasNote ? "備考" : "＋備考"}
          </button>

          {isHierarchical ? (
            <button
              type="button"
              className="icon-button entry-item__quick-action entry-item__structure-button"
              onClick={() => onOpenStructure(entry.id)}
              disabled={disabled}
              aria-label={
                isStructureOpen || isMobileActionOpen
                  ? "操作を閉じる"
                  : "操作を開く"
              }
              aria-expanded={isStructureOpen || isMobileActionOpen}
              title="追加・移動"
            >
              ⋯
            </button>
          ) : null}

          <button
            type="button"
            className="icon-button entry-item__quick-action entry-item__delete"
            onClick={() => void remove()}
            disabled={disabled}
            aria-label="この項目を削除"
            title="この項目を削除"
          >
            ×
          </button>
        </div>
      </div>

      <span className="visually-hidden" aria-live="polite">
        {copyFeedback === "copied"
          ? "この項目をコピーしました。"
          : copyFeedback === "failed"
            ? "コピーできませんでした。"
            : ""}
      </span>

      {isHierarchical && isStructureOpen ? (
        <div className="entry-item__structure-actions" aria-label="項目の操作">
          <button
            type="button"
            className="structure-action structure-action--child"
            onClick={() => onAddChild(entry.id)}
            disabled={disabled}
          >
            ＋ 下に追加
          </button>
          <button
            type="button"
            className="structure-action"
            onClick={() => void onMove(entry.id, "up")}
            disabled={disabled || !entry.can_move_up}
            title="上へ移動"
          >
            ↑ 上へ移動
          </button>
          <button
            type="button"
            className="structure-action"
            onClick={() => void onMove(entry.id, "down")}
            disabled={disabled || !entry.can_move_down}
            title="下へ移動"
          >
            ↓ 下へ移動
          </button>
          <button
            type="button"
            className="structure-action"
            onClick={() => void onOutdent(entry.id)}
            disabled={disabled || !entry.can_outdent}
            title="左へ戻す"
          >
            ← 左へ戻す
          </button>
          <button
            type="button"
            className="structure-action"
            onClick={() => void onIndent(entry.id)}
            disabled={disabled || !entry.can_indent}
            title="右へ下げる"
          >
            → 右へ下げる
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
