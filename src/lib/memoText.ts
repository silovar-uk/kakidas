import {
  type EntryKind,
  type MemoWithEntries,
  ENTRY_KINDS,
  ENTRY_KIND_LABEL,
  getEntryTree,
  supportsHierarchy,
} from "../types/memo";

type MemoTextOptions = {
  /** 振り番を出力へ含めるか。 */
  includeEntryNumbers?: boolean;
  /** 完了済みの項目を出力から除外するか。 */
  excludeCompleted?: boolean;
  /** 特定の区分だけを出力するか。 */
  onlyKind?: EntryKind;
};

/**
 * メモ全体をプレーンテキスト／Markdown寄りの形に整える。
 * 完了済み項目を除外する場合でも、DBの内容は一切変更しない。
 */
export function formatMemoText(
  memo: MemoWithEntries,
  {
    includeEntryNumbers = false,
    excludeCompleted = false,
    onlyKind,
  }: MemoTextOptions = {},
): string {
  const sourceEntries = excludeCompleted
    ? memo.entries.filter((entry) => !entry.is_completed)
    : memo.entries;
  const kinds = onlyKind ? [onlyKind] : ENTRY_KINDS;
  const parts = [`# ${memo.title}`];

  for (const kind of kinds) {
    const entries = getEntryTree(sourceEntries, kind);
    parts.push(`\n## ${ENTRY_KIND_LABEL[kind]}`);

    if (entries.length === 0) {
      parts.push("- ");
      continue;
    }

    for (const entry of entries) {
      const indentation = supportsHierarchy(kind)
        ? "  ".repeat(entry.depth)
        : "";
      const prefix = includeEntryNumbers
        ? `${entry.outline_number} `
        : kind === "paragraph"
          ? ""
          : "- ";
      const noteLines = entry.note.trim().split(/\r?\n/).filter(Boolean);

      if (kind === "paragraph") {
        parts.push(`\n${prefix}${entry.content}`);

        if (noteLines.length > 0) {
          parts.push(`気持ち・備考：${noteLines[0]}`);
          noteLines.slice(1).forEach((line) => parts.push(`  ${line}`));
        }

        continue;
      }

      parts.push(`${indentation}${prefix}${entry.content}`);

      if (noteLines.length > 0) {
        const noteIndentation = `${indentation}  `;
        parts.push(`${noteIndentation}気持ち・備考：${noteLines[0]}`);
        noteLines.slice(1).forEach((line) =>
          parts.push(`${noteIndentation}${line}`),
        );
      }
    }
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
