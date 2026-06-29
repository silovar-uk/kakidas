import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NoticeToast } from "../components/NoticeToast";
import { getMemoTagSummaries } from "../lib/memoTags";
import { useMemos } from "../hooks/useMemos";
import { normalizeMemoTag } from "../types/memo";

/**
 * タグは独立したマスタではなく、メモの1属性。
 * この画面では、実際に使われているタグを眺め、まとめて名前を直す／外すだけに留める。
 */
export function TagManagerPage() {
  useEffect(() => {
    document.title = "タグ管理｜kakidas";
  }, []);

  const noticeIdRef = useRef(0);
  const [notice, setNoticeState] = useState<{ id: number; message: string } | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [clearConfirmKey, setClearConfirmKey] = useState<string | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const setNotice = (message: string | null) => {
    if (message === null) {
      setNoticeState(null);
      return;
    }

    noticeIdRef.current += 1;
    setNoticeState({ id: noticeIdRef.current, message });
  };

  const { memos, isLoading, error, refresh, renameTag, clearTag } = useMemos();
  const tags = useMemo(() => getMemoTagSummaries(memos), [memos]);

  const beginRename = (key: string, label: string) => {
    if (updatingKey) return;
    setClearConfirmKey(null);
    setEditingKey(key);
    setEditingValue(label);
  };

  const cancelRename = () => {
    if (updatingKey) return;
    setEditingKey(null);
    setEditingValue("");
  };

  const saveRename = async (key: string, currentLabel: string) => {
    if (updatingKey) return;

    const nextTag = normalizeMemoTag(editingValue);
    if (!nextTag) {
      setNotice("タグ名を入力してください。外す場合は「タグを外す」を使ってください。");
      return;
    }

    if (nextTag === currentLabel) {
      cancelRename();
      return;
    }

    setUpdatingKey(key);
    try {
      const result = await renameTag(currentLabel, nextTag);
      setEditingKey(null);
      setEditingValue("");
      setNotice(`「${result.previous_tag}」を「${nextTag}」へ変更しました。${result.updated_count}件に反映しています。`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "タグ名を変更できませんでした。");
    } finally {
      setUpdatingKey(null);
    }
  };

  const confirmClear = async (key: string, label: string) => {
    if (updatingKey) return;

    setUpdatingKey(key);
    try {
      const result = await clearTag(label);
      setClearConfirmKey(null);
      setNotice(`「${label}」を${result.updated_count}件のメモから外しました。`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "タグを外せませんでした。");
    } finally {
      setUpdatingKey(null);
    }
  };

  return (
    <main className="app-shell tag-manager-page">
      <header className="editor-header">
        <Link to="/" className="back-link">
          ← メモ一覧
        </Link>
      </header>

      <section className="tag-manager-hero" aria-labelledby="tag-manager-title">
        <p>ORGANIZE</p>
        <h1 id="tag-manager-title">タグ管理</h1>
        <span>メモに付いているタグだけを、名前変更・解除できます。</span>
      </section>

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
        <p className="loading-copy">タグを読み込んでいます。</p>
      ) : tags.length === 0 ? (
        <section className="empty-state">
          <p>まだタグがありません。</p>
          <span>メモを開いて「＋ タグ」から自由に付けられます。</span>
          <Link to="/" className="secondary-button">
            メモ一覧へ戻る
          </Link>
        </section>
      ) : (
        <section className="tag-manager-list" aria-label="使われているタグ">
          <div className="tag-manager-list__heading">
            <h2>使われているタグ</h2>
            <span>{tags.length}種類</span>
          </div>

          <ul>
            {tags.map((tag) => {
              const isEditing = editingKey === tag.key;
              const isConfirmingClear = clearConfirmKey === tag.key;
              const isUpdating = updatingKey === tag.key;

              return (
                <li key={tag.key} className={isUpdating ? "tag-manager-row tag-manager-row--updating" : "tag-manager-row"}>
                  {isEditing ? (
                    <form
                      className="tag-manager-row__rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveRename(tag.key, tag.label);
                      }}
                    >
                      <label>
                        <span>タグ名</span>
                        <input
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          maxLength={30}
                          autoFocus
                          disabled={isUpdating}
                        />
                      </label>
                      <div>
                        <button type="submit" className="primary-button" disabled={isUpdating}>
                          {isUpdating ? "保存中…" : "保存"}
                        </button>
                        <button type="button" className="secondary-button" disabled={isUpdating} onClick={cancelRename}>
                          キャンセル
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="tag-manager-row__summary">
                        <strong>#{tag.label}</strong>
                        <span>{tag.count}件のメモ</span>
                      </div>
                      <div className="tag-manager-row__actions">
                        <button type="button" className="secondary-button" disabled={Boolean(updatingKey)} onClick={() => beginRename(tag.key, tag.label)}>
                          名前を変更
                        </button>
                        <button type="button" className="tag-manager-row__clear" disabled={Boolean(updatingKey)} onClick={() => {
                          setEditingKey(null);
                          setClearConfirmKey(tag.key);
                        }}>
                          タグを外す
                        </button>
                      </div>
                    </>
                  )}

                  {isConfirmingClear ? (
                    <div className="tag-manager-row__confirm" role="status">
                      <span>#{tag.label} を {tag.count}件のメモから外します。</span>
                      <div>
                        <button type="button" className="secondary-button" disabled={isUpdating} onClick={() => setClearConfirmKey(null)}>
                          やめる
                        </button>
                        <button type="button" className="danger-button" disabled={isUpdating} onClick={() => void confirmClear(tag.key, tag.label)}>
                          {isUpdating ? "処理中…" : "外す"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
