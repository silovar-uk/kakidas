import { OutlineList, type OutlineHandle } from "./OutlineList";
import { EntryInspector, type EntryActions, type RowMove, type RowMoveState } from "./EntryInspector";
import { EntryMetaCard, type EntryMetaKind } from "./EntryMetaCard";
import type { OutlineBindings } from "../lib/outlineBinding";
import { fetchReferenceTitle } from "../lib/referenceTitle";
import { MoreIcon, CopyIcon } from "./icons";
import { type FormEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
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
import { draftRepository } from "../repositories/draftRepository";
import {
  type EntryCreateMetadata,
  type EntryDeletionResult,
  type EntryKind,
  type EntryInsertPosition,
  type EntryUpdate,
  type EntryTreeNode,
  ENTRY_KIND_LABEL,
  getEntryTagKey,
  getLinkHostname,
  normalizeEntryTag,
  supportsHierarchy,
} from "../types/memo";

type EntryColumnProps = {
  memoId: string;
  memoUpdatedAt: string;
  kind: EntryKind;
  entries: EntryTreeNode[];
  isActiveOnMobile: boolean;
  /** PCでこの列を細いレールへ畳んでいるか。モバイル表示には影響させない。 */
  isCollapsed?: boolean;
  /** 最後の1列は閉じられないため、閉じる操作を非表示にする。 */
  canCollapse?: boolean;
  /** PCの列を折りたたみ／展開する。 */
  onToggleCollapsed?: () => void;
  /** 各項目の作成日時を表示するか。 */
  showCreatedAt: boolean;
  /** 振り番を画面に含めるか。 */
  showEntryNumbers: boolean;
  /** アウトラインのみの番号/ビュレット表示。 */
  outlineNumbered?: boolean;
  onOutlineNumberedChange?: (numbered: boolean) => void;
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
  /** 書き口の置き場所(いる欄では書き口が、いない欄では入口が入る)。 */
  deskNode?: ReactNode;
  /** アウトラインの欄。次の一行の手(書き口が使う)を、ページへ渡す。 */
  outlineRef?: RefObject<OutlineHandle | null>;
  /** アウトライナー専用の完了表示。段落・URLの設定とは独立。 */
  showCompletedOutline?: boolean;
  completedOutlineCount?: number;
  onToggleShowCompletedOutline?: () => void;
  /** スマホで、書きかけがあるとき一覧の次の一行に「ここに入ります」を灯す。 */
  ghostOn?: boolean;
  onRowSelected?: () => void;
  /** アウトラインの次の一行が入る場所の説明(書き口の読み上げ用)。 */
  onCaretDescribed?: (description: string) => void;
  /** 書き口を、アウトラインの欄へ運んでフォーカスする。 */
  onFocusDesk?: () => void;
  /** 段落の書き口は、この段落の後ろに入る。null=末尾、"^"=先頭。 */
  paragraphAfterId?: string | null;
  onSelectParagraph?: (entryId: string) => void;
  /** 並びが手動のときだけ、段落を上・下へ移せる。 */
  manualOrder?: boolean;
  /** 結び目(段落の見出し=アウトラインの行の文)。行の「¶」・段落の「↖ 2.2」に使う。 */
  bindings?: OutlineBindings;
  /** アウトラインの行の番号(段落の「↖ 2.2」に見せる)。 */
  rowNumberById?: Map<string, string>;
  /** 結び目を灯している項目(1.6秒)。 */
  lensIds?: Set<string>;
  /** 行の「段落にする」(結ばれていれば「段落を開く」)。 */
  onGrowRow?: (rowId: string) => void;
  /** 段落の「↖ 2.2」。結ばれた行へ飛ぶ。 */
  onJumpToRow?: (rowId: string) => void;
  /** 参考URLの「アウトラインに引く」。 */
  onPullToOutline?: (entryId: string) => void;
  /** 参考URLごとの、アウトラインで引用している行。 */
  citationRowIds?: Map<string, string[]>;
  onJumpToCitation?: (entryId: string) => void;
  /** 書き口の行き先が参考URLで、書き口が参考URLの欄にいないとき、入口の下に灯りを出す。 */
  routeToWord?: boolean;
  onCreate: (
    kind: EntryKind,
    content: string,
    metadata?: EntryCreateMetadata,
    parentId?: string | null,
    position?: EntryInsertPosition,
    draftId?: string,
    entryId?: string,
    outlineIndex?: number,
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
  /** アウトラインの行と、親のない段落(手動の順)を動かす。 */
  onRelocateOutline?: (id: string, parentId: string | null, index: number) => Promise<void>;
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
const OUTLINE_DENSITY_KEY = "kakidas.outline-density.v1";

function isMobileViewport() {
  return window.matchMedia("(max-width: 920px)").matches;
}

export function EntryColumn({
  memoId,
  memoUpdatedAt,
  kind,
  entries,
  isActiveOnMobile,
  isCollapsed = false,
  canCollapse = true,
  onToggleCollapsed,
  showCreatedAt,
  showEntryNumbers,
  outlineNumbered = false,
  onOutlineNumberedChange,
  compactView = false,
  tagSuggestions,
  addAtBottom = false,
  disabled = false,
  deskNode,
  outlineRef,
  showCompletedOutline = false,
  completedOutlineCount = 0,
  onToggleShowCompletedOutline,
  ghostOn = false,
  onRowSelected,
  onCaretDescribed,
  onFocusDesk,
  paragraphAfterId = null,
  onSelectParagraph,
  manualOrder = false,
  bindings,
  rowNumberById,
  lensIds,
  onGrowRow,
  onJumpToRow,
  onPullToOutline,
  citationRowIds,
  onJumpToCitation,
  routeToWord = false,
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
  onRelocateOutline,
  onRenameTag,
}: EntryColumnProps) {
  /** PCの項目の詳細(行のそばの小窓)。 */
  const [inspector, setInspector] = useState<{ entryId: string; anchor: HTMLElement } | null>(null);
  const [mobileActionEntryId, setMobileActionEntryId] = useState<string | null>(null);
  /** スマホで、気持ち・リンク・タグを書く、画面の上半分のカード。 */
  const [metaCard, setMetaCard] = useState<{ entryId: string; kind: EntryMetaKind } | null>(null);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  useEffect(() => {
    if (!isHeaderMenuOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsHeaderMenuOpen(false);
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(
        `.entry-column--${kind} .entry-column__more`
      )?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [isHeaderMenuOpen, kind]);

  /** アウトラインの高密度表示。端末ごとに記憶し、既定は高密度。 */
  const [outlineDense, setOutlineDense] = useState(() => {
    try { return window.localStorage.getItem(OUTLINE_DENSITY_KEY) !== "normal"; } catch { return true; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(OUTLINE_DENSITY_KEY, outlineDense ? "dense" : "normal"); } catch { /* 端末設定が保存できなくても操作可能 */ }
  }, [outlineDense]);
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
  /** タググループは初期状態では開き、ユーザーが変えた開閉だけをブラウザ内に記憶する。 */
  const [expandedTagGroups, setExpandedTagGroups] = useState(
    readEntryTagGroupExpandedState,
  );
  const [tagRenameState, setTagRenameState] = useState<TagRenameState | null>(null);
  const [isRenamingTag, setIsRenamingTag] = useState(false);
  /** 未完了タグ見出しから開く、固定タグ付きの簡易入力欄。 */
  const [tagGroupComposerState, setTagGroupComposerState] = useState<TagGroupComposerState | null>(null);
  const [tagGroupDraftKeys, setTagGroupDraftKeys] = useState<Set<string>>(
    () => new Set(),
  );
  /** 順番固定ONでは、未完了だけの相対順を画面内で保つ。完了項目は常に別グループへ送る。 */
  const lockedOpenEntryOrderRef = useRef<Map<string, number>>(new Map());
  const lockedTagGroupOrderRef = useRef<Map<string, number>>(new Map());

  const tagGroupComposerRef = useRef<EntryComposerHandle | null>(null);
  const tagRenameInputRef = useRef<HTMLInputElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const isHierarchical = supportsHierarchy(kind);

  const mobileActionEntry = mobileActionEntryId
    ? entries.find((entry) => entry.id === mobileActionEntryId) ?? null
    : null;
  const inspectorEntry = inspector
    ? entries.find((entry) => entry.id === inspector.entryId) ?? null
    : null;
  const metaCardEntry = metaCard
    ? entries.find((entry) => entry.id === metaCard.entryId) ?? null
    : null;

  const legacyWordEntries = kind === "word"
    ? entries.filter((entry) => !entry.link_url.trim())
    : [];
  const primaryEntries = kind === "word"
    ? entries.filter((entry) => Boolean(entry.link_url.trim()))
    : entries;
  const openEntries = primaryEntries.filter((entry) => !entry.is_completed);
  const completedEntries = primaryEntries.filter((entry) => entry.is_completed);
  const existingReferenceUrls = kind === "word"
    ? primaryEntries.map((entry) => entry.link_url)
    : [];
  const isTagGrouped = displayMode === "tag_grouped";

  // タグ見出し内のComposerは通常は閉じているため、再訪時は最新Draftだけを開く。
  // ほかのDraftも見出しの印で見つけられるよう、タグキー一覧は保持する。
  useEffect(() => {
    let cancelled = false;

    if (compactView || !isTagGrouped) return undefined;

    void draftRepository
      .listForMemo(memoId)
      .then((drafts) => {
        if (cancelled) return;

        const availableTagKeys = new Set(
          entries
            .map((entry) => getEntryTagKey(entry.tag))
            .filter((tagKey): tagKey is string => Boolean(tagKey)),
        );
        const tagDrafts = drafts.filter(
          (draft) =>
            draft.kind === kind &&
            draft.scope === "tag-group" &&
            Boolean(draft.tag_key) &&
            availableTagKeys.has(draft.tag_key!),
        );

        setTagGroupDraftKeys(
          new Set(tagDrafts.map((draft) => draft.tag_key!)),
        );

        const latestDraft = tagDrafts[0];
        if (!latestDraft?.fixed_tag) return;

        setTagGroupComposerState((current) => current ?? {
          tag: latestDraft.fixed_tag!,
          stateKey: getEntryTagGroupStateKey(kind, latestDraft.fixed_tag),
        });
      })
      .catch(() => {
        // Draft一覧だけ読めなくても、通常の入力とタグ表示は続けられる。
      });

    return () => {
      cancelled = true;
    };
  }, [compactView, isTagGrouped, kind, memoId]);

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
      setMetaCard(null);
      setIsHeaderMenuOpen(false);
      setTagGroupComposerState(null);
    }
  }, [isActiveOnMobile]);

  // 本文だけ表示中は、隠した操作シートや追加先の状態を残さない。
  useEffect(() => {
    if (!compactView) return;

    setInspector(null);
    setMobileActionEntryId(null);
    setIsHeaderMenuOpen(false);
    setTagGroupComposerState(null);
  }, [compactView]);

  useEffect(() => {
    if (inspector && !entries.some((entry) => entry.id === inspector.entryId)) {
      setInspector(null);
    }

    if (
      mobileActionEntryId &&
      !entries.some((entry) => entry.id === mobileActionEntryId)
    ) {
      setMobileActionEntryId(null);
    }

    if (metaCard && !entries.some((entry) => entry.id === metaCard.entryId)) {
      setMetaCard(null);
    }
  }, [entries, inspector, metaCard, mobileActionEntryId]);


  useEffect(() => {
    writeEntryListDisplayMode(kind, displayMode);
  }, [displayMode, kind]);

  useEffect(() => {
    writeEntryTagOrderLocked(kind, isTagOrderLocked);
  }, [isTagOrderLocked, kind]);
  useEffect(()=>{
    const handler=(e:Event)=>{if((e.target as HTMLElement)?.closest(`.entry-column--${kind}`))toggleTagOrderLock();};
    document.addEventListener('kakidas:order-lock',handler);
    return()=>document.removeEventListener('kakidas:order-lock',handler);
  },[kind,isTagOrderLocked]);


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

  /** スマホの「この項目の操作」(下からのシート)。 */
  const openStructureActions = (entryId: string) => {
    setMobileActionEntryId(entryId);
    setInspector(null);
  };

  /** PCの「項目の詳細」(行のそばの小窓)。もう一度押すと閉じる。 */
  const openDetails = (entryId: string, anchor: HTMLElement) => {
    setInspector((current) => (current?.entryId === entryId ? null : { entryId, anchor }));
  };

  const enrichReferenceTitle = async (entryId: string, url: string) => {
    const title = await fetchReferenceTitle(url);
    if (title) await onUpdate(entryId,{content:title});
  };

  const handleUpdateEntry = async (
    entryId: string,
    patch: EntryUpdate,
  ) => {
    const nextPatch = { ...patch };

    if (
      kind === "word" &&
      typeof patch.link_url === "string" &&
      patch.link_url.trim()
    ) {
      nextPatch.content = getLinkHostname(patch.link_url) || patch.link_url;
    }

    const updated = await onUpdate(entryId, nextPatch);

    if (
      kind === "word" &&
      typeof patch.link_url === "string" &&
      patch.link_url.trim()
    ) {
      void enrichReferenceTitle(entryId, patch.link_url);
    }

    return updated;
  };

  /** タグ見出しからの追加は、見出しのタグを固定して保存する。 */
  const handleCreateForTagGroup = async (
    tag: string,
    content: string,
    metadata: EntryCreateMetadata,
    draftId: string,
  ) => {
    const created = await onCreate(
      kind,
      content,
      { ...metadata, tag },
      null,
      addAtBottom ? "bottom" : "top",
      draftId,
    );

    if (
      kind === "word" &&
      metadata.link_url &&
      created &&
      typeof created === "object" &&
      "id" in created &&
      typeof created.id === "string"
    ) {
      void enrichReferenceTitle(created.id, metadata.link_url);
    }

    const committedTagKey = getEntryTagKey(tag);
    setTagGroupDraftKeys((current) => {
      const next = new Set(current);
      next.delete(committedTagKey);
      return next;
    });
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

    setInspector(null);
    setMobileActionEntryId(null);
    return true;
  };

  /** 項目を残したまま、別メモの最初の項目として複製して開く。 */
  const requestCreateMemoFromEntry = async (entryId: string): Promise<boolean> => {
    const target = entries.find((entry) => entry.id === entryId);

    if (!target || disabled || isDeletingAll) return false;

    try {
      await onCreateMemoFromEntry(entryId);
      setInspector(null);
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

    setInspector(null);
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
      setInspector(null);
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
    setInspector(null);
    setMobileActionEntryId(null);
    return true;
  };

  const toggleCompleted = async (entryId: string) => {
    const target = entries.find((entry) => entry.id === entryId);
    if (!target) return;

    await onUpdate(entryId, { is_completed: !target.is_completed });
    setInspector(null);
    setMobileActionEntryId(null);
  };

  /** 段落を上・下へ移す(手動の順のとき)。 */
  const moveParagraph = (entryId: string, direction: -1 | 1) => {
    if (!onRelocateOutline || disabled) return;
    const index = primaryEntries.findIndex((entry) => entry.id === entryId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= primaryEntries.length) return;
    void onRelocateOutline(entryId, null, target);
  };

  const boundRowOf = (entry: EntryTreeNode) => {
    if (kind !== "paragraph") return null;
    const row = bindings?.rowByParagraphId.get(entry.id);
    return row ? { id: row.id, content: row.content, number: rowNumberById?.get(row.id) ?? "" } : null;
  };

  const renderEntry = (
    entry: EntryTreeNode,
    tagPresentation: EntryTagPresentation = "meta",
    displayNumber = getEntryDisplayNumber(entry),
  ) => {
    const index = primaryEntries.findIndex((item) => item.id === entry.id);
    return (
      <EntryItem
        key={entry.id}
        entry={entry}
        kind={kind}
        isMobileActionOpen={mobileActionEntryId === entry.id}
        isSelected={kind === "paragraph" && paragraphAfterId === entry.id}
        isLens={lensIds?.has(entry.id)}
        boundRow={boundRowOf(entry)}
        onJumpToRow={onJumpToRow}
        onPull={kind === "word" ? onPullToOutline : undefined}
        citationCount={citationRowIds?.get(entry.id)?.length ?? 0}
        onJumpToCitation={onJumpToCitation}
        onSelect={kind === "paragraph" ? onSelectParagraph : undefined}
        onMove={kind === "paragraph" && manualOrder ? moveParagraph : undefined}
        canMoveUp={index > 0}
        canMoveDown={index >= 0 && index < primaryEntries.length - 1}
        onOpenDetails={openDetails}
        showCreatedAt={showCreatedAt}
        showEntryNumbers={kind === "sentence" ? outlineNumbered : showEntryNumbers}
        displayNumber={displayNumber}
        compactView={compactView}
        tagPresentation={tagPresentation}
        disabled={disabled || isDeletingAll}
        onOpenStructure={openStructureActions}
        onUpdate={handleUpdateEntry}
      />
    );
  };

  /** 項目の詳細・スマホのシートが使う、項目への操作。 */
  const rowMoveStateOf = (entry: EntryTreeNode): RowMoveState => {
    const siblings = entries
      .filter((item) => item.parent_id === entry.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    const index = siblings.findIndex((item) => item.id === entry.id);
    return {
      indent: index > 0,
      outdent: entry.parent_id !== null,
      up: index > 0,
      down: index >= 0 && index < siblings.length - 1,
    };
  };
  const actionsFor = (entry: EntryTreeNode): EntryActions => ({
    onUpdate: handleUpdateEntry,
    onToggleCompleted: toggleCompleted,
    onMoveRow: kind === "sentence" ? (id: string, action: RowMove) => outlineRef?.current?.moveRow(id, action) : undefined,
    moveState: kind === "sentence" ? rowMoveStateOf(entry) : undefined,
    onZoom: kind === "sentence" ? (id: string) => outlineRef?.current?.zoomTo(id) : undefined,
    // 「段落にする」(結ばれていれば「段落を開く」)。見出しに行の文を入れて、段落の書き口を開く。
    onGrow: kind === "sentence" && onGrowRow ? (id: string) => onGrowRow(id) : undefined,
    growLabel: (bindings?.paragraphsByRowId.get(entry.id)?.length ?? 0) > 0 ? "段落を開く" : "段落にする",
    onPull: kind === "word" && onPullToOutline ? (id: string) => onPullToOutline(id) : undefined,
    onCopy: requestCopyEntry,
    onCreateMemoFromEntry: requestCreateMemoFromEntry,
    onMoveToKind: requestMoveToKind,
    onDelete: requestDelete,
  });

    /** 通常表示の未完了項目。段落は、書き口が入る位置(選んだ段落の後ろ。なければ末尾)に入口を挟む。 */
  const renderOpenEntries = () => {
    if (kind !== "paragraph") return openEntries.map((entry) => renderEntry(entry));

    const at = paragraphAfterId === "^"
      ? 0
      : paragraphAfterId
        ? openEntries.findIndex((entry) => entry.id === paragraphAfterId) + 1 || openEntries.length
        : openEntries.length;
    const nodes = openEntries.map((entry) => renderEntry(entry));
    nodes.splice(at, 0, <div key="desk-slot" className="entry-list__desk-slot">{deskNode}</div>);
    return nodes;
  };

  const toggleTagGroup = (stateKey: string, defaultExpanded: boolean) => {
    const currentExpanded = expandedTagGroups[stateKey] ?? defaultExpanded;
    const nextState = {
      ...expandedTagGroups,
      [stateKey]: !currentExpanded,
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
    defaultExpanded = false,
  ): boolean => expandedTagGroups[stateKey] ?? (
    legacyStateKey ? expandedTagGroups[legacyStateKey] : undefined
  ) ?? defaultExpanded;

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
      true,
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
    const isExpanded = isTagGroupExpanded(
      stateKey,
      legacyStateKey,
      groupType === "tag",
    );
    const isTagComposerOpen = groupType === "tag" && label
      ? tagGroupComposerState?.stateKey === stateKey
      : false;
    const hasTagGroupDraft = groupType === "tag" && label
      ? tagGroupDraftKeys.has(getEntryTagKey(label))
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
              {hasTagGroupDraft ? (
                <span
                  className="entry-list__tag-group-draft-mark"
                  aria-label="下書きあり"
                  title="下書きあり"
                />
              ) : null}
              <span className="entry-list__tag-group-add-plus" aria-hidden="true">＋</span>
            </button>
          ) : null}

          <button
            type="button"
            className="entry-list__tag-group-toggle"
            onClick={() => toggleTagGroup(stateKey, groupType === "tag")}
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
              memoId={memoId}
              memoUpdatedAt={memoUpdatedAt}
              kind={kind}
              compact
              fixedTag={label}
              disabled={disabled || isDeletingAll}
              tagSuggestions={tagSuggestions}
              existingReferenceUrls={existingReferenceUrls}
              onDismiss={() => setTagGroupComposerState(null)}
              onSubmit={(content, metadata, draftId) =>
                handleCreateForTagGroup(label, content, metadata, draftId)
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
   * タグなしは通常項目としてそのまま表示し、タグ付きだけを意味のあるセクションへまとめる。
   * 順番固定は未完了側だけに効き、完了項目は常に最下部の単一グループへ集める。
   * タグセクションは初回open、完了セクションは初回closed。ユーザーの開閉は区分ごとに記憶する。
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
        {grouped.untagged.map((entry) => renderEntry(entry, "meta"))}
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
      } ${compactView ? "entry-column--compact" : ""} ${
        isCollapsed ? "entry-column--collapsed" : ""
      }`}
      aria-labelledby={`${kind}-heading`}
      data-display-mode={displayMode}
      data-order-locked={isTagOrderLocked}
    >
      <button
        type="button"
        className="entry-column__collapsed-rail"
        onClick={onToggleCollapsed}
        aria-label={`${ENTRY_KIND_LABEL[kind]}を展開`}
        aria-expanded={false}
        title={`${ENTRY_KIND_LABEL[kind]}を展開`}
      >
        <span className="entry-column__collapsed-label">{ENTRY_KIND_LABEL[kind]}</span>
        <span className="entry-column__collapsed-count">{openEntries.length}</span>
        <span className="entry-column__collapsed-chevron" aria-hidden="true">›</span>
      </button>
      <div className="entry-column__header">
        <div className="entry-column__heading-group">
          <h2 id={`${kind}-heading`}>{ENTRY_KIND_LABEL[kind]}</h2>
          {onToggleCollapsed && canCollapse && !isCollapsed ? (
            <button
              type="button"
              className="entry-column__collapse-toggle"
              onClick={onToggleCollapsed}
              aria-label={`${ENTRY_KIND_LABEL[kind]}を折りたたむ`}
              aria-expanded={true}
              title={`${ENTRY_KIND_LABEL[kind]}を折りたたむ`}
            >
              <span className="entry-column__collapse-toggle-icon" aria-hidden="true">‹</span>
              <span className="entry-column__collapse-toggle-label" aria-hidden="true">畳む</span>
            </button>
          ) : null}
        </div>

        <div className="entry-column__header-actions">
          {kind === "sentence" && onOutlineNumberedChange ? (
            <div className="outline-marker-switch" role="group" aria-label="アウトラインの行頭表示">
              <button type="button" aria-label="ビュレットで表示" aria-pressed={!outlineNumbered}
                title="ビュレットで表示" onClick={() => onOutlineNumberedChange(false)}>•</button>
              <button type="button" aria-label="階層番号で表示" aria-pressed={outlineNumbered}
                title="階層番号で表示" onClick={() => onOutlineNumberedChange(true)}>1.</button>
            </div>
          ) : null}
          <span
            className="entry-column__count"
            aria-label={`未完了の${ENTRY_KIND_LABEL[kind]} ${openEntries.length}件`}
            title="未完了の項目数"
          >
            {openEntries.length}
          </span>
          <div className="entry-column__header-menu">
            <button type="button" className="entry-column__more" aria-label={`${ENTRY_KIND_LABEL[kind]}の操作`}
              aria-expanded={isHeaderMenuOpen} onClick={() => setIsHeaderMenuOpen(o => !o)}><MoreIcon /></button>
            {isHeaderMenuOpen ? <div className="entry-column__menu" role="menu">
              {kind === "sentence" ? <button role="menuitemcheckbox" aria-checked={showCompletedOutline} onClick={() => {onToggleShowCompletedOutline?.();setIsHeaderMenuOpen(false)}}>完了済みを表示</button> : null}
              {kind === "sentence" ? <button role="menuitemcheckbox" aria-checked={outlineDense} onClick={() => {setOutlineDense((current) => !current);setIsHeaderMenuOpen(false)}}>高密度で表示</button> : null}
              <button role="menuitemcheckbox" aria-checked={isTagGrouped} onClick={() => {changeDisplayMode(isTagGrouped ? "plain" : "tag_grouped");setIsHeaderMenuOpen(false)}}>タグでまとめる</button>
              {isTagGrouped ? <button role="menuitemcheckbox" aria-checked={isTagOrderLocked} onClick={() => {toggleTagOrderLock();setIsHeaderMenuOpen(false)}}>順番固定</button> : null}
              <button role="menuitem" onClick={() => {void handleCopy();setIsHeaderMenuOpen(false)}}><CopyIcon />{ENTRY_KIND_LABEL[kind]}をコピー</button>
              <button role="menuitem" onClick={() => {onToggleCollapsed?.();setIsHeaderMenuOpen(false)}}>畳む</button>
              <button role="menuitem" onClick={() => {void handleDeleteAll();setIsHeaderMenuOpen(false)}}>{ENTRY_KIND_LABEL[kind]}をすべて削除</button>
            </div> : null}
          </div>
        </div>
      </div>

      <div className="entry-list" aria-live="polite">
        {kind === "sentence" && onRelocateOutline ? (
          <OutlineList ref={outlineRef} entries={primaryEntries} disabled={disabled || isDeletingAll} dense={outlineDense} numbered={outlineNumbered}
            showCompletedOutline={showCompletedOutline}
            completedOutlineCount={completedOutlineCount}
            onToggleShowCompletedOutline={onToggleShowCompletedOutline}
            onRelocate={onRelocateOutline}
            onOpenActions={openStructureActions}
            onOpenDetails={openDetails}
            onToggleCompleted={toggleCompleted}
            onUpdate={handleUpdateEntry}
            deskNode={deskNode}
            paragraphsByRowId={bindings?.paragraphsByRowId}
            lensIds={lensIds}
            onGrowRow={onGrowRow}
            ghostOn={ghostOn}
            onCaretDescribed={onCaretDescribed}
            onRowSelected={() => onRowSelected?.()}
            onFocusDesk={() => onFocusDesk?.()} />
        ) : (
          <>
            {kind === "word" ? (
              <div className="entry-list__desk-slot">
                {deskNode}
                {routeToWord ? <p className="entry-list__route-note">ここに入ります(題名はあとから届きます)</p> : null}
              </div>
            ) : null}
            {primaryEntries.length === 0 ? (
              <>
                {kind === "paragraph" ? <div className="entry-list__desk-slot">{deskNode}</div> : null}
                <p className="entry-list__empty">
                  {kind === "word" ? "URLを貼ると、ここに集まります。どこで貼っても入ります。" : "まだありません。「＋ 段落を書く」から、またはアウトラインの行の ¶ から書き始められます。"}
                </p>
              </>
            ) : compactView ? (
              isTagGrouped
                ? renderTagGroupedEntries(primaryEntries, "compact")
                : primaryEntries.map((entry) => renderEntry(entry))
            ) : isTagGrouped ? (
              <>
                {kind === "paragraph" ? <div className="entry-list__desk-slot">{deskNode}</div> : null}
                {renderTagGroupedEntries(primaryEntries, "grouped")}
              </>
            ) : (
              <>
                {renderOpenEntries()}

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
          </>
        )}

        {kind === "word" && legacyWordEntries.length > 0 ? (
          <details className="entry-list__legacy-words">
            <summary>
              <span>以前の単語</span>
              <span>{legacyWordEntries.length}件</span>
            </summary>
            <div className="entry-list__legacy-word-items">
              {legacyWordEntries.map((entry) => renderEntry(entry))}
            </div>
          </details>
        ) : null}
      </div>

      {isActiveOnMobile && !compactView ? (
        <MobileEntryActionSheet
          entry={mobileActionEntry}
          kind={kind}
          showEntryNumbers={kind === "sentence" ? outlineNumbered : showEntryNumbers}
          displayNumber={
            mobileActionEntry ? getEntryDisplayNumber(mobileActionEntry) : undefined
          }
          disabled={disabled || isDeletingAll}
          tagSuggestions={tagSuggestions}
          actions={mobileActionEntry ? actionsFor(mobileActionEntry) : {
            onUpdate: handleUpdateEntry,
            onToggleCompleted: toggleCompleted,
            onCopy: requestCopyEntry,
            onCreateMemoFromEntry: requestCreateMemoFromEntry,
            onMoveToKind: requestMoveToKind,
            onDelete: requestDelete,
          }}
          onClose={() => setMobileActionEntryId(null)}
          onRequestMeta={(entryId, meta) => setMetaCard({ entryId, kind: meta })}
        />
      ) : null}

      {!isMobileViewport() && !compactView && inspectorEntry && inspector ? (
        <EntryInspector
          entry={inspectorEntry}
          kind={kind}
          anchor={inspector.anchor}
          showEntryNumbers={kind === "sentence" ? outlineNumbered : showEntryNumbers}
          displayNumber={getEntryDisplayNumber(inspectorEntry)}
          disabled={disabled || isDeletingAll}
          tagSuggestions={tagSuggestions}
          actions={actionsFor(inspectorEntry)}
          onClose={() => setInspector(null)}
        />
      ) : null}

      {isMobileViewport() && isActiveOnMobile && metaCardEntry && metaCard ? (
        <EntryMetaCard
          key={`${metaCard.entryId}:${metaCard.kind}`}
          kind={metaCard.kind}
          entry={metaCardEntry}
          tagSuggestions={tagSuggestions}
          layout="card"
          onApply={(patch) => handleUpdateEntry(metaCardEntry.id, patch)}
          onClose={() => setMetaCard(null)}
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
