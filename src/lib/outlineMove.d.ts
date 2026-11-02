import type { EntryRow } from "../types/memo";
type OutlinePosition = Pick<EntryRow, "id" | "parent_id" | "sort_order" | "created_at">;
export function siblingMoveIndex(allRows: OutlinePosition[], visibleRows: OutlinePosition[], rowId: string, direction: "up" | "down"): number | null;
