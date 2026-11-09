/**
 * A blank row remains a real editable item, but it does not consume a number.
 * A heading without body text still counts (e.g. a paragraph title).
 * Tags, links and other metadata alone do not make an empty row a numbered item.
 */
export function isNumberableEntry(row) {
  return Boolean(row.content?.trim() || row.heading?.trim());
}

/**
 * Derive display-only numbers from a pre-order outline. Empty ancestors are
 * transparent for numbering: their children share the nearest numbered
 * ancestor's sequence, while parent_id, depth and sort_order stay untouched.
 *
 * Example: A -> 1, empty child -> "", its child B -> 1.1,
 *          next child C of A -> 1.2, next root D -> 2.
 */
export function numberMeaningfulOutline(rows, { previewId = null } = {}) {
  const nearestNumberedAncestor = new Map();
  const numbers = new Map();
  const nextByScope = new Map();

  return rows.map(row => {
    const scope = row.parent_id && nearestNumberedAncestor.has(row.parent_id)
      ? nearestNumberedAncestor.get(row.parent_id)
      : null;

    // Only the actively focused empty editor may temporarily reserve its number.
    // This never changes row content or the numbering used for saved/exported data.
    if (row.id !== previewId && !isNumberableEntry(row)) {
      nearestNumberedAncestor.set(row.id, scope);
      numbers.set(row.id, "");
    } else {
      const next = (nextByScope.get(scope) ?? 0) + 1;
      nextByScope.set(scope, next);
      const prefix = scope ? `${numbers.get(scope)}.` : "";
      numbers.set(row.id, `${prefix}${next}`);
      nearestNumberedAncestor.set(row.id, row.id);
    }

    return { ...row, outline_number: numbers.get(row.id) };
  });
}

/**
 * Number only the rows kept by the completion filter, ignoring empty rows.
 * This is display-only: IDs, parent_id, sort_order and completion are unchanged.
 * Completed ancestors with incomplete descendants are retained by
 * visibleOutlineWithAncestors before this function is called.
 */
export function numberVisibleOutline(rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const descendants = new Map();

  for (const row of rows) {
    // Only count descendants that remain after completion filtering.
    const visited = new Set([row.id]);
    let ancestor = row.parent_id;
    while (ancestor && byId.has(ancestor) && !visited.has(ancestor)) {
      descendants.set(ancestor, (descendants.get(ancestor) ?? 0) + 1);
      visited.add(ancestor);
      ancestor = byId.get(ancestor).parent_id;
    }
  }

  return numberMeaningfulOutline(rows).map(row => {
    const child_count = descendants.get(row.id) ?? 0;
    return { ...row, child_count, has_children: child_count > 0 };
  });
}
