export type HeadingColor = "red" | "orange" | "ochre" | "green" | "blue" | "purple" | null;
export const HEADING_COLORS: readonly { id: HeadingColor; label: string; hex: string }[];
export function normalizeHeadingColor(value: unknown): HeadingColor;
export function headingColorHex(value: unknown): string | undefined;
export function sharedHeadingColor(entries: readonly { heading_color?: unknown }[]): HeadingColor;
export function isMissingHeadingColorColumn(error: unknown): boolean;
export function prepareHeadingColorUpload<T extends { kind: string; heading_color?: HeadingColor }>(entries: T[], supported: boolean): T[];
export function legacyCloudWouldLoseHeadingColor(local: readonly { kind: string; deleted_at: string | null; heading_color?: unknown }[], remote: readonly { heading_color?: unknown }[]): boolean;
