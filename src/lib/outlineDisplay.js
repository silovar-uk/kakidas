/**
 * Number only the rows kept by the current completion filter.
 * This is display-only: keep IDs, parent_id, sort_order, and completion untouched.
 *
 * The input is the pre-order tree from getEntryTree. Completed ancestors with
 * unfinished descendants must already be retained by visibleOutlineWithAncestors.
 */
export function numberVisibleOutline(rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const numbers = new Map();
  const nextByParent = new Map();
  const descendants = new Map();

  for (const row of rows) {
    const parentId = row.parent_id && byId.has(row.parent_id) ? row.parent_id : null;
    const next = (nextByParent.get(parentId) ?? 0) + 1;
    nextByParent.set(parentId, next);
    const prefix = parentId ? numbers.get(parentId) : null;
    numbers.set(row.id, prefix ? prefix + "." + next : String(next));

    // Counts reflect what remains visible after filtering, not hidden completed
    // descendants. A parent with only hidden completed children is no longer a
    // collapsible branch in the filtered view.
    const visited = new Set([row.id]);
    let ancestor = row.parent_id;
    while (ancestor && byId.has(ancestor) && !visited.has(ancestor)) {
      descendants.set(ancestor, (descendants.get(ancestor) ?? 0) + 1);
      visited.add(ancestor);
      ancestor = byId.get(ancestor).parent_id;
    }
  }

  return rows.map(row => {
    const child_count = descendants.get(row.id) ?? 0;
    return { ...row, outline_number: numbers.get(row.id), child_count, has_children: child_count > 0 };
  });
}
