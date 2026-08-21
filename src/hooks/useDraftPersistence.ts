import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  draftRepository,
  hasMeaningfulEntryDraft,
  type EntryDraftRow,
  type EntryDraftSaveInput,
  type EntryDraftSnapshot,
} from "../repositories/draftRepository";

type DraftPersistenceStatus = "idle" | "saving" | "saved" | "error";

type UseDraftPersistenceOptions = Omit<EntryDraftSaveInput, "snapshot"> & {
  snapshot: EntryDraftSnapshot;
  onRestore: (draft: EntryDraftRow) => void;
};

const DRAFT_DEBOUNCE_MS = 500;
const DRAFT_MAX_WAIT_MS = 2_000;

export function useDraftPersistence({
  id,
  memo_id,
  kind,
  scope,
  fixed_tag,
  base_memo_updated_at,
  snapshot,
  onRestore,
}: UseDraftPersistenceOptions) {
  const [status, setStatus] = useState<DraftPersistenceStatus>("idle");
  const latestSnapshotRef = useRef(snapshot);
  const previousSnapshotRef = useRef(snapshot);
  const onRestoreRef = useRef(onRestore);
  const hydratedRef = useRef(false);
  const editedBeforeHydrationRef = useRef(false);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const maxWaitTimerRef = useRef<number | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  latestSnapshotRef.current = snapshot;
  onRestoreRef.current = onRestore;

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (maxWaitTimerRef.current !== null) {
      window.clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
  }, []);

  const enqueueWrite = useCallback((nextSnapshot: EntryDraftSnapshot) => {
    const savedRevision = revisionRef.current;
    const operation = async () => {
      if (mountedRef.current) setStatus("saving");

      try {
        await draftRepository.save({
          id,
          memo_id,
          kind,
          scope,
          fixed_tag,
          base_memo_updated_at,
          snapshot: nextSnapshot,
        });
        if (revisionRef.current === savedRevision) {
          dirtyRef.current = false;
        }
        if (mountedRef.current) {
          setStatus(hasMeaningfulEntryDraft(nextSnapshot) ? "saved" : "idle");
        }
      } catch (error) {
        console.error("kakidas: failed to persist entry draft", error);
        if (mountedRef.current) setStatus("error");
      }
    };

    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(operation);

    return writeQueueRef.current;
  }, [base_memo_updated_at, fixed_tag, id, kind, memo_id, scope]);

  const flush = useCallback(async () => {
    clearTimers();

    if (!dirtyRef.current) {
      await writeQueueRef.current.catch(() => undefined);
      return;
    }

    await enqueueWrite(latestSnapshotRef.current);
  }, [clearTimers, enqueueWrite]);

  const markEdited = useCallback(() => {
    if (!hydratedRef.current) editedBeforeHydrationRef.current = true;
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    hydratedRef.current = false;
    editedBeforeHydrationRef.current = false;
    dirtyRef.current = false;
    revisionRef.current = 0;
    previousSnapshotRef.current = latestSnapshotRef.current;

    let cancelled = false;

    void draftRepository
      .get(id)
      .then((draft) => {
        if (cancelled) return;

        if (draft && !editedBeforeHydrationRef.current) {
          onRestoreRef.current(draft);
        }

        hydratedRef.current = true;
      })
      .catch((error) => {
        console.error("kakidas: failed to restore entry draft", error);
        if (!cancelled) {
          hydratedRef.current = true;
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [id]);

  useLayoutEffect(() => {
    const hasChanged = previousSnapshotRef.current !== snapshot;
    const previousWasMeaningful = hasMeaningfulEntryDraft(
      previousSnapshotRef.current,
    );
    const isMeaningful = hasMeaningfulEntryDraft(snapshot);
    previousSnapshotRef.current = snapshot;

    if (!hasChanged) return;
    if (!hydratedRef.current && !editedBeforeHydrationRef.current) return;

    dirtyRef.current = true;
    revisionRef.current += 1;

    if (!isMeaningful || !previousWasMeaningful) {
      void flush();
      return;
    }

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void flush();
    }, DRAFT_DEBOUNCE_MS);

    if (maxWaitTimerRef.current === null) {
      maxWaitTimerRef.current = window.setTimeout(() => {
        maxWaitTimerRef.current = null;
        void flush();
      }, DRAFT_MAX_WAIT_MS);
    }
  }, [flush, snapshot]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const handlePageHide = () => void flush();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      void flush();
    };
  }, [flush]);

  const markCommitted = useCallback(() => {
    clearTimers();
    dirtyRef.current = false;
    revisionRef.current += 1;
    setStatus("idle");
  }, [clearTimers]);

  return {
    status,
    flush,
    markEdited,
    markCommitted,
  };
}
