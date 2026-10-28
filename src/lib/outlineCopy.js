/**
 * アウトライン専用のコピー形式。画面の番号表示・折りたたみ・タグ表示から独立して、
 * getEntryTree(..., "sentence", "manual") が返す全行を使う。
 *
 * すべての出力は文字列として生成し、保存された項目を変更しない。
 */
import { stripOutlineEmphasis } from "./outlineEmphasis.js";

const normalizeContent = (value) => stripOutlineEmphasis(String(value ?? ""))
  .replace(/[\r\n]+/g, " ")
  .replace(/\t/g, " ")
  .trim();

export function buildOutlineCopy(rows, { mode, rootId = null, includeCompleted = false } = {}) {
  if (mode !== "outliner" && mode !== "textMemo") throw new Error("コピー形式を指定してください。");
  const byId = new Map(rows.map(row => [row.id, row]));
  if (rootId !== null && !byId.has(rootId)) {
    return { text: "", count: 0 };
  }

  // 親が完了済みで出力から外れる場合も、子孫は直近の表示対象の親へ繰り上げる。
  const parentsOf = (row) => {
    const parents = [];
    const seen = new Set([row.id]);
    let cursor = row.parent_id;
    while (cursor && byId.has(cursor) && !seen.has(cursor)) {
      parents.push(cursor);
      seen.add(cursor);
      cursor = byId.get(cursor).parent_id;
    }
    return parents;
  };
  const allParents = new Map(rows.map(row => [row.id, parentsOf(row)]));
  const inScope = row => rootId === null || row.id === rootId ||
    allParents.get(row.id).includes(rootId);
  const included = rows.filter(row => inScope(row) && (includeCompleted || !row.is_completed));
  const includedIds = new Set(included.map(row => row.id));
  const siblingCount = new Map();
  const nodesById = new Map();
  const roots = [];
  const prepared = [];

  for (const row of included) {
    const parentId = allParents.get(row.id).find(id => includedIds.has(id)) ?? null;
    const parentNode = parentId ? nodesById.get(parentId) : null;
    const index = (siblingCount.get(parentId) ?? 0) + 1;
    siblingCount.set(parentId, index);
    const numbers = parentNode ? [...parentNode.numbers, index] : [index];
    const node = {
      id: row.id,
      content: normalizeContent(row.content),
      depth: numbers.length - 1,
      numbers,
      children: [],
    };
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
    nodesById.set(row.id, node);
    prepared.push(node);
  }

  const text = prepared.map(node => mode === "outliner"
    ? "\t".repeat(node.depth) + node.content
    : "  ".repeat(node.depth) + node.numbers.join(".") + (node.depth === 0 ? "." : "") + " " + node.content
  ).join("\n");

  return { text, count: prepared.length };
}
