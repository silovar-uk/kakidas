const DB_NAME = "kakidasu-db";
const DB_VERSION = 4;

export const STORE_NAMES = {
  memos: "memos",
  entries: "entries",
  memoSyncMeta: "memo_sync_meta",
} as const;

let databasePromise: Promise<IDBDatabase> | null = null;

export function getDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase();
  }

  return databasePromise;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

      if (!db.objectStoreNames.contains(STORE_NAMES.memos)) {
        const memoStore = db.createObjectStore(STORE_NAMES.memos, {
          keyPath: "id",
        });

        memoStore.createIndex("by_updated_at", "updated_at");
        memoStore.createIndex("by_deleted_at", "deleted_at");
      }

      let entryStore: IDBObjectStore;

      if (!db.objectStoreNames.contains(STORE_NAMES.entries)) {
        entryStore = db.createObjectStore(STORE_NAMES.entries, {
          keyPath: "id",
        });

        entryStore.createIndex("by_memo_id", "memo_id");
        entryStore.createIndex("by_memo_id_and_kind", ["memo_id", "kind"]);
        entryStore.createIndex("by_deleted_at", "deleted_at");
      } else {
        entryStore = transaction!.objectStore(STORE_NAMES.entries);
      }

      if (!entryStore.indexNames.contains("by_memo_kind_parent")) {
        entryStore.createIndex("by_memo_kind_parent", [
          "memo_id",
          "kind",
          "parent_id",
        ]);
      }

      // v1で作られたentryには parent_id がないため、nullで補完する。
      if (oldVersion < 2) {
        const cursorRequest = entryStore.openCursor();

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const value = cursor.value as Record<string, unknown>;

          if (!("parent_id" in value)) {
            cursor.update({ ...value, parent_id: null });
          }

          cursor.continue();
        };
      }

      let syncMetaStore: IDBObjectStore;

      if (!db.objectStoreNames.contains(STORE_NAMES.memoSyncMeta)) {
        syncMetaStore = db.createObjectStore(STORE_NAMES.memoSyncMeta, {
          keyPath: "memo_id",
        });

        syncMetaStore.createIndex("by_cloud_state", "cloud_state");
        syncMetaStore.createIndex("by_cloud_user_id", "cloud_user_id");
        syncMetaStore.createIndex("by_updated_at", "updated_at");
      } else {
        syncMetaStore = transaction!.objectStore(STORE_NAMES.memoSyncMeta);
      }

      // v0.5.1: cloud_updated_at を last_cloud_updated_at へ移行し、
      // 取り込み日時のフィールドも既存レコードへ補完する。
      if (oldVersion < 4) {
        const cursorRequest = syncMetaStore.openCursor();

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const value = cursor.value as Record<string, unknown>;
          const next = {
            ...value,
            last_downloaded_at: value.last_downloaded_at ?? null,
            last_cloud_updated_at:
              value.last_cloud_updated_at ?? value.cloud_updated_at ?? null,
          };

          cursor.update(next);
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };

      resolve(db);
    };
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDBの操作に失敗しました。"));
    };
  });
}

export function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDBの保存に失敗しました。"));
    };

    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDBの操作が中断されました。"));
    };
  });
}
