import type {
  EntryRow,
  MemoCloudSnapshot,
  MemoRow,
  MemoSyncMetaRow,
} from "../types/memo";
import { nowIso } from "../types/memo";
import { supabase } from "../lib/supabase";
import { memoRepository } from "./memoRepository";

export type CloudUploadResult = {
  memo_id: string;
  uploaded_at: string;
  entry_count: number;
};

function ensureSupabase() {
  if (!supabase) {
    throw new Error(
      "クラウド連携の設定がまだ完了していません。Vercelの環境変数を確認してください。",
    );
  }

  return supabase;
}

function orderEntriesForUpload(entries: EntryRow[]): EntryRow[] {
  const byParent = new Map<string | null, EntryRow[]>();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  for (const entry of entries) {
    const normalizedParentId =
      entry.parent_id && byId.has(entry.parent_id) ? entry.parent_id : null;
    const siblings = byParent.get(normalizedParentId) ?? [];
    siblings.push({ ...entry, parent_id: normalizedParentId });
    byParent.set(normalizedParentId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.created_at.localeCompare(b.created_at);
    });
  }

  const ordered: EntryRow[] = [];
  const visited = new Set<string>();

  const visit = (parentId: string | null) => {
    for (const entry of byParent.get(parentId) ?? []) {
      if (visited.has(entry.id)) continue;
      visited.add(entry.id);
      ordered.push(entry);
      visit(entry.id);
    }
  };

  visit(null);

  // 壊れた親参照・循環参照でも送信対象から落とさない。
  for (const entry of entries) {
    if (visited.has(entry.id)) continue;
    visited.add(entry.id);
    ordered.push({ ...entry, parent_id: null });
    visit(entry.id);
  }

  return ordered;
}

function snapshotHash(snapshot: MemoCloudSnapshot): string {
  const source = JSON.stringify({
    memo: snapshot.memo,
    entries: snapshot.entries,
  });

  // 同期判定用の軽量な非暗号ハッシュ。セキュリティ用途では使わない。
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function toCloudMemo(memo: MemoRow, userId: string): MemoRow {
  return { ...memo, user_id: userId };
}

function toCloudEntries(entries: EntryRow[], userId: string): EntryRow[] {
  return orderEntriesForUpload(entries).map((entry) => ({
    ...entry,
    user_id: userId,
  }));
}

async function saveUploadError(
  memoId: string,
  userId: string,
  error: unknown,
): Promise<void> {
  const current = await memoRepository.getSyncMeta(memoId);
  const message = error instanceof Error ? error.message : "送信に失敗しました。";

  await memoRepository.saveSyncMeta({
    ...current,
    cloud_state: "error",
    cloud_user_id: userId,
    last_error: message,
    updated_at: nowIso(),
  });
}

/**
 * 明示されたメモだけをSupabaseへupsertする。
 * ローカル本文は変更しない。自動送信もしない。
 */
export async function uploadMemoToCloud(
  memoId: string,
  userId: string,
): Promise<CloudUploadResult> {
  const client = ensureSupabase();
  const snapshot = await memoRepository.getMemoSnapshot(memoId);

  if (!snapshot) {
    throw new Error("送信するメモが見つかりません。");
  }

  try {
    const { error: memoError } = await client
      .from("memos")
      .upsert(toCloudMemo(snapshot.memo, userId), { onConflict: "id" });

    if (memoError) throw memoError;

    const entries = toCloudEntries(snapshot.entries, userId);

    if (entries.length > 0) {
      const { error: entriesError } = await client
        .from("entries")
        .upsert(entries, { onConflict: "id" });

      if (entriesError) throw entriesError;
    }

    const uploadedAt = nowIso();
    const currentMeta = await memoRepository.getSyncMeta(memoId);
    const nextMeta: MemoSyncMetaRow = {
      ...currentMeta,
      cloud_state: "uploaded",
      cloud_user_id: userId,
      last_uploaded_at: uploadedAt,
      cloud_updated_at: snapshot.memo.updated_at,
      last_uploaded_hash: snapshotHash(snapshot),
      last_error: null,
      updated_at: uploadedAt,
    };

    await memoRepository.saveSyncMeta(nextMeta);

    return {
      memo_id: memoId,
      uploaded_at: uploadedAt,
      entry_count: entries.filter((entry) => entry.deleted_at === null).length,
    };
  } catch (error) {
    await saveUploadError(memoId, userId, error);
    throw error;
  }
}

export async function uploadMemosToCloud(
  memoIds: string[],
  userId: string,
): Promise<CloudUploadResult[]> {
  const results: CloudUploadResult[] = [];

  // 明示送信の結果がどこで失敗したか分かるよう、順番に処理する。
  for (const memoId of memoIds) {
    results.push(await uploadMemoToCloud(memoId, userId));
  }

  return results;
}
