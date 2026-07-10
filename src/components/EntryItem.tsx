import {
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { EntrySatisfactionControl } from "./EntrySatisfactionControl";
import { EntryTagControl } from "./EntryTagControl";
import { MobileParagraphEditorSheet } from "./MobileParagraphEditorSheet";
import { formatEntryCreatedAt } from "../lib/formatDate";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";
import type { EntryTagSummary } from "../lib/memoTags";
import {
  type EntryKind,
  type EntryTreeNode,
  type EntryUpdate,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_MOVE_TARGETS,
  getOpenableLinkUrl,
  normalizeLinkUrlForSave,
  normalizeSatisfaction,
  supportsHierarchy,
} from "../types/memo";

type EditMode = "content" | "note" | "link" | null;
type MobileParagraphEditorFocus = "heading" | "content" | "note" | "link";
/** タグの文脈に応じて、カード内ではチップか編集アイコンだけを見せる。 */
type EntryTagPresentation = "meta" | "group_action" | "completed_meta";

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.4 13.6a4.3 4.3 0 0 0 6.1 0l2.3-2.3a4.3 4.3 0 0 0-6.1-6.1l-1.3 1.3" />
      <path d="M13.6 10.4a4.3 4.3 0 0 0-6.1 0l-2.3 2.3a4.3 4.3 0 0 0 6.1 6.1l1.3-1.3" />
    </svg>
  );
}

/** 気持ち・備考を書く入口。追加と編集で見た目を変えず、常に「書く」操作として扱う。 */
function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.5 4.8h13v14.4H9.3l-3.8 2.4V4.8Z" />
      <path d="M8.3 9h7.4M8.3 12.6h5.4" />
    </svg>
  );
}

function readCssPixel(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type EntryItemProps = {
  entry: EntryTreeNode;
  kind: EntryKind;
  isStructureOpen: boolean;
  isMobileActionOpen: boolean;
  showCreatedAt: boolean;
  /** 表示に振り番を含めるか。 */
  showEntryNumbers: boolean;
  /** 現在の表示文脈で見せる振り番。タグ表示時はグループ内番号を受け取る。 */
  displayNumber?: string;
  /** 補助情報と操作を隠し、本文だけを密に表示するか。 */
  compactView?: boolean;
  /** 現在のメモで使われている項目タグ。候補表示だけに使う。 */
  tagSuggestions: EntryTagSummary[];
  /** 通常表示は気持ち行のタグ、タググループ内は右側アイコン、完了内は元タグを再表示する。 */
  tagPresentation?: EntryTagPresentation;
  disabled?: boolean;
  onOpenStructure: (entryId: string) => void;
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
  displayNumber,
  compactView = false,
  tagSuggestions,
  tagPresentation = "meta",
  disabled = false,
  onOpenStructure,
  onMoveToKind,
  onCopy,
  onCreateMemoFromEntry,
  onUpdate,
  onDelete,
}: EntryItemProps) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [value, setValue] = useState(entry.content);
  const [headingValue, setHeadingValue] = useState(entry.heading);
  const [noteValue, setNoteValue] = useState(entry.note);
  const [linkValue, setLinkValue] = useState(entry.link_url);
  const [showNoteEditor, setShowNoteEditor] = useState(Boolean(entry.note.trim()));
  const [showLinkEditor, setShowLinkEditor] = useState(Boolean(entry.link_url.trim()));
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /** 段落はスマホだけ専用編集シートに分け、背景の一覧を動かさない。 */
  const [mobileParagraphEditorFocus, setMobileParagraphEditorFocus] = useState<
    MobileParagraphEditorFocus | null
  >(null);

  const contentInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const paragraphResizeFrameRef = useRef<number | null>(null);
  const paragraphCompositionRef = useRef(false);

  const isParagraph = kind === "paragraph";
  const isHierarchical = supportsHierarchy(kind);
  const hasNote = entry.note.trim().length > 0;
  const showTagInMeta = Boolean(entry.tag) && (
    tagPresentation === "meta" || tagPresentation === "completed_meta"
  );
  const openableLinkUrl = getOpenableLinkUrl(entry.link_url);
  const isEditing = editMode !== null;
  const completionLabel = entry.is_completed ? "未完了に戻す" : "完了にする";
  const moveTargets = ENTRY_KIND_MOVE_TARGETS[kind];

  useEffect(() => {
    if (!isEditing) {
      setValue(entry.content);
      setHeadingValue(entry.heading);
      setNoteValue(entry.note);
      setLinkValue(entry.link_url);
      setShowNoteEditor(Boolean(entry.note.trim()));
      setShowLinkEditor(Boolean(entry.link_url.trim()));
      setLinkError(null);
    }
  }, [entry.content, entry.heading, entry.note, entry.link_url, isEditing]);

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

  useEffect(() => {
    return () => {
      if (paragraphResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(paragraphResizeFrameRef.current);
      }
    };
  }, []);

  const adjustParagraphTextareaHeight = ({ allowShrink = false } = {}) => {
    const textarea = contentInputRef.current;

    if (!(textarea instanceof HTMLTextAreaElement)) return;

    const computedStyle = window.getComputedStyle(textarea);
    const minHeight = readCssPixel(computedStyle.minHeight) ?? 180;
    const maxHeight = readCssPixel(computedStyle.maxHeight) ?? Number.POSITIVE_INFINITY;
    const currentHeight = textarea.getBoundingClientRect().height;

    /**
     * 編集開始時だけ自然高を測り直す。入力中は縮めず、必要な時だけ伸ばす。
     * iPhone Safariのキーボード表示中にページ位置が少しずつ動くのを避ける。
     */
    if (allowShrink) {
      textarea.style.height = "auto";
    }

    const contentHeight = textarea.scrollHeight;
    const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

    if (allowShrink || nextHeight > currentHeight + 0.5) {
      textarea.style.height = `${nextHeight}px`;
    }

    const nextOverflow = contentHeight > maxHeight + 0.5 ? "auto" : "hidden";
    if (textarea.style.overflowY !== nextOverflow) {
      textarea.style.overflowY = nextOverflow;
    }
  };

  const scheduleParagraphTextareaResize = ({ allowShrink = false } = {}) => {
    if (!isParagraph) return;

    if (paragraphResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(paragraphResizeFrameRef.current);
    }

    paragraphResizeFrameRef.current = window.requestAnimationFrame(() => {
      paragraphResizeFrameRef.current = null;
      adjustParagraphTextareaHeight({ allowShrink });
    });
  };

  useEffect(() => {
    if (!isParagraph || editMode !== "content") return;

    const frame = window.requestAnimationFrame(() => {
      scheduleParagraphTextareaResize({ allowShrink: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editMode, isParagraph]);

  const usesMobileParagraphSheet = () =>
    isParagraph &&
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 920px)").matches;

  const openMobileParagraphEditor = (focus: MobileParagraphEditorFocus): boolean => {
    if (!usesMobileParagraphSheet()) return false;

    setMobileParagraphEditorFocus(focus);
    return true;
  };

  const beginContentEdit = () => {
    if (disabled) return;
    if (openMobileParagraphEditor("content")) return;
    setValue(entry.content);
    setHeadingValue(entry.heading);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(Boolean(entry.note.trim()));
    setShowLinkEditor(Boolean(entry.link_url.trim()));
    setLinkError(null);
    setEditMode("content");
  };

  const beginHeadingEdit = () => {
    if (disabled || !isParagraph) return;
    if (openMobileParagraphEditor("heading")) return;
    setValue(entry.content);
    setHeadingValue(entry.heading);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(Boolean(entry.note.trim()));
    setShowLinkEditor(Boolean(entry.link_url.trim()));
    setLinkError(null);
    setEditMode("content");
  };

  const beginNoteEdit = () => {
    if (disabled) return;
    if (openMobileParagraphEditor("note")) return;
    setValue(entry.content);
    setHeadingValue(entry.heading);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(true);
    setShowLinkEditor(false);
    setLinkError(null);
    setEditMode("note");
  };

  const beginLinkEdit = () => {
    if (disabled) return;
    if (openMobileParagraphEditor("link")) return;
    setValue(entry.content);
    setHeadingValue(entry.heading);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(false);
    setShowLinkEditor(true);
    setLinkError(null);
    setEditMode("link");
  };

  const persist = async (exitEditing = true): Promise<boolean> => {
    const nextContent = value.trim();
    const nextHeading = isParagraph ? headingValue.trim() : "";
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
    if (nextHeading !== entry.heading) patch.heading = nextHeading;
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
    setHeadingValue(entry.heading);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(Boolean(entry.note.trim()));
    setShowLinkEditor(Boolean(entry.link_url.trim()));
    setLinkError(null);
    setEditMode(null);
  };

  const handleContentChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValue(event.target.value);

    if (isParagraph && !paragraphCompositionRef.current) {
      scheduleParagraphTextareaResize();
    }
  };

  const handleContentKeyDown = (
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

  const createdAtLabel = formatEntryCreatedAt(entry.created_at);
  const completionClassName = entry.is_completed ? "entry-item--completed" : "";
  const satisfactionClassName = `entry-item--satisfaction-${normalizeSatisfaction(entry.satisfaction)}`;
  const numberVisibilityClassName = showEntryNumbers ? "entry-item--numbered" : "";
  const visibleNumber = displayNumber ?? entry.outline_number;

  if (compactView) {
    return (
      <article
        className={`entry-item entry-item--compact ${completionClassName} ${satisfactionClassName} ${
          isHierarchical ? "entry-item--hierarchical" : ""
        } ${entry.depth > 0 ? "entry-item--nested" : ""}`}
        style={style}
      >
        <div className="entry-item__compact-content" title={entry.heading ? `${entry.heading}：${entry.content}` : entry.content}>
          {entry.heading && kind === "paragraph" ? (
            <strong className="entry-item__compact-heading">{entry.heading}</strong>
          ) : null}
          <span>{entry.content}</span>
        </div>
      </article>
    );
  }

  if (isEditing) {
    return (
      <article
        className={`entry-item entry-item--editing ${
          isParagraph && editMode === "content" ? "entry-item--paragraph-editing" : ""
        } ${completionClassName} ${satisfactionClassName} ${numberVisibilityClassName} ${
          isHierarchical ? "entry-item--hierarchical" : ""
        } ${entry.depth > 0 ? "entry-item--nested" : ""}`}
        style={style}
        onBlur={handleEditorBlur}
      >
        <div
          className={`entry-item__editor-body ${
            showEntryNumbers ? "entry-item__editor-body--numbered" : ""
          }`}
        >
          {showEntryNumbers ? (
            <span
              className="entry-item__number entry-item__number--editing"
              aria-hidden="true"
            >
              {visibleNumber}
            </span>
          ) : null}

          <div className="entry-item__editor-main">
            <div className="entry-item__editor-control">
              {editMode === "content" ? (
                isParagraph ? (
                  <div className="entry-item__paragraph-editor-stack">
                    <input
                      className="entry-item__paragraph-heading-input"
                      value={headingValue}
                      disabled={disabled || isSaving}
                      onChange={(event) => setHeadingValue(event.target.value)}
                      placeholder="段落タイトル（任意）"
                      aria-label="段落タイトルを編集"
                    />
                    <textarea
                    ref={(element) => {
                      contentInputRef.current = element;
                    }}
                    className="entry-item__paragraph-editor"
                    value={value}
                    disabled={disabled || isSaving}
                    onChange={handleContentChange}
                    onKeyDown={handleContentKeyDown}
                    onCompositionStart={() => {
                      setIsComposing(true);
                      paragraphCompositionRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      setIsComposing(false);
                      paragraphCompositionRef.current = false;
                      scheduleParagraphTextareaResize();
                    }}
                    rows={6}
                    aria-label="段落を編集"
                    />
                  </div>
                ) : (
                  <input
                    ref={(element) => {
                      contentInputRef.current = element;
                    }}
                    value={value}
                    disabled={disabled || isSaving}
                    onChange={handleContentChange}
                    onKeyDown={handleContentKeyDown}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                    aria-label="項目を編集"
                  />
                )
              ) : (
                <div className="entry-item__editing-static-content">
                  {isParagraph && entry.heading ? (
                    <strong className="entry-item__heading entry-item__heading--static">{entry.heading}</strong>
                  ) : null}
                  <p className="entry-item__editing-content">{entry.content}</p>
                </div>
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
                <NoteIcon />
                <span>気持ち・備考</span>
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
          </div>
        </div>

        <div className="entry-item__edit-actions">
          {!(isParagraph && editMode === "content") ? (
            <>
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
            </>
          ) : null}
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
    <>
      <article
      className={`entry-item ${completionClassName} ${satisfactionClassName} ${numberVisibilityClassName} ${
        isHierarchical ? "entry-item--hierarchical" : ""
      } ${entry.depth > 0 ? "entry-item--nested" : ""} ${
        isStructureOpen ? "entry-item--structure-open" : ""
      } ${isMobileActionOpen ? "entry-item--mobile-action-open" : ""} ${
        mobileParagraphEditorFocus ? "entry-item--mobile-paragraph-editing" : ""
      }`}
      style={style}
    >
      <div className="entry-item__row">
        <div
          className={`entry-item__body ${
            showEntryNumbers ? "entry-item__body--numbered" : ""
          }`}
        >
          {showEntryNumbers ? (
            <span className="entry-item__number" aria-hidden="true">
              {visibleNumber}
            </span>
          ) : null}

          {isParagraph && entry.heading ? (
            <button
              type="button"
              className="entry-item__heading"
              onClick={beginHeadingEdit}
              disabled={disabled}
              aria-label={`段落タイトル「${entry.heading}」を編集`}
            >
              {entry.heading}
            </button>
          ) : null}

          <button
            type="button"
            className="entry-item__content"
            onClick={beginContentEdit}
            disabled={disabled}
            aria-label={
              showEntryNumbers
                ? `${visibleNumber} ${entry.heading ? `${entry.heading} ` : ""}${entry.content}を編集`
                : "編集する"
            }
          >
            <span className="entry-item__content-text">{entry.content}</span>
          </button>

          {hasNote || showTagInMeta ? (
            <div className="entry-item__meta-row">
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

              {showTagInMeta && entry.tag ? (
                <span
                  className={`entry-item__tag-chip ${getEntryTagToneClassName(entry.tag)}`}
                  aria-label={`タグ ${entry.tag}`}
                >
                  #{entry.tag}
                </span>
              ) : null}
            </div>
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
              <NoteIcon />
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
          >
            <NoteIcon />
          </button>

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

          {/* PCでは、気持ち用のペンとリンクを完了ボタンの右側へまとめる。
              スマホも同じペンの入口を右側に置き、位置は変えない。 */}
          <div className="entry-item__desktop-inline-actions">
            <button
              type="button"
              className="entry-item__note-trigger entry-item__note-trigger--inline"
              onClick={beginNoteEdit}
              disabled={disabled || isSaving}
              aria-label={hasNote ? "気持ち・備考を編集" : "気持ち・備考を追加"}
              title={hasNote ? "気持ち・備考を編集" : "気持ち・備考を追加"}
            >
              <NoteIcon />
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
                disabled={disabled || isSaving}
                aria-label="リンクを追加"
                title="リンクを追加"
              >
                <LinkIcon />
              </button>
            )}
          </div>

          <EntryTagControl
            tag={entry.tag}
            suggestions={tagSuggestions}
            disabled={disabled || isSaving}
            onSave={async (tag) => {
              await onUpdate(entry.id, { tag });
            }}
          />

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
      <MobileParagraphEditorSheet
        key={mobileParagraphEditorFocus ? `${entry.id}-${mobileParagraphEditorFocus}` : "closed"}
        entry={mobileParagraphEditorFocus ? entry : null}
        showEntryNumbers={showEntryNumbers}
        displayNumber={visibleNumber}
        initialFocus={mobileParagraphEditorFocus ?? "content"}
        disabled={disabled || isSaving}
        onClose={() => setMobileParagraphEditorFocus(null)}
        onSave={async (_entryId, patch) => {
          await onUpdate(entry.id, patch);
        }}
      />
    </>
  );
}
