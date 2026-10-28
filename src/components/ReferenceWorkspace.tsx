import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { copyToClipboard } from "../lib/clipboard";
import { getOpenableLinkUrl, getReferenceUrlKey, normalizeLinkUrlForSave, type EntryTreeNode } from "../types/memo";
import { listReferenceProgress, patchReferenceProgress, type ReferenceProgress } from "../repositories/referenceProgressRepository";
import "../styles-reference-workspace.css";

type Filter = "all" | "unreviewed" | "reviewed" | "starred";
type Session = { ids: string[]; position: number };
type ImportResult = { urls: string[]; duplicates: number; invalid: { line: number; text: string }[] };

type Props = {
  memoId: string;
  entries: EntryTreeNode[];
  deskNode?: ReactNode;
  renderEntry: (entry: EntryTreeNode) => ReactNode;
  onAdd: (url: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<{ entry_ids: string[] }>;
  onRestore: (entryIds: string[]) => Promise<void>;
  disabled?: boolean;
};

const stamp = () => new Date().toISOString();
const sessionKey = (memoId: string) => `kakidas.reference-session.v1.${memoId}`;

function readSession(memoId: string): Session | null {
  try {
    const raw = JSON.parse(localStorage.getItem(sessionKey(memoId)) || "null") as Session | null;
    if (!raw || !Array.isArray(raw.ids) || !Number.isInteger(raw.position)) return null;
    return { ids: raw.ids.filter((id): id is string => typeof id === "string"), position: Math.max(0, raw.position) };
  } catch { return null; }
}

function parseImport(text: string, existing: Set<string>): ImportResult {
  const urls: string[] = [];
  const invalid: ImportResult["invalid"] = [];
  const seen = new Set(existing);
  let duplicates = 0;
  text.split(/\r?\n/u).forEach((line, index) => {
    const source = line.trim();
    if (!source) return;
    try {
      const normalized = normalizeLinkUrlForSave(source);
      const parsed = new URL(normalized);
      if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") throw new Error("hostname");
      const key = getReferenceUrlKey(normalized);
      if (!key) throw new Error("url");
      if (seen.has(key)) { duplicates += 1; return; }
      seen.add(key);
      urls.push(normalized);
    } catch { invalid.push({ line: index + 1, text: source }); }
  });
  return { urls, invalid, duplicates };
}

/**
 * KakidasのURL欄だけを専用ワークスペースにする。
 * 既存のEntryItemを再利用し、編集・備考・タグ・アウトラインとの結び目を保持する。
 */
export function ReferenceWorkspace({ memoId, entries, deskNode, renderEntry, onAdd, onDelete, onRestore, disabled = false }: Props) {
  const [progress, setProgress] = useState<Record<string, ReferenceProgress>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCount, setBulkCount] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [session, setSession] = useState<Session | null>(() => readSession(memoId));
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const openFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    const reload = async () => {
      try {
        const rows = await listReferenceProgress(memoId);
        if (active) setProgress(Object.fromEntries(rows.map(row => [row.entry_id, row])));
      } catch {
        if (active) setNotice("閲覧状態を読み込めませんでした。再読み込みしてください。");
      } finally { if (active) setIsLoading(false); }
    };
    void reload();
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === memoId) void reload();
    };
    window.addEventListener("kakidas:reference-progress", changed);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("kakidas-reference-progress");
      channel.onmessage = event => { if (event.data === memoId) void reload(); };
    } catch { /* BroadcastChannel未対応でも同一画面内は再描画される */ }
    return () => {
      active = false;
      window.removeEventListener("kakidas:reference-progress", changed);
      channel?.close();
    };
  }, [memoId]);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(sessionKey(memoId), JSON.stringify(session));
      else localStorage.removeItem(sessionKey(memoId));
    } catch { /* ブラウザがセッション保存を拒否しても読み進められる */ }
  }, [memoId, session]);

  useEffect(() => {
    if (!focusMode) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFocusMode(false); openFocusRef.current?.focus(); }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [focusMode]);

  const actualEntries = useMemo(() => entries.filter(entry => Boolean(getOpenableLinkUrl(entry.link_url))), [entries]);
  const byId = useMemo(() => new Map(actualEntries.map(entry => [entry.id, entry])), [actualEntries]);
  const existingKeys = useMemo(
    () => new Set(actualEntries.map(entry => getReferenceUrlKey(entry.link_url)).filter(Boolean)),
    [actualEntries],
  );
  const importResult = useMemo(() => parseImport(bulkText, existingKeys), [bulkText, existingKeys]);
  const unreviewed = actualEntries.filter(entry => !progress[entry.id]?.reviewed_at).length;
  const starred = actualEntries.filter(entry => Boolean(progress[entry.id]?.starred_at)).length;

  const visible = useMemo(() => actualEntries.filter(entry => {
    const p = progress[entry.id];
    if (filter === "unreviewed" && p?.reviewed_at) return false;
    if (filter === "reviewed" && !p?.reviewed_at) return false;
    if (filter === "starred" && !p?.starred_at) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || [entry.content, entry.link_url, entry.note, entry.tag || ""].some(value => value.toLocaleLowerCase().includes(needle));
  }), [actualEntries, filter, progress, query]);

  const selectedEntries = actualEntries.filter(entry => selected.has(entry.id));
  const currentId = session?.ids[session.position] ?? null;
  const currentEntry = currentId ? byId.get(currentId) : undefined;
  const sessionCount = session?.ids.length ?? 0;

  async function updateProgress(entryId: string, patch: Partial<Pick<ReferenceProgress, "opened_at" | "reviewed_at" | "starred_at">>) {
    if (disabled || isLoading) return;
    setProgress(previous => ({
      ...previous,
      [entryId]: {
        entry_id: entryId,
        memo_id: memoId,
        opened_at: previous[entryId]?.opened_at ?? null,
        reviewed_at: previous[entryId]?.reviewed_at ?? null,
        starred_at: previous[entryId]?.starred_at ?? null,
        ...patch,
      },
    }));
    try { await patchReferenceProgress(memoId, entryId, patch); }
    catch {
      setNotice("閲覧状態を保存できませんでした。");
      const rows = await listReferenceProgress(memoId).catch(() => []);
      setProgress(Object.fromEntries(rows.map(row => [row.entry_id, row])));
    }
  }

  const opened = (entryId: string) => {
    if (!progress[entryId]?.opened_at) void updateProgress(entryId, { opened_at: stamp() });
  };

  function onLinkClick(event: MouseEvent<HTMLDivElement>, entryId: string) {
    const target = event.target;
    if (target instanceof Element && target.closest("a.entry-item__reference-link")) opened(entryId);
  }

  function beginSession(ids: string[]) {
    const usable = [...new Set(ids)].filter(id => byId.has(id));
    if (!usable.length) { setNotice("閲覧するURLがありません。"); return; }
    setSession({ ids: usable, position: 0 });
    setSelecting(false);
    setSelected(new Set());
    setNotice(`${usable.length}件の調査セッションを開始しました。`);
  }

  function advanceSession() {
    if (!session) return;
    const next = session.position + 1;
    if (next >= session.ids.length) {
      setSession(null);
      setNotice("調査セッションの末尾まで進みました。");
    } else setSession({ ...session, position: next });
  }

  async function copyUrls(rows: EntryTreeNode[]) {
    if (!rows.length) return;
    try {
      await copyToClipboard(rows.map(row => row.link_url).join("\n"));
      setNotice(`${rows.length}件のURLをコピーしました。リサーチブラウザにも一括貼り付けできます。`);
    } catch { setNotice("コピーに失敗しました。"); }
  }

  async function addBulk() {
    if (bulkBusy || disabled || !importResult.urls.length) return;
    const requested = importResult.urls;
    let count = 0;
    setBulkBusy(true);
    setBulkCount(0);
    try {
      for (const url of requested) {
        await onAdd(url);
        count++;
        setBulkCount(count);
      }
      setBulkText("");
      setBulkOpen(false);
      setNotice(`${count}件を追加しました。`);
    } catch {
      setBulkText(requested.slice(count).join("\n"));
      setNotice(`${count}件追加しました。残り${requested.length - count}件は入力欄に残しました。`);
    } finally { setBulkBusy(false); }
  }

  async function deleteSelected() {
    if (!selectedEntries.length || busy || disabled) return;
    if (!window.confirm(`${selectedEntries.length}件の参考URLを削除しますか？\n削除後は元に戻せます。`)) return;
    setBusy(true);
    const removed: string[] = [];
    try {
      for (const entry of selectedEntries) {
        const result = await onDelete(entry.id);
        removed.push(...result.entry_ids);
      }
      setUndoIds([...new Set(removed)]);
      setNotice(`${selectedEntries.length}件を削除しました。`);
      setSelecting(false);
      setSelected(new Set());
    } catch {
      if (removed.length) {
        try { await onRestore(removed); }
        catch { setUndoIds([...new Set(removed)]); }
      }
      setNotice("削除に失敗しました。復元できなかった場合は「元に戻す」を押してください。");
    } finally { setBusy(false); }
  }

  async function undoDelete() {
    if (!undoIds.length || busy) return;
    setBusy(true);
    try {
      await onRestore(undoIds);
      setUndoIds([]);
      setNotice("参考URLを元に戻しました。");
    } catch { setNotice("復元できませんでした。もう一度お試しください。"); }
    finally { setBusy(false); }
  }

  function toggleSelect(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectVisible() {
    const all = visible.length > 0 && visible.every(entry => selected.has(entry.id));
    setSelected(current => {
      const next = new Set(current);
      visible.forEach(entry => { if (all) next.delete(entry.id); else next.add(entry.id); });
      return next;
    });
  }

  const content = (
    <section className={`reference-workspace${focusMode ? " reference-workspace--focused" : ""}`} aria-label="調査ワークスペース">
      <div className="reference-workspace__head">
        <div>
          <strong>調査ワークスペース</strong>
          <span className="reference-workspace__subtitle">URLを集め、読み、残す</span>
        </div>
        <button type="button" ref={openFocusRef} onClick={() => setFocusMode(!focusMode)} aria-label={focusMode ? "通常表示に戻す" : "調査を大きく表示"}>
          {focusMode ? "閉じる" : "広く表示"}
        </button>
      </div>
      {!focusMode && <div className="reference-workspace__desk">{deskNode}</div>}
      <div className="reference-workspace__numbers" aria-label="URLの進捗">
        <span>全 <b>{actualEntries.length}</b></span>
        <span>未確認 <b>{unreviewed}</b></span>
        <span>★ <b>{starred}</b></span>
      </div>
      <div className="reference-workspace__primary-actions">
        <button type="button" onClick={() => setBulkOpen(!bulkOpen)} aria-expanded={bulkOpen} disabled={disabled || busy}>{bulkOpen ? "追加を閉じる" : "＋ まとめて追加"}</button>
        <button type="button" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }} disabled={disabled || busy}>{selecting ? "選択終了" : "選択"}</button>
        <button type="button" onClick={() => beginSession(actualEntries.filter(entry => !progress[entry.id]?.reviewed_at).map(entry => entry.id))} disabled={unreviewed === 0 || busy}>未確認を読む</button>
      </div>

      {bulkOpen && (
        <div className="reference-workspace__import">
          <label htmlFor="reference-bulk-text">URLを1行ずつ貼り付け</label>
          <textarea id="reference-bulk-text" value={bulkText} onChange={e => setBulkText(e.target.value)}
            placeholder={"https://example.com/article\nhttps://example.org/report"} spellCheck={false} autoCapitalize="off" rows={5} disabled={bulkBusy} />
          <p aria-live="polite">新規 <b>{importResult.urls.length}</b>件 · 重複 {importResult.duplicates}件 · 無効 {importResult.invalid.length}件</p>
          {importResult.invalid.length > 0 && <p className="reference-workspace__invalid">無効行：{importResult.invalid.slice(0, 4).map(item => `${item.line}行目 ${item.text}`).join(" / ")}</p>}
          <button type="button" onClick={() => void addBulk()} disabled={!importResult.urls.length || bulkBusy || disabled}>
            {bulkBusy ? `追加中 ${bulkCount}/${importResult.urls.length}` : `${importResult.urls.length}件を追加`}
          </button>
        </div>
      )}

      {session && (
        <div className="reference-workspace__session" aria-label="調査セッション">
          <div className="reference-workspace__session-title">
            <strong>連続閲覧 {Math.min(session.position + 1, sessionCount)} / {sessionCount}</strong>
            <button type="button" onClick={() => setSession(null)}>終了</button>
          </div>
          {currentEntry ? (
            <>
              <p>{currentEntry.content}</p>
              <div className="reference-workspace__session-actions">
                <a href={currentEntry.link_url} target="_blank" rel="noopener noreferrer" onClick={() => opened(currentEntry.id)}>このURLを開く ↗</a>
                <button type="button" onClick={() => void updateProgress(currentEntry.id, { reviewed_at: progress[currentEntry.id]?.reviewed_at ? null : stamp() })}>
                  {progress[currentEntry.id]?.reviewed_at ? "確認を戻す" : "✓ 見た"}
                </button>
                <button type="button" onClick={() => void updateProgress(currentEntry.id, { starred_at: progress[currentEntry.id]?.starred_at ? null : stamp() })}>
                  {progress[currentEntry.id]?.starred_at ? "★" : "☆"}
                </button>
                <button type="button" onClick={advanceSession}>次へ ›</button>
              </div>
            </>
          ) : <button type="button" onClick={advanceSession}>削除されたURLを飛ばして次へ</button>}
        </div>
      )}

      <div className="reference-workspace__filters">
        <label className="reference-workspace__search">
          <span className="sr-only">URL・タイトル・備考を検索</span>
          <input type="search" placeholder="URL・タイトル・備考を検索" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <div className="reference-workspace__chips" role="group" aria-label="表示するURL">
          {([
            ["all", "すべて"],
            ["unreviewed", "未確認"],
            ["reviewed", "見た"],
            ["starred", "★ 注目"],
          ] as const).map(([id, label]) => (
            <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setSelected(new Set()); }}>{label}</button>
          ))}
        </div>
      </div>

      {selecting && (
        <div className="reference-workspace__selection-summary">
          <span>{selectedEntries.length}件選択中</span>
          <button type="button" onClick={toggleSelectVisible}>{visible.length && visible.every(entry => selected.has(entry.id)) ? "表示中の選択を解除" : `表示中${visible.length}件を選択`}</button>
        </div>
      )}
      <div className="reference-workspace__list" aria-busy={isLoading}>
        {visible.length ? visible.map(entry => {
          const p = progress[entry.id];
          const status = p?.reviewed_at ? "✓ 見た" : p?.opened_at ? "◉ 開いた" : "○ 未閲覧";
          return (
            <div key={entry.id} className={`reference-workspace__item${p?.reviewed_at ? " reference-workspace__item--reviewed" : ""}`}>
              {selecting && (
                <label className="reference-workspace__checkbox">
                  <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)} aria-label={`${entry.content}を選択`} />
                </label>
              )}
              <div className="reference-workspace__item-body" onClickCapture={e => onLinkClick(e, entry.id)}>
                {renderEntry(entry)}
                <div className="reference-workspace__row-actions">
                  <span className="reference-workspace__status">{isLoading ? "読込中" : status}</span>
                  <button type="button" onClick={() => void updateProgress(entry.id, { reviewed_at: p?.reviewed_at ? null : stamp() })} disabled={disabled || isLoading} aria-label={p?.reviewed_at ? "未確認に戻す" : "見たと記録"}>
                    {p?.reviewed_at ? "↺ 戻す" : "✓ 見た"}
                  </button>
                  <button type="button" onClick={() => void updateProgress(entry.id, { starred_at: p?.starred_at ? null : stamp() })} disabled={disabled || isLoading} aria-label={p?.starred_at ? "注目を解除" : "注目を付ける"} aria-pressed={Boolean(p?.starred_at)}>{p?.starred_at ? "★" : "☆"}</button>
                </div>
              </div>
            </div>
          );
        }) : <p className="reference-workspace__empty">{actualEntries.length ? "条件に合うURLはありません。" : "URLを貼り付けると、ここに一覧表示されます。"}</p>}
      </div>

      {selecting && (
        <div className="reference-workspace__bottom-bar" role="toolbar" aria-label="選択したURLの一括操作">
          <strong>{selectedEntries.length}件</strong>
          <button type="button" onClick={() => beginSession(selectedEntries.map(entry => entry.id))} disabled={!selectedEntries.length}>順に読む</button>
          <button type="button" onClick={() => void copyUrls(selectedEntries)} disabled={!selectedEntries.length}>URLコピー</button>
          <button type="button" className="reference-workspace__danger" onClick={() => void deleteSelected()} disabled={!selectedEntries.length || busy || disabled}>削除</button>
        </div>
      )}
      {undoIds.length > 0 && (
        <div className="reference-workspace__undo" role="status">
          <span>削除したURLを復元できます</span>
          <button type="button" onClick={() => void undoDelete()} disabled={busy}>元に戻す</button>
        </div>
      )}
      {notice && <div className="reference-workspace__notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="通知を閉じる">×</button></div>}
      {session && <div className="reference-workspace__handoff"><button type="button" onClick={() => void copyUrls(session.ids.map(id => byId.get(id)).filter((entry): entry is EntryTreeNode => Boolean(entry)))}>このセッションのURLをコピー（リサーチブラウザ用）</button></div>}
    </section>
  );
  return focusMode ? createPortal(content, document.body) : content;
}
