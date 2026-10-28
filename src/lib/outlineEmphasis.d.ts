export type OutlineEmphasisSegment = { text: string; emphasized: boolean };
export function stripOutlineEmphasis(text: string): string;
export function outlineEmphasisSegments(text: string): OutlineEmphasisSegment[];
export function toggleOutlineEmphasis(value: string, start: number, end: number): {value: string; start: number; end: number};
