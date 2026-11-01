/**
 * 貼り付けテキストを、Tabの字下げを保持したアウトラインに直す。
 * 行頭のTabのみ階層として解釈し、文章中のTabや半角空白は階層に変換しない。
 * 見た目の字下げが飛んでも、実在しない親を作らず直前の子に丸める。
 */
const cleanText = line => line.trim()
  .replace(/^(?:[-*]\s+|[•●○・]\s*|(?:\d+[.)．、]|[①-⑳])\s+)/u, "")
  .trim();

export function normalizeOutlineItems(text) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n")
    .map(line => ({ indent: (line.match(/^\t*/u) ?? [""])[0].length, content: cleanText(line) }))
    .filter(item => item.content.length > 0);
  if (!lines.length) return [];
  const base = lines[0].indent;
  const indentationLevels = [base];
  return lines.map((line, index) => {
    if (index > 0) {
      if (line.indent > indentationLevels[indentationLevels.length - 1]) {
        indentationLevels.push(line.indent);
      } else {
        while (indentationLevels.length > 1 && line.indent < indentationLevels[indentationLevels.length - 1])
          indentationLevels.pop();
        if (line.indent > indentationLevels[indentationLevels.length - 1])
          indentationLevels.push(line.indent);
      }
    }
    return { content: line.content, depth: indentationLevels.length - 1 };
  });
}

/** 従来の同階層ペースト処理からも利用できる、文章だけの一覧。 */
export function normalizeOutlineLines(text) {
  return normalizeOutlineItems(text).map(item => item.content);
}

/**
 * 通常の1行ペーストはブラウザの標準動作を維持し、
 * 複数行のみ「テキスト＋相対階層」の配列を返す。
 */
export function itemsFromOutlinePaste(existing, selectionStart, selectionEnd, pasted) {
  if (normalizeOutlineItems(pasted).length < 2) return null;
  const start = Math.max(0, Math.min(selectionStart, existing.length));
  const end = Math.max(start, Math.min(selectionEnd, existing.length));
  return normalizeOutlineItems(existing.slice(0, start) + pasted + existing.slice(end));
}

/** 旧API互換: テキストだけ使う箇所・単体テストはそのまま動く。 */
export function rowsFromOutlinePaste(existing, selectionStart, selectionEnd, pasted) {
  return itemsFromOutlinePaste(existing, selectionStart, selectionEnd, pasted)?.map(item => item.content) ?? null;
}

/** 保存失敗時に階層を保ったまま入力欄へ戻すための可逆形式。 */
export function serializeOutlineItems(items) {
  return items.map(item => "\t".repeat(item.depth) + item.content).join("\n");
}
