import { Marked } from "marked";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

// Only explicit web/mail links are activated. No relative, file, data or script URLs.
export function safeMarkdownHref(value) {
  if (typeof value !== "string" || !/^(https?:\/\/|mailto:)/i.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

const parser = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    // Raw HTML is text, not markup; images are labels, never external requests.
    html(token) { return escapeHtml(token.text); },
    image(token) { return escapeHtml(token.text || token.href); },
  },
});

export function renderParagraphMarkdown(source) {
  return parser.parse(source, { async: false });
}
