import type { EntryRow } from "../types/memo";

/**
 * 段落の見出しが、アウトラインの1行と同じ文なら「結ばれている」とみなす。
 * データは変えず、見出しの一致から毎回求める。前後の空白だけを除いて完全に一致させ、
 * 大文字小文字・全角半角は寄せない(結び目が勝手に増えるのを防ぐ)。
 * 同じ文の行が2つ以上あるときは、どちらとも結ばない。
 */
export function getOutlineBindings(entries: EntryRow[]) {
  const live = entries.filter((entry) => entry.deleted_at === null);
  const rowByText = new Map<string, EntryRow | null>();

  for (const entry of live) {
    if (entry.kind !== "sentence") continue;
    const key = entry.content.trim();
    rowByText.set(key, rowByText.has(key) ? null : entry);
  }

  const rowByParagraphId = new Map<string, EntryRow>();
  const paragraphsByRowId = new Map<string, EntryRow[]>();

  for (const paragraph of live) {
    if (paragraph.kind !== "paragraph" || !paragraph.heading.trim()) continue;
    const row = rowByText.get(paragraph.heading.trim());
    if (!row) continue;
    rowByParagraphId.set(paragraph.id, row);
    paragraphsByRowId.set(row.id, [...(paragraphsByRowId.get(row.id) ?? []), paragraph]);
  }

  return { rowByParagraphId, paragraphsByRowId };
}

export type OutlineBindings = ReturnType<typeof getOutlineBindings>;
