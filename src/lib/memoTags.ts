import type { EntryRow, MemoListItem, MemoRow } from "../types/memo";
import { getEntryTagKey, normalizeEntryTag } from "../types/memo";

export type TagSummary = {
  /** 表記ゆれをまとめるための内部キー。保存用ではない。 */
  key: string;
  /** 一覧や候補に見せる自然な表記。現在の表示順で先に現れた表記を採用する。 */
  label: string;
  count: number;
  last_used_at: string;
};

/** 既存の公開名を残し、メモ用／項目用で同じ候補ロジックを使う。 */
export type MemoTagSummary = TagSummary;
export type EntryTagSummary = TagSummary;

type Taggable = Pick<MemoRow, "tag" | "updated_at"> | Pick<MemoListItem, "tag" | "updated_at"> | Pick<EntryRow, "tag" | "updated_at">;

/**
 * 実際に使われたタグを、空白・英字の大小文字の表記ゆれだけまとめて候補化する。
 * タグ専用テーブルは作らず、メモ・項目に付いている言葉だけを候補にする。
 */
export function getTagSummaries(items: Taggable[]): TagSummary[] {
  const summaryByKey = new Map<string, TagSummary>();

  for (const item of items) {
    const label = normalizeEntryTag(item.tag);
    const key = getEntryTagKey(label);
    if (!label || !key) continue;

    const current = summaryByKey.get(key);
    if (!current) {
      summaryByKey.set(key, {
        key,
        label,
        count: 1,
        last_used_at: item.updated_at,
      });
      continue;
    }

    current.count += 1;
    if (item.updated_at > current.last_used_at) {
      current.label = label;
      current.last_used_at = item.updated_at;
    }
  }

  return [...summaryByKey.values()].sort((left, right) =>
    right.count - left.count ||
    right.last_used_at.localeCompare(left.last_used_at) ||
    left.label.localeCompare(right.label, "ja"),
  );
}

export function getMemoTagSummaries(memos: (MemoRow | MemoListItem)[]): MemoTagSummary[] {
  return getTagSummaries(memos);
}

export function getEntryTagSummaries(entries: EntryRow[]): EntryTagSummary[] {
  return getTagSummaries(entries);
}

/** 候補の前方一致。未入力時は使用頻度・最近使った順をそのまま出す。 */
export function getRecommendedTags(
  summaries: TagSummary[],
  query: string,
  limit = 6,
): TagSummary[] {
  const key = getEntryTagKey(query);
  const matches = key
    ? summaries.filter((summary) => summary.key.startsWith(key))
    : summaries;

  return matches.slice(0, limit);
}

export function getRecommendedMemoTags(
  summaries: MemoTagSummary[],
  query: string,
  limit = 6,
): MemoTagSummary[] {
  return getRecommendedTags(summaries, query, limit);
}

export function getRecommendedEntryTags(
  summaries: EntryTagSummary[],
  query: string,
  limit = 6,
): EntryTagSummary[] {
  return getRecommendedTags(summaries, query, limit);
}
