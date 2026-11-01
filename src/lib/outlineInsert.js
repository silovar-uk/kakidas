/**
 * アウトラインの追加位置を、表示フィルターではなく保存順（親ID + sort_order）から決める。
 * entries は getEntryTree(..., "sentence", "manual") で得た全件・深さ優先順。
 */

/** 基準行の「次の兄弟」。展開中の子項目の先頭へは入れない。 */
export function siblingPositionAfter(entries, rowId) {
  const row = entries.find(item => item.id === rowId);
  if (!row) return null;
  const parentId = row.parent_id ?? null;
  const siblings = entries.filter(item => (item.parent_id ?? null) === parentId);
  const index = siblings.findIndex(item => item.id === rowId);
  return index < 0 ? null : { parentId, index: index + 1 };
}

/** 保存順の挿入位置を、折りたたみ・完了非表示後の描画行番号へ写す。 */
export function visibleInsertionIndex(allEntries, visibleEntries, parentId, siblingIndex) {
  const siblings = allEntries.filter(item => (item.parent_id ?? null) === parentId);
  const index = Math.max(0, Math.min(siblingIndex, siblings.length));
  let before = allEntries.length;
  if (index < siblings.length) {
    before = allEntries.findIndex(item => item.id === siblings[index].id);
  } else if (siblings.length > 0) {
    const last = siblings[siblings.length - 1];
    const at = allEntries.findIndex(item => item.id === last.id);
    before = at + 1;
    while (before < allEntries.length && allEntries[before].depth > last.depth) before++;
  } else if (parentId !== null) {
    const at = allEntries.findIndex(item => item.id === parentId);
    before = at >= 0 ? at + 1 : allEntries.length;
  }
  const visibleIds = new Set(visibleEntries.map(item => item.id));
  for (let i = before; i < allEntries.length; i++) {
    if (visibleIds.has(allEntries[i].id)) {
      return visibleEntries.findIndex(item => item.id === allEntries[i].id);
    }
  }
  return visibleEntries.length;
}
