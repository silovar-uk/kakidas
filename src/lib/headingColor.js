export const HEADING_COLORS = Object.freeze([
  { id: null, label: "標準", hex: "#23211d" },
  { id: "red", label: "赤", hex: "#a03932" },
  { id: "orange", label: "橙", hex: "#95500c" },
  { id: "ochre", label: "黄土", hex: "#78600b" },
  { id: "green", label: "緑", hex: "#28664c" },
  { id: "blue", label: "青", hex: "#285b98" },
  { id: "purple", label: "紫", hex: "#754b97" },
]);
export function normalizeHeadingColor(value) {
  return HEADING_COLORS.some(color => color.id === value) ? value : null;
}
export function headingColorHex(value) {
  const id = normalizeHeadingColor(value);
  return id === null ? undefined : HEADING_COLORS.find(color => color.id === id)?.hex;
}
export function sharedHeadingColor(entries) {
  const colors = new Set(entries.map(entry => normalizeHeadingColor(entry.heading_color)));
  return colors.size === 1 ? [...colors][0] : null;
}
export function isMissingHeadingColorColumn(error) {
  return (error?.code === "42703" || error?.code === "PGRST204") &&
    String(error?.message ?? "").includes("heading_color");
}
export function prepareHeadingColorUpload(entries, supported) {
  if (supported) return entries.map(entry => ({ ...entry, heading_color: entry.kind === "paragraph" ? normalizeHeadingColor(entry.heading_color) : null }));
  if (entries.some(entry => entry.kind === "paragraph" && normalizeHeadingColor(entry.heading_color) !== null))
    throw new Error("見出し色は端末に保存されています。クラウドにも保存するには、Supabaseで見出し色のSQL更新を実行してください。");
  return entries.map(({ heading_color, ...entry }) => entry);
}
export function legacyCloudWouldLoseHeadingColor(local, remote) {
  const remoteHasColorColumn = remote.some(entry => entry.heading_color !== undefined);
  return !remoteHasColorColumn && local.some(entry => entry.deleted_at === null && entry.kind === "paragraph" && normalizeHeadingColor(entry.heading_color) !== null);
}
