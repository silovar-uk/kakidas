import {SeishoView} from "../components/SeishoView";
import {withViewTransition} from "../lib/viewTransition";
import {EntryComposer,type EntryComposerHandle} from "../components/EntryComposer";
import {MemoActionsMenu} from "../components/MemoActionsMenu";
import {fetchReferenceTitle} from "../lib/referenceTitle";
import {useCloudMemos} from "../hooks/useCloudMemos";
import {type MemoSyncMetaRow,getLinkHostname} from "../types/memo";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  formatDefaultMemoTitle,
  getEntryTree,
} from "../types/memo";

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
    : "word";
}

const ENTRY_TIMESTAMP_VISIBILITY_STORAGE_KEY = "kakidas.show-entry-timestamps";
const ENTRY_NUMBER_VISIBILITY_STORAGE_KEY = "kakidas.show-entry-numbers";
const HIDE_COMPLETED_ENTRIES_STORAGE_KEY = "kakidas.hide-completed-entries";
const ADD_ENTRIES_AT_BOTTOM_STORAGE_KEY = "kakidas.add-entries-at-bottom";
const COMPACT_ENTRY_VIEW_STORAGE_KEY = "kakidas.compact-entry-view";
const COLLAPSED_ENTRY_COLUMNS_STORAGE_KEY = "kakidas.collapsed-entry-columns.v1";

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
    return window.localStorage.getItem(ENTRY_TIMESTAMP_VISIBILITY_STORAGE_KEY) !== "false";
  } catch {
    // ストレージが使えないブラウザでも、従来どおり日時を表示する。
    return true;
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

/** 完了済みは初期状態では見せる。必要な端末だけ非表示を記憶する。 */
function readHideCompletedEntries(): boolean {
  try {
    return window.localStorage.getItem(HIDE_COMPLETED_ENTRIES_STORAGE_KEY) === "true";
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
    createMemoFromEntry,
    deleteMemo,
  } = useMemoDetail(memoId);

  const [title, setTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  // 画面を離れる直前にも、最新の入力値を判断できるようにする。
  const latestTitleRef = useRef(title);
  const latestMemoRef = useRef<MemoWithEntries | null>(memo);
  const isLeavingEditorRef = useRef(false);
  const [tagSuggestions, setTagSuggestions] = useState<MemoTagSummary[]>([]);
  const [activeKind, setActiveKind] = useState<EntryKind>(
    () => getNavigationKind(initialNavigationState),
  );
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
  const deskRef = useRef<EntryComposerHandle>(null);
  const {prepareImport,importSnapshot}=useCloudMemos(user?.id ?? null);
  const [showEntryTimestamps, setShowEntryTimestamps] = useState(
    readEntryTimestampVisibility,
  );
  const [showEntryNumbers, setShowEntryNumbers] = useState(
    readEntryNumberVisibility,
  );
  const [hideCompletedEntries, setHideCompletedEntries] = useState(
    readHideCompletedEntries,
  );
  const [addEntriesAtBottom, setAddEntriesAtBottom] = useState(
    readAddEntriesAtBottom,
  );
  const [compactEntryView, setCompactEntryView] = useState(
    readCompactEntryView,
  );
  const [collapsedEntryColumns, setCollapsedEntryColumns] = useState<CollapsedEntryColumns>(
    readCollapsedEntryColumns,
  );
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

  const toggleEntryColumnCollapsed = useCallback((targetKind: EntryKind) => {
    setCollapsedEntryColumns((current) => {
      const openCount = ENTRY_KINDS.filter((kind) => !current[kind]).length;

      // 最後の1列だけは閉じない。復帰先がない空画面を作らない。
      if (!current[targetKind] && openCount <= 1) {
        return current;
      }

      return {
        ...current,
        [targetKind]: !current[targetKind],
      };
    });
  }, []);

  const openEntryColumnCount = ENTRY_KINDS.filter((kind) => !collapsedEntryColumns[kind]).length;

  const editorGridStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: ENTRY_KINDS
        .map((kind) =>
          collapsedEntryColumns[kind] ? "44px" : "minmax(0, 1fr)"
        )
        .join(" "),
    }),
    [collapsedEntryColumns],
  );

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

  const entriesByKind = useMemo(() => {
    const allEntries = memo?.entries ?? [];
    // 完了を隠すときは、完了項目を木の計算前に除外する。
    // そのため未完了の下位項目は、見えない親の下にぶら下がらず安全に表示される。
    const entries = hideCompletedEntries
      ? allEntries.filter((entry) => !entry.is_completed)
      : allEntries;

    return {
      word: getEntryTree(entries, "word", entrySortMode),
      sentence: getEntryTree(entries, "sentence", entrySortMode),
      paragraph: getEntryTree(entries, "paragraph", entrySortMode),
    };
  }, [entrySortMode, hideCompletedEntries, memo?.entries]);

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
      deskRef.current?.focus({scroll:false,delay:0});
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
      includeEntryNumbers:showEntryNumbers,excludeCompleted:!includeCompletedInCopy,entrySortMode});
    const url=new URL('https://chatgpt.com/');url.searchParams.set('prompt',prompt);
    tab.location.replace(url.toString());
  };
  const handleDeskCreate=async(content:string,metadata:import('../types/memo').EntryCreateMetadata,draftId:string,kind:EntryKind='sentence',entryId?:string)=>{
    const created=await createEntry(kind,content,metadata,null,addEntriesAtBottom?'bottom':'top',draftId,entryId);
    // 保存成功直後にスマホの棚を切り替える。演出の完了は待たない。
    if (window.matchMedia("(max-width: 920px)").matches) setActiveKind(kind);
    if(kind==='word'&&metadata.link_url){
      void fetchReferenceTitle(metadata.link_url).then(result=>{
        if(result)return updateEntry(created.id,{content:result});
      }).catch(()=>{});
    }
    return created;
  };

  const toggleSeisho=(next:boolean)=>{
    void withViewTransition(()=>{
      setSearchParams(previous=>{
        const params=new URLSearchParams(previous);
        if(next)params.set('view','seisho');else params.delete('view');
        return params;
      },{replace:false});
    });
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
      }`}
    >
      <header className="editor-header editor-header--shitate">
        <Link to="/" className="back-link" onClick={e=>{e.preventDefault();void handleReturnToMemoList()}}>戻る</Link>
        <div className="editor-header__title">
          <input ref={titleInputRef} className="memo-title-input" aria-label="メモのタイトル" value={title}
            onChange={e=>{latestTitleRef.current=e.target.value;setTitle(e.target.value)}}
            onBlur={()=>void saveTitle(title)} />
          <MemoTagControl tag={memo.tag} suggestions={tagSuggestions} disabled={isSaving} onSave={handleSaveTag}/>
        </div>
        <span className="save-status" aria-live="polite">{isSaving?'保存中…':'保存済み'}</span>
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
            {label:'番号を表示',value:showEntryNumbers,onChange:setShowEntryNumbers},
            {label:'本文だけ表示',value:compactEntryView,onChange:setCompactEntryView},
            {label:'完了を非表示',value:hideCompletedEntries,onChange:setHideCompletedEntries},
            {label:'新しい項目を一番下に追加',value:addEntriesAtBottom,onChange:setAddEntriesAtBottom},
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
        {ENTRY_KINDS.map((kind) => (
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
            <span className="editor-tab__count" aria-hidden="true">
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

      <EntryComposer ref={deskRef} variant="desk" kind="sentence" memoId={memo.id}
        memoUpdatedAt={memo.updated_at} tagSuggestions={entryTagSuggestions}
        mobileKind={activeKind} disabled={isUploading}
        existingReferenceUrls={memo.entries.filter(e=>e.kind==='word'&&e.link_url).map(e=>e.link_url)}
        onSubmit={handleDeskCreate} onPlaced={setActiveKind}/>

      <section
        className="editor-grid"
        aria-label="書き出しスペース"
        style={editorGridStyle}
      >
        {ENTRY_KINDS.map((kind) => (
          <EntryColumn
            key={kind}
            memoId={memo.id}
            memoUpdatedAt={memo.updated_at}
            kind={kind}
            entries={entriesByKind[kind]}
            isActiveOnMobile={activeKind === kind}
            isCollapsed={collapsedEntryColumns[kind]}
            canCollapse={openEntryColumnCount > 1}
            onToggleCollapsed={() => toggleEntryColumnCollapsed(kind)}
            showCreatedAt={showEntryTimestamps}
            showEntryNumbers={showEntryNumbers}
            compactView={compactEntryView}
            tagSuggestions={entryTagSuggestions}
            disabled={isUploading}
            addAtBottom={addEntriesAtBottom}
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
          />
        ))}
      </section>

      </>}

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
