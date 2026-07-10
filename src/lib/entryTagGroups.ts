import type { EntryKind, EntryTreeNode } from "../types/memo";
import { getEntryTagKey, normalizeEntryTag } from "../types/memo";

export type EntryListDisplayMode = "plain" | "tag_grouped";

export const ENTRY_LIST_DISPLAY_MODE_LABEL: Record<EntryListDisplayMode, string> = {
  plain: "タグでまとめない",
  tag_grouped: "タグでまとめる",
};

export type EntryTagGroup = {
  key: string;
  label: string;
  entries: EntryTreeNode[];
};

export type GroupedEntryList = {
  untagged: EntryTreeNode[];
  groups: EntryTagGroup[];
};

const DISPLAY_MODE_STORAGE_PREFIX = "kakidas.entry-list-display-mode";
const ORDER_LOCKED_STORAGE_PREFIX = "kakidas.entry-tag-order-locked";
const EXPANDED_GROUPS_STORAGE_KEY = "kakidas.entry-tag-groups-expanded";
const UNTAGGED_STATE_SUFFIX = "system:untagged";
const COMPLETED_STATE_SUFFIX = "system:completed";

type ExpandedGroupState = Record<string, boolean>;

/**
 * 新しい区分は、タグを見返す導線を主役にするため「タグでまとめる」から始める。
 * すでにこの端末で選んだ「タグでまとめない」／タグ表示は、そのまま尊重する。
 */
export const DEFAULT_ENTRY_LIST_DISPLAY_MODE: EntryListDisplayMode = "tag_grouped";

/**
 * タグでまとめる表示では、未完了の作業束を見失わないよう順番固定を初期値にする。
 * 完了項目は常に最下部の完了グループへ送り、未完了の相対順だけを保つ。
 * 記憶は単語／文／段落ごとのブラウザ設定で、項目データには保存しない。
 */
export const DEFAULT_ENTRY_TAG_ORDER_LOCKED = true;

export function readEntryListDisplayMode(kind: EntryKind): EntryListDisplayMode {
  try {
    const saved = window.localStorage.getItem(`${DISPLAY_MODE_STORAGE_PREFIX}.${kind}`);

    if (saved === "plain" || saved === "tag_grouped") {
      return saved;
    }

    return DEFAULT_ENTRY_LIST_DISPLAY_MODE;
  } catch {
    return DEFAULT_ENTRY_LIST_DISPLAY_MODE;
  }
}

export function writeEntryListDisplayMode(
  kind: EntryKind,
  mode: EntryListDisplayMode,
): void {
  try {
    window.localStorage.setItem(`${DISPLAY_MODE_STORAGE_PREFIX}.${kind}`, mode);
  } catch {
    // 保存できない場合も、その場の表示切替を優先する。
  }
}

/**
 * ONなら未完了の相対順を保つ。完了項目はON/OFFにかかわらず完了グループへ集約する。
 * 未設定の端末はONとして扱い、既存の表示設定を壊さない。
 */
export function readEntryTagOrderLocked(kind: EntryKind): boolean {
  try {
    const saved = window.localStorage.getItem(`${ORDER_LOCKED_STORAGE_PREFIX}.${kind}`);

    if (saved === "true") return true;
    if (saved === "false") return false;

    return DEFAULT_ENTRY_TAG_ORDER_LOCKED;
  } catch {
    return DEFAULT_ENTRY_TAG_ORDER_LOCKED;
  }
}

export function writeEntryTagOrderLocked(kind: EntryKind, isLocked: boolean): void {
  try {
    window.localStorage.setItem(
      `${ORDER_LOCKED_STORAGE_PREFIX}.${kind}`,
      String(isLocked),
    );
  } catch {
    // 保存できない場合も、その場の表示切替を優先する。
  }
}

function readExpandedGroupState(): ExpandedGroupState {
  try {
    const raw = window.localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const state: ExpandedGroupState = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") state[key] = value;
    }

    return state;
  } catch {
    return {};
  }
}

/**
 * タググループの開閉キー。タグなしは予約キーで保存し、実際のタグと衝突させない。
 * v0.5.53で保存された `kind::tagKey` も読み取り側で引き継げるようにしている。
 */
export function getEntryTagGroupStateKey(kind: EntryKind, tag: string | null): string {
  const key = getEntryTagKey(normalizeEntryTag(tag));
  return key ? `${kind}::tag:${key}` : `${kind}::${UNTAGGED_STATE_SUFFIX}`;
}

export function getLegacyEntryTagGroupStateKey(kind: EntryKind, tag: string | null): string {
  return `${kind}::${getEntryTagKey(normalizeEntryTag(tag))}`;
}

export function getEntryCompletedGroupStateKey(kind: EntryKind): string {
  return `${kind}::${COMPLETED_STATE_SUFFIX}`;
}

/** 新しいタググループは閉じた状態で始める。 */
export function readEntryTagGroupExpandedState(): ExpandedGroupState {
  return readExpandedGroupState();
}

export function writeEntryTagGroupExpandedState(state: ExpandedGroupState): void {
  try {
    window.localStorage.setItem(EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 表示状態の記憶に失敗しても、現在の開閉は保つ。
  }
}

/**
 * タグ名から静かな色相を決める。タグ名が同じなら、どの区分・表示モードでも同じ色になる。
 */
export function getEntryTagToneClassName(tag: string | null): string {
  const normalized = normalizeEntryTag(tag);
  if (!normalized) return "entry-tag-tone--untagged";

  let hash = 0;
  for (const character of normalized) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }

  return `entry-tag-tone--${hash % 6}`;
}

/**
 * 入力済みの表示順を壊さず、タグなしとタグ付きに分ける。
 * タググループの並びは、現在の表示順で最初に現れた順を使う。
 */
export function groupEntriesByTag(entries: EntryTreeNode[]): GroupedEntryList {
  const untagged: EntryTreeNode[] = [];
  const groupByKey = new Map<string, EntryTagGroup>();

  for (const entry of entries) {
    const label = normalizeEntryTag(entry.tag);
    const key = getEntryTagKey(label);

    if (!label || !key) {
      untagged.push(entry);
      continue;
    }

    const existing = groupByKey.get(key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }

    groupByKey.set(key, { key, label, entries: [entry] });
  }

  return {
    untagged,
    groups: [...groupByKey.values()],
  };
}
