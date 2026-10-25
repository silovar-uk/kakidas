import type { EntryDraftSnapshot } from "../repositories/draftRepository";

/** 下書きは経過日数では消さない。バージョン不一致のデータもDBからは削除しない。 */
export function isSupportedDraft(draft: { version: number }): boolean {
  return draft.version === 1;
}

/** Undoで書き口に戻す際は、本文だけでなく添えたタグ・備考・リンクも復元する。 */
export function snapshotFromOutlineEntry(entry: {
  content: string; tag: string | null; note: string; link_url: string;
}): EntryDraftSnapshot {
  return {
    content: entry.content,
    heading: "",
    tag_value: entry.tag ?? "",
    note_value: entry.note,
    link_value: entry.link_url,
    tag_draft: "",
    note_draft: "",
    link_draft: "",
    active_meta_picker: null,
  };
}

/** 階層の孫を巻き込まず、既存の書きかけも上書きしないためのUndoガード。 */
export function canUndoCreatedOutlineEntry(
  row: { has_children: boolean } | null,
  writerIsEmpty: boolean,
): { allowed: boolean; reason: string | null } {
  if (!row) return { allowed: false, reason: "元の行がまだ表示されていません。少ししてから再度お試しください。" };
  if (row.has_children) return { allowed: false, reason: "子項目がある行は安全のため追加を取り消せません。項目の操作から確認してください。" };
  if (!writerIsEmpty) return { allowed: false, reason: "書き口に別の書きかけがあります。先に保存してから戻してください。" };
  return { allowed: true, reason: null };
}
