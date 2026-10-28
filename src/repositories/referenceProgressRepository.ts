import { getDatabase, requestToPromise, transactionToPromise, STORE_NAMES } from "../lib/db";

export type ReferenceProgress = {
  entry_id: string;
  memo_id: string;
  opened_at: string | null;
  reviewed_at: string | null;
  starred_at: string | null;
};

/**
 * 閲覧した／内容を確認した／注目した、は既存の「完了」から独立。
 * Entryを書き換えないため、URLの編集履歴やクラウド同期状態も汚さない。
 * 記録はメモと同じIndexedDB内に保管する。
 */
export async function listReferenceProgress(memoId: string): Promise<ReferenceProgress[]> {
  const db = await getDatabase();
  const tx = db.transaction(STORE_NAMES.referenceProgress, "readonly");
  const rows = await requestToPromise(
    tx.objectStore(STORE_NAMES.referenceProgress).index("by_memo_id").getAll(memoId) as IDBRequest<ReferenceProgress[]>,
  );
  await transactionToPromise(tx);
  return rows;
}

export async function patchReferenceProgress(
  memoId: string,
  entryId: string,
  patch: Partial<Pick<ReferenceProgress, "opened_at" | "reviewed_at" | "starred_at">>,
): Promise<ReferenceProgress> {
  const db = await getDatabase();
  const tx = db.transaction(STORE_NAMES.referenceProgress, "readwrite");
  const store = tx.objectStore(STORE_NAMES.referenceProgress);
  const previous = await requestToPromise(store.get(entryId) as IDBRequest<ReferenceProgress | undefined>);
  const next: ReferenceProgress = {
    entry_id: entryId,
    memo_id: memoId,
    opened_at: previous?.opened_at ?? null,
    reviewed_at: previous?.reviewed_at ?? null,
    starred_at: previous?.starred_at ?? null,
    ...patch,
  };
  store.put(next);
  await transactionToPromise(tx);
  window.dispatchEvent(new CustomEvent("kakidas:reference-progress", { detail: memoId }));
  try {
    const channel = new BroadcastChannel("kakidas-reference-progress");
    channel.postMessage(memoId);
    channel.close();
  } catch { /* 古いSafariでも保存処理は継続 */ }
  return next;
}
