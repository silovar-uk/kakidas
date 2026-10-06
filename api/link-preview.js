import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_HTML_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 8_000;

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported protocol");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Private host");
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0) throw new Error("Host not found");

  for (const record of resolved) {
    const version = net.isIP(record.address);
    if (
      (version === 4 && isPrivateIpv4(record.address)) ||
      (version === 6 && isPrivateIpv6(record.address))
    ) {
      throw new Error("Private address");
    }
  }

  return url;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(value) {
  return decodeEntities(value || "").replace(/\s+/g, " ").trim();
}

function readMetaContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return "";
}

function readTitle(html) {
  return (
    readMetaContent(html, "og:title") ||
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  );
}

function readSiteName(html) {
  return readMetaContent(html, "og:site_name");
}

function readFavicon(html, pageUrl) {
  const patterns = [
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return new URL(match[1], pageUrl).href;
    } catch {
      // Fall through to /favicon.ico.
    }
  }

  return new URL("/favicon.ico", pageUrl).href;
}

async function readLimitedText(response) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
    output += decoder.decode(value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (!rawUrl) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  try {
    const target = await assertPublicUrl(rawUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(target, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; kakidas-link-preview/1.0)",
          accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      res.status(200).json({
        url: target.href,
        title: "",
        siteName: target.hostname.replace(/^www\./, ""),
        faviconUrl: new URL("/favicon.ico", target).href,
      });
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      res.status(200).json({
        url: response.url || target.href,
        title: "",
        siteName: target.hostname.replace(/^www\./, ""),
        faviconUrl: new URL("/favicon.ico", response.url || target).href,
      });
      return;
    }

    const html = await readLimitedText(response);
    const finalUrl = response.url || target.href;

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({
      url: finalUrl,
      title: readTitle(html),
      siteName: readSiteName(html) || new URL(finalUrl).hostname.replace(/^www\./, ""),
      faviconUrl: readFavicon(html, finalUrl),
    });
  } catch {
    res.status(400).json({ error: "URLの情報を取得できませんでした。" });
  }
}
