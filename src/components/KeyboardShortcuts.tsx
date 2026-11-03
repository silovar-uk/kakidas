import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import { formatLocalClockTime, insertTimeIntoField, isTimeInsertField, matchesInsertTimeShortcut } from "../lib/timeShortcut.js";
import { memoRepository } from "../repositories/memoRepository";

type CommandId = "new-memo" | "outline" | "paragraph" | "reference" | "insert-time" | "numbering" | "fold-branch" | "fold-level" | "help";
type Command = { id: CommandId; label: string; detail: string; keys: string; keywords: string };

const COMMANDS: Command[] = [
  { id: "new-memo", label: "新しいメモを作成", detail: "新しいメモを開いて、タイトルから書く", keys: "Ctrl/⌘ + Alt/⌥ + N", keywords: "作成 追加 new memo" },
  { id: "outline", label: "アウトラインへ移動", detail: "書き口をアウトラインに移して入力を始める", keys: "Ctrl/⌘ + Shift + 1", keywords: "箇条書き リスト outline" },
  { id: "paragraph", label: "段落へ移動", detail: "書き口を段落に移して入力を始める", keys: "Ctrl/⌘ + Shift + 2", keywords: "文章 paragraph" },
  { id: "reference", label: "参考URLへ移動", detail: "書き口を参考URLに移して入力を始める", keys: "Ctrl/⌘ + Shift + 3", keywords: "リンク URL 調査 reference" },
  { id: "insert-time", label: "現在時刻を挿入", detail: "本文のカーソル位置へ現在時刻（例：16:49）を入力", keys: "Alt + ;", keywords: "時刻 時間 タイムスタンプ timestamp clock time" },
  { id: "numbering", label: "階層番号・ビュレットを切り替え", detail: "アウトラインの「1.1」と「•」を切り替える", keys: "Ctrl/⌘ + Shift + 4", keywords: "数字 見出し 番号 ナンバリング bullet numbered" },
  { id: "fold-branch", label: "選択した枝を開閉", detail: "番号・ビュレットのクリックと同じ。子階層を表示／非表示", keys: "Ctrl/⌘ + .", keywords: "折りたたみ 折り畳み 展開 開閉 collapse expand" },
  { id: "fold-level", label: "同じ階層の枝を一括開閉", detail: "選択行と同じ深さの親項目をまとめて開閉", keys: "Ctrl/⌘ + Shift + .", keywords: "階層ごと まとめて 一括 折りたたみ collapse all expand all" },
  { id: "help", label: "ショートカット一覧を見る", detail: "行の移動・完了・階層変更なども確認", keys: "Ctrl/⌘ + /", keywords: "ヘルプ help 操作 説明" },
];

export function KeyboardShortcuts() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isEditor = pathname.startsWith("/memos/");
  const [panel, setPanel] = useState<"commands" | "help" | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const creatingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  // コマンド検索を開く前の本文と選択位置を覚え、パレットからも正しい場所に挿入する。
  const timeTargetRef = useRef<{ field: HTMLTextAreaElement; start: number; end: number } | null>(null);

  const commands = useMemo(() => COMMANDS.filter(command =>
    isEditor || !["outline", "paragraph", "reference", "insert-time", "numbering", "fold-branch", "fold-level"].includes(command.id)
  ), [isEditor]);
  const matching = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? commands.filter(command => (command.label + " " + command.detail + " " + command.keywords).toLocaleLowerCase().includes(term))
      : commands;
  }, [commands, query]);
  const activeIndex = Math.min(selectedIndex, Math.max(0, matching.length - 1));

  const openCommands = () => {
    const focused = document.activeElement;
    timeTargetRef.current = isEditor && isTimeInsertField(focused)
      ? { field: focused, start: focused.selectionStart, end: focused.selectionEnd }
      : null;
    setQuery("");
    setSelectedIndex(0);
    setError("");
    setPanel("commands");
  };

  const runCommand = async (id: CommandId) => {
    if (id === "help") { setPanel("help"); return; }
    if (id === "insert-time") {
      const target = timeTargetRef.current;
      if (!isEditor || !target?.field.isConnected || !isTimeInsertField(target.field)) {
        setError("本文にカーソルを置き、Ctrl / ⌘ + K から選んでください。");
        return;
      }
      const time = formatLocalClockTime();
      setPanel(null);
      window.requestAnimationFrame(() => {
        if (!target.field.isConnected || !isTimeInsertField(target.field)) return;
        target.field.focus({ preventScroll: true });
        target.field.setSelectionRange(target.start, target.end);
        insertTimeIntoField(target.field, time);
      });
      return;
    }
    if (id === "new-memo") {
      if (creatingRef.current) return;
      creatingRef.current = true;
      setIsCreating(true);
      setError("");
      try {
        // 画面遷移前に編集中のタイトルなどを確定する。保存失敗なら作成も止める。
        const pendingSaves: Promise<unknown>[] = [];
        window.dispatchEvent(new CustomEvent("kakidas:before-create-memo", {
          detail: { waitUntil: (pending: Promise<unknown>) => pendingSaves.push(pending) },
        }));
        await Promise.all(pendingSaves);
        const memo = await memoRepository.createMemo();
        setPanel(null);
        navigate("/memos/" + memo.id, {
          state: { focusTitle: true, discardUntitledEmptyDraft: true },
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "メモを作成できませんでした。");
        setPanel("commands");
      } finally {
        creatingRef.current = false;
        setIsCreating(false);
      }
      return;
    }
    if (!isEditor) return;
    setPanel(null);
    if (id === "fold-branch" || id === "fold-level") {
      window.dispatchEvent(new Event(id === "fold-branch" ? "kakidas:outline-fold-branch" : "kakidas:outline-fold-level"));
    } else if (id === "numbering") {
      window.dispatchEvent(new Event("kakidas:toggle-outline-numbering"));
    } else {
      const kind = ({ outline: "sentence", paragraph: "paragraph", reference: "word" } as const)[id];
      window.dispatchEvent(new CustomEvent("kakidas:choose-entry-kind", { detail: kind }));
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process" || event.keyCode === 229 || event.getModifierState("AltGraph")) return;
      if (isEditor && !panel && matchesInsertTimeShortcut(event) && isTimeInsertField(event.target)) {
        const modal = document.querySelector('[aria-modal="true"]');
        if (modal && !modal.contains(event.target as Node)) return;
        event.preventDefault();
        insertTimeIntoField(event.target, formatLocalClockTime());
        return;
      }
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const isPaletteKey = commandKey && !event.altKey && !event.shiftKey && key === "k";
      const isHelpKey = commandKey && !event.altKey && !event.shiftKey && (event.code === "Slash" || event.key === "/");

      if (isPaletteKey) {
        if (document.querySelector('[aria-modal="true"]') && !panel) return;
        event.preventDefault();
        if (panel === "commands") setPanel(null);
        else openCommands();
        return;
      }
      if (isHelpKey) {
        if (document.querySelector('[aria-modal="true"]') && !panel) return;
        event.preventDefault();
        setPanel(previous => previous === "help" ? null : "help");
        return;
      }
      if (panel) {
        if (event.key === "Escape") { event.preventDefault(); setPanel(null); }
        return;
      }
      // 他のダイアログの入力操作やIME変換を横取りしない。
      if (document.querySelector('[aria-modal="true"]') || event.repeat) return;
      if (commandKey && event.altKey && !event.shiftKey && key === "n") {
        event.preventDefault();
        void runCommand("new-memo");
        return;
      }
      const digit = /^Digit[1-4]$/.test(event.code) ? event.code.slice(-1) : event.key;
      if (isEditor && commandKey && event.shiftKey && !event.altKey && ["1", "2", "3", "4"].includes(digit)) {
        event.preventDefault();
        void runCommand(({ "1": "outline", "2": "paragraph", "3": "reference", "4": "numbering" } as const)[digit as "1" | "2" | "3" | "4"]);
      }
    };
    const showHelp = () => setPanel("help");
    const showCommands = () => openCommands();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("kakidas:show-shortcuts", showHelp);
    window.addEventListener("kakidas:open-command-palette", showCommands);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("kakidas:show-shortcuts", showHelp);
      window.removeEventListener("kakidas:open-command-palette", showCommands);
    };
  });

  useEffect(() => {
    if (!panel) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockBodyScroll();
    const frame = window.requestAnimationFrame(() => {
      if (panel === "commands") searchRef.current?.focus({ preventScroll: true });
      else helpRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      unlock();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [panel]);

  const handleDialogKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter(el => el.getClientRects().length > 0);
    if (!elements.length) return;
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return panel ? (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) setPanel(null);
    }}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true"
        aria-labelledby="command-palette-title" onKeyDown={handleDialogKeys}>
        <header className="command-palette__header">
          <div>
            <span className="command-palette__eyebrow">KAKIDAS / COMMANDS</span>
            <h2 id="command-palette-title">{panel === "commands" ? "何をする？" : "キーボード操作"}</h2>
          </div>
          <button ref={helpRef} className="command-palette__close" type="button" onClick={() => setPanel(null)} aria-label="閉じる">Esc ×</button>
        </header>
        {panel === "commands" ? (
          <>
            <input ref={searchRef} type="search" aria-label="操作を検索"
              className="command-palette__search" placeholder="操作を検索（例：番号、新しいメモ）"
              value={query} onChange={event => { setQuery(event.target.value); setSelectedIndex(0); }}
              onKeyDown={event => {
                if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((activeIndex + 1) % Math.max(1, matching.length)); }
                if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((activeIndex + matching.length - 1) % Math.max(1, matching.length)); }
                if (event.key === "Enter" && matching[activeIndex] && !event.nativeEvent.isComposing) {
                  event.preventDefault(); void runCommand(matching[activeIndex].id);
                }
              }}/>
            <div className="command-palette__results" role="group" aria-label="実行できる操作">
              {matching.length ? matching.map((command, index) =>
                <button key={command.id} type="button"
                  disabled={isCreating} className={"command-palette__item" + (activeIndex === index ? " command-palette__item--active" : "")}
                  onMouseEnter={() => setSelectedIndex(index)} onClick={() => void runCommand(command.id)}>
                  <span><strong>{command.label}</strong><small>{command.detail}</small></span>
                  <kbd>{command.keys}</kbd>
                </button>
              ) : <p className="command-palette__empty">該当する操作がありません。別の言葉で検索してください。</p>}
            </div>
            {error && <p className="command-palette__error" role="alert">{error}</p>}
            <footer className="command-palette__footer">↑ ↓ 選ぶ <span>Enter 実行</span><span>Esc 閉じる</span></footer>
          </>
        ) : (
          <div className="command-palette__help">
            <p>まずは <strong>Ctrl/⌘ + K</strong> だけ覚えればOK。操作名を検索して実行できます。</p>
            {commands.filter(command => command.id !== "help").map(command =>
              <div className="command-palette__help-row" key={command.id}>
                <span>{command.label}</span><kbd>{command.keys}</kbd>
              </div>
            )}
            <p>アウトライン内：Enterで次の行、Tab / Shift+Tabで階層変更、F2で編集、Ctrl/⌘+Enterで完了、Alt+Shift+↑↓で並び替え。</p>
            <p>親項目の番号・•をクリックして子階層を開閉。Ctrl/⌘ + . で選択中の枝、Ctrl/⌘ + Shift + . で同じ深さの枝をまとめて開閉。開閉状態はメモごとに記憶します。</p>
            <p>編集中：Alt + ; でカーソル位置に現在時刻（24時間表記）を挿入。Ctrl/⌘+Bで強調、Shift+Enterで行内改行。余白はAlt+Q。</p>
            <button type="button" className="command-palette__help-action"
              onClick={openCommands}>操作を検索する <span>Ctrl/⌘ + K</span></button>
          </div>
        )}
      </section>
    </div>
  ) : null;
}
