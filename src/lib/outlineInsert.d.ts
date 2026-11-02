export type OutlinePosition = { parentId: string | null; index: number };
export type OutlinePositionRow = { id: string; parent_id: string | null; depth: number };
export function siblingPositionAfter<T extends OutlinePositionRow>(entries: T[], rowId: string): OutlinePosition | null;
export function visibleInsertionIndex<T extends OutlinePositionRow>(allEntries: T[], visibleEntries: T[], parentId: string | null, siblingIndex: number): number;

/** Find the preceding visible sibling by its ID, NOT a filtered-array index. */
export function previousVisibleSiblingAt<T extends OutlinePositionRow>(allEntries: T[], visibleEntries: T[], parentId: string | null, insertIndex: number): T | null;
/** Target for Tab on a new inline row or on the external writing desk. */
export function indentPositionAt<T extends OutlinePositionRow>(allEntries: T[], visibleEntries: T[], parentId: string | null, insertIndex: number): OutlinePosition | null;
