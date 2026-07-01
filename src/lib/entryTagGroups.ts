import type { EntryKind, EntryTreeNode } from "../types/memo";
import { getEntryTagKey, normalizeEntryTag } from "../types/memo";

export type EntryListDisplayMode = "plain" | "tag_grouped";

export const ENTRY_LIST_DISPLAY_MODE_LABEL: Record<EntryListDisplayMode, string> = {
  plain: "通常表示",
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
const EXPANDED_GROUPS_STORAGE_KEY = "kakidas.entry-tag-groups-expanded";

type ExpandedGroupState = Record<string, boolean>;

export function readEntryListDisplayMode(kind: EntryKind): EntryListDisplayMode {
  try {
    return window.localStorage.getItem(`${DISPLAY_MODE_STORAGE_PREFIX}.${kind}`) === "tag_grouped"
      ? "tag_grouped"
      : "plain";
  } catch {
    return "plain";
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

export function getEntryTagGroupStateKey(kind: EntryKind, tag: string): string {
  return `${kind}::${getEntryTagKey(tag)}`;
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
 * 入力済みの表示順を壊さず、タグなしを先頭、タグ付きだけをタグ単位に束ねる。
 * タグ名の表記は、現在の表示順で最初に現れたものを見出しに使う。
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
