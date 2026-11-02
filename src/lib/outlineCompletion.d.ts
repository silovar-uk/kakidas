import type { EntryRow } from "../types/memo";
export type OutlineCompletionChange = { id: string; previous: boolean; next: boolean };
export function planOutlineCompletion(rows: Pick<EntryRow, "id" | "parent_id" | "kind" | "deleted_at" | "is_completed">[], id: string, completed: boolean): OutlineCompletionChange[];
export function visibleOutlineWithAncestors<T extends { id: string; parent_id: string | null; is_completed: boolean }>(rows: T[]): T[];
