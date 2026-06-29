import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { EntrySatisfactionControl } from "./EntrySatisfactionControl";
import { formatEntryCreatedAt } from "../lib/formatDate";
import {
  type EntryKind,
  type EntryMoveDirection,
  type EntryTreeNode,
  type EntryUpdate,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_MOVE_TARGETS,
  getOpenableLinkUrl,
  normalizeLinkUrlForSave,
  supportsHierarchy,
} from "../types/memo";

type StructureShortcut = "move-up" | "move-down";
type EditMode = "content" | "note" | "link" | null;

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.4 13.6a4.3 4.3 0 0 0 6.1 0l2.3-2.3a4.3 4.3 0 0 0-6.1-6.1l-1.3 1.3" />
      <path d="M13.6 10.4a4.3 4.3 0 0 0-6.1 0l-2.3 2.3a4.3 4.3 0 0 0 6.1 6.1l1.3-1.3" />
    </svg>
  );
}

type EntryItemProps = {
  entry: EntryTreeNode;
  kind: EntryKind;
  isStructureOpen: boolean;
  isMobileActionOpen: boolean;
  showCreatedAt: boolean;
  /** 表示に振り番を含めるか。 */
  showEntryNumbers: boolean;
  /** 補助情報と操作を隠し、本文だけを密に表示するか。 */
  compactView?: boolean;
  disabled?: boolean;
  onOpenStructure: (entryId: string) => void;
  onAddChild: (entryId: string) => void;
  onMove: (entryId: string, direction: EntryMoveDirection) => Promise<unknown>;
  onMoveToKind: (entryId: string, targetKind: EntryKind) => Promise<unknown>;
  /** 「…」から本文をそのままコピーする。 */
  onCopy: (entryId: string) => Promise<boolean>;
  /** 元の項目を残したまま、新しいメモの起点として複製する。 */
  onCreateMemoFromEntry: (entryId: string) => Promise<boolean>;
  onUpdate: (entryId: string, patch: EntryUpdate) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
};

/**
 * 本文と、書いたときの気持ち・補足をまとめて扱う項目。
 * 気持ち・備考が空のときは、表示用の行も余白も一切出さない。
 */
export function EntryItem({
  entry,
  kind,
  isStructureOpen,
  isMobileActionOpen,
  showCreatedAt,
  showEntryNumbers,
  compactView = false,
  disabled = false,
  onOpenStructure,
  onAddChild,
  onMove,
  onMoveToKind,
  onCopy,
  onCreateMemoFromEntry,
  onUpdate,
  onDelete,
}: EntryItemProps) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [value, setValue] = useState(entry.content);
  const [noteValue, setNoteValue] = useState(entry.note);
  const [linkValue, setLinkValue] = useState(entry.link_url);
  const [showNoteEditor, setShowNoteEditor] = useState(Boolean(entry.note.trim()));
  const [showLinkEditor, setShowLinkEditor] = useState(Boolean(entry.link_url.trim()));
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const contentInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const structureActionInFlightRef = useRef(false);

  const isParagraph = kind === "paragraph";
  const isHierarchical = supportsHierarchy(kind);
  const hasNote = entry.note.trim().length > 0;
  const openableLinkUrl = getOpenableLinkUrl(entry.link_url);
  const isEditing = editMode !== null;
  const completionLabel = entry.is_completed ? "未完了に戻す" : "完了にする";
  const moveTargets = ENTRY_KIND_MOVE_TARGETS[kind];

  useEffect(() => {
    if (!isEditing) {
      setValue(entry.content);
      setNoteValue(entry.note);
      setLinkValue(entry.link_url);
      setShowNoteEditor(Boolean(entry.note.trim()));
      setShowLinkEditor(Boolean(entry.link_url.trim()));
      setLinkError(null);
    }
  }, [entry.content, entry.note, entry.link_url, isEditing]);

  useEffect(() => {
    if (editMode === "content") {
      contentInputRef.current?.focus();
    }

    if (editMode === "note") {
      noteInputRef.current?.focus();
    }

    if (editMode === "link") {
      linkInputRef.current?.focus();
    }
  }, [editMode]);

  const beginContentEdit = () => {
    if (disabled) return;
    setValue(entry.content);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(Boolean(entry.note.trim()));
    setShowLinkEditor(Boolean(entry.link_url.trim()));
    setLinkError(null);
    setEditMode("content");
  };

  const beginNoteEdit = () => {
    if (disabled) return;
    setValue(entry.content);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(true);
    setShowLinkEditor(false);
    setLinkError(null);
    setEditMode("note");
  };

  const beginLinkEdit = () => {
    if (disabled) return;
    setValue(entry.content);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(false);
    setShowLinkEditor(true);
    setLinkError(null);
    setEditMode("link");
  };

  const persist = async (exitEditing = true): Promise<boolean> => {
    const nextContent = value.trim();
    const nextNote = noteValue.trim();
    let nextLinkUrl = "";

    try {
      nextLinkUrl = normalizeLinkUrlForSave(linkValue);
      setLinkError(null);
    } catch (error) {
      setShowLinkEditor(true);
      setLinkError(error instanceof Error ? error.message : "リンクのURLを確認してください。");
      return false;
    }

    if (!nextContent) {
      setValue(entry.content);
      if (exitEditing) setEditMode(null);
      return false;
    }

    const patch: EntryUpdate = {};

    if (nextContent !== entry.content) patch.content = nextContent;
    if (nextNote !== entry.note) patch.note = nextNote;
    if (nextLinkUrl !== entry.link_url) patch.link_url = nextLinkUrl;

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
    setLinkValue(entry.link_url);
    setShowNoteEditor(Boolean(entry.note.trim()));
    setShowLinkEditor(Boolean(entry.link_url.trim()));
    setLinkError(null);
    setEditMode(null);
  };

  const canRunStructureShortcut = (shortcut: StructureShortcut): boolean => {
    switch (shortcut) {
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

    const hasShiftedModifier =
      event.shiftKey && (event.ctrlKey || event.metaKey || event.altKey);

    if (!hasShiftedModifier) return null;
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

  const handleLinkKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (event.key === "Enter") {
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

  const remove = async () => {
    await onDelete(entry.id);
  };

  const advanceSatisfaction = async (nextValue: number) => {
    await onUpdate(entry.id, { satisfaction: nextValue });
  };

  const toggleCompletion = async () => {
    if (disabled || isSaving) return;

    const canContinue = isEditing ? await persist(false) : true;
    if (!canContinue) return;

    await onUpdate(entry.id, { is_completed: !entry.is_completed });
    setEditMode(null);
  };

  const style = {
    "--entry-depth": Math.min(entry.depth, 6),
  } as CSSProperties;

  const hierarchyKeyShortcuts = isHierarchical
    ? "Tab Shift+Tab Control+Shift+ArrowRight Control+Shift+ArrowLeft Control+Shift+ArrowUp Control+Shift+ArrowDown"
    : undefined;

  const createdAtLabel = formatEntryCreatedAt(entry.created_at);
  const completionClassName = entry.is_completed ? "entry-item--completed" : "";

  if (compactView) {
    return (
      <article
        className={`entry-item entry-item--compact ${completionClassName} ${
          isHierarchical ? "entry-item--hierarchical" : ""
        } ${entry.depth > 0 ? "entry-item--nested" : ""}`}
        style={style}
      >
        <p className="entry-item__compact-content" title={entry.content}>
          {entry.content}
        </p>
      </article>
    );
  }

  if (isEditing) {
    return (
      <article
        className={`entry-item entry-item--editing ${completionClassName} ${
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
              <label htmlFor={`entry-note-${entry.id}`}>気持ち・備考</label>
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
                消す
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
              placeholder="そのときの気持ち・補足"
              aria-label="気持ち・備考を編集"
            />
          </div>
        ) : editMode !== "link" ? (
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
            ＋ 気持ち・備考
          </button>
        ) : null}

        {showLinkEditor ? (
          <div className="entry-item__link-editor">
            <div className="entry-item__link-editor-control">
              <LinkIcon />
              <input
                id={`entry-link-${entry.id}`}
                ref={linkInputRef}
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={linkValue}
                disabled={disabled || isSaving}
                onChange={(event) => {
                  setLinkValue(event.target.value);
                  setLinkError(null);
                }}
                onKeyDown={handleLinkKeyDown}
                placeholder="https://..."
                aria-label="リンクURLを編集"
                aria-invalid={linkError ? true : undefined}
              />
              {linkValue ? (
                <button
                  type="button"
                  className="entry-item__remove-link"
                  disabled={disabled || isSaving}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setLinkValue("");
                    setLinkError(null);
                  }}
                  aria-label="リンクを外す"
                  title="リンクを外す"
                >
                  ×
                </button>
              ) : null}
            </div>
            {linkError ? <p className="entry-item__link-error">{linkError}</p> : null}
          </div>
        ) : null}

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
            className="text-button entry-item__complete-text"
            disabled={disabled || isSaving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void toggleCompletion()}
          >
            {entry.is_completed ? "未完了に戻す" : "完了にする"}
          </button>
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
      className={`entry-item ${completionClassName} ${
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
              aria-label="気持ち・備考を編集"
            >
              <span className="entry-item__note-label">気持ち</span>
              <span className="entry-item__note-text">{entry.note}</span>
            </button>
          ) : null}

          <div className="entry-item__inline-actions">
            <button
              type="button"
              className="entry-item__note-trigger entry-item__note-trigger--inline"
              onClick={beginNoteEdit}
              disabled={disabled}
              aria-label={hasNote ? "気持ち・備考を編集" : "気持ち・備考を追加"}
              title={hasNote ? "気持ち・備考を編集" : "気持ち・備考を追加"}
            >
              ＋
            </button>

            {openableLinkUrl ? (
              <a
                className="entry-item__link-trigger entry-item__link-trigger--active"
                href={openableLinkUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="リンクを開く"
                title="リンクを開く"
              >
                <LinkIcon />
              </a>
            ) : (
              <button
                type="button"
                className="entry-item__link-trigger"
                onClick={beginLinkEdit}
                disabled={disabled}
                aria-label="リンクを追加"
                title="リンクを追加"
              >
                <LinkIcon />
              </button>
            )}
          </div>

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
            className={`entry-item__note-trigger entry-item__note-trigger--rail ${
              hasNote ? "entry-item__note-trigger--active" : ""
            }`}
            onClick={beginNoteEdit}
            disabled={disabled || isSaving}
            aria-label={hasNote ? "気持ち・備考を編集" : "気持ち・備考を追加"}
            title={hasNote ? "気持ち・備考を編集" : "気持ち・備考を追加"}
          />

          <button
            type="button"
            className={`entry-item__complete ${
              entry.is_completed ? "entry-item__complete--active" : ""
            }`}
            onClick={() => void toggleCompletion()}
            disabled={disabled || isSaving}
            aria-pressed={entry.is_completed}
            aria-label={completionLabel}
            title={completionLabel}
          >
            {entry.is_completed ? "戻す" : "完了"}
          </button>

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
            title="操作"
          >
            ⋯
          </button>
        </div>
      </div>

      {isStructureOpen ? (
        <div className="entry-item__structure-actions" aria-label="項目の操作">
          <button
            type="button"
            className="structure-action structure-action--copy"
            onClick={() => void onCopy(entry.id)}
            disabled={disabled}
          >
            ⧉ コピー
          </button>
          <button
            type="button"
            className="structure-action structure-action--derive"
            onClick={() => void onCreateMemoFromEntry(entry.id)}
            disabled={disabled}
          >
            ↗ 新しいメモにする
          </button>
          {isHierarchical ? (
            <>
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
                className="structure-action structure-action--jump"
                onClick={() => void onMove(entry.id, "top")}
                disabled={disabled || !entry.can_move_up}
                title="一番上に移動"
              >
                ⇡ 一番上
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
                className="structure-action structure-action--jump"
                onClick={() => void onMove(entry.id, "bottom")}
                disabled={disabled || !entry.can_move_down}
                title="一番下に移動"
              >
                ⇣ 一番下
              </button>
            </>
          ) : null}
          {moveTargets.length > 0 ? (
            <div className="entry-item__kind-actions" aria-label="区分を移動">
              {moveTargets.map((targetKind) => (
                <button
                  key={targetKind}
                  type="button"
                  className={`structure-action structure-action--kind structure-action--kind-${targetKind}`}
                  onClick={() => void onMoveToKind(entry.id, targetKind)}
                  disabled={disabled}
                >
                  {ENTRY_KIND_LABEL[targetKind]}へ移動
                </button>
              ))}
            </div>
          ) : null}
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
