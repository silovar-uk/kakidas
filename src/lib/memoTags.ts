import type { MemoListItem, MemoRow } from "../types/memo";
import { getMemoTagKey, normalizeMemoTag } from "../types/memo";

export type MemoTagSummary = {
  /** 表記ゆれをまとめるための内部キー。保存用ではない。 */
  key: string;
  /** 一覧や候補に見せる自然な表記。最新更新の表記を採用する。 */
  label: string;
  count: number;
  last_used_at: string;
};

type TaggableMemo = Pick<MemoRow, "tag" | "updated_at"> | Pick<MemoListItem, "tag" | "updated_at">;

/**
 * 使われたタグを、空白・英字の大小文字の表記ゆれだけまとめて候補化する。
 * タグ管理の専用テーブルは作らず、メモに実際に付いている言葉だけを候補にする。
 */
export function getMemoTagSummaries(memos: TaggableMemo[]): MemoTagSummary[] {
  const summaryByKey = new Map<string, MemoTagSummary>();

  for (const memo of memos) {
    const label = normalizeMemoTag(memo.tag);
    const key = getMemoTagKey(label);
    if (!label || !key) continue;

    const current = summaryByKey.get(key);
    if (!current) {
      summaryByKey.set(key, {
        key,
        label,
        count: 1,
        last_used_at: memo.updated_at,
      });
      continue;
    }

    current.count += 1;
    // 最近付け直した表記を候補の表示にも採用する。
    if (memo.updated_at > current.last_used_at) {
      current.label = label;
      current.last_used_at = memo.updated_at;
    }
  }

  return [...summaryByKey.values()].sort((left, right) =>
    right.count - left.count ||
    right.last_used_at.localeCompare(left.last_used_at) ||
    left.label.localeCompare(right.label, "ja"),
  );
}

/** 候補の前方一致。未入力時は使用頻度・最近使った順をそのまま出す。 */
export function getRecommendedMemoTags(
  summaries: MemoTagSummary[],
  query: string,
  limit = 6,
): MemoTagSummary[] {
  const key = getMemoTagKey(query);
  const matches = key
    ? summaries.filter((summary) => summary.key.startsWith(key))
    : summaries;

  return matches.slice(0, limit);
}
