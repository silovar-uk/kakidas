import {
  type BackupPayload,
  type CloudImportMode,
  type CloudImportResult,
  type CompletedEntriesDeletionResult,
  type EntryDeletionResult,
  type EntryInsert,
  type EntryInsertPosition,
  type EntryKind,
  type EntryRow,
  type EntryUpdate,
  canMoveEntryToKind,
  type LegacyEntryRow,
  type LegacyMemoSyncMetaRow,
  type MemoCloudSnapshot,
  type MemoEntryCounts,
  type MemoInsert,
  type MemoListItem,
  type MemoRow,
  type LegacyMemoRow,
  type MemoSyncMetaRow,
  type MemoUpdate,
  type MemoWithEntries,
  createId,
  createLocalSyncMeta,
  formatDefaultMemoTitle,
  formatDerivedMemoTitle,
  isCloudLinked,
  getMemoTagKey,
  getEntryTagKey,
  normalizeMemoRow,
  normalizeMemoTag,
  normalizeEntryTag,
  normalizeMemoSyncMeta,
  normalizeEntryRow,
  normalizeLinkUrlForSave,
  normalizeSatisfaction,
  normalizeCompletion,
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
export type MemoFromEntryResult = {
  memo: MemoRow;
  entry: EntryRow;
  source_entry_id: string;
};

/** タグ名の一括変更・解除結果。複数メモをまたぐが、処理は1トランザクションで完結する。 */
export type MemoTagBulkUpdateResult = {
  previous_tag: string;
  tag: string | null;
  updated_count: number;
  memo_ids: string[];
};

/** 同じメモ・同じ区分の項目タグをまとめて別名へ置き換えた結果。 */
export type EntryTagBulkUpdateResult = {
  memo_id: string;
  kind: EntryKind;
  previous_tag: string;
  tag: string;
  updated_count: number;
};

export interface MemoRepository {
  listMemos(): Promise<MemoListItem[]>;
  getMemo(memoId: string): Promise<MemoWithEntries | null>;
  /** クラウド送信用。削除済みEntryも含める。 */
  getMemoSnapshot(memoId: string): Promise<MemoCloudSnapshot | null>;
  /** クラウドの完全なスナップショットを、IndexedDBへ一括取り込みする。 */
  importCloudSnapshot(
    snapshot: MemoCloudSnapshot,
    cloudUserId: string,
    mode: CloudImportMode,
  ): Promise<CloudImportResult>;

  createMemo(input?: Partial<MemoInsert>): Promise<MemoRow>;
  /** 元の項目を残したまま、同じ区分の新しいメモを作る。 */
  createMemoFromEntry(entryId: string): Promise<MemoFromEntryResult>;
  updateMemo(memoId: string, patch: MemoUpdate): Promise<MemoRow>;
  /** 同じタグのメモをまとめて別名へ置き換える。 */
  renameTag(currentTag: string, nextTag: string): Promise<MemoTagBulkUpdateResult>;
  /** 同じタグのメモから、タグだけをまとめて外す。 */
  clearTag(currentTag: string): Promise<MemoTagBulkUpdateResult>;
  deleteMemo(memoId: string): Promise<void>;
  /** 新規作成直後の既定タイトル・項目なしメモだけを、安全に破棄する。 */
  discardUntitledEmptyMemo(memoId: string): Promise<boolean>;

  createEntry(
    input: Omit<EntryInsert, "id" | "created_at" | "updated_at">,
    position?: EntryInsertPosition,
  ): Promise<EntryRow>;
  updateEntry(entryId: string, patch: EntryUpdate): Promise<EntryRow>;
  /** 同じメモ・同じ区分の項目タグをまとめて別名へ置き換える。 */
  renameEntryTag(
    memoId: string,
    kind: EntryKind,
    currentTag: string,
    nextTag: string,
  ): Promise<EntryTagBulkUpdateResult>;
  /** 個別削除。親の場合は子孫もまとめてソフト削除し、Undo用の情報を返す。 */
  deleteEntry(entryId: string): Promise<EntryDeletionResult>;
  /** 直前の個別削除を元に戻す。 */
  restoreEntries(entryIds: string[]): Promise<void>;
  /** 指定したWord / Sentence / Paragraphの内容をまとめてソフト削除する。 */
  deleteEntriesByKind(memoId: string, kind: EntryKind): Promise<number>;
  /** 完了済みだけをまとめてソフト削除する。未完了の子孫は残す。 */
  deleteCompletedEntries(memoId: string): Promise<CompletedEntriesDeletionResult>;

  /** 別の区分へ移す。移動先ではルート項目になる。 */
  moveEntryToKind(entryId: string, targetKind: EntryKind): Promise<void>;

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

function compareEntriesForDisplay(a: EntryRow, b: EntryRow): number {
  if (a.is_completed !== b.is_completed) {
    return Number(a.is_completed) - Number(b.is_completed);
  }

  return compareEntries(a, b);
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

    const [rawMemos, entries, syncMetas] = await Promise.all([
      requestToPromise(memoStore.getAll() as IDBRequest<LegacyMemoRow[]>),
      requestToPromise(entryStore.getAll() as IDBRequest<LegacyEntryRow[]>),
      requestToPromise(
        syncMetaStore.getAll() as IDBRequest<LegacyMemoSyncMetaRow[]>,
      ),
    ]);

    const memos = rawMemos.map(normalizeMemoRow);
    const countsByMemoId = new Map<string, MemoEntryCounts>();

    for (const rawEntry of entries) {
      const entry = normalizeEntryRow(rawEntry);
      if (entry.deleted_at !== null) continue;

      const counts = countsByMemoId.get(entry.memo_id) ?? getEmptyCounts();
      counts[entry.kind] += 1;
      countsByMemoId.set(entry.memo_id, counts);
    }

    const syncMetaByMemoId = new Map(
      syncMetas.map((meta) => [
        meta.memo_id,
        normalizeMemoSyncMeta(meta, meta.memo_id),
      ]),
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

    const rawMemo = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<LegacyMemoRow | undefined>,
    );
    const memo = rawMemo ? normalizeMemoRow(rawMemo) : undefined;

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

    const rawMemo = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<LegacyMemoRow | undefined>,
    );
    const memo = rawMemo ? normalizeMemoRow(rawMemo) : undefined;

    if (!memo || memo.deleted_at !== null) {
      return null;
    }

    const entries = await this.getEntriesForMemo(entryStore, memoId);

    return { memo, entries };
  }

  async importCloudSnapshot(
    snapshot: MemoCloudSnapshot,
    cloudUserId: string,
    mode: CloudImportMode,
  ): Promise<CloudImportResult> {
    const sourceMemo = normalizeMemoRow(snapshot.memo);

    if (sourceMemo.deleted_at !== null) {
      throw new Error("削除済みのクラウドメモは取り込めません。");
    }

    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const importedAt = nowIso();

    const existingMemo = await requestToPromise(
      memoStore.get(sourceMemo.id) as IDBRequest<MemoRow | undefined>,
    );

    if (mode === "preserve" && existingMemo?.deleted_at === null) {
      transaction.abort();
      throw new Error(
        "このメモはすでにこの端末にあります。クラウド版を複製して取り込んでください。",
      );
    }

    if (mode === "replace" && (!existingMemo || existingMemo.deleted_at !== null)) {
      transaction.abort();
      throw new Error("更新するローカルメモが見つかりません。");
    }

    const existingMeta = await this.getSyncMetaFromStore(
      syncMetaStore,
      sourceMemo.id,
    );

    if (
      mode === "replace" &&
      (existingMeta?.cloud_state === "changed_after_upload" ||
        existingMeta?.cloud_state === "conflict")
    ) {
      transaction.abort();
      throw new Error(
        "この端末でもメモが更新されています。上書きせず、クラウド版を複製して取り込んでください。",
      );
    }

    const sourceEntries = snapshot.entries
      .map(normalizeEntryRow)
      .filter((entry) => entry.memo_id === sourceMemo.id);

    let importedMemo: MemoRow;
    let importedEntries: EntryRow[];

    if (mode === "clone") {
      const copiedMemoId = createId();
      const entryIdMap = new Map(
        sourceEntries.map((entry) => [entry.id, createId()]),
      );

      importedMemo = {
        ...sourceMemo,
        id: copiedMemoId,
        user_id: cloudUserId,
        title: `${sourceMemo.title}（クラウド版）`,
        created_at: importedAt,
        updated_at: importedAt,
        deleted_at: null,
      };

      importedEntries = sourceEntries.map((entry) => ({
        ...entry,
        id: entryIdMap.get(entry.id) ?? createId(),
        memo_id: copiedMemoId,
        user_id: cloudUserId,
        parent_id: entry.parent_id
          ? (entryIdMap.get(entry.parent_id) ?? null)
          : null,
        // 複製して取り込んでも、「いつ書いた項目か」は元の記録を残す。
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      }));
    } else {
      importedMemo = {
        ...sourceMemo,
        user_id: cloudUserId,
        deleted_at: null,
      };

      importedEntries = sourceEntries.map((entry) => ({
        ...entry,
        memo_id: importedMemo.id,
        user_id: cloudUserId,
      }));

      // 「更新を取り込む」では、クラウドに存在しないローカルEntryを
      // ソフト削除して、クラウドのスナップショットに完全に揃える。
      const existingEntries = await this.getEntriesForMemo(
        entryStore,
        sourceMemo.id,
      );
      const sourceEntryIds = new Set(sourceEntries.map((entry) => entry.id));

      for (const entry of existingEntries) {
        if (!sourceEntryIds.has(entry.id)) {
          entryStore.put({
            ...entry,
            updated_at: importedAt,
            deleted_at: importedAt,
          } satisfies EntryRow);
        }
      }
    }

    memoStore.put(importedMemo);

    for (const entry of importedEntries) {
      entryStore.put(entry);
    }

    if (mode === "clone") {
      syncMetaStore.put({
        ...createLocalSyncMeta(importedMemo.id),
        updated_at: importedAt,
      } satisfies MemoSyncMetaRow);
    } else {
      const currentMeta = existingMeta ?? createLocalSyncMeta(importedMemo.id);

      syncMetaStore.put({
        ...currentMeta,
        memo_id: importedMemo.id,
        cloud_state: "uploaded",
        cloud_user_id: cloudUserId,
        last_uploaded_at: currentMeta.last_uploaded_at,
        last_downloaded_at: importedAt,
        last_cloud_updated_at: sourceMemo.updated_at,
        last_uploaded_hash: null,
        last_error: null,
        updated_at: importedAt,
      } satisfies MemoSyncMetaRow);
    }

    await transactionToPromise(transaction);

    return {
      memo: importedMemo,
      source_memo_id: sourceMemo.id,
      mode,
      imported_entry_count: importedEntries.filter(
        (entry) => entry.deleted_at === null,
      ).length,
    };
  }

  async createMemo(input: Partial<MemoInsert> = {}): Promise<MemoRow> {
    const timestamp = input.created_at ?? nowIso();

    const memo: MemoRow = {
      id: input.id ?? createId(),
      user_id: input.user_id ?? null,
      title: input.title?.trim() || formatDefaultMemoTitle(new Date(timestamp)),
      tag: normalizeMemoTag(input.tag),
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

  /**
   * 項目を「新しいメモにする」。元の項目は変更せず、本文・タグ・備考・リンク・満足度を
   * 新メモのルート項目へ複製する。メモと項目は同じトランザクションで作るため、
   * 途中で失敗して片方だけ残ることはない。
   */
  async createMemoFromEntry(entryId: string): Promise<MemoFromEntryResult> {
    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const sourceEntry = await this.requireActiveEntry(entryStore, entryId, transaction);
    const sourceMemo = await requestToPromise(
      memoStore.get(sourceEntry.memo_id) as IDBRequest<MemoRow | undefined>,
    );

    if (!sourceMemo || sourceMemo.deleted_at !== null) {
      transaction.abort();
      throw new Error("元のメモが見つかりません。");
    }

    const timestamp = nowIso();
    const memoId = createId();
    const memo: MemoRow = {
      id: memoId,
      user_id: sourceEntry.user_id ?? sourceMemo.user_id,
      title: formatDerivedMemoTitle(
        new Date(timestamp),
        sourceEntry.heading || sourceEntry.content,
      ),
      tag: null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };
    const entry: EntryRow = {
      id: createId(),
      memo_id: memoId,
      user_id: memo.user_id,
      kind: sourceEntry.kind,
      parent_id: null,
      content: sourceEntry.content,
      heading: sourceEntry.kind === "paragraph" ? sourceEntry.heading : "",
      tag: sourceEntry.tag,
      note: sourceEntry.note,
      link_url: sourceEntry.link_url,
      satisfaction: sourceEntry.satisfaction,
      // 別メモで続きを書くための起点なので、完了済みでも新メモ側は未完了に戻す。
      is_completed: false,
      sort_order: 0,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };

    memoStore.put(memo);
    entryStore.put(entry);
    syncMetaStore.put({
      ...createLocalSyncMeta(memoId),
      updated_at: timestamp,
    } satisfies MemoSyncMetaRow);

    await transactionToPromise(transaction);

    return { memo, entry, source_entry_id: sourceEntry.id };
  }

  async updateMemo(memoId: string, patch: MemoUpdate): Promise<MemoRow> {
    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const store = transaction.objectStore(STORE_NAMES.memos);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const rawCurrent = await requestToPromise(
      store.get(memoId) as IDBRequest<LegacyMemoRow | undefined>,
    );
    const current = rawCurrent ? normalizeMemoRow(rawCurrent) : undefined;

    if (!current || current.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象のメモが見つかりません。");
    }

    const timestamp = patch.updated_at ?? nowIso();
    const { title: patchTitle, tag: patchTag, ...restPatch } = patch;

    const next: MemoRow = {
      ...current,
      ...restPatch,
      title:
        patchTitle === undefined
          ? current.title
          : patchTitle.trim() || formatDefaultMemoTitle(new Date(current.created_at)),
      tag: patchTag === undefined ? current.tag : normalizeMemoTag(patchTag),
      updated_at: timestamp,
    };

    store.put(next);
    await this.markMemoChangedWithinTransaction(syncMetaStore, memoId, timestamp);

    await transactionToPromise(transaction);

    return next;
  }

  async renameTag(
    currentTag: string,
    nextTag: string,
  ): Promise<MemoTagBulkUpdateResult> {
    return this.updateTagAcrossMemos(currentTag, normalizeMemoTag(nextTag));
  }

  async clearTag(currentTag: string): Promise<MemoTagBulkUpdateResult> {
    return this.updateTagAcrossMemos(currentTag, null);
  }

  private async updateTagAcrossMemos(
    currentTag: string,
    nextTag: string | null,
  ): Promise<MemoTagBulkUpdateResult> {
    const currentKey = getMemoTagKey(currentTag);
    if (!currentKey) {
      throw new Error("変更するタグを確認してください。");
    }

    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );
    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const rawMemos = await requestToPromise(
      memoStore.getAll() as IDBRequest<LegacyMemoRow[]>,
    );
    const timestamp = nowIso();
    const matchingMemos = rawMemos
      .map(normalizeMemoRow)
      .filter(
        (memo) =>
          memo.deleted_at === null && getMemoTagKey(memo.tag) === currentKey,
      );

    for (const memo of matchingMemos) {
      memoStore.put({
        ...memo,
        tag: nextTag,
        updated_at: timestamp,
      } satisfies MemoRow);
      await this.markMemoChangedWithinTransaction(syncMetaStore, memo.id, timestamp);
    }

    await transactionToPromise(transaction);

    return {
      previous_tag: normalizeMemoTag(currentTag) ?? currentTag,
      tag: nextTag,
      updated_count: matchingMemos.length,
      memo_ids: matchingMemos.map((memo) => memo.id),
    };
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

  /**
   * 新規作成しただけで内容を書かなかったメモを片付ける。
   * UI側の表示状態を信用せず、IndexedDB内でも「既定タイトル・有効な項目0件」を
   * 同じトランザクションで確認してから削除するため、入力済みのメモは誤って消えない。
   */
  async discardUntitledEmptyMemo(memoId: string): Promise<boolean> {
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
      // 読み取りだけのトランザクションは、ここで自然に完了する。
      return false;
    }

    const entries = await this.getEntriesForMemo(entryStore, memoId);
    const defaultTitle = formatDefaultMemoTitle(new Date(current.created_at));
    const hasActiveEntry = entries.some((entry) => entry.deleted_at === null);

    if (current.title !== defaultTitle || hasActiveEntry) {
      // 入力済みのメモには一切書き込まず、そのまま残す。
      return false;
    }

    const deletedAt = nowIso();

    memoStore.put({
      ...current,
      updated_at: deletedAt,
      deleted_at: deletedAt,
    } satisfies MemoRow);

    // 新規の空メモでも、過去に誤って同期情報だけ作られていた場合を残さない。
    syncMetaStore.delete(memoId);

    await transactionToPromise(transaction);
    return true;
  }

  async createEntry(
    input: Omit<EntryInsert, "id" | "created_at" | "updated_at">,
    position: EntryInsertPosition = "bottom",
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
    // sort_orderは親・種別ごとの表示順。先頭追加では最小値より1つ前、
    // 末尾追加では最大値より1つ後を採用して、既存の順番を崩さない。
    const nextSortOrder = input.sort_order ?? (
      siblings.length === 0
        ? 0
        : position === "top"
          ? Math.min(...siblings.map((sibling) => sibling.sort_order)) - 1
          : Math.max(...siblings.map((sibling) => sibling.sort_order)) + 1
    );

    const entry: EntryRow = {
      id: createId(),
      memo_id: input.memo_id,
      user_id: input.user_id ?? memo.user_id,
      kind: input.kind,
      parent_id: parentId,
      content,
      heading: input.kind === "paragraph" ? input.heading?.trim() ?? "" : "",
      tag: normalizeEntryTag(input.tag),
      note: input.note?.trim() ?? "",
      link_url: normalizeLinkUrlForSave(input.link_url),
      satisfaction: normalizeSatisfaction(input.satisfaction),
      is_completed: normalizeCompletion(input.is_completed),
      sort_order: nextSortOrder,
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
    const heading = patch.heading === undefined
      ? current.heading
      : current.kind === "paragraph"
        ? patch.heading.trim()
        : "";
    const tag = patch.tag === undefined ? current.tag : normalizeEntryTag(patch.tag);
    const note = patch.note === undefined ? current.note : patch.note.trim();
    const linkUrl =
      patch.link_url === undefined
        ? current.link_url
        : normalizeLinkUrlForSave(patch.link_url);
    const satisfaction =
      patch.satisfaction === undefined
        ? current.satisfaction
        : normalizeSatisfaction(patch.satisfaction);
    const isCompleted =
      patch.is_completed === undefined
        ? current.is_completed
        : normalizeCompletion(patch.is_completed);

    if (!content && patch.deleted_at === undefined) {
      transaction.abort();
      throw new Error("空の内容にはできません。");
    }

    const timestamp = patch.updated_at ?? nowIso();

    const next: EntryRow = {
      ...current,
      ...patch,
      content: content || current.content,
      heading,
      tag,
      note,
      link_url: linkUrl,
      satisfaction,
      is_completed: isCompleted,
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

  /**
   * 現在のメモ・現在の区分にある同じ項目タグを、完了状態を問わず一度に変更する。
   * タグでまとめる表示の見出しから呼び出すため、ほかの区分や別メモには影響させない。
   */
  async renameEntryTag(
    memoId: string,
    kind: EntryKind,
    currentTag: string,
    nextTag: string,
  ): Promise<EntryTagBulkUpdateResult> {
    const currentKey = getEntryTagKey(currentTag);
    const normalizedNextTag = normalizeEntryTag(nextTag);

    if (!currentKey) {
      throw new Error("変更するタグを確認してください。");
    }

    if (!normalizedNextTag) {
      throw new Error("新しいタグ名を入力してください。");
    }

    const db = await getDatabase();
    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );
    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);

    const rawMemo = await requestToPromise(
      memoStore.get(memoId) as IDBRequest<LegacyMemoRow | undefined>,
    );
    const memo = rawMemo ? normalizeMemoRow(rawMemo) : null;

    if (!memo || memo.deleted_at !== null) {
      transaction.abort();
      throw new Error("対象のメモが見つかりません。");
    }

    const rawEntries = await requestToPromise(
      entryStore.getAll() as IDBRequest<LegacyEntryRow[]>,
    );
    const matchingEntries = rawEntries
      .map(normalizeEntryRow)
      .filter(
        (entry) =>
          entry.memo_id === memoId &&
          entry.kind === kind &&
          entry.deleted_at === null &&
          getEntryTagKey(entry.tag) === currentKey,
      );

    const entriesToUpdate = matchingEntries.filter(
      (entry) => entry.tag !== normalizedNextTag,
    );

    if (entriesToUpdate.length === 0) {
      await transactionToPromise(transaction);
      return {
        memo_id: memoId,
        kind,
        previous_tag: normalizeEntryTag(currentTag) ?? currentTag,
        tag: normalizedNextTag,
        updated_count: 0,
      };
    }

    const timestamp = nowIso();

    for (const entry of entriesToUpdate) {
      entryStore.put({
        ...entry,
        tag: normalizedNextTag,
        updated_at: timestamp,
      } satisfies EntryRow);
    }

    await this.touchMemoWithinTransaction(memoStore, memoId, timestamp);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      memoId,
      timestamp,
    );

    await transactionToPromise(transaction);

    return {
      memo_id: memoId,
      kind,
      previous_tag: normalizeEntryTag(currentTag) ?? currentTag,
      tag: normalizedNextTag,
      updated_count: entriesToUpdate.length,
    };
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

  /**
   * 完了済みの項目だけを整理する。
   * 完了した親の下に未完了の項目が残っている場合、未完了の項目を
   * 直近の未完了の親（なければルート）へ戻すため、未完了の内容は消えない。
   */
  async deleteCompletedEntries(
    memoId: string,
  ): Promise<CompletedEntriesDeletionResult> {
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

    const allEntries = await this.getEntriesForMemo(entryStore, memoId);
    const activeEntries = allEntries.filter((entry) => entry.deleted_at === null);
    const completedIds = new Set(
      activeEntries.filter((entry) => entry.is_completed).map((entry) => entry.id),
    );

    if (completedIds.size === 0) {
      await transactionToPromise(transaction);
      return { memo_id: memoId, deleted_count: 0, reparented_count: 0 };
    }

    const activeById = new Map(activeEntries.map((entry) => [entry.id, entry]));
    const timestamp = nowIso();
    // ルート階層は kind ごとに別の並び順を持つため、kind + parent_id で分ける。
    const reparentCandidates = new Map<
      string,
      { kind: EntryKind; parent_id: string | null; entries: EntryRow[] }
    >();

    const findNearestRemainingParent = (entry: EntryRow): string | null => {
      let parentId = entry.parent_id;
      const seen = new Set<string>([entry.id]);

      while (parentId) {
        if (seen.has(parentId)) return null;
        seen.add(parentId);

        const parent = activeById.get(parentId);
        if (!parent || parent.kind !== entry.kind) return null;
        if (!completedIds.has(parent.id)) return parent.id;
        parentId = parent.parent_id;
      }

      return null;
    };

    // 直上の親が消える未完了項目だけを、消えない階層へ移す。
    for (const entry of activeEntries) {
      if (completedIds.has(entry.id) || !entry.parent_id) continue;
      if (!completedIds.has(entry.parent_id)) continue;

      const nextParentId = findNearestRemainingParent(entry);
      const groupKey = `${entry.kind}::${nextParentId ?? "__root__"}`;
      const group = reparentCandidates.get(groupKey) ?? {
        kind: entry.kind,
        parent_id: nextParentId,
        entries: [],
      };
      group.entries.push(entry);
      reparentCandidates.set(groupKey, group);
    }

    let reparentedCount = 0;

    for (const { kind, parent_id: nextParentId, entries: candidates } of reparentCandidates.values()) {
      const candidateIds = new Set(candidates.map((entry) => entry.id));
      const survivingSiblings = activeEntries
        .filter(
          (entry) =>
            !completedIds.has(entry.id) &&
            !candidateIds.has(entry.id) &&
            entry.kind === kind &&
            entry.parent_id === nextParentId,
        )
        .sort(compareEntries);

      const nextSortOrderStart =
        survivingSiblings.length === 0
          ? 0
          : Math.max(...survivingSiblings.map((entry) => entry.sort_order)) + 1;

      candidates
        .sort(compareEntries)
        .forEach((entry, index) => {
          entryStore.put({
            ...entry,
            parent_id: nextParentId,
            sort_order: nextSortOrderStart + index,
            updated_at: timestamp,
          } satisfies EntryRow);
          reparentedCount += 1;
        });
    }

    for (const entry of activeEntries) {
      if (!completedIds.has(entry.id)) continue;

      entryStore.put({
        ...entry,
        updated_at: timestamp,
        deleted_at: timestamp,
      } satisfies EntryRow);
    }

    await this.touchMemoWithinTransaction(memoStore, memoId, timestamp);
    await this.markMemoChangedWithinTransaction(
      syncMetaStore,
      memoId,
      timestamp,
    );

    await transactionToPromise(transaction);

    return {
      memo_id: memoId,
      deleted_count: completedIds.size,
      reparented_count: reparentedCount,
    };
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

  /**
   * 内容を別の粒度へ移す。
   * 種別をまたぐ親子関係は持たないため、移動する項目は移動先のルートへ置く。
   * 下に項目がある場合は、元の種別に残し、元の親と同じ階層へ繰り上げる。
   * UI側では事前に確認を出すため、ここではデータ整合性だけを守る。
   */
  async moveEntryToKind(entryId: string, targetKind: EntryKind): Promise<void> {
    const db = await getDatabase();

    const transaction = db.transaction(
      [STORE_NAMES.memos, STORE_NAMES.entries, STORE_NAMES.memoSyncMeta],
      "readwrite",
    );

    const memoStore = transaction.objectStore(STORE_NAMES.memos);
    const entryStore = transaction.objectStore(STORE_NAMES.entries);
    const syncMetaStore = transaction.objectStore(STORE_NAMES.memoSyncMeta);
    const current = await this.requireActiveEntry(entryStore, entryId, transaction);

    if (!canMoveEntryToKind(current.kind, targetKind)) {
      transaction.abort();
      throw new Error("この項目はその区分へ移動できません。");
    }

    const entries = await this.getEntriesForMemo(entryStore, current.memo_id);
    const timestamp = nowIso();

    // 移動元では、直下の項目を現在の位置へ繰り上げる。
    // その下の階層は直下の項目に紐づいたままなので、構造を壊さない。
    const sourceSiblings = this.getActiveSiblings(
      entries,
      current.kind,
      current.parent_id,
    );
    const currentIndex = sourceSiblings.findIndex((entry) => entry.id === current.id);
    const remainingSourceSiblings = sourceSiblings.filter(
      (entry) => entry.id !== current.id,
    );
    const promotedChildren = this
      .getActiveSiblings(entries, current.kind, current.id)
      .map((entry) => ({
        ...entry,
        parent_id: current.parent_id,
        updated_at: timestamp,
      }));

    const nextSourceSiblings = [...remainingSourceSiblings];
    nextSourceSiblings.splice(
      Math.max(0, currentIndex),
      0,
      ...promotedChildren,
    );
    this.writeOrderedEntries(entryStore, nextSourceSiblings, timestamp);

    // 移動先では先頭に置く。完成済みは既存の表示ルールにより下側へまとまる。
    const targetSiblings = this.getActiveSiblings(entries, targetKind, null);
    const moved: EntryRow = {
      ...current,
      kind: targetKind,
      parent_id: null,
      heading: targetKind === "paragraph" ? current.heading : "",
      updated_at: timestamp,
    };
    this.writeOrderedEntries(entryStore, [moved, ...targetSiblings], timestamp);

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
      ...normalizeMemoSyncMeta(meta, meta.memo_id),
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
      memoStore.getAll() as IDBRequest<LegacyMemoRow[]>,
    );

    const entries = await requestToPromise(
      entryStore.getAll() as IDBRequest<LegacyEntryRow[]>,
    );

    return {
      version: 8,
      exported_at: nowIso(),
      memos: memos.map(normalizeMemoRow),
      entries: entries.map(normalizeEntryRow),
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    if (
      (payload.version !== 1 &&
        payload.version !== 2 &&
        payload.version !== 3 &&
        payload.version !== 4 &&
        payload.version !== 5 &&
        payload.version !== 6 &&
        payload.version !== 7 &&
        payload.version !== 8) ||
      !Array.isArray(payload.memos) ||
      !Array.isArray(payload.entries)
    ) {
      throw new Error("バックアップファイルの形式が正しくありません。");
    }

    for (const memo of payload.memos) {
      await this.upsertIfNewer(STORE_NAMES.memos, normalizeMemoRow(memo));
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
    const raw = await requestToPromise(
      syncMetaStore.get(memoId) as IDBRequest<LegacyMemoSyncMetaRow | undefined>,
    );

    return raw ? normalizeMemoSyncMeta(raw, memoId) : undefined;
  }

  private async markMemoChangedWithinTransaction(
    syncMetaStore: IDBObjectStore,
    memoId: string,
    timestamp: string,
  ): Promise<void> {
    const meta = await this.getSyncMetaFromStore(syncMetaStore, memoId);

    // クラウド由来の情報がないメモは、引き続きローカルのみ。
    if (!meta || !isCloudLinked(meta)) return;

    const nextState =
      meta.cloud_state === "remote_newer" || meta.cloud_state === "conflict"
        ? "conflict"
        : meta.cloud_state === "error"
          ? "error"
          : "changed_after_upload";

    syncMetaStore.put({
      ...meta,
      cloud_state: nextState,
      // 送信エラーは再送成功まで見えるように残す。
      last_error: nextState === "error" ? meta.last_error : null,
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
      .sort(compareEntriesForDisplay);
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
