/**
 * Ctrl+Bで強調する文字列は、本文中の **...** として保存する。
 * 従来の文字列フィールドのままUndo・自動保存でき、表示側では赤い太字に変換する。
 */
export function stripOutlineEmphasis(text) {
  return String(text ?? "").replace(/\*\*([^*\n]+)\*\*/g, "$1");
}
export function outlineEmphasisSegments(text) {
  const parts = String(text ?? "").split(/(\*\*[^*\n]+\*\*)/g);
  return parts.filter(Boolean).map(part => part.startsWith("**") && part.endsWith("**") && part.length > 4
    ? { text: part.slice(2, -2), emphasized: true }
    : { text: part, emphasized: false });
}
/**
 * 選択範囲があればそこを装飾・解除する。範囲がなければ行全体を切り替える。
 * 選択開始位置は実際の文字列のoffset (UTF-16 code units)。
 */
export function toggleOutlineEmphasis(value, start, end) {
  const content = String(value ?? "");
  const a = Math.max(0, Math.min(content.length, Math.min(start, end)));
  const b = Math.max(a, Math.min(content.length, Math.max(start, end)));
  if (a === b) {
    const wrapped = /^\*\*([^*\n]+)\*\*$/.exec(content);
    if (wrapped) return { value: wrapped[1], start: 0, end: wrapped[1].length };
    const plain = stripOutlineEmphasis(content);
    const next = "**" + plain + "**";
    return { value: next, start: 2, end: 2 + plain.length };
  }
  const prior = content.slice(0, a), selected = content.slice(a, b), after = content.slice(b);
  if (selected.startsWith("**") && selected.endsWith("**") && selected.length > 4) {
    const raw = selected.slice(2, -2);
    return { value: prior + raw + after, start: a, end: a + raw.length };
  }
  // 既存の強調トークンの内側が選択されたら、その外側の記号を外す。
  if (prior.endsWith("**") && after.startsWith("**")) {
    return { value: prior.slice(0, -2) + selected + after.slice(2), start: a - 2, end: b - 2 };
  }
  return { value: prior + "**" + selected + "**" + after, start: a + 2, end: b + 2 };
}
