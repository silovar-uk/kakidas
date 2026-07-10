import {
  type EntryKind,
  type EntrySortMode,
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
  /** 画面で選んだ並び順を、コピー・.txt出力にも反映する。 */
  entrySortMode?: EntrySortMode;
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
    entrySortMode = "created_desc",
  }: MemoTextOptions = {},
): string {
  const sourceEntries = excludeCompleted
    ? memo.entries.filter((entry) => !entry.is_completed)
    : memo.entries;
  const kinds = onlyKind ? [onlyKind] : ENTRY_KINDS;
  const parts = [`# ${memo.title}`];

  for (const kind of kinds) {
    const entries = getEntryTree(sourceEntries, kind, entrySortMode);
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
      const linkUrl = entry.link_url.trim();

      if (kind === "paragraph") {
        const heading = entry.heading.trim();
        if (heading) {
          parts.push(`\n${prefix}${heading}`);
          parts.push(entry.content);
        } else {
          parts.push(`\n${prefix}${entry.content}`);
        }

        if (noteLines.length > 0) {
          parts.push(`気持ち・備考：${noteLines[0]}`);
          noteLines.slice(1).forEach((line) => parts.push(`  ${line}`));
        }

        if (linkUrl) {
          parts.push(`リンク：${linkUrl}`);
        }

        continue;
      }

      parts.push(`${indentation}${prefix}${entry.content}`);

      const detailIndentation = `${indentation}  `;

      if (noteLines.length > 0) {
        parts.push(`${detailIndentation}気持ち・備考：${noteLines[0]}`);
        noteLines.slice(1).forEach((line) =>
          parts.push(`${detailIndentation}${line}`),
        );
      }

      if (linkUrl) {
        parts.push(`${detailIndentation}リンク：${linkUrl}`);
      }
    }
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
