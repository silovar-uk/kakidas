export type FoldableOutlineRow = {
  id: string;
  parent_id: string | null;
  depth: number;
  has_children: boolean;
};
export function foldableBranchesAtLevel<T extends FoldableOutlineRow>(rows: T[], depth: number, scopeId?: string | null): string[];
export function toggleFoldedLevel<T extends FoldableOutlineRow>(collapsed: Set<string>, rows: T[], depth: number, scopeId?: string | null): Set<string>;
export function parseFoldedIds(value: string | null): string[];
