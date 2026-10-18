import { NoteIcon, LinkIcon, MoreIcon, UpIcon, DownIcon, PullIcon } from "./icons";
import {
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { MobileParagraphEditorSheet } from "./MobileParagraphEditorSheet";
import { formatEntryCreatedAt } from "../lib/formatDate";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";
import {
  type EntryKind,
  type EntryTreeNode,
  type EntryUpdate,
  getLinkHostname,
  getOpenableLinkUrl,
  getReferenceFaviconUrl,
  normalizeLinkUrlForSave,
  normalizeSatisfaction,
  supportsHierarchy,
} from "../types/memo";

type EditMode = "content" | "note" | "link" | null;
type MobileParagraphEditorFocus = "heading" | "content" | "note" | "link";
/** タグの文脈に応じて、カード内ではチップか編集アイコンだけを見せる。 */
type EntryTagPresentation = "meta" | "group_action" | "completed_meta";



/** 気持ち・備考を書く入口。追加と編集で見た目を変えず、常に「書く」操作として扱う。 */


function readCssPixel(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type EntryItemProps = {
  entry: EntryTreeNode;
  kind: EntryKind;
  isMobileActionOpen: boolean;
  /** 段落で、書き口がこの段落の後ろに入る(選ばれている)か。 */
  isSelected?: boolean;
  onSelect?: (entryId: string) => void;
  /** 手動の順のときだけ渡す。段落を上・下へ移す。 */
  onMove?: (entryId: string, direction: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** PCの「項目の詳細」(行のそばの小窓)。 */
  onOpenDetails: (entryId: string, anchor: HTMLElement) => void;
  /** 段落: 見出しが同じ文のアウトラインの行(結び目)。「↖ 2.2」で行へ飛ぶ。 */
  boundRow?: { id: string; content: string; number: string } | null;
  onJumpToRow?: (rowId: string) => void;
  /** 参考URL: 「アウトラインに引く」と、アウトラインで引用されている行の数。 */
  onPull?: (entryId: string) => void;
  citationCount?: number;
  onJumpToCitation?: (entryId: string) => void;
  /** 結び目を灯している(1.6秒)。 */
  isLens?: boolean;
  showCreatedAt: boolean;
  /** 表示に振り番を含めるか。 */
  showEntryNumbers: boolean;
  /** 現在の表示文脈で見せる振り番。タグ表示時はグループ内番号を受け取る。 */
  displayNumber?: string;
  /** 補助情報と操作を隠し、本文だけを密に表示するか。 */
  compactView?: boolean;
  /** 通常表示は気持ち行のタグ、タググループ内は右側アイコン、完了内は元タグを再表示する。 */
  tagPresentation?: EntryTagPresentation;
  disabled?: boolean;
  /** スマホの「この項目の操作」(下からのシート)。 */
  onOpenStructure: (entryId: string) => void;
  onUpdate: (entryId: string, patch: EntryUpdate) => Promise<unknown>;
};

/**
 * 本文と、書いたときの気持ち・補足をまとめて扱う項目。
 * 気持ち・備考が空のときは、表示用の行も余白も一切出さない。
 */
export function EntryItem({
  entry,
  kind,
  isMobileActionOpen,
  isSelected = false,
  isLens = false,
  boundRow = null,
  onJumpToRow,
  onPull,
  citationCount = 0,
  onJumpToCitation,
  onSelect,
  onMove,
  canMoveUp = true,
  canMoveDown = true,
  onOpenDetails,
  showCreatedAt,
  showEntryNumbers,
  displayNumber,
  compactView = false,
  tagPresentation = "meta",
  disabled = false,
  onOpenStructure,
  onUpdate,
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
  const paragraphPreviewRef = useRef<HTMLSpanElement | null>(null);
  const paragraphPreviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const [paragraphNeedsFold, setParagraphNeedsFold] = useState(false);
  const [paragraphExpanded, setParagraphExpanded] = useState(false);

  const isParagraph = kind === "paragraph";
  const isReferenceUrl = kind === "word" && Boolean(entry.link_url.trim());
  const isLegacyWord = kind === "word" && !entry.link_url.trim();
  const isHierarchical = supportsHierarchy(kind) && !isReferenceUrl;
  const hasNote = entry.note.trim().length > 0;
  const showTagInMeta = Boolean(entry.tag) && (
    tagPresentation === "meta" || tagPresentation === "completed_meta"
  );
  const openableLinkUrl = getOpenableLinkUrl(entry.link_url);
  const referenceHostname = isReferenceUrl
    ? getLinkHostname(openableLinkUrl)
    : "";
  const referenceFaviconUrl = isReferenceUrl
    ? getReferenceFaviconUrl(openableLinkUrl)
    : "";
  const isEditing = editMode !== null;

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

  // 本文の表示高さを実測する。文字数ではなく、実際の行の高さと画面高で判定する。
  // compactViewは既存の2行省略を維持し、編集時もこの表示制限を適用しない。
  useEffect(() => {
    if (!isParagraph || compactView || isEditing) return;

    const text = paragraphPreviewRef.current;
    const button = paragraphPreviewButtonRef.current;
    if (!text || !button) return;

    const measure = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      setParagraphNeedsFold(text.scrollHeight > viewportHeight * 0.6 + 1);
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measure)
      : null;
    observer?.observe(button);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [entry.content, isParagraph, compactView, isEditing]);

  useEffect(() => {
    // 本文を更新した場合は、新しい内容の既定（省略）表示へ戻す。
    setParagraphExpanded(false);
  }, [entry.content]);

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
    setShowNoteEditor(isReferenceUrl || Boolean(entry.note.trim()));
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

    if (isReferenceUrl && !nextLinkUrl) {
      setShowLinkEditor(true);
      setLinkError("URLを入力してください。");
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

  const toggleCompletion = async () => {
    if (disabled || isSaving) return;

    const canContinue = isEditing ? await persist(false) : true;
    if (!canContinue) return;

    await onUpdate(entry.id, { is_completed: !entry.is_completed });
    setEditMode(null);
  };

  const style = {
    "--entry-depth": Math.min(entry.depth, 6),
    viewTransitionName: `e-${entry.id}`,
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
        data-entry-id={entry.id} className={`entry-item entry-item--editing ${
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
                  <label htmlFor={`entry-note-${entry.id}`}>
                    {isReferenceUrl ? "備考" : "気持ち・備考"}
                  </label>
                  <button
                    type="button"
                    className="text-button entry-item__remove-note"
                    disabled={disabled || isSaving}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setNoteValue("");
                      if (!isReferenceUrl) setShowNoteEditor(false);
                    }}
                  >
                    {isReferenceUrl ? "クリア" : "消す"}
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
                  placeholder={isReferenceUrl ? "このURLについての短いメモ" : "そのときの気持ち・補足"}
                  aria-label={isReferenceUrl ? "備考を編集" : "気持ち・備考を編集"}
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
                <span>{isReferenceUrl ? "備考" : "気持ち・備考"}</span>
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
                  {linkValue && !isReferenceUrl ? (
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
      data-entry-id={entry.id} className={`entry-item ${completionClassName} ${satisfactionClassName} ${numberVisibilityClassName} ${
        isHierarchical ? "entry-item--hierarchical" : ""
      } ${entry.depth > 0 ? "entry-item--nested" : ""} ${isMobileActionOpen ? "entry-item--mobile-action-open" : ""} ${isSelected ? "entry-item--selected" : ""} ${isLens ? "entry-item--lens" : ""} ${
        mobileParagraphEditorFocus ? "entry-item--mobile-paragraph-editing" : ""
      } ${isReferenceUrl ? "entry-item--reference-url" : ""} ${
        isLegacyWord ? "entry-item--legacy-word" : ""
      }`}
      style={style}
      onClick={onSelect ? () => onSelect(entry.id) : undefined}
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
            <div className="entry-item__heading-row">
              {boundRow ? (
                <button
                  type="button"
                  className="entry-item__bind"
                  onClick={(event) => { event.stopPropagation(); onJumpToRow?.(boundRow.id); }}
                  aria-label={`アウトラインの「${boundRow.content}」へ`}
                  title={`アウトライン ${boundRow.number} と結ばれています`}
                >
                  ↖ {boundRow.number}
                </button>
              ) : null}
              {/* 見出しを押しても、本文と同じ編集欄が開く。キーボードでは本文のボタンから入れるので、見出しは操作の数に入れない。 */}
              <h3
                className="entry-item__heading entry-item__heading--click"
                onClick={disabled ? undefined : beginHeadingEdit}
                title="見出しを編集"
              >
                {entry.heading}
              </h3>
            </div>
          ) : null}

          {isReferenceUrl && openableLinkUrl ? (
            <div className="entry-item__reference-main">
              {referenceFaviconUrl ? (
                <img
                  className="entry-item__reference-favicon"
                  src={referenceFaviconUrl}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              ) : (
                <span className="entry-item__reference-favicon-fallback" aria-hidden="true">
                  ↗
                </span>
              )}
              <div className="entry-item__reference-copy">
                <a
                  className="entry-item__content entry-item__reference-link"
                  href={openableLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${entry.content}を開く`}
                >
                  <span className="entry-item__content-text">{entry.content}</span>
                </a>
                <div className="entry-item__reference-domain-row">
                  {referenceHostname ? (
                    <span className="entry-item__reference-domain">{referenceHostname}</span>
                  ) : null}
                  <button
                    type="button"
                    className="entry-item__reference-edit-url"
                    onClick={beginLinkEdit}
                    disabled={disabled}
                    aria-label="URLを編集"
                    title="URLを編集"
                  >
                    <span aria-hidden="true">✎</span>
                  </button>
                  {citationCount > 0 ? (
                    <button
                      type="button"
                      className="entry-item__cite"
                      onClick={(event) => { event.stopPropagation(); onJumpToCitation?.(entry.id); }}
                      aria-label={`アウトラインで引用 ${citationCount}件`}
                    >
                      引用 {citationCount}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="entry-item__content"
              ref={isParagraph ? paragraphPreviewButtonRef : undefined}
              onClick={beginContentEdit}
              disabled={disabled}
              aria-label={
                showEntryNumbers
                  ? `${visibleNumber} ${entry.heading ? `${entry.heading} ` : ""}${entry.content}を編集`
                  : "編集する"
              }
            >
              <span
                ref={isParagraph ? paragraphPreviewRef : undefined}
                id={isParagraph ? `paragraph-preview-${entry.id}` : undefined}
                className={`entry-item__content-text${isParagraph && paragraphNeedsFold && !paragraphExpanded ? " entry-item__content-text--folded" : ""}`}
              >
                {entry.content}
              </span>
            </button>
          )}

          {isParagraph && paragraphNeedsFold ? (
            <button
              type="button"
              className="entry-item__paragraph-toggle"
              onClick={() => setParagraphExpanded((expanded) => !expanded)}
              aria-expanded={paragraphExpanded}
              aria-controls={`paragraph-preview-${entry.id}`}
              aria-label={paragraphExpanded ? "段落を折りたたむ" : "段落の続きを読む"}
            >
              <span>{paragraphExpanded ? "折りたたむ" : "続きを読む・全文を表示"}</span>
              <span className="entry-item__paragraph-toggle-chevron" aria-hidden="true">
                {paragraphExpanded ? "⌃" : "⌄"}
              </span>
            </button>
          ) : null}

          {isLegacyWord ? (
            <span className="entry-item__legacy-label">以前の単語</span>
          ) : null}

          {hasNote || showTagInMeta ? (
            <div className="entry-item__meta-row">
              {hasNote ? (
                <button
                  type="button"
                  className={`entry-item__note ${isReferenceUrl ? "entry-item__note--reference" : ""}`}
                  onClick={beginNoteEdit}
                  disabled={disabled}
                  aria-label={isReferenceUrl ? "備考を編集" : "気持ち・備考を編集"}
                >
                  <span className="entry-item__note-label">
                    {isReferenceUrl ? "備考" : "気持ち"}
                  </span>
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

          {openableLinkUrl && !isReferenceUrl ? (
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

        {entry.satisfaction>0?<small className="entry-item__satisfaction-mark" aria-label={`満足度${entry.satisfaction}`}>{entry.satisfaction}</small>:null}
        <div data-entry-actions="" className={`entry-item__quick-actions ${isReferenceUrl ? "entry-item__quick-actions--reference" : ""}`}>
          {isReferenceUrl && onPull ? (
            <button
              type="button"
              className="icon-button entry-item__quick-action entry-item__pull-button"
              onClick={() => onPull(entry.id)}
              disabled={disabled}
              aria-label="アウトラインに引く"
              title="アウトラインに引く(次の一行へ)"
            >
              <PullIcon />
            </button>
          ) : null}

          {onMove && isParagraph ? (
            <>
              <button
                type="button"
                className="icon-button entry-item__quick-action"
                onClick={() => onMove(entry.id, -1)}
                disabled={disabled || !canMoveUp}
                aria-label="上へ移す"
                title="上へ移す"
              >
                <UpIcon />
              </button>
              <button
                type="button"
                className="icon-button entry-item__quick-action"
                onClick={() => onMove(entry.id, 1)}
                disabled={disabled || !canMoveDown}
                aria-label="下へ移す"
                title="下へ移す"
              >
                <DownIcon />
              </button>
            </>
          ) : null}

          <button
            type="button"
            className="icon-button entry-item__quick-action entry-item__details-button"
            onClick={(event) => onOpenDetails(entry.id, event.currentTarget)}
            disabled={disabled}
            aria-label="項目の詳細"
            title="詳細と操作"
          >
            <MoreIcon />
          </button>
          <button
            type="button"
            className="icon-button entry-item__quick-action entry-item__structure-button"
            onClick={() => onOpenStructure(entry.id)}
            disabled={disabled}
            aria-label="この項目の操作"
            aria-expanded={isMobileActionOpen}
            title="操作"
          >
            <MoreIcon />
          </button>
        </div>
      </div>

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
