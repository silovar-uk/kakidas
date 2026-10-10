export async function fetchReferenceTitle(url: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {headers:{Accept:"application/json"}});
    if (!response.ok) return null;
    const payload: {title?: unknown} = await response.json();
    return typeof payload.title === "string" ? payload.title.replace(/\s+/gu," ").trim() || null : null;
  } catch { return null; }
}
