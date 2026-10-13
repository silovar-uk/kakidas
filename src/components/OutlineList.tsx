import { type CSSProperties, type ReactNode, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { EntryRow, EntryTreeNode, EntryUpdate } from "../types/memo";

type OutlineListProps = {
  entries: EntryTreeNode[];
  disabled?: boolean;
  onCreate: (content: string, parentId: string | null, index: number) => Promise<EntryRow>;
  onRelocate: (id: string, parentId: string | null, index: number) => Promise<void>;
  onUpdate: (id: string, patch: EntryUpdate) => Promise<unknown>;
  onGrow: (entry: EntryTreeNode) => Promise<unknown>;
  renderDetails: (entry: EntryTreeNode) => ReactNode;
};

type MoveHistory = { id: string; parentId: string | null; index: number };
const DENSITY_KEY = "kakidas.outline-density.v1";

/** 親子構造はDBの parent_id / sort_order に保存し、このコンポーネントには一時的な開閉・選択だけを置く。 */
export function OutlineList({ entries, disabled = false, onCreate, onRelocate, onUpdate, onGrow, renderDetails }: OutlineListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [draft, setDraft] = useState<{ afterId: string | null; parentId: string | null; value: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Set<string>>(() => new Set());
  const [zoomId, setZoomId] = useState<string | null>(null);
  const [dense, setDense] = useState(() => {
    try { return localStorage.getItem(DENSITY_KEY) !== "normal"; } catch { return true; }
  });
  const [history, setHistory] = useState<MoveHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);
  const skipBlurRef = useRef(false);
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
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const zoom = zoomId ? nodeById.get(zoomId) ?? null : null;
  const breadcrumbs: EntryTreeNode[] = [];
  if (zoom) {
    let current: EntryTreeNode | undefined = zoom;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      breadcrumbs.unshift(current); seen.add(current.id);
      current = current.parent_id ? nodeById.get(current.parent_id) : undefined;
    }
  }

  useEffect(() => { if (editingId) editorRef.current?.focus(); }, [editingId]);
  useEffect(() => { if (draft) draftRef.current?.focus(); }, [draft?.afterId, draft?.parentId]);
  useEffect(() => {
    if (!selectedId || editingId) return;
    document.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(selectedId)}"]`)?.focus({ preventScroll: true });
  }, [selectedId, editingId, visible]);
  useEffect(() => {
    try { localStorage.setItem(DENSITY_KEY, dense ? "dense" : "normal"); } catch { /* 端末設定が保存できなくても操作可能 */ }
  }, [dense]);

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
  const commitDraft = async () => {
    if (!draft || savingRef.current || !draft.value.trim()) return;
    savingRef.current = true;
    try {
      const siblings = childrenOf(draft.parentId);
      const index = draft.afterId ? Math.max(0, siblings.findIndex((entry) => entry.id === draft.afterId) + 1) : siblings.length;
      const row = await onCreate(draft.value.trim(), draft.parentId, index);
      setDraft(null); setSelectedId(row.id); setMessage("");
    } catch (error) { showError(error); }
    finally { savingRef.current = false; }
  };
  const moveTo = async (id: string, parentId: string | null, index: number, record = true) => {
    if (busy || disabled) return;
    const previous = locationOf(id);
    if (!previous || previous.index < 0) return;
    setBusy(true);
    try {
      await onRelocate(id, parentId, index);
      setHistory(record ? previous : null);
      setSelectedId(id); setMessage("");
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
    } else if (action === "outdent" && row.parent_id) {
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
  const toggleDetails = (id: string) => setDetails((previous) => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const draftAfter = (row: EntryTreeNode | null) => {
    setDraft({ afterId: row?.id ?? null, parentId: row?.parent_id ?? zoomId, value: "" });
    setEditingId(null);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: EntryTreeNode) => {
    if (disabled || busy || event.nativeEvent.isComposing) return;
    if (event.ctrlKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault(); move(row, event.key === "ArrowUp" ? "up" : "down"); return;
    }
    if (event.key === "Enter") { event.preventDefault(); startEdit(row); return; }
    if (event.key === "Tab") { event.preventDefault(); move(row, event.shiftKey ? "outdent" : "indent"); return; }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.has_children && !collapsed.has(row.id)) toggleCollapsed(row.id);
      else if (row.parent_id) setSelectedId(row.parent_id);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.has_children && collapsed.has(row.id)) toggleCollapsed(row.id);
      else if (row.has_children) setSelectedId(childrenOf(row.id)[0]?.id ?? row.id);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const idx = visible.findIndex((item) => item.id === row.id);
      setSelectedId(visible[Math.max(0, Math.min(visible.length - 1, idx + (event.key === "ArrowUp" ? -1 : 1)))]?.id ?? row.id);
    }
  };
  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, row: EntryTreeNode) => {
    if (event.nativeEvent.isComposing || event.key === "Process" || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault(); skipBlurRef.current = true; setEditingId(null); setEditingValue(row.content); setSelectedId(row.id); return;
    }
    if (event.key === "Tab") {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) move(row, event.shiftKey ? "outdent" : "indent"); }); return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) draftAfter(row); }); return;
    }
    if (event.ctrlKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault(); void commitEditing().then((ok) => { if (ok) move(row, event.key === "ArrowUp" ? "up" : "down"); });
    }
  };

  return <div className={`outline ${dense ? "outline--dense" : "outline--normal"}`} aria-label="アウトライン編集">
    <div className="outline__toolbar">
      <span className="outline__hint">Enter 編集 · Tab 階層 · Ctrl+Shift+↑↓ 移動</span>
      <button type="button" onClick={() => setDense((current) => !current)} aria-pressed={dense} title="表示密度を切り替える">{dense ? "標準に戻す" : "高密度"}</button>
    </div>
    {zoom ? <nav className="outline__breadcrumbs" aria-label="アウトラインのズーム位置">
      <button type="button" onClick={() => setZoomId(null)}>全体</button>
      {breadcrumbs.map((item) => <span key={item.id}> › <button type="button" onClick={() => setZoomId(item.id)}>{item.content}</button></span>)}
    </nav> : null}
    <div className="outline__tree" role="tree" aria-label="アウトラインの項目">
      {visible.map((row) => <div key={row.id} className="outline__item-wrap">
        <div
          data-outline-id={row.id}
          data-entry-id={row.id}
          className={`outline__item ${selectedId === row.id ? "outline__item--selected" : ""}`}
          role="treeitem"
          aria-level={zoom ? row.depth - zoom.depth : row.depth + 1}
          aria-selected={selectedId === row.id}
          aria-expanded={row.has_children ? !collapsed.has(row.id) : undefined}
          tabIndex={selectedId === row.id || (selectedId === null && visible[0]?.id === row.id) ? 0 : -1}
          onFocus={() => setSelectedId(row.id)}
          onKeyDown={(event) => { if (event.target === event.currentTarget) onRowKeyDown(event, row); }}
          style={{ "--outline-depth": zoom ? Math.max(0, row.depth - zoom.depth - 1) : row.depth } as CSSProperties}
        >
          <button className="outline__twisty" type="button" tabIndex={-1} disabled={!row.has_children}
            aria-label={row.has_children ? collapsed.has(row.id) ? "子を展開" : "子を折りたたむ" : "子なし"}
            onClick={() => toggleCollapsed(row.id)}>{row.has_children ? collapsed.has(row.id) ? "▸" : "▾" : "·"}</button>
          {editingId === row.id ? <textarea ref={editorRef} className="outline__edit" rows={1} value={editingValue}
            aria-label="アウトラインの本文を編集" onChange={(event) => setEditingValue(event.target.value)}
            onKeyDown={(event) => onEditorKeyDown(event, row)}
            onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } void commitEditing(); }}/>
          : <button type="button" className="outline__content" onClick={() => setSelectedId(row.id)} onKeyDown={(event) => onRowKeyDown(event as unknown as KeyboardEvent<HTMLDivElement>, row)}
              onDoubleClick={() => startEdit(row)} title="ダブルクリックで編集 / Enterで編集">{row.content}</button>}
          {row.has_children && collapsed.has(row.id) ? <span className="outline__child-count">{row.child_count}</span> : null}
          <div className="outline__actions">
            <button type="button" title="この枝に集中" aria-label="この枝に集中" onClick={() => setZoomId(row.id)}>⌕</button>
            <button type="button" title="階層・メモ・タグの詳細" aria-label="項目の詳細" aria-expanded={details.has(row.id)} onClick={() => toggleDetails(row.id)}>⋯</button>
          </div>
        </div>
        {details.has(row.id) ? <div className="outline__details">
          <div className="outline__structure-actions">
            <button type="button" disabled={disabled || busy} onClick={() => move(row,"indent")}>↳ 下げる</button>
            <button type="button" disabled={disabled || busy} onClick={() => move(row,"outdent")}>↰ 上げる</button>
            <button type="button" disabled={disabled || busy} onClick={() => move(row,"up")}>↑ 移動</button>
            <button type="button" disabled={disabled || busy} onClick={() => move(row,"down")}>↓ 移動</button>
            <button type="button" disabled={disabled} onClick={() => void onGrow(row).catch(showError)}>段落に複製</button>
          </div>
          {renderDetails(row)}
        </div> : null}
        {draft?.afterId === row.id ? <div className="outline__new" style={{"--outline-depth":row.depth} as CSSProperties}>
          <span>＋</span><textarea rows={1} ref={draftRef} value={draft.value} placeholder="新しい項目" aria-label="新しいアウトライン項目" onChange={(event) => setDraft({ ...draft, value: event.target.value })}
          onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "Escape") {event.preventDefault(); setDraft(null);} else if (event.key === "Enter" && !event.shiftKey) {event.preventDefault(); void commitDraft();} }}/>
          <button type="button" disabled={!draft.value.trim() || busy} onClick={() => void commitDraft()}>追加</button>
        </div> : null}
      </div>)}
      {draft && !draft.afterId ? <div className="outline__new"><span>＋</span><textarea rows={1} ref={draftRef} value={draft.value} placeholder="新しい項目" aria-label="新しいアウトライン項目" onChange={(event) => setDraft({ ...draft, value: event.target.value })}
        onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "Escape") {event.preventDefault();setDraft(null);} else if (event.key === "Enter" && !event.shiftKey) {event.preventDefault();void commitDraft();} }}/>
        <button type="button" disabled={!draft.value.trim() || busy} onClick={() => void commitDraft()}>追加</button></div> : null}
      {visible.length === 0 && !draft ? <p className="outline__empty">項目がありません。まず一行書いてみよう。</p> : null}
    </div>
    <div className="outline__footer">
      <button type="button" disabled={disabled || busy || Boolean(draft)} onClick={() => draftAfter(selected ?? null)}>＋ 項目を追加</button>
      {history ? <button type="button" disabled={busy} onClick={() => void moveTo(history.id, history.parentId, history.index, false)}>直前の移動を戻す</button> : null}
    </div>
    {message ? <p className="outline__message" role="status">{message} <button type="button" onClick={() => setMessage("")}>閉じる</button></p> : null}
  </div>;
}
