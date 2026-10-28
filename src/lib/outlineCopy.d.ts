import type { EntryTreeNode } from "../types/memo";
export type OutlineCopyMode = "outliner" | "textMemo";
export type OutlineCopyResult = {
  text: string;
  count: number;
};
export function buildOutlineCopy(
  rows: EntryTreeNode[],
  options: {
    mode: OutlineCopyMode;
    rootId?: string | null;
    includeCompleted?: boolean;
  }
): OutlineCopyResult;
