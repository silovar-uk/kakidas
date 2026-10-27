/**
 * アウトラインへ貼り付ける文章を、同階層の独立した項目に直す。
 * 空白行は無視。行頭の箇条書き記号だけを除去し、通常の文中の記号は残す。
 */
export function normalizeOutlineLines(text) {
  return text.replace(/\r\n?/gu, "\n").split("\n")
    .map((line) => line.trim()
      .replace(/^(?:[-*]\s+|[•●○・]\s*|(?:\d+[.)．、]|[①-⑳])\s+)/u, "")
      .trim())
    .filter(Boolean);
}

/**
 * 貼り付け文字列に複数の有効行があるときだけ構造化する。
 * 入力欄の選択範囲を尊重し、その前後の文章も失わず、行単位で分ける。
 * @returns {string[] | null} 通常の1行ペーストはnull（ブラウザ標準の挿入を使う）。
 */
export function rowsFromOutlinePaste(existing, selectionStart, selectionEnd, pasted) {
  if (normalizeOutlineLines(pasted).length < 2) return null;
  const start = Math.max(0, Math.min(selectionStart, existing.length));
  const end = Math.max(start, Math.min(selectionEnd, existing.length));
  return normalizeOutlineLines(existing.slice(0, start) + pasted + existing.slice(end));
}
