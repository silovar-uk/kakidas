import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EntryRow, EntryTreeNode, EntryUpdate } from "../types/memo";
import { normalizeOutlineLines, rowsFromOutlinePaste } from "../lib/outlinePaste.js";
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
};

type OutlineListProps = {
  entries: EntryTreeNode[];
  memoId: string;
  memoUpdatedAt: string;
  onCreateInline: (content: string, parentId: string | null, index: number, draftId?: string, metadata?: EntryCreateMetadata) => Promise<{ id: string }>;
  onRemoveInline?: (id: string) => Promise<void>;
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
  onToggleCompleted?: (id: string) => Promise<void>;
  onUpdate: (id: string, patch: EntryUpdate) => Promise<unknown>;
  /** 既存行の編集中に複数行を貼り付けた際、先頭を更新し残りを兄弟行として追加する。 */
  onPasteRows?: (row: EntryTreeNode, rows: string[]) => Promise<void>;
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
  | { type: "create"; id: string };

const isMobileViewport = () => window.matchMedia("(max-width: 920px)").matches;

/** 親子構造はDBの parent_id / sort_order に保存し、このコンポーネントには一時的な開閉・選択・次の一行の位置だけを置く。 */
export const OutlineList = forwardRef<OutlineHandle, OutlineListProps>(function OutlineList({
  entries,
  memoId,
  memoUpdatedAt,
  onCreateInline,
  onRemoveInline,
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
  onUpdate,
  onPasteRows,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  type PendingRow = { parentId: string | null; index: number; value: string };
  const [pending, setPending] = useState<PendingRow | null>(null);
  const pendingRef = useRef<PendingRow | null>(null);
  const pendingEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const creatingRef = useRef(false);
  const [pendingSaving, setPendingSaving] = useState(false);
  const changePending = (next: PendingRow | null) => { pendingRef.current = next; setPending(next); };
  const emptyMeta: EntryDraftSnapshot = {
    content: "", heading: "", tag_value: "", note_value: "", link_value: "",
    tag_draft: "", note_draft: "", link_draft: "", active_meta_picker: null,
  };
  const [pendingMeta, setPendingMeta] = useState<EntryDraftSnapshot>(emptyMeta);
  const draftId = buildEntryDraftId(memoId, "sentence", "main");
  const draftSnapshot = useMemo<EntryDraftSnapshot>(() => ({
    ...pendingMeta, content: pending?.value ?? "",
  }), [pending?.value, pendingMeta]);
  const { flush: flushInlineDraft, markCommitted: markInlineCommitted } = useDraftPersistence({
    id: draftId, memo_id: memoId, kind: "sentence", scope: "main", fixed_tag: null,
    base_memo_updated_at: memoUpdatedAt, snapshot: draftSnapshot,
    onRestore: (saved) => {
      if (!hasMeaningfulEntryDraft(saved) || pendingRef.current?.value.trim()) return;
      setPendingMeta(saved);
      changePending({ parentId: null, index: entries.filter(r => r.parent_id === null).length, value: saved.content });
    },
  });
  useEffect(() => {
    onInlineDraftChange?.(Boolean(pending?.value.trim()));
  }, [pending?.value, onInlineDraftChange]);
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [zoomId, setZoomId] = useState<string | null>(null);
  const undoStackRef = useRef<UndoableAction[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const undoInFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);
  const skipBlurRef = useRef(false);
  const lastInsertRef = useRef<Caret | null>(null);
  const lastAdvanceRef = useRef(0);
  /** 置いたばかりで、一覧にはまだ描かれていない行の位置(Tabが続けて来ても親にできるように)。 */
  const recentRef = useRef(new Map<string, { parentId: string | null; index: number; at: number }>());
  const nodeById = useMemo(() => new Map(entries.map((row) => [row.id, row])), [entries]);
  /** 表示切替で本文を動かさないよう、どちらのモードでも同じガターを確保する。 */
  const markerWidth = useMemo(() => {
    if (!numbered) return "12px";
    const maxLength = entries.reduce((max, row) => Math.max(max, row.outline_number.length), 1);
    return `${Math.min(120, Math.max(12, maxLength * 7 + 4))}px`;
  }, [entries, numbered]);
  /** 前の操作だけを保持する。データや既存のブラウザUndo履歴は変更しない。 */
  const recordUndo = (action: UndoableAction) => {
    undoStackRef.current = [...undoStackRef.current.slice(-29), action];
    setUndoDepth(undoStackRef.current.length);
  };
  useEffect(() => {
    const last = undoStackRef.current.at(-1);
    const description = !last ? null
      : last.type === "edit" ? "本文の変更を戻す"
      : last.type === "move" ? "行の移動を戻す"
      : "直前に追加した行を戻す";
    onUndoAvailabilityChange?.(undoDepth > 0 && !busy && !disabled && editingId === null, description);
  }, [undoDepth, busy, disabled, editingId, onUndoAvailabilityChange]);
  const childrenOf = (parentId: string | null) => entries
    .filter((row) => row.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const locationOf = (id: string): MoveHistory | null => {
    const row = nodeById.get(id);
    if (!row) return null;
    return { id, parentId: row.parent_id, index: childrenOf(row.parent_id).findIndex((item) => item.id === id) };
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

  /** 次の一行の位置。未指定、または親が消えたときは、範囲の末尾。 */
  const resolvedCaret = (): Caret => {
    const current = caretRef.current;
    if (current && (current.parentId === null || nodeById.has(current.parentId))) {
      return { parentId: current.parentId, index: Math.min(current.index, childrenOf(current.parentId).length) };
    }
    return { parentId: scopeId, index: childrenOf(scopeId).length };
  };
  const rowDepth = (row: EntryTreeNode) => (zoom ? Math.max(0, row.depth - zoom.depth - 1) : row.depth);

  /** 描く位置(visible の何番目の前か)・深さ・木の最後にあるか。 */
  const caretSpot = () => {
    const { parentId, index } = resolvedCaret();
    const list = childrenOf(parentId);
    const atScopeTop = parentId === null || parentId === scopeId;
    const parent = parentId ? nodeById.get(parentId) : null;
    const depth = atScopeTop || !parent ? 0 : rowDepth(parent) + 1;
    if (index < list.length) {
      const at = visible.findIndex((row) => row.id === list[index].id);
      if (at >= 0) return { at, depth, end: false, parentId, index };
    }
    if (atScopeTop) return { at: visible.length, depth, end: true, parentId, index };
    // 親の枝の最後に見えている子孫の直後。
    const lastVisibleIn = (id: string): string => {
      const children = childrenOf(id);
      return children.length === 0 || collapsed.has(id) ? id : lastVisibleIn(children[children.length - 1].id);
    };
    const last = lastVisibleIn(parentId as string);
    const at = visible.findIndex((row) => row.id === last) + 1;
    return { at, depth, end: at >= visible.length, parentId, index };
  };
  const spot = caretSpot();
  const caretDescription = (() => {
    const parent = spot.parentId ? nodeById.get(spot.parentId) : null;
    const level = spot.depth + 1;
    return parent ? `第${level}階層・親「${parent.content}」の下に追加` : `第${level}階層・最上位に追加`;
  })();
  useEffect(() => { onCaretDescribed?.(caretDescription); }, [caretDescription]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editingId) editorRef.current?.focus(); }, [editingId]);
  // 消えた行を選んだままにしない。
  useEffect(() => {
    if (selectedId && !nodeById.has(selectedId)) setSelectedId(null);
    if (editingId && !nodeById.has(editingId)) setEditingId(null);
  }, [editingId, nodeById, selectedId]);

  const focusRow = (id: string) => window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
  });
  const siblingAfter = (row: EntryTreeNode): Caret => ({
    parentId: row.parent_id,
    index: childrenOf(row.parent_id).findIndex(item => item.id === row.id) + 1,
  });
  const beginPending = (position: Caret, value = "", immediate = false) => {
    if (disabled || creatingRef.current) return;
    const render = () => {
      changePending({ ...position, value });
      setCaret(position);
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
  const savePending = async (keepWriting: boolean) => {
    const current = pendingRef.current;
    if (!current || creatingRef.current || disabled) return;
    if (!current.value.trim()) {
      if (!keepWriting) changePending(null);
      return;
    }
    creatingRef.current = true;
    setPendingSaving(true);
    try {
      await flushInlineDraft();
      const metadata: EntryCreateMetadata = {
        tag: pendingMeta.tag_value.trim() || undefined,
        note: pendingMeta.note_value.trim(),
        link_url: pendingMeta.link_value.trim(),
      };
      const created = await onCreateInline(current.value.trim(), current.parentId, current.index, draftId, metadata);
      recordUndo({ type: "create", id: created.id });
      setPendingMeta(emptyMeta);
      markInlineCommitted();
      if (keepWriting) {
        const next = { parentId: current.parentId, index: current.index + 1, value: "" };
        changePending(next);
        setCaret(next);
        window.requestAnimationFrame(() => pendingEditorRef.current?.focus({ preventScroll: true }));
      } else changePending(null);
      setMessage("");
    } catch (error) {
      showError(error);
      // 失敗した場合も変更前の書きかけと追加位置をそのまま保持する。
      changePending(current);
    } finally { creatingRef.current = false; setPendingSaving(false); }
  };
  const savePastedPending = async (parts: string[]) => {
    const current = pendingRef.current;
    if (!current || creatingRef.current || disabled || parts.length === 0) return;
    creatingRef.current = true;
    let done = 0;
    // 一覧の再描画と下書きフックを同期させてから永続保存へ進む。
    flushSync(() => changePending({ ...current, value: parts.join("\n") }));
    setPendingSaving(true);
    try {
      await flushInlineDraft();
      for (const line of parts) {
        const metadata: EntryCreateMetadata = done === 0 ? {
          tag: pendingMeta.tag_value.trim() || undefined,
          note: pendingMeta.note_value.trim(),
          link_url: pendingMeta.link_value.trim(),
        } : {};
        const created = await onCreateInline(line, current.parentId, current.index + done,
          done === parts.length - 1 ? draftId : undefined, metadata);
        recordUndo({ type: "create", id: created.id });
        done++;
      }
      markInlineCommitted();
      setPendingMeta(emptyMeta);
      const next = { parentId: current.parentId, index: current.index + done, value: "" };
      changePending(next);
      setCaret(next);
      window.requestAnimationFrame(() => pendingEditorRef.current?.focus({ preventScroll: true }));
      setMessage("");
    } catch (error) {
      if (done > 0) setPendingMeta(emptyMeta);
      changePending({ ...current, index: current.index + done, value: parts.slice(done).join("\n") });
      showError(error);
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
    beginPending(last ? siblingAfter(last) : { parentId: scopeId, index: 0 });
  };
  const pastePlainText = (text: string) => {
    if (!text.trim() || disabled) return false;
    const current = pendingRef.current;
    const parts = normalizeOutlineLines(text);
    if (parts.length < 2) {
      if (current) changePending({ ...current, value: current.value + text });
      else beginPending(selectedId && nodeById.has(selectedId) ? siblingAfter(nodeById.get(selectedId)!) : { parentId: scopeId, index: childrenOf(scopeId).length }, text);
      return true;
    }
    const position = current ?? { parentId: scopeId, index: childrenOf(scopeId).length, value: "" };
    if (!current) changePending(position);
    void savePastedPending(parts);
    return true;
  };
  const caretAfterRow = (row: EntryTreeNode): Caret => {
    // 開いている親を選んだら最初の子として、そうでなければ次の兄弟として入る(見えた場所に入る)。
    if (row.has_children && !collapsed.has(row.id)) return { parentId: row.id, index: 0 };
    return { parentId: row.parent_id, index: childrenOf(row.parent_id).findIndex((item) => item.id === row.id) + 1 };
  };
  const selectRow = (row: EntryTreeNode, { moveCaret = true }: { moveCaret?: boolean } = {}) => {
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
      const raw: Caret = caretRef.current ?? { parentId: scopeId, index: childrenOf(scopeId).length };
      const recent = Date.now() - lastAdvanceRef.current < 2_000;
      const position = raw.parentId === null || nodeById.has(raw.parentId) || recent
        ? raw
        : { parentId: scopeId, index: childrenOf(scopeId).length };
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
      const { parentId, index } = resolvedCaret();
      let previousId = childrenOf(parentId)[index - 1]?.id;
      if (!previousId) {
        const now = Date.now();
        for (const [id, recent] of recentRef.current) {
          if (now - recent.at < 2_000 && recent.parentId === parentId && recent.index === index - 1) previousId = id;
        }
      }
      if (!previousId) return;
      const parentKey = previousId;
      setCollapsed((before) => { const next = new Set(before); next.delete(parentKey); return next; });
      setCaret({ parentId: parentKey, index: childrenOf(parentKey).length });
    },
    outdentCaret: () => {
      const { parentId } = resolvedCaret();
      if (parentId === null || parentId === scopeId) return;
      const parent = nodeById.get(parentId);
      if (parent) {
        setCaret({ parentId: parent.parent_id, index: childrenOf(parent.parent_id).findIndex((item) => item.id === parentId) + 1 });
        return;
      }
      // 置いたばかりの行の下にいるときは、その行の次の位置へ。
      const recent = recentRef.current.get(parentId);
      if (recent) setCaret({ parentId: recent.parentId, index: recent.index + 1 });
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
    if (!next) { setMessage("空の項目は保存できません。Escで編集を取り消せます。"); return false; }
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
    const target = nodeById.get(last.id);
    if (!target) {
      // 反映待ちの行を誤って履歴から捨てない。次回そのまま再試行できる。
      setMessage("対象の行がまだ表示されていません。更新後にもう一度お試しください。");
      return;
    }
    if (last.type === "create" && (target.has_children || !onUndoCreate)) {
      setMessage("子がある行は安全のためUndoしません。項目の操作から確認してください。");
      return;
    }
    const originalLocation = locationOf(last.id);
    undoInFlightRef.current = true;
    setBusy(true);
    try {
      if (last.type === "edit") await onUpdate(last.id, { content: last.previous });
      else if (last.type === "move") await onRelocate(last.id, last.parentId, last.index);
      else await onUndoCreate!(target);
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
      } else {
        setSelectedId(last.id);
        focusRow(last.id);
      }
    } catch (error) { showError(error); }
    finally { undoInFlightRef.current = false; setBusy(false); }
  };
  const move = (row: EntryTreeNode, action: "indent" | "outdent" | "up" | "down") => {
    const siblings = childrenOf(row.parent_id);
    const index = siblings.findIndex((entry) => entry.id === row.id);
    if (index < 0) return;
    if (action === "indent" && index > 0) {
      const preceding = siblings[index - 1];
      void moveTo(row.id, preceding.id, childrenOf(preceding.id).length);
      setCollapsed((before) => { const next = new Set(before); next.delete(preceding.id); return next; });
    } else if (action === "outdent" && row.parent_id && row.parent_id !== scopeId) {
      const parent = nodeById.get(row.parent_id);
      if (parent) {
        const parentIndex = childrenOf(parent.parent_id).findIndex((entry) => entry.id === parent.id);
        void moveTo(row.id, parent.parent_id, parentIndex + 1);
      }
    } else if (action === "up" && index > 0) {
      void moveTo(row.id, row.parent_id, index - 1);
    } else if (action === "down" && index < siblings.length - 1) {
      void moveTo(row.id, row.parent_id, index + 1);
    }
  };
  const startEdit = (row: EntryTreeNode) => {
    if (disabled || creatingRef.current) return;
    if (pendingRef.current?.value.trim()) void savePending(false);
    else if (pendingRef.current) changePending(null);
    setSelectedId(row.id);
    setEditingValue(row.content);
    setEditingId(row.id);
  };
  const toggleCollapsed = (id: string) => setCollapsed((previous) => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const zoomTo = (id: string | null) => { setZoomId(id); setCaret(null); setSelectedId(null); };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: EntryTreeNode) => {
    if (disabled || busy || event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault(); void undoLast(); return;
    }
    if (event.ctrlKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault(); move(row, event.key === "ArrowUp" ? "up" : "down"); focusRow(row.id); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault(); void onToggleCompleted?.(row.id).catch(showError); return;
    }
    if (event.key === "Enter") { event.preventDefault(); startEdit(row); return; }
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
      if (next) { selectRow(next); focusRow(next.id); }
      else if (event.key === "ArrowDown") { beginPending(siblingAfter(row), "", true); }
    }
  };
  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, row: EntryTreeNode) => {
    if (event.nativeEvent.isComposing || event.key === "Process" || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Backspace" && !editingValue && !row.has_children && onRemoveInline) {
      event.preventDefault();
      void onRemoveInline(row.id).then(() => {
        setEditingId(null);
        setSelectedId(null);
        beginPending({ parentId: row.parent_id, index: siblingAfter(row).index - 1 });
      }).catch(showError);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault(); skipBlurRef.current = true; setEditingId(null); setEditingValue(row.content); setSelectedId(row.id); focusRow(row.id); return;
    }
    if (event.key === "Tab") {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) { move(row, event.shiftKey ? "outdent" : "indent"); focusRow(row.id); } }); return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const field = event.currentTarget;
      const offset = field.selectionStart;
      const before = editingValue.slice(0, offset).trim();
      const after = editingValue.slice(offset).trim();
      const position = offset === 0 ? {
        parentId: row.parent_id,
        index: Math.max(0, siblingAfter(row).index - 1),
      } : siblingAfter(row);
      if (!before && offset > 0) {
        setMessage("空の項目は保存できません。");
        return;
      }
      // 行頭でEnterは前へ空行を挿入。中間では文字列を分割。行末では次行を追加。
      if (offset === 0) {
        setEditingId(null);
        beginPending(position, "", true);
      } else {
        // 描画・フォーカス移動を保存通信より先に行い、高速な連続入力を取りこぼさない。
        const firstHalf = before;
        savingRef.current = true;
        setEditingValue(firstHalf);
        beginPending(position, after, true);
        void onUpdate(row.id, { content: firstHalf }).then(() => {
          if (firstHalf !== row.content) recordUndo({ type: "edit", id: row.id, previous: row.content });
        }).catch(showError).finally(() => { savingRef.current = false; });
      }
      return;
    }
    if (event.ctrlKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) move(row, event.key === "ArrowUp" ? "up" : "down"); });
    }
  };

  const onEditorPaste = (event: import("react").ClipboardEvent<HTMLTextAreaElement>, row: EntryTreeNode) => {
    if (!onPasteRows || disabled || savingRef.current) return;
    const field = event.currentTarget;
    const pasted = event.clipboardData.getData("text/plain");
    const lines = rowsFromOutlinePaste(editingValue, field.selectionStart, field.selectionEnd, pasted);
    if (!lines) return;
    event.preventDefault();
    // 途中で保存できなかった場合、元の入力内容を消さず再編集できるようにする。
    const merged = editingValue.slice(0, field.selectionStart) + pasted + editingValue.slice(field.selectionEnd);
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
        const parent = nodeById.get(current.parentId);
        if (parent) {
          const position = siblingAfter(parent);
          changePending({ ...position, value: current.value });
          setCaret(position);
        }
      } else if (!event.shiftKey) {
        const previous = childrenOf(current.parentId)[current.index - 1];
        if (previous) {
          const next = { parentId: previous.id, index: childrenOf(previous.id).length };
          setCollapsed(old => { const newer = new Set(old); newer.delete(previous.id); return newer; });
          changePending({ ...next, value: current.value });
          setCaret(next);
        }
      }
    }
  };
  const onPendingPaste = (event: import("react").ClipboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget, current = pendingRef.current;
    if (!current) return;
    const lines = rowsFromOutlinePaste(current.value, field.selectionStart, field.selectionEnd, event.clipboardData.getData("text/plain"));
    if (!lines) return;
    event.preventDefault();
    void savePastedPending(lines);
  };
  useEffect(() => {
    if (pending && !pendingSaving) pendingEditorRef.current?.focus({ preventScroll: true });
  }, [pendingSaving, pending?.parentId, pending?.index]);
  const pendingNode = pending ? (
    <div key="pending-outline-row" className="outline__item outline__item--pending"
      data-outline-pending="" role="treeitem"
      aria-level={spot.depth + 1}
      style={{ "--outline-depth": spot.depth } as CSSProperties}>
      <span className="outline__marker outline__marker--bullet" aria-hidden="true">•</span>
      <textarea ref={pendingEditorRef} className="outline__edit outline__edit--pending" rows={1}
        disabled={disabled || pendingSaving}
        aria-label="新しいアウトライン項目" placeholder={visible.length ? "次の項目…" : "何から書く？"}
        value={pending.value} onChange={event => changePending({ ...pending, value: event.target.value })}
        onKeyDown={onPendingKeyDown} onPaste={onPendingPaste}
        onBlur={() => { if (pendingRef.current?.value.trim()) void savePending(false); else if (visible.length) changePending(null); }} />
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

  const rowElement = (row: EntryTreeNode) => {
    const isSelected = selectedId === row.id;
    const isBound = (paragraphsByRowId?.get(row.id)?.length ?? 0) > 0;
    return <div key={row.id} className="outline__item-wrap">
      <div
        data-outline-id={row.id}
        data-outline-parent-id={row.parent_id ?? ""}
        data-outline-sort-order={row.sort_order}
        data-entry-id={row.id}
        className={`outline__item ${isSelected ? "outline__item--selected" : ""} ${row.is_completed ? "outline__item--completed" : ""} ${lensIds?.has(row.id) ? "outline__item--lens" : ""}`}
        role="treeitem"
        aria-level={zoom ? row.depth - zoom.depth : row.depth + 1}
        aria-selected={isSelected}
        aria-expanded={row.has_children ? !collapsed.has(row.id) : undefined}
        tabIndex={isSelected || (selectedId === null && visible[0]?.id === row.id) ? 0 : -1}
        onFocus={() => setSelectedId(row.id)}
        onKeyDown={(event) => { if (event.target === event.currentTarget) onRowKeyDown(event, row); }}
        style={{ "--outline-depth": rowDepth(row) } as CSSProperties}
      >
        {row.has_children ? (
          <button type="button" tabIndex={-1}
            className={`outline__marker outline__marker--toggle ${numbered ? "outline__marker--number" : "outline__marker--bullet"}`}
            aria-label={`「${row.content.slice(0, 24)}」の子項目を${collapsed.has(row.id) ? "展開" : "折りたたむ"}`}
            aria-expanded={!collapsed.has(row.id)}
            title={collapsed.has(row.id) ? "子項目を展開" : "子項目を折りたたむ"}
            onClick={() => toggleCollapsed(row.id)}
          >{numbered ? row.outline_number : "•"}</button>
        ) : (
          <span className={`outline__marker ${numbered ? "outline__marker--number" : "outline__marker--bullet"}`}
            aria-hidden="true" title={numbered ? row.outline_number : undefined}>
            {numbered ? row.outline_number : "•"}
          </span>
        )}
        {editingId === row.id ? <textarea ref={editorRef} className="outline__edit" rows={1} value={editingValue}
          aria-label="アウトラインの本文を編集" onChange={(event) => setEditingValue(event.target.value)}
          onKeyDown={(event) => onEditorKeyDown(event, row)}
          onPaste={(event) => onEditorPaste(event, row)}
          onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } void commitEditing(); }}/>
        : <span className="outline__content"
            onClick={(event) => {
              // クリックでもタップでも文章をその場で編集。選択専用モードは作らない。
              event.stopPropagation();
              startEdit(row);
            }}
            onDoubleClick={() => startEdit(row)} title="クリックして編集">{row.content}</span>}
        <span className="outline__marks">
          {isBound ? <button type="button" className="outline__mark outline__mark--para" aria-label="段落を開く" title="この行の段落へ" onClick={() => onGrowRow?.(row.id)}>¶</button> : null}
          {row.has_children && collapsed.has(row.id) ? <span className="outline__child-count">{row.child_count}</span> : null}
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
    rows.push(rowElement(row));
    if (!pendingNode) rows.push(
      <button key={`insert-after-${row.id}`} type="button" className="outline__insert-between"
        tabIndex={0} aria-label={`「${row.content.slice(0, 24)}」の後に項目を挿入`}
        onClick={() => beginPending(siblingAfter(row))}>＋</button>
    );
  });
  if (pendingNode && spot.at >= visible.length) rows.push(pendingNode);
  if (caretNode && spot.at >= visible.length && !pendingNode) rows.push(caretNode);
  if (!pendingNode && visible.length > 0) rows.push(
    <button key="outline-add-last" type="button" className="outline__add-last"
      onClick={() => beginPending({ parentId: scopeId, index: childrenOf(scopeId).length })}>
      ＋ 項目を追加
    </button>
  );

  return <div className={`outline ${dense ? "outline--dense" : "outline--normal"}`}
    style={{ "--outline-marker-width": markerWidth } as CSSProperties}
    aria-label="アウトライン編集">
    {zoom ? <nav className="outline__breadcrumbs" aria-label="アウトラインのズーム位置">
      <button type="button" onClick={() => zoomTo(null)}>全体</button>
      {breadcrumbs.map((item) => <span key={item.id}> › <button type="button" onClick={() => zoomTo(item.id)}>{item.content}</button></span>)}
    </nav> : null}
    <div className="outline__tree" role="tree" aria-label="アウトラインの項目">
      {rows}
      {visible.length === 0 && !pendingNode ? <button type="button" className="outline__add-last"
        onClick={() => beginPending({ parentId: scopeId, index: 0 })}>最初の項目を書く</button> : null}
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
    {message ? <p className="outline__message" role="status">{message} <button type="button" onClick={() => setMessage("")}>閉じる</button></p> : null}
  </div>;
});
