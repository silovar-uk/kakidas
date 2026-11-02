/**
 * Resolve an up/down move against ALL stored siblings, using the adjacent
 * VISIBLE sibling as an anchor. Hidden completed rows must not offset moves.
 * Children are never individually relocated: only the root row changes order.
 */
export function siblingMoveIndex(allRows, visibleRows, rowId, direction) {
  if (direction !== "up" && direction !== "down") return null;
  const row = allRows.find(item => item.id === rowId);
  if (!row) return null;
  const byOrder = (a,b) => a.sort_order - b.sort_order ||
    a.created_at.localeCompare(b.created_at);
  const visible = visibleRows
    .filter(item => item.parent_id === row.parent_id)
    .sort(byOrder);
  const at = visible.findIndex(item => item.id === rowId);
  const target = visible[at + (direction === "up" ? -1 : 1)];
  if (at < 0 || !target) return null;
  const stored = allRows
    .filter(item => item.parent_id === row.parent_id && item.id !== rowId)
    .sort(byOrder);
  const targetAt = stored.findIndex(item => item.id === target.id);
  if (targetAt < 0) return null;
  return targetAt + (direction === "down" ? 1 : 0);
}
