export type OutlinePasteItem = { content: string; depth: number };
export declare function normalizeOutlineItems(text: string): OutlinePasteItem[];
export declare function normalizeOutlineLines(text: string): string[];
export declare function itemsFromOutlinePaste(existing: string, selectionStart: number, selectionEnd: number, pasted: string): OutlinePasteItem[] | null;
export declare function rowsFromOutlinePaste(existing: string, selectionStart: number, selectionEnd: number, pasted: string): string[] | null;
export declare function serializeOutlineItems(items: OutlinePasteItem[]): string;

export type OutlinePasteAnalysis = { items: OutlinePasteItem[]; needsReview: boolean; reasons: string[]; format: string };
export declare function analyzeOutlinePaste(text: string, options?: {mode?: "auto"|"flat"|"two"|"four"}): OutlinePasteAnalysis;
