/**
 * テキスト貼り付けの共通解析。明確な構造は即時処理、曖昧なものは確認。
 * 通常の文章の字下げ・表・コードを勝手に階層化しない。
 */
const BULLET = /^(?:[-*+]\s+|[•●○・]\s*|(?:\d+(?:\.\d+)+|\d+[.)．、]|[①-⑳])\s+)/u;
const cleanText = line => {
  let result = line.trim();
  // Numbered copy may prefix an explicit empty bullet: "1. •".
  while (BULLET.test(result)) {
    const next = result.replace(BULLET, "").trim();
    if (next === result) break;
    result = next;
  }
  return result;
};
const prefix = line => (line.match(/^[\t ]*/u) ?? [""])[0];
const width = str => [...str].reduce((sum, ch) => sum + (ch === "\t" ? 4 : 1), 0);

export function analyzeOutlinePaste(text, { mode = "auto" } = {}) {
  const raw = text.replace(/\r\n?/gu, "\n");
  const trimmed = raw.split("\n").filter(line => line.trim()).map(line => {
    const leading = prefix(line);
    const body = line.slice(leading.length);
    return { leading, width: width(leading), content: cleanText(body), bullet: BULLET.test(body.trimStart()) };
  }).filter(item => item.content || item.bullet);
  if (!trimmed.length) return { items: [], needsReview: false, reasons: [], format: "plain" };
  const hasTab = trimmed.some(x => x.leading.includes("\t"));
  const hasSpace = trimmed.some(x => x.leading.includes(" "));
  const listed = trimmed.some(x => x.bullet);
  const fenced = /^\s*(?:\x60{3,}|~{3,})/m.test(raw);
  const table = trimmed.some(x => /^\|.+\|$/u.test(x.content));
  const isCode = trimmed.some(x => /^(?:const|let|var|function|class|if|for|return|import|export)\b/u.test(x.content) && /[;{}]/u.test(x.content));
  const reasons = [];
  const explicit = mode === "two" ? 2 : mode === "four" ? 4 : null;
  const useSpaces = mode === "two" || mode === "four" || (mode === "auto" && listed && !fenced && !isCode && !table);
  const depths = trimmed.map(x => {
    if (mode === "flat") return 0;
    if (!useSpaces) return x.leading.replace(/ /g, "").length;
    return x.width;
  });
  let unit = explicit ?? 1;
  if (useSpaces && !explicit) {
    const levels = [...new Set(depths)].sort((a,b) => a-b);
    const differences = levels.slice(1).map((v,i)=>v-levels[i]).filter(x=>x>0);
    unit = differences.length && differences.every(n=>n%4===0) ? 4 : 2;
  }
  if (fenced || table || isCode) reasons.push("文章・表・コードの可能性があります");
  if (hasTab && hasSpace && mode === "auto") reasons.push("Tabとスペースが混在しています");
  if (useSpaces && depths.some(d => d % unit !== 0)) reasons.push("字下げ幅が不規則です");
  if (!hasTab && !listed && hasSpace && mode === "auto") reasons.push("普通の文章の字下げかもしれません");
  const items = [];
  const levels = [depths[0]];
  for (let i=0;i<trimmed.length;i++) {
    const w=depths[i];
    if (i) {
      if (w > levels.at(-1)) {
        levels.push(w);
        if (w-levels.at(-2)>unit && useSpaces) reasons.push("階層が飛んでいる行があります");
      } else {
        while (levels.length > 1 && w < levels.at(-1)) levels.pop();
        if (w > levels.at(-1)) levels.push(w);
      }
    }
    items.push({ content: trimmed[i].content, depth: levels.length-1 });
  }
  const format = mode === "flat" ? "plain" : hasTab ? "tabs" : useSpaces ? "markdown" : "plain";
  if (items.length > 30) reasons.push("大量の項目を取り込みます");
  return { items, needsReview: reasons.length > 0, reasons:[...new Set(reasons)], format };
}

export function normalizeOutlineItems(text) { return analyzeOutlinePaste(text).items; }
export function normalizeOutlineLines(text) { return normalizeOutlineItems(text).map(item => item.content); }
export function itemsFromOutlinePaste(existing, selectionStart, selectionEnd, pasted) {
  if (normalizeOutlineItems(pasted).length < 2) return null;
  const start = Math.max(0,Math.min(selectionStart,existing.length));
  const end = Math.max(start,Math.min(selectionEnd,existing.length));
  return normalizeOutlineItems(existing.slice(0,start)+pasted+existing.slice(end));
}
export function rowsFromOutlinePaste(existing,selectionStart,selectionEnd,pasted) {
  return itemsFromOutlinePaste(existing,selectionStart,selectionEnd,pasted)?.map(item=>item.content) ?? null;
}
export function serializeOutlineItems(items) {
  return items.map(item=>"\t".repeat(item.depth)+(item.content || "•")).join("\n");
}
