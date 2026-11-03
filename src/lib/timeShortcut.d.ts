export function matchesInsertTimeShortcut(event: KeyboardEvent): boolean;
export function formatLocalClockTime(date?: Date): string;
export function isTimeInsertField(target: EventTarget | null): target is HTMLTextAreaElement;
export function insertTimeIntoField(field: HTMLTextAreaElement, time: string, doc?: Document): boolean;
