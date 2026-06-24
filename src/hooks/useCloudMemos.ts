import { useCallback, useState } from "react";
import type {
  CloudImportMode,
  CloudImportResult,
  CloudMemoListItem,
  MemoCloudSnapshot,
} from "../types/memo";
import {
  deleteCloudMemo as deleteCloudMemoFromRepository,
  getCloudMemoSnapshot,
  refreshCloudSyncStates,
} from "../repositories/cloudMemoRepository";
import { memoRepository } from "../repositories/memoRepository";

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "クラウドの操作中に予期しないエラーが起きました。";
}

export type CloudImportCandidate = {
  snapshot: MemoCloudSnapshot;
  hasLocalMemo: boolean;
};

/**
 * UIはこのHookだけを経由してクラウド一覧・取り込みを扱う。
 * Supabase / IndexedDBへの直接アクセスはRepository層に閉じ込める。
 */
export function useCloudMemos(userId: string | null) {
  const [memos, setMemos] = useState<CloudMemoListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setMemos([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await refreshCloudSyncStates(userId);
      setMemos(result.cloud_memos);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const prepareImport = useCallback(
    async (memoId: string): Promise<CloudImportCandidate> => {
      if (!userId) {
        throw new Error("クラウドのメモを取り込むにはログインが必要です。");
      }

      setIsImporting(true);
      setError(null);

      try {
        const snapshot = await getCloudMemoSnapshot(memoId, userId);
        const localMemo = await memoRepository.getMemo(snapshot.memo.id);

        return {
          snapshot,
          hasLocalMemo: localMemo !== null,
        };
      } catch (caught) {
        const message = toErrorMessage(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setIsImporting(false);
      }
    },
    [userId],
  );

  const importSnapshot = useCallback(
    async (
      snapshot: MemoCloudSnapshot,
      mode: CloudImportMode,
    ): Promise<CloudImportResult> => {
      if (!userId) {
        throw new Error("クラウドのメモを取り込むにはログインが必要です。");
      }

      setIsImporting(true);
      setError(null);

      try {
        return await memoRepository.importCloudSnapshot(snapshot, userId, mode);
      } catch (caught) {
        const message = toErrorMessage(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setIsImporting(false);
      }
    },
    [userId],
  );

  const deleteCloudMemo = useCallback(
    async (memoId: string): Promise<void> => {
      if (!userId) {
        throw new Error("クラウドのメモを削除するにはログインが必要です。");
      }

      setIsDeleting(true);
      setError(null);

      try {
        await deleteCloudMemoFromRepository(memoId, userId);
        setMemos((current) => current.filter((memo) => memo.id !== memoId));
      } catch (caught) {
        const message = toErrorMessage(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setIsDeleting(false);
      }
    },
    [userId],
  );

  return {
    memos,
    isLoading,
    isImporting,
    isDeleting,
    error,
    refresh,
    prepareImport,
    importSnapshot,
    deleteCloudMemo,
  };
}
