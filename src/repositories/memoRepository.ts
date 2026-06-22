import {
  type BackupPayload,
  type EntryDeletionResult,
  type EntryInsert,
  type EntryKind,
  type EntryMoveDirection,
  type EntryRow,
  type EntryUpdate,
  type LegacyEntryRow,
  type MemoCloudSnapshot,
  type MemoEntryCounts,
  type MemoInsert,
  type MemoListItem,
  type MemoRow,
  type MemoSyncMetaRow,
  type MemoUpdate,
  type MemoWithEntries,
  createId,
  createLocalSyncMeta,
  formatDefaultMemoTitle,
  normalizeEntryRow,
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
 * IndexedDBの読み書きはここへ閉じ込め、将来の同期実装はCloudRepository側に足す。
 */
export interface MemoRepository {
  listMemos(): Promise<MemoListItem[]>;
  getMemo(memoId: string): Promise<MemoWithEntries | null>;
  /** クラウド送信用。削除済みEntryも含める。 */
  getMemoSnapshot(memoId: string): Promise<MemoCloudSnapshot | null>;

  createMemo(input?: Partial<MemoInsert>): Promise<MemoRow>;
  updateMemo(memoId: string, patch: MemoUpdate): Promise<MemoRow>;
  deleteMemo(memoId: string): Promise<void>;

  createEntry(
    input: Omit<EntryInsert, "id" | "created_at" | "updated_at">,
  ): Promise<EntryRow>;
  updateEntry(entryId: string, patch: EntryUpdate): Promise<EntryRow>;
  /** 個別削除。親の場合は子孫もまとめてソフト削除し、Undo用の情報を返す。 */
  deleteEntry(entryId: string): Promise<EntryDeletionResult>;
  /** 直前の個別削除を元に戻す。 */
  restoreEntries(entryIds: string[]): Promise<void>;
  /** 指定したWord / Sentence / Paragraphの内容をまとめてソフト削除する。 */
  deleteEntriesByKind(memoId: string, kind: EntryKind): Promise<number>;

  /** 直前の同階層項目の子にする。 */
  indentEntry(entryId: string): Promise<void>;
  /** 親と同じ階層へ戻す。 */
  outdentEntry(entryId: string): Promise<void>;
  /** 同じ親の中で順序を入れ替える。 */
  moveEntry(entryId: string, direction: EntryMoveDirection): Promise<void>;

  getSyncMeta(memoId: string): Promise<MemoSyncMetaRow>;
  saveSyncMeta(meta: MemoSyncMetaRow): Promise<MemoSyncMetaRow>;

  exportBackup(): Promise<BackupPayload>;
  importBackup(payload: BackupPayload): Promise<void>;
}

function compareEntries(a: EntryRow, b: EntryRow): number {
  if (a.sort_order !== b.sort_order) {
    return a.sort_order - b.sort_order;
  }

  return a.created_at.localeCompare(b.created_at);
}

function getEmptyCounts(): MemoEntryCounts {
  return { word: 0, sentence: 0, paragraph: 0 };
}

class IndexedDbMemoRepository implements MemoRepository {
  async listMemos(): Promise<MemoListItem[]> {
    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readonly",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const [memos, entries, syncMetas] = await Promise.all([
      requestToPromise(memoStore.getAll() as IDBRequest<MemoRow[]>),
      requestToPromise(entryStore.getAll() as IDBRequest<LegacyEntryRow[]>),
      requestToPromise(syncMetaStore.getAll() as IDBRequest<MemoSyncMetaRow[]>),
    ]);

    const countsByMemoId = new Map<string, MemoEntryCounts>();

    for (const rawEntry of entries) {
      const entry = normalizeEntryRow(rawEntry);
      if (entry.deleted_at !== null) continue;

      const counts = countsByMemoId.get(entry.memo_id) ?? getEmptyCounts();
      counts[entry.kind] += 1;
      countsByMemoId.set(entry.memo_id, counts);
    }

    const syncMetaByMemoId = new Map(
      syncMetas.map((meta) => [meta.memo_id, meta]),
    );

    return memos
      .filter((memo) => memo.deleted_at === null)
      .map((memo) => ({
        ...memo,
        sync_meta: syncMetaByMemoId.get(memo.id) ?? createLocalSyncMeta(memo.id),
        entry_counts: countsByMemoId.get(memo.id) ?? getEmptyCounts(),
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getMemo(memoId: string): Promise<MemoWithEntries | null> {
    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readonly",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const memo = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<MemoRow | undefined>,
    );

    if (!memo || memo.deleted_at !== null) {
      return null;
    }

    const [entries, syncMeta] = await Promise.all([
      this.getEntriesForMemo(entryStore, memoId),
      this.getSyncMetaFromStore(syncMetaStore, memoId),
    ]);

    return {
      ...memo,
      entries: entries.filter((entry) => entry.deleted_at === null),
      sync_meta: syncMeta ?? createLocalSyncMeta(memoId),
    };
  }

  async getMemoSnapshot(memoId: string): Promise<MemoCloudSnapshot | null> {
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

    const entries = await this.getEntriesForMemo(entryStore, memoId);

    return { memo, entries };
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
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const store = transaction.objectStore(STORE_NAMES.memos);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const current = await requestToPromise(
      store.get(memoId) as IDBRequest<MemoRow | undefined>,
    );

    if (!current || current.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象のメモが見つかりません。");
    }

    const timestamp = patch.updated_at ?? nowIso();

    const next: MemoRow = {
      ...current,
      ...patch,
      title:
        patch.title === undefined
          ? current.title
          : patch.title.trim() || formatDefaultMemoTitle(new Date(current.created_at)),
      updated_at: timestamp,
    };

    store.put(next);
    await this.markMemoChangedWithinTransaction(syncMetaStore, memoId, timestamp);

    await transactionToPromise(transaction);

    return next;
  }

  async deleteMemo(memoId: string): Promise<void> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

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

    const entries = await this.getEntriesForMemo(entryStore, memoId);

    for (const entry of entries) {
      if (entry.deleted_at === null) {
        entryStore.put({
          ...entry,
          updated_at: deletedAt,
          deleted_at: deletedAt,
        } satisfies EntryRow);
      }
    }

    // Phase 2では「ローカルからの削除」をクラウドへ自動反映しない。
    // 後で取り込み機能を作る時に、明示削除のUXを別途設計する。
    syncMetaStore.delete(memoId);

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
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const memo = await requestToPromise(
      memoStore.get(input.memo_id) as IDBRequest<MemoRow | undefined>,
    );

    if (!memo || memo.deleted_at !== null) {
      transaction.abort();
      throw new Error("保存先のメモが見つかりません。");
    }

    const existingEntries = await this.getEntriesForMemo(entryStore, input.memo_id);
    const parentId = input.parent_id ?? null;

    if (parentId !== null) {
      const parent = existingEntries.find(
        (entry) =>
          entry.id === parentId &&
          entry.deleted_at === null &&
          entry.kind === input.kind,
      );

      if (!parent) {
        transaction.abort();
        throw new Error("親にする項目が見つかりません。");
      }
    }

    const siblings = this.getActiveSiblings(existingEntries, input.kind, parentId);
    const timestamp = nowIso();

    const entry: EntryRow = {
      id: createId(),
      memo_id: input.memo_id,
      user_id: input.user_id ?? memo.user_id,
      kind: input.kind,
      parent_id: parentId,
      content,
      sort_order: input.sort_order ?? siblings.length,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: input.deleted_at ?? null,
    };

    entryStore.put(entry);

    memoStore.put({
      ...memo,
      updated_at: timestamp,
    } satisfies MemoRow);

    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      input.memo_id,
      timestamp,
    );

    await transactionToPromise(transaction);

    return entry;
  }

  async updateEntry(entryId: string, patch: EntryUpdate): Promise<EntryRow> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const current = await this.requireActiveEntry(entryStore, entryId, transaction);
    const content = patch.content === undefined ? current.content : patch.content.trim();

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

    await this.touchMemoWithinTransaction(memoStore, current.memo_id, timestamp);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      current.memo_id,
      timestamp,
    );

    await transactionToPromise(transaction);

    return next;
  }

  async deleteEntry(entryId: string): Promise<EntryDeletionResult> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const current = await this.requireActiveEntry(entryStore, entryId, transaction);
    const allEntries = await this.getEntriesForMemo(entryStore, current.memo_id);
    const deletedAt = nowIso();
    const targetIds = this.getSubtreeIds(allEntries, current.id);

    for (const entry of allEntries) {
      if (targetIds.has(entry.id) && entry.deleted_at === null) {
        entryStore.put({
          ...entry,
          updated_at: deletedAt,
          deleted_at: deletedAt,
        } satisfies EntryRow);
      }
    }

    await this.touchMemoWithinTransaction(memoStore, current.memo_id, deletedAt);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      current.memo_id,
      deletedAt,
    );

    await transactionToPromise(transaction);

    return {
      memo_id: current.memo_id,
      root_entry_id: current.id,
      entry_ids: [...targetIds],
      deleted_count: targetIds.size,
      child_count: Math.max(0, targetIds.size - 1),
      content: current.content,
      kind: current.kind,
    };
  }

  async restoreEntries(entryIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(entryIds)].filter(Boolean);

    if (uniqueIds.length === 0) return;

    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const entries = await Promise.all(
      uniqueIds.map(async (id) => {
        const raw = await requestToPromise(
          entryStore.get(id) as IDBRequest<LegacyEntryRow | undefined>,
        );
        return raw ? normalizeEntryRow(raw) : null;
      }),
    );

    const targets = entries.filter((entry): entry is EntryRow => entry !== null);

    if (targets.length === 0) {
      transaction.abort();
      throw new Error("元に戻す対象が見つかりません。");
    }

    const memoId = targets[0].memo_id;
    const timestamp = nowIso();

    for (const entry of targets) {
      if (entry.memo_id !== memoId) continue;

      entryStore.put({
        ...entry,
        updated_at: timestamp,
        deleted_at: null,
      } satisfies EntryRow);
    }

    await this.touchMemoWithinTransaction(memoStore, memoId, timestamp);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      memoId,
      timestamp,
    );

    await transactionToPromise(transaction);
  }

  async deleteEntriesByKind(
    memoId: string,
    kind: EntryKind,
  ): Promise<number> {
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
      throw new Error("対象のメモが見つかりません。");
    }

    const entries = await this.getEntriesForMemo(entryStore, memoId);
    const targets = entries.filter(
      (entry) => entry.kind === kind && entry.deleted_at === null,
    );

    if (targets.length === 0) {
      await transactionToPromise(transaction);
      return 0;
    }

    const deletedAt = nowIso();

    for (const entry of targets) {
      entryStore.put({
        ...entry,
        updated_at: deletedAt,
        deleted_at: deletedAt,
      } satisfies EntryRow);
    }

    await this.touchMemoWithinTransaction(memoStore, memoId, deletedAt);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      memoId,
      deletedAt,
    );

    await transactionToPromise(transaction);

    return targets.length;
  }

  async indentEntry(entryId: string): Promise<void> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const current = await this.requireActiveEntry(entryStore, entryId, transaction);
    const entries = await this.getEntriesForMemo(entryStore, current.memo_id);

    const siblings = this.getActiveSiblings(entries, current.kind, current.parent_id);
    const currentIndex = siblings.findIndex((entry) => entry.id === current.id);
    const previousSibling = siblings[currentIndex - 1];

    if (!previousSibling) {
      transaction.abort();
      throw new Error("これ以上右に下げられません。");
    }

    const timestamp = nowIso();
    const remainingSiblings = siblings.filter((entry) => entry.id !== current.id);
    const targetChildren = this.getActiveSiblings(entries, current.kind, previousSibling.id);

    const moved: EntryRow = {
      ...current,
      parent_id: previousSibling.id,
      updated_at: timestamp,
    };

    this.writeOrderedEntries(entryStore, remainingSiblings, timestamp);
    this.writeOrderedEntries(entryStore, [...targetChildren, moved], timestamp);

    await this.touchMemoWithinTransaction(memoStore, current.memo_id, timestamp);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      current.memo_id,
      timestamp,
    );
    await transactionToPromise(transaction);
  }

  async outdentEntry(entryId: string): Promise<void> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const current = await this.requireActiveEntry(entryStore, entryId, transaction);

    if (current.parent_id === null) {
      transaction.abort();
      throw new Error("これ以上左に戻せません。");
    }

    const entries = await this.getEntriesForMemo(entryStore, current.memo_id);
    const parent = entries.find(
      (entry) =>
        entry.id === current.parent_id &&
        entry.deleted_at === null &&
        entry.kind === current.kind,
    );

    if (!parent) {
      transaction.abort();
      throw new Error("親の項目が見つかりません。");
    }

    const timestamp = nowIso();
    const oldSiblings = this
      .getActiveSiblings(entries, current.kind, current.parent_id)
      .filter((entry) => entry.id !== current.id);

    const newSiblings = this.getActiveSiblings(
      entries,
      current.kind,
      parent.parent_id,
    );

    const parentIndex = newSiblings.findIndex((entry) => entry.id === parent.id);
    const moved: EntryRow = {
      ...current,
      parent_id: parent.parent_id,
      updated_at: timestamp,
    };

    const nextSiblings = [...newSiblings];
    nextSiblings.splice(Math.max(0, parentIndex + 1), 0, moved);

    this.writeOrderedEntries(entryStore, oldSiblings, timestamp);
    this.writeOrderedEntries(entryStore, nextSiblings, timestamp);

    await this.touchMemoWithinTransaction(memoStore, current.memo_id, timestamp);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      current.memo_id,
      timestamp,
    );
    await transactionToPromise(transaction);
  }

  async moveEntry(
    entryId: string,
    direction: EntryMoveDirection,
  ): Promise<void> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const current = await this.requireActiveEntry(entryStore, entryId, transaction);
    const entries = await this.getEntriesForMemo(entryStore, current.memo_id);

    const siblings = this.getActiveSiblings(entries, current.kind, current.parent_id);
    const currentIndex = siblings.findIndex((entry) => entry.id === current.id);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
      transaction.abort();
      throw new Error("これ以上移動できません。");
    }

    const reordered = [...siblings];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const timestamp = nowIso();
    this.writeOrderedEntries(entryStore, reordered, timestamp);

    await this.touchMemoWithinTransaction(memoStore, current.memo_id, timestamp);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      current.memo_id,
      timestamp,
    );
    await transactionToPromise(transaction);
  }

  async getSyncMeta(memoId: string): Promise<MemoSyncMetaRow> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.memoSyncMeta, "readonly");
    const store = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const meta = await this.getSyncMetaFromStore(store, memoId);

    return meta ?? createLocalSyncMeta(memoId);
  }

  async saveSyncMeta(meta: MemoSyncMetaRow): Promise<MemoSyncMetaRow> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.memoSyncMeta, "readwrite");
    const store = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const next: MemoSyncMetaRow = {
      ...meta,
      updated_at: nowIso(),
    };

    store.put(next);
    await transactionToPromise(transaction);

    return next;
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
      entryStore.getAll() as IDBRequest<LegacyEntryRow[]>,
    );

    return {
      version: 3,
      exported_at: nowIso(),
      memos,
      entries: entries.map(normalizeEntryRow),
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    if (
      (payload.version !== 1 && payload.version !== 2 && payload.version !== 3) ||
      !Array.isArray(payload.memos) ||
      !Array.isArray(payload.entries)
    ) {
      throw new Error("バックアップファイルの形式が正しくありません。");
    }

    for (const memo of payload.memos) {
      await this.upsertIfNewer(STORE_NAMES.memos, memo);
    }

    for (const rawEntry of payload.entries) {
      await this.upsertIfNewer(
        STORE_NAMES.entries,
        normalizeEntryRow(rawEntry),
      );
    }
  }

  private async requireActiveEntry(
    entryStore: IDBObjectStore,
    entryId: string,
    transaction: IDBTransaction,
  ): Promise<EntryRow> {
    const rawEntry = await requestToPromise(
      entryStore.get(entryId) as IDBRequest<LegacyEntryRow | undefined>,
    );

    const entry = rawEntry ? normalizeEntryRow(rawEntry) : undefined;

    if (!entry || entry.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象の項目が見つかりません。");
    }

    return entry;
  }

  private async getEntriesForMemo(
    entryStore: IDBObjectStore,
    memoId: string,
  ): Promise<EntryRow[]> {
    const entryIndex = entryStore.index("by_memo_id");

    const entries = await requestToPromise(
      entryIndex.getAll(memoId) as IDBRequest<LegacyEntryRow[]>,
    );

    return entries.map(normalizeEntryRow).sort(compareEntries);
  }

  private async getSyncMetaFromStore(
    syncMetaStore: IDBObjectStore,
    memoId: string,
  ): Promise<MemoSyncMetaRow | undefined> {
    return requestToPromise(
      syncMetaStore.get(memoId) as IDBRequest<MemoSyncMetaRow | undefined>,
    );
  }

  private async markMemoChangedWithinTransaction(
    syncMetaStore: IDBObjectStore,
    memoId: string,
    timestamp: string,
  ): Promise<void> {
    const meta = await this.getSyncMetaFromStore(syncMetaStore, memoId);

    if (!meta || meta.last_uploaded_at === null) return;

    syncMetaStore.put({
      ...meta,
      cloud_state: "changed_after_upload",
      last_error: null,
      updated_at: timestamp,
    } satisfies MemoSyncMetaRow);
  }

  private getActiveSiblings(
    entries: EntryRow[],
    kind: EntryKind,
    parentId: string | null,
  ): EntryRow[] {
    return entries
      .filter(
        (entry) =>
          entry.deleted_at === null &&
          entry.kind === kind &&
          entry.parent_id === parentId,
      )
      .sort(compareEntries);
  }

  private getSubtreeIds(entries: EntryRow[], rootId: string): Set<string> {
    const childrenByParent = new Map<string, EntryRow[]>();

    entries.forEach((entry) => {
      if (entry.deleted_at !== null || entry.parent_id === null) return;
      const children = childrenByParent.get(entry.parent_id) ?? [];
      children.push(entry);
      childrenByParent.set(entry.parent_id, children);
    });

    const ids = new Set<string>();
    const stack = [rootId];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId || ids.has(currentId)) continue;

      ids.add(currentId);

      const children = childrenByParent.get(currentId) ?? [];
      children.forEach((child) => stack.push(child.id));
    }

    return ids;
  }

  private writeOrderedEntries(
    entryStore: IDBObjectStore,
    entries: EntryRow[],
    timestamp: string,
  ): void {
    entries.forEach((entry, index) => {
      entryStore.put({
        ...entry,
        sort_order: index,
        updated_at: timestamp,
      } satisfies EntryRow);
    });
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
    storeName: typeof STORE_NAMES.memos | typeof STORE_NAMES.entries,
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
