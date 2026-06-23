/**
 * 項目が最初に書かれた日時を、端末のローカル時刻で表示する。
 * DBには常に年を含むISO 8601の created_at を保存し、画面では月日と時刻だけを表示する。
 */
const entryCreatedAtFormatter = new Intl.DateTimeFormat("ja-JP", {
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
