/**
 * URL入力中も備考入力中も同じ操作で保存する。
 * IME変換確定のEnterは決して保存に使わない。
 */
export function isReferenceSubmitShortcut(event, composing = false) {
  return event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey && !event.shiftKey &&
    !composing && !event.isComposing &&
    !event.nativeEvent?.isComposing &&
    event.nativeEvent?.keyCode !== 229;
}
