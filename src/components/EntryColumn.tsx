import { useEffect, useRef, useState } from "react";
import {
  EntryComposer,
  type EntryComposerHandle,
} from "./EntryComposer";
import { EntryItem } from "./EntryItem";
import { MobileEntryActionSheet } from "./MobileEntryActionSheet";
import type { EntryTagSummary } from "../lib/memoTags";
import {
  ENTRY_LIST_DISPLAY_MODE_LABEL,
  getEntryTagGroupStateKey,
  groupEntriesByTag,
  readEntryListDisplayMode,
  readEntryTagGroupExpandedState,
  type EntryListDisplayMode,
  writeEntryListDisplayMode,
  writeEntryTagGroupExpandedState,
} from "../lib/entryTagGroups";
import { UndoToast } from "./UndoToast";
import {
  type EntryDeletionResult,
  type EntryKind,
  type EntryInsertPosition,
  type EntryMoveDirection,
  type EntryUpdate,
  type EntryTreeNode,
  ENTRY_KIND_LABEL,
  supportsHierarchy,
} from "../types/memo";

type EntryColumnProps = {
  kind: EntryKind;
  entries: EntryTreeNode[];
  isActiveOnMobile: boolean;
  /** 各項目の作成日時を表示するか。 */
  showCreatedAt: boolean;
  /** 振り番を画面に含めるか。 */
  showEntryNumbers: boolean;
  /** 本文だけを密に眺める簡易表示か。 */
  compactView?: boolean;
  /** 現在のメモで使われている項目タグ。候補表示だけに使う。 */
  tagSuggestions: EntryTagSummary[];
  /** 新規メモ作成直後、対象区分の入力欄へ一度だけフォーカスする。 */
  autoFocusComposer?: boolean;
  /** メモ切替時に自動フォーカス済みの記録をリセットするためのキー。 */
  autoFocusKey?: string;
  /** trueなら新しい項目を同じ階層の末尾へ、falseなら先頭へ置く。 */
  addAtBottom?: boolean;
  onAutoFocusHandled?: () => void;
  disabled?: boolean;
  onCreate: (
    kind: EntryKind,
    content: string,
    parentId?: string | null,
    position?: EntryInsertPosition,
  ) => Promise<unknown>;
  onUpdate: (entryId: string, patch: EntryUpdate) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<EntryDeletionResult>;
  onRestore: (entryIds: string[]) => Promise<void>;
  onDeleteAll: (kind: EntryKind) => Promise<number>;
  /** 現在のコピー設定に応じた、区分単位のコピー対象件数。 */
  copyableEntryCount: number;
  /** 完了済みもコピー対象に含めるか。 */
  copyIncludesCompleted: boolean;
  /** 単語 / 文 / 段落ごとのテキストをコピーする。 */
  onCopy: (kind: EntryKind) => Promise<void>;
  /** 「…」から、1項目の本文だけをコピーする。trueならコピー成功。 */
  onCopyEntry: (content: string) => Promise<boolean>;
  /** 元の項目を残したまま、新しい大きなメモへ展開する。 */
  onCreateMemoFromEntry: (entryId: string) => Promise<unknown>;
  isCopying?: boolean;
  onMove: (entryId: string, direction: EntryMoveDirection) => Promise<unknown>;
  onMoveToKind: (entryId: string, targetKind: EntryKind) => Promise<unknown>;
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
  showCreatedAt,
  showEntryNumbers,
  compactView = false,
  tagSuggestions,
  autoFocusComposer = false,
  autoFocusKey,
  addAtBottom = false,
  onAutoFocusHandled,
  disabled = false,
  onCreate,
  onUpdate,
  onDelete,
  onRestore,
  onDeleteAll,
  copyableEntryCount,
  copyIncludesCompleted,
  onCopy,
  onCopyEntry,
  onCreateMemoFromEntry,
  isCopying = false,
  onMove,
  onMoveToKind,
}: EntryColumnProps) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [structureEntryId, setStructureEntryId] = useState<string | null>(null);
  const [mobileActionEntryId, setMobileActionEntryId] = useState<string | null>(
    null,
  );
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isCompletedCollapsed, setIsCompletedCollapsed] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  /** 単語／文／段落ごとに記憶する表示方法。初期状態は従来の通常表示。 */
  const [displayMode, setDisplayMode] = useState<EntryListDisplayMode>(
    () => readEntryListDisplayMode(kind),
  );
  /** タググループは初期状態では閉じ、開閉だけをブラウザ内に記憶する。 */
  const [expandedTagGroups, setExpandedTagGroups] = useState(
    readEntryTagGroupExpandedState,
  );

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

  const openEntries = entries.filter((entry) => !entry.is_completed);
  const completedEntries = entries.filter((entry) => entry.is_completed);
  const isTagGrouped = displayMode === "tag_grouped";

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

  // タブ切替後に、非表示の列のボトムシート・小メニューが前面へ残らないようにする。
  useEffect(() => {
    if (!isActiveOnMobile) {
      setMobileActionEntryId(null);
      setStructureEntryId(null);
      setIsHeaderMenuOpen(false);
    }
  }, [isActiveOnMobile]);

  // 本文だけ表示中は、隠した操作シートや追加先の状態を残さない。
  useEffect(() => {
    if (!compactView) return;

    setParentId(null);
    setStructureEntryId(null);
    setMobileActionEntryId(null);
    setIsHeaderMenuOpen(false);
  }, [compactView]);

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
    didAutoFocusRef.current = false;
  }, [autoFocusKey]);

  useEffect(() => {
    writeEntryListDisplayMode(kind, displayMode);
  }, [displayMode, kind]);

  useEffect(() => {
    if (!autoFocusComposer || !isActiveOnMobile || didAutoFocusRef.current) {
      return;
    }

    didAutoFocusRef.current = true;

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
    await onCreate(
      kind,
      content,
      isHierarchical ? parentId : null,
      addAtBottom ? "bottom" : "top",
    );
  };

  const openUndo = (deletion: EntryDeletionResult) => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }

    const message = deletion.child_count > 0
      ? `「${deletion.content}」と下の項目${deletion.child_count}件を削除しました`
      : `「${deletion.content}」を削除しました`;

    setPendingUndo({ deletion, message });
    undoTimerRef.current = window.setTimeout(() => {
      setPendingUndo(null);
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };

  const requestCopyEntry = async (entryId: string): Promise<boolean> => {
    const target = entries.find((entry) => entry.id === entryId);

    if (!target || disabled || isDeletingAll) return false;

    const copied = await onCopyEntry(target.content);

    if (!copied) return false;

    setStructureEntryId(null);
    setMobileActionEntryId(null);
    return true;
  };

  /** 項目を残したまま、別メモの最初の項目として複製して開く。 */
  const requestCreateMemoFromEntry = async (entryId: string): Promise<boolean> => {
    const target = entries.find((entry) => entry.id === entryId);

    if (!target || disabled || isDeletingAll) return false;

    try {
      await onCreateMemoFromEntry(entryId);
      setStructureEntryId(null);
      setMobileActionEntryId(null);
      return true;
    } catch {
      // 親の保存エラー表示をそのまま使い、メニューを勝手に閉じない。
      return false;
    }
  };

  const requestDelete = async (entryId: string) => {
    const target = entries.find((entry) => entry.id === entryId);

    if (!target || disabled || isDeletingAll) return;

    if (target.child_count > 0) {
      const confirmed = window.confirm(
        `「${target.content}」の下には${target.child_count}件あります。\n合計${target.child_count + 1}件をまとめて削除しますか？\n削除後は［元に戻す］で戻せます。`,
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

  const handleCopy = async () => {
    if (disabled || isDeletingAll || isCopying || copyableEntryCount === 0) {
      return;
    }

    await onCopy(kind);
  };

  const handleDeleteAll = async () => {
    if (entries.length === 0 || disabled || isDeletingAll) return;

    const hierarchyNotice = isHierarchical
      ? "\n下にある項目も含めて削除されます。"
      : "";

    const confirmed = window.confirm(
      `${ENTRY_KIND_LABEL[kind]}をすべて削除しますか？\n${entries.length}件が削除されます。${hierarchyNotice}\nこの操作は元に戻せません。`,
    );

    if (!confirmed) return;

    setIsHeaderMenuOpen(false);
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
    { keepMenuOpen = false }: { keepMenuOpen?: boolean } = {},
  ) => {
    await action(entryId);

    if (keepMenuOpen) return;

    setStructureEntryId(null);
    setMobileActionEntryId(null);
  };

  /**
   * 種別移動の前に、下にぶら下がる項目がある場合だけ確認する。
   * 本人の文章を勝手に別の区分へ変えず、下の項目は元の区分に残す。
   */
  const requestMoveToKind = async (
    entryId: string,
    targetKind: EntryKind,
  ): Promise<boolean> => {
    const target = entries.find((entry) => entry.id === entryId);

    if (!target || disabled || isDeletingAll) return false;

    if (target.child_count > 0) {
      const confirmed = window.confirm(
        `「${target.content}」には下の項目が${target.child_count}件あります。
この項目だけを「${ENTRY_KIND_LABEL[targetKind]}」へ移動します。
下の項目は元の区分に残ります。`,
      );

      if (!confirmed) return false;
    }

    await onMoveToKind(entryId, targetKind);
    setParentId(null);
    setStructureEntryId(null);
    setMobileActionEntryId(null);
    return true;
  };

  const toggleCompleted = async (entryId: string) => {
    const target = entries.find((entry) => entry.id === entryId);
    if (!target) return;

    await onUpdate(entryId, { is_completed: !target.is_completed });
    setStructureEntryId(null);
    setMobileActionEntryId(null);
  };

  const renderEntry = (entry: EntryTreeNode) => (
    <EntryItem
      key={entry.id}
      entry={entry}
      kind={kind}
      isStructureOpen={structureEntryId === entry.id}
      isMobileActionOpen={mobileActionEntryId === entry.id}
      showCreatedAt={showCreatedAt}
      showEntryNumbers={showEntryNumbers}
      compactView={compactView}
      tagSuggestions={tagSuggestions}
      disabled={disabled || isDeletingAll}
      onOpenStructure={openStructureActions}
      onAddChild={selectParent}
      onMove={(entryId, direction) =>
        runStructureAction(
          (id) => onMove(id, direction),
          entryId,
          { keepMenuOpen: direction === "up" || direction === "down" },
        )
      }
      onMoveToKind={requestMoveToKind}
      onCopy={requestCopyEntry}
      onCreateMemoFromEntry={requestCreateMemoFromEntry}
      onUpdate={onUpdate}
      onDelete={requestDelete}
    />
  );

  const toggleTagGroup = (tag: string) => {
    const stateKey = getEntryTagGroupStateKey(kind, tag);
    const nextState = {
      ...expandedTagGroups,
      [stateKey]: !(expandedTagGroups[stateKey] ?? false),
    };

    setExpandedTagGroups(nextState);
    writeEntryTagGroupExpandedState(nextState);
  };

  const renderTagGroupedEntries = (
    sourceEntries: EntryTreeNode[],
    sectionKey: string,
  ) => {
    const grouped = groupEntriesByTag(sourceEntries);

    return (
      <>
        {grouped.untagged.map(renderEntry)}

        {grouped.groups.map((group) => {
          const stateKey = getEntryTagGroupStateKey(kind, group.label);
          const isExpanded = expandedTagGroups[stateKey] ?? false;

          return (
            <section
              key={`${sectionKey}-${group.key}`}
              className="entry-list__tag-group"
              aria-label={`タグ「${group.label}」の項目`}
            >
              <button
                type="button"
                className="entry-list__tag-group-toggle"
                onClick={() => toggleTagGroup(group.label)}
                aria-expanded={isExpanded}
              >
                <span className="entry-list__tag-group-label">{group.label}</span>
                <span className="entry-list__tag-group-count">{group.entries.length}件</span>
                <span className="entry-list__tag-group-chevron" aria-hidden="true">
                  {isExpanded ? "⌃" : "⌄"}
                </span>
              </button>

              {isExpanded ? (
                <div className="entry-list__tag-group-items">
                  {group.entries.map(renderEntry)}
                </div>
              ) : null}
            </section>
          );
        })}
      </>
    );
  };

  return (
    <section
      className={`entry-column entry-column--${kind} ${
        isActiveOnMobile ? "entry-column--active" : ""
      } ${compactView ? "entry-column--compact" : ""}`}
      aria-labelledby={`${kind}-heading`}
    >
      <div className="entry-column__header">
        <h2 id={`${kind}-heading`}>{ENTRY_KIND_LABEL[kind]}</h2>

        <div className="entry-column__header-actions">
          <span className="entry-column__count">{entries.length}</span>
          <label className="entry-column__display-mode">
            <span>表示</span>
            <select
              value={displayMode}
              onChange={(event) =>
                setDisplayMode(event.target.value as EntryListDisplayMode)
              }
              aria-label={`${ENTRY_KIND_LABEL[kind]}の表示方法`}
            >
              {(Object.keys(ENTRY_LIST_DISPLAY_MODE_LABEL) as EntryListDisplayMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {ENTRY_LIST_DISPLAY_MODE_LABEL[mode]}
                </option>
              ))}
            </select>
          </label>
          {!compactView ? (
            <>
              <button
                type="button"
                className="entry-column__copy"
                onClick={() => void handleCopy()}
                disabled={
                  disabled ||
                  isDeletingAll ||
                  isCopying ||
                  copyableEntryCount === 0
                }
                aria-label={`${ENTRY_KIND_LABEL[kind]}をコピー`}
                title={copyIncludesCompleted ? "完了済みを含めてコピー" : "完了済みを除いてコピー"}
              >
                {isCopying ? "…" : "⧉"}
              </button>
              <div className="entry-column__header-menu">
                <button
                  type="button"
                  className="entry-column__more"
                  onClick={() => setIsHeaderMenuOpen((open) => !open)}
                  disabled={disabled || isDeletingAll || entries.length === 0}
                  aria-label={`${ENTRY_KIND_LABEL[kind]}の整理メニュー`}
                  aria-expanded={isHeaderMenuOpen}
                  title="整理"
                >
                  ⋯
                </button>
                {isHeaderMenuOpen ? (
                  <div className="entry-column__menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="entry-column__menu-delete"
                      onClick={() => void handleDeleteAll()}
                      disabled={disabled || isDeletingAll || entries.length === 0}
                    >
                      すべて削除
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {!compactView ? (
        <EntryComposer
          ref={composerRef}
          kind={kind}
          disabled={disabled || isDeletingAll}
          targetLabel={isHierarchical ? parentEntry?.content ?? null : null}
          onClearTarget={() => setParentId(null)}
          onSubmit={handleCreate}
        />
      ) : null}

      <div className="entry-list" aria-live="polite">
        {entries.length === 0 ? (
          <p className="entry-list__empty">まだありません。</p>
        ) : compactView ? (
          isTagGrouped
            ? renderTagGroupedEntries(entries, "compact")
            : entries.map(renderEntry)
        ) : (
          <>
            {isTagGrouped
              ? renderTagGroupedEntries(openEntries, "open")
              : openEntries.map(renderEntry)}

            {completedEntries.length > 0 ? (
              <section className="entry-list__completed-section" aria-label="完了済み">
                <button
                  type="button"
                  className="entry-list__completed-toggle"
                  onClick={() => setIsCompletedCollapsed((collapsed) => !collapsed)}
                  aria-expanded={!isCompletedCollapsed}
                >
                  <span>完了 {completedEntries.length}件</span>
                  <span aria-hidden="true">{isCompletedCollapsed ? "›" : "⌄"}</span>
                </button>
                {!isCompletedCollapsed ? (
                  <div className="entry-list__completed-items">
                    {isTagGrouped
                      ? renderTagGroupedEntries(completedEntries, "completed")
                      : completedEntries.map(renderEntry)}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>

      {isActiveOnMobile && !compactView ? (
        <MobileEntryActionSheet
          entry={mobileActionEntry}
          kind={kind}
          showEntryNumbers={showEntryNumbers}
          disabled={disabled || isDeletingAll}
          onClose={() => setMobileActionEntryId(null)}
          onToggleCompleted={toggleCompleted}
          onAddChild={selectParent}
          onMove={(entryId, direction) =>
            runStructureAction(
              (id) => onMove(id, direction),
              entryId,
              { keepMenuOpen: direction === "up" || direction === "down" },
            )
          }
          onMoveToKind={requestMoveToKind}
          onCopy={requestCopyEntry}
          onCreateMemoFromEntry={requestCreateMemoFromEntry}
          onDelete={requestDelete}
        />
      ) : null}

      {!compactView && pendingUndo ? (
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
