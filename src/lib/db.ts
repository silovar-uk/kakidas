const DB_NAME = "kakidasu-db";
const DB_VERSION = 1;

export const STORE_NAMES = {
  memos: "memos",
  entries: "entries",
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

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAMES.memos)) {
        const memoStore = db.createObjectStore(STORE_NAMES.memos, {
          keyPath: "id",
        });

        memoStore.createIndex("by_updated_at", "updated_at");
        memoStore.createIndex("by_deleted_at", "deleted_at");
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.entries)) {
        const entryStore = db.createObjectStore(STORE_NAMES.entries, {
          keyPath: "id",
        });

        entryStore.createIndex("by_memo_id", "memo_id");
        entryStore.createIndex("by_memo_id_and_kind", ["memo_id", "kind"]);
        entryStore.createIndex("by_deleted_at", "deleted_at");
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
