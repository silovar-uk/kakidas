import type {
  CloudMemoListItem,
  CloudState,
  EntryRow,
  LegacyMemoRow,
  MemoCloudSnapshot,
  MemoEntryCounts,
  MemoListItem,
  MemoRow,
  MemoSyncMetaRow,
} from "../types/memo";
import {
  isCloudLinked,
  nowIso,
  normalizeEntryRow,
  normalizeMemoRow,
} from "../types/memo";
import { supabase } from "../lib/supabase";
import { memoRepository } from "./memoRepository";

export type CloudUploadResult = {
  memo_id: string;
  uploaded_at: string;
  entry_count: number;
};

export type CloudSyncRefreshResult = {
  cloud_memos: CloudMemoListItem[];
  changed_memo_ids: string[];
};

function ensureSupabase() {
  if (!supabase) {
    throw new Error(
      "クラウド連携の設定がまだ完了していません。Vercelの環境変数を確認してください。",
    );
  }

  return supabase;
}

function getEmptyCounts(): MemoEntryCounts {
  return { word: 0, sentence: 0, paragraph: 0 };
}

function countActiveEntries(entries: EntryRow[]): MemoEntryCounts {
  return entries.reduce<MemoEntryCounts>((counts, entry) => {
    if (entry.deleted_at === null) {
      counts[entry.kind] += 1;
    }

    return counts;
  }, getEmptyCounts());
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

function toDateValue(value: string | null): number | null {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestLocalBaseline(meta: MemoSyncMetaRow): string | null {
  const uploadedAt = toDateValue(meta.last_uploaded_at);
  const downloadedAt = toDateValue(meta.last_downloaded_at);

  if (uploadedAt === null) return meta.last_downloaded_at;
  if (downloadedAt === null) return meta.last_uploaded_at;

  return uploadedAt >= downloadedAt
    ? meta.last_uploaded_at
    : meta.last_downloaded_at;
}

function isLater(left: string, right: string | null): boolean {
  const leftValue = toDateValue(left);
  const rightValue = toDateValue(right);

  return leftValue !== null && rightValue !== null && leftValue > rightValue;
}

/**
 * クラウド確認時にだけ、ローカルとクラウドの更新関係を判定する。
 * 本文は一切変更せず、memo_sync_metaだけを更新する。
 */
function deriveCloudState(
  localMemo: MemoListItem,
  remoteMemo: CloudMemoListItem,
): CloudState {
  const meta = localMemo.sync_meta;
  const localBaseline = latestLocalBaseline(meta);
  const localChanged =
    localBaseline !== null && isLater(localMemo.updated_at, localBaseline);
  const remoteChanged = isLater(
    remoteMemo.updated_at,
    meta.last_cloud_updated_at,
  );

  // 両方が基準点より新しい時は、上書き判断をせず複製取り込みへ誘導する。
  if (remoteChanged && localChanged) return "conflict";

  // 送信エラーは、明示的な再送成功まで表示を残す。
  if (meta.cloud_state === "error") return "error";

  if (remoteChanged) return "remote_newer";
  if (localChanged) return "changed_after_upload";

  return "uploaded";
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
    const { data: memoData, error: memoError } = await client
      .from("memos")
      .upsert(toCloudMemo(snapshot.memo, userId), { onConflict: "id" })
      .select("updated_at")
      .single();

    if (memoError) throw memoError;

    const entries = toCloudEntries(snapshot.entries, userId);

    if (entries.length > 0) {
      const { error: entriesError } = await client
        .from("entries")
        .upsert(entries, { onConflict: "id" });

      if (entriesError) throw entriesError;
    }

    const uploadedAt = nowIso();
    const cloudUpdatedAt =
      (memoData as Pick<MemoRow, "updated_at"> | null)?.updated_at ??
      snapshot.memo.updated_at;
    const currentMeta = await memoRepository.getSyncMeta(memoId);

    const nextMeta: MemoSyncMetaRow = {
      ...currentMeta,
      cloud_state: "uploaded",
      cloud_user_id: userId,
      last_uploaded_at: uploadedAt,
      last_downloaded_at: currentMeta.last_downloaded_at,
      last_cloud_updated_at: cloudUpdatedAt,
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

/**
 * クラウドにあるメモだけを完全に削除する。
 * この端末のIndexedDBにあるメモ本文は削除しない。メモに紐づくentriesは
 * DB側の ON DELETE CASCADE で同時に削除される。
 */
export async function deleteCloudMemo(
  memoId: string,
  userId: string,
): Promise<void> {
  const client = ensureSupabase();

  const { data, error } = await client
    .from("memos")
    .delete()
    .eq("id", memoId)
    .eq("user_id", userId)
    .select("id");

  if (error) throw error;

  if (!data || data.length === 0) {
    throw new Error("クラウド上のメモが見つかりません。画面を更新してください。");
  }

  // 同じIDのローカルメモがある場合は、クラウド連携済み表示を外す。
  // ローカル本文・項目はそのまま残し、必要なら改めて送れる状態に戻す。
  const localMemo = await memoRepository.getMemo(memoId);
  if (!localMemo) return;

  const currentMeta = await memoRepository.getSyncMeta(memoId);
  if (currentMeta.cloud_user_id !== userId) return;

  await memoRepository.saveSyncMeta({
    ...currentMeta,
    cloud_state: "local_only",
    cloud_user_id: null,
    last_uploaded_at: null,
    last_downloaded_at: null,
    last_cloud_updated_at: null,
    last_uploaded_hash: null,
    last_error: null,
    updated_at: nowIso(),
  });
}

/**
 * ログイン中のユーザーがクラウドへ送ったメモだけを返す。
 * RLSに加え、user_idでも絞り込むため、他人のメモを混ぜない。
 */
export async function listCloudMemos(userId: string): Promise<CloudMemoListItem[]> {
  const client = ensureSupabase();

  const { data: memoData, error: memoError } = await client
    .from("memos")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (memoError) throw memoError;

  const memos = ((memoData ?? []) as LegacyMemoRow[]).map(normalizeMemoRow);
  const memoIds = memos.map((memo) => memo.id);

  if (memoIds.length === 0) return [];

  const { data: entryData, error: entryError } = await client
    .from("entries")
    .select("memo_id, kind, deleted_at")
    .eq("user_id", userId)
    .in("memo_id", memoIds);

  if (entryError) throw entryError;

  const countsByMemoId = new Map<string, MemoEntryCounts>();

  for (const rawEntry of entryData ?? []) {
    const entry = rawEntry as Pick<EntryRow, "memo_id" | "kind" | "deleted_at">;
    if (entry.deleted_at !== null) continue;

    const counts = countsByMemoId.get(entry.memo_id) ?? getEmptyCounts();
    counts[entry.kind] += 1;
    countsByMemoId.set(entry.memo_id, counts);
  }

  return memos.map((memo) => ({
    ...memo,
    entry_counts: countsByMemoId.get(memo.id) ?? getEmptyCounts(),
  }));
}

/**
 * クラウド一覧を読み、同じIDを持つローカルメモの状態だけを再判定する。
 * クラウドにないメモや別アカウントのメモは触らない。
 */
export async function refreshCloudSyncStates(
  userId: string,
): Promise<CloudSyncRefreshResult> {
  const cloudMemos = await listCloudMemos(userId);
  const remoteByMemoId = new Map(
    cloudMemos.map((memo) => [memo.id, memo]),
  );
  const localMemos = await memoRepository.listMemos();
  const changedMemoIds: string[] = [];

  for (const localMemo of localMemos) {
    const meta = localMemo.sync_meta;

    if (!isCloudLinked(meta) || meta.cloud_user_id !== userId) continue;

    const remoteMemo = remoteByMemoId.get(localMemo.id);
    if (!remoteMemo) continue;

    const nextState = deriveCloudState(localMemo, remoteMemo);

    if (nextState === meta.cloud_state) continue;

    await memoRepository.saveSyncMeta({
      ...meta,
      cloud_state: nextState,
      updated_at: nowIso(),
    });

    changedMemoIds.push(localMemo.id);
  }

  return {
    cloud_memos: cloudMemos,
    changed_memo_ids: changedMemoIds,
  };
}

/**
 * 取り込み時だけ、対象メモの本文・親子構造・並び順を一括取得する。
 * deleted_atを含めて読むことで、送信元の構造を欠損させず復元できる。
 */
export async function getCloudMemoSnapshot(
  memoId: string,
  userId: string,
): Promise<MemoCloudSnapshot> {
  const client = ensureSupabase();

  const { data: memoData, error: memoError } = await client
    .from("memos")
    .select("*")
    .eq("id", memoId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (memoError) throw memoError;

  if (!memoData) {
    throw new Error("クラウド上のメモが見つかりません。画面を更新してください。");
  }

  const { data: entryData, error: entryError } = await client
    .from("entries")
    .select("*")
    .eq("memo_id", memoId)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (entryError) throw entryError;

  return {
    memo: normalizeMemoRow(memoData as LegacyMemoRow),
    entries: ((entryData ?? []) as EntryRow[]).map(normalizeEntryRow),
  };
}

export function getCloudMemoEntryCounts(
  snapshot: MemoCloudSnapshot,
): MemoEntryCounts {
  return countActiveEntries(snapshot.entries);
}
