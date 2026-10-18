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
import { UndoToast } from "./UndoToast";
import type { EntryTreeNode, EntryUpdate } from "../types/memo";

/** 「次の一行」(書き口が入る場所)。parentId=null は範囲(全体か集中中の枝)の一番上の階層。 */
type Caret = { parentId: string | null; index: number };

export type OutlineHandle = {
  /** 作るときの位置。親と、兄弟の中での位置。 */
  insertPosition(): Caret;
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
};

type OutlineListProps = {
  entries: EntryTreeNode[];
  disabled?: boolean;
  /** 高密度表示か。切り替えは列のメニュー(EntryColumn)に置く。 */
  dense: boolean;
  onRelocate: (id: string, parentId: string | null, index: number) => Promise<void>;
  /** スマホの「この項目の操作」(下からのシート)。 */
  onOpenActions?: (id: string) => void;
  /** PCの「項目の詳細」(行のそばの小窓)。 */
  onOpenDetails: (id: string, anchor: HTMLElement) => void;
  onToggleCompleted?: (id: string) => Promise<void>;
  onUpdate: (id: string, patch: EntryUpdate) => Promise<unknown>;
  /** 書き口(置き場所)。いる欄では運ばれてきた書き口が、いない欄では入口が入る。 */
  deskNode?: ReactNode;
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

const isMobileViewport = () => window.matchMedia("(max-width: 920px)").matches;

/** 親子構造はDBの parent_id / sort_order に保存し、このコンポーネントには一時的な開閉・選択・次の一行の位置だけを置く。 */
export const OutlineList = forwardRef<OutlineHandle, OutlineListProps>(function OutlineList({
  entries,
  disabled = false,
  dense,
  onRelocate,
  onOpenActions,
  onOpenDetails,
  onToggleCompleted,
  onUpdate,
  deskNode,
  ghostOn = false,
  onCaretDescribed,
  onRowSelected,
  onFocusDesk,
}, ref) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [, setCaretState] = useState<Caret | null>(null);
  // 続けて置くとき、描き直しを待たずに最新の位置を読めるよう、同じ値を持っておく。
  const caretRef = useRef<Caret | null>(null);
  const setCaret = (next: Caret | null) => { caretRef.current = next; setCaretState(next); };
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [zoomId, setZoomId] = useState<string | null>(null);
  const [moved, setMoved] = useState<MoveHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);
  const skipBlurRef = useRef(false);
  const movedTimerRef = useRef<number | null>(null);
  const lastInsertRef = useRef<Caret | null>(null);
  const lastAdvanceRef = useRef(0);
  /** 置いたばかりで、一覧にはまだ描かれていない行の位置(Tabが続けて来ても親にできるように)。 */
  const recentRef = useRef(new Map<string, { parentId: string | null; index: number; at: number }>());
  const nodeById = useMemo(() => new Map(entries.map((row) => [row.id, row])), [entries]);
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
    return parent ? `「${parent.content}」の下、${level}段目に入ります` : `いちばん上の階層、${level}段目に入ります`;
  })();
  useEffect(() => { onCaretDescribed?.(caretDescription); }, [caretDescription]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editingId) editorRef.current?.focus(); }, [editingId]);
  // 消えた行を選んだままにしない。
  useEffect(() => {
    if (selectedId && !nodeById.has(selectedId)) setSelectedId(null);
    if (editingId && !nodeById.has(editingId)) setEditingId(null);
  }, [editingId, nodeById, selectedId]);
  useEffect(() => () => { if (movedTimerRef.current !== null) window.clearTimeout(movedTimerRef.current); }, []);

  const focusRow = (id: string) => window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
  });
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
    if (!content.trim()) { setMessage("空の項目は保存できません。Escで編集を取り消せます。"); return false; }
    try { await onUpdate(id, { content: content.trim() }); setEditingId(null); return true; }
    catch (error) { showError(error); return false; }
  };
  const commitEditing = async () => {
    if (!editingId || savingRef.current) return false;
    savingRef.current = true;
    try { return await updateText(editingId, editingValue); }
    finally { savingRef.current = false; }
  };
  const moveTo = async (id: string, parentId: string | null, index: number, record = true) => {
    if (busy || disabled) return;
    const previous = locationOf(id);
    if (!previous || previous.index < 0) return;
    setBusy(true);
    try {
      await onRelocate(id, parentId, index);
      setSelectedId(id); setMessage("");
      if (movedTimerRef.current !== null) window.clearTimeout(movedTimerRef.current);
      if (record) {
        // 動かした直後の知らせ。「戻す」で元の位置へ。
        setMoved(previous);
        movedTimerRef.current = window.setTimeout(() => setMoved(null), 5_500);
      } else {
        setMoved(null);
      }
    } catch (error) { showError(error); }
    finally { setBusy(false); }
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
  const startEdit = (row: EntryTreeNode) => { if (disabled) return; setSelectedId(row.id); setEditingValue(row.content); setEditingId(row.id); };
  const toggleCollapsed = (id: string) => setCollapsed((previous) => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const zoomTo = (id: string | null) => { setZoomId(id); setCaret(null); setSelectedId(null); };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: EntryTreeNode) => {
    if (disabled || busy || event.nativeEvent.isComposing) return;
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
      else if (event.key === "ArrowDown") { setCaret(caretAfterRow(row)); onFocusDesk(); }
    }
  };
  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, row: EntryTreeNode) => {
    if (event.nativeEvent.isComposing || event.key === "Process" || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault(); skipBlurRef.current = true; setEditingId(null); setEditingValue(row.content); setSelectedId(row.id); focusRow(row.id); return;
    }
    if (event.key === "Tab") {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) { move(row, event.shiftKey ? "outdent" : "indent"); focusRow(row.id); } }); return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      // 直したら、次の一行へ。続けて次の行を書ける。保存を待たずにフォーカスを移し、続く打鍵を取りこぼさない。
      event.preventDefault();
      if (!editingValue.trim()) { setMessage("空の項目は保存できません。Escで編集を取り消せます。"); return; }
      setCaret(caretAfterRow(row));
      onFocusDesk();
      void commitEditing();
      return;
    }
    if (event.ctrlKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) move(row, event.key === "ArrowUp" ? "up" : "down"); });
    }
  };

  const caretNode = deskNode || ghostOn ? (
    <div
      key="outline-caret"
      role="none"
      data-outline-caret=""
      className={`outline__caret ${spot.end ? "outline__caret--end" : ""}`}
      style={{ "--outline-depth": spot.depth } as CSSProperties}
    >
      {deskNode ? (
        <>
          <span className="outline__caret-plus" aria-hidden="true">＋</span>
          <div className="outline__caret-host">{deskNode}</div>
        </>
      ) : null}
      {ghostOn ? <p className="outline__ghost">↳ ここに入ります</p> : null}
    </div>
  ) : null;

  const rowElement = (row: EntryTreeNode) => {
    const isSelected = selectedId === row.id;
    return <div key={row.id} className="outline__item-wrap">
      <div
        data-outline-id={row.id}
        data-outline-parent-id={row.parent_id ?? ""}
        data-outline-sort-order={row.sort_order}
        data-entry-id={row.id}
        className={`outline__item ${isSelected ? "outline__item--selected" : ""} ${row.is_completed ? "outline__item--completed" : ""}`}
        role="treeitem"
        aria-level={zoom ? row.depth - zoom.depth : row.depth + 1}
        aria-selected={isSelected}
        aria-expanded={row.has_children ? !collapsed.has(row.id) : undefined}
        tabIndex={isSelected || (selectedId === null && visible[0]?.id === row.id) ? 0 : -1}
        onFocus={() => setSelectedId(row.id)}
        onKeyDown={(event) => { if (event.target === event.currentTarget) onRowKeyDown(event, row); }}
        style={{ "--outline-depth": rowDepth(row) } as CSSProperties}
      >
        {row.has_children ? <button className="outline__twisty" type="button" tabIndex={-1}
          aria-label={collapsed.has(row.id) ? "子を展開" : "子を折りたたむ"}
          onClick={() => toggleCollapsed(row.id)}>{collapsed.has(row.id) ? "▸" : "▾"}</button>
        : <span className="outline__twisty outline__twisty--empty" aria-hidden="true">·</span>}
        {editingId === row.id ? <textarea ref={editorRef} className="outline__edit" rows={1} value={editingValue}
          aria-label="アウトラインの本文を編集" onChange={(event) => setEditingValue(event.target.value)}
          onKeyDown={(event) => onEditorKeyDown(event, row)}
          onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } void commitEditing(); }}/>
        : <span className="outline__content"
            onClick={(event) => {
              // スマホは、選んだ行をもう一度押すとその場で直す。PCは選んでフォーカスする。
              if (isMobileViewport() && isSelected) { startEdit(row); return; }
              selectRow(row);
              if (!isMobileViewport()) event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus();
            }}
            onDoubleClick={() => startEdit(row)} title="ダブルクリックで編集 / Enterで編集">{row.content}</span>}
        <span className="outline__marks">
          {row.has_children && collapsed.has(row.id) ? <span className="outline__child-count">{row.child_count}</span> : null}
          {row.link_url.trim() ? <a className="outline__mark outline__mark--link" href={row.link_url} target="_blank" rel="noreferrer" aria-label="リンクを開く" title={row.link_url}>↗</a> : null}
          {row.note.trim() ? <span className="outline__mark outline__mark--note" title={row.note} aria-label="気持ち・備考あり">✎</span> : null}
          {row.tag ? <span className="outline__chip">#{row.tag}</span> : null}
        </span>
        <div className="outline__actions">
          <button type="button" className="outline__zoom-action" title="この枝に集中" aria-label="この枝に集中" onClick={() => zoomTo(row.id)}>⌕</button>
          <button type="button" className="outline__details-action" title="詳細と操作" aria-label="項目の詳細" onClick={(event) => onOpenDetails(row.id, event.currentTarget)}>⋯</button>
          {onOpenActions ? <button type="button" className="outline__mobile-actions" aria-label="この項目の操作" onClick={() => onOpenActions(row.id)}>⋯</button> : null}
        </div>
      </div>
    </div>;
  };

  const rows: ReactNode[] = [];
  visible.forEach((row, index) => {
    if (caretNode && spot.at === index) rows.push(caretNode);
    rows.push(rowElement(row));
  });
  if (caretNode && spot.at >= visible.length) rows.push(caretNode);

  return <div className={`outline ${dense ? "outline--dense" : "outline--normal"}`} aria-label="アウトライン編集">
    {zoom ? <nav className="outline__breadcrumbs" aria-label="アウトラインのズーム位置">
      <button type="button" onClick={() => zoomTo(null)}>全体</button>
      {breadcrumbs.map((item) => <span key={item.id}> › <button type="button" onClick={() => zoomTo(item.id)}>{item.content}</button></span>)}
    </nav> : null}
    <div className="outline__tree" role="tree" aria-label="アウトラインの項目">
      {rows}
      {visible.length === 0 && !deskNode ? <p className="outline__empty">一行書いて Enter。Tab で字下げ、Shift+Enter で段落へ。</p> : null}
    </div>
    {message ? <p className="outline__message" role="status">{message} <button type="button" onClick={() => setMessage("")}>閉じる</button></p> : null}
    {moved ? <UndoToast
      kind="sentence"
      message="動かしました"
      actionLabel="戻す"
      actionAriaLabel="直前の移動を戻す"
      dismissAriaLabel="動かした通知を閉じる"
      isUndoing={busy}
      onUndo={() => { const previous = moved; setMoved(null); void moveTo(previous.id, previous.parentId, previous.index, false); focusRow(previous.id); }}
      onDismiss={() => setMoved(null)}
    /> : null}
  </div>;
});
