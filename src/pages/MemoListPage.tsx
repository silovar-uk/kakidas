import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { CloudAccountDialog } from "../components/CloudAccountDialog";
import { CloudImportDialog } from "../components/CloudImportDialog";
import {
  CloudUploadDialog,
  type CloudUploadTarget,
} from "../components/CloudUploadDialog";
import { CloudStatusBadge } from "../components/CloudStatusBadge";
import { useCloudMemos } from "../hooks/useCloudMemos";
import { useMemos } from "../hooks/useMemos";
import {
  refreshCloudSyncStates,
  uploadMemosToCloud,
} from "../repositories/cloudMemoRepository";
import {
  type BackupPayload,
  type CloudState,
  type MemoCloudSnapshot,
  type MemoListItem,
  formatUpdatedAt,
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

export function MemoListPage() {
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCloudDialogOpen, setIsCloudDialogOpen] = useState(false);
  const [isUploadMode, setIsUploadMode] = useState(false);
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(new Set());
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplyingCloudUpdate, setIsApplyingCloudUpdate] = useState(false);
  const [conflictSnapshot, setConflictSnapshot] =
    useState<MemoCloudSnapshot | null>(null);

  const { isConfigured, isLoading: isAuthLoading, user } = useAuth();

  const {
    memos,
    isLoading,
    error,
    refresh,
    createMemo,
    deleteMemo,
    exportBackup,
    importBackup,
  } = useMemos();

  const {
    isImporting,
    prepareImport,
    importSnapshot,
  } = useCloudMemos(user?.id ?? null);

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

  const selectedTargets = useMemo<CloudUploadTarget[]>(
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
        state: { focusComposer: true },
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

  const handleDelete = async (memoId: string) => {
    const confirmed = window.confirm(
      "このメモを削除しますか？\n削除後はバックアップ以外から復元できません。",
    );

    if (!confirmed) return;

    try {
      await deleteMemo(memoId);
      setNotice("メモを削除しました。");
    } catch (deleteError) {
      setNotice(
        deleteError instanceof Error
          ? deleteError.message
          : "メモを削除できませんでした。",
      );
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
          <p className="app-header__message">整える前に、まず置く。</p>
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
        <div>
          <p className="eyebrow">WORD / SENTENCE / PARAGRAPH</p>
          <h1 id="memo-list-title">
            <span>書き始めのための、</span>
            <span>3つの入口。</span>
          </h1>
          <p className="memo-list-hero__description">
            どこから書いてもいい。直すのは、出し切ってから。
          </p>
        </div>

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
            <span className="cloud-selection-toolbar__eyebrow">CLOUD UPLOAD</span>
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
        <section className="memo-list-toolbar" aria-label="メモ操作">
          <div>
            <h2>メモ</h2>
            <span>{memos.length}件</span>
          </div>

          <div className="memo-list-toolbar__actions">
            <button
              type="button"
              className="cloud-upload-button"
              onClick={openUploadMode}
            >
              <span aria-hidden="true">☁</span>
              クラウドへ送る
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleExport()}
            >
              JSONを書き出す
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => importInputRef.current?.click()}
            >
              JSONを読み込む
            </button>

            <input
              ref={importInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
          </div>
        </section>
      )}

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

      {isLoading ? (
        <p className="loading-copy">メモを読み込んでいます。</p>
      ) : memos.length === 0 ? (
        <section className="empty-state">
          <p>まだメモがありません。</p>
          <p>最初の一語から、置いてみよう。</p>

          <button
            type="button"
            className="primary-button"
            onClick={() => void handleCreate()}
          >
            ＋ 新しいメモ
          </button>
        </section>
      ) : (
        <ul className={`memo-list ${isUploadMode ? "memo-list--selecting" : ""}`}>
          {memos.map((memo) => {
            const selected = selectedMemoIds.has(memo.id);
            const cloudAction = getCloudAction(memo.sync_meta.cloud_state);

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
                      <span>
                        Word {memo.entry_counts.word}件 ／ Sentence {memo.entry_counts.sentence}件 ／ Paragraph {memo.entry_counts.paragraph}件
                      </span>
                    </span>
                  </button>
                ) : (
                  <Link to={`/memos/${memo.id}`} className="memo-card__link">
                    <strong>{memo.title}</strong>
                    <span className="memo-card__meta">
                      <span>最終更新 {formatUpdatedAt(memo.updated_at)}</span>
                      <CloudStatusBadge syncMeta={memo.sync_meta} />
                    </span>
                  </Link>
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
                    {cloudAction ? (
                      <button
                        type="button"
                        className={`memo-card__cloud-action memo-card__cloud-action--${cloudAction.kind}`}
                        disabled={isCloudActionBusy}
                        onClick={() => handleCloudAction(memo)}
                      >
                        {isApplyingCloudUpdate && cloudAction.kind === "update"
                          ? "取り込み中…"
                          : isImporting && cloudAction.kind === "clone"
                            ? "確認中…"
                            : cloudAction.label}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="icon-button memo-card__delete"
                      onClick={() => void handleDelete(memo.id)}
                      aria-label={`${memo.title}を削除`}
                      title="削除する"
                    >
                      ×
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="app-footer">
        基本はこの端末のブラウザに自動保存。クラウドへ送るのは、あなたが選んだメモだけです。
      </footer>

      <CloudAccountDialog
        open={isCloudDialogOpen}
        onClose={() => setIsCloudDialogOpen(false)}
        onImported={async () => {
          await refresh();
          if (user) await refreshCloudSyncStates(user.id);
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
