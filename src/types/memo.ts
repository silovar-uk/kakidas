/**
 * Supabase移行時にそのままテーブル定義へ対応できるよう、
 * DBのカラム名は snake_case のまま扱う。
 *
 * 想定するクラウドテーブル:
 * - public.memos
 * - public.entries
 *
 * entries.parent_id は entries.id を参照する自己参照キー。
 * 階層の深さは保存せず、parent_id からUI側で導出する。
 */

export const ENTRY_KINDS = ["word", "sentence", "paragraph"] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export type EntryMoveDirection = "up" | "down";

export type CloudState =
  | "local_only"
  | "uploaded"
  | "changed_after_upload"
  | "remote_newer"
  | "conflict"
  | "error";

export type MemoRow = {
  id: string;
  user_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MemoInsert = {
  id?: string;
  user_id?: string | null;
  title: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type MemoUpdate = Partial<
  Pick<MemoRow, "title" | "updated_at" | "deleted_at" | "user_id">
>;

export type EntryRow = {
  id: string;
  memo_id: string;
  user_id: string | null;
  kind: EntryKind;
  parent_id: string | null;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * v1バックアップや既存IndexedDBには parent_id が存在しないことがある。
 * 読み込み時は null として補完する。
 */
export type LegacyEntryRow = Omit<EntryRow, "parent_id"> & {
  parent_id?: string | null;
};

export type EntryInsert = {
  id?: string;
  memo_id: string;
  user_id?: string | null;
  kind: EntryKind;
  parent_id?: string | null;
  content: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type EntryUpdate = Partial<
  Pick<EntryRow, "content" | "sort_order" | "updated_at" | "deleted_at" | "user_id">
>;

/**
 * IndexedDBだけに持つ「クラウド送信状態」。
 * 本文データと送信状態を分けることで、ローカル保存を常に主役に保つ。
 */
export type MemoSyncMetaRow = {
  memo_id: string;
  cloud_state: CloudState;
  cloud_user_id: string | null;
  /** この端末から最後にクラウドへ送信した時刻。 */
  last_uploaded_at: string | null;
  /** この端末が最後にクラウド内容を取り込んだ時刻。 */
  last_downloaded_at: string | null;
  /** 最後に確認したクラウド側の memo.updated_at。 */
  last_cloud_updated_at: string | null;
  /** 最後に送信したスナップショットの軽量ハッシュ。 */
  last_uploaded_hash: string | null;
  last_error: string | null;
  updated_at: string;
};

/**
 * v0.5.0までのIndexedDBには cloud_updated_at だけが入っている。
 * 読み込み時に新しい同期メタ型へ補完する。
 */
export type LegacyMemoSyncMetaRow = Omit<
  MemoSyncMetaRow,
  "last_downloaded_at" | "last_cloud_updated_at"
> & {
  last_downloaded_at?: string | null;
  last_cloud_updated_at?: string | null;
  cloud_updated_at?: string | null;
};

export type MemoEntryCounts = Record<EntryKind, number>;

export type MemoListItem = MemoRow & {
  sync_meta: MemoSyncMetaRow;
  entry_counts: MemoEntryCounts;
};

export type MemoWithEntries = MemoRow & {
  entries: EntryRow[];
  sync_meta: MemoSyncMetaRow;
};

/** クラウド送信用。削除済み（deleted_atあり）のEntryも含める。 */
export type MemoCloudSnapshot = {
  memo: MemoRow;
  entries: EntryRow[];
};

/** クラウド一覧で使う、本文を含まない軽量なメモ情報。 */
export type CloudMemoListItem = MemoRow & {
  entry_counts: MemoEntryCounts;
};

/** クラウドからローカルへ取り込む方法。 */
export type CloudImportMode = "preserve" | "replace" | "clone";

/** クラウド取り込み完了時にUIへ返す情報。 */
export type CloudImportResult = {
  memo: MemoRow;
  source_memo_id: string;
  mode: CloudImportMode;
  imported_entry_count: number;
};

/**
 * UI表示専用の型。DBには保存しない。
 */
export type EntryTreeNode = EntryRow & {
  depth: number;
  child_count: number;
  has_children: boolean;
  can_indent: boolean;
  can_outdent: boolean;
  can_move_up: boolean;
  can_move_down: boolean;
};

/**
 * 個別削除のUndoに必要な、削除済み項目の情報。
 * 親を削除した場合は、子孫のIDも entry_ids に含める。
 */
export type EntryDeletionResult = {
  memo_id: string;
  root_entry_id: string;
  entry_ids: string[];
  deleted_count: number;
  child_count: number;
  content: string;
  kind: EntryKind;
};

/**
 * Supabaseの `Database` 型と同じ形。
 * 将来 `supabase gen types typescript` の生成物へ置き換えても、
 * Repositoryの呼び出し側を変えずに済むようにしている。
 */
export type Database = {
  public: {
    Tables: {
      memos: {
        Row: MemoRow;
        Insert: MemoInsert;
        Update: MemoUpdate;
        Relationships: [];
      };
      entries: {
        Row: EntryRow;
        Insert: EntryInsert;
        Update: EntryUpdate;
        Relationships: [
          {
            foreignKeyName: "entries_memo_id_fkey";
            columns: ["memo_id"];
            isOneToOne: false;
            referencedRelation: "memos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entries_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type BackupPayload = {
  version: 1 | 2 | 3;
  exported_at: string;
  memos: MemoRow[];
  entries: LegacyEntryRow[];
};

/** 画面に出す名前だけを日本語にする。kind / DB値は従来のまま。 */
export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  word: "単語",
  sentence: "文",
  paragraph: "段落",
};

/** 入力欄でだけ使う、短い補助文。 */
export const ENTRY_KIND_PLACEHOLDER: Record<EntryKind, string> = {
  word: "思いつき",
  sentence: "一文で書く",
  paragraph: "少し長めに書く",
};

export const CLOUD_STATE_LABEL: Record<CloudState, string> = {
  local_only: "ローカルのみ",
  uploaded: "クラウド保存済み",
  changed_after_upload: "ローカルで更新あり",
  remote_newer: "クラウドが新しい",
  conflict: "更新が競合",
  error: "送信エラー",
};

export function supportsHierarchy(kind: EntryKind): boolean {
  return kind === "word" || kind === "sentence";
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createLocalSyncMeta(memoId: string): MemoSyncMetaRow {
  return {
    memo_id: memoId,
    cloud_state: "local_only",
    cloud_user_id: null,
    last_uploaded_at: null,
    last_downloaded_at: null,
    last_cloud_updated_at: null,
    last_uploaded_hash: null,
    last_error: null,
    updated_at: nowIso(),
  };
}

function isCloudState(value: unknown): value is CloudState {
  return (
    value === "local_only" ||
    value === "uploaded" ||
    value === "changed_after_upload" ||
    value === "remote_newer" ||
    value === "conflict" ||
    value === "error"
  );
}

/**
 * 旧バージョンのIndexedDBや不完全なレコードを安全に読み込む。
 * UI・Repositoryはこの関数を通して同期メタを扱う。
 */
export function normalizeMemoSyncMeta(
  meta: LegacyMemoSyncMetaRow | undefined,
  memoId: string,
): MemoSyncMetaRow {
  const fallback = createLocalSyncMeta(memoId);

  if (!meta) return fallback;

  return {
    memo_id: meta.memo_id || memoId,
    cloud_state: isCloudState(meta.cloud_state)
      ? meta.cloud_state
      : fallback.cloud_state,
    cloud_user_id: meta.cloud_user_id ?? null,
    last_uploaded_at: meta.last_uploaded_at ?? null,
    last_downloaded_at: meta.last_downloaded_at ?? null,
    last_cloud_updated_at:
      meta.last_cloud_updated_at ?? meta.cloud_updated_at ?? null,
    last_uploaded_hash: meta.last_uploaded_hash ?? null,
    last_error: meta.last_error ?? null,
    updated_at: meta.updated_at ?? fallback.updated_at,
  };
}

export function isCloudLinked(meta: MemoSyncMetaRow): boolean {
  return meta.cloud_user_id !== null && meta.last_cloud_updated_at !== null;
}

export function normalizeEntryRow(entry: LegacyEntryRow): EntryRow {
  return {
    ...entry,
    parent_id: entry.parent_id ?? null,
  };
}

export function formatDefaultMemoTitle(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("/") +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function compareEntries(a: EntryRow, b: EntryRow): number {
  if (a.sort_order !== b.sort_order) {
    return a.sort_order - b.sort_order;
  }

  return a.created_at.localeCompare(b.created_at);
}

/**
 * parent_id + sort_order を読み、表示専用の深さつきリストへ変換する。
 * 壊れた親参照・循環参照があっても、親なしの項目として安全に表示する。
 */
export function getEntryTree(
  entries: EntryRow[],
  kind: EntryKind,
): EntryTreeNode[] {
  const activeEntries = entries
    .filter((entry) => entry.kind === kind && entry.deleted_at === null)
    .map(normalizeEntryRow)
    .sort(compareEntries);

  const entryById = new Map(activeEntries.map((entry) => [entry.id, entry]));
  const childrenByParent = new Map<string | null, EntryRow[]>();

  for (const entry of activeEntries) {
    const parentId =
      entry.parent_id &&
      entry.parent_id !== entry.id &&
      entryById.has(entry.parent_id)
        ? entry.parent_id
        : null;

    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push({ ...entry, parent_id: parentId });
    childrenByParent.set(parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareEntries);
  }

  const countDescendants = (entryId: string, seen: Set<string>): number => {
    const children = childrenByParent.get(entryId) ?? [];
    let count = 0;

    for (const child of children) {
      if (seen.has(child.id)) continue;
      const nextSeen = new Set(seen);
      nextSeen.add(child.id);
      count += 1 + countDescendants(child.id, nextSeen);
    }

    return count;
  };

  const output: EntryTreeNode[] = [];
  const visited = new Set<string>();

  const visit = (parentId: string | null, depth: number) => {
    const siblings = childrenByParent.get(parentId) ?? [];

    siblings.forEach((entry, index) => {
      if (visited.has(entry.id)) return;

      visited.add(entry.id);

      const children = childrenByParent.get(entry.id) ?? [];

      output.push({
        ...entry,
        depth,
        child_count: countDescendants(entry.id, new Set([entry.id])),
        has_children: children.length > 0,
        can_indent: index > 0,
        can_outdent: parentId !== null,
        can_move_up: index > 0,
        can_move_down: index < siblings.length - 1,
      });

      visit(entry.id, depth + 1);
    });
  };

  visit(null, 0);

  // 循環参照などでrootから辿れないデータも、見えなくならないよう最後に表示する。
  activeEntries.forEach((entry) => {
    if (visited.has(entry.id)) return;

    const siblings = activeEntries.filter(
      (candidate) =>
        !visited.has(candidate.id) &&
        (candidate.parent_id === entry.parent_id || candidate.id === entry.id),
    );

    siblings.sort(compareEntries).forEach((orphan, index) => {
      if (visited.has(orphan.id)) return;

      visited.add(orphan.id);
      const children = childrenByParent.get(orphan.id) ?? [];

      output.push({
        ...orphan,
        parent_id: null,
        depth: 0,
        child_count: countDescendants(orphan.id, new Set([orphan.id])),
        has_children: children.length > 0,
        can_indent: index > 0,
        can_outdent: false,
        can_move_up: index > 0,
        can_move_down: index < siblings.length - 1,
      });

      visit(orphan.id, 1);
    });
  });

  return output;
}

/**
 * 既存コード・単純なフラット処理向け。
 * 表示順は階層を辿った順になる。
 */
export function getActiveEntries(
  entries: EntryRow[],
  kind: EntryKind,
): EntryRow[] {
  return getEntryTree(entries, kind).map(
    ({
      depth: _depth,
      child_count: _childCount,
      has_children: _hasChildren,
      can_indent: _canIndent,
      can_outdent: _canOutdent,
      can_move_up: _canMoveUp,
      can_move_down: _canMoveDown,
      ...entry
    }) => entry,
  );
}
