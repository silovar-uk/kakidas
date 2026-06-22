import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { copyToClipboard } from "../lib/clipboard";
import {
  type EntryKind,
  type EntryTreeNode,
  supportsHierarchy,
} from "../types/memo";

type StructureShortcut = "indent" | "outdent" | "move-up" | "move-down";
type CopyFeedback = "copied" | "failed" | null;

type EntryItemProps = {
  entry: EntryTreeNode;
  kind: EntryKind;
  isStructureOpen: boolean;
  isMobileActionOpen: boolean;
  disabled?: boolean;
  onOpenStructure: (entryId: string) => void;
  onAddChild: (entryId: string) => void;
  onIndent: (entryId: string) => Promise<unknown>;
  onOutdent: (entryId: string) => Promise<unknown>;
  onMove: (entryId: string, direction: "up" | "down") => Promise<unknown>;
  onUpdate: (entryId: string, content: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
};

const LONG_PRESS_MS = 460;
const LONG_PRESS_MOVE_TOLERANCE = 10;

function triggerHapticFeedback() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.(8);
  }
}

/**
 * Word / Sentenceのアウトライン操作は、Workflowyの考え方を参考にしている。
 *
 * PC:
 * - Tab / Shift + Tab: 階層を下げる / 戻す
 * - Ctrl or Cmd + Shift + ← →: 階層を戻す / 下げる
 * - Ctrl or Cmd + Shift + ↑ ↓: 同じ階層で並び替える
 *
 * Mobile:
 * - 項目を長押し、または ⋯ をタップ: 下から操作シートを開く
 * - 直接コピー / 直接削除も、項目の右側からすぐ使える
 */
export function EntryItem({
  entry,
  kind,
  isStructureOpen,
  isMobileActionOpen,
  disabled = false,
  onOpenStructure,
  onAddChild,
  onIndent,
  onOutdent,
  onMove,
  onUpdate,
  onDelete,
}: EntryItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(entry.content);
  const [isComposing, setIsComposing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const structureActionInFlightRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  const isParagraph = kind === "paragraph";
  const isHierarchical = supportsHierarchy(kind);

  useEffect(() => {
    setValue(entry.content);
  }, [entry.content]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }

      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    longPressStartRef.current = null;
  };

  const persistCurrentValue = async (exitEditing: boolean): Promise<boolean> => {
    const nextValue = value.trim();

    if (!nextValue) {
      setValue(entry.content);

      if (exitEditing) {
        setIsEditing(false);
      }

      return false;
    }

    if (nextValue === entry.content) {
      if (exitEditing) {
        setIsEditing(false);
      }

      return true;
    }

    setIsSaving(true);

    try {
      await onUpdate(entry.id, nextValue);

      if (exitEditing) {
        setIsEditing(false);
      }

      return true;
    } finally {
      setIsSaving(false);
    }
  };

  const save = async () => {
    await persistCurrentValue(true);
  };

  const cancel = () => {
    setValue(entry.content);
    setIsEditing(false);
  };

  const canRunStructureShortcut = (shortcut: StructureShortcut): boolean => {
    switch (shortcut) {
      case "indent":
        return entry.can_indent;
      case "outdent":
        return entry.can_outdent;
      case "move-up":
        return entry.can_move_up;
      case "move-down":
        return entry.can_move_down;
    }
  };

  const runStructureShortcut = async (shortcut: StructureShortcut) => {
    if (
      !isHierarchical ||
      disabled ||
      isSaving ||
      structureActionInFlightRef.current ||
      !canRunStructureShortcut(shortcut)
    ) {
      return;
    }

    structureActionInFlightRef.current = true;

    try {
      const canContinue = await persistCurrentValue(false);

      if (!canContinue) return;

      if (shortcut === "indent") {
        await onIndent(entry.id);
      }

      if (shortcut === "outdent") {
        await onOutdent(entry.id);
      }

      if (shortcut === "move-up") {
        await onMove(entry.id, "up");
      }

      if (shortcut === "move-down") {
        await onMove(entry.id, "down");
      }

      window.requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      structureActionInFlightRef.current = false;
    }
  };

  const getStructureShortcut = (
    event: Pick<
      KeyboardEvent<Element>,
      "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
    >,
  ): StructureShortcut | null => {
    if (!isHierarchical || disabled) return null;

    if (event.key === "Tab") {
      return event.shiftKey ? "outdent" : "indent";
    }

    const hasShiftedModifier =
      event.shiftKey && (event.ctrlKey || event.metaKey || event.altKey);

    if (!hasShiftedModifier) return null;

    if (event.key === "ArrowRight") return "indent";
    if (event.key === "ArrowLeft") return "outdent";
    if (event.key === "ArrowUp") return "move-up";
    if (event.key === "ArrowDown") return "move-down";

    return null;
  };

  const handleStructureShortcut = (event: KeyboardEvent<Element>): boolean => {
    const shortcut = getStructureShortcut(event);

    if (!shortcut) return false;

    event.preventDefault();
    void runStructureShortcut(shortcut);

    return true;
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing || isComposing) return;

    if (handleStructureShortcut(event)) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (!isParagraph && event.key === "Enter") {
      event.preventDefault();
      void save();
      return;
    }

    if (
      isParagraph &&
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      void save();
    }
  };

  const handleReadOnlyKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    void handleStructureShortcut(event);
  };

  const handleTouchPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (
      !isHierarchical ||
      disabled ||
      event.pointerType !== "touch" ||
      isEditing
    ) {
      return;
    }

    didLongPressRef.current = false;
    longPressStartRef.current = { x: event.clientX, y: event.clientY };

    longPressTimerRef.current = window.setTimeout(() => {
      didLongPressRef.current = true;
      triggerHapticFeedback();
      onOpenStructure(entry.id);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const handleTouchPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = longPressStartRef.current;

    if (!start) return;

    const movedX = Math.abs(event.clientX - start.x);
    const movedY = Math.abs(event.clientY - start.y);

    if (
      movedX > LONG_PRESS_MOVE_TOLERANCE ||
      movedY > LONG_PRESS_MOVE_TOLERANCE
    ) {
      clearLongPress();
    }
  };

  const handleTouchPointerEnd = () => {
    clearLongPress();
  };

  const handleContentClick = () => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }

    setIsEditing(true);
  };

  const setCopyResult = (result: CopyFeedback) => {
    setCopyFeedback(result);

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 1600);
  };

  const copyEntry = async () => {
    if (disabled) return;

    try {
      await copyToClipboard(entry.content);
      setCopyResult("copied");
    } catch {
      setCopyResult("failed");
    }
  };

  const remove = async () => {
    const descendantNotice = entry.child_count
      ? `\n子項目 ${entry.child_count}件も一緒に削除されます。`
      : "";

    const confirmed = window.confirm(
      `この項目を削除しますか？${descendantNotice}`,
    );

    if (!confirmed) return;

    await onDelete(entry.id);
  };

  const style = {
    "--entry-depth": Math.min(entry.depth, 6),
  } as CSSProperties;

  const hierarchyKeyShortcuts = isHierarchical
    ? "Tab Shift+Tab Control+Shift+ArrowRight Control+Shift+ArrowLeft Control+Shift+ArrowUp Control+Shift+ArrowDown"
    : undefined;

  const copyLabel =
    copyFeedback === "copied"
      ? "コピーしました"
      : copyFeedback === "failed"
        ? "コピーできませんでした"
        : "この項目をコピー";

  if (isEditing) {
    return (
      <article
        className={`entry-item entry-item--editing ${
          isHierarchical ? "entry-item--hierarchical" : ""
        }`}
        style={style}
      >
        {isParagraph ? (
          <textarea
            ref={(element) => {
              inputRef.current = element;
            }}
            value={value}
            disabled={disabled || isSaving}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onBlur={() => void save()}
            rows={4}
            aria-label="Paragraphを編集"
          />
        ) : (
          <input
            ref={(element) => {
              inputRef.current = element;
            }}
            value={value}
            disabled={disabled || isSaving}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onBlur={() => void save()}
            aria-label={`${kind}を編集`}
            aria-keyshortcuts={hierarchyKeyShortcuts}
          />
        )}

        <div className="entry-item__edit-actions">
          <button
            type="button"
            className="text-button text-button--danger"
            onMouseDown={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            削除
          </button>

          <button
            type="button"
            className="text-button"
            onMouseDown={(event) => {
              event.preventDefault();
              cancel();
            }}
          >
            取り消す
          </button>

          <button
            type="button"
            className="text-button text-button--strong"
            onMouseDown={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            保存
          </button>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`entry-item ${
        isHierarchical ? "entry-item--hierarchical" : ""
      } ${isStructureOpen ? "entry-item--structure-open" : ""} ${
        isMobileActionOpen ? "entry-item--mobile-action-open" : ""
      }`}
      style={style}
    >
      <div className="entry-item__row">
        {isHierarchical ? (
          <span className="entry-item__tree-marker" aria-hidden="true" />
        ) : null}

        <button
          type="button"
          className="entry-item__content"
          onClick={handleContentClick}
          onKeyDown={handleReadOnlyKeyDown}
          onPointerDown={handleTouchPointerDown}
          onPointerMove={handleTouchPointerMove}
          onPointerUp={handleTouchPointerEnd}
          onPointerCancel={handleTouchPointerEnd}
          disabled={disabled}
          aria-label="編集する。長押しで並び替えと階層操作。"
          aria-keyshortcuts={hierarchyKeyShortcuts}
        >
          {entry.content}
        </button>

        <div className="entry-item__quick-actions">
          <button
            type="button"
            className="icon-button entry-item__quick-action entry-item__copy"
            onClick={() => void copyEntry()}
            disabled={disabled}
            aria-label={copyLabel}
            title={copyLabel}
          >
            {copyFeedback === "copied" ? "✓" : copyFeedback === "failed" ? "!" : "⧉"}
          </button>

          {isHierarchical ? (
            <button
              type="button"
              className="icon-button entry-item__quick-action entry-item__structure-button"
              onClick={() => onOpenStructure(entry.id)}
              disabled={disabled}
              aria-label={
                isStructureOpen || isMobileActionOpen
                  ? "構造操作を閉じる"
                  : "構造操作を開く"
              }
              aria-expanded={isStructureOpen || isMobileActionOpen}
              title="子の追加・並び替え・階層操作"
            >
              ⋯
            </button>
          ) : null}

          <button
            type="button"
            className="icon-button entry-item__quick-action entry-item__delete"
            onClick={() => void remove()}
            disabled={disabled}
            aria-label="この項目を削除"
            title="この項目を削除"
          >
            ×
          </button>
        </div>
      </div>

      <span className="visually-hidden" aria-live="polite">
        {copyFeedback === "copied"
          ? "この項目をコピーしました。"
          : copyFeedback === "failed"
            ? "コピーできませんでした。"
            : ""}
      </span>

      {isHierarchical && isStructureOpen ? (
        <div className="entry-item__structure-actions" aria-label="構造操作">
          <button
            type="button"
            className="structure-action structure-action--child"
            onClick={() => onAddChild(entry.id)}
            disabled={disabled}
          >
            ＋ 子を追加
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onMove(entry.id, "up")}
            disabled={disabled || !entry.can_move_up}
            title="同じ階層で上へ移動"
          >
            ↑ 上へ
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onMove(entry.id, "down")}
            disabled={disabled || !entry.can_move_down}
            title="同じ階層で下へ移動"
          >
            ↓ 下へ
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onOutdent(entry.id)}
            disabled={disabled || !entry.can_outdent}
            title="親と同じ階層に戻す"
          >
            ← 戻す
          </button>

          <button
            type="button"
            className="structure-action"
            onClick={() => void onIndent(entry.id)}
            disabled={disabled || !entry.can_indent}
            title="ひとつ上の項目の子にする"
          >
            → 下げる
          </button>

          <button
            type="button"
            className="structure-action structure-action--danger"
            onClick={() => void remove()}
            disabled={disabled}
          >
            削除
          </button>
        </div>
      ) : null}
    </article>
  );
}
