import { useCallback, useEffect, useState } from "react";
import {
  type BackupPayload,
  type EntryKind,
  type EntryMoveDirection,
  type EntryRow,
  type EntryUpdate,
  type MemoListItem,
  type MemoRow,
  type MemoUpdate,
  type MemoWithEntries,
} from "../types/memo";
import { memoRepository } from "../repositories/memoRepository";

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
    await refresh();
    return memo;
  }, [refresh]);

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
      parentId: string | null = null,
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
        });

        await refreshAfterWrite();
        return entry;
      });
    },
    [memoId, refreshAfterWrite, runWrite],
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
    async (entryId: string): Promise<void> => {
      return runWrite(async () => {
        await memoRepository.deleteEntry(entryId);
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

  const indentEntry = useCallback(
    async (entryId: string): Promise<void> => {
      return runWrite(async () => {
        await memoRepository.indentEntry(entryId);
        await refreshAfterWrite();
      });
    },
    [refreshAfterWrite, runWrite],
  );

  const outdentEntry = useCallback(
    async (entryId: string): Promise<void> => {
      return runWrite(async () => {
        await memoRepository.outdentEntry(entryId);
        await refreshAfterWrite();
      });
    },
    [refreshAfterWrite, runWrite],
  );

  const moveEntry = useCallback(
    async (entryId: string, direction: EntryMoveDirection): Promise<void> => {
      return runWrite(async () => {
        await memoRepository.moveEntry(entryId, direction);
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
    createEntry,
    updateEntry,
    deleteEntry,
    deleteEntriesByKind,
    indentEntry,
    outdentEntry,
    moveEntry,
    deleteMemo,
  };
}
