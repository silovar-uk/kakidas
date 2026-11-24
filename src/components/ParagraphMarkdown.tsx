import { createElement, memo, useMemo, useState, type ReactNode } from "react";
import { renderParagraphMarkdown, safeMarkdownHref } from "../lib/paragraphMarkdown.js";

const allowed = new Set(["p","h1","h2","h3","h4","h5","h6","strong","em","del","s","br","hr",
  "ul","ol","li","blockquote","pre","code","table","thead","tbody","tr","th","td","a","input"]);
function toReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  const children = Array.from(node.childNodes, (child, i) => toReact(child, i));
  if (!allowed.has(tag)) return node.textContent;
  if (tag === "a") {
    const href = safeMarkdownHref(node.getAttribute("href"));
    return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span key={key}>{children}</span>;
  }
  if (tag === "input") return node.getAttribute("type") === "checkbox"
    ? <input key={key} type="checkbox" checked={node.hasAttribute("checked")} disabled readOnly aria-label="チェック項目" /> : null;
  if (tag === "br" || tag === "hr") return createElement(tag, { key });
  if (tag === "ol") return <ol key={key} start={Number(node.getAttribute("start")) || 1}>{children}</ol>;
  if (tag === "table") return <div key={key} className="paragraph-markdown__table" tabIndex={0} role="region" aria-label="表（横スクロール）"><table>{children}</table></div>;
  if (tag === "th" || tag === "td") {
    const align = node.getAttribute("align");
    const textAlign = align === "left" || align === "center" || align === "right" ? align : undefined;
    return createElement(tag, { key, style: { textAlign } }, children);
  }
  return createElement(tag, { key }, children);
}

export const ParagraphMarkdown = memo(function ParagraphMarkdown({ source, raw = false }: { source: string; raw?: boolean }) {
  const rendered = useMemo(() => {
    if (raw || typeof document === "undefined") return null;
    try {
      // A detached template is inert. Build React nodes from an explicit allowlist,
      // never mount parsed HTML or copy arbitrary attributes into the document.
      const template = document.createElement("template");
      template.innerHTML = renderParagraphMarkdown(source);
      return Array.from(template.content.childNodes, (node, i) => toReact(node, i));
    } catch { return null; }
  }, [source, raw]);
  return <div className={raw || rendered === null ? "paragraph-markdown paragraph-markdown--raw" : "paragraph-markdown"}>{rendered ?? source}</div>;
});

export function ParagraphMarkdownPreview({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  return <div className="paragraph-markdown-preview">
    <button type="button" className="paragraph-markdown__action" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      {open ? "プレビューを閉じる" : "Markdownプレビュー"}
    </button>
    {open ? <div className="paragraph-markdown-preview__paper"><ParagraphMarkdown source={source} /></div> : null}
  </div>;
}
