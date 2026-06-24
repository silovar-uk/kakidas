import { useCallback, useEffect, useMemo, useState } from "react";
import { resetBodyScrollLock } from "../lib/bodyScrollLock";
import { formatMemoText } from "../lib/memoText";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { CloudAccountDialog } from "../components/CloudAccountDialog";
import {
  CloudUploadDialog,
  type CloudUploadTarget,
} from "../components/CloudUploadDialog";
import { CloudStatusBadge } from "../components/CloudStatusBadge";
import { EntryColumn } from "../components/EntryColumn";
import { useMemoDetail } from "../hooks/useMemos";
import { uploadMemoToCloud } from "../repositories/cloudMemoRepository";
import {
  type EntryKind,
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
  focusComposer?: boolean;
};

const ENTRY_TIMESTAMP_VISIBILITY_STORAGE_KEY = "kakidas.show-entry-timestamps";
const ENTRY_NUMBER_VISIBILITY_STORAGE_KEY = "kakidas.show-entry-numbers";
const HIDE_COMPLETED_ENTRIES_STORAGE_KEY = "kakidas.hide-completed-entries";

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

export function MemoEditorPage() {
  const { memoId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [shouldFocusNewMemoComposer, setShouldFocusNewMemoComposer] = useState(
    () => Boolean((location.state as EditorNavigationState | null)?.focusComposer),
  );

  const {
    memo,
    isLoading,
    isSaving,
    error,
    reload,
    updateTitle,
    createEntry,
    updateEntry,
    deleteEntry,
    restoreEntries,
    deleteEntriesByKind,
    deleteCompletedEntries,
    indentEntry,
    outdentEntry,
    moveEntry,
    deleteMemo,
  } = useMemoDetail(memoId);

  const [title, setTitle] = useState("");
  const [activeKind, setActiveKind] = useState<EntryKind>("word");
  const [notice, setNotice] = useState<string | null>(null);
  const [isCloudDialogOpen, setIsCloudDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showEntryTimestamps, setShowEntryTimestamps] = useState(
    readEntryTimestampVisibility,
  );
  const [showEntryNumbers, setShowEntryNumbers] = useState(
    readEntryNumberVisibility,
  );
  const [hideCompletedEntries, setHideCompletedEntries] = useState(
    readHideCompletedEntries,
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

  // メモ画面を離れた後に、モバイル操作シート等のスクロールロックを残さない。
  useEffect(() => {
    return () => resetBodyScrollLock();
  }, []);

  useEffect(() => {
    if (memo) {
      setTitle(memo.title);
    }
  }, [memo?.id, memo?.title]);

  useEffect(() => {
    if (shouldFocusNewMemoComposer) {
      setActiveKind("word");
    }
  }, [shouldFocusNewMemoComposer]);

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

  useEffect(() => {
    if (!memo || title === memo.title) return;

    const timer = window.setTimeout(() => {
      void saveTitle(title);
    }, 600);

    return () => window.clearTimeout(timer);
  }, [memo, saveTitle, title]);

  const handleDownload = () => {
    if (!memo) return;

    const safeTitle = memo.title.replace(/[\\/:*?"<>|]/g, "_");

    downloadText(
      `${safeTitle}.txt`,
      formatMemoText(memo, {
        includeEntryNumbers: showEntryNumbers,
      }),
    );

    setNotice("テキストを書き出しました。");
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

  const entriesByKind = useMemo(() => {
    const allEntries = memo?.entries ?? [];
    // 完了を隠すときは、完了項目を木の計算前に除外する。
    // そのため未完了の下位項目は、見えない親の下にぶら下がらず安全に表示される。
    const entries = hideCompletedEntries
      ? allEntries.filter((entry) => !entry.is_completed)
      : allEntries;

    return {
      word: getEntryTree(entries, "word"),
      sentence: getEntryTree(entries, "sentence"),
      paragraph: getEntryTree(entries, "paragraph"),
    };
  }, [hideCompletedEntries, memo?.entries]);

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

  const handleComposerAutoFocusHandled = useCallback(() => {
    setShouldFocusNewMemoComposer(false);
  }, []);

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
          <Link to="/" className="primary-button">
            メモ一覧へ戻る
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell editor-page">
      <header className="editor-header">
        <Link to="/" className="back-link">
          ← メモ一覧
        </Link>

        <div className="editor-header__right">
          <CloudStatusBadge syncMeta={memo.sync_meta} />
          <p className="save-status" aria-live="polite">
            {isSaving ? "保存中…" : "保存済み"}
          </p>
        </div>
      </header>

      <section className="editor-title-row" aria-label="メモのタイトル">
        <input
          className="memo-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle(title)}
          aria-label="メモのタイトル"
        />

        <div className="editor-title-row__actions">
          <button
            type="button"
            className="cloud-upload-button"
            onClick={openUpload}
          >
            <span aria-hidden="true">☁</span>
            クラウドへ送る
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleDownload}
          >
            .txt出力
          </button>

          <button
            type="button"
            className="danger-button"
            onClick={() => void handleDeleteMemo()}
          >
            削除
          </button>
        </div>
      </section>

      <section className="editor-display-options" aria-label="表示設定">
        <div className="editor-display-options__toggles">
          <label className="timestamp-visibility-toggle">
            <input
              type="checkbox"
              checked={showEntryTimestamps}
              onChange={(event) => setShowEntryTimestamps(event.target.checked)}
            />
            <span className="timestamp-visibility-toggle__track" aria-hidden="true">
              <span className="timestamp-visibility-toggle__thumb" />
            </span>
            <span>項目の日時を表示</span>
          </label>

          <label className="timestamp-visibility-toggle">
            <input
              type="checkbox"
              checked={showEntryNumbers}
              onChange={(event) => setShowEntryNumbers(event.target.checked)}
            />
            <span className="timestamp-visibility-toggle__track" aria-hidden="true">
              <span className="timestamp-visibility-toggle__thumb" />
            </span>
            <span>番号を表示</span>
          </label>

          <label className="timestamp-visibility-toggle">
            <input
              type="checkbox"
              checked={hideCompletedEntries}
              onChange={(event) => setHideCompletedEntries(event.target.checked)}
            />
            <span className="timestamp-visibility-toggle__track" aria-hidden="true">
              <span className="timestamp-visibility-toggle__thumb" />
            </span>
            <span>完了を非表示</span>
          </label>

          <button
            type="button"
            className="completed-entries-delete"
            onClick={() => void handleDeleteCompleted()}
            disabled={isSaving || completedEntryCount === 0}
            title="完了済み項目をまとめて削除"
          >
            完了を削除{completedEntryCount > 0 ? `（${completedEntryCount}）` : ""}
          </button>
        </div>
        <p>番号は一覧からのコピー・.txt出力にも反映されます。完了済みは一覧コピーに含めません。</p>
      </section>

      <div className="editor-tabs" role="tablist" aria-label="入力する粒度">
        {ENTRY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={activeKind === kind}
            className={
              activeKind === kind
                ? "editor-tab editor-tab--active"
                : "editor-tab"
            }
            onClick={() => setActiveKind(kind)}
          >
            {ENTRY_KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}

      <section className="editor-grid" aria-label="書き出しスペース">
        {ENTRY_KINDS.map((kind) => (
          <EntryColumn
            key={kind}
            kind={kind}
            entries={entriesByKind[kind]}
            isActiveOnMobile={activeKind === kind}
            showCreatedAt={showEntryTimestamps}
            showEntryNumbers={showEntryNumbers}
            disabled={isSaving || isUploading}
            autoFocusComposer={
              kind === "word" && shouldFocusNewMemoComposer
            }
            onAutoFocusHandled={handleComposerAutoFocusHandled}
            onCreate={createEntry}
            onUpdate={(entryId, patch) => updateEntry(entryId, patch)}
            onDelete={deleteEntry}
            onRestore={restoreEntries}
            onDeleteAll={deleteEntriesByKind}
            onIndent={indentEntry}
            onOutdent={outdentEntry}
            onMove={moveEntry}
          />
        ))}
      </section>

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
