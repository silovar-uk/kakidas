import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCloudMemos } from "../hooks/useCloudMemos";
import { memoRepository } from "../repositories/memoRepository";
import type { MemoSyncMetaRow } from "../types/memo";

const ACTION_TARGET_SELECTOR = ".editor-header__cloud-slot";
const FALLBACK_TARGET_SELECTOR = ".editor-header__right";
const DISPLAY_TRIGGER_SELECTOR = ".editor-utility-menu__trigger";
const ORIGINAL_UPLOAD_BUTTON_SELECTOR =
  ".editor-display-options .cloud-upload-button";
const DISPLAY_ACTIONS_SELECTOR = ".editor-display-options__actions";

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function formatCloudUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getMemoIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/memos\/([^/?#]+)/);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * PCでは状態表示の下にある共通操作列へ、スマホでは従来のヘッダー右側へ置く。
 * 送信は既存ボタンを経由し、クラウド版への上書き同期だけをここで明示的に扱う。
 */
export function CloudUploadHeaderButton() {
  const { pathname } = useLocation();
  const memoId = getMemoIdFromPathname(pathname);
  const { user } = useAuth();
  const { prepareImport, importSnapshot } = useCloudMemos(user?.id ?? null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    let frame: number | null = null;

    const sync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const nextTarget =
          document.querySelector<HTMLElement>(ACTION_TARGET_SELECTOR) ??
          document.querySelector<HTMLElement>(FALLBACK_TARGET_SELECTOR);
        setPortalTarget((current) =>
          current === nextTarget ? current : nextTarget,
        );

        document
          .querySelectorAll<HTMLElement>(DISPLAY_ACTIONS_SELECTOR)
          .forEach((actions) => actions.setAttribute("aria-label", "出力"));
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const openCloudUpload = async () => {
    if (isOpening || isSyncing) return;
    setIsOpening(true);

    try {
      const mountedUploadButton = document.querySelector<HTMLButtonElement>(
        ORIGINAL_UPLOAD_BUTTON_SELECTOR,
      );

      if (mountedUploadButton) {
        mountedUploadButton.click();
        return;
      }

      const displayTrigger = document.querySelector<HTMLButtonElement>(
        DISPLAY_TRIGGER_SELECTOR,
      );
      if (!displayTrigger) return;

      const wasExpanded = displayTrigger.getAttribute("aria-expanded") === "true";
      if (!wasExpanded) displayTrigger.click();

      await nextPaint();
      await nextPaint();

      document
        .querySelector<HTMLButtonElement>(ORIGINAL_UPLOAD_BUTTON_SELECTOR)
        ?.click();

      if (!wasExpanded) {
        await nextPaint();
        const currentTrigger = document.querySelector<HTMLButtonElement>(
          DISPLAY_TRIGGER_SELECTOR,
        );
        if (currentTrigger?.getAttribute("aria-expanded") === "true") {
          currentTrigger.click();
        }
      }
    } finally {
      setIsOpening(false);
    }
  };

  const overwriteWithCloud = async () => {
    if (isOpening || isSyncing) return;

    if (!memoId) {
      window.alert("このメモを特定できませんでした。画面を開き直してからお試しください。");
      return;
    }

    if (!user) {
      await openCloudUpload();
      return;
    }

    setIsSyncing(true);
    let originalMeta: MemoSyncMetaRow | null = null;
    let safetyTemporarilyReleased = false;

    try {
      // タイトル編集中なら先にblurさせ、通常保存を完了させてから最新クラウド版を確認する。
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      await nextPaint();

      const candidate = await prepareImport(memoId);
      if (!candidate.hasLocalMemo) {
        throw new Error("上書きする端末側のメモが見つかりません。");
      }

      const updatedAt = formatCloudUpdatedAt(candidate.snapshot.memo.updated_at);
      const confirmed = window.confirm(
        `クラウド版「${candidate.snapshot.memo.title}」に合わせますか？\n` +
          `クラウド最終更新：${updatedAt}\n\n` +
          "この端末のタイトル・項目・完了状態などはクラウド版で上書きされます。\n" +
          "端末側だけの変更は元に戻せません。",
      );

      if (!confirmed) return;

      originalMeta = await memoRepository.getSyncMeta(memoId);

      /**
       * 通常のreplaceは端末変更がある場合に拒否する。
       * このボタンでは警告に同意した直後だけ安全装置を一時解除し、
       * 失敗時には必ず元の同期状態へ戻す。
       */
      if (
        originalMeta.cloud_state === "changed_after_upload" ||
        originalMeta.cloud_state === "conflict"
      ) {
        await memoRepository.saveSyncMeta({
          ...originalMeta,
          cloud_state: "uploaded",
          last_error: null,
        });
        safetyTemporarilyReleased = true;
      }

      await importSnapshot(candidate.snapshot, "replace");
      window.alert("この端末のメモをクラウド版に合わせました。");
      window.location.reload();
    } catch (caught) {
      if (safetyTemporarilyReleased && originalMeta) {
        try {
          await memoRepository.saveSyncMeta(originalMeta);
        } catch {
          // 元の同期状態を戻せない場合も、最初に起きたエラーを利用者へ伝える。
        }
      }

      window.alert(
        caught instanceof Error
          ? caught.message
          : "クラウド版に合わせられませんでした。",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  if (!portalTarget || !memoId) return null;

  return createPortal(
    <div className="editor-header__cloud-actions" aria-label="クラウド操作">
      <button
        type="button"
        className="editor-header__cloud-save"
        onClick={() => void openCloudUpload()}
        disabled={isOpening || isSyncing}
        aria-label="このメモをクラウドへ保存"
        title="このメモをクラウドへ保存"
      >
        <span aria-hidden="true">☁</span>
        <span className="editor-header__cloud-label--full">
          {isOpening ? "準備中…" : "クラウド保存"}
        </span>
        <span className="editor-header__cloud-label--compact">
          {isOpening ? "準備中…" : "保存"}
        </span>
      </button>
      <button
        type="button"
        className="editor-header__cloud-sync"
        onClick={() => void overwriteWithCloud()}
        disabled={isOpening || isSyncing}
        aria-label="クラウドの最新内容でこの端末のメモを上書き"
        title="クラウドの最新内容でこの端末のメモを上書き"
      >
        <span aria-hidden="true">↧</span>
        <span className="editor-header__cloud-label--full">
          {isSyncing ? "確認中…" : "クラウドに合わせる"}
        </span>
        <span className="editor-header__cloud-label--compact">
          {isSyncing ? "確認中…" : "クラウド反映"}
        </span>
      </button>
    </div>,
    portalTarget,
  );
}
