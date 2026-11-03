/**
 * 空行は親子関係を持つ通常のアウトライン項目。
 * 完了非表示・折りたたみ中でも必ず全保存行から兄弟順位を計算する。
 */
export function positionForBlankEnter(allRows, rowId, atStart) {
  const row = allRows.find(item => item.id === rowId);
  if (!row) return null;
  const parentId = row.parent_id ?? null;
  const siblings = allRows
    .filter(item => (item.parent_id ?? null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const index = siblings.findIndex(item => item.id === rowId);
  if (index < 0) return null;
  return { parentId, index: index + (atStart ? 0 : 1) };
}

/**
 * Backspace can remove ONLY a truly blank leaf without attached data.
 * A text-empty parent, tagged row, completed row, or paragraph anchor is data.
 */
export function canBackspaceDeleteBlank(row, linkedParagraphCount = 0) {
  if (!row || row.kind !== "sentence" || row.content.length !== 0) return false;
  if (row.has_children || row.child_count > 0 || linkedParagraphCount > 0) return false;
  if (row.heading?.trim() || row.tag?.trim() || row.note?.trim() || row.link_url?.trim()) return false;
  if (row.satisfaction > 0 || row.is_completed) return false;
  return true;
}

/** Whitespace is still editable text. Backspace must erase it before deleting the row. */
export function isTrulyEmptyEditor(value, selectionStart, selectionEnd) {
  return value.length === 0 && selectionStart === selectionEnd && selectionStart === 0;
}
