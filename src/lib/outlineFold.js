/**
 * Outline folding is a view-only operation: parent_id, sort_order, content
 * and completion state must never change.
 */

/** IDs of all branches at the same depth, optionally scoped to a zoomed root. */
export function foldableBranchesAtLevel(rows, depth, scopeId = null) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const withinScope = row => {
    if (scopeId === null) return true;
    const visited = new Set([row.id]);
    let id = row.parent_id;
    while (id && !visited.has(id)) {
      if (id === scopeId) return true;
      visited.add(id);
      id = byId.get(id)?.parent_id ?? null;
    }
    return false;
  };
  return rows.filter(row => row.has_children && row.depth === depth && withinScope(row)).map(row => row.id);
}

/**
 * If any branch at this depth is open, collapse all at that depth.
 * Otherwise open all. Unrelated depths and branches keep their current state.
 */
export function toggleFoldedLevel(collapsed, rows, depth, scopeId = null) {
  const ids = foldableBranchesAtLevel(rows, depth, scopeId);
  const next = new Set(collapsed);
  if (!ids.length) return next;
  const shouldCollapse = ids.some(id => !collapsed.has(id));
  for (const id of ids) {
    if (shouldCollapse) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Invalid or stale local preferences should never break the editor. */
export function parseFoldedIds(value) {
  if (!value) return [];
  try {
    const ids = JSON.parse(value);
    return Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === "string" && id.length <= 150))] : [];
  } catch {
    return [];
  }
}
