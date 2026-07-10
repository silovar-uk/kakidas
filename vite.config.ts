import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 既存データ形式を変えず、表示に関わる小さな統一だけをビルド前に適用する。
 * - 気持ちアイコンを、入力時に使っているレポート風アイコンへ統一
 * - 新規メモの日付タイトルを「m/d 曜「」」形式へ変更
 */
function applyKakidasUiConsistency(): Plugin {
  return {
    name: "kakidas-ui-consistency",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replace(/\\/gu, "/");

      if (normalizedId.endsWith("/src/components/EntryItem.tsx")) {
        const nextSource = source
          .replace(
            '<path d="m4 16.7-.7 4 4-.7L18.7 8.6l-3.3-3.3L4 16.7Z" />',
            '<path d="M5.5 4.8h13v14.4H9.3l-3.8 2.4V4.8Z" />',
          )
          .replace(
            '<path d="m13.9 6.8 3.3 3.3" />',
            '<path d="M8.3 9h7.4M8.3 12.6h5.4" />',
          );

        return nextSource === source ? null : nextSource;
      }

      if (normalizedId.endsWith("/src/types/memo.ts")) {
        const oldFormatter = `function formatMemoDatePrefix(date: Date): string {
  return \`${"${date.getMonth() + 1}/${date.getDate()}"}\`;
}`;
        const newFormatter = `const JAPANESE_WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatMemoDatePrefix(date: Date): string {
  const weekday = JAPANESE_WEEKDAY_LABELS[date.getDay()];
  return \`${"${date.getMonth() + 1}/${date.getDate()} ${weekday}"}\`;
}`;
        const nextSource = source.replace(oldFormatter, newFormatter);

        return nextSource === source ? null : nextSource;
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [applyKakidasUiConsistency(), react()],
});
