import {
  type BackupPayload,
  type EntryInsert,
  type EntryRow,
  type EntryUpdate,
  type MemoInsert,
  type MemoRow,
  type MemoUpdate,
  type MemoWithEntries,
  createId,
  formatDefaultMemoTitle,
  nowIso,
} from "../types/memo";
import {
  STORE_NAMES,
  getDatabase,
  requestToPromise,
  transactionToPromise,
} from "../lib/db";

/**
 * UIはこのinterfaceだけを見る。
 * 将来は IndexedDbMemoRepository を SupabaseMemoRepository に置き換えるだけで、
 * 画面・Hook・コンポーネントを変えずに同期対応できる。
 */
export interface MemoRepository {
  listMemos(): Promise<MemoRow[]>;
  getMemo(memoId: string): Promise<MemoWithEntries | null>;

  createMemo(input?: Partial<MemoInsert>): Promise<MemoRow>;
  updateMemo(memoId: string, patch: MemoUpdate): Promise<MemoRow>;
  deleteMemo(memoId: string): Promise<void>;

  createEntry(
    input: Omit<EntryInsert, "id" | "created_at" | "updated_at">,
  ): Promise<EntryRow>;

  updateEntry(entryId: string, patch: EntryUpdate): Promise<EntryRow>;
  deleteEntry(entryId: string): Promise<void>;

  exportBackup(): Promise<BackupPayload>;
  importBackup(payload: BackupPayload): Promise<void>;
}

class IndexedDbMemoRepository implements MemoRepository {
  async listMemos(): Promise<MemoRow[]> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.memos, "readonly");
    const store = transaction.objectStore(STORE_NAMES.memos);

    const memos = await requestToPromise(
      store.getAll() as IDBRequest<MemoRow[]>,
    );

    return memos
      .filter((memo) => memo.deleted_at === null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getMemo(memoId: string): Promise<MemoWithEntries | null> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries],
      "readonly",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);

    const memo = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<MemoRow | undefined>,
    );

    if (!memo || memo.deleted_at !== null) {
      return null;
    }

    const entryIndex = entryStore.index("by_memo_id");

    const entries = await requestToPromise(
      entryIndex.getAll(memoId) as IDBRequest<EntryRow[]>,
    );

    return {
      ...memo,
      entries: entries
        .filter((entry) => entry.deleted_at === null)
        .sort((a, b) => {
          if (a.sort_order !== b.sort_order) {
            return a.sort_order - b.sort_order;
          }

          return a.created_at.localeCompare(b.created_at);
        }),
    };
  }

  async createMemo(input: Partial<MemoInsert> = {}): Promise<MemoRow> {
    const timestamp = input.created_at ?? nowIso();

    const memo: MemoRow = {
      id: input.id ?? createId(),
      user_id: input.user_id ?? null,
      title: input.title?.trim() || formatDefaultMemoTitle(new Date(timestamp)),
      created_at: timestamp,
      updated_at: input.updated_at ?? timestamp,
      deleted_at: input.deleted_at ?? null,
    };

    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.memos, "readwrite");
    const store = transaction.objectStore(STORE_NAMES.memos);

    store.put(memo);

    await transactionToPromise(transaction);

    return memo;
  }

  async updateMemo(memoId: string, patch: MemoUpdate): Promise<MemoRow> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.memos, "readwrite");
    const store = transaction.objectStore(STORE_NAMES.memos);

    const current = await requestToPromise(
      store.get(memoId) as IDBRequest<MemoRow | undefined>,
    );

    if (!current || current.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象のメモが見つかりません。");
    }

    const next: MemoRow = {
      ...current,
      ...patch,
      title:
        patch.title === undefined
          ? current.title
          : patch.title.trim() || formatDefaultMemoTitle(new Date(current.created_at)),
      updated_at: patch.updated_at ?? nowIso(),
    };

    store.put(next);

    await transactionToPromise(transaction);

    return next;
  }

  async deleteMemo(memoId: string): Promise<void> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);

    const current = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<MemoRow | undefined>,
    );

    if (!current || current.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象のメモが見つかりません。");
    }

    const deletedAt = nowIso();

    memoStore.put({
      ...current,
      updated_at: deletedAt,
      deleted_at: deletedAt,
    } satisfies MemoRow);

    const entryIndex = entryStore.index("by_memo_id");

    const entries = await requestToPromise(
      entryIndex.getAll(memoId) as IDBRequest<EntryRow[]>,
    );

    for (const entry of entries) {
      if (entry.deleted_at === null) {
        entryStore.put({
          ...entry,
          updated_at: deletedAt,
          deleted_at: deletedAt,
        } satisfies EntryRow);
      }
    }

    await transactionToPromise(transaction);
  }

  async createEntry(
    input: Omit<EntryInsert, "id" | "created_at" | "updated_at">,
  ): Promise<EntryRow> {
    const content = input.content.trim();

    if (!content) {
      throw new Error("空の内容は保存できません。");
    }

    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);

    const memo = await requestToPromise(
      memoStore.get(input.memo_id) as IDBRequest<MemoRow | undefined>,
    );

    if (!memo || memo.deleted_at !== null) {
      transaction.abort();
      throw new Error("保存先のメモが見つかりません。");
    }

    const entryIndex = entryStore.index("by_memo_id");

    const existingEntries = await requestToPromise(
      entryIndex.getAll(input.memo_id) as IDBRequest<EntryRow[]>,
    );

    const maxSortOrder = existingEntries.reduce(
      (max, entry) => Math.max(max, entry.sort_order),
      -1,
    );

    const timestamp = nowIso();

    const entry: EntryRow = {
      id: createId(),
      memo_id: input.memo_id,
      user_id: input.user_id ?? memo.user_id,
      kind: input.kind,
      content,
      sort_order: input.sort_order ?? maxSortOrder + 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: input.deleted_at ?? null,
    };

    entryStore.put(entry);

    memoStore.put({
      ...memo,
      updated_at: timestamp,
    } satisfies MemoRow);

    await transactionToPromise(transaction);

    return entry;
  }

  async updateEntry(entryId: string, patch: EntryUpdate): Promise<EntryRow> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);

    const current = await requestToPromise(
      entryStore.get(entryId) as IDBRequest<EntryRow | undefined>,
    );

    if (!current || current.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象の項目が見つかりません。");
    }

    const content =
      patch.content === undefined ? current.content : patch.content.trim();

    if (!content && patch.deleted_at === undefined) {
      transaction.abort();
      throw new Error("空の内容にはできません。");
    }

    const timestamp = patch.updated_at ?? nowIso();

    const next: EntryRow = {
      ...current,
      ...patch,
      content: content || current.content,
      updated_at: timestamp,
    };

    entryStore.put(next);

    await this.touchMemoWithinTransaction(
      memoStore,
      current.memo_id,
      timestamp,
    );

    await transactionToPromise(transaction);

    return next;
  }

  async deleteEntry(entryId: string): Promise<void> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);

    const current = await requestToPromise(
      entryStore.get(entryId) as IDBRequest<EntryRow | undefined>,
    );

    if (!current || current.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象の項目が見つかりません。");
    }

    const deletedAt = nowIso();

    entryStore.put({
      ...current,
      updated_at: deletedAt,
      deleted_at: deletedAt,
    } satisfies EntryRow);

    await this.touchMemoWithinTransaction(
      memoStore,
      current.memo_id,
      deletedAt,
    );

    await transactionToPromise(transaction);
  }

  async exportBackup(): Promise<BackupPayload> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries],
      "readonly",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);

    const memos = await requestToPromise(
      memoStore.getAll() as IDBRequest<MemoRow[]>,
    );

    const entries = await requestToPromise(
      entryStore.getAll() as IDBRequest<EntryRow[]>,
    );

    return {
      version: 1,
      exported_at: nowIso(),
      memos,
      entries,
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    if (
      payload.version !== 1 ||
      !Array.isArray(payload.memos) ||
      !Array.isArray(payload.entries)
    ) {
      throw new Error("バックアップファイルの形式が正しくありません。");
    }

    for (const memo of payload.memos) {
      await this.upsertIfNewer(STORE_NAMES.memos, memo);
    }

    for (const entry of payload.entries) {
      await this.upsertIfNewer(STORE_NAMES.entries, entry);
    }
  }

  private async touchMemoWithinTransaction(
    memoStore: IDBObjectStore,
    memoId: string,
    timestamp: string,
  ): Promise<void> {
    const memo = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<MemoRow | undefined>,
    );

    if (memo && memo.deleted_at === null) {
      memoStore.put({
        ...memo,
        updated_at: timestamp,
      } satisfies MemoRow);
    }
  }

  private async upsertIfNewer<T extends { id: string; updated_at: string }>(
    storeName: (typeof STORE_NAMES)[keyof typeof STORE_NAMES],
    incoming: T,
  ): Promise<void> {
    const db = await getDatabase();

    const readTransaction = db.transaction(storeName, "readonly");
    const readStore = readTransaction.objectStore(storeName);

    const existing = await requestToPromise(
      readStore.get(incoming.id) as IDBRequest<T | undefined>,
    );

    if (existing && existing.updated_at > incoming.updated_at) {
      return;
    }

    const writeTransaction = db.transaction(storeName, "readwrite");
    const writeStore = writeTransaction.objectStore(storeName);

    writeStore.put(incoming);

    await transactionToPromise(writeTransaction);
  }
}

export const memoRepository: MemoRepository = new IndexedDbMemoRepository();
