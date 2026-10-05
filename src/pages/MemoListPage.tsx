import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { copyToClipboard } from "../lib/clipboard";
import {
  readCopyIncludeCompleted,
  readEntrySortMode,
  writeCopyIncludeCompleted,
} from "../lib/copyPreferences";
import { formatMemoText } from "../lib/memoText";
import { readMemoSortMode, writeMemoSortMode } from "../lib/memoListPreferences";
import { getMemoTagSummaries } from "../lib/memoTags";
import { CloudAccountDialog } from "../components/CloudAccountDialog";
import { CloudImportDialog } from "../components/CloudImportDialog";
import {
  CloudUploadDialog,
  type CloudUploadTarget,
} from "../components/CloudUploadDialog";
import { MemoDeleteDialog } from "../components/MemoDeleteDialog";
import { MemoCardMenu } from "../components/MemoCardMenu";
import { NoticeToast } from "../components/NoticeToast";
import { useCloudMemos } from "../hooks/useCloudMemos";
import { useMemos } from "../hooks/useMemos";
import {
  refreshCloudSyncStates,
  uploadMemosToCloud,
} from "../repositories/cloudMemoRepository";
import { memoRepository } from "../repositories/memoRepository";
import {
  type BackupPayload,
  type CloudState,
  type EntryKind,
  type MemoCloudSnapshot,
  type MemoListItem,
  type MemoSortMode,
  type MemoWithEntries,
  ENTRY_KINDS,
  MEMO_SORT_MODE_LABEL,
  MEMO_SORT_MODES,
  formatUpdatedAt,
  getMemoTagKey,
} from "../types/memo";

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

type CloudAction = {
  label: string;
  kind: "upload" | "update" | "clone";
};

function getCloudAction(state: CloudState): CloudAction | null {
  switch (state) {
    case "local_only":
    case "changed_after_upload":
    case "error":
      return { label: "クラウドへ送る", kind: "upload" };
    case "remote_newer":
      return { label: "更新を取り込む", kind: "update" };
    case "conflict":
      return { label: "複製で取り込む", kind: "clone" };
    case "uploaded":
      return null;
  }
}

type MemoPreviewFragment = {
  kind: EntryKind;
  content: string;
};

const MEMO_PREVIEW_MAX_LENGTH: Record<EntryKind, number> = {
  word: 36,
  sentence: 64,
  paragraph: 92,
};

function toMemoPreviewText(content: string, maxLength: number): string {
  const oneLine = content.replace(/\s+/g, " ").trim();

  if (oneLine.length <= maxLength) return oneLine;

  return `${oneLine.slice(0, Math.max(1, maxLength - 1))}…`;
}

/**
 * 一覧では本文を開く前の「思い出すきっかけ」だけを見せる。
 * 未完了の内容を優先し、未完了がないメモでは完了済みを代わりに使う。
 */
function getMemoPreviewFragments(memo: MemoWithEntries): MemoPreviewFragment[] {
  const availableEntries = memo.entries.filter((entry) => entry.content.trim());
  const sourceEntries = availableEntries.some((entry) => !entry.is_completed)
    ? availableEntries.filter((entry) => !entry.is_completed)
    : availableEntries;

  const priority: EntryKind[] = ["paragraph", "sentence", "word"];

  for (const kind of priority) {
    const latestEntry = sourceEntries
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

    if (!latestEntry) continue;

    return [{
      kind,
      content: toMemoPreviewText(
        latestEntry.content,
        MEMO_PREVIEW_MAX_LENGTH[kind],
      ),
    }];
  }

  return [];
}

type MemoListViewMode = "all" | "tags";

const MEMO_LIST_VIEW_STORAGE_KEY = "kakidas.memo-list-view";
const MEMO_LIST_COLLAPSED_TAGS_STORAGE_KEY = "kakidas.memo-list-collapsed-tags";

function readMemoListViewMode(): MemoListViewMode {
  try {
    return window.localStorage.getItem(MEMO_LIST_VIEW_STORAGE_KEY) === "tags"
      ? "tags"
      : "all";
  } catch {
    return "all";
  }
}

function writeMemoListViewMode(mode: MemoListViewMode): void {
  try {
    window.localStorage.setItem(MEMO_LIST_VIEW_STORAGE_KEY, mode);
  } catch {
    // 表示設定を保存できない環境でも、その場の切り替えは続ける。
  }
}

function readCollapsedMemoTagKeys(): Set<string> {
  try {
    const stored = window.localStorage.getItem(MEMO_LIST_COLLAPSED_TAGS_STORAGE_KEY);
    if (!stored) return new Set();

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsedMemoTagKeys(keys: Set<string>): void {
  try {
    window.localStorage.setItem(
      MEMO_LIST_COLLAPSED_TAGS_STORAGE_KEY,
      JSON.stringify([...keys]),
    );
  } catch {
    // 折りたたみ状態を保存できなくても、現在の表示は維持する。
  }
}

export function MemoListPage()}

export function MemoListPage() {
  const navigate = useNavigate();

  // 一覧へ戻った時は、ブラウザタブ名もアプリ名へ戻す。
  useEffect(() => {
    document.title = "kakidas";
  }, []);
  const importInputRef = useRef<HTMLInputElement | null>(null);
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
  const [isCreating, setIsCreating] = useState(false);
  const [isCloudDialogOpen, setIsCloudDialogOpen] = useState(false);
  const [isUploadMode, setIsUploadMode] = useState(false);
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(new Set());
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplyingCloudUpdate, setIsApplyingCloudUpdate] = useState(false);
  const [copyingMemoId, setCopyingMemoId] = useState<string | null>(null);
  const [memoPendingDeletion, setMemoPendingDeletion] =
    useState<MemoListItem | null>(null);
  const [isDeletingMemo, setIsDeletingMemo] = useState(false);
  /** 区分コピーと共通の、端末ごとの出力設定。初期値は完了を除外。 */
  const [includeCompletedInCopy, setIncludeCompletedInCopy] = useState(
    readCopyIncludeCompleted,
  );
  /** 一覧の並び順は端末ごとの表示設定。メモ本体の日時は変えない。 */
  const [memoSortMode, setMemoSortMode] = useState<MemoSortMode>(
    readMemoSortMode,
  );
  const [viewMode, setViewMode] = useState<MemoListViewMode>(
    readMemoListViewMode,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedTagKeys, setCollapsedTagKeys] = useState<Set<string>>(
    readCollapsedMemoTagKeys,
  );
  // 一覧表示の間に本文を温めておく。スマホでも、コピーのタップ操作中に
  // Clipboard API を呼べるため、Safariの「The request is not allowed」を避けやすい。
  const memoCopyCacheRef = useRef<Map<string, MemoWithEntries>>(new Map());
  const [memoPreviews, setMemoPreviews] = useState<
    Map<string, MemoPreviewFragment[]>
  >(() => new Map());
  const [memoSearchTexts, setMemoSearchTexts] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [conflictSnapshot, setConflictSnapshot] =
    useState<MemoCloudSnapshot | null>(null);

  const { isConfigured, isLoading: isAuthLoading, user } = useAuth();

  const {
    memos,
    isLoading,
    error,
    refresh,
    createMemo,
    updateMemo,
    deleteMemo,
    exportBackup,
    importBackup,
  } = useMemos();

  const {
    isImporting,
    prepareImport,
    importSnapshot,
  } = useCloudMemos(user?.id ?? null);

  useEffect(() => {
    writeCopyIncludeCompleted(includeCompletedInCopy);
  }, [includeCompletedInCopy]);

  useEffect(() => {
    writeMemoSortMode(memoSortMode);
  }, [memoSortMode]);

  useEffect(() => {
    writeMemoListViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    writeCollapsedMemoTagKeys(collapsedTagKeys);
  }, [collapsedTagKeys]);

  const toMemoSearchText = (detail: MemoWithEntries): string =>
    [
      detail.title,
      detail.tag ?? "",
      ...detail.entries.flatMap((entry) => [
        entry.heading,
        entry.content,
        entry.tag ?? "",
        entry.note,
        entry.link_url,
      ]),
    ]
      .join("\n")
      .toLocaleLowerCase("ja-JP");

  const cacheMemoDetail = (memoId: string, detail: MemoWithEntries) => {
    memoCopyCacheRef.current.set(memoId, detail);

    setMemoPreviews((current) => {
      const next = new Map(current);
      next.set(memoId, getMemoPreviewFragments(detail));
      return next;
    });

    setMemoSearchTexts((current) => {
      const next = new Map(current);
      next.set(memoId, toMemoSearchText(detail));
      return next;
    });
  };

  const primeMemoCopy = (memoId: string) => {
    if (memoCopyCacheRef.current.has(memoId)) return;

    void memoRepository
      .getMemo(memoId)
      .then((detail) => {
        if (detail) cacheMemoDetail(memoId, detail);
      })
      .catch(() => {
        // コピー時に改めて取得して、通常のエラー表示へ任せる。
      });
  };

  // 先読み済みの内容があれば、スマホのコピー操作で非同期処理をまたがない。
  // 一覧が更新されたらキャッシュも作り直し、古い本文をコピーしない。
  useEffect(() => {
    let cancelled = false;
    const cache = memoCopyCacheRef.current;
    cache.clear();
    setMemoPreviews(new Map());
    setMemoSearchTexts(new Map());

    const warmCopyCache = async () => {
      const details = await Promise.all(
        memos.map(async (memo) => ({
          id: memo.id,
          detail: await memoRepository.getMemo(memo.id),
        })),
      );

      if (cancelled) return;

      const nextPreviews = new Map<string, MemoPreviewFragment[]>();
      const nextSearchTexts = new Map<string, string>();

      for (const { id, detail } of details) {
        if (!detail) continue;

        cache.set(id, detail);
        nextPreviews.set(id, getMemoPreviewFragments(detail));
        nextSearchTexts.set(id, toMemoSearchText(detail));
      }

      setMemoPreviews(nextPreviews);
      setMemoSearchTexts(nextSearchTexts);
    };

    void warmCopyCache().catch(() => {
      // 先読み失敗時も、コピーを押した時の通常取得はできる。
    });

    return () => {
      cancelled = true;
    };
  }, [memos]);

  // ログイン済みなら、一覧を開いた時にだけクラウドの更新状態を照合する。
  // 入力中に自動通信はしない。
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const checkCloudStates = async () => {
      try {
        const result = await refreshCloudSyncStates(user.id);
        if (!cancelled && result.changed_memo_ids.length > 0) {
          await refresh();
        }
      } catch {
        // ネットワーク不調でもローカルメモは通常どおり使える。
      }
    };

    void checkCloudStates();

    return () => {
      cancelled = true;
    };
  }, [refresh, user]);

  const tagSummaries = useMemo(() => getMemoTagSummaries(memos), [memos]);

  const sortedMemos = useMemo(() => {
    return [...memos].sort((left, right) => {
      const primary = memoSortMode === "created_desc"
        ? right.created_at.localeCompare(left.created_at)
        : right.updated_at.localeCompare(left.updated_at);
      return primary || right.updated_at.localeCompare(left.updated_at);
    });
  }, [memoSortMode, memos]);

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("ja-JP");

  const visibleMemos = useMemo(() => {
    if (!normalizedSearchQuery) return sortedMemos;

    return sortedMemos.filter((memo) => {
      const fallback = `${memo.title}\n${memo.tag ?? ""}`
        .toLocaleLowerCase("ja-JP");
      const searchText = memoSearchTexts.get(memo.id) ?? fallback;
      return searchText.includes(normalizedSearchQuery);
    });
  }, [memoSearchTexts, normalizedSearchQuery, sortedMemos]);

  const tagGroups = useMemo(() => {
    const grouped = new Map<string, MemoListItem[]>();

    for (const memo of visibleMemos) {
      const key = getMemoTagKey(memo.tag) || "__untagged__";
      const current = grouped.get(key) ?? [];
      current.push(memo);
      grouped.set(key, current);
    }

    const groups = tagSummaries.flatMap((summary) => {
      const groupMemos = grouped.get(summary.key);
      return groupMemos?.length
        ? [{
            key: summary.key,
            label: summary.label,
            memos: groupMemos,
            isUntagged: false,
          }]
        : [];
    });

    const untagged = grouped.get("__untagged__");
    if (untagged?.length) {
      groups.push({
        key: "__untagged__",
        label: "未分類",
        memos: untagged,
        isUntagged: true,
      });
    }

    return groups;
  }, [tagSummaries, visibleMemos]);

  const toggleTagGroup = (key: string) => {
    setCollapsedTagKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectedTargets = useMemo<CloudUploadTarget[]>(  const selectedTargets = useMemo<CloudUploadTarget[]>(
    () =>
      memos
        .filter((memo) => selectedMemoIds.has(memo.id))
        .map((memo) => ({
          id: memo.id,
          title: memo.title,
          entry_counts: memo.entry_counts,
          sync_meta: memo.sync_meta,
        })),
    [memos, selectedMemoIds],
  );

  const handleCreate = async () => {
    if (isCreating) return;

    setIsCreating(true);
    setNotice(null);

    try {
      const memo = await createMemo();
      navigate(`/memos/${memo.id}`, {
        // この導線で作った空メモだけは、題名も項目も書かずに戻った時に破棄する。
        state: { focusTitle: true, discardUntitledEmptyDraft: true },
      });
    } catch (createError) {
      setNotice(
        createError instanceof Error
          ? createError.message
          : "新しいメモを作れませんでした。",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleExport = async () => {
    try {
      const backup = await exportBackup();
      const day = new Date().toISOString().slice(0, 10);

      downloadFile(
        `kakidas-backup-${day}.json`,
        JSON.stringify(backup, null, 2),
        "application/json",
      );

      setNotice("バックアップを書き出しました。");
    } catch (exportError) {
      setNotice(
        exportError instanceof Error
          ? exportError.message
          : "バックアップを書き出せませんでした。",
      );
    }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text) as BackupPayload;

      await importBackup(backup);

      setNotice("バックアップを読み込みました。");
    } catch (importError) {
      setNotice(
        importError instanceof Error
          ? importError.message
          : "バックアップを読み込めませんでした。",
      );
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  // iPhone Safariの標準confirmに依存せず、確認はアプリ内ダイアログで行う。
  // ×の寸法や配置は変えず、カードを開く操作から削除だけを明確に切り離す。
  const requestMemoDeletion = (memo: MemoListItem) => {
    if (isDeletingMemo) return;
    setNotice(null);
    setMemoPendingDeletion(memo);
  };

  const confirmMemoDeletion = async () => {
    const memo = memoPendingDeletion;
    if (!memo || isDeletingMemo) return;

    setIsDeletingMemo(true);

    try {
      await deleteMemo(memo.id);
      memoCopyCacheRef.current.delete(memo.id);
      setMemoPendingDeletion(null);
      setNotice("メモを削除しました。");
    } catch (deleteError) {
      // ダイアログの背後にだけエラーを出さず、閉じてから一覧の通知として伝える。
      setMemoPendingDeletion(null);
      setNotice(
        deleteError instanceof Error
          ? deleteError.message
          : "メモを削除できませんでした。",
      );
    } finally {
      setIsDeletingMemo(false);
    }
  };

  const handleSaveMemoTag = async (
    memo: MemoListItem,
    tag: string | null,
  ): Promise<void> => {
    try {
      await updateMemo(memo.id, { tag });
      setNotice(
        tag
          ? `「${memo.title}」にタグ「${tag}」を付けました。`
          : `「${memo.title}」のタグを外しました。`,
      );
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "タグを保存できませんでした。";
      setNotice(message);
      throw new Error(message);
    }
  };

  const handleCopyMemo = async (memo: MemoListItem) => {
    if (copyingMemoId) return;

    setCopyingMemoId(memo.id);
    setNotice(null);

    try {
      let detail = memoCopyCacheRef.current.get(memo.id) ?? null;
      const wasPrepared = detail !== null;

      if (!detail) {
        detail = await memoRepository.getMemo(memo.id);
        if (detail) cacheMemoDetail(memo.id, detail);
      }

      if (!detail) {
        throw new Error("コピーするメモが見つかりません。");
      }

      let includeEntryNumbers = false;
      try {
        includeEntryNumbers =
          window.localStorage.getItem("kakidas.show-entry-numbers") === "true";
      } catch {
        // ストレージに触れない環境では、番号なしで安全にコピーする。
      }

      const completedCount = detail.entries.filter(
        (entry) => entry.is_completed,
      ).length;

      await copyToClipboard(
        formatMemoText(detail, {
          includeEntryNumbers,
          excludeCompleted: !includeCompletedInCopy,
          entrySortMode: readEntrySortMode(),
        }),
        // 先読みが間に合わなかった初回タップでも、選択コピーを優先して
        // モバイルSafariのクリップボード権限制約を回避する。
        { preferSelectionFallback: !wasPrepared },
      );

      const completionNotice = includeCompletedInCopy && completedCount > 0
        ? `完了済み${completedCount}件も含めました。`
        : !includeCompletedInCopy && completedCount > 0
          ? `完了済み${completedCount}件は含めていません。`
          : "";

      setNotice(`「${memo.title}」をコピーしました。${completionNotice}`);
    } catch (copyError) {
      setNotice(
        copyError instanceof Error
          ? copyError.message
          : "メモをコピーできませんでした。",
      );
    } finally {
      setCopyingMemoId(null);
    }
  };

  const openUploadMode = () => {
    if (!isConfigured || !user) {
      setIsCloudDialogOpen(true);
      return;
    }

    setNotice(null);
    setSelectedMemoIds(new Set());
    setIsUploadMode(true);
  };

  const openSingleUpload = (memo: MemoListItem) => {
    if (!isConfigured || !user) {
      setIsCloudDialogOpen(true);
      return;
    }

    setNotice(null);
    setSelectedMemoIds(new Set([memo.id]));
    setIsUploadDialogOpen(true);
  };

  const cancelUploadMode = () => {
    setIsUploadMode(false);
    setSelectedMemoIds(new Set());
  };

  const toggleMemoSelection = (memoId: string) => {
    setSelectedMemoIds((current) => {
      const next = new Set(current);
      if (next.has(memoId)) {
        next.delete(memoId);
      } else {
        next.add(memoId);
      }
      return next;
    });
  };

  const handleUploadConfirm = async () => {
    if (!user) {
      throw new Error("クラウドへ送るにはログインが必要です。");
    }

    setIsUploading(true);

    try {
      await uploadMemosToCloud(
        selectedTargets.map((target) => target.id),
        user.id,
      );
      await refresh();

      setNotice(`${selectedTargets.length}件をクラウドへ送りました。`);
      setIsUploadDialogOpen(false);
      cancelUploadMode();
    } finally {
      setIsUploading(false);
    }
  };

  const prepareCloudSnapshot = async (memoId: string) => {
    if (!user) {
      setIsCloudDialogOpen(true);
      return null;
    }

    return prepareImport(memoId);
  };

  const handleRemoteUpdate = async (memo: MemoListItem) => {
    setNotice(null);
    setIsApplyingCloudUpdate(true);

    try {
      const candidate = await prepareCloudSnapshot(memo.id);
      if (!candidate) return;

      const result = await importSnapshot(
        candidate.snapshot,
        candidate.hasLocalMemo ? "replace" : "preserve",
      );

      await refresh();
      setNotice(`「${result.memo.title}」をクラウドの内容で更新しました。`);
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "クラウドの更新を取り込めませんでした。",
      );
    } finally {
      setIsApplyingCloudUpdate(false);
    }
  };

  const handleConflictImport = async (memo: MemoListItem) => {
    setNotice(null);

    try {
      const candidate = await prepareCloudSnapshot(memo.id);
      if (!candidate) return;

      if (!candidate.hasLocalMemo) {
        const result = await importSnapshot(candidate.snapshot, "preserve");
        await refresh();
        setNotice(`「${result.memo.title}」をこの端末へ取り込みました。`);
        return;
      }

      setConflictSnapshot(candidate.snapshot);
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "クラウド版を確認できませんでした。",
      );
    }
  };

  const handleImportConflictCopy = async () => {
    if (!conflictSnapshot) return;

    const result = await importSnapshot(conflictSnapshot, "clone");
    setConflictSnapshot(null);
    await refresh();
    setNotice(`「${result.memo.title}」をクラウド版として複製しました。`);
  };

  const handleCloudAction = (memo: MemoListItem) => {
    const action = getCloudAction(memo.sync_meta.cloud_state);
    if (!action) return;

    if (action.kind === "upload") {
      openSingleUpload(memo);
      return;
    }

    if (action.kind === "update") {
      void handleRemoteUpdate(memo);
      return;
    }

    void handleConflictImport(memo);
  };

  const cloudButtonLabel = isAuthLoading ? "クラウド…" : "クラウド";
  const isCloudActionBusy = isImporting || isApplyingCloudUpdate || isUploading;

  const renderMemoCard = (memo: MemoListItem) => {
    const selected = selectedMemoIds.has(memo.id);
    const cloudAction = getCloudAction(memo.sync_meta.cloud_state);
    const preview = (memoPreviews.get(memo.id) ?? [])[0] ?? null;

    return (
      <li
        key={memo.id}
        className={`memo-card ${selected ? "memo-card--selected" : ""}`}
      >
        {isUploadMode ? (
          <button
            type="button"
            className="memo-card__select"
            aria-pressed={selected}
            onClick={() => toggleMemoSelection(memo.id)}
          >
            <span className="memo-card__checkbox" aria-hidden="true">
              {selected ? "✓" : ""}
            </span>
            <span className="memo-card__details">
              <strong>{memo.title}</strong>
              {memo.tag ? <span className="memo-card__tag">#{memo.tag}</span> : null}
              <span>
                単語 {memo.entry_counts.word}件 ／ 文 {memo.entry_counts.sentence}件 ／ 段落 {memo.entry_counts.paragraph}件
              </span>
            </span>
          </button>
        ) : (
          <div className="memo-card__content">
            <Link to={`/memos/${memo.id}`} className="memo-card__link">
              <strong>{memo.title}</strong>
              {preview ? (
                <span
                  className="memo-card__preview"
                  aria-label={`${memo.title}の入力内容の抜粋`}
                >
                  <span className="memo-card__preview-content">
                    {preview.content}
                  </span>
                </span>
              ) : null}
              <span className="memo-card__meta">
                {memo.tag ? (
                  <>
                    <span className="memo-card__tag-text">#{memo.tag}</span>
                    <span className="memo-card__tag-separator" aria-hidden="true">·</span>
                  </>
                ) : null}
                <span>{formatUpdatedAt(memo.updated_at)}</span>
              </span>
            </Link>
          </div>
        )}

        {isUploadMode ? (
          <Link
            to={`/memos/${memo.id}`}
            className="memo-card__open-link"
            aria-label={`${memo.title}を開く`}
          >
            開く
          </Link>
        ) : (
          <div className="memo-card__actions">
            <MemoCardMenu
              memoTitle={memo.title}
              tag={memo.tag}
              suggestions={tagSummaries}
              cloudAction={cloudAction}
              isCloudActionBusy={isCloudActionBusy}
              isCopying={copyingMemoId === memo.id}
              copyDisabled={copyingMemoId !== null}
              includeCompletedInCopy={includeCompletedInCopy}
              onPrimeCopy={() => primeMemoCopy(memo.id)}
              onCopy={() => handleCopyMemo(memo)}
              onTagSave={(tag) => handleSaveMemoTag(memo, tag)}
              onCloudAction={() => handleCloudAction(memo)}
              onDelete={() => requestMemoDeletion(memo)}
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <main className="app-shell memo-list-page">
      <header className="app-header">
        <Link to="/" className="brand" aria-label="メモ一覧へ">
          <img
            className="brand__icon"
            src="/android-chrome-192x192.png"
            alt=""
            width="28"
            height="28"
          />
          <span>kakidas</span>
        </Link>

        <div className="app-header__right">
          <button
            type="button"
            className={`cloud-account-button ${user ? "cloud-account-button--signed-in" : ""}`}
            onClick={() => setIsCloudDialogOpen(true)}
          >
            <span aria-hidden="true">☁</span>
            {cloudButtonLabel}
          </button>
        </div>
      </header>

      <section className="memo-list-hero" aria-labelledby="memo-list-title">
        <h1 id="memo-list-title">メモ</h1>

        <button
          type="button"
          className="primary-button"
          onClick={() => void handleCreate()}
          disabled={isCreating}
        >
          {isCreating ? "作成中…" : "＋ 新しいメモ"}
        </button>
      </section>

      {isUploadMode ? (
        <section className="cloud-selection-toolbar" aria-label="クラウドへ送るメモを選択">
          <div>
            <strong>送るメモを選ぶ</strong>
            <p>選んだものだけを送ります。ローカルのメモは残ります。</p>
          </div>
          <div className="cloud-selection-toolbar__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={cancelUploadMode}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={selectedTargets.length === 0}
              onClick={() => setIsUploadDialogOpen(true)}
            >
              {selectedTargets.length}件を確認
            </button>
          </div>
        </section>
      ) : (
        <section className="memo-list-toolbar memo-list-toolbar--quiet" aria-label="メモを探す・表示する">
          <div className="memo-list-toolbar__primary">
            <div className="memo-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="タイトル・内容・タグを検索"
                aria-label="メモを検索"
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="memo-search__clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="検索をクリア"
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="memo-view-switch" role="group" aria-label="メモの表示">
              <button
                type="button"
                aria-pressed={viewMode === "all"}
                onClick={() => setViewMode("all")}
              >
                すべて
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "tags"}
                onClick={() => setViewMode("tags")}
              >
                タグ別
              </button>
            </div>

            <details className="memo-tools-menu">
              <summary className="memo-tools-menu__trigger" aria-label="一覧のツールを開く" title="ツール・設定">
                <span aria-hidden="true">•••</span>
              </summary>
              <div className="memo-tools-menu__panel">
                <span className="memo-tools-menu__heading">表示・整理</span>
                <label className="memo-tools-menu__sort">
                  <span>並び順</span>
                  <select
                    value={memoSortMode}
                    onChange={(event) =>
                      setMemoSortMode(event.target.value as MemoSortMode)
                    }
                    aria-label="メモの並び順"
                  >
                    {MEMO_SORT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {MEMO_SORT_MODE_LABEL[mode]}
                      </option>
                    ))}
                  </select>
                </label>

                <Link to="/tags" className="memo-tools-menu__item">
                  <span aria-hidden="true">#</span>
                  <span>タグを整理</span>
                </Link>

                <div className="memo-tools-menu__divider" />

                <button
                  type="button"
                  className="memo-tools-menu__item"
                  onClick={openUploadMode}
                >
                  <span aria-hidden="true">☁</span>
                  <span>クラウドへ送る</span>
                </button>
                <button
                  type="button"
                  className="memo-tools-menu__item"
                  onClick={() => void handleExport()}
                >
                  <span aria-hidden="true">↓</span>
                  <span>JSONを書き出す</span>
                </button>
                <button
                  type="button"
                  className="memo-tools-menu__item"
                  onClick={() => importInputRef.current?.click()}
                >
                  <span aria-hidden="true">↑</span>
                  <span>JSONを読み込む</span>
                </button>
                <input
                  ref={importInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void handleImport(event.target.files?.[0])}
                />

                <div className="memo-tools-menu__divider" />

                <label className="memo-tools-menu__toggle">
                  <input
                    type="checkbox"
                    checked={includeCompletedInCopy}
                    onChange={(event) => setIncludeCompletedInCopy(event.target.checked)}
                  />
                  <span>コピーに完了済みを含める</span>
                </label>
              </div>
            </details>
          </div>

          <div className="memo-list-toolbar__status">
            <strong>
              {normalizedSearchQuery
                ? `${visibleMemos.length} / ${memos.length}件`
                : `${memos.length}件`}
            </strong>
            {normalizedSearchQuery ? (
              <button type="button" onClick={() => setSearchQuery("")}>
                検索を解除
              </button>
            ) : (
              <span>{viewMode === "tags" ? `${tagGroups.length}グループ` : "更新順で表示"}</span>
            )}
          </div>
        </section>
      )}

      <NoticeToast
        key={notice?.id}
        message={notice?.message ?? null}
        onDismiss={() => setNotice(null)}
      />

      {error ? (
        <div className="load-error" role="alert">
          <p className="error-message">{error}</p>
          <button type="button" className="secondary-button" onClick={() => void refresh()}>
            もう一度読み込む
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <p className="loading-copy">メモを読み込んでいます。</p>
      ) : memos.length === 0 ? (
        <section className="empty-state">
          <p>まだメモがありません。</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleCreate()}
          >
            ＋ 新しいメモ
          </button>
        </section>
      ) : visibleMemos.length === 0 ? (
        <section className="empty-state empty-state--filtered">
          <p>検索に一致するメモがありません。</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSearchQuery("")}
          >
            検索を解除
          </button>
        </section>
      ) : isUploadMode ? (
        <ul className="memo-list memo-list--selecting">
          {sortedMemos.map(renderMemoCard)}
        </ul>
      ) : viewMode === "tags" ? (
        <div className="memo-tag-groups" aria-label="タグ別のメモ">
          {tagGroups.map((group) => {
            const collapsed = collapsedTagKeys.has(group.key);

            return (
              <section
                key={group.key}
                className={`memo-tag-group ${group.isUntagged ? "memo-tag-group--untagged" : ""}`}
              >
                <button
                  type="button"
                  className="memo-tag-group__header"
                  aria-expanded={!collapsed}
                  onClick={() => toggleTagGroup(group.key)}
                >
                  <span className="memo-tag-group__name">
                    {group.isUntagged ? "未分類" : group.label}
                  </span>
                  <span className="memo-tag-group__count">{group.memos.length}</span>
                  <span className="memo-tag-group__chevron" aria-hidden="true">
                    {collapsed ? "›" : "⌄"}
                  </span>
                </button>

                {!collapsed ? (
                  <ul className="memo-list">
                    {group.memos.map(renderMemoCard)}
                  </ul>
                ) : null}
              </section>
            );
          })}

          <Link to="/tags" className="memo-tag-groups__manage">
            タグを整理する →
          </Link>
        </div>
      ) : (
        <ul className="memo-list">
          {visibleMemos.map(renderMemoCard)}
        </ul>
      )}

      <footer className="app-footer">
        基本はこの端末のブラウザに自動保存。クラウドへ送るのは、あなたが選んだメモだけです。
      </footer>

      <MemoDeleteDialog
        memo={memoPendingDeletion}
        isDeleting={isDeletingMemo}
        onClose={() => {
          if (!isDeletingMemo) setMemoPendingDeletion(null);
        }}
        onConfirm={confirmMemoDeletion}
      />

      <CloudAccountDialog
        open={isCloudDialogOpen}
        onClose={() => setIsCloudDialogOpen(false)}
        onImported={async ({ title, wasCopy }) => {
          await refresh();
          if (user) await refreshCloudSyncStates(user.id);
          setNotice(
            wasCopy
              ? `「${title}」をクラウド版として複製しました。`
              : `「${title}」をこの端末へ取り込みました。`,
          );
        }}
        onCloudDeleted={async ({ title }) => {
          await refresh();
          setNotice(`「${title}」をクラウドから削除しました。端末のメモは残っています。`);
        }}
      />
      <CloudUploadDialog
        open={isUploadDialogOpen}
        targets={selectedTargets}
        isSubmitting={isUploading}
        onClose={() => setIsUploadDialogOpen(false)}
        onConfirm={handleUploadConfirm}
      />
      <CloudImportDialog
        open={conflictSnapshot !== null}
        snapshot={conflictSnapshot}
        isSubmitting={isImporting}
        onClose={() => setConflictSnapshot(null)}
        onKeepLocal={() => setConflictSnapshot(null)}
        onImportCopy={handleImportConflictCopy}
      />
    </main>
  );
}
