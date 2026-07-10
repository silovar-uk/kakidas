import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  EntryComposer,
  type EntryComposerHandle,
} from "./EntryComposer";
import { EntryItem } from "./EntryItem";
import { MobileEntryActionSheet } from "./MobileEntryActionSheet";
import type { EntryTagSummary } from "../lib/memoTags";
import {
  ENTRY_LIST_DISPLAY_MODE_LABEL,
  getEntryCompletedGroupStateKey,
  getEntryTagGroupStateKey,
  getEntryTagToneClassName,
  getLegacyEntryTagGroupStateKey,
  groupEntriesByTag,
  readEntryListDisplayMode,
  readEntryTagGroupExpandedState,
  readEntryTagOrderLocked,
  type EntryListDisplayMode,
  writeEntryListDisplayMode,
  writeEntryTagGroupExpandedState,
  writeEntryTagOrderLocked,
} from "../lib/entryTagGroups";
import { UndoToast } from "./UndoToast";
import {
  type EntryCreateMetadata,
  type EntryDeletionResult,
  type EntryKind,
  type EntryInsertPosition,
  type EntryUpdate,
  type EntryTreeNode,
  ENTRY_KIND_LABEL,
  normalizeEntryTag,
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
    metadata?: EntryCreateMetadata,
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
  onMoveToKind: (entryId: string, targetKind: EntryKind) => Promise<unknown>;
  /** タグでまとめる見出しから、現在の区分にある同名タグを一括変更する。 */
  onRenameTag: (currentTag: string, nextTag: string) => Promise<unknown>;
};

type PendingUndo = {
  deletion: EntryDeletionResult;
  message: string;
};

type EntryTagPresentation = "meta" | "group_action" | "completed_meta";
type FoldableGroupType = "untagged" | "tag" | "completed";

type TagRenameState = {
  sourceTag: string;
  stateKey: string;
  legacyStateKey?: string;
  draft: string;
  error: string | null;
};

type TagGroupComposerState = {
  tag: string;
  stateKey: string;
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
  onMoveToKind,
  onRenameTag,
}: EntryColumnProps) {
  const [structureEntryId, setStructureEntryId] = useState<string | null>(null);
  const [mobileActionEntryId, setMobileActionEntryId] = useState<string | null>(
    null,
  );
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isCompletedCollapsed, setIsCompletedCollapsed] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  /** 単語／文／段落ごとに記憶する表示方法。未設定の区分はタグでまとめる。 */
  const [displayMode, setDisplayMode] = useState<EntryListDisplayMode>(
    () => readEntryListDisplayMode(kind),
  );
  /** ONなら、未完了項目の現在の表示順をこの画面の間だけ保つ。未設定の区分はONから始める。 */
  const [isTagOrderLocked, setIsTagOrderLocked] = useState(
    () => readEntryTagOrderLocked(kind),
  );
  /** タググループは初期状態では閉じ、開閉だけをブラウザ内に記憶する。 */
  const [expandedTagGroups, setExpandedTagGroups] = useState(
    readEntryTagGroupExpandedState,
  );
  const [tagRenameState, setTagRenameState] = useState<TagRenameState | null>(null);
  const [isRenamingTag, setIsRenamingTag] = useState(false);
  /** 未完了タグ見出しから開く、固定タグ付きの簡易入力欄。 */
  const [tagGroupComposerState, setTagGroupComposerState] = useState<TagGroupComposerState | null>(null);
  /** 順番固定ONでは、未完了だけの相対順を画面内で保つ。完了項目は常に別グループへ送る。 */
  const lockedOpenEntryOrderRef = useRef<Map<string, number>>(new Map());
  const lockedTagGroupOrderRef = useRef<Map<string, number>>(new Map());

  const composerRef = useRef<EntryComposerHandle | null>(null);
  const tagGroupComposerRef = useRef<EntryComposerHandle | null>(null);
  const tagRenameInputRef = useRef<HTMLInputElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const didAutoFocusRef = useRef(false);
  const isHierarchical = supportsHierarchy(kind);

  const mobileActionEntry = mobileActionEntryId
    ? entries.find((entry) => entry.id === mobileActionEntryId) ?? null
    : null;

  const openEntries = entries.filter((entry) => !entry.is_completed);
  const completedEntries = entries.filter((entry) => entry.is_completed);
  const isTagGrouped = displayMode === "tag_grouped";

  /**
   * 順番固定ONでは、未完了項目の相対順とタググループの順をこの画面の間だけ保つ。
   * 完了済みはここへ混ぜず、常に下部の「完了」グループへ分ける。
   */
  const getOpenTagGroups = (sourceEntries: EntryTreeNode[]) => {
    const grouped = groupEntriesByTag(sourceEntries);

    if (!isTagOrderLocked) return grouped;

    const entryOrder = lockedOpenEntryOrderRef.current;
    const groupOrder = lockedTagGroupOrderRef.current;
    const knownIds = new Set(entries.map((entry) => entry.id));

    for (const entryId of entryOrder.keys()) {
      if (!knownIds.has(entryId)) entryOrder.delete(entryId);
    }

    const nextEntryRank = () =>
      Math.max(-1, ...entryOrder.values()) + 1;
    let entryRank = nextEntryRank();

    sourceEntries.forEach((entry) => {
      if (!entryOrder.has(entry.id)) {
        entryOrder.set(entry.id, entryRank);
        entryRank += 1;
      }
    });

    const sortEntries = (groupEntries: EntryTreeNode[]) =>
      [...groupEntries].sort(
        (a, b) =>
          (entryOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (entryOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );

    const nextGroupRank = () =>
      Math.max(-1, ...groupOrder.values()) + 1;
    let groupRank = nextGroupRank();

    grouped.groups.forEach((group) => {
      const stateKey = getEntryTagGroupStateKey(kind, group.label);
      if (!groupOrder.has(stateKey)) {
        groupOrder.set(stateKey, groupRank);
        groupRank += 1;
      }
    });

    return {
      untagged: sortEntries(grouped.untagged),
      groups: grouped.groups
        .map((group) => ({ ...group, entries: sortEntries(group.entries) }))
        .sort(
          (a, b) =>
            (groupOrder.get(getEntryTagGroupStateKey(kind, a.label)) ?? Number.MAX_SAFE_INTEGER) -
            (groupOrder.get(getEntryTagGroupStateKey(kind, b.label)) ?? Number.MAX_SAFE_INTEGER),
        ),
    };
  };

  /**
   * タグでまとめる時だけ、画面の振り番はグループごとに振り直す。
   * 保存済みの階層番号は変えず、通常表示・コピー・.txt出力は従来どおり
   * `outline_number` を使う。完了済みは一番下の「完了」グループ内で通番にする。
   */
  const tagGroupedDisplayNumbers = useMemo(() => {
    const numberByEntryId = new Map<string, string>();
    const assignNumbers = (groupEntries: EntryTreeNode[]) => {
      groupEntries.forEach((entry, index) => {
        numberByEntryId.set(entry.id, String(index + 1));
      });
    };

    const grouped = getOpenTagGroups(entries.filter((entry) => !entry.is_completed));

    assignNumbers(grouped.untagged);
    grouped.groups.forEach((group) => assignNumbers(group.entries));
    assignNumbers(entries.filter((entry) => entry.is_completed));

    return numberByEntryId;
  }, [entries, isTagOrderLocked]);

  const getEntryDisplayNumber = (entry: EntryTreeNode): string => {
    if (!isTagGrouped) return entry.outline_number;

    return tagGroupedDisplayNumbers.get(entry.id) ?? entry.outline_number;
  };

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

  // タブ切替後に、非表示の列のボトムシート・小メニューが前面へ残らないようにする。
  useEffect(() => {
    if (!isActiveOnMobile) {
      setMobileActionEntryId(null);
      setStructureEntryId(null);
      setIsHeaderMenuOpen(false);
      setTagGroupComposerState(null);
    }
  }, [isActiveOnMobile]);

  // 本文だけ表示中は、隠した操作シートや追加先の状態を残さない。
  useEffect(() => {
    if (!compactView) return;

    setStructureEntryId(null);
    setMobileActionEntryId(null);
    setIsHeaderMenuOpen(false);
    setTagGroupComposerState(null);
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
    writeEntryTagOrderLocked(kind, isTagOrderLocked);
  }, [isTagOrderLocked, kind]);

  useEffect(() => {
    if (!isTagGrouped || !isTagOrderLocked) {
      lockedOpenEntryOrderRef.current.clear();
      lockedTagGroupOrderRef.current.clear();
    }

    if (isTagGrouped) return;
    setTagRenameState(null);
    setTagGroupComposerState(null);
  }, [isTagGrouped, isTagOrderLocked]);

  /**
   * タグを押した直後だけ本文入力へフォーカスする。scrollIntoViewは使わず、
   * 既存グループを開かないため、スマホでも一覧の視界を急に動かさない。
   */
  useEffect(() => {
    if (!tagGroupComposerState || compactView || !isTagGrouped) return;

    const frame = window.requestAnimationFrame(() => {
      tagGroupComposerRef.current?.focus({ scroll: false, delay: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [compactView, isTagGrouped, tagGroupComposerState?.stateKey]);

  useEffect(() => {
    if (!tagRenameState) return;

    const frame = window.requestAnimationFrame(() => {
      tagRenameInputRef.current?.focus();
      tagRenameInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [tagRenameState?.stateKey]);

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

  const openStructureActions = (entryId: string) => {
    if (isMobileViewport()) {
      setMobileActionEntryId(entryId);
      setStructureEntryId(null);
      return;
    }

    setStructureEntryId((current) => (current === entryId ? null : entryId));
  };

  const handleCreate = async (
    content: string,
    metadata: EntryCreateMetadata,
  ) => {
    await onCreate(
      kind,
      content,
      metadata,
      null,
      addAtBottom ? "bottom" : "top",
    );
  };

  /** タグ見出しからの追加は、見出しのタグを固定して保存する。 */
  const handleCreateForTagGroup = async (
    tag: string,
    content: string,
    metadata: EntryCreateMetadata,
  ) => {
    await onCreate(
      kind,
      content,
      { ...metadata, tag },
      null,
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

    const copied = await onCopyEntry(
      target.kind === "paragraph" && target.heading
        ? `${target.heading}\n${target.content}`
        : target.content,
    );

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
      setStructureEntryId(null);
      setMobileActionEntryId(null);
      clearUndo();
    } finally {
      setIsDeletingAll(false);
    }
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

  const renderEntry = (
    entry: EntryTreeNode,
    tagPresentation: EntryTagPresentation = "meta",
    displayNumber = getEntryDisplayNumber(entry),
  ) => (
    <EntryItem
      key={entry.id}
      entry={entry}
      kind={kind}
      isStructureOpen={structureEntryId === entry.id}
      isMobileActionOpen={mobileActionEntryId === entry.id}
      showCreatedAt={showCreatedAt}
      showEntryNumbers={showEntryNumbers}
      displayNumber={displayNumber}
      compactView={compactView}
      tagSuggestions={tagSuggestions}
      tagPresentation={tagPresentation}
      disabled={disabled || isDeletingAll}
      onOpenStructure={openStructureActions}
      onMoveToKind={requestMoveToKind}
      onCopy={requestCopyEntry}
      onCreateMemoFromEntry={requestCreateMemoFromEntry}
      onUpdate={onUpdate}
      onDelete={requestDelete}
    />
  );

  const toggleTagGroup = (stateKey: string) => {
    const nextState = {
      ...expandedTagGroups,
      [stateKey]: !(expandedTagGroups[stateKey] ?? false),
    };

    setExpandedTagGroups(nextState);
    writeEntryTagGroupExpandedState(nextState);
  };

  const toggleTagGroupComposer = (tag: string, stateKey: string) => {
    if (disabled || isDeletingAll || compactView) return;

    setTagRenameState(null);
    setTagGroupComposerState((current) => (
      current?.stateKey === stateKey ? null : { tag, stateKey }
    ));
  };

  const isTagGroupExpanded = (
    stateKey: string,
    legacyStateKey?: string,
  ): boolean => expandedTagGroups[stateKey] ?? (
    legacyStateKey ? expandedTagGroups[legacyStateKey] : undefined
  ) ?? false;

  const openTagRename = (
    sourceTag: string,
    stateKey: string,
    legacyStateKey?: string,
  ) => {
    if (disabled || isDeletingAll) return;

    setTagGroupComposerState(null);
    setTagRenameState({
      sourceTag,
      stateKey,
      legacyStateKey,
      draft: sourceTag,
      error: null,
    });
  };

  const handleTagRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!tagRenameState || disabled || isDeletingAll || isRenamingTag) {
      return;
    }

    const nextTag = normalizeEntryTag(tagRenameState.draft);

    if (!nextTag) {
      setTagRenameState((current) => current ? {
        ...current,
        error: "新しいタグ名を入力してください。",
      } : current);
      return;
    }

    const wasExpanded = isTagGroupExpanded(
      tagRenameState.stateKey,
      tagRenameState.legacyStateKey,
    );

    setIsRenamingTag(true);

    try {
      await onRenameTag(tagRenameState.sourceTag, nextTag);

      const nextStateKey = getEntryTagGroupStateKey(kind, nextTag);
      const nextExpandedState = { ...expandedTagGroups };

      if (nextStateKey !== tagRenameState.stateKey) {
        if (nextExpandedState[nextStateKey] === undefined) {
          nextExpandedState[nextStateKey] = wasExpanded;
        }
        delete nextExpandedState[tagRenameState.stateKey];
        if (tagRenameState.legacyStateKey) {
          delete nextExpandedState[tagRenameState.legacyStateKey];
        }
        setExpandedTagGroups(nextExpandedState);
        writeEntryTagGroupExpandedState(nextExpandedState);
      }

      setTagRenameState(null);
    } catch (error) {
      setTagRenameState((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : "タグ名を変更できませんでした。",
      } : current);
    } finally {
      setIsRenamingTag(false);
    }
  };

  const changeDisplayMode = (nextMode: EntryListDisplayMode) => {
    setDisplayMode(nextMode);
    writeEntryListDisplayMode(kind, nextMode);
  };

  const toggleTagOrderLock = () => {
    const nextValue = !isTagOrderLocked;
    if (!nextValue) {
      lockedOpenEntryOrderRef.current.clear();
      lockedTagGroupOrderRef.current.clear();
    }
    setIsTagOrderLocked(nextValue);
    writeEntryTagOrderLocked(kind, nextValue);
  };

  const renderFoldableTagGroup = (
    groupType: FoldableGroupType,
    groupEntries: EntryTreeNode[],
    sectionKey: string,
    label?: string,
  ) => {
    if (groupEntries.length === 0) return null;

    const stateKey = groupType === "completed"
      ? getEntryCompletedGroupStateKey(kind)
      : getEntryTagGroupStateKey(kind, groupType === "tag" ? label ?? null : null);
    const legacyStateKey = groupType === "tag"
      ? getLegacyEntryTagGroupStateKey(kind, label ?? null)
      : undefined;
    const isExpanded = isTagGroupExpanded(stateKey, legacyStateKey);
    const isTagComposerOpen = groupType === "tag" && label
      ? tagGroupComposerState?.stateKey === stateKey
      : false;
    const composerId = `entry-tag-group-composer-${kind}-${stateKey}`;
    const groupAriaLabel = groupType === "completed"
      ? "完了済みの項目"
      : groupType === "untagged"
        ? "タグなしの項目"
        : `タグ「${label}」の項目`;
    const entryTagPresentation: EntryTagPresentation = groupType === "completed"
      ? "completed_meta"
      : "group_action";

    return (
      <section
        key={`${sectionKey}-${groupType}-${label ?? "untagged"}`}
        className={`entry-list__tag-group entry-list__tag-group--${groupType}`}
        aria-label={groupAriaLabel}
      >
        <div className={`entry-list__tag-group-header entry-list__tag-group-header--${groupType}`}>
          {groupType === "tag" && label ? (
            <button
              type="button"
              className={`entry-list__tag-group-add ${getEntryTagToneClassName(label)}`}
              onClick={() => toggleTagGroupComposer(label, stateKey)}
              disabled={disabled || isDeletingAll || compactView}
              aria-expanded={isTagComposerOpen}
              aria-controls={composerId}
              aria-label={`タグ「${label}」に${ENTRY_KIND_LABEL[kind]}を追加`}
              title={`#${label} に追加`}
            >
              <span className="entry-list__tag-group-add-label">#{label}</span>
              <span className="entry-list__tag-group-add-plus" aria-hidden="true">＋</span>
            </button>
          ) : null}

          <button
            type="button"
            className="entry-list__tag-group-toggle"
            onClick={() => toggleTagGroup(stateKey)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `${groupAriaLabel}を閉じる` : `${groupAriaLabel}を開く`}
          >
            {groupType !== "tag" ? (
              <span className={`entry-list__tag-group-label entry-list__tag-group-label--${groupType}`}>
                {groupType === "completed" ? "完了" : "タグなし"}
              </span>
            ) : null}
            <span className="entry-list__tag-group-count">{groupEntries.length}件</span>
            <span className="entry-list__tag-group-chevron" aria-hidden="true">
              {isExpanded ? "⌃" : "⌄"}
            </span>
          </button>

          {groupType === "tag" && label && !compactView ? (
            <button
              type="button"
              className="entry-list__tag-group-rename"
              onClick={() => openTagRename(label, stateKey, legacyStateKey)}
              disabled={disabled || isDeletingAll}
              aria-label={`タグ「${label}」の名前をまとめて変更`}
              title="タグ名をまとめて変更"
            >
              ✎
            </button>
          ) : null}
        </div>

        {groupType === "tag" && label && !compactView && isTagComposerOpen ? (
          <div
            id={composerId}
            className="entry-list__tag-group-composer"
            aria-label={`タグ「${label}」に${ENTRY_KIND_LABEL[kind]}を追加`}
          >
            <EntryComposer
              ref={tagGroupComposerRef}
              kind={kind}
              compact
              fixedTag={label}
              disabled={disabled || isDeletingAll}
              tagSuggestions={tagSuggestions}
              onDismiss={() => setTagGroupComposerState(null)}
              onSubmit={(content, metadata) =>
                handleCreateForTagGroup(label, content, metadata)
              }
            />
          </div>
        ) : null}

        {groupType === "tag" && label && !compactView && tagRenameState?.stateKey === stateKey ? (
          <form
            className="entry-list__tag-rename-form"
            onSubmit={handleTagRename}
          >
            <p>この{ENTRY_KIND_LABEL[kind]}の同じタグ（完了を含む）をまとめて変更します。</p>
            <label htmlFor={`entry-tag-rename-${kind}-${stateKey}`}>
              タグ名
              <input
                id={`entry-tag-rename-${kind}-${stateKey}`}
                ref={tagRenameInputRef}
                value={tagRenameState.draft}
                maxLength={30}
                disabled={isRenamingTag || disabled || isDeletingAll}
                onChange={(event) => {
                  const draft = event.target.value;
                  setTagRenameState((current) => current ? {
                    ...current,
                    draft,
                    error: null,
                  } : current);
                }}
              />
            </label>
            {tagRenameState.error ? (
              <p className="entry-list__tag-rename-error" role="alert">
                {tagRenameState.error}
              </p>
            ) : null}
            <div className="entry-list__tag-rename-actions">
              <button
                type="button"
                className="text-button"
                disabled={isRenamingTag}
                onClick={() => setTagRenameState(null)}
              >
                取り消す
              </button>
              <button
                type="submit"
                className="text-button text-button--strong"
                disabled={isRenamingTag || disabled || isDeletingAll}
              >
                {isRenamingTag ? "変更中…" : "名前を変更"}
              </button>
            </div>
          </form>
        ) : null}

        {isExpanded ? (
          <div className="entry-list__tag-group-items">
            {groupEntries.map((entry, index) =>
              renderEntry(entry, entryTagPresentation, String(index + 1)),
            )}
          </div>
        ) : null}
      </section>
    );
  };

  /**
   * タグなし → 未完了のタグ別 → 完了 の順に並べる。
   * 順番固定は未完了側だけに効き、完了項目は常に最下部の単一グループへ集める。
   * どのグループも初回は閉じ、開閉は区分ごとに記憶する。
   */
  const renderTagGroupedEntries = (
    sourceEntries: EntryTreeNode[],
    sectionKey: string,
  ) => {
    const activeEntries = sourceEntries.filter((entry) => !entry.is_completed);
    const completed = sourceEntries.filter((entry) => entry.is_completed);
    const grouped = getOpenTagGroups(activeEntries);

    return (
      <>
        {renderFoldableTagGroup("untagged", grouped.untagged, sectionKey)}
        {grouped.groups.map((group) =>
          renderFoldableTagGroup("tag", group.entries, sectionKey, group.label),
        )}
        {renderFoldableTagGroup("completed", completed, sectionKey)}
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
          <span
            className="entry-column__count"
            aria-label={`未完了の${ENTRY_KIND_LABEL[kind]} ${openEntries.length}件`}
            title="未完了の項目数"
          >
            {openEntries.length}
          </span>
          <div className="entry-column__view-controls" aria-label={`${ENTRY_KIND_LABEL[kind]}の表示設定`}>
            <label className="entry-column__display-mode">
              <span>表示</span>
              <select
                value={displayMode}
                onChange={(event) =>
                  changeDisplayMode(event.target.value as EntryListDisplayMode)
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
            {isTagGrouped ? (
              <button
                type="button"
                className={`entry-column__order-lock ${isTagOrderLocked ? "entry-column__order-lock--active" : ""}`}
                onClick={toggleTagOrderLock}
                aria-pressed={isTagOrderLocked}
                aria-label={`${ENTRY_KIND_LABEL[kind]}の順番固定を${isTagOrderLocked ? "オフ" : "オン"}にする`}
                title={isTagOrderLocked
                  ? "順番固定：未完了の並びを保つ（完了は最後へ集約）"
                  : "順番固定オフ：現在の並び順に従う"}
              >
                <span className="entry-column__order-lock-label entry-column__order-lock-label--full">順番固定</span>
                <span className="entry-column__order-lock-label entry-column__order-lock-label--compact">固定</span>
                <span className="entry-column__order-lock-value">{isTagOrderLocked ? "ON" : "OFF"}</span>
              </button>
            ) : null}
          </div>
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
          tagSuggestions={tagSuggestions}
          onSubmit={handleCreate}
        />
      ) : null}

      <div className="entry-list" aria-live="polite">
        {entries.length === 0 ? (
          <p className="entry-list__empty">まだありません。</p>
        ) : compactView ? (
          isTagGrouped
            ? renderTagGroupedEntries(entries, "compact")
            : entries.map((entry) => renderEntry(entry))
        ) : isTagGrouped ? (
          renderTagGroupedEntries(entries, "grouped")
        ) : (
          <>
            {openEntries.map((entry) => renderEntry(entry))}

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
                    {completedEntries.map((entry) => renderEntry(entry))}
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
          displayNumber={
            mobileActionEntry ? getEntryDisplayNumber(mobileActionEntry) : undefined
          }
          disabled={disabled || isDeletingAll}
          onClose={() => setMobileActionEntryId(null)}
          onToggleCompleted={toggleCompleted}
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
