import {
  STORE_NAMES,
  getDatabase,
  requestToPromise,
  transactionToPromise,
} from "../lib/db";
import {
  type EntryKind,
  getEntryTagKey,
  normalizeEntryTag,
  nowIso,
} from "../types/memo";

export type EntryDraftScope = "main" | "tag-group";
export type EntryDraftMetaPicker = "note" | "link" | "tag" | null;

export type EntryDraftSnapshot = {
  content: string;
  heading: string;
  tag_value: string;
  note_value: string;
  link_value: string;
  tag_draft: string;
  note_draft: string;
  link_draft: string;
  active_meta_picker: EntryDraftMetaPicker;
};

export type EntryDraftRow = EntryDraftSnapshot & {
  id: string;
  memo_id: string;
  kind: EntryKind;
  scope: EntryDraftScope;
  tag_key: string | null;
  fixed_tag: string | null;
  base_memo_updated_at: string;
  updated_at: string;
  expires_at: string;
  version: 1;
};

export type EntryDraftSaveInput = {
  id: string;
  memo_id: string;
  kind: EntryKind;
  scope: EntryDraftScope;
  fixed_tag: string | null;
  base_memo_updated_at: string;
  snapshot: EntryDraftSnapshot;
};

const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export function buildEntryDraftId(
  memoId: string,
  kind: EntryKind,
  scope: EntryDraftScope,
  fixedTag: string | null = null,
): string {
  const tagKey = scope === "tag-group"
    ? getEntryTagKey(normalizeEntryTag(fixedTag))
    : null;

  return JSON.stringify([memoId, kind, scope, tagKey]);
}

export function hasMeaningfulEntryDraft(
  snapshot: EntryDraftSnapshot,
): boolean {
  return [
    snapshot.content,
    snapshot.heading,
    snapshot.tag_value,
    snapshot.note_value,
    snapshot.link_value,
    snapshot.tag_draft,
    snapshot.note_draft,
    snapshot.link_draft,
  ].some((value) => value.trim().length > 0);
}

export function isEntryDraftExpired(draft: EntryDraftRow): boolean {
  const expiresAt = new Date(draft.expires_at).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

class IndexedDbDraftRepository {
  async get(draftId: string): Promise<EntryDraftRow | null> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.drafts, "readonly");
    const store = transaction.objectStore(STORE_NAMES.drafts);
    const draft = await requestToPromise(
      store.get(draftId) as IDBRequest<EntryDraftRow | undefined>,
    );
    await transactionToPromise(transaction);

    if (!draft || draft.version !== 1) return null;

    if (isEntryDraftExpired(draft)) {
      await this.delete(draftId);
      return null;
    }

    return draft;
  }

  async save(input: EntryDraftSaveInput): Promise<EntryDraftRow | null> {
    if (!hasMeaningfulEntryDraft(input.snapshot)) {
      await this.delete(input.id);
      return null;
    }

    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.drafts, "readwrite");
    const store = transaction.objectStore(STORE_NAMES.drafts);
    const existing = await requestToPromise(
      store.get(input.id) as IDBRequest<EntryDraftRow | undefined>,
    );
    const updatedAt = nowIso();
    const fixedTag = input.scope === "tag-group"
      ? normalizeEntryTag(input.fixed_tag)
      : null;

    const next: EntryDraftRow = {
      id: input.id,
      memo_id: input.memo_id,
      kind: input.kind,
      scope: input.scope,
      tag_key: input.scope === "tag-group" ? getEntryTagKey(fixedTag) : null,
      fixed_tag: fixedTag,
      base_memo_updated_at:
        existing?.base_memo_updated_at || input.base_memo_updated_at,
      ...input.snapshot,
      updated_at: updatedAt,
      expires_at: new Date(Date.now() + DRAFT_RETENTION_MS).toISOString(),
      version: 1,
    };

    store.put(next);
    await transactionToPromise(transaction);
    return next;
  }

  async delete(draftId: string): Promise<void> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.drafts, "readwrite");
    transaction.objectStore(STORE_NAMES.drafts).delete(draftId);
    await transactionToPromise(transaction);
  }

  async listForMemo(memoId: string): Promise<EntryDraftRow[]> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.drafts, "readonly");
    const store = transaction.objectStore(STORE_NAMES.drafts);
    const drafts = await requestToPromise(
      store.index("by_memo_id").getAll(memoId) as IDBRequest<EntryDraftRow[]>,
    );
    await transactionToPromise(transaction);

    const expiredIds = drafts.filter(isEntryDraftExpired).map((draft) => draft.id);

    if (expiredIds.length > 0) {
      await Promise.all(expiredIds.map((draftId) => this.delete(draftId)));
    }

    return drafts
      .filter((draft) => draft.version === 1 && !isEntryDraftExpired(draft))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }
}

export const draftRepository = new IndexedDbDraftRepository();
