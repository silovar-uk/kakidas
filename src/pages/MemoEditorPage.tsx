import {SeishoView} from "../components/SeishoView";
import {BackIcon} from "../components/icons";
import {waitForCreatedEntry,withViewTransition} from "../lib/viewTransition";
import {EntryComposer,type EntryComposerHandle} from "../components/EntryComposer";
import {DeskSlot} from "../components/DeskSlot";
import { buildEntryDraftId, draftRepository } from "../repositories/draftRepository";
import {type OutlineHandle} from "../components/OutlineList";
import {releaseDeskFocus,restoreDeskFocus,trackDeskFocus} from "../lib/deskFocus";
import {createPortal,flushSync} from "react-dom";
import {getOutlineBindings} from "../lib/outlineBinding";
import {MemoActionsMenu} from "../components/MemoActionsMenu";
import {fetchReferenceTitle} from "../lib/referenceTitle";
import {useCloudMemos} from "../hooks/useCloudMemos";
import {type MemoSyncMetaRow,getLinkHostname} from "../types/memo";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resetBodyScrollLock } from "../lib/bodyScrollLock";
import { copyToClipboard } from "../lib/clipboard";
import {
  readCopyIncludeCompleted,
  readEntrySortMode,
  writeCopyIncludeCompleted,
  writeEntrySortMode,
} from "../lib/copyPreferences";
import { formatMemoText } from "../lib/memoText";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { CloudAccountDialog } from "../components/CloudAccountDialog";
import {
  CloudUploadDialog,
  type CloudUploadTarget,
} from "../components/CloudUploadDialog";
import { EntryColumn } from "../components/EntryColumn";
import { MemoTagControl } from "../components/MemoTagControl";
import { NoticeToast } from "../components/NoticeToast";
import { useMemoDetail } from "../hooks/useMemos";
import {
  getEntryTagSummaries,
  getMemoTagSummaries,
  type MemoTagSummary,
} from "../lib/memoTags";
import { uploadMemoToCloud } from "../repositories/cloudMemoRepository";
import { memoRepository } from "../repositories/memoRepository";
import {
  type EntryKind,
  type EntrySortMode,
  type MemoWithEntries,
  ENTRY_KINDS,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_ORDER,
  formatDefaultMemoTitle,
  getEntryTree,
  getReferenceUrlKey,
  normalizeLinkUrlForSave,
} from "../types/memo";

function getLinkHostnameOrUrl(url: string): string {
  return getLinkHostname(url) || url;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], {
    type: "text/plain;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

type EditorNavigationState = {
  /** 新規の空メモでは、日付タイトルのかぎ括弧内から題名を書き始める。 */
  focusTitle?: boolean;
  /** 一覧から新規作成した空メモだけを、未入力のまま離れた時に破棄する。 */
  discardUntitledEmptyDraft?: boolean;
  focusComposer?: boolean;
  /** 新しいメモへ展開した時、元の区分で続きを書けるようにする。 */
  activeKind?: EntryKind;
};

function getNavigationKind(state: EditorNavigationState | null): EntryKind {
  return state?.activeKind && ENTRY_KINDS.includes(state.activeKind)
    ? state.activeKind
    : "sentence";
}

// 旧い保存名は開くたびに既定値(true)が書き込まれ、本人の選択と区別できないため引き継がない。
const ENTRY_TIMESTAMP_VISIBILITY_STORAGE_KEY = "kakidas.show-entry-timestamps.v2";
const ENTRY_NUMBER_VISIBILITY_STORAGE_KEY = "kakidas.show-entry-numbers";
/** アウトラインの行頭は段落・参考URLとは独立して切り替える。 */
const OUTLINE_NUMBER_VISIBILITY_STORAGE_KEY = "kakidas.outline-numbered.v1";
const HIDE_COMPLETED_ENTRIES_STORAGE_KEY = "kakidas.hide-completed-entries";
/** アウトラインだけの完了表示。初期値はfalseで、端末ごとに保持する。 */
const SHOW_COMPLETED_OUTLINE_STORAGE_KEY = "kakidas.show-completed-outline.v1";
const ADD_ENTRIES_AT_BOTTOM_STORAGE_KEY = "kakidas.add-entries-at-bottom";
const COMPACT_ENTRY_VIEW_STORAGE_KEY = "kakidas.compact-entry-view";
const COLLAPSED_ENTRY_COLUMNS_STORAGE_KEY = "kakidas.collapsed-entry-columns.v1";
const WORKSPACE_KINDS = ENTRY_KIND_ORDER;
/** 書き口がいない欄の入口。ボタンの読み上げ名と、見せる文。 */
const DESK_OPEN_LABEL: Record<EntryKind, string> = {
  sentence: "アウトラインに書く",
  paragraph: "段落を書く",
  word: "参考URLを貼る",
};
const DESK_OPEN_TEXT: Record<EntryKind, string> = {
  sentence: "次の一行を書く",
  paragraph: "段落を書く",
  word: "URLを貼る",
};

type CollapsedEntryColumns = Record<EntryKind, boolean>;

function readCollapsedEntryColumns(): CollapsedEntryColumns {
  const fallback: CollapsedEntryColumns = {
    word: false,
    sentence: false,
    paragraph: false,
  };

  try {
    const raw = window.localStorage.getItem(COLLAPSED_ENTRY_COLUMNS_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<Record<EntryKind, unknown>>;
    const next: CollapsedEntryColumns = {
      word: parsed.word === true,
      sentence: parsed.sentence === true,
      paragraph: parsed.paragraph === true,
    };

    // 空の作業面は作らない。壊れた保存値でも最低1列は必ず開く。
    if (ENTRY_KINDS.every((kind) => next[kind])) {
      next.paragraph = false;
    }

    return next;
  } catch {
    return fallback;
  }
}

function readEntryTimestampVisibility(): boolean {
  try {
    return window.localStorage.getItem(ENTRY_TIMESTAMP_VISIBILITY_STORAGE_KEY) === "true";
  } catch {
    // ストレージが使えないブラウザでは、既定どおり日時を隠す。
    return false;
  }
}

/**
 * 振り番は初期状態では非表示。表示設定は端末ごとに保存し、
 * 表示中だけコピーと .txt 出力にも反映する。
 */
function readEntryNumberVisibility(): boolean {
  try {
    return window.localStorage.getItem(ENTRY_NUMBER_VISIBILITY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** 旧「番号を表示」をONにしていた端末だけ、初回は番号へ引き継ぐ。以降は独立。 */
function readOutlineNumberVisibility(): boolean {
  try {
    const saved = window.localStorage.getItem(OUTLINE_NUMBER_VISIBILITY_STORAGE_KEY);
    return saved === null ? readEntryNumberVisibility() : saved === "true";
  } catch {
    return false;
  }
}

/** 段落・参考URLの従来の非表示設定。アウトラインは専用設定で制御する。 */
function readHideCompletedEntries(): boolean {
  try {
    return window.localStorage.getItem(HIDE_COMPLETED_ENTRIES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** アウトライン完了項目は初期状態で非表示。明示的に表示した端末のみ記憶する。 */
function readShowCompletedOutline(): boolean {
  try {
    return window.localStorage.getItem(SHOW_COMPLETED_OUTLINE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** 新しい項目は初期状態では先頭に置く。必要な端末だけ末尾追加を記憶する。 */
function readAddEntriesAtBottom(): boolean {
  try {
    return window.localStorage.getItem(ADD_ENTRIES_AT_BOTTOM_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** 補助情報と操作を畳み、本文だけを密に眺める表示モード。 */
function readCompactEntryView(): boolean {
  try {
    return window.localStorage.getItem(COMPACT_ENTRY_VIEW_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function MemoEditorPage() {
  const { memoId } = useParams();
  const navigate = useNavigate();
  const [searchParams,setSearchParams]=useSearchParams();
  const isSeisho=searchParams.get('view')==='seisho';
  const paperRef=useRef<HTMLElement|null>(null);
  const location = useLocation();
  const { user } = useAuth();
  const initialNavigationState = location.state as EditorNavigationState | null;
  const shouldDiscardUntitledEmptyDraft = Boolean(
    initialNavigationState?.discardUntitledEmptyDraft,
  );
  const [shouldFocusNewMemoTitle, setShouldFocusNewMemoTitle] = useState(
    () => Boolean(initialNavigationState?.focusTitle),
  );
  const [shouldFocusNewMemoComposer, setShouldFocusNewMemoComposer] = useState(
    () => Boolean(initialNavigationState?.focusComposer),
  );
  const [composerFocusKind, setComposerFocusKind] = useState<EntryKind>(
    () => getNavigationKind(initialNavigationState),
  );

  const {
    memo,
    isLoading,
    isSaving,
    error,
    reload,
    updateTitle,
    updateMemo,
    createEntry,
    updateEntry,
    deleteEntry,
    restoreEntries,
    deleteEntriesByKind,
    deleteCompletedEntries,
    renameEntryTag,
    moveEntryToKind,
    relocateOutlineEntry,
    createMemoFromEntry,
    deleteMemo,
  } = useMemoDetail(memoId);

  const [title, setTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const titleCaretTimersRef = useRef<number[]>([]);
  useEffect(() => () => titleCaretTimersRef.current.forEach((timer) => window.clearTimeout(timer)), []);
  // 画面を離れる直前にも、最新の入力値を判断できるようにする。
  const latestTitleRef = useRef(title);
  const latestMemoRef = useRef<MemoWithEntries | null>(memo);
  const isLeavingEditorRef = useRef(false);
  const [tagSuggestions, setTagSuggestions] = useState<MemoTagSummary[]>([]);
  const [activeKind, setActiveKind] = useState<EntryKind>(
    () => getNavigationKind(initialNavigationState),
  );
  const activeKindRef = useRef(activeKind);
  activeKindRef.current = activeKind;
  /** スマホで、いまの棚と違う欄へ置いたときの受け取り表示。一覧に重ねて出し、押し下げない。 */
  const [receipt, setReceipt] = useState<{ kind: EntryKind; at: number; text: string; targetId?: string } | null>(null);
  /** 棚の数字を弾ませる合図。atが変わるたびに動きをやり直す。 */
  const [bumped, setBumped] = useState<{ kind: EntryKind; at: number } | null>(null);
  const receiptTimerRef = useRef<number | null>(null);
  /** スマホの受け取り表示。4秒、一覧に重ねて出す。 */
  const announce = useCallback((kind: EntryKind, text: string, targetId?: string) => {
    setReceipt({ kind, at: Date.now(), text, targetId });
    if (receiptTimerRef.current !== null) window.clearTimeout(receiptTimerRef.current);
    receiptTimerRef.current = window.setTimeout(() => setReceipt(null), 4000);
  }, []);
  const handlePlaced = useCallback((kind: EntryKind, createdId?: string) => {
    if (!window.matchMedia("(max-width: 920px)").matches) return;
    setBumped({ kind, at: Date.now() });
    const text = `${ENTRY_KIND_LABEL[kind]}に置きました`;
    if (kind !== activeKindRef.current) { announce(kind, text, createdId); return; }
    // 今の棚でも、置いた行が画面の外(長い一覧の下など)なら知らせる。
    if (!createdId) return;
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(createdId)}"]`);
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) announce(kind, text, createdId);
    });
  }, [announce]);
  useEffect(() => () => {
    if (receiptTimerRef.current !== null) window.clearTimeout(receiptTimerRef.current);
  }, []);
  // 移動先の保存に成功した場合だけ、スマホの表示タブも切り替える。
  const handleMoveEntryToKind = useCallback(
    async (entryId: string, targetKind: EntryKind): Promise<void> => {
      await moveEntryToKind(entryId, targetKind);
      if (window.matchMedia("(max-width: 920px)").matches) {
        setActiveKind(targetKind);
      }
    },
    [moveEntryToKind],
  );
  const noticeIdRef = useRef(0);
  const [notice, setNoticeState] = useState<{ id: number; message: string } | null>(null);
  const setNotice = useCallback((message: string | null) => {
    if (message === null) {
      setNoticeState(null);
      return;
    }

    noticeIdRef.current += 1;
    setNoticeState({ id: noticeIdRef.current, message });
  }, []);
  const [copyingKind, setCopyingKind] = useState<EntryKind | null>(null);
  const [isCopyingMemo, setIsCopyingMemo] = useState(false);
  const [isCloudDialogOpen, setIsCloudDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  /** 書き口は種類ごとに独立。入力欄・編集中の選択範囲・下書き保存先を共有しない。 */
  const deskRefs = useRef<Record<EntryKind, EntryComposerHandle | null>>({
    sentence: null, paragraph: null, word: null,
  });
  const deskHosts = useMemo(() => {
    const create = (kind: EntryKind) => {
      const el = document.createElement("div");
      el.className = "desk-host";
      el.dataset.kind = kind;
      return el;
    };
    return {
      sentence: create("sentence"), paragraph: create("paragraph"), word: create("word"),
    } satisfies Record<EntryKind, HTMLElement>;
  }, []);
  const outlineRef = useRef<OutlineHandle>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 920px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 920px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  /** 書き口がいる欄(PC)。スマホでは棚(activeKind)が書き口の欄になる。 */
  const [deskSlot, setDeskSlot] = useState<EntryKind>("sentence");
  /** 段落の書き口は、この段落の後ろに入る。null=末尾、"^"=先頭。 */
  const [paragraphAfterId, setParagraphAfterId] = useState<string | null>(null);
  const [draftsByKind, setDraftsByKind] = useState<Record<EntryKind, boolean>>({
    sentence: false, paragraph: false, word: false,
  });
  /** 結び目を灯している項目(1.6秒)。 */
  const [lensIds, setLensIds] = useState<Set<string>>(() => new Set());
  const lensTimerRef = useRef<number | null>(null);
  const lens = useCallback((...ids: string[]) => {
    setLensIds(new Set(ids));
    if (lensTimerRef.current !== null) window.clearTimeout(lensTimerRef.current);
    lensTimerRef.current = window.setTimeout(() => setLensIds(new Set()), 1_600);
  }, []);
  useEffect(() => () => { if (lensTimerRef.current !== null) window.clearTimeout(lensTimerRef.current); }, []);
  const [caretDescription, setCaretDescription] = useState("");
  const effectiveSlot: EntryKind = isMobile ? activeKind : deskSlot;
  const activeDesk = () => deskRefs.current[effectiveSlot];
  useEffect(() => {
    const cleanup = Object.values(deskHosts).map((host) => trackDeskFocus(host));
    return () => cleanup.forEach((stop) => stop());
  }, [deskHosts]);
  // iPhoneでタブを切り替えても、別の書き口へ古いフォーカスを押し付けない。
  useLayoutEffect(() => restoreDeskFocus(deskHosts[effectiveSlot]));
  /** 書き口を欄へ運び、フォーカスする。変換中は運ばない(呼ぶ側がキーを見て決める)。 */
  /**
   * 書き口を欄へ運び、そのままフォーカスする。キー操作の中でも、運んだ直後に同期でフォーカスを入れる
   * (iOSでキーボードを閉じないため)。下書きの復元など、フォーカスを奪いたくないときは focus:false。
   */
  const moveDeskTo = useCallback((kind: EntryKind, options: { focus?: boolean; heading?: boolean } = {}) => {
    const mobile = window.matchMedia("(max-width: 920px)").matches;
    const apply = () => { if (mobile) setActiveKind(kind); else setDeskSlot(kind); };
    if (options.focus === false) { apply(); return; }
    flushSync(apply);
    deskRefs.current[kind]?.focus({ scroll: false, delay: 0, heading: options.heading });
  }, []);
  const moveDeskToRef = useRef(moveDeskTo);
  moveDeskToRef.current = moveDeskTo;
  const {prepareImport,importSnapshot}=useCloudMemos(user?.id ?? null);
  const [showEntryTimestamps, setShowEntryTimestamps] = useState(
    readEntryTimestampVisibility,
  );
  const [showEntryNumbers, setShowEntryNumbers] = useState(
    readEntryNumberVisibility,
  );
  const [outlineNumbered, setOutlineNumbered] = useState(readOutlineNumberVisibility);
  const [hideCompletedEntries, setHideCompletedEntries] = useState(
    readHideCompletedEntries,
  );
  const [showCompletedOutline, setShowCompletedOutline] = useState(readShowCompletedOutline);
  const [addEntriesAtBottom, setAddEntriesAtBottom] = useState(
    readAddEntriesAtBottom,
  );
  const [compactEntryView, setCompactEntryView] = useState(
    readCompactEntryView,
  );
  const [collapsedEntryColumns, setCollapsedEntryColumns] = useState<CollapsedEntryColumns>(
    readCollapsedEntryColumns,
  );
  const [isMediumScreen, setIsMediumScreen] = useState(
    () => window.matchMedia("(min-width: 921px) and (max-width: 1199px)").matches,
  );
  const [mediumUrlExpanded, setMediumUrlExpanded] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 921px) and (max-width: 1199px)");
    const update = () => setIsMediumScreen(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  // ショートカット経由では折りたたまれている列を開き、スマホではそのタブを見せる。
  useEffect(() => {
    const selectKind = (event: Event) => {
      const kind = (event as CustomEvent<EntryKind>).detail;
      if (!ENTRY_KINDS.includes(kind)) return;
      // 畳まれた参考URLのレールは、開いてから書き口を運ぶ。
      if (kind === "word") setMediumUrlExpanded(true);
      setCollapsedEntryColumns((previous) => previous[kind]
        ? { ...previous, [kind]: false }
        : previous);
      moveDeskToRef.current(kind);
    };
    window.addEventListener("kakidas:choose-entry-kind", selectKind);
    return () => window.removeEventListener("kakidas:choose-entry-kind", selectKind);
  }, []);
  /** 画面と出力に共通で使う、端末ごとの並び順。 */
  const [entrySortMode, setEntrySortMode] = useState<EntrySortMode>(
    readEntrySortMode,
  );
  /** コピーだけに適用する設定。完了の表示／非表示とは独立させる。 */
  const [includeCompletedInCopy, setIncludeCompletedInCopy] = useState(
    readCopyIncludeCompleted,
  );

  // 表示設定は端末ごとに記憶する。クラウドへは送らないUI設定。
  useEffect(() => {
    try {
      window.localStorage.setItem(
        ENTRY_TIMESTAMP_VISIBILITY_STORAGE_KEY,
        String(showEntryTimestamps),
      );
    } catch {
      // private modeなどで保存できない場合でも、現在の画面では切り替えられる。
    }
  }, [showEntryTimestamps]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ENTRY_NUMBER_VISIBILITY_STORAGE_KEY,
        String(showEntryNumbers),
      );
    } catch {
      // private modeなどで保存できない場合でも、現在の画面では切り替えられる。
    }
  }, [showEntryNumbers]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OUTLINE_NUMBER_VISIBILITY_STORAGE_KEY, String(outlineNumbered));
    } catch {
      // プライベートブラウズ中も切替そのものは利用できる。
    }
  }, [outlineNumbered]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HIDE_COMPLETED_ENTRIES_STORAGE_KEY,
        String(hideCompletedEntries),
      );
    } catch {
      // 表示設定の保存に失敗しても、その場での表示切り替えは維持する。
    }
  }, [hideCompletedEntries]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_COMPLETED_OUTLINE_STORAGE_KEY, String(showCompletedOutline));
    } catch {
      // ストレージが無効でも現在のメモで切り替えられる。
    }
  }, [showCompletedOutline]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ADD_ENTRIES_AT_BOTTOM_STORAGE_KEY,
        String(addEntriesAtBottom),
      );
    } catch {
      // 端末設定を保存できない場合でも、現在の画面では切り替えられる。
    }
  }, [addEntriesAtBottom]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COMPACT_ENTRY_VIEW_STORAGE_KEY,
        String(compactEntryView),
      );
    } catch {
      // 読むための表示設定なので、保存できなくてもその場の切り替えを優先する。
    }
  }, [compactEntryView]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLLAPSED_ENTRY_COLUMNS_STORAGE_KEY,
        JSON.stringify(collapsedEntryColumns),
      );
    } catch {
      // 端末設定を保存できない場合でも、現在の画面では列の開閉を維持する。
    }
  }, [collapsedEntryColumns]);

  useEffect(() => {
    writeCopyIncludeCompleted(includeCompletedInCopy);
  }, [includeCompletedInCopy]);

  useEffect(() => {
    writeEntrySortMode(entrySortMode);
  }, [entrySortMode]);

  const effectiveCollapsed = useMemo(() => ({
    ...collapsedEntryColumns,
    word: collapsedEntryColumns.word || (isMediumScreen && !mediumUrlExpanded),
  }), [collapsedEntryColumns, isMediumScreen, mediumUrlExpanded]);

  const toggleEntryColumnCollapsed = useCallback((targetKind: EntryKind) => {
    if (targetKind === "word" && isMediumScreen && !mediumUrlExpanded && !collapsedEntryColumns.word) {
      setMediumUrlExpanded(true);
      return;
    }
    setCollapsedEntryColumns((current) => {
      const openCount = ENTRY_KINDS.filter((kind) => !current[kind]).length;
      if (!current[targetKind] && openCount <= 1) return current;
      return { ...current, [targetKind]: !current[targetKind] };
    });
  }, [collapsedEntryColumns.word, isMediumScreen, mediumUrlExpanded]);

  const openEntryColumnCount = ENTRY_KINDS.filter((kind) => !effectiveCollapsed[kind]).length;
  const editorGridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: WORKSPACE_KINDS.map((kind) =>
      effectiveCollapsed[kind] ? "44px" : `minmax(0, ${({ sentence: 42, paragraph: 38, word: 20 })[kind]}fr)`
    ).join(" "),
  }), [effectiveCollapsed]);

  // メモ画面を離れた後に、モバイル操作シート等のスクロールロックを残さない。
  useEffect(() => {
    return () => resetBodyScrollLock();
  }, []);

  useEffect(() => {
    latestTitleRef.current = title;
  }, [title]);

  useEffect(() => {
    latestMemoRef.current = memo;
  }, [memo]);

  useEffect(() => {
    if (memo) {
      setTitle(memo.title);
    }
  }, [memo?.id, memo?.title]);

  // タグ候補は「実際に使ったことがある言葉」だけから作る。AI推測や別テーブルは使わない。
  useEffect(() => {
    let cancelled = false;

    void memoRepository
      .listMemos()
      .then((memos) => {
        if (!cancelled) setTagSuggestions(getMemoTagSummaries(memos));
      })
      .catch(() => {
        // タグ候補が読めなくても、自由入力でタグを付けられる。
      });

    return () => {
      cancelled = true;
    };
  }, [memo?.id, memo?.tag]);

  // Chromeなどのブラウザタブでは、今開いているメモをすぐ見分けられるようにする。
  // 編集中のタイトルもそのまま反映し、空欄に戻した時だけ既定タイトルを使う。
  useEffect(() => {
    if (!memo) {
      document.title = "kakidas";
      return;
    }

    document.title =
      title.trim() || formatDefaultMemoTitle(new Date(memo.created_at));
  }, [memo?.created_at, memo?.id, title]);

  // 新規の空メモは、日付タイトルのかぎ括弧内から名前を書き始める。
  // 既存メモや項目から展開したメモまで自動フォーカスしないよう、遷移時に明示された場合だけ行う。
  useEffect(() => {
    const navigationState = location.state as EditorNavigationState | null;

    if (navigationState?.focusTitle) {
      setShouldFocusNewMemoTitle(true);
      setShouldFocusNewMemoComposer(false);
    }

    if (!navigationState?.focusComposer) return;

    const nextKind = getNavigationKind(navigationState);
    setComposerFocusKind(nextKind);
    setActiveKind(nextKind);
    setShouldFocusNewMemoComposer(true);
  }, [location.key, location.state]);

  useEffect(() => {
    if (!memo || !shouldFocusNewMemoTitle) return;

    const defaultTitle = formatDefaultMemoTitle(new Date(memo.created_at));

    // 非同期で読み込んだタイトルが反映された後だけ、空のかぎ括弧内に置く。
    if (title !== defaultTitle) return;

    const frame = window.requestAnimationFrame(() => {
      const input = titleInputRef.current;
      const openingQuoteIndex = defaultTitle.indexOf("「");

      if (!input || openingQuoteIndex < 0) return;

      const caretPosition = openingQuoteIndex + 1;
      input.focus({ preventScroll: true });
      input.setSelectionRange(caretPosition, caretPosition);
      setShouldFocusNewMemoTitle(false);

      // iPhone Safariはキーボード表示中にカーソルを末尾へ戻すことがある。
      // 値が変わらず題にフォーカスがある間だけ、位置を直す。
      titleCaretTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      titleCaretTimersRef.current = [60, 180, 360, 560].map((delay) =>
        window.setTimeout(() => {
          if (input.value !== defaultTitle || document.activeElement !== input) return;
          input.setSelectionRange(caretPosition, caretPosition);
        }, delay),
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [memo, shouldFocusNewMemoTitle, title]);

  useEffect(() => {
    if (shouldFocusNewMemoComposer) {
      setActiveKind(composerFocusKind);
    }
  }, [composerFocusKind, shouldFocusNewMemoComposer]);

  const saveTitle = useCallback(
    async (rawTitle: string) => {
      if (!memo) return;

      const nextTitle =
        rawTitle.trim() || formatDefaultMemoTitle(new Date(memo.created_at));

      if (nextTitle === memo.title) {
        if (nextTitle !== rawTitle) {
          setTitle(nextTitle);
        }

        return;
      }

      await updateTitle({ title: nextTitle });
      setTitle(nextTitle);
    },
    [memo, updateTitle],
  );

  /**
   * 空の新規メモだけを、一覧へ戻る時に片付ける。
   * 題名が変わっていれば項目がなくてもメモとして残し、未送信の題名を先に保存する。
   */
  const finalizeUntitledEmptyDraft = useCallback(async (): Promise<boolean> => {
    if (!memoId || !shouldDiscardUntitledEmptyDraft) return false;

    const currentMemo = latestMemoRef.current;

    if (!currentMemo) {
      // 読み込み前に戻った場合でも、リポジトリ側で既定タイトル・項目0件を再確認する。
      if (latestTitleRef.current.trim()) return false;
      return memoRepository.discardUntitledEmptyMemo(memoId);
    }

    const defaultTitle = formatDefaultMemoTitle(new Date(currentMemo.created_at));
    const resolvedTitle = latestTitleRef.current.trim() || defaultTitle;

    if (resolvedTitle !== defaultTitle) {
      if (resolvedTitle !== currentMemo.title) {
        await updateTitle({ title: resolvedTitle });
      }
      return false;
    }

    return memoRepository.discardUntitledEmptyMemo(memoId);
  }, [memoId, shouldDiscardUntitledEmptyDraft, updateTitle]);

  const handleReturnToMemoList = useCallback(async () => {
    if (isLeavingEditorRef.current) return;

    isLeavingEditorRef.current = true;

    try {
      await finalizeUntitledEmptyDraft();
    } finally {
      navigate("/", { replace: true });
    }
  }, [finalizeUntitledEmptyDraft, navigate]);

  // ブラウザの戻る操作や別画面への遷移でも、空の新規メモを残さない。
  // ここでは画面状態に頼らず、リポジトリ側で再確認してから破棄する。
  useEffect(() => {
    const draftMemoId = memoId;
    const shouldDiscardOnLeave = shouldDiscardUntitledEmptyDraft;

    return () => {
      if (!draftMemoId || !shouldDiscardOnLeave || isLeavingEditorRef.current) {
        return;
      }

      const currentMemo = latestMemoRef.current;
      const defaultTitle = currentMemo
        ? formatDefaultMemoTitle(new Date(currentMemo.created_at))
        : null;
      const resolvedTitle = defaultTitle
        ? latestTitleRef.current.trim() || defaultTitle
        : latestTitleRef.current.trim();

      if (defaultTitle && resolvedTitle !== defaultTitle) {
        // タイトルだけ書いた場合は、離脱後にも題名を残す。
        if (currentMemo && resolvedTitle !== currentMemo.title) {
          void memoRepository.updateMemo(draftMemoId, { title: resolvedTitle });
        }
        return;
      }

      if (!defaultTitle && resolvedTitle) return;

      void memoRepository.discardUntitledEmptyMemo(draftMemoId);
    };
  }, [memoId, shouldDiscardUntitledEmptyDraft]);

  useEffect(() => {
    if (!memo || title === memo.title) return;

    const timer = window.setTimeout(() => {
      void saveTitle(title);
    }, 600);

    return () => window.clearTimeout(timer);
  }, [memo, saveTitle, title]);

  const handleSaveTag = async (tag: string | null): Promise<void> => {
    if (!memo) return;

    await updateMemo({ tag });
    setNotice(tag ? `タグ「${tag}」を付けました。` : "タグを外しました。");
  };

  const handleDownload = () => {
    if (!memo) return;

    const safeTitle = memo.title.replace(/[\\/:*?"<>|]/g, "_");

    downloadText(
      `${safeTitle}.txt`,
      formatMemoText(memo, {
        includeEntryNumbers: showEntryNumbers,
        includeOutlineNumbers: outlineNumbered,
        entrySortMode,
      }),
    );

    setNotice("テキストを書き出しました。");
  };

  /** メモ全体を、現在の出力設定でクリップボードへコピーする。 */
  const handleCopyMemo = async () => {
    if (!memo || isCopyingMemo) return;

    setIsCopyingMemo(true);
    setNotice(null);

    try {
      const completedCount = memo.entries.filter((entry) => entry.is_completed).length;

      await copyToClipboard(
        formatMemoText(memo, {
          includeEntryNumbers: showEntryNumbers,
          includeOutlineNumbers: outlineNumbered,
          excludeCompleted: !includeCompletedInCopy,
          entrySortMode,
        }),
      );

      const completionNotice = includeCompletedInCopy && completedCount > 0
        ? `完了済み${completedCount}件も含めました。`
        : !includeCompletedInCopy && completedCount > 0
          ? `完了済み${completedCount}件は含めていません。`
          : "";

      setNotice(`メモをコピーしました。${completionNotice}`);
    } catch (copyError) {
      setNotice(
        copyError instanceof Error
          ? copyError.message
          : "メモをコピーできませんでした。",
      );
    } finally {
      setIsCopyingMemo(false);
    }
  };

  const handleCopyKind = async (kind: EntryKind) => {
    if (!memo || copyingKind !== null) return;

    const copyableCount = memo.entries.filter(
      (entry) =>
        entry.kind === kind &&
        (includeCompletedInCopy || !entry.is_completed),
    ).length;

    if (copyableCount === 0) {
      setNotice(
        includeCompletedInCopy
          ? `「${ENTRY_KIND_LABEL[kind]}」にコピーできる項目はありません。`
          : `「${ENTRY_KIND_LABEL[kind]}」にコピーできる未完了の項目はありません。`,
      );
      return;
    }

    setCopyingKind(kind);
    setNotice(null);

    try {
      const completedCount = memo.entries.filter(
        (entry) => entry.kind === kind && entry.is_completed,
      ).length;

      // メモ内容はすでに画面へ読み込み済み。タップ操作の同期中に
      // Clipboard API を呼ぶことで、スマホでもコピー許可を保ちやすい。
      await copyToClipboard(
        formatMemoText(memo, {
          includeEntryNumbers: showEntryNumbers,
          includeOutlineNumbers: outlineNumbered,
          excludeCompleted: !includeCompletedInCopy,
          onlyKind: kind,
          entrySortMode,
        }),
      );

      const completionNotice = includeCompletedInCopy && completedCount > 0
        ? `完了済み${completedCount}件も含めました。`
        : !includeCompletedInCopy && completedCount > 0
          ? `完了済み${completedCount}件は含めていません。`
          : "";

      setNotice(`「${ENTRY_KIND_LABEL[kind]}」をコピーしました。${completionNotice}`);
    } catch (copyError) {
      setNotice(
        copyError instanceof Error
          ? copyError.message
          : "コピーできませんでした。",
      );
    } finally {
      setCopyingKind(null);
    }
  };

  /** 「…」から個別にコピーする場合は、本文だけをそのまま渡す。 */
  const handleCopyEntry = async (content: string): Promise<boolean> => {
    try {
      await copyToClipboard(content);
      setNotice("項目をコピーしました。");
      return true;
    } catch (copyError) {
      setNotice(
        copyError instanceof Error
          ? copyError.message
          : "項目をコピーできませんでした。",
      );
      return false;
    }
  };

  /** 「…」の項目を、新しい大きなメモの起点として複製して開く。 */
  const handleCreateMemoFromEntry = async (entryId: string): Promise<void> => {
    const result = await createMemoFromEntry(entryId);

    navigate(`/memos/${result.memo.id}`, {
      state: {
        focusComposer: true,
        activeKind: result.entry.kind,
      } satisfies EditorNavigationState,
    });
  };

  const handleDeleteMemo = async () => {
    const confirmed = window.confirm(
      "このメモを削除しますか？\n削除後はバックアップ以外から復元できません。",
    );

    if (!confirmed) return;

    try {
      await deleteMemo();
      navigate("/");
    } catch {
      setNotice("メモを削除できませんでした。");
    }
  };

  const handleDeleteCompleted = async () => {
    if (completedEntryCount === 0 || isSaving) return;

    const confirmed = window.confirm(
      `完了済みの${completedEntryCount}件を削除しますか？\n未完了の項目は残ります。\nこの操作は元に戻せません。`,
    );

    if (!confirmed) return;

    try {
      const result = await deleteCompletedEntries();
      if (result.deleted_count === 0) {
        setNotice("削除する完了済み項目はありません。");
        return;
      }

      setNotice(
        result.reparented_count > 0
          ? `完了済み${result.deleted_count}件を削除しました。未完了${result.reparented_count}件は残しています。`
          : `完了済み${result.deleted_count}件を削除しました。`,
      );
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "完了済み項目を削除できませんでした。",
      );
    }
  };

  const completedEntryCount = useMemo(
    () => memo?.entries.filter((entry) => entry.is_completed).length ?? 0,
    [memo?.entries],
  );

  /**
   * モバイルタブに添える未完了項目数。
   * 表示設定（完了を非表示）とは独立して、完了済みだけを除外する。
   */
  const openEntryCountsByKind = useMemo<Record<EntryKind, number>>(
    () => ({
      word: memo?.entries.filter(
        (entry) => entry.kind === "word" && !entry.is_completed,
      ).length ?? 0,
      sentence:
        memo?.entries.filter(
          (entry) => entry.kind === "sentence" && !entry.is_completed,
        ).length ?? 0,
      paragraph:
        memo?.entries.filter(
          (entry) => entry.kind === "paragraph" && !entry.is_completed,
        ).length ?? 0,
    }),
    [memo?.entries],
  );

  const copyableEntryCountsByKind = useMemo(
    () => ({
      word: memo?.entries.filter(
        (entry) =>
          entry.kind === "word" &&
          (includeCompletedInCopy || !entry.is_completed),
      ).length ?? 0,
      sentence:
        memo?.entries.filter(
          (entry) =>
            entry.kind === "sentence" &&
            (includeCompletedInCopy || !entry.is_completed),
        ).length ?? 0,
      paragraph:
        memo?.entries.filter(
          (entry) =>
            entry.kind === "paragraph" &&
            (includeCompletedInCopy || !entry.is_completed),
        ).length ?? 0,
    }),
    [includeCompletedInCopy, memo?.entries],
  );

  /** 項目タグの候補は、このメモの単語・文・段落をまたいで再利用できる。 */
  const entryTagSuggestions = useMemo(
    () => getEntryTagSummaries(memo?.entries ?? []),
    [memo?.entries],
  );

  const completedOutlineCount = useMemo(
    () => memo?.entries.filter((entry) => entry.kind === "sentence" && entry.is_completed && entry.deleted_at === null).length ?? 0,
    [memo?.entries],
  );

  const entriesByKind = useMemo(() => {
    const allEntries = memo?.entries ?? [];
    // アウトラインだけは初期状態で完了を隠す。段落・URLの旧設定とは独立。
    // 木に変換する前に除外し、完了した親の未完了の子も表示できるようにする。
    const outlineEntries = showCompletedOutline
      ? allEntries
      : allEntries.filter((entry) => !entry.is_completed);
    const otherEntries = hideCompletedEntries
      ? allEntries.filter((entry) => !entry.is_completed)
      : allEntries;

    return {
      word: getEntryTree(otherEntries, "word", entrySortMode),
      sentence: getEntryTree(outlineEntries, "sentence", entrySortMode),
      paragraph: getEntryTree(otherEntries, "paragraph", entrySortMode),
    };
  }, [entrySortMode, hideCompletedEntries, showCompletedOutline, memo?.entries]);

  /** 結び目: 段落の見出しが、アウトラインの1行と同じ文なら結ぶ。データは変えず、毎回求める。 */
  const bindings = useMemo(() => getOutlineBindings(memo?.entries ?? []), [memo?.entries]);
  const rowNumberById = useMemo(() => {
    const numbers = new Map<string, string>();
    getEntryTree(memo?.entries ?? [], "sentence", "manual").forEach((row) => numbers.set(row.id, row.outline_number));
    return numbers;
  }, [memo?.entries]);
  /** 参考URLごとの、アウトラインで引用している行(同じURL)。 */
  const citationRowIds = useMemo(() => {
    const rows = (memo?.entries ?? []).filter((entry) => entry.deleted_at === null && entry.kind === "sentence" && entry.link_url.trim());
    const byKey = new Map<string, string[]>();
    rows.forEach((row) => {
      const key = getReferenceUrlKey(row.link_url);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), row.id]);
    });
    const result = new Map<string, string[]>();
    (memo?.entries ?? []).forEach((entry) => {
      if (entry.deleted_at !== null || entry.kind !== "word" || !entry.link_url.trim()) return;
      const ids = byKey.get(getReferenceUrlKey(entry.link_url));
      if (ids?.length) result.set(entry.id, ids);
    });
    return result;
  }, [memo?.entries]);

  const cloudUploadTarget = useMemo<CloudUploadTarget[]>(() => {
    if (!memo) return [];

    return [
      {
        id: memo.id,
        title: memo.title,
        entry_counts: {
          word: entriesByKind.word.length,
          sentence: entriesByKind.sentence.length,
          paragraph: entriesByKind.paragraph.length,
        },
        sync_meta: memo.sync_meta,
      },
    ];
  }, [entriesByKind, memo]);

  const openUpload = () => {
    if (!user) {
      setIsCloudDialogOpen(true);
      return;
    }

    setIsUploadDialogOpen(true);
  };

  useEffect(()=>{
    if(!memo||!shouldFocusNewMemoComposer)return;
    const frame=requestAnimationFrame(()=>{
      window.dispatchEvent(new CustomEvent('kakidas:choose-entry-kind',{detail:composerFocusKind}));
      deskRefs.current[composerFocusKind]?.focus({scroll:false,delay:0});
      setShouldFocusNewMemoComposer(false);
    });
    return()=>cancelAnimationFrame(frame);
  },[memo?.id,shouldFocusNewMemoComposer,composerFocusKind]);


  const handleCloudSync=async()=>{
    if(!memo||!user)return;
    let original:MemoSyncMetaRow|null=null;
    let unlocked=false;
    try{
      const candidate=await prepareImport(memo.id);
      if(!candidate.hasLocalMemo)throw new Error("端末のメモがありません。");
      if(!window.confirm(`クラウド版「${candidate.snapshot.memo.title}」で端末側を上書きしますか？\n端末側だけの変更は元に戻せません。`))return;
      original=await memoRepository.getSyncMeta(memo.id);
      if(original.cloud_state==='changed_after_upload'||original.cloud_state==='conflict'){
        await memoRepository.saveSyncMeta({...original,cloud_state:'uploaded',last_error:null});unlocked=true;
      }
      await importSnapshot(candidate.snapshot,'replace');window.location.reload();
    }catch(error){
      if(unlocked&&original)await memoRepository.saveSyncMeta(original).catch(()=>{});
      setNotice(error instanceof Error?error.message:"クラウドに合わせられませんでした。");
    }
  };
  const handleChat=()=>{
    if(!memo)return;
    const tab=window.open('about:blank','_blank');
    if(!tab){setNotice('新しいタブの表示を許可してください。');return;}
    tab.opener=null;
    const prompt=formatMemoText({...memo,title:title.trim()||memo.title},{
      includeEntryNumbers:showEntryNumbers,includeOutlineNumbers:outlineNumbered,excludeCompleted:!includeCompletedInCopy,entrySortMode});
    const url=new URL('https://chatgpt.com/');url.searchParams.set('prompt',prompt);
    tab.location.replace(url.toString());
  };
  /** 参考URLの題名は、置いたあとで取りに行く。 */
  const enrichReferenceTitle=(entryId:string,url:string)=>{
    void fetchReferenceTitle(url).then(result=>{
      if(result)return updateEntry(entryId,{content:result});
    }).catch(()=>{});
  };
  /** 画面の順ではなく、保存する順(手動の順)で、段落の挿入位置を求める。 */
  const paragraphInsertIndex=()=>{
    const list=getEntryTree(memo?.entries??[],"paragraph","manual");
    if(paragraphAfterId==="^")return 0;
    if(paragraphAfterId){
      const at=list.findIndex(entry=>entry.id===paragraphAfterId);
      if(at>=0)return at+1;
    }
    return list.length;
  };
  /** 続けて打ってEnterを重ねても、置く順番と位置(次の一行)が前後しないよう、ひとつずつ置く。 */
  const deskQueueRef=useRef<Promise<unknown>>(Promise.resolve());
  const handleDeskCreate=(content:string,metadata:import('../types/memo').EntryCreateMetadata,draftId:string,kind:EntryKind='sentence',entryId?:string)=>{
    const run=deskQueueRef.current.then(()=>createFromDesk(content,metadata,draftId,kind,entryId));
    deskQueueRef.current=run.catch(()=>undefined);
    return run;
  };
  const createFromDesk=async(content:string,metadata:import('../types/memo').EntryCreateMetadata,draftId:string,kind:EntryKind='sentence',entryId?:string)=>{
    let created;
    if(kind==='sentence'){
      // 次の一行の位置へ置き、次の一行を新しい行の下へ進める。
      const position=outlineRef.current?.insertPosition();
      created=await createEntry('sentence',content,metadata,position?.parentId??null,'bottom',draftId,entryId,position?.index);
      outlineRef.current?.advance(created.id);
    }else if(kind==='paragraph'){
      // 段落は文書の順。選んだ段落の後ろ(なければ末尾)へ置き、続けて次の段落をその後ろへ。
      created=await createEntry('paragraph',content,metadata,null,'bottom',draftId,entryId,paragraphInsertIndex());
      setParagraphAfterId(created.id);
    }else{
      created=await createEntry(kind,content,metadata,null,addEntriesAtBottom?'bottom':'top',draftId,entryId);
      if(metadata.link_url)enrichReferenceTitle(created.id,metadata.link_url);
    }
    return created;
  };

  /** どこで貼っても: URLだけなら参考URLへ(重複は除く)。ふつうの文は書き口へ入れる(置くのはEnter)。 */
  const placeReferenceUrls=async(urls:string[])=>{
    const known=new Set((memo?.entries??[]).filter(entry=>entry.kind==='word'&&entry.link_url).map(entry=>getReferenceUrlKey(entry.link_url)));
    const fresh:string[]=[];
    for(const url of urls){
      const key=getReferenceUrlKey(url);
      if(!key||known.has(key))continue;
      known.add(key);
      fresh.push(url);
    }
    if(fresh.length===0){setNotice("貼ったURLはすべて保存済みです。");return;}
    try{
      for(const url of fresh){
        const created=await createEntry('word',getLinkHostnameOrUrl(url),{link_url:url},null,addEntriesAtBottom?'bottom':'top');
        enrichReferenceTitle(created.id,url);
      }
      const text=fresh.length>1?`参考URLに${fresh.length}件置きました`:'参考URLに置きました';
      if(window.matchMedia("(max-width: 920px)").matches)handlePlaced('word');
      else setNotice(text);
    }catch(error){
      setNotice(error instanceof Error?error.message:"参考URLに置けませんでした。");
    }
  };
  const pasteRef=useRef<(event:ClipboardEvent)=>void>(()=>{});
  pasteRef.current=(event:ClipboardEvent)=>{
    const target=event.target as Element|null;
    if(target&&typeof target.closest==='function'&&target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], dialog'))return;
    if(isSeisho||isUploading)return;
    const text=event.clipboardData?.getData('text')??'';
    const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(lines.length===0)return;
    event.preventDefault();
    const isUrlLine=(line:string)=>{
      if(!/^(https?:\/\/|www\.)\S+$/iu.test(line))return false;
      try{normalizeLinkUrlForSave(line);return true;}catch{return false;}
    };
    if(lines.every(isUrlLine)){
      void placeReferenceUrls(lines.map(line=>normalizeLinkUrlForSave(line)));
      return;
    }
    // 貼り付けた文章も現在の書き口に留める。暗黙に別の欄へは移動しない。
    activeDesk()?.insertText(text);
  };
  useEffect(()=>{
    const onPaste=(event:ClipboardEvent)=>pasteRef.current(event);
    document.addEventListener('paste',onPaste);
    return()=>document.removeEventListener('paste',onPaste);
  },[]);

  /** 画面の先頭60行ぶんの行の文に、清書の紙と同じ名前を付ける(行が紙へ収まる移り変わり用)。 */
  const nameOutlineRows=()=>{
    document.querySelectorAll<HTMLElement>('.outline__item[data-outline-id]').forEach((row,index)=>{
      if(index>=60)return;
      const text=row.querySelector<HTMLElement>('.outline__content');
      if(text)text.style.viewTransitionName=`e-${row.dataset.outlineId}`;
    });
  };
  const clearOutlineRowNames=()=>{
    document.querySelectorAll<HTMLElement>('.outline__content').forEach(text=>{text.style.viewTransitionName='';});
  };
  const toggleSeisho=(next:boolean)=>{
    // 行と紙の項目に同じ名前を付けておき、移り変わりで行が紙へ収まる。戻るときは、描き直した行へ付け直す。
    if(next)nameOutlineRows();
    void withViewTransition(()=>{
      setSearchParams(previous=>{
        const params=new URLSearchParams(previous);
        if(next)params.set('view','seisho');else params.delete('view');
        return params;
      },{replace:false});
      if(!next)return Promise.resolve().then(nameOutlineRows);
    },{scoped:true}).finally(clearOutlineRowNames);
  };

  /** 結ばれた段落へ送る。両方を朱の淡色で灯す。 */
  const jumpToParagraph=(paragraphId:string,rowId:string)=>{
    if(window.matchMedia("(max-width: 920px)").matches)setActiveKind('paragraph');
    lens(paragraphId,rowId);
    window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{
      document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(paragraphId)}"]`)
        ?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }));
  };
  /** 結ばれた行を選んで見せる。 */
  const jumpToRow=(rowId:string)=>{
    if(window.matchMedia("(max-width: 920px)").matches)setActiveKind('sentence');
    lens(rowId,...(bindings.paragraphsByRowId.get(rowId)??[]).map(paragraph=>paragraph.id));
    window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>outlineRef.current?.revealRow(rowId)));
  };
  const jumpToCitation=(refId:string)=>{
    const rowId=citationRowIds.get(refId)?.[0];
    if(!rowId)return;
    jumpToRow(rowId);
    lens(rowId,refId);
  };

  /**
   * 行を見出しにして、段落の書き口で書き始める(「段落にする」)。結ばれていれば、その段落へ送る。
   * 段落は、アウトラインの順に並ぶ位置へ入る(前の行に結ばれた最後の段落の後ろ、なければ後の行の最初の段落の前、なければ末尾)。
   */
  const growRow=async(rowId:string)=>{
    if(!memo)return;
    const row=memo.entries.find(entry=>entry.id===rowId&&entry.deleted_at===null&&entry.kind==='sentence');
    if(!row)return;
    const bound=bindings.paragraphsByRowId.get(rowId)?.[0];
    if(bound){jumpToParagraph(bound.id,rowId);return;}
    if(deskRefs.current.paragraph && !deskRefs.current.paragraph.isEmpty()){
      setNotice("段落に書きかけがあります。段落の入力内容を先に保存してください。"); return;
    }
    const rowOrder=getEntryTree(memo.entries,'sentence','manual').map(entry=>entry.id);
    const myIndex=rowOrder.indexOf(rowId);
    const paragraphs=getEntryTree(memo.entries,'paragraph','manual');
    let after:string|null=null;
    let before:string|null=null;
    for(const paragraph of paragraphs){
      const bindRow=bindings.rowByParagraphId.get(paragraph.id);
      if(!bindRow)continue;
      const index=rowOrder.indexOf(bindRow.id);
      if(index<myIndex)after=paragraph.id;
      else if(index>myIndex&&!before)before=paragraph.id;
    }
    let nextAfter:string|null=null;
    if(after)nextAfter=after;
    else if(before){const at=paragraphs.findIndex(paragraph=>paragraph.id===before);nextAfter=at>0?paragraphs[at-1].id:'^';}
    const source=document.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(rowId)}"] .outline__content`);
    if(source)source.style.viewTransitionName='amu-grow';
    await withViewTransition(()=>{
      if(source)source.style.viewTransitionName='';
      setParagraphAfterId(nextAfter);
      moveDeskTo('paragraph',{focus:false});
      deskRefs.current.paragraph?.prefillParagraph(row.content);
      // 描き直した後に、見出しの欄へ同じ名前を付け替える(行の文が見出しへ飛ぶ)
      return Promise.resolve().then(()=>{
        const heading=deskHosts.paragraph.querySelector<HTMLElement>('.entry-composer__paragraph-title');
        if(heading)heading.style.viewTransitionName='amu-grow';
      });
    },{scoped:true});
    deskHosts.paragraph.querySelector<HTMLElement>('.entry-composer__paragraph-title')?.style.removeProperty('view-transition-name');
    deskRefs.current.paragraph?.focus({scroll:false,delay:0,heading:true});
    deskHosts.paragraph.scrollIntoView({block:'nearest'});
  };

  /** ユーザーが「段落にする」を押したときだけ、下書きを安全に移す。 */
  const convertSentenceDraftToParagraph = async () => {
    if (!memo) return;
    const from = deskRefs.current.sentence;
    const to = deskRefs.current.paragraph;
    if (!from || !to || from.isEmpty()) return;
    if (!to.isEmpty()) {
      setNotice("段落にも書きかけがあります。まず段落の下書きを保存してください。");
      return;
    }
    const snapshot = from.getDraftSnapshot();
    if (!snapshot.content.trim()) return;
    // 先に段落の編集面へコピーして移る。旧下書きは新下書きの保存成功まで保持。
    to.loadTransferredDraft(snapshot);
    moveDeskTo("paragraph");
    try {
      await draftRepository.save({
        id: buildEntryDraftId(memo.id, "paragraph", "main"),
        memo_id: memo.id, kind: "paragraph", scope: "main", fixed_tag: null,
        base_memo_updated_at: memo.updated_at, snapshot,
      });
      from.clearTransferredDraft();
      setNotice("段落の書き口へ移しました。");
    } catch {
      // 保存できなかった場合は旧書き口を消さない。
      setNotice("移動先の下書きを保存できませんでした。元のアウトラインにも残しています。");
    }
  };

  /** 参考URLを、アウトラインの次の一行へ(リンク付きで)引く。 */
  const pullToOutline=async(refId:string)=>{
    const word=memo?.entries.find(entry=>entry.id===refId&&entry.deleted_at===null&&entry.kind==='word');
    if(!word||!word.link_url)return;
    const position=outlineRef.current?.insertPosition();
    const newId=crypto.randomUUID();
    const source=document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(refId)}"] .entry-item__reference-link`);
    if(source)source.style.viewTransitionName='amu-pull';
    try{
      await withViewTransition(async()=>{
        if(source)source.style.viewTransitionName='';
        await createEntry('sentence',word.content,{link_url:word.link_url},position?.parentId??null,'bottom',undefined,newId,position?.index);
        outlineRef.current?.advance(newId);
        await waitForCreatedEntry(newId,300);
        const text=document.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(newId)}"] .outline__content`);
        if(text)text.style.viewTransitionName='amu-pull';
      },{scoped:true});
    }catch(error){
      setNotice(error instanceof Error?error.message:"アウトラインに引けませんでした。");
    }finally{
      document.querySelectorAll<HTMLElement>('.outline__content').forEach(text=>{if(text.style.viewTransitionName==='amu-pull')text.style.viewTransitionName='';});
    }
    if(window.matchMedia("(max-width: 920px)").matches)announce('sentence','アウトラインに引きました');
  };
  const copySeisho=()=>{
    const article=paperRef.current;
    if(!article)return;
    const selection=window.getSelection();
    const range=document.createRange();range.selectNodeContents(article);
    selection?.removeAllRanges();selection?.addRange(range);
    const copied=document.execCommand('copy');
    selection?.removeAllRanges();
    if(copied){setNotice('清書を書式つきでコピーしました。');return;}
    if(!memo)return;
    void copyToClipboard(formatMemoText(memo,{entrySortMode,excludeCompleted:!includeCompletedInCopy})).then(
      ()=>setNotice('プレーンテキストでコピーしました。'),()=>setNotice('コピーに失敗しました。'));
  };

  const handleUploadConfirm = async () => {
    if (!memo || !user) {
      throw new Error("クラウドへ送るにはログインが必要です。");
    }

    setIsUploading(true);

    try {
      await saveTitle(title);
      await uploadMemoToCloud(memo.id, user.id);
      await reload();
      setIsUploadDialogOpen(false);
      setNotice("このメモをクラウドへ送りました。");
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <main className="app-shell editor-page">
        <p className="loading-copy">メモを開いています。</p>
      </main>
    );
  }

  if (!memo) {
    return (
      <main className="app-shell editor-page">
        <section className="empty-state">
          <p>{error ?? "メモが見つかりません。"}</p>
          {error ? (
            <button type="button" className="secondary-button" onClick={() => void reload()}>
              もう一度読み込む
            </button>
          ) : null}
          <Link to="/" className="primary-button">
            メモ一覧へ戻る
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app-shell editor-page ${
        compactEntryView ? "editor-page--compact" : ""
      } ${isSeisho ? "editor-page--seisho" : ""}`}
    >
      <header className="editor-header editor-header--shitate">
        <Link to="/" className="back-link" aria-label="メモ一覧へ戻る" title="メモ一覧へ" onClick={e=>{e.preventDefault();void handleReturnToMemoList()}}><BackIcon /></Link>
        <div className="editor-header__title">
          <input ref={titleInputRef} className="memo-title-input" aria-label="メモのタイトル" value={title}
            onChange={e=>{latestTitleRef.current=e.target.value;setTitle(e.target.value)}}
            onKeyDown={e=>{
              // 変換確定のEnterは題の確定に使わない。フォーカスは同期で移し、iOSのキーボードを閉じさせない。
              if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229||e.key==='Process'||e.key!=='Enter')return;
              e.preventDefault();
              void saveTitle(title);
              activeDesk()?.focus({scroll:false,delay:0});
            }}
            onBlur={()=>void saveTitle(title)} />
          <MemoTagControl tag={memo.tag} suggestions={tagSuggestions} disabled={isSaving} onSave={handleSaveTag}/>
        </div>
        <span className="save-status" aria-live="polite" data-state={isSaving?"wet":"dry"}>{isSaving?'保存中…':'保存済み'}</span>
        <button type="button" className="editor-header__seisho" aria-label="清書にする" onClick={()=>toggleSeisho(!isSeisho)}>清書</button>
        <button type="button" className="editor-header__margin" aria-label="余白を開く" onClick={()=>window.dispatchEvent(new Event('kakidas:open-margin'))}>余白</button>
        <MemoActionsMenu cloudEnabled={Boolean(user)}
          attention={memo.sync_meta?.cloud_state==='conflict'?'クラウドとの差分があります':null}
          sortMode={entrySortMode} onSort={setEntrySortMode}
          onCloudSave={openUpload} onCloudSync={()=>void handleCloudSync()}
          onChat={handleChat} onCopy={()=>void handleCopyMemo()} onDownload={handleDownload}
          onShortcuts={()=>window.dispatchEvent(new Event('kakidas:show-shortcuts'))}
          onDeleteCompleted={()=>void handleDeleteCompleted()} onDeleteMemo={()=>void handleDeleteMemo()}
          options={[
            {label:'項目の日時を表示',value:showEntryTimestamps,onChange:setShowEntryTimestamps},
            {label:'段落・参考URLに番号を表示',value:showEntryNumbers,onChange:setShowEntryNumbers},
            {label:'本文だけ表示',value:compactEntryView,onChange:setCompactEntryView},
            {label:'段落・参考URLの完了を非表示',value:hideCompletedEntries,onChange:setHideCompletedEntries},
            {label:'参考URLを下に足す',value:addEntriesAtBottom,onChange:setAddEntriesAtBottom},
            {label:'コピーに完了を含める',value:includeCompletedInCopy,onChange:setIncludeCompletedInCopy},
          ]}/>
      </header>

      <NoticeToast
        key={notice?.id}
        message={notice?.message ?? null}
        onDismiss={() => setNotice(null)}
      />


      {isSeisho ? (
        <SeishoView memo={memo} title={title} sortMode={entrySortMode} includeCompleted={includeCompletedInCopy}
          paperRef={paperRef} onBack={()=>toggleSeisho(false)} onCopy={copySeisho} onPrint={()=>window.print()}/>
      ) : <>
      <div className="editor-tabs" role="tablist" aria-label="入力する粒度">
        {WORKSPACE_KINDS.map((kind) => (
          <button
            key={`${memo.id}:${kind}`}
            type="button"
            role="tab"
            aria-selected={activeKind === kind}
            aria-label={`${ENTRY_KIND_LABEL[kind]}、未完了${openEntryCountsByKind[kind]}件`}
            className={
              activeKind === kind
                ? "editor-tab editor-tab--active"
                : "editor-tab"
            }
            onClick={() => setActiveKind(kind)}
          >
            <span>{ENTRY_KIND_LABEL[kind]}</span>
            <span
              key={bumped?.kind === kind ? bumped.at : "idle"}
              className={bumped?.kind === kind ? "editor-tab__count bump" : "editor-tab__count"}
              aria-hidden="true"
            >
              {openEntryCountsByKind[kind]}
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}

      {isMobile ? <DeskSlot active host={deskHosts[activeKind]} label="書き口" onActivate={()=>undefined} className="editor-mobile-desk" /> : null}
      <div className="editor-receipt-anchor">
        {receipt ? <div className="editor-receipt" role="status" key={receipt.at}>
          <span>{receipt.text}</span>
          <button type="button" onClick={() => {
            const { kind, targetId } = receipt;
            setActiveKind(kind);
            setReceipt(null);
            if (targetId) window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
              document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(targetId)}"]`)
                ?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            }));
          }}>
            {ENTRY_KIND_LABEL[receipt.kind]}を見る
          </button>
        </div> : null}
      </div>

      <section
        className="editor-grid"
        aria-label="書き出しスペース"
        style={editorGridStyle}
      >
        {WORKSPACE_KINDS.map((kind) => (
          <EntryColumn
            key={kind}
            memoId={memo.id}
            memoUpdatedAt={memo.updated_at}
            kind={kind}
            entries={entriesByKind[kind]}
            isActiveOnMobile={activeKind === kind}
            isCollapsed={effectiveCollapsed[kind]}
            canCollapse={openEntryColumnCount > 1}
            onToggleCollapsed={() => toggleEntryColumnCollapsed(kind)}
            showCreatedAt={showEntryTimestamps}
            showEntryNumbers={showEntryNumbers}
            outlineNumbered={outlineNumbered}
            onOutlineNumberedChange={setOutlineNumbered}
            compactView={compactEntryView}
            tagSuggestions={entryTagSuggestions}
            disabled={isUploading}
            addAtBottom={addEntriesAtBottom}
            deskNode={isMobile?undefined:(
              <DeskSlot active host={deskHosts[kind]}
                label={DESK_OPEN_LABEL[kind]} text={DESK_OPEN_TEXT[kind]}
                onActivate={()=>moveDeskTo(kind)} />
            )}
            outlineRef={kind==='sentence'?outlineRef:undefined}
             showCompletedOutline={showCompletedOutline}
             completedOutlineCount={completedOutlineCount}
             onToggleShowCompletedOutline={() => setShowCompletedOutline((current) => !current)}
            ghostOn={isMobile&&kind==='sentence'&&draftsByKind.sentence}
            onCaretDescribed={kind==='sentence'?setCaretDescription:undefined}
            onRowSelected={()=>undefined}
            onFocusDesk={()=>moveDeskTo('sentence')}
            paragraphAfterId={paragraphAfterId}
            onSelectParagraph={setParagraphAfterId}
            manualOrder={entrySortMode==='manual'}
            bindings={bindings}
            rowNumberById={rowNumberById}
            lensIds={lensIds}
            onGrowRow={growRow}
            onJumpToRow={jumpToRow}
            onPullToOutline={pullToOutline}
            citationRowIds={citationRowIds}
            onJumpToCitation={jumpToCitation}
            routeToWord={false}
            onCreate={createEntry}
            onUpdate={(entryId, patch) => updateEntry(entryId, patch)}
            onDelete={deleteEntry}
            onRestore={restoreEntries}
            onDeleteAll={deleteEntriesByKind}
            copyableEntryCount={copyableEntryCountsByKind[kind]}
            copyIncludesCompleted={includeCompletedInCopy}
            onCopy={handleCopyKind}
            onCopyEntry={handleCopyEntry}
            onCreateMemoFromEntry={handleCreateMemoFromEntry}
            isCopying={copyingKind === kind}
            onRenameTag={(currentTag, nextTag) =>
              renameEntryTag(kind, currentTag, nextTag)
            }
            onMoveToKind={handleMoveEntryToKind}
            onRelocateOutline={relocateOutlineEntry}
          />
        ))}
      </section>

      </>}

      {WORKSPACE_KINDS.map((kind) => createPortal(
        <EntryComposer key={`${memo.id}:${kind}`}
          ref={(instance) => { deskRefs.current[kind] = instance; }}
          variant="desk" kind={kind} slot={kind} memoId={memo.id}
          memoUpdatedAt={memo.updated_at} tagSuggestions={entryTagSuggestions}
          disabled={isUploading}
          existingReferenceUrls={memo.entries.filter(e=>e.kind==='word'&&e.link_url).map(e=>e.link_url)}
          onSubmit={handleDeskCreate} onPlaced={handlePlaced}
          onConvertToParagraph={kind === 'sentence' ? () => {void convertSentenceDraftToParagraph();} : undefined}
          onWritingFocus={() => { if(!isMobile) setDeskSlot(kind); }}
          onCaretIndent={kind === 'sentence' ? () => outlineRef.current?.indentCaret() : undefined}
          onCaretOutdent={kind === 'sentence' ? () => outlineRef.current?.outdentCaret() : undefined}
          onExitUp={kind === 'sentence' ? () => {releaseDeskFocus();outlineRef.current?.focusRowAboveCaret();} : undefined}
          onExitDown={kind === 'sentence' ? () => {releaseDeskFocus();outlineRef.current?.focusRowBelowCaret();} : undefined}
          onExit={()=>{releaseDeskFocus();(document.activeElement as HTMLElement|null)?.blur?.();}}
          showDepthButtons={isMobile&&kind==='sentence'}
          caretDescription={kind === 'sentence' ? caretDescription : undefined}
          onDraftChange={(hasDraft) => setDraftsByKind((current) =>
            current[kind] === hasDraft ? current : { ...current, [kind]: hasDraft })}/>,
        deskHosts[kind],
        kind,
      ))}

      <CloudAccountDialog
        open={isCloudDialogOpen}
        onClose={() => setIsCloudDialogOpen(false)}
        onImported={({ title, wasCopy }) =>
          setNotice(
            wasCopy
              ? `「${title}」をクラウド版として複製しました。`
              : `「${title}」をこの端末へ取り込みました。`,
          )
        }
        onCloudDeleted={async ({ title }) => {
          await reload();
          setNotice(`「${title}」をクラウドから削除しました。端末のメモは残っています。`);
        }}
      />
      <CloudUploadDialog
        open={isUploadDialogOpen}
        targets={cloudUploadTarget}
        isSubmitting={isUploading}
        onClose={() => setIsUploadDialogOpen(false)}
        onConfirm={handleUploadConfirm}
      />
    </main>
  );
}
