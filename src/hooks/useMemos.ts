import { useCallback, useEffect, useState } from "react";
import {
  type BackupPayload,
  type EntryKind,
  type EntryRow,
  type EntryUpdate,
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
  const [memos, setMemos] = useState<MemoRow[]>([]);
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
    setMemos((current) => [memo, ...current]);
    return memo;
  }, []);

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

  const reload = useCallback(async () => {
    if (!memoId) {
      setMemo(null);
      setStatus({
        isLoading: false,
        error: "メモIDがありません。",
      });
      return;
    }

    setStatus((current) => ({
      ...current,
      isLoading: true,
      error: null,
    }));

    try {
      const nextMemo = await memoRepository.getMemo(memoId);

      setMemo(nextMemo);

      if (!nextMemo) {
        setStatus((current) => ({
          ...current,
          error: "このメモは見つからないか、削除されています。",
        }));
      }
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
  }, [memoId]);

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

        setMemo((current) =>
          current ? { ...current, ...updated } : current,
        );

        return updated;
      });
    },
    [memoId, runWrite],
  );

  const createEntry = useCallback(
    async (kind: EntryKind, content: string): Promise<EntryRow> => {
      if (!memoId) {
        throw new Error("メモIDがありません。");
      }

      return runWrite(async () => {
        const entry = await memoRepository.createEntry({
          memo_id: memoId,
          kind,
          content,
        });

        setMemo((current) =>
          current
            ? {
                ...current,
                updated_at: entry.updated_at,
                entries: [...current.entries, entry],
              }
            : current,
        );

        return entry;
      });
    },
    [memoId, runWrite],
  );

  const updateEntry = useCallback(
    async (entryId: string, patch: EntryUpdate): Promise<EntryRow> => {
      return runWrite(async () => {
        const updated = await memoRepository.updateEntry(entryId, patch);

        setMemo((current) =>
          current
            ? {
                ...current,
                updated_at: updated.updated_at,
                entries: current.entries.map((entry) =>
                  entry.id === entryId ? updated : entry,
                ),
              }
            : current,
        );

        return updated;
      });
    },
    [runWrite],
  );

  const deleteEntry = useCallback(
    async (entryId: string): Promise<void> => {
      return runWrite(async () => {
        await memoRepository.deleteEntry(entryId);

        setMemo((current) =>
          current
            ? {
                ...current,
                updated_at: new Date().toISOString(),
                entries: current.entries.filter((entry) => entry.id !== entryId),
              }
            : current,
        );
      });
    },
    [runWrite],
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
    deleteMemo,
  };
}
