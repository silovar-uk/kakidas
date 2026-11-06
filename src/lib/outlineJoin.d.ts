import type { BlankRow } from "./outlineBlank.js";
export type OutlineJoinPlan =
  | { kind: "none" }
  | { kind: "blocked"; reason: string }
  | { kind: "join"; nextId: string; nextContent: string; isBlank: boolean };
export function planOutlineEndDelete<T extends BlankRow>(
  allRows: T[], visibleRows: T[], currentId: string, linkedParagraphCount?: number
): OutlineJoinPlan;
