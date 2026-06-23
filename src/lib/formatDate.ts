/**
 * 項目が最初に書かれた日時を、端末のローカル時刻で表示する。
 * DBには常にISO 8601の created_at を保存し、表示だけをここで整える。
 */
const entryCreatedAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatEntryCreatedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "日時不明";
  }

  return entryCreatedAtFormatter.format(date);
}
