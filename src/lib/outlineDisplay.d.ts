export interface NumberableEntry {
  id: string;
  parent_id: string | null;
  content: string;
  heading?: string;
  outline_number: string;
}

export function isNumberableEntry(row: Pick<NumberableEntry, "content" | "heading">): boolean;
export function numberMeaningfulOutline<T extends NumberableEntry>(rows: T[]): T[];
export function numberVisibleOutline<T extends NumberableEntry & {
  child_count: number;
  has_children: boolean;
}>(rows: T[]): T[];
