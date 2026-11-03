import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EntryRow, EntryTreeNode, EntryUpdate } from "../types/memo";
import { normalizeOutlineItems, itemsFromOutlinePaste, analyzeOutlinePaste, serializeOutlineItems, type OutlinePasteItem } from "../lib/outlinePaste.js";
import type { OutlinePasteBatchResult } from "../repositories/memoRepository";
import type { OutlineCompletionChange } from "../lib/outlineCompletion.js";
import { siblingPositionAfter, visibleInsertionIndex, indentPositionAt } from "../lib/outlineInsert.js";
import { siblingMoveIndex } from "../lib/outlineMove.js";
import { positionForBlankEnter, canBackspaceDeleteBlank, isTrulyEmptyEditor } from "../lib/outlineBlank.js";
import { foldableBranchesAtLevel, toggleFoldedLevel, parseFoldedIds } from "../lib/outlineFold.js";
import { outlineEmphasisSegments, toggleOutlineEmphasis, stripOutlineEmphasis } from "../lib/outlineEmphasis.js";
import { useDraftPersistence } from "../hooks/useDraftPersistence";
import { buildEntryDraftId, type EntryDraftSnapshot } from "../repositories/draftRepository";
import { flushSync } from "react-dom";
import { hasMeaningfulEntryDraft } from "../repositories/draftRepository";
import type { EntryCreateMetadata } from "../types/memo";

/** 「次の一行」(書き口が入る場所)。parentId=null は範囲(全体か集中中の枝)の一番上の階層。 */
type Caret = { parentId: string | null; index: number };

export type OutlineHandle = {
  /** 作るときの位置。親と、兄弟の中での位置。 */
  insertPosition(): Caret;
  /** 独立した書き口の代わりに、項目そのものへフォーカスする。 */
  focusInline(): void;
  pastePlainText(text: string): boolean;
  hasPendingDraft(): boolean;
  restorePendingDraft(snapshot: EntryDraftSnapshot): void;
  /** 置いた後、次の一行を新しい行の下へ進める。置いた行のidを渡すと、描かれる前のTabにも効く。 */
  advance(createdId?: string): void;
  /** 直前の兄弟の子(末尾)へ。直前の兄弟がなければ何もしない。 */
  indentCaret(): void;
  /** 親の次の兄弟へ。範囲の一番上なら何もしない。 */
  outdentCaret(): void;
  /** 次の一行の上の行を選んでフォーカスする。 */
  focusRowAboveCaret(): boolean;
  /** 次の一行の下の行を選んでフォーカスする。 */
  focusRowBelowCaret(): boolean;
  placeCaretAfter(rowId: string): void;
  /** 範囲(全体か集中中の枝)の末尾へ。 */
  resetCaret(): void;
  /** 次の一行の入る場所を、読み上げ用の文にする。 */
  describeCaret(): string;
  /** 行を選んで見せる(行き先へ送る・結び目を灯す)。 */
  revealRow(rowId: string): void;
  /** 項目の詳細・スマホのシートから、行を動かす・枝に集中する。 */
  moveRow(rowId: string, action: "indent" | "outdent" | "up" | "down"): void;
  zoomTo(rowId: string | null): void;
  /** 保存済みの直前の本文編集・構造移動を戻す。 */
  undoLast(): void;
  /** 詳細画面から保存した本文編集も同じ履歴へ追加する。 */
  recordExternalEdit(id: string, previous: string): void;
  /** 「置く」で追加した新規行を戻す（安全な場合のみ）。 */
  recordExternalCreate(id: string): void;
  recordExternalCompletion(id: string, previous: boolean, changes: OutlineCompletionChange[]): void;
};

type OutlineListProps = {
  entries: EntryTreeNode[];
  /** 表示フィルターを通す前の全行。保存順の挿入位置を決める唯一の基準。 */
  allEntries?: EntryTreeNode[];
  memoId: string;
  memoUpdatedAt: string;
  onCreateInline: (content: string, parentId: string | null, index: number, draftId?: string, metadata?: EntryCreateMetadata) => Promise<{ id: string }>;
  onRemoveInline?: (id: string) => Promise<void>;
  /** Backspaceで削除した空行を元のIDで復元する。 */
  onRestoreInline?: (ids: string[]) => Promise<void>;
  onInlineDraftChange?: (hasDraft: boolean) => void;
  disabled?: boolean;
  /** 高密度表示か。切り替えは列のメニュー(EntryColumn)に置く。 */
  dense: boolean;
  /** 行頭を階層番号で描く。falseならビュレット。 */
  numbered?: boolean;
  /** Undo操作が可能かを見出しへ通知する。 */
  onUndoAvailabilityChange?: (available: boolean, actionDescription: string | null) => void;
  /** アウトライナーの完了済み項目だけを表示するか。既定は非表示。 */
  showCompletedOutline?: boolean;
  completedOutlineCount?: number;
  onToggleShowCompletedOutline?: () => void;
  onRelocate: (id: string, parentId: string | null, index: number) => Promise<void>;
  /** スマホの「この項目の操作」(下からのシート)。 */
  onOpenActions?: (id: string) => void;
  /** PCの「項目の詳細」(行のそばの小窓)。 */
  onOpenDetails: (id: string, anchor: HTMLElement) => void;
  onToggleCompleted?: (id: string) => Promise<OutlineCompletionChange[]>;
  onRestoreCompletion?: (changes: OutlineCompletionChange[]) => Promise<void>;
  onUpdate: (id: string, patch: EntryUpdate) => Promise<unknown>;
  /** 既存行の編集中に複数行を貼り付けた際、先頭を更新し残りを兄弟行として追加する。 */
  onPasteRows?: (row: EntryTreeNode, rows: OutlinePasteItem[]) => Promise<void>;
  onPasteOutlineBatch?: (items: OutlinePasteItem[], parentId: string | null, index: number, options?: { targetId?: string; expectedContent?: string; draftId?: string; metadata?: { tag?: string | null; note?: string; link_url?: string } }) => Promise<OutlinePasteBatchResult>;
  onUndoPasteOutlineBatch?: (batch: OutlinePasteBatchResult) => Promise<void>;
  onRedoPasteOutlineBatch?: (batch: OutlinePasteBatchResult) => Promise<OutlinePasteBatchResult>;
  /** 新規行を戻す前に下書きを復元し、子を巻き込まずソフト削除する。 */
  onUndoCreate?: (row: EntryTreeNode) => Promise<void>;
  /** 書き口(置き場所)。いる欄では運ばれてきた書き口が、いない欄では入口が入る。 */
  deskNode?: ReactNode;
  /** 行に結ばれた段落(見出しが同じ文)。結ばれていれば「¶」を見せる。 */
  paragraphsByRowId?: Map<string, EntryRow[]>;
  /** 結び目を灯している行(1.6秒)。 */
  lensIds?: Set<string>;
  /** 「段落にする」(結ばれていれば「段落を開く」)。 */
  onGrowRow?: (rowId: string) => void;
  /** スマホで、書きかけがあるとき「ここに入ります」を灯す。 */
  ghostOn?: boolean;
  /** 次の一行の入る場所の説明が変わったとき(書き口の読み上げに使う)。 */
  onCaretDescribed?: (description: string) => void;
  /** 行を選んだ(書き口が空で別の欄にいるなら、ついてくる)。 */
  onRowSelected?: (row: EntryTreeNode) => void;
  /** 書き口へフォーカスを移す(アウトラインの欄へ運んでから)。 */
  onFocusDesk: () => void;
};

type MoveHistory = { id: string; parentId: string | null; index: number };
type UndoableAction =
  | { type: "edit"; id: string; previous: string }
  | ({ type: "move" } & MoveHistory)
  | { type: "create"; id: string }
  | { type: "create-blank"; id: string }
  | { type: "delete-blank"; id: string; parentId: string | null; index: number }
  | { type: "complete"; id: string; previous: boolean; changes?: OutlineCompletionChange[] }
  | { type: "paste"; batch: OutlinePasteBatchResult };

const isMobileViewport = () => window.matchMedia("(max-width: 920px)").matches;

/**
 * テキストエリア内の折り返しを含む「表示上の最初/最後の行」だけで、
 * 隣のビュレットへカーソルを渡す。IME変換中には呼び出さない。
 * selectionStart と改行だけでは、画面幅に応じたソフトラップを判定できない。
 */
function isOnOuterVisualLine(field: HTMLTextAreaElement, direction: "up" | "down"): boolean {
  if (field.selectionStart !== field.selectionEnd) return false;
  const style = window.getComputedStyle(field);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed", top: "-10000px", left: "0", visibility: "hidden",
    pointerEvents: "none", boxSizing: "border-box", width: `${field.getBoundingClientRect().width}px`,
    padding: style.padding, border: style.border, font: style.font,
    letterSpacing: style.letterSpacing, whiteSpace: "pre-wrap",
    overflowWrap: style.overflowWrap, wordBreak: style.wordBreak, tabSize: style.tabSize,
  });
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  const end = document.createElement("span");
  end.textContent = "\u200b";
  mirror.append(document.createTextNode(field.value.slice(0, field.selectionStart)), mark);
  mirror.append(document.createTextNode(field.value.slice(field.selectionStart)), end);
  document.body.append(mirror);
  const top = mark.offsetTop;
  const endTop = end.offsetTop;
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  mirror.remove();
  return direction === "up" ? top <= paddingTop + lineHeight * 0.55
    : endTop - top < lineHeight * 0.55;
}

function adjacentCursorOffset(content: string, column: number, direction: "up" | "down"): number {
  const start = direction === "up" ? content.lastIndexOf("\n") + 1 : 0;
  const nextBreak = content.indexOf("\n", start);
  const end = nextBreak < 0 ? content.length : nextBreak;
  return Math.min(end, start + column);
}

/** 親子構造はDBの parent_id / sort_order に保存し、このコンポーネントには一時的な開閉・選択・次の一行の位置だけを置く。 */
export const OutlineList = forwardRef<OutlineHandle, OutlineListProps>(function OutlineList({
  entries,
  allEntries = entries,
  memoId,
  memoUpdatedAt,
  onCreateInline,
  onRemoveInline,
  onRestoreInline,
  onInlineDraftChange,
  disabled = false,
  dense,
  numbered = false,
  onUndoAvailabilityChange,
  showCompletedOutline = false,
  completedOutlineCount = 0,
  onToggleShowCompletedOutline,
  onRelocate,
  onOpenActions,
  onOpenDetails,
  onToggleCompleted,
  onRestoreCompletion,
  onUpdate,
  onPasteRows,
  onPasteOutlineBatch,
  onUndoPasteOutlineBatch,
  onRedoPasteOutlineBatch,
  onUndoCreate,
  deskNode,
  paragraphsByRowId,
  lensIds,
  onGrowRow,
  ghostOn = false,
  onCaretDescribed,
  onRowSelected,
  onFocusDesk,
}, ref) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 完了後の遅延フォーカスが、後から始まった入力を奪わないようにする世代番号。 */
  const focusEpochRef = useRef(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  type PendingRow = { parentId: string | null; index: number; value: string };
  const [pending, setPending] = useState<PendingRow | null>(null);
  const pendingRef = useRef<PendingRow | null>(null);
  const pendingEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const pasteReviewSelectRef = useRef<HTMLSelectElement | null>(null);
  const creatingRef = useRef(false);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [failedEdit, setFailedEdit] = useState<{ id: string; value: string } | null>(null);
  const changePending = (next: PendingRow | null) => { pendingRef.current = next; setPending(next); };
  const emptyMeta: EntryDraftSnapshot = {
    content: "", heading: "", tag_value: "", note_value: "", link_value: "",
    tag_draft: "", note_draft: "", link_draft: "", active_meta_picker: null,
  };
  const [pendingMeta, setPendingMeta] = useState<EntryDraftSnapshot>(emptyMeta);
  const draftId = buildEntryDraftId(memoId, "sentence", "main");
  const editedRow = editingId ? entries.find(row => row.id === editingId) : null;
  const unsavedEdit = editedRow && editingValue !== editedRow.content ? editingValue : "";
  const draftSnapshot = useMemo<EntryDraftSnapshot>(() => ({
    ...pendingMeta,
    content: pending?.value ?? unsavedEdit,
    // 編集中の既存行はIDを一時保存し、再読込時に同じ行へ戻す。
    heading: pending ? "" : (unsavedEdit && editingId ? editingId : ""),
  }), [pending?.value, pending, pendingMeta, editingId, unsavedEdit]);
  const { flush: flushInlineDraft, markCommitted: markInlineCommitted } = useDraftPersistence({
    id: draftId, memo_id: memoId, kind: "sentence", scope: "main", fixed_tag: null,
    base_memo_updated_at: memoUpdatedAt, snapshot: draftSnapshot,
    onRestore: (saved) => {
      if (!hasMeaningfulEntryDraft(saved) || pendingRef.current?.value.trim()) return;
      const edited = saved.heading && entries.find(row => row.id === saved.heading);
      if (edited && saved.content !== edited.content) {
        setSelectedId(edited.id);
        setEditingId(edited.id);
        setEditingValue(saved.content);
        return;
      }
      setPendingMeta(saved);
      changePending({ parentId: null, index: entries.filter(r => r.parent_id === null).length, value: saved.content });
    },
  });
  useEffect(() => {
    onInlineDraftChange?.(Boolean((pending?.value ?? unsavedEdit).trim()));
  }, [pending?.value, unsavedEdit, onInlineDraftChange]);
  const [, setCaretState] = useState<Caret | null>(null);
  // 続けて置くとき、描き直しを待たずに最新の位置を読めるよう、同じ値を持っておく。
  const caretRef = useRef<Caret | null>(null);
  /** 「次の一行」を明示的に移した直後だけ、保存先を短く表示する。 */
  const [caretPreviewVisible, setCaretPreviewVisible] = useState(false);
  const caretPreviewTimerRef = useRef<number | null>(null);
  const setCaret = (next: Caret | null) => {
    caretRef.current = next;
    setCaretState(next);
    if (caretPreviewTimerRef.current !== null) window.clearTimeout(caretPreviewTimerRef.current);
    setCaretPreviewVisible(next !== null);
    if (next !== null) {
      caretPreviewTimerRef.current = window.setTimeout(() => {
        setCaretPreviewVisible(false);
        caretPreviewTimerRef.current = null;
      }, 2200);
    }
  };
  useEffect(() => () => {
    if (caretPreviewTimerRef.current !== null) window.clearTimeout(caretPreviewTimerRef.current);
  }, []);
  // View-only preference, per memo. A reload does not unexpectedly expand all branches.
  const foldedStorageKey = `kakidas.outline-folded.v1.${memoId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(parseFoldedIds(window.localStorage.getItem(foldedStorageKey))); }
    catch { return new Set(); }
  });
  useEffect(() => {
    try { window.localStorage.setItem(foldedStorageKey, JSON.stringify([...collapsed])); }
    catch { /* Private mode / full storage must never prevent editing. */ }
  }, [collapsed, foldedStorageKey]);
  const [zoomId, setZoomId] = useState<string | null>(null);
  const undoStackRef = useRef<UndoableAction[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoPasteBatch, setRedoPasteBatch] = useState<OutlinePasteBatchResult | null>(null);
  const [pasteReview, setPasteReview] = useState<{ source: string; context: "pending" | "editor"; targetId?: string; expectedContent?: string; parentId: string | null; index: number; mode: "auto" | "two" | "four" | "flat" } | null>(null);
  const undoInFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const requestedSelectionRef = useRef<{ id: string; offset: number } | null>(null);
  const savingRef = useRef(false);
  /** 既存行の編集保存を完了してから、続きの新規行を保存する。 */
  const precedingEditSaveRef = useRef<Promise<unknown> | null>(null);
  const skipBlurRef = useRef(false);
  const lastInsertRef = useRef<Caret | null>(null);
  const lastAdvanceRef = useRef(0);
  /** 置いたばかりで、一覧にはまだ描かれていない行の位置(Tabが続けて来ても親にできるように)。 */
  const recentRef = useRef(new Map<string, { parentId: string | null; index: number; at: number }>());
  const nodeById = useMemo(() => new Map(entries.map((row) => [row.id, row])), [entries]);
  const allNodeById = useMemo(() => new Map(allEntries.map((row) => [row.id, row])), [allEntries]);
  const persistedChildrenOf = (parentId: string | null) =>
    allEntries.filter((row) => row.parent_id === parentId)
      .sort((a,b)=>a.sort_order-b.sort_order||a.created_at.localeCompare(b.created_at));
  /** 表示切替で本文を動かさないよう、どちらのモードでも同じガターを確保する。 */
  const markerWidth = useMemo(() => {
    if (!numbered) return "12px";
    const maxLength = entries.reduce((max, row) => Math.max(max, row.outline_number.length), 1);
    return `${Math.min(120, Math.max(12, maxLength * 7 + 4))}px`;
  }, [entries, numbered]);
  /** 前の操作だけを保持する。データや既存のブラウザUndo履歴は変更しない。 */
  const recordUndo = (action: UndoableAction) => {
    undoStackRef.current = [...undoStackRef.current.slice(-29), action];
    setRedoPasteBatch(null);
    setUndoDepth(undoStackRef.current.length);
  };
  useEffect(() => {
    const last = undoStackRef.current.at(-1);
    const description = !last ? null
      : last.type === "edit" ? "本文の変更を戻す"
      : last.type === "move" ? "行の移動を戻す"
      : last.type === "complete" ? "完了・再開を元に戻す"
      : last.type === "delete-blank" ? "削除した空行を復元"
      : last.type === "create-blank" ? "追加した空行を取り消す"
      : last.type === "paste" ? `取り込んだ${last.batch.created.length}行をまとめて戻す`
      : "直前に追加した行を戻す";
    onUndoAvailabilityChange?.(undoDepth > 0 && !busy && !disabled && editingId === null, description);
  }, [undoDepth, busy, disabled, editingId, onUndoAvailabilityChange]);
  const childrenOf = (parentId: string | null) => entries
    .filter((row) => row.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  /** A single Tab target resolver for both writing desk and inline input. */
  const indentTarget = (position: Caret): Caret | null => {
    // The desk can call Tab before a newly saved row reaches the rendered tree.
    // Prefer that last committed ID over the still-stale stored sibling indices.
    const now = Date.now();
    const recent = [...recentRef.current].reverse().find(([id, place]) =>
      now - place.at < 2_000 &&
      place.parentId === position.parentId &&
      place.index === position.index - 1 &&
      !allNodeById.has(id));
    if (recent) {
      const parentId = recent[0];
      return { parentId, index: persistedChildrenOf(parentId).length };
    }
    return indentPositionAt(allEntries, visible, position.parentId, position.index);
  };
  const locationOf = (id: string): MoveHistory | null => {
    const row = allNodeById.get(id);
    if (!row) return null;
    return { id, parentId: row.parent_id, index: persistedChildrenOf(row.parent_id).findIndex((item) => item.id === id) };
  };

  // 子を折り畳む／特定の枝にズームする（データそのものは変更しない）。
  const visible = useMemo(() => {
    const result: EntryTreeNode[] = [];
    const zoom = zoomId ? nodeById.get(zoomId) : null;
    const zoomDepth = zoom?.depth ?? -1;
    let inside = zoom === undefined || zoom === null;
    const invisible = new Set<string>();
    for (const entry of entries) {
      if (zoom && entry.id === zoom.id) { inside = true; continue; }
      if (zoom && inside && entry.depth <= zoomDepth) break;
      if (!inside) continue;
      const hidden = Boolean(entry.parent_id && (invisible.has(entry.parent_id) || collapsed.has(entry.parent_id)));
      if (hidden) { invisible.add(entry.id); continue; }
      result.push(entry);
    }
    return result;
  }, [collapsed, entries, nodeById, zoomId]);
  const zoom = zoomId ? nodeById.get(zoomId) ?? null : null;
  const scopeId = zoom ? zoom.id : null;
  const breadcrumbs: EntryTreeNode[] = [];
  if (zoom) {
    let current: EntryTreeNode | undefined = zoom;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      breadcrumbs.unshift(current); seen.add(current.id);
      current = current.parent_id ? nodeById.get(current.parent_id) : undefined;
    }
  }

  /** 非表示の完了行も含めた保存順で位置を管理する。 */
  const resolvedCaret = (): Caret => {
    const current = caretRef.current;
    if (current && (current.parentId === null || allNodeById.has(current.parentId))) {
      return { parentId: current.parentId, index: Math.max(0, Math.min(current.index, persistedChildrenOf(current.parentId).length)) };
    }
    return { parentId: scopeId, index: persistedChildrenOf(scopeId).length };
  };
  const rowDepth = (row: EntryTreeNode) => (zoom ? Math.max(0, row.depth - zoom.depth - 1) : row.depth);

  /** 保存上の挿入位置を、折りたたみ・完了非表示後の表示行番号に変換する。 */
  const caretSpot = () => {
    const { parentId, index } = resolvedCaret();
    const atScopeTop = parentId === null || parentId === scopeId;
    const parent = parentId ? allNodeById.get(parentId) : null;
    const depth = atScopeTop || !parent ? 0 : rowDepth(parent) + 1;
    const at = visibleInsertionIndex(allEntries, visible, parentId, index);
    return { at, depth, end: at >= visible.length, parentId, index };
  };
  const spot = caretSpot();
  const caretDescription = (() => {
    const parent = spot.parentId ? nodeById.get(spot.parentId) : null;
    const level = spot.depth + 1;
    return parent ? `第${level}階層・親「${parent.content}」の下に追加` : `第${level}階層・最上位に追加`;
  })();
  useEffect(() => { onCaretDescribed?.(caretDescription); }, [caretDescription]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!editingId || !editorRef.current) return;
    const field = editorRef.current;
    field.focus({ preventScroll: true });
    const request = requestedSelectionRef.current;
    if (request?.id === editingId) {
      const offset = Math.min(request.offset, field.value.length);
      field.setSelectionRange(offset, offset);
      requestedSelectionRef.current = null;
    }
  }, [editingId, entries]);
  // 消えた行を選んだままにしない。
  useEffect(() => {
    if (selectedId && !nodeById.has(selectedId)) setSelectedId(null);
    if (editingId && !nodeById.has(editingId)) setEditingId(null);
  }, [editingId, nodeById, selectedId]);

  const focusRow = (id: string) => window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
  });
  const siblingAfter = (row: EntryTreeNode): Caret =>
    siblingPositionAfter(allEntries, row.id) ?? { parentId: row.parent_id, index: persistedChildrenOf(row.parent_id).length };
  const beginPending = (position: Caret, value = "", immediate = false) => {
    if (disabled || creatingRef.current) return;
    focusEpochRef.current++;
    const render = () => {
      changePending({ ...position, value });
      setCaret(position);
      setSelectedId(null);
      setEditingId(null);
    };
    if (immediate) {
      // Enter直後の連続打鍵を最初の1文字から受け取れるよう同期で描画する。
      flushSync(render);
      pendingEditorRef.current?.focus({ preventScroll: true });
    } else {
      render();
      window.requestAnimationFrame(() => pendingEditorRef.current?.focus({ preventScroll: true }));
    }
  };
  const pendingPosition = (): Caret => pendingRef.current
    ? { parentId: pendingRef.current.parentId, index: pendingRef.current.index }
    : resolvedCaret();
  const savePending = async (keepWriting: boolean, completeAfterSave = false) => {
    const current = pendingRef.current;
    if (!current || creatingRef.current || disabled) return false;
    // Enter / Ctrl+Enter explicitly saves even an empty item.
    // Unused input fields remain unsaved on blur and Escape.
    creatingRef.current = true;
    setPendingSaving(true);
    let createdId: string | null = null;
    try {
      if (precedingEditSaveRef.current) await precedingEditSaveRef.current;
      await flushInlineDraft();
      const metadata: EntryCreateMetadata = {
        tag: pendingMeta.tag_value.trim() || undefined,
        note: pendingMeta.note_value.trim(),
        link_url: pendingMeta.link_value.trim(),
      };
      const created = await onCreateInline(current.value.trim(), current.parentId, current.index, draftId, metadata);
      createdId = created.id;
      recordUndo({ type: "create", id: created.id });
      setPendingMeta(emptyMeta);
      markInlineCommitted();
      if (completeAfterSave) {
        // 作成直後の行は親コンポーネントのentriesにまだないことがあるため、
        // 更新IDを直接渡し、生成直後でも確実に完了できるようにする。
        await onUpdate(created.id, { is_completed: true });
        recordUndo({ type: "complete", id: created.id, previous: false });
      }
      if (keepWriting || completeAfterSave) {
        const next = { parentId: current.parentId, index: current.index + 1, value: "" };
        changePending(next);
        setCaret(next);
        window.requestAnimationFrame(() => pendingEditorRef.current?.focus({ preventScroll: true }));
      } else changePending(null);
      setMessage("");
      return true;
    } catch (error) {
      showError(error);
      // 作成済みなのに完了だけ失敗した場合、元の文を再度追加して重複させない。
      if (createdId) {
        changePending(null);
        setMessage("項目は保存されましたが、完了の更新に失敗しました。");
      } else {
        // 作成失敗時は書きかけをそのまま保持する。
        changePending(current);
      }
      return false;
    } finally { creatingRef.current = false; setPendingSaving(false); }
  };
  /** Tab付きの貼り付けを、貼り付け元の相対階層のまま順に保存する。 */
  const savePastedPending = async (parts: OutlinePasteItem[]) => {
    const current = pendingRef.current;
    if (!current || creatingRef.current || disabled || parts.length === 0) return;
    if (onPasteOutlineBatch) {
      creatingRef.current = true;
      flushSync(() => changePending({ ...current, value: serializeOutlineItems(parts) }));
      setPendingSaving(true);
      try {
        if (precedingEditSaveRef.current) await precedingEditSaveRef.current;
        await flushInlineDraft();
        const result = await onPasteOutlineBatch(parts, current.parentId, current.index, { draftId,
          metadata: { tag: pendingMeta.tag_value.trim() || null, note: pendingMeta.note_value.trim(), link_url: pendingMeta.link_value.trim() } });
        recordUndo({ type: "paste", batch: result });
        markInlineCommitted();
        setPendingMeta(emptyMeta);
        const rootsCreated = parts.filter(part => part.depth === 0).length;
        const next = { parentId: current.parentId, index: current.index + rootsCreated, value: "" };
        changePending(next);
        setCaret(next);
        const depth = Math.max(...parts.map(part => part.depth)) + 1;
        setMessage(`${parts.length}行・${depth}階層を取り込みました。Ctrl+Zでまとめて戻せます。`);
        window.requestAnimationFrame(() => pendingEditorRef.current?.focus({ preventScroll: true }));
      } catch(error) {
        changePending({ ...current, value: serializeOutlineItems(parts) });
        showError(error);
      } finally {
        creatingRef.current = false;
        setPendingSaving(false);
      }
      return;
    }
    creatingRef.current = true;
    let done = 0;
    let rootsCreated = 0;
    const createdAtDepth: string[] = [];
    const childIndices = new Map<string, number>();
    // 書きかけを失わないため、まずTab付き原文を下書きに保存する。
    flushSync(() => changePending({ ...current, value: serializeOutlineItems(parts) }));
    setPendingSaving(true);
    try {
      if (precedingEditSaveRef.current) await precedingEditSaveRef.current;
      await flushInlineDraft();
      for (const part of parts) {
        const isRoot = part.depth === 0;
        const parentId = isRoot ? current.parentId : createdAtDepth[part.depth - 1];
        if (parentId === undefined) throw new Error("貼り付けた文章の親項目が見つかりません。");
        const index = isRoot ? current.index + rootsCreated : (childIndices.get(parentId as string) ?? 0);
        const metadata: EntryCreateMetadata = done === 0 ? {
          tag: pendingMeta.tag_value.trim() || undefined,
          note: pendingMeta.note_value.trim(),
          link_url: pendingMeta.link_value.trim(),
        } : {};
        const created = await onCreateInline(part.content, parentId, index,
          done === parts.length - 1 ? draftId : undefined, metadata);
        recordUndo({ type: "create", id: created.id });
        createdAtDepth[part.depth] = created.id;
        createdAtDepth.length = part.depth + 1;
        if (isRoot) rootsCreated++;
        else childIndices.set(parentId as string, index + 1);
        done++;
      }
      markInlineCommitted();
      setPendingMeta(emptyMeta);
      const next = { parentId: current.parentId, index: current.index + rootsCreated, value: "" };
      changePending(next);
      setCaret(next);
      window.requestAnimationFrame(() => pendingEditorRef.current?.focus({ preventScroll: true }));
      if (parts.some(part => part.depth > 0))
        setMessage(`${done}行・${Math.max(...parts.map(part => part.depth)) + 1}階層を取り込みました。`);
      else setMessage("");
    } catch (error) {
      if (done > 0) setPendingMeta(emptyMeta);
      // 失敗分はTab付きのまま保持し、何が保存されたかを明示する。
      changePending({ ...current, index: current.index + rootsCreated, value: serializeOutlineItems(parts.slice(done)) });
      showError(new Error(`${done}行を保存しました。残り${parts.length - done}行は入力欄に保持しました。 ${error instanceof Error ? error.message : ""}`));
    } finally { creatingRef.current = false; setPendingSaving(false); }
  };
  useEffect(() => {
    if (visible.length === 0 && pendingRef.current === null && !disabled)
      beginPending({ parentId: scopeId, index: 0 });
  }, [visible.length, scopeId, disabled]);
  const focusInline = () => {
    if (pendingRef.current) { pendingEditorRef.current?.focus({ preventScroll: true }); return; }
    if (selectedId && nodeById.has(selectedId)) { startEdit(nodeById.get(selectedId)!); return; }
    const last = visible.at(-1);
    beginPending(last ? siblingAfter(last) : { parentId: scopeId, index: persistedChildrenOf(scopeId).length });
  };
  const pastePlainText = (text: string) => {
    if (!text.trim() || disabled) return false;
    const current = pendingRef.current;
    const parts = normalizeOutlineItems(current ? current.value + text : text);
    if (parts.length < 2) {
      if (current) changePending({ ...current, value: current.value + text });
      else beginPending(selectedId && nodeById.has(selectedId) ? siblingAfter(nodeById.get(selectedId)!) : { parentId: scopeId, index: persistedChildrenOf(scopeId).length }, text);
      return true;
    }
    const selected = selectedId ? nodeById.get(selectedId) : null;
    const position = current ?? { ...(selected ? siblingAfter(selected) : { parentId: scopeId, index: persistedChildrenOf(scopeId).length }), value: "" };
    if (!current) changePending(position);
    const analysis = analyzeOutlinePaste(current ? current.value + text : text);
    if (analysis.needsReview && onPasteOutlineBatch) {
      setPasteReview({ source: current ? current.value + text : text, context: "pending",
        parentId:position.parentId,index:position.index,mode:"auto" });
    } else void savePastedPending(parts);
    return true;
  };
  const caretAfterRow = (row: EntryTreeNode): Caret => siblingAfter(row);
  const selectRow = (row: EntryTreeNode, { moveCaret = true }: { moveCaret?: boolean } = {}) => {
    focusEpochRef.current++;
    setSelectedId(row.id);
    if (moveCaret) {
      setCaret(caretAfterRow(row));
      onRowSelected?.(row);
    }
  };

  useImperativeHandle(ref, () => ({
    focusInline,
    pastePlainText,
    hasPendingDraft: () => Boolean(pendingRef.current?.value.trim()),
    restorePendingDraft: (snapshot) => {
      const position = resolvedCaret();
      setPendingMeta(snapshot);
      beginPending(position, snapshot.content);
    },
    insertPosition: () => {
      // 続けて置くとき、直前に置いた行がまだ一覧に届いていないことがある。位置は丸めず、保存側で丸める。
      const raw: Caret = caretRef.current ?? { parentId: scopeId, index: persistedChildrenOf(scopeId).length };
      const recent = Date.now() - lastAdvanceRef.current < 2_000;
      const position = raw.parentId === null || allNodeById.has(raw.parentId) || recent
        ? raw
        : { parentId: scopeId, index: persistedChildrenOf(scopeId).length };
      lastInsertRef.current = position;
      return position;
    },
    advance: (createdId?: string) => {
      const position = lastInsertRef.current ?? resolvedCaret();
      lastAdvanceRef.current = Date.now();
      if (createdId) recentRef.current.set(createdId, { parentId: position.parentId, index: position.index, at: lastAdvanceRef.current });
      setCaret({ parentId: position.parentId, index: position.index + 1 });
    },
    indentCaret: () => {
      // Do not clamp a fresh, not-yet-rendered row's insertion position.
      const target = indentTarget(caretRef.current ?? resolvedCaret());
      if (!target) return;
      setCollapsed(before => { const next = new Set(before); next.delete(target.parentId!); return next; });
      setCaret(target);
    },
    outdentCaret: () => {
      const { parentId } = caretRef.current ?? resolvedCaret();
      if (parentId === null || parentId === scopeId) return;
      const position = siblingPositionAfter(allEntries, parentId);
      if (position) {
        setCaret(position);
        return;
      }
      // The parent may have been created but not yet rendered.
      const recent = recentRef.current.get(parentId);
      if (recent && Date.now() - recent.at < 2_000)
        setCaret({ parentId: recent.parentId, index: recent.index + 1 });
    },
    focusRowAboveCaret: () => {
      const row = visible[spot.at - 1];
      if (!row) return false;
      selectRow(row, { moveCaret: false });
      focusRow(row.id);
      return true;
    },
    focusRowBelowCaret: () => {
      const row = visible[spot.at];
      if (!row) return false;
      selectRow(row, { moveCaret: false });
      focusRow(row.id);
      return true;
    },
    placeCaretAfter: (rowId: string) => {
      const row = nodeById.get(rowId);
      if (row) setCaret(caretAfterRow(row));
    },
    resetCaret: () => setCaret(null),
    describeCaret: () => caretDescription,
    moveRow: (rowId: string, action: "indent" | "outdent" | "up" | "down") => {
      const row = nodeById.get(rowId);
      if (row) move(row, action);
    },
    zoomTo: (rowId: string | null) => zoomTo(rowId),
    undoLast: () => { void undoLast(); },
    recordExternalEdit: (id: string, previous: string) => recordUndo({ type: "edit", id, previous }),
    recordExternalCreate: (id: string) => recordUndo({ type: "create", id }),
    recordExternalCompletion: (id: string, previous: boolean, changes: OutlineCompletionChange[]) => recordUndo({ type: "complete", id, previous, changes }),
    revealRow: (rowId: string) => {
      const row = nodeById.get(rowId);
      if (!row) return;
      // 畳まれた親の中にいるときは開く。
      setCollapsed((before) => {
        const next = new Set(before);
        let parentId = row.parent_id;
        while (parentId) { next.delete(parentId); parentId = nodeById.get(parentId)?.parent_id ?? null; }
        return next;
      });
      setSelectedId(rowId);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(rowId)}"]`)
          ?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
    },
  }));

  const showError = (error: unknown) => setMessage(error instanceof Error ? error.message : "操作を保存できませんでした。");
  const updateText = async (id: string, content: string) => {
    const next = content.trim();
    const previous = nodeById.get(id)?.content;
    if (next === previous) { setEditingId(idNow => idNow === id ? null : idNow); return true; }
    try {
      await onUpdate(id, { content: next });
      if (previous !== undefined) recordUndo({ type: "edit", id, previous });
      setEditingId(idNow => idNow === id ? null : idNow);
      setMessage("");
      return true;
    } catch (error) { showError(error); return false; }
  };
  const commitEditing = async () => {
    if (!editingId || savingRef.current) return false;
    savingRef.current = true;
    try { return await updateText(editingId, editingValue); }
    finally { savingRef.current = false; }
  };
  /** 選択中でも本文編集中でも同じCtrl+Enter。保存後に完了し、次の文字入力先へ移る。 */
  const toggleRowCompletion = async (row: EntryTreeNode, fromEditor = false) => {
    if (disabled || busy || savingRef.current || !onToggleCompleted) return;
    const focusEpoch = ++focusEpochRef.current;
    const idx = visible.findIndex(item => item.id === row.id);
    let next = visible.slice(idx + 1).find(item => !item.is_completed)
      ?? visible.slice(0, Math.max(0, idx)).reverse().find(item => !item.is_completed);
    savingRef.current = true;
    // 編集欄を外す際のblur処理と二重保存しない。
    skipBlurRef.current = fromEditor;
    try {
      if (fromEditor) {
        const content = editingValue.trim();
        if (content !== row.content) {
          await onUpdate(row.id, { content });
          recordUndo({ type: "edit", id: row.id, previous: row.content });
        }
      }
      const changes = await onToggleCompleted(row.id);
      if(changes.length)recordUndo({ type: "complete", id: row.id, previous: row.is_completed, changes });
      // Do not move keyboard focus into descendants that were just completed.
      const completedIds=new Set(changes.filter(change=>change.next).map(change=>change.id));
      if(next&&completedIds.has(next.id)){
        next=visible.slice(idx+1).find(item=>!item.is_completed&&!completedIds.has(item.id))
          ??visible.slice(0,Math.max(0,idx)).reverse().find(item=>!item.is_completed&&!completedIds.has(item.id));
      }
      setEditingId(null);
      setMessage(row.is_completed ? "項目を再開しました。" : `この枝の${changes.length}項目を完了しました。元に戻せます。`);
      // 完了した行が一覧から消えても、キーボード操作を途切れさせない。
      window.requestAnimationFrame(() => {
        if (focusEpoch !== focusEpochRef.current) {
          skipBlurRef.current = false;
          return;
        }
        if (next && document.querySelector(`[data-outline-id="${CSS.escape(next.id)}"]`)) {
          startEdit(next, next.content.length);
        } else if (document.querySelector(`[data-outline-id="${CSS.escape(row.id)}"]`)) {
          startEdit({ ...row, content: fromEditor ? editingValue.trim() : row.content });
        } else {
          beginPending({ parentId: scopeId, index: childrenOf(scopeId).length });
        }
        skipBlurRef.current = false;
      });
    } catch (error) {
      showError(error);
      if (fromEditor) setEditingId(null);
      skipBlurRef.current = false;
    } finally {
      savingRef.current = false;
    }
  };

  const moveTo = async (id: string, parentId: string | null, index: number) => {
    if (busy || disabled || undoInFlightRef.current) return;
    const previous = locationOf(id);
    if (!previous || previous.index < 0) return;
    if (previous.parentId === parentId && previous.index === index) return;
    setBusy(true);
    try {
      await onRelocate(id, parentId, index);
      recordUndo({ type: "move", ...previous });
      setSelectedId(id);
      setMessage("");
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  const undoLast = async () => {
    if (disabled || busy || editingId || pendingRef.current?.value.trim() || savingRef.current || undoInFlightRef.current) return;
    const last = undoStackRef.current.at(-1);
    if (!last) return;
    if (last.type === "paste") {
      if (!onUndoPasteOutlineBatch) return;
      undoInFlightRef.current = true;
      setBusy(true);
      try {
        await onUndoPasteOutlineBatch(last.batch);
        undoStackRef.current.pop();
        setUndoDepth(undoStackRef.current.length);
        setRedoPasteBatch(last.batch);
        setMessage(`${last.batch.created.length}行の取り込みを元に戻しました。`);
      } catch(error) { showError(error); }
      finally { undoInFlightRef.current=false; setBusy(false); }
      return;
    }
    const target = nodeById.get(last.id);
    if (!target && last.type !== "complete") {
      // 反映待ちの行を誤って履歴から捨てない。次回そのまま再試行できる。
      setMessage("対象の行がまだ表示されていません。更新後にもう一度お試しください。");
      return;
    }
    if (last.type === "create" && (!target || target.has_children || !onUndoCreate)) {
      setMessage("子がある行は安全のためUndoしません。項目の操作から確認してください。");
      return;
    }
    const originalLocation = locationOf(last.id);
    undoInFlightRef.current = true;
    setBusy(true);
    try {
      if (last.type === "edit") await onUpdate(last.id, { content: last.previous });
      else if (last.type === "move") await onRelocate(last.id, last.parentId, last.index);
      else if (last.type === "complete") {
        if(last.changes&&onRestoreCompletion)await onRestoreCompletion(last.changes);
        else await onUpdate(last.id,{is_completed:last.previous});
      }
      else await onUndoCreate!(target!);
      undoStackRef.current.pop();
      setUndoDepth(undoStackRef.current.length);
      setMessage("");
      if (last.type === "create") {
        setSelectedId(null);
        if (originalLocation) {
          const restored = pendingRef.current;
          if (restored) changePending({ ...restored, parentId: originalLocation.parentId, index: originalLocation.index });
          setCaret({ parentId: originalLocation.parentId, index: originalLocation.index });
        }
      } else if (last.type === "complete") {
        // 非表示だった行もUndoで復元できる。実際のDOM反映後に編集位置を戻す。
        setSelectedId(last.id);
        window.requestAnimationFrame(() => focusRow(last.id));
      } else {
        setSelectedId(last.id);
        focusRow(last.id);
      }
    } catch (error) { showError(error); }
    finally { undoInFlightRef.current = false; setBusy(false); }
  };
  const redoLastPaste = async () => {
    if (!redoPasteBatch || !onRedoPasteOutlineBatch || busy || disabled) return;
    setBusy(true);
    try {
      const result = await onRedoPasteOutlineBatch(redoPasteBatch);
      recordUndo({ type: "paste", batch: result });
      setMessage(`${result.created.length}行の取り込みを再実行しました。`);
    } catch(error) { showError(error); }
    finally { setBusy(false); }
  };
  const move = (row: EntryTreeNode, action: "indent" | "outdent" | "up" | "down") => {
    const siblings = childrenOf(row.parent_id);
    const index = siblings.findIndex((entry) => entry.id === row.id);
    if (index < 0) return;
    if (action === "indent" && index > 0) {
      const preceding = siblings[index - 1];
      void moveTo(row.id, preceding.id, persistedChildrenOf(preceding.id).length);
      setCollapsed((before) => { const next = new Set(before); next.delete(preceding.id); return next; });
    } else if (action === "outdent" && row.parent_id && row.parent_id !== scopeId) {
      const parent = nodeById.get(row.parent_id);
      if (parent) {
        const parentIndex = persistedChildrenOf(parent.parent_id).findIndex((entry) => entry.id === parent.id);
        void moveTo(row.id, parent.parent_id, parentIndex + 1);
      }
    } else if (action === "up" || action === "down") {
      // Position relative to the visible neighboring ID, not a filtered list index.
      // A completed (hidden) sibling can sit between two visible branches.
      const destination = siblingMoveIndex(allEntries, entries, row.id, action);
      if (destination !== null) void moveTo(row.id, row.parent_id, destination);
    }
  };
  const startEdit = (row: EntryTreeNode, offset = row.content.length) => {
    if (disabled || creatingRef.current) return;
    focusEpochRef.current++;
    if (pendingRef.current?.value.trim()) void savePending(false);
    else if (pendingRef.current) changePending(null);
    requestedSelectionRef.current = { id: row.id, offset };
    setSelectedId(row.id);
    setCaret(siblingAfter(row));
    setEditingValue(row.content);
    setEditingId(row.id);
  };

  /** キー移動では編集画面を閉じずに保存。通信完了を待ってカーソルを奪わない。 */
  const saveOnNavigation = (row: EntryTreeNode): boolean => {
    const next = editingValue.trim();
    if (next !== row.content) {
      void onUpdate(row.id, { content: next }).then(() => {
        recordUndo({ type: "edit", id: row.id, previous: row.content });
      }).catch(showError);
    }
    return true;
  };
  const navigateEditor = (row: EntryTreeNode, direction: "up" | "down", field: HTMLTextAreaElement) => {
    const index = visible.findIndex(item => item.id === row.id);
    const next = visible[index + (direction === "up" ? -1 : 1)];
    if (!next || !saveOnNavigation(row)) return false;
    const logicalStart = editingValue.lastIndexOf("\n", field.selectionStart - 1) + 1;
    const column = field.selectionStart - logicalStart;
    // textareaを再マウントしても、選択状態ではなく文字カーソルを復元する。
    skipBlurRef.current = true;
    startEdit(next, adjacentCursorOffset(next.content, column, direction));
    window.requestAnimationFrame(() => { skipBlurRef.current = false; });
    return true;
  };
  const reorderFromEditor = (row: EntryTreeNode, direction: "up" | "down") => {
    if (busy || savingRef.current || disabled) return;
    const next = editingValue.trim();
    if (next === row.content) { move(row, direction); return; }
    savingRef.current = true;
    void onUpdate(row.id, { content: next }).then(() => {
      recordUndo({ type: "edit", id: row.id, previous: row.content });
      move(row, direction);
    }).catch(showError).finally(() => { savingRef.current = false; });
  };
  const toggleCollapsed = (id: string) => setCollapsed((previous) => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  /** No new toolbar: a selected bullet/number and a hotkey are the controls. */
  const foldActiveBranch = () => {
    if (disabled || busy) return;
    const id = editingId ?? selectedId ?? pendingRef.current?.parentId ?? caretRef.current?.parentId;
    const row = id ? nodeById.get(id) : null;
    if (!row?.has_children) {
      setMessage("子項目のある行を選ぶと、Ctrl / ⌘ + . で開閉できます。");
      return;
    }
    toggleCollapsed(row.id);
    setMessage("");
  };
  const foldActiveLevel = () => {
    if (disabled || busy) return;
    const id = editingId ?? selectedId ?? pendingRef.current?.parentId ?? caretRef.current?.parentId;
    const active = id ? nodeById.get(id) : null;
    const depth = active?.depth ?? (zoom?.depth ?? -1) + 1;
    if (!foldableBranchesAtLevel(entries, depth, scopeId).length) {
      setMessage("この階層には、子項目のある行がありません。");
      return;
    }
    setCollapsed(previous => toggleFoldedLevel(previous, entries, depth, scopeId));
    setMessage("");
  };
  // Command palette uses the same actions as direct keyboard controls.
  useEffect(() => {
    const foldOne = () => foldActiveBranch();
    const foldLevel = () => foldActiveLevel();
    window.addEventListener("kakidas:outline-fold-branch", foldOne);
    window.addEventListener("kakidas:outline-fold-level", foldLevel);
    return () => {
      window.removeEventListener("kakidas:outline-fold-branch", foldOne);
      window.removeEventListener("kakidas:outline-fold-level", foldLevel);
    };
  });
  const onFoldKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 ||
        event.key === "Process" || event.altKey || event.nativeEvent.getModifierState("AltGraph") ||
        !(event.ctrlKey || event.metaKey) ||
        !(event.code === "Period" || event.key === "." || event.key === ">")) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) foldActiveLevel();
    else foldActiveBranch();
  };
  const zoomTo = (id: string | null) => { setZoomId(id); setCaret(null); setSelectedId(null); };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: EntryTreeNode) => {
    if (disabled || busy || event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
      event.preventDefault();
      if (busy || disabled) return;
      const next = toggleOutlineEmphasis(row.content, 0, 0).value;
      void onUpdate(row.id, { content: next }).then(() => {
        recordUndo({ type: "edit", id: row.id, previous: row.content });
      }).catch(showError);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault(); void undoLast(); return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault(); void redoLastPaste(); return;
    }
    if (event.shiftKey && (event.altKey || event.ctrlKey) && !event.metaKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(row, event.key === "ArrowUp" ? "up" : "down");
      // 既存 Ctrl+Shift 操作は選択状態を維持し、Alt+Shift は直ちに編集へ戻る。
      if (event.altKey) startEdit(row);
      else focusRow(row.id);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault(); void toggleRowCompletion(row); return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); beginPending(siblingAfter(row), "", true); return;
    }
    if (event.key === "F2") { event.preventDefault(); startEdit(row); return; }
    if (event.key === "Tab") { event.preventDefault(); move(row, event.shiftKey ? "outdent" : "indent"); focusRow(row.id); return; }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.has_children && !collapsed.has(row.id)) toggleCollapsed(row.id);
      else if (row.parent_id && nodeById.has(row.parent_id)) { const parent = nodeById.get(row.parent_id)!; selectRow(parent); focusRow(parent.id); }
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.has_children && collapsed.has(row.id)) toggleCollapsed(row.id);
      else if (row.has_children) { const child = childrenOf(row.id)[0]; if (child) { selectRow(child); focusRow(child.id); } }
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const idx = visible.findIndex((item) => item.id === row.id);
      const next = visible[idx + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) startEdit(next, event.key === "ArrowUp" ? next.content.length : 0);
      else if (event.key === "ArrowDown") beginPending(siblingAfter(row), "", true);
    }
  };
  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, row: EntryTreeNode) => {
    if (event.nativeEvent.isComposing || event.key === "Process" || event.nativeEvent.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
      event.preventDefault();
      if (disabled || busy || savingRef.current) return;
      const field = event.currentTarget;
      const result = toggleOutlineEmphasis(editingValue, field.selectionStart, field.selectionEnd);
      setEditingValue(result.value);
      window.requestAnimationFrame(() => {
        if (editorRef.current === field) field.setSelectionRange(result.start, result.end);
      });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      void toggleRowCompletion(row, true);
      return;
    }
    // The Delete action removes a saved empty row; Backspace must not silently delete it.
    if (event.key === "Escape") {
      event.preventDefault(); skipBlurRef.current = true; setEditingId(null); setEditingValue(row.content); setSelectedId(row.id); focusRow(row.id); return;
    }
    if (event.shiftKey && (event.altKey || event.ctrlKey) && !event.metaKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      reorderFromEditor(row, event.key === "ArrowUp" ? "up" : "down");
      return;
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const direction = event.key === "ArrowUp" ? "up" : "down";
      if (isOnOuterVisualLine(event.currentTarget, direction)) {
        if (navigateEditor(row, direction, event.currentTarget)) event.preventDefault();
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) { move(row, event.shiftKey ? "outdent" : "indent"); focusRow(row.id); } }); return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const nextContent = editingValue.trim();
      // 文章中のカーソル位置には依存しない。元の行を分割せず、次の兄弟行を作る。
      // 親行を展開している場合も、新しい行は子孫のまとまりの後に表示される。
      const position = siblingAfter(row);
      if (nextContent !== row.content) {
        savingRef.current = true;
        const edited = nextContent;
        const save = onUpdate(row.id, { content: edited }).then(() => {
          recordUndo({ type: "edit", id: row.id, previous: row.content });
          setFailedEdit(current => current?.id === row.id ? null : current);
        }).catch(error => {
          // 次の空行に打ち始めた文章を消さず、元行の未保存テキストも再試行できる形で保護。
          setFailedEdit({ id: row.id, value: edited });
          showError(new Error("元の行を保存できませんでした。文章は保持しました。再試行してください。"));
          throw error;
        }).finally(() => {
          savingRef.current = false;
          if (precedingEditSaveRef.current === save) precedingEditSaveRef.current = null;
        });
        precedingEditSaveRef.current = save;
        void save.catch(() => undefined);
      }
      beginPending(position, "", true);
      return;
    }
  };

  const runExistingPaste = async (row: EntryTreeNode, items: OutlinePasteItem[], merged: string) => {
    if (!onPasteOutlineBatch || creatingRef.current || disabled) return;
    savingRef.current = true; setBusy(true);
    try {
      const batch = await onPasteOutlineBatch(items, row.parent_id, 0, {targetId:row.id, expectedContent:row.content});
      recordUndo({type:"paste",batch});
      setEditingId(null);
      setSelectedId(row.id);
      setMessage(`${items.length}行をまとめて取り込みました。Ctrl+Zで戻せます。`);
    } catch(error) {
      // 失敗した貼り付け文字列を編集欄へ戻し、ユーザーの文章を失わない。
      setEditingValue(merged);
      showError(error);
    } finally { savingRef.current=false; setBusy(false); }
  };
  const onEditorPaste = (event: import("react").ClipboardEvent<HTMLTextAreaElement>, row: EntryTreeNode) => {
    if (!onPasteRows || disabled || savingRef.current) return;
    const field = event.currentTarget;
    const pasted = event.clipboardData.getData("text/plain");
    const lines = itemsFromOutlinePaste(editingValue, field.selectionStart, field.selectionEnd, pasted);
    if (!lines) return;
    event.preventDefault();
    const merged = editingValue.slice(0, field.selectionStart) + pasted + editingValue.slice(field.selectionEnd);
    if (onPasteOutlineBatch) {
      const analysis = analyzeOutlinePaste(merged);
      if (analysis.needsReview) {
        skipBlurRef.current = true;
        setPasteReview({ source: merged, context: "editor", targetId: row.id, expectedContent: row.content,
          parentId: row.parent_id, index: 0, mode: "auto" });
        return;
      }
      void runExistingPaste(row, analysis.items, merged);
      return;
    }
    setEditingValue(merged);
    savingRef.current = true;
    setBusy(true);
    void onPasteRows(row, lines).then(() => {
      setEditingId(null);
      setSelectedId(row.id);
      setMessage("");
    }).catch(showError).finally(() => {
      savingRef.current = false;
      setBusy(false);
    });
  };

  const onPendingKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === "Process" || event.nativeEvent.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !pendingRef.current?.value.trim()) {
      event.preventDefault(); void undoLast(); return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault(); void redoLastPaste(); return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key === "Enter") {
      event.preventDefault();
      if (pendingRef.current) void savePending(false, true);
      return;
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")
      && isOnOuterVisualLine(event.currentTarget, event.key === "ArrowUp" ? "up" : "down")) {
      const next = visible[spot.at + (event.key === "ArrowUp" ? -1 : 0)];
      if (next) {
        event.preventDefault();
        if (pendingRef.current?.value.trim()) {
          void savePending(false).then(saved => { if (saved) startEdit(next); });
        } else {
          changePending(null);
          startEdit(next);
        }
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void savePending(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (!pendingRef.current?.value.trim()) changePending(null);
      else void savePending(false);
    } else if (event.key === "Backspace" && !pendingRef.current?.value) {
      event.preventDefault();
      if (visible.length > 0) {
        changePending(null);
        startEdit(visible[Math.max(0, spot.at - 1)]);
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      const current = pendingRef.current;
      if (!current) return;
      if (event.shiftKey && current.parentId !== scopeId && current.parentId) {
        const position = siblingPositionAfter(allEntries, current.parentId);
        if (position) {
          changePending({ ...position, value: current.value });
          setCaret(position);
        }
      } else if (!event.shiftKey) {
        const target = indentTarget({ parentId: current.parentId, index: current.index });
        if (target) {
          setCollapsed(old => { const next = new Set(old); next.delete(target.parentId!); return next; });
          changePending({ ...target, value: current.value });
          setCaret(target);
        }
      }
    }
  };
  const onPendingPaste = (event: import("react").ClipboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget, current = pendingRef.current;
    if (!current) return;
    const pasted = event.clipboardData.getData("text/plain");
    const lines = itemsFromOutlinePaste(current.value, field.selectionStart, field.selectionEnd, pasted);
    if (!lines) return;
    event.preventDefault();
    const merged = current.value.slice(0,field.selectionStart)+pasted+current.value.slice(field.selectionEnd);
    const analysis = analyzeOutlinePaste(merged);
    if (analysis.needsReview && onPasteOutlineBatch) {
      setPasteReview({ source: merged, context: "pending", parentId: current.parentId,
        index: current.index, mode:"auto" });
      return;
    }
    void savePastedPending(analysis.items);
  };
  useEffect(() => {
    if (pending && !pendingSaving) pendingEditorRef.current?.focus({ preventScroll: true });
  }, [pendingSaving, pending?.parentId, pending?.index]);
  // 単一行は固定リズム。折り返す項目だけ行数に応じて成長させる。
  // textarea の初期1行高さのまま本文が隠れる問題と、編集開始時の跳ねを防ぐ。
  useLayoutEffect(() => {
    const fitToText = () => {
      for (const field of [editorRef.current, pendingEditorRef.current]) {
        if (!field) continue;
        const minimum = Number.parseFloat(window.getComputedStyle(field).minHeight) || 28;
        field.style.height = "0px";
        const contentHeight = Math.ceil(field.scrollHeight);
        // 折り返し後の最終行まで表示。単一行の行高は変えない。
        field.style.height = `${Math.max(minimum, contentHeight > minimum ? contentHeight + 4 : minimum)}px`;
      }
    };
    fitToText();
    // 横幅が変わっても、編集内容に触れずに高さを再計算する。
    // 値や編集対象の変更時は上のfitToTextが直ちに走る。
    const tree = (editorRef.current ?? pendingEditorRef.current)?.closest(".outline__tree");
    if (!tree || typeof ResizeObserver === "undefined") return;
    let width = tree.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? width;
      if (Math.abs(nextWidth - width) < 1) return;
      width = nextWidth;
      fitToText();
    });
    observer.observe(tree);
    return () => observer.disconnect();
  }, [editingId, editingValue, pending?.value, dense]);
  const confirmPasteReview = () => {
    const review = pasteReview;
    if (!review) return;
    const items = analyzeOutlinePaste(review.source, {mode:review.mode}).items;
    setPasteReview(null);
    if (review.context === "editor" && review.targetId) {
      const row = nodeById.get(review.targetId);
      if (!row || row.content !== review.expectedContent) { setMessage("編集元が変更されています。もう一度貼り付けてください。"); return; }
      void runExistingPaste(row, items, review.source);
    } else {
      const pendingCurrent = pendingRef.current;
      if (!pendingCurrent) beginPending({parentId:review.parentId,index:review.index});
      // 直接呼ぶのではなく、現在の入力行があることを確認してから実行。
      window.requestAnimationFrame(() => void savePastedPending(items));
    }
  };
  const reviewAnalysis = pasteReview ? analyzeOutlinePaste(pasteReview.source, {mode:pasteReview.mode}) : null;
  useEffect(() => {
    if (!pasteReview) return;
    const frame = window.requestAnimationFrame(() => pasteReviewSelectRef.current?.focus({ preventScroll:true }));
    return () => window.cancelAnimationFrame(frame);
  }, [Boolean(pasteReview)]);
  const pendingNode = pending ? (
    <div key="pending-outline-row" className="outline__item outline__item--pending"
      data-outline-pending="" role="treeitem"
      aria-level={spot.depth + 1}
      style={{ "--outline-depth": spot.depth } as CSSProperties}>
      <span className="outline__marker outline__marker--bullet" aria-hidden="true">•</span>
      <textarea ref={pendingEditorRef} className="outline__edit outline__edit--pending" rows={1} data-kakidas-time-input=""
        disabled={disabled || pendingSaving}
        aria-label="新しいアウトライン項目" placeholder={visible.length ? "次の項目…" : "何から書く？"}
        value={pending.value} onChange={event => changePending({ ...pending, value: event.target.value })}
        onKeyDown={onPendingKeyDown} onPaste={onPendingPaste}
        onBlur={() => { if (pasteReview) return; if (pendingRef.current?.value.trim()) void savePending(false); else if (visible.length) changePending(null); }} />
    </div>
  ) : null;
  const caretNode = deskNode || ghostOn || caretPreviewVisible ? (
    <div
      key="outline-caret"
      role="none"
      data-outline-caret=""
      className={`outline__caret ${spot.end ? "outline__caret--end" : ""} ${!deskNode && caretPreviewVisible ? "outline__caret--floating-preview" : ""}`}
      style={{ "--outline-depth": spot.depth } as CSSProperties}
    >
      {deskNode ? (
        <>
          <span className="outline__caret-marker" aria-hidden="true">•</span>
          <div className="outline__caret-host">
            <div className="outline__insertion-context" aria-label={caretDescription}>
              <span className="outline__insertion-title">ここに追加</span>
              <span className="outline__insertion-level">第{spot.depth + 1}階層</span>
            </div>
            {deskNode}
          </div>
        </>
      ) : null}
      {caretPreviewVisible ? (
        <span className="outline__placement-indicator" aria-hidden="true">
          <span className="outline__placement-label">{caretDescription}</span>
        </span>
      ) : ghostOn ? <p className="outline__ghost">↳ ここに入ります</p> : null}
    </div>
  ) : null;

  const rowElement = (row: EntryTreeNode, index: number) => {
    const isSelected = selectedId === row.id;
    // フラットな兄弟行は詰め、子のまとまりを抜けて大項目へ戻る箇所だけ空ける。
    const startsGroup = index > 0 && rowDepth(row) === 0 && rowDepth(visible[index - 1]) > 0;
    const isBound = (paragraphsByRowId?.get(row.id)?.length ?? 0) > 0;
    return <div key={row.id} className={`outline__item-wrap ${startsGroup ? "outline__item-wrap--group-start" : ""}`}>
      <div
        data-outline-id={row.id}
        data-outline-parent-id={row.parent_id ?? ""}
        data-outline-sort-order={row.sort_order}
        data-entry-id={row.id}
        className={`outline__item ${isSelected ? "outline__item--selected" : ""} ${row.is_completed ? "outline__item--completed" : ""} ${row.has_children && collapsed.has(row.id) ? "outline__item--folded" : ""} ${lensIds?.has(row.id) ? "outline__item--lens" : ""}`}
        role="treeitem"
        aria-level={zoom ? row.depth - zoom.depth : row.depth + 1}
        aria-selected={isSelected}
        aria-expanded={row.has_children ? !collapsed.has(row.id) : undefined}
        tabIndex={isSelected || (selectedId === null && visible[0]?.id === row.id) ? 0 : -1}
        onFocus={() => { focusEpochRef.current++; setSelectedId(row.id); if (editingId !== row.id) setCaret(siblingAfter(row)); }}
        onKeyDown={(event) => { if (event.target === event.currentTarget) onRowKeyDown(event, row); }}
        style={{ "--outline-depth": rowDepth(row) } as CSSProperties}
      >
        {row.has_children ? (
          <button type="button" tabIndex={-1}
            className={`outline__marker outline__marker--toggle ${numbered ? "outline__marker--number" : "outline__marker--bullet"}`}
            aria-label={`「${stripOutlineEmphasis(row.content).slice(0, 24) || "空の項目"}」の子項目を${collapsed.has(row.id) ? "展開" : "折りたたむ"}`}
            aria-expanded={!collapsed.has(row.id)}
            title={`${numbered ? row.outline_number : "•"}：${collapsed.has(row.id) ? "子階層を展開" : "子階層を折りたたむ"}（Ctrl / ⌘ + .）`}
            onClick={() => toggleCollapsed(row.id)}
          >{numbered ? row.outline_number : "•"}</button>
        ) : (
          <span className={`outline__marker ${numbered ? "outline__marker--number" : "outline__marker--bullet"}`}
            aria-hidden="true" title={numbered ? row.outline_number : undefined}>
            {numbered ? row.outline_number : "•"}
          </span>
        )}
        {editingId === row.id ? <textarea ref={editorRef} className="outline__edit" rows={1} value={editingValue} data-kakidas-time-input=""
          aria-label="アウトラインの本文を編集" onChange={(event) => setEditingValue(event.target.value)}
          onKeyDown={(event) => onEditorKeyDown(event, row)}
          onPaste={(event) => onEditorPaste(event, row)}
          onBlur={(event) => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest(".command-palette")) return; void commitEditing(); }}/>
        : <span className="outline__content"
            onClick={(event) => {
              // クリックでもタップでも文章をその場で編集。選択専用モードは作らない。
              event.stopPropagation();
              startEdit(row);
            }}
            onDoubleClick={() => startEdit(row)} title="クリックして編集">{outlineEmphasisSegments(row.content).map((part, i) =>
              part.emphasized
                ? <strong key={i} className="outline__red-bold">{part.text}</strong>
                : <span key={i}>{part.text}</span>
            )}{!row.content.trim() ? <span className="outline__empty-placeholder">空の項目</span> : null}</span>}
        <span className="outline__marks">
          {isBound ? <button type="button" className="outline__mark outline__mark--para" aria-label="段落を開く" title="この行の段落へ" onClick={() => onGrowRow?.(row.id)}>¶</button> : null}
          {row.has_children && collapsed.has(row.id) ? <span className="outline__child-count" aria-label={`子項目${row.child_count}件を折りたたみ中`} title={`子項目${row.child_count}件を折りたたみ中`}>内{row.child_count}件</span> : null}
          {row.link_url.trim() ? <a className="outline__mark outline__mark--link" href={row.link_url} target="_blank" rel="noreferrer" aria-label="リンクを開く" title={row.link_url}>↗</a> : null}
          {row.note.trim() ? <span className="outline__mark outline__mark--note" title={row.note} aria-label="気持ち・備考あり">✎</span> : null}
          {row.tag ? <span className="outline__chip">#{row.tag}</span> : null}
        </span>
        <div className="outline__actions">
          {onGrowRow ? <button type="button" className="outline__grow-action" title={isBound ? "この行の段落へ" : "段落にする(この行を見出しに)"} aria-label={isBound ? "段落を開く" : "段落にする"} onClick={() => onGrowRow(row.id)}>¶</button> : null}
          <button type="button" className="outline__zoom-action" title="この枝に集中" aria-label="この枝に集中" onClick={() => zoomTo(row.id)}>⌕</button>
          <button type="button" className="outline__details-action" title="詳細と操作" aria-label="項目の詳細" onClick={(event) => onOpenDetails(row.id, event.currentTarget)}>⋯</button>
          {onOpenActions ? <button type="button" className="outline__mobile-actions" aria-label="この項目の操作" onClick={() => onOpenActions(row.id)}>⋯</button> : null}
        </div>
      </div>
    </div>;
  };

  const rows: ReactNode[] = [];
  visible.forEach((row, index) => {
    if (pendingNode && spot.at === index) rows.push(pendingNode);
    if (caretNode && spot.at === index && !pendingNode) rows.push(caretNode);
    rows.push(rowElement(row, index));
  });
  if (pendingNode && spot.at >= visible.length) rows.push(pendingNode);
  if (caretNode && spot.at >= visible.length && !pendingNode) rows.push(caretNode);
  return <div className={`outline ${dense ? "outline--dense" : "outline--normal"}`}
    onKeyDownCapture={onFoldKeyDown}
    style={{ "--outline-marker-width": markerWidth } as CSSProperties}
    aria-label="アウトライン編集">
    {zoom ? <nav className="outline__breadcrumbs" aria-label="アウトラインのズーム位置">
      <button type="button" onClick={() => zoomTo(null)}>全体</button>
      {breadcrumbs.map((item) => <span key={item.id}> › <button type="button" onClick={() => zoomTo(item.id)}>{item.content}</button></span>)}
    </nav> : null}
    <div className="outline__tree" role="tree" aria-label="アウトラインの項目">
      {rows}

    </div>
    {completedOutlineCount > 0 && onToggleShowCompletedOutline ? (
      <div className="outline__completed-filter">
        <button
          type="button"
          className="outline__completed-toggle"
          aria-pressed={showCompletedOutline}
          onClick={onToggleShowCompletedOutline}
        >
          {showCompletedOutline
            ? `完了済み ${completedOutlineCount}件を隠す`
            : `完了済み ${completedOutlineCount}件を表示`}
        </button>
      </div>
    ) : null}
    {pasteReview && reviewAnalysis ? <section role="dialog" aria-label="階層の取り込みを確認"
      className="outline__paste-review" style={{padding:"16px",border:"1px solid var(--border-color, #bbb)",borderRadius:"12px",marginTop:"12px"}}>
      <strong>この階層で取り込みますか？</strong>
      <p>{reviewAnalysis.items.length}行・{reviewAnalysis.items.length ? Math.max(...reviewAnalysis.items.map(item=>item.depth))+1 : 0}階層
        {reviewAnalysis.reasons.length ? `｜${reviewAnalysis.reasons.join("・")}` : ""}</p>
      <label>階層の解釈 <select ref={pasteReviewSelectRef} aria-label="階層の解釈" value={pasteReview.mode} onChange={event=>setPasteReview({...pasteReview,mode:event.target.value as typeof pasteReview.mode})}>
        <option value="auto">自動</option><option value="two">2スペース</option><option value="four">4スペース</option><option value="flat">階層なし</option>
      </select></label>
      <div style={{maxHeight:"200px",overflowY:"auto",padding:"8px 0"}} aria-label="取り込み後の階層プレビュー">
        {reviewAnalysis.items.slice(0,60).map((item,i)=><div key={i} style={{paddingLeft:`${item.depth*18}px`,lineHeight:"1.65"}}>
          <span aria-hidden="true">• </span>{item.content}</div>)}
        {reviewAnalysis.items.length>60 ? <p>ほか{reviewAnalysis.items.length-60}行</p>:null}
      </div>
      <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
        <button type="button" onClick={confirmPasteReview}>この階層で取り込む</button>
        <button type="button" onClick={()=>{
          const old=pasteReview;setPasteReview(null);skipBlurRef.current=false;
          window.requestAnimationFrame(()=>old?.context==="editor"?editorRef.current?.focus({preventScroll:true}):pendingEditorRef.current?.focus({preventScroll:true}));
        }}>キャンセル</button>
      </div>
    </section> : null}
    {redoPasteBatch && onRedoPasteOutlineBatch ? <p className="outline__message" role="status">
      取り込みを元に戻しました。 <button type="button" onClick={()=>void redoLastPaste()}>やり直す（Redo）</button>
    </p> : null}
    {message ? <p className="outline__message" role="status">{message}
      {failedEdit ? <button type="button" onClick={() => {
        const item = failedEdit;
        void onUpdate(item.id, { content: item.value }).then(() => {
          setFailedEdit(null); setMessage("元の行の変更を保存しました。");
        }).catch(showError);
      }}>元の行を再保存</button> : null}
      <button type="button" onClick={() => setMessage("")}>閉じる</button>
    </p> : null}
  </div>;
});
