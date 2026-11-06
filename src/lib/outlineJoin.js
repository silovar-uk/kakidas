/**
 * Deleting a bullet boundary is safe only for consecutive stored siblings.
 * Never skip hidden/completed entries or consume a child/parent/annotated row.
 */
export function planOutlineEndDelete(allRows, visibleRows, currentId, linkedParagraphCount = 0) {
  const at = visibleRows.findIndex(row => row.id === currentId);
  if (at < 0 || at + 1 >= visibleRows.length) return { kind: "none" };
  const current = allRows.find(row => row.id === currentId);
  if (!current || current.kind !== "sentence") return { kind: "none" };
  const visibleNext = visibleRows[at + 1];
  if ((visibleNext.parent_id ?? null) !== (current.parent_id ?? null)) {
    return { kind: "blocked", reason: "次の行は別の階層です。同じ階層に揃えてから結合できます。" };
  }
  const siblings = allRows
    .filter(row => row.kind === "sentence" && (row.parent_id ?? null) === (current.parent_id ?? null))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const index = siblings.findIndex(row => row.id === currentId);
  const next = siblings[index + 1];
  if (index < 0 || !next || next.id !== visibleNext.id) {
    return { kind: "blocked", reason: "間に非表示の行があります。行を飛ばして結合しないようにしました。" };
  }
  if (next.has_children || next.child_count > 0 || next.is_completed ||
      next.heading?.trim() || next.tag?.trim() || next.note?.trim() ||
      next.link_url?.trim() || next.satisfaction > 0 || linkedParagraphCount > 0) {
    return { kind: "blocked", reason: "次の行には子項目や付属情報があります。内容を守るため自動結合しません。" };
  }
  return { kind: "join", nextId: next.id, nextContent: next.content, isBlank: next.content.length === 0 };
}
