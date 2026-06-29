import type { MemoSortMode } from "../types/memo";

const MEMO_SORT_MODE_STORAGE_KEY = "kakidas.memo-list-sort";

export function readMemoSortMode(): MemoSortMode {
  try {
    const value = window.localStorage.getItem(MEMO_SORT_MODE_STORAGE_KEY);
    return value === "created_desc" ? "created_desc" : "updated_desc";
  } catch {
    return "updated_desc";
  }
}

export function writeMemoSortMode(mode: MemoSortMode): void {
  try {
    window.localStorage.setItem(MEMO_SORT_MODE_STORAGE_KEY, mode);
  } catch {
    // 端末設定を保存できなくても、その場の表示切り替えを優先する。
  }
}
