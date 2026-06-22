import { useEffect, useRef, useState } from "react";
import {
  EntryComposer,
  type EntryComposerHandle,
} from "./EntryComposer";
import { EntryItem } from "./EntryItem";
import { MobileEntryActionSheet } from "./MobileEntryActionSheet";
import { UndoToast } from "./UndoToast";
import {
  type EntryDeletionResult,
  type EntryKind,
  type EntryTreeNode,
  ENTRY_KIND_GUIDE,
  ENTRY_KIND_LABEL,
  supportsHierarchy,
} from "../types/memo";

type EntryColumnProps = {
  kind: EntryKind;
  entries: EntryTreeNode[];
  isActiveOnMobile: boolean;
  /** 新規メモ作成直後、Wordの入力欄へ一度だけフォーカスする。 */
  autoFocusComposer?: boolean;
  onAutoFocusHandled?: () => void;
  disabled?: boolean;
  onCreate: (
    kind: EntryKind,
    content: string,
    parentId?: string | null,
  ) => Promise<unknown>;
  onUpdate: (entryId: string, content: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<EntryDeletionResult>;
  onRestore: (entryIds: string[]) => Promise<void>;
  onDeleteAll: (kind: EntryKind) => Promise<number>;
  onIndent: (entryId: string) => Promise<unknown>;
  onOutdent: (entryId: string) => Promise<unknown>;
  onMove: (entryId: string, direction: "up" | "down") => Promise<unknown>;
};

type PendingUndo = {
  deletion: EntryDeletionResult;
  message: string;
};

const UNDO_WINDOW_MS = 5_500;

function isMobileViewport() {
  return window.matchMedia("(max-width: 920px)").matches;
}

export function EntryColumn({
  kind,
  entries,
  isActiveOnMobile,
  autoFocusComposer = false,
  onAutoFocusHandled,
  disabled = false,
  onCreate,
  onUpdate,
  onDelete,
  onRestore,
  onDeleteAll,
  onIndent,
  onOutdent,
  onMove,
}: EntryColumnProps) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [structureEntryId, setStructureEntryId] = useState<string | null>(null);
  const [mobileActionEntryId, setMobileActionEntryId] = useState<string | null>(
    null,
  );
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const composerRef = useRef<EntryComposerHandle | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const didAutoFocusRef = useRef(false);
  const isHierarchical = supportsHierarchy(kind);

  const parentEntry = parentId
    ? entries.find((entry) => entry.id === parentId) ?? null
    : null;

  const mobileActionEntry = mobileActionEntryId
    ? entries.find((entry) => entry.id === mobileActionEntryId) ?? null
    : null;

  const clearUndo = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setPendingUndo(null);
  };

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (parentId && !parentEntry) {
      setParentId(null);
    }
  }, [parentEntry, parentId]);

  useEffect(() => {
    if (
      structureEntryId &&
      !entries.some((entry) => entry.id === structureEntryId)
    ) {
      setStructureEntryId(null);
    }

    if (
      mobileActionEntryId &&
      !entries.some((entry) => entry.id === mobileActionEntryId)
    ) {
      setMobileActionEntryId(null);
    }
  }, [entries, mobileActionEntryId, structureEntryId]);

  useEffect(() => {
    if (!autoFocusComposer || !isActiveOnMobile || didAutoFocusRef.current) {
      return;
    }

    didAutoFocusRef.current = true;

    // 新規作成ボタンのタップから最短で入力へ渡す。
    // 固定コンポーザーなので、スクロールのアニメーションを挟まない。
    const frame = window.requestAnimationFrame(() => {
      composerRef.current?.focus({ scroll: false, delay: 0 });
      onAutoFocusHandled?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusComposer, isActiveOnMobile, onAutoFocusHandled]);

  const selectParent = (entryId: string) => {
    setParentId(entryId);
    setStructureEntryId(null);
    setMobileActionEntryId(null);

    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const openStructureActions = (entryId: string) => {
    if (isMobileViewport()) {
      setMobileActionEntryId(entryId);
      setStructureEntryId(null);
      return;
    }

    setStructureEntryId((current) => (current === entryId ? null : entryId));
  };

  const handleCreate = async (content: string) => {
    await onCreate(kind, content, isHierarchical ? parentId : null);
  };

  const openUndo = (deletion: EntryDeletionResult) => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }

    const message = deletion.child_count > 0
      ? `「${deletion.content}」と子項目${deletion.child_count}件を削除しました`
      : `「${deletion.content}」を削除しました`;

    setPendingUndo({ deletion, message });
    undoTimerRef.current = window.setTimeout(() => {
      setPendingUndo(null);
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };

  const requestDelete = async (entryId: string) => {
    const target = entries.find((entry) => entry.id === entryId);

    if (!target || disabled || isDeletingAll) return;

    // 親を消すときだけ、巻き込まれる子の件数を明示して確認する。
    if (target.child_count > 0) {
      const confirmed = window.confirm(
        `「${target.content}」には子項目が${target.child_count}件あります。
親子${target.child_count + 1}件をまとめて削除しますか？
削除後は［元に戻す］で復元できます。`,
      );

      if (!confirmed) return;
    }

    const deletion = await onDelete(entryId);

    if (parentId === entryId) {
      setParentId(null);
    }

    setStructureEntryId(null);
    setMobileActionEntryId(null);
    openUndo(deletion);
  };

  const handleUndo = async () => {
    if (!pendingUndo || isUndoing) return;

    setIsUndoing(true);

    try {
      await onRestore(pendingUndo.deletion.entry_ids);
      clearUndo();
    } finally {
      setIsUndoing(false);
    }
  };

  const handleDeleteAll = async () => {
    if (entries.length === 0 || disabled || isDeletingAll) return;

    const hierarchyNotice = isHierarchical
      ? "\n親子構造も含めて削除されます。"
      : "";

    const confirmed = window.confirm(
      `${ENTRY_KIND_LABEL[kind]}をすべて削除しますか？
${entries.length}件が削除されます。${hierarchyNotice}
この操作は元に戻せません。`,
    );

    if (!confirmed) return;

    setIsDeletingAll(true);

    try {
      await onDeleteAll(kind);
      setParentId(null);
      setStructureEntryId(null);
      setMobileActionEntryId(null);
      clearUndo();
    } finally {
      setIsDeletingAll(false);
    }
  };

  const runStructureAction = async (
    action: (entryId: string) => Promise<unknown>,
    entryId: string,
  ) => {
    await action(entryId);
    setStructureEntryId(null);
    setMobileActionEntryId(null);
  };

  return (
    <section
      className={`entry-column entry-column--${kind} ${
        isActiveOnMobile ? "entry-column--active" : ""
      }`}
      aria-labelledby={`${kind}-heading`}
    >
      <div className="entry-column__header">
        <div>
          <h2 id={`${kind}-heading`}>{ENTRY_KIND_LABEL[kind]}</h2>
          <p>{ENTRY_KIND_GUIDE[kind]}</p>
        </div>

        <div className="entry-column__header-actions">
          <span className="entry-column__count">{entries.length}</span>
          <button
            type="button"
            className="entry-column__delete-all"
            onClick={() => void handleDeleteAll()}
            disabled={disabled || isDeletingAll || entries.length === 0}
            aria-label={`${ENTRY_KIND_LABEL[kind]}をすべて削除`}
            title={`${ENTRY_KIND_LABEL[kind]}をすべて削除`}
          >
            <span aria-hidden="true">⌫</span>
            すべて削除
          </button>
        </div>
      </div>

      {isHierarchical ? (
        <p className="entry-column__hierarchy-guide">
          <span className="entry-column__guide-mobile">
            タップで編集。長押し / <span>⋯</span> で、子・順番・階層を整える。
          </span>

          <span className="entry-column__guide-desktop">
            <strong>PC:</strong> <kbd>Tab</kbd> 下げる ／ <kbd>Shift</kbd> + <kbd>Tab</kbd> 戻す
            <br />
            <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>← →</kbd> でも階層 ／
            <kbd>↑ ↓</kbd> で同階層を移動
          </span>
        </p>
      ) : (
        <p className="entry-column__hierarchy-guide entry-column__hierarchy-guide--plain">
          長めに書く場所。Paragraphは階層をつけず、流れのまま置けます。
        </p>
      )}

      <EntryComposer
        ref={composerRef}
        kind={kind}
        disabled={disabled || isDeletingAll}
        targetLabel={isHierarchical ? parentEntry?.content ?? null : null}
        onClearTarget={() => setParentId(null)}
        onSubmit={handleCreate}
      />

      <div className="entry-list" aria-live="polite">
        {entries.length === 0 ? (
          <p className="entry-list__empty">まだ何も置かれていません。</p>
        ) : (
          entries.map((entry) => (
            <EntryItem
              key={entry.id}
              entry={entry}
              kind={kind}
              isStructureOpen={structureEntryId === entry.id}
              isMobileActionOpen={mobileActionEntryId === entry.id}
              disabled={disabled || isDeletingAll}
              onOpenStructure={openStructureActions}
              onAddChild={selectParent}
              onIndent={(entryId) => runStructureAction(onIndent, entryId)}
              onOutdent={(entryId) => runStructureAction(onOutdent, entryId)}
              onMove={(entryId, direction) =>
                runStructureAction((id) => onMove(id, direction), entryId)
              }
              onUpdate={onUpdate}
              onDelete={requestDelete}
            />
          ))
        )}
      </div>

      {isHierarchical ? (
        <MobileEntryActionSheet
          entry={mobileActionEntry}
          kind={kind}
          disabled={disabled || isDeletingAll}
          onClose={() => setMobileActionEntryId(null)}
          onAddChild={selectParent}
          onIndent={(entryId) => runStructureAction(onIndent, entryId)}
          onOutdent={(entryId) => runStructureAction(onOutdent, entryId)}
          onMove={(entryId, direction) =>
            runStructureAction((id) => onMove(id, direction), entryId)
          }
          onDelete={requestDelete}
        />
      ) : null}

      {pendingUndo ? (
        <UndoToast
          kind={kind}
          message={pendingUndo.message}
          isUndoing={isUndoing}
          onUndo={() => void handleUndo()}
          onDismiss={clearUndo}
        />
      ) : null}
    </section>
  );
}
