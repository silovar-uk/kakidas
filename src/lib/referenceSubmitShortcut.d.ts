export type ReferenceShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};
export function isReferenceSubmitShortcut(event: ReferenceShortcutEvent, composing?: boolean): boolean;
