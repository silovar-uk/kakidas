import test from "node:test";
import assert from "node:assert/strict";
import { renderParagraphMarkdown, safeMarkdownHref } from "../src/lib/paragraphMarkdown.js";

test("paragraph Markdown renders headings, bold, breaks, nested list, quote and GFM table", () => {
  const html = renderParagraphMarkdown("# 見出し\n\n**重要**\n次の行\n\n- 親\n  - 子\n\n> 引用\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
  for (const tag of ["<h1>", "<strong>", "<br>", "<ul>", "<blockquote>", "<table>"]) assert.ok(html.includes(tag), tag);
});
test("raw HTML is escaped and Markdown images never request external data", () => {
  const html = renderParagraphMarkdown('<script>alert(1)</script>\n\n![外部画像](https://example.com/pixel.png)');
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("外部画像"));
});
test("links use a strict protocol allowlist", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/x", "//example.com", "/memos/x", null]) assert.equal(safeMarkdownHref(url), null);
  assert.equal(safeMarkdownHref("https://example.com"), "https://example.com/");
});
test("fenced code preserves internal blank lines", () => {
  const html = renderParagraphMarkdown("~~~txt\nfirst\n\n\nlast\n~~~");
  assert.ok(html.includes("first\n\n\nlast"));
});
test("GFM checklists render read-only check states", () => {
  const html = renderParagraphMarkdown("- [x] 済\n- [ ] 未");
  assert.ok(html.includes('type="checkbox"'));
  assert.ok(html.includes("checked"));
});
