import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { lockBodyScroll } from "../lib/bodyScrollLock";
import {
  temporaryMemoRepository,
  type TemporaryMemoRecord,
} from "../repositories/temporaryMemoRepository";

const MOBILE_QUERY = "(max-width: 920px)";
const SAVE_DELAY_MS = 650;

function getMemoId(pathname: string): string | null {
  const match = pathname.match(/^\/memos\/([^/?#]+)/);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function formatSavedAt(value: string | null): string {
  if (!value) return "まだ保存していません";

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getCurrentMemoTitle(): string {
  const input = document.querySelector<HTMLInputElement>(".memo-title-input");
  return input?.value.trim() || document.title || "このメモ";
}

export function TemporaryMemoDock() {
  const { pathname } = useLocation();
  const memoId = getMemoId(pathname);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_QUERY).matches : false,
  );
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const latestContentRef = useRef("");
  const currentMemoIdRef = useRef<string | null>(memoId);
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<TemporaryMemoRecord | null> | null>(null);

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async (): Promise<TemporaryMemoRecord | null> => {
    const targetMemoId = currentMemoIdRef.current;
    if (!targetMemoId) return null;

    clearSaveTimer();
    const nextContent = latestContentRef.current;

    if (nextContent === savedContent && !saveError) {
      return nextContent.length === 0
        ? null
        : {
            memo_id: targetMemoId,
            content: nextContent,
            updated_at: savedAt ?? new Date().toISOString(),
          };
    }

    if (savePromiseRef.current) {
      await savePromiseRef.current.catch(() => null);
      if (nextContent === savedContent && !saveError) return null;
    }

    setIsSaving(true);
    setSaveError(null);

    const promise = temporaryMemoRepository.save(targetMemoId, nextContent);
    savePromiseRef.current = promise;

    try {
      const record = await promise;
      setSavedContent(nextContent);
      setSavedAt(record?.updated_at ?? new Date().toISOString());
      return record;
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "一時メモを保存できませんでした。",
      );
      throw error;
    } finally {
      if (savePromiseRef.current === promise) savePromiseRef.current = null;
      setIsSaving(false);
    }
  }, [clearSaveTimer, saveError, savedAt, savedContent]);

  useEffect(() => {
    currentMemoIdRef.current = memoId;
    clearSaveTimer();
    setIsOpen(false);
    setContent("");
    setSavedContent("");
    setSavedAt(null);
    setSaveError(null);

    if (!memoId) return;

    let cancelled = false;
    setIsLoading(true);

    void temporaryMemoRepository
      .get(memoId)
      .then((record) => {
        if (cancelled) return;
        const nextContent = record?.content ?? "";
        latestContentRef.current = nextContent;
        setContent(nextContent);
        setSavedContent(nextContent);
        setSavedAt(record?.updated_at ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        setSaveError(
          error instanceof Error
            ? error.message
            : "一時メモを読み込めませんでした。",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      const previousMemoId = memoId;
      const pendingContent = latestContentRef.current;
      if (previousMemoId && pendingContent !== savedContent) {
        void temporaryMemoRepository.save(previousMemoId, pendingContent);
      }
    };
  }, [clearSaveTimer, memoId]);

  useEffect(() => {
    if (!memoId || isLoading || content === savedContent) return;

    clearSaveTimer();
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveNow().catch(() => undefined);
    }, SAVE_DELAY_MS);

    return clearSaveTimer;
  }, [clearSaveTimer, content, isLoading, memoId, saveNow, savedContent]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const sync = () => setAvailableHeight(viewport.height);
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);

    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !isMobile) return;
    return lockBodyScroll();
  }, [isMobile, isOpen]);

  const closePanel = useCallback(
    (restoreFocus = true) => {
      if (!isOpen) return;

      textareaRef.current?.blur();
      setIsOpen(false);
      void saveNow().catch(() => undefined);

      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          triggerRef.current?.focus({ preventScroll: true });
        });
      }
    },
    [isOpen, saveNow],
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePanel();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePanel, isOpen]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void saveNow().catch(() => undefined);
      }
    };
    const handlePageHide = () => {
      void saveNow().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [saveNow]);

  useEffect(() => {
    return clearSaveTimer;
  }, [clearSaveTimer]);

  const openPanel = () => {
    if (!memoId || isLoading) return;
    setIsOpen(true);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    });
  };

  const clearTemporaryMemo = async () => {
    if (!memoId || isSaving) return;
    if (
      !window.confirm(
        "このメモの一時メモをすべて消しますか？\nこの操作は元に戻せません。",
      )
    ) {
      return;
    }

    clearSaveTimer();
    latestContentRef.current = "";
    setContent("");
    setIsSaving(true);
    setSaveError(null);

    try {
      await temporaryMemoRepository.clear(memoId);
      setSavedContent("");
      setSavedAt(new Date().toISOString());
      textareaRef.current?.focus({ preventScroll: true });
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "一時メモをクリアできませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!memoId || typeof document === "undefined") return null;

  const hasContent = content.trim().length > 0;
  const isDirty = content !== savedContent;
  const statusLabel = saveError
    ? "未保存"
    : isSaving || isDirty
      ? "保存中…"
      : hasContent
        ? `保存済み ${formatSavedAt(savedAt)}`
        : "空です";
  const panelStyle = availableHeight
    ? ({
        "--temporary-memo-available-height": `${availableHeight}px`,
      } as React.CSSProperties)
    : undefined;

  return createPortal(
    <>
      {!isOpen ? (
        <button
          ref={triggerRef}
          type="button"
          className={`temporary-memo-trigger ${hasContent ? "temporary-memo-trigger--filled" : ""} ${saveError ? "temporary-memo-trigger--error" : ""}`}
          onClick={openPanel}
          disabled={isLoading}
          aria-expanded="false"
          aria-label={
            hasContent ? "内容のある一時メモを開く" : "一時メモを開く"
          }
        >
          <span className="temporary-memo-trigger__icon" aria-hidden="true">
            ✎
          </span>
          <span>{isLoading ? "読込中…" : "一時メモ"}</span>
          <span className="temporary-memo-trigger__shortcut" aria-hidden="true">
            Alt＋Q
          </span>
          {hasContent ? (
            <span className="temporary-memo-trigger__dot" aria-hidden="true" />
          ) : null}
        </button>
      ) : (
        <div className="temporary-memo-layer" style={panelStyle}>
          <button
            type="button"
            className="temporary-memo-backdrop"
            onClick={() => closePanel()}
            aria-label="一時メモを保存して閉じる"
          />
          <section
            className="temporary-memo-panel"
            role="dialog"
            aria-modal={isMobile ? "true" : undefined}
            aria-labelledby="temporary-memo-title"
          >
            <div className="temporary-memo-panel__grabber" aria-hidden="true" />
            <header className="temporary-memo-panel__header">
              <div>
                <p className="temporary-memo-panel__eyebrow">QUICK NOTE</p>
                <h2 id="temporary-memo-title">一時メモ</h2>
                <p className="temporary-memo-panel__memo-title">
                  {getCurrentMemoTitle()}
                </p>
              </div>
              <button
                type="button"
                className="temporary-memo-panel__close"
                onClick={() => closePanel()}
                aria-label="保存して閉じる"
              >
                閉じる
              </button>
            </header>

            <textarea
              ref={textareaRef}
              className="temporary-memo-panel__textarea"
              value={content}
              onChange={(event) => {
                const next = event.target.value;
                latestContentRef.current = next;
                setContent(next);
                setSaveError(null);
              }}
              placeholder="まだ整理しなくていいことを、ここへ。"
              aria-label="一時メモの内容"
            />

            <footer className="temporary-memo-panel__footer">
              <div className="temporary-memo-panel__status" aria-live="polite">
                <span
                  className={`temporary-memo-panel__status-dot ${saveError ? "is-error" : isDirty ? "is-dirty" : ""}`}
                  aria-hidden="true"
                />
                <span>{statusLabel}</span>
                <small>クラウド保存に含まれます</small>
              </div>
              <button
                type="button"
                className="temporary-memo-panel__clear"
                onClick={() => void clearTemporaryMemo()}
                disabled={!hasContent || isSaving}
              >
                一時メモをクリア
              </button>
            </footer>
            {saveError ? (
              <p className="temporary-memo-panel__error" role="alert">
                {saveError}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </>,
    document.body,
  );
}
