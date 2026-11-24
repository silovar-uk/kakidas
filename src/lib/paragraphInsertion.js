/** 通常追加はDB内で末尾を求める。明示された挿入位置だけ index を返す。 */
export function resolveParagraphInsertionIndex(entries, anchor) {
  if (anchor === "^") return 0;
  if (!anchor) return undefined;
  const at = entries.findIndex(entry => entry.id === anchor);
  return at < 0 ? undefined : at + 1;
}
