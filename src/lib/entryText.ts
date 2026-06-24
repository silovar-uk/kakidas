import type { EntryTreeNode } from "../types/memo";

/**
 * 個別コピーや操作シートで共通に使う、項目のテキスト表現。
 * 備考が空なら改行も追加しないため、通常のコピー結果は従来どおり。
 */
export function formatEntryCopyText(
  entry: Pick<EntryTreeNode, "content" | "note" | "outline_number">,
  includeNumber: boolean,
): string {
  const content = includeNumber
    ? `${entry.outline_number} ${entry.content}`
    : entry.content;
  const note = entry.note.trim();

  return note ? `${content}\n備考：${note}` : content;
}
