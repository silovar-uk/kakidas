import { useCallback, useEffect, useRef, useState } from "react";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import { useAuth } from "../auth/AuthProvider";
import { useCloudMemos } from "../hooks/useCloudMemos";
import type { CloudMemoListItem, MemoCloudSnapshot } from "../types/memo";
import { formatUpdatedAt } from "../types/memo";
import { CloudImportDialog } from "./CloudImportDialog";
import { NoticeToast } from "./NoticeToast";

type CloudAccountDialogProps = {
  open: boolean;
  onClose: () => void;
  /** 取り込み完了後に、親画面のローカル一覧を更新して通知する。 */
  onImported?: (result: { title: string; wasCopy: boolean }) => Promise<void> | void;
  /** クラウドから削除した後、親画面のローカル同期表示を更新する。 */
  onCloudDeleted?: (result: { title: string }) => Promise<void> | void;
};

type CloudTab = "account" | "library";

export function CloudAccountDialog({
  open,
  onClose,
  onImported,
  onCloudDeleted,
}: CloudAccountDialogProps) {
  const { isConfigured, isLoading, user, error, signInWithGoogle, signOut } =
    useAuth();
  const {
    memos,
    isLoading: isCloudLoading,
    isImporting,
    isDeleting,
    error: cloudError,
    refresh,
    prepareImport,
    importSnapshot,
    deleteCloudMemo,
  } = useCloudMemos(user?.id ?? null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<CloudTab>("account");
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
  const [conflictSnapshot, setConflictSnapshot] =
    useState<MemoCloudSnapshot | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const conflictOpenRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    conflictOpenRef.current = conflictSnapshot !== null;
  }, [conflictSnapshot]);

  useEffect(() => {
    if (!open) {
      setNotice(null);
      setConflictSnapshot(null);
      return;
    }

    const releaseScrollLock = lockBodyScroll();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !conflictOpenRef.current) {
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      releaseScrollLock();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !user || activeTab !== "library") return;
    void refresh();
  }, [activeTab, open, refresh, user]);

  useEffect(() => {
    if (!user) {
      setActiveTab("account");
      setConflictSnapshot(null);
    }
  }, [user]);

  if (!open) return null;

  const handleSignIn = async () => {
    setIsSubmitting(true);

    try {
      await signInWithGoogle();
    } catch {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setIsSubmitting(true);

    try {
      await signOut();
      setActiveTab("account");
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 取り込み成功後は、クラウド画面とその上の確認画面をまとめて閉じる。
   * モバイルでは「取り込んだ後も前面のダイアログが残る」状態を作らない。
   */
  const finishImported = async (title: string, wasCopy: boolean) => {
    setConflictSnapshot(null);

    try {
      await Promise.resolve(onImported?.({ title, wasCopy }));
    } finally {
      // 一覧を閉じて通常操作へ戻す。失敗通知は親画面側で扱えるようにする。
      onClose();
    }
  };

  const handleImportRequest = async (cloudMemo: CloudMemoListItem) => {
    setNotice(null);

    try {
      const candidate = await prepareImport(cloudMemo.id);

      if (candidate.hasLocalMemo) {
        setConflictSnapshot(candidate.snapshot);
        return;
      }

      const result = await importSnapshot(candidate.snapshot, "preserve");
      await finishImported(result.memo.title, false);
    } catch {
      // Hook側で表示用のerrorを更新する。
    }
  };

  const handleImportCopy = async () => {
    if (!conflictSnapshot) return;

    const result = await importSnapshot(conflictSnapshot, "clone");
    setConflictSnapshot(null);
    await finishImported(result.memo.title, true);
  };

  const handleDeleteCloudMemo = async (cloudMemo: CloudMemoListItem) => {
    const confirmed = window.confirm(
      `「${cloudMemo.title}」をクラウドから削除しますか？\nこの端末にあるメモは削除されません。`,
    );

    if (!confirmed) return;

    setNotice(null);

    try {
      await deleteCloudMemo(cloudMemo.id);
      await Promise.resolve(onCloudDeleted?.({ title: cloudMemo.title }));
      setNotice(`「${cloudMemo.title}」をクラウドから削除しました。端末のメモは残っています。`);
    } catch {
      // Hook側で表示用のerrorを更新する。
    }
  };

  const renderAccount = () => (
    <>
      <p className="cloud-dialog__eyebrow">SIGNED IN</p>
      <h2 id="cloud-dialog-title">クラウド連携</h2>
      <div className="cloud-dialog__user">
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">●</span>
        )}
        <div>
          <strong>{user?.display_name}</strong>
          <span>{user?.email ?? "Googleアカウント"}</span>
        </div>
      </div>
      <p className="cloud-dialog__body">
        選んだメモだけをクラウドへ送れます。ローカル保存はそのまま残り、入力内容が自動送信されることはありません。
      </p>
      <p className="cloud-dialog__note">
        クラウドにあるメモは「クラウドのメモ」から選んで、この端末へ取り込めます。
      </p>
      <button
        type="button"
        className="secondary-button cloud-dialog__signout"
        disabled={isSubmitting}
        onClick={() => void handleSignOut()}
      >
        ログアウト
      </button>
    </>
  );

  const renderLibrary = () => (
    <>
      <p className="cloud-dialog__eyebrow">CLOUD LIBRARY</p>
      <div className="cloud-dialog__library-heading">
        <div>
          <h2 id="cloud-dialog-title">クラウドのメモ</h2>
          <p>この端末へ取り込みたいメモだけを選べます。</p>
        </div>
        <button
          type="button"
          className="text-button cloud-dialog__refresh"
          disabled={isCloudLoading || isImporting || isDeleting}
          onClick={() => void refresh()}
        >
          {isCloudLoading ? "更新中…" : "更新"}
        </button>
      </div>

      <NoticeToast
        key={notice?.id}
        message={notice?.message ?? null}
        onDismiss={() => setNotice(null)}
        className="cloud-dialog__notice"
      />
      {cloudError ? <p className="error-message cloud-dialog__error">{cloudError}</p> : null}

      {isCloudLoading ? (
        <p className="loading-copy cloud-dialog__loading">クラウドのメモを読み込んでいます。</p>
      ) : memos.length === 0 ? (
        <div className="cloud-library-empty">
          <p>クラウドにメモがありません。</p>
          <span>メモ一覧から、送るメモを選んでください。</span>
        </div>
      ) : (
        <ul className="cloud-library-list">
          {memos.map((cloudMemo) => (
            <li key={cloudMemo.id} className="cloud-library-card">
              <div className="cloud-library-card__main">
                <strong>{cloudMemo.title}</strong>
                <span>最終更新 {formatUpdatedAt(cloudMemo.updated_at)}</span>
                <small>
                  単語 {cloudMemo.entry_counts.word}件 ／ 文 {cloudMemo.entry_counts.sentence}件 ／ 段落 {cloudMemo.entry_counts.paragraph}件
                </small>
              </div>
              <div className="cloud-library-card__actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isImporting || isDeleting}
                  onClick={() => void handleImportRequest(cloudMemo)}
                >
                  {isImporting ? "確認中…" : "この端末へ取り込む"}
                </button>
                <button
                  type="button"
                  className="cloud-library-card__delete"
                  disabled={isImporting || isDeleting}
                  onClick={() => void handleDeleteCloudMemo(cloudMemo)}
                >
                  {isDeleting ? "削除中…" : "クラウドから削除"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <>
      <div className="cloud-dialog" role="presentation">
        <button
          type="button"
          className="cloud-dialog__backdrop"
          onClick={onClose}
          aria-label="クラウド画面を閉じる"
        />

        <section
          ref={panelRef}
          className="cloud-dialog__panel cloud-dialog__panel--account"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-dialog-title"
          tabIndex={-1}
        >
          <button
            type="button"
            className="icon-button cloud-dialog__close"
            onClick={onClose}
            aria-label="閉じる"
          >
            ×
          </button>

          {!isConfigured ? (
            <>
              <p className="cloud-dialog__eyebrow">CLOUD IS NOT SET UP</p>
              <h2 id="cloud-dialog-title">クラウド連携を準備中</h2>
              <p className="cloud-dialog__body">
                この端末のメモは、これまで通りブラウザ内に保存されています。クラウドへ送る機能は、Supabaseの接続設定後に使えるようになります。
              </p>
              <p className="cloud-dialog__note">
                設定後も、メモが自動で送信されることはありません。
              </p>
            </>
          ) : user ? (
            <>
              <div className="cloud-dialog__tabs" role="tablist" aria-label="クラウド画面">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "account"}
                  className={activeTab === "account" ? "cloud-dialog__tab cloud-dialog__tab--active" : "cloud-dialog__tab"}
                  onClick={() => setActiveTab("account")}
                >
                  アカウント
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "library"}
                  className={activeTab === "library" ? "cloud-dialog__tab cloud-dialog__tab--active" : "cloud-dialog__tab"}
                  onClick={() => setActiveTab("library")}
                >
                  クラウドのメモ
                </button>
              </div>
              {activeTab === "account" ? renderAccount() : renderLibrary()}
            </>
          ) : (
            <>
              <p className="cloud-dialog__eyebrow">OPTIONAL CLOUD</p>
              <h2 id="cloud-dialog-title">必要なメモだけ、他の端末へ。</h2>
              <p className="cloud-dialog__body">
                Googleでログインすると、選んだメモだけをクラウドへ送れます。この端末にあるメモが、ログインだけで送信されることはありません。
              </p>
              <ul className="cloud-dialog__list">
                <li>書く・保存する：いつも通りこの端末のブラウザ内</li>
                <li>送る：あなたが選んで確定したメモだけ</li>
                <li>取り込む：クラウドのメモから自分で選ぶ</li>
              </ul>
              <button
                type="button"
                className="primary-button cloud-dialog__signin"
                disabled={isSubmitting || isLoading}
                onClick={() => void handleSignIn()}
              >
                <span aria-hidden="true">G</span>
                Googleでログイン
              </button>
            </>
          )}

          {error ? <p className="error-message cloud-dialog__error">{error}</p> : null}
        </section>
      </div>

      <CloudImportDialog
        open={conflictSnapshot !== null}
        snapshot={conflictSnapshot}
        isSubmitting={isImporting}
        onClose={() => setConflictSnapshot(null)}
        onKeepLocal={() => setConflictSnapshot(null)}
        onImportCopy={handleImportCopy}
      />
    </>
  );
}
