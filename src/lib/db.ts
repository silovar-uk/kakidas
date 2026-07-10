const DB_NAME = "kakidasu-db";
/**
 * v0.5.33:
 * iPhone Safari では、アップグレード中に複数の cursor を同時に回すと
 * IndexedDB の open が完了しないことがある。そのため、レコード単位の補完は
 * 読み込み時の normalize 関数へ寄せ、DBアップグレードはストア／index準備だけにする。
 */
const DB_VERSION = 9;
const OPEN_TIMEOUT_MS = 12_000;

export const STORE_NAMES = {
  memos: "memos",
  entries: "entries",
  memoSyncMeta: "memo_sync_meta",
} as const;

let databasePromise: Promise<IDBDatabase> | null = null;
let activeDatabase: IDBDatabase | null = null;

/**
 * IndexedDB接続を閉じる。Safari の戻る／進むや、古いタブが残った状態での
 * バージョン更新をブロックしにくくするために使う。
 */
export function closeDatabaseConnection(): void {
  if (activeDatabase) {
    activeDatabase.close();
  }

  activeDatabase = null;
  databasePromise = null;
}

export function getDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase()
      .then((database) => {
        activeDatabase = database;
        return database;
      })
      .catch((error) => {
        // 一度失敗した接続Promiseを握り続けない。再読み込みボタンなどから
        // もう一度開き直せるようにする。
        databasePromise = null;
        activeDatabase = null;
        throw error;
      });
  }

  return databasePromise;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("このブラウザではメモの保存領域を利用できません。"));
      return;
    }

    let settled = false;
    let request: IDBOpenDBRequest;

    const timeoutId = window.setTimeout(() => {
      fail(
        new Error(
          "メモの保存領域を開くのに時間がかかっています。ほかのkakidasのタブを閉じて、もう一度読み込んでください。",
        ),
      );
    }, OPEN_TIMEOUT_MS);

    const finish = () => {
      window.clearTimeout(timeoutId);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    };

    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new Error("IndexedDBを開けませんでした。"),
      );
      return;
    }

    request.onerror = () => {
      fail(request.error ?? new Error("IndexedDBを開けませんでした。"));
    };

    request.onblocked = () => {
      // 別タブの db.onversionchange が接続を閉じるまで待つ。
      // ここで即座に reject すると、複数タブで正常に接続を譲る途中でも
      // 「ほかのタブを閉じて」と誤判定してしまう。
      console.info(
        "kakidas: IndexedDB upgrade is waiting for another tab to release its connection.",
      );
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;

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

      if (!db.objectStoreNames.contains(STORE_NAMES.memoSyncMeta)) {
        const syncMetaStore = db.createObjectStore(STORE_NAMES.memoSyncMeta, {
          keyPath: "memo_id",
        });

        syncMetaStore.createIndex("by_cloud_state", "cloud_state");
        syncMetaStore.createIndex("by_cloud_user_id", "cloud_user_id");
        syncMetaStore.createIndex("by_updated_at", "updated_at");
      }

      // 旧レコードの parent_id / heading / tag / note / satisfaction / is_completed / link_url は,
      // Repositoryの normalizeEntryRow / normalizeMemoSyncMeta で安全に補完する。
      // ここでcursorを使わないことで、Safariのupgrade transactionが止まりにくくなる。
    };

    request.onsuccess = () => {
      const db = request.result;

      // タイムアウトまたはblockedで画面側へエラーを返した後に接続できても、
      // 古い接続を残して次の再試行を妨げないよう即座に閉じる。
      if (settled) {
        db.close();
        return;
      }

      settled = true;
      finish();

      db.onversionchange = () => {
        db.close();
        if (activeDatabase === db) {
          activeDatabase = null;
          databasePromise = null;
        }
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
