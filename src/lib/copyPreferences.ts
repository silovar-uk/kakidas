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
