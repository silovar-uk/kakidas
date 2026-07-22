import {
  type EntryRow,
  type LegacyEntryRow,
  type LegacyMemoSyncMetaRow,
  type MemoRow,
  type MemoSyncMetaRow,
  createId,
  isCloudLinked,
  normalizeEntryRow,
  normalizeMemoSyncMeta,
  nowIso,
} from "../types/memo";
import {
  STORE_NAMES,
  getDatabase,
  requestToPromise,
  transactionToPromise,
} from "../lib/db";

/**
 * 一時メモはクラウド同期済みの既存entries経路へ載せる。
 * 常にdeleted_atを持つ専用レコードとして保存するため、通常の単語・文・段落、
 * 件数、コピー、画面表示には現れない。一方でクラウドスナップショットには含まれる。
 */
export const TEMPORARY_MEMO_HEADING = "__kakidas_temporary_memo__";

export type TemporaryMemoRecord = {
  memo_id: string;
  content: string;
  updated_at: string;
};

function isTemporaryMemoEntry(entry: Pick<EntryRow, "kind" | "heading">): boolean {
  return entry.kind === "paragraph" && entry.heading === TEMPORARY_MEMO_HEADING;
}

async function getEntriesForMemo(
  entryStore: IDBObjectStore,
  memoId: string,
): Promise<EntryRow[]> {
  const index = entryStore.index("by_memo_id");
  const rawEntries = await requestToPromise(
    index.getAll(memoId) as IDBRequest<LegacyEntryRow[]>,
  );

  return rawEntries.map(normalizeEntryRow);
}

async function markMemoChanged(
  syncMetaStore: IDBObjectStore,
  memoId: string,
  timestamp: string,
): Promise<void> {
  const rawMeta = await requestToPromise(
    syncMetaStore.get(memoId) as IDBRequest<LegacyMemoSyncMetaRow | undefined>,
  );

  if (!rawMeta) return;

  const meta = normalizeMemoSyncMeta(rawMeta, memoId);
  if (!isCloudLinked(meta)) return;

  const nextState =
    meta.cloud_state === "remote_newer" || meta.cloud_state === "conflict"
      ? "conflict"
      : meta.cloud_state === "error"
        ? "error"
        : "changed_after_upload";

  syncMetaStore.put({
    ...meta,
    cloud_state: nextState,
    last_error: nextState === "error" ? meta.last_error : null,
    updated_at: timestamp,
  } satisfies MemoSyncMetaRow);
}

class TemporaryMemoRepository {
  async get(memoId: string): Promise<TemporaryMemoRecord | null> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.entries, "readonly");
    const entries = await getEntriesForMemo(
      transaction.objectStore(STORE_NAMES.entries),
      memoId,
    );
    const entry = entries.find(isTemporaryMemoEntry);

    await transactionToPromise(transaction);

    if (!entry || entry.content.length === 0) return null;

    return {
      memo_id: memoId,
      content: entry.content,
      updated_at: entry.updated_at,
    };
  }

  async save(memoId: string, content: string): Promise<TemporaryMemoRecord | null> {
    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );
    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const memo = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<MemoRow | undefined>,
    );

    if (!memo || memo.deleted_at !== null) {
      transaction.abort();
      throw new Error("一時メモの保存先が見つかりません。");
    }

    const entries = await getEntriesForMemo(entryStore, memoId);
    const existing = entries.find(isTemporaryMemoEntry);
    const nextContent = content;

    if (existing?.content === nextContent) {
      await transactionToPromise(transaction);
      return nextContent.length === 0
        ? null
        : { memo_id: memoId, content: nextContent, updated_at: existing.updated_at };
    }

    if (!existing && nextContent.length === 0) {
      await transactionToPromise(transaction);
      return null;
    }

    const timestamp = nowIso();
    const entry: EntryRow = existing
      ? {
          ...existing,
          content: nextContent,
          heading: TEMPORARY_MEMO_HEADING,
          parent_id: null,
          tag: null,
          note: "",
          link_url: "",
          satisfaction: 0,
          is_completed: false,
          updated_at: timestamp,
          // 通常一覧から必ず除外されるよう、専用レコードは常に削除済みとして扱う。
          deleted_at: timestamp,
        }
      : {
          id: createId(),
          memo_id: memoId,
          user_id: memo.user_id,
          kind: "paragraph",
          parent_id: null,
          content: nextContent,
          heading: TEMPORARY_MEMO_HEADING,
          tag: null,
          note: "",
          link_url: "",
          satisfaction: 0,
          is_completed: false,
          sort_order: Number.MAX_SAFE_INTEGER,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: timestamp,
        };

    entryStore.put(entry);
    memoStore.put({ ...memo, updated_at: timestamp } satisfies MemoRow);
    await markMemoChanged(syncMetaStore, memoId, timestamp);
    await transactionToPromise(transaction);

    return nextContent.length === 0
      ? null
      : { memo_id: memoId, content: nextContent, updated_at: timestamp };
  }

  async clear(memoId: string): Promise<void> {
    await this.save(memoId, "");
  }
}

export const temporaryMemoRepository = new TemporaryMemoRepository();
