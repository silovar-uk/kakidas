import { useCallback, useEffect, useState } from "react";
import {
  type BackupPayload,
  type CompletedEntriesDeletionResult,
  type EntryCreateMetadata,
  type EntryDeletionResult,
  type EntryKind,
  type EntryInsertPosition,
  type EntryRow,
  type EntryUpdate,
  type MemoListItem,
  type MemoRow,
  type MemoUpdate,
  type MemoWithEntries,
  createLocalSyncMeta,
} from "../types/memo";
import {
  memoRepository,
  type EntryTagBulkUpdateResult,
  type MemoFromEntryResult,
  type MemoTagBulkUpdateResult,
} from "../repositories/memoRepository";

type AsyncStatus = {
  isLoading: boolean;
  error: string | null;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "予期しないエラーが起きました。";
}

export function useMemos() {
  const [memos, setMemos] = useState<MemoListItem[]>([]);
  const [status, setStatus] = useState<AsyncStatus>({
    isLoading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    setStatus((current) => ({
      ...current,
      isLoading: true,
      error: null,
    }));

    try {
      const nextMemos = await memoRepository.listMemos();
      setMemos(nextMemos);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: toErrorMessage(error),
      }));
    } finally {
      setStatus((current) => ({
        ...current,
        isLoading: false,
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createMemo = useCallback(async (): Promise<MemoRow> => {
    const memo = await memoRepository.createMemo();

    // 新規作成直後は再読み込みを待たず、すぐ編集画面へ進める。
    // iPhone Safariでも入力欄へのフォーカスを失いにくくするための最短経路。
    setMemos((current) => [
      {
        ...memo,
        sync_meta: createLocalSyncMeta(memo.id),
        entry_counts: { word: 0, sentence: 0, paragraph: 0 },
      },
      ...current.filter((item) => item.id !== memo.id),
    ]);

    return memo;
  }, []);

  const updateMemo = useCallback(
    async (memoId: string, patch: MemoUpdate): Promise<MemoRow> => {
      const updated = await memoRepository.updateMemo(memoId, patch);
      setMemos((current) =>
        current.map((memo) =>
          memo.id === memoId
            ? { ...memo, ...updated }
            : memo,
        ),
      );
      return updated;
    },
    [],
  );

  const renameTag = useCallback(
    async (currentTag: string, nextTag: string): Promise<MemoTagBulkUpdateResult> => {
      const result = await memoRepository.renameTag(currentTag, nextTag);
      await refresh();
      return result;
    },
    [refresh],
  );

  const clearTag = useCallback(
    async (currentTag: string): Promise<MemoTagBulkUpdateResult> => {
      const result = await memoRepository.clearTag(currentTag);
      await refresh();
      return result;
    },
    [refresh],
  );

  const deleteMemo = useCallback(async (memoId: string): Promise<void> => {
    await memoRepository.deleteMemo(memoId);
    setMemos((current) => current.filter((memo) => memo.id !== memoId));
  }, []);

  const exportBackup = useCallback(async (): Promise<BackupPayload> => {
    return memoRepository.exportBackup();
  }, []);

  const importBackup = useCallback(
    async (payload: BackupPayload): Promise<void> => {
      await memoRepository.importBackup(payload);
      await refresh();
    },
    [refresh],
  );

  return {
    memos,
    isLoading: status.isLoading,
    error: status.error,
    refresh,
    createMemo,
    updateMemo,
    renameTag,
    clearTag,
    deleteMemo,
    exportBackup,
    importBackup,
  };
}

export function useMemoDetail(memoId: string | undefined) {
  const [memo, setMemo] = useState<MemoWithEntries | null>(null);
  const [status, setStatus] = useState<AsyncStatus>({
    isLoading: true,
    error: null,
  });
  const [pendingWrites, setPendingWrites] = useState(0);

  const loadMemo = useCallback(
    async (showLoading: boolean): Promise<MemoWithEntries | null> => {
      if (!memoId) {
        setMemo(null);
        setStatus({
          isLoading: false,
          error: "メモIDがありません。",
        });
        return null;
      }

      if (showLoading) {
        setStatus((current) => ({
          ...current,
          isLoading: true,
          error: null,
        }));
      }

      try {
        const nextMemo = await memoRepository.getMemo(memoId);
        setMemo(nextMemo);

        if (!nextMemo) {
          setStatus((current) => ({
            ...current,
            error: "このメモは見つからないか、削除されています。",
          }));
        }

        return nextMemo;
      } catch (error) {
        setStatus((current) => ({
          ...current,
          error: toErrorMessage(error),
        }));
        return null;
      } finally {
        if (showLoading) {
          setStatus((current) => ({
            ...current,
            isLoading: false,
          }));
        }
      }
    },
    [memoId],
  );

  const reload = useCallback(() => loadMemo(true), [loadMemo]);
  const refreshAfterWrite = useCallback(() => loadMemo(false), [loadMemo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runWrite = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      setPendingWrites((count) => count + 1);
      setStatus((current) => ({
        ...current,
        error: null,
      }));

      try {
        return await operation();
      } catch (error) {
        const message = toErrorMessage(error);
        setStatus((current) => ({
          ...current,
          error: message,
        }));
        throw error;
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1));
      }
    },
    [],
  );

  const updateTitle = useCallback(
    async (patch: MemoUpdate): Promise<MemoRow> => {
      if (!memoId) {
        throw new Error("メモIDがありません。");
      }

      return runWrite(async () => {
        const updated = await memoRepository.updateMemo(memoId, patch);
        await refreshAfterWrite();
        return updated;
      });
    },
    [memoId, refreshAfterWrite, runWrite],
  );

  const createEntry = useCallback(
    async (
      kind: EntryKind,
      content: string,
      metadata: EntryCreateMetadata = {},
      parentId: string | null = null,
      position: EntryInsertPosition = "bottom",
    ): Promise<EntryRow> => {
      if (!memoId) {
        throw new Error("メモIDがありません。");
      }

      return runWrite(async () => {
        const entry = await memoRepository.createEntry({
          memo_id: memoId,
          kind,
          parent_id: parentId,
          content,
          ...metadata,
        }, position);

        await refreshAfterWrite();
        return entry;
      });
    },
    [memoId, refreshAfterWrite, runWrite],
  );

  const createMemoFromEntry = useCallback(
    async (entryId: string): Promise<MemoFromEntryResult> => {
      return runWrite(async () => memoRepository.createMemoFromEntry(entryId));
    },
    [runWrite],
  );

  const updateEntry = useCallback(
    async (entryId: string, patch: EntryUpdate): Promise<EntryRow> => {
      return runWrite(async () => {
        const updated = await memoRepository.updateEntry(entryId, patch);
        await refreshAfterWrite();
        return updated;
      });
    },
    [refreshAfterWrite, runWrite],
  );

  const deleteEntry = useCallback(
    async (entryId: string): Promise<EntryDeletionResult> => {
      return runWrite(async () => {
        const deletion = await memoRepository.deleteEntry(entryId);
        await refreshAfterWrite();
        return deletion;
      });
    },
    [refreshAfterWrite, runWrite],
  );

  const restoreEntries = useCallback(
    async (entryIds: string[]): Promise<void> => {
      return runWrite(async () => {
        await memoRepository.restoreEntries(entryIds);
        await refreshAfterWrite();
      });
    },
    [refreshAfterWrite, runWrite],
  );

  const deleteEntriesByKind = useCallback(
    async (kind: EntryKind): Promise<number> => {
      if (!memoId) {
        throw new Error("メモIDがありません。");
      }

      return runWrite(async () => {
        const deletedCount = await memoRepository.deleteEntriesByKind(memoId, kind);
        await refreshAfterWrite();
        return deletedCount;
      });
    },
    [memoId, refreshAfterWrite, runWrite],
  );

  const deleteCompletedEntries = useCallback(
    async (): Promise<CompletedEntriesDeletionResult> => {
      if (!memoId) {
        throw new Error("メモIDがありません。");
      }

      return runWrite(async () => {
        const result = await memoRepository.deleteCompletedEntries(memoId);
        await refreshAfterWrite();
        return result;
      });
    },
    [memoId, refreshAfterWrite, runWrite],
  );

  /** タググループ見出しから、同じメモ・同じ区分の項目タグをまとめて変更する。 */
  const renameEntryTag = useCallback(
    async (
      kind: EntryKind,
      currentTag: string,
      nextTag: string,
    ): Promise<EntryTagBulkUpdateResult> => {
      if (!memoId) {
        throw new Error("メモIDがありません。");
      }

      return runWrite(async () => {
        const result = await memoRepository.renameEntryTag(
          memoId,
          kind,
          currentTag,
          nextTag,
        );
        await refreshAfterWrite();
        return result;
      });
    },
    [memoId, refreshAfterWrite, runWrite],
  );

  const moveEntryToKind = useCallback(
    async (entryId: string, targetKind: EntryKind): Promise<void> => {
      return runWrite(async () => {
        await memoRepository.moveEntryToKind(entryId, targetKind);
        await refreshAfterWrite();
      });
    },
    [refreshAfterWrite, runWrite],
  );

  const deleteMemo = useCallback(async (): Promise<void> => {
    if (!memoId) {
      throw new Error("メモIDがありません。");
    }

    return runWrite(async () => {
      await memoRepository.deleteMemo(memoId);
      setMemo(null);
    });
  }, [memoId, runWrite]);

  return {
    memo,
    isLoading: status.isLoading,
    isSaving: pendingWrites > 0,
    error: status.error,
    reload,
    updateTitle,
    updateMemo: updateTitle,
    createEntry,
    createMemoFromEntry,
    updateEntry,
    deleteEntry,
    restoreEntries,
    deleteEntriesByKind,
    deleteCompletedEntries,
    renameEntryTag,
    moveEntryToKind,
    deleteMemo,
  };
}
