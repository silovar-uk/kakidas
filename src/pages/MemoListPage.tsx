import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMemos } from "../hooks/useMemos";
import { type BackupPayload, formatUpdatedAt } from "../types/memo";

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

export function MemoListPage() {
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    memos,
    isLoading,
    error,
    createMemo,
    deleteMemo,
    exportBackup,
    importBackup,
  } = useMemos();

  const handleCreate = async () => {
    try {
      const memo = await createMemo();
      navigate(`/memos/${memo.id}`);
    } catch (createError) {
      setNotice(
        createError instanceof Error
          ? createError.message
          : "新しいメモを作れませんでした。",
      );
    }
  };

  const handleExport = async () => {
    try {
      const backup = await exportBackup();
      const day = new Date().toISOString().slice(0, 10);

      downloadFile(
        `kakidasu-backup-${day}.json`,
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

  return (
    <main className="app-shell memo-list-page">
      <header className="app-header">
        <Link to="/" className="brand" aria-label="メモ一覧へ">
          <span className="brand__mark">●</span>
          <span>かきだす</span>
        </Link>

        <p className="app-header__message">整える前に、まず置く。</p>
      </header>

      <section className="memo-list-hero" aria-labelledby="memo-list-title">
        <div>
          <p className="eyebrow">WORD / SENTENCE / PARAGRAPH</p>
          <h1 id="memo-list-title">書き始めのための、3つの入口。</h1>
          <p className="memo-list-hero__description">
            どこから書いてもいい。直すのは、出し切ってから。
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => void handleCreate()}
        >
          ＋ 新しいメモ
        </button>
      </section>

      <section className="memo-list-toolbar" aria-label="バックアップ操作">
        <div>
          <h2>メモ</h2>
          <span>{memos.length}件</span>
        </div>

        <div className="memo-list-toolbar__actions">
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
        <ul className="memo-list">
          {memos.map((memo) => (
            <li key={memo.id} className="memo-card">
              <Link to={`/memos/${memo.id}`} className="memo-card__link">
                <strong>{memo.title}</strong>
                <span>最終更新 {formatUpdatedAt(memo.updated_at)}</span>
              </Link>

              <button
                type="button"
                className="icon-button memo-card__delete"
                onClick={() => void handleDelete(memo.id)}
                aria-label={`${memo.title}を削除`}
                title="削除する"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="app-footer">
        この端末のブラウザに自動保存されます。別端末へ移すときはJSONを書き出してください。
      </footer>
    </main>
  );
}
