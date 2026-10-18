import type { EntrySortMode } from "../types/memo";

/**
 * コピー時に完了済み項目を含めるかどうかは、端末ごとのUI設定。
 * メモ本文やクラウド同期データには保存しない。
 */
export const COPY_INCLUDE_COMPLETED_STORAGE_KEY = "kakidas.copy-include-completed";

/** 初期状態は、作業中の項目だけをコピーする。 */
export function readCopyIncludeCompleted(): boolean {
  try {
    return window.localStorage.getItem(COPY_INCLUDE_COMPLETED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeCopyIncludeCompleted(value: boolean): void {
  try {
    window.localStorage.setItem(COPY_INCLUDE_COMPLETED_STORAGE_KEY, String(value));
  } catch {
    // private modeなどで保存できなくても、その場の切り替えは維持する。
  }
}

/**
 * 項目の見え方とコピー順に使う、端末ごとの並び順設定。
 * メモ本文やクラウド同期データには保存しない。
 */
export const ENTRY_SORT_MODE_STORAGE_KEY = "kakidas.entry-sort-mode.v2";
/** v0.8.0より前の保存名。開くたびに既定値(新しい順)が書き込まれたため、本人の選択と区別できる値だけ読む。 */
const LEGACY_ENTRY_SORT_MODE_STORAGE_KEY = "kakidas.entry-sort-mode";

export function readEntrySortMode(): EntrySortMode {
  try {
    const value = window.localStorage.getItem(ENTRY_SORT_MODE_STORAGE_KEY);

    if (
      value === "manual" ||
      value === "created_asc" ||
      value === "created_desc" ||
      value === "satisfaction_desc"
    ) {
      return value;
    }

    // 未設定なら旧い保存名を読む。既定以外(古い順・評価順)を選んでいた人だけ引き継ぐ。
    const legacy = window.localStorage.getItem(LEGACY_ENTRY_SORT_MODE_STORAGE_KEY);
    if (legacy === "created_asc" || legacy === "satisfaction_desc") return legacy;
  } catch {
    // ストレージが使えなくても、初期値で画面とコピーは動く。
  }

  // 段落は書いた順に文書として組むため、手動の順を既定にする。
  // 段落は先頭へ足してきたので、最初の見え方は新しい順のまま変わらない。
  return "manual";
}

export function writeEntrySortMode(value: EntrySortMode): void {
  try {
    window.localStorage.setItem(ENTRY_SORT_MODE_STORAGE_KEY, value);
  } catch {
    // private modeなどで保存できなくても、その場の切り替えは維持する。
  }
}
