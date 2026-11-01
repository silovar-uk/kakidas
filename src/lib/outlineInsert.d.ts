export type OutlinePosition = { parentId: string | null; index: number };
export type OutlinePositionRow = { id: string; parent_id: string | null; depth: number };
export function siblingPositionAfter<T extends OutlinePositionRow>(entries: T[], rowId: string): OutlinePosition | null;
export function visibleInsertionIndex<T extends OutlinePositionRow>(allEntries: T[], visibleEntries: T[], parentId: string | null, siblingIndex: number): number;
