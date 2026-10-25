import {
  STORE_NAMES,
  getDatabase,
  requestToPromise,
  transactionToPromise,
} from "../lib/db";
import { isSupportedDraft } from "../lib/draftRecovery";
import {
  ENTRY_KINDS,
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

/** 保存済みの書きかけを経過日数だけで消してはいけない。旧スキーマの期限欄は維持する。 */
const NO_EXPIRY = "9999-12-31T23:59:59.999Z";

/** 初期の共通書き口では、IDはparagraph/wordでもkindがsentenceとなり得た。
 * ID側が正しい場合はそれを正本とし、既存レコードを削除・上書きせず復元する。
 */
export function kindFromDraftIdentity(id: string, memoId: string, fallback: EntryKind): EntryKind {
  try {
    const parts: unknown = JSON.parse(id);
    if (Array.isArray(parts) && parts.length === 4 && parts[0] === memoId &&
      ENTRY_KINDS.includes(parts[1] as EntryKind)) return parts[1] as EntryKind;
  } catch {
    // 旧形式・不正なIDは元の種類を維持する。
  }
  return fallback;
}
function normalizeLegacyDraftKind(draft: EntryDraftRow): EntryDraftRow {
  const kind = kindFromDraftIdentity(draft.id, draft.memo_id, draft.kind);
  return kind === draft.kind ? draft : { ...draft, kind };
}

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

class IndexedDbDraftRepository {
  /** 旧版・将来版の下書きも含めて存在を判定する。Undo時の誤上書き防止に使う。 */
  async hasAnyDraft(draftId: string): Promise<boolean> {
    const db = await getDatabase();
    const tx = db.transaction(STORE_NAMES.drafts, "readonly");
    const value = await requestToPromise(
      tx.objectStore(STORE_NAMES.drafts).get(draftId) as IDBRequest<EntryDraftRow | undefined>,
    );
    await transactionToPromise(tx);
    return value !== undefined;
  }

  async get(draftId: string): Promise<EntryDraftRow | null> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.drafts, "readonly");
    const store = transaction.objectStore(STORE_NAMES.drafts);
    const draft = await requestToPromise(
      store.get(draftId) as IDBRequest<EntryDraftRow | undefined>,
    );
    await transactionToPromise(transaction);

    // 旧レコードの期限が過ぎていても内容は残す。バージョン不一致も自動削除しない。
    if (!draft || !isSupportedDraft(draft)) return null;

    return normalizeLegacyDraftKind(draft);
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
      kind: kindFromDraftIdentity(input.id, input.memo_id, input.kind),
      scope: input.scope,
      tag_key: input.scope === "tag-group" ? getEntryTagKey(fixedTag) : null,
      fixed_tag: fixedTag,
      base_memo_updated_at:
        existing?.base_memo_updated_at || input.base_memo_updated_at,
      ...input.snapshot,
      updated_at: updatedAt,
      expires_at: NO_EXPIRY,
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

  async migrateOldMainDraft(fromId: string, toId: string): Promise<void> {
    const db = await getDatabase();
    const tx = db.transaction(STORE_NAMES.drafts, "readwrite");
    const store = tx.objectStore(STORE_NAMES.drafts);
    const old = await requestToPromise(store.get(fromId) as IDBRequest<EntryDraftRow | undefined>);
    const current = await requestToPromise(store.get(toId) as IDBRequest<EntryDraftRow | undefined>);
    if (old && !current) {
      // コピー先を作っても原本は消さない。誤って古い書きかけを失うことを防ぐ。
      store.put({
        ...old, id: toId,
        kind: kindFromDraftIdentity(toId, old.memo_id, old.kind),
        updated_at: nowIso(),
      });
    }
    await transactionToPromise(tx);
  }

  async listForMemo(memoId: string): Promise<EntryDraftRow[]> {
    const db = await getDatabase();
    const transaction = db.transaction(STORE_NAMES.drafts, "readonly");
    const store = transaction.objectStore(STORE_NAMES.drafts);
    const drafts = await requestToPromise(
      store.index("by_memo_id").getAll(memoId) as IDBRequest<EntryDraftRow[]>,
    );
    await transactionToPromise(transaction);

    // 期限切れ扱いによるデータ削除・非表示を廃止。破棄は保存確定後の明示削除だけ。
    return drafts
      .filter(isSupportedDraft)
      .map(normalizeLegacyDraftKind)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }
}

export const draftRepository = new IndexedDbDraftRepository();
