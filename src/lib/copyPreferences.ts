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
export const ENTRY_SORT_MODE_STORAGE_KEY = "kakidas.entry-sort-mode";

export function readEntrySortMode(): EntrySortMode {
  try {
    const value = window.localStorage.getItem(ENTRY_SORT_MODE_STORAGE_KEY);

    if (
      value === "created_asc" ||
      value === "created_desc" ||
      value === "satisfaction_desc"
    ) {
      return value;
    }
  } catch {
    // ストレージが使えなくても、初期値で画面とコピーは動く。
  }

  // 項目を先頭に追加する現在の初期挙動に合わせ、新しい順を既定にする。
  return "created_desc";
}

export function writeEntrySortMode(value: EntrySortMode): void {
  try {
    window.localStorage.setItem(ENTRY_SORT_MODE_STORAGE_KEY, value);
  } catch {
    // private modeなどで保存できなくても、その場の切り替えは維持する。
  }
}
