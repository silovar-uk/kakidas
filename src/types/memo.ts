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

/** 新しい項目を同じ階層の先頭／末尾どちらに置くか。DBには保存しないUI設定。 */
export type EntryInsertPosition = "top" | "bottom";

/**
 * 項目の表示・出力に使う並び順。
 * DBの sort_order や作成日時は書き換えず、画面とコピーの順番だけを切り替える。
 */
export const ENTRY_SORT_MODES = [
  "created_asc",
  "created_desc",
  "satisfaction_desc",
] as const;

export type EntrySortMode = (typeof ENTRY_SORT_MODES)[number];

/** メモ一覧だけの表示順。本文データの日時や並びは変更しない。 */
export const MEMO_SORT_MODES = ["updated_desc", "created_desc"] as const;

export type MemoSortMode = (typeof MEMO_SORT_MODES)[number];

export const MEMO_SORT_MODE_LABEL: Record<MemoSortMode, string> = {
  updated_desc: "更新が新しい順",
  created_desc: "作成が新しい順",
};

export const ENTRY_SORT_MODE_LABEL: Record<EntrySortMode, string> = {
  created_asc: "追加順（昇順）",
  created_desc: "追加順（降順）",
  satisfaction_desc: "評価順（高い順）",
};

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
  /** メモに付ける自由入力のタグ。タグは0または1つだけ。 */
  tag: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * v0.5.43以前のIndexedDB・バックアップ・クラウド取り込みには tag がない。
 * 読み込み時に null へ補完して、旧データをそのまま使えるようにする。
 */
export type LegacyMemoRow = Omit<MemoRow, "tag"> & {
  tag?: string | null;
};

export type MemoInsert = {
  id?: string;
  user_id?: string | null;
  title: string;
  tag?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type MemoUpdate = Partial<
  Pick<MemoRow, "title" | "tag" | "updated_at" | "deleted_at" | "user_id">
>;

export type EntryRow = {
  id: string;
  memo_id: string;
  user_id: string | null;
  kind: EntryKind;
  parent_id: string | null;
  content: string;
  /** 段落だけが持つ任意の小見出し。空文字なら表示しない。 */
  heading: string;
  /** 項目に付ける自由入力のタグ。タグは0または1つだけ。 */
  tag: string | null;
  /** 任意の補足。空文字なら画面に余白を作らない。 */
  note: string;
  /** 任意の外部リンク。空文字ならリンクボタンは追加用として扱う。 */
  link_url: string;
  /** 0〜5の満足度。0が初期値で、画面上ではプルダウンから選ぶ。 */
  satisfaction: number;
  /** 完了済みなら一覧の末尾へ寄せ、コピー対象から除外できる。 */
  is_completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * v1バックアップや既存IndexedDBには parent_id が存在しないことがある。
 * 読み込み時は null として補完する。
 */
export type LegacyEntryRow = Omit<
  EntryRow,
  "parent_id" | "heading" | "tag" | "note" | "link_url" | "satisfaction" | "is_completed"
> & {
  parent_id?: string | null;
  /** v0.5.72以前は段落タイトルがないため、読み込み時に空文字へ補完する。 */
  heading?: string | null;
  /** v0.5.53以前は項目タグがないため、読み込み時にnullへ補完する。 */
  tag?: string | null;
  /** v0.5.10以前は備考カラムがないため、読み込み時に空文字へ補完する。 */
  note?: string | null;
  /** v0.5.31以前はリンクカラムがないため、読み込み時に空文字へ補完する。 */
  link_url?: string | null;
  /** v0.5.13以前は満足度がないため、読み込み時に0へ補完する。 */
  satisfaction?: number | null;
  /** v0.5.14以前は完了状態がないため、読み込み時にfalseへ補完する。 */
  is_completed?: boolean | number | string | null;
};

export type EntryInsert = {
  id?: string;
  memo_id: string;
  user_id?: string | null;
  kind: EntryKind;
  parent_id?: string | null;
  content: string;
  heading?: string;
  tag?: string | null;
  note?: string;
  link_url?: string;
  satisfaction?: number;
  is_completed?: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

/**
 * 新規項目の入力欄で任意指定できる補助情報。
 * 本文・親子関係・並び位置とは分け、入力UIからRepositoryへそのまま渡す。
 */
export type EntryCreateMetadata = Pick<EntryInsert, "heading" | "tag" | "note" | "link_url">;

export type EntryUpdate = Partial<
  Pick<
    EntryRow,
    "content" | "heading" | "tag" | "note" | "link_url" | "satisfaction" | "is_completed" | "sort_order" | "updated_at" | "deleted_at" | "user_id"
  >
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
  /**
   * 表示・コピー専用の振り番。DBへは保存せず、
   * parent_id と sort_order から毎回導出する。
   * 例: 1 / 1.1 / 1.1.1
   */
  outline_number: string;
  depth: number;
  child_count: number;
  has_children: boolean;
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
 * 完了済みの項目をまとめて整理した結果。
 * 完了済みの親の下に未完了項目がある場合は、未完了項目を残すため
 * 近い未完了の階層へ戻してから完了項目だけを削除する。
 */
export type CompletedEntriesDeletionResult = {
  memo_id: string;
  deleted_count: number;
  reparented_count: number;
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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  exported_at: string;
  /** v1〜v5はメモタグを、v1〜v6は項目タグを、v1〜v7は段落タイトルを持たないため、読み込み時に補完する。 */
  memos: LegacyMemoRow[];
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

/**
 * 内容を別の粒度へ移すための遷移先。
 * kind自体は既存のDB値をそのまま使い、表示上だけ日本語ラベルを使う。
 * 移動は内容を分割せず、移動先のルート項目として置く。
 */
export const ENTRY_KIND_MOVE_TARGETS: Record<EntryKind, readonly EntryKind[]> = {
  word: ["sentence", "paragraph"],
  sentence: ["word", "paragraph"],
  paragraph: ["sentence"],
};

export function canMoveEntryToKind(
  from: EntryKind,
  to: EntryKind,
): boolean {
  return ENTRY_KIND_MOVE_TARGETS[from].includes(to);
}

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

/**
 * 満足度は0〜5だけを受け入れる。古いバックアップや不正な値も、
 * 表示と同期の前に必ずこの範囲へ収める。
 */
export function normalizeSatisfaction(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) return 0;

  return Math.min(5, Math.max(0, Math.round(numeric)));
}

export function normalizeCompletion(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * タグは1つだけ。前後・連続空白を整え、30文字を超える場合も安全に切る。
 * 表示用の大文字小文字は保ち、候補の集計だけでキーを小文字化する。
 */
export function normalizeMemoTag(value: unknown): string | null {
  const normalized = typeof value === "string"
    ? value.replace(/\s+/gu, " ").trim()
    : "";

  if (!normalized) return null;

  return Array.from(normalized).slice(0, 30).join("") || null;
}

/** 同じタグ候補として束ねるための比較用キー。 */
export function getMemoTagKey(value: unknown): string {
  const tag = normalizeMemoTag(value);
  return tag ? tag.toLocaleLowerCase("en-US") : "";
}

/** 項目タグもメモタグと同じ正規化ルールを使う。 */
export function normalizeEntryTag(value: unknown): string | null {
  return normalizeMemoTag(value);
}

/** 項目タグを同じグループとして束ねる比較用キー。 */
export function getEntryTagKey(value: unknown): string {
  return getMemoTagKey(value);
}

export function normalizeMemoRow(memo: LegacyMemoRow): MemoRow {
  return {
    ...memo,
    tag: normalizeMemoTag(memo.tag),
  };
}

export function normalizeEntryRow(entry: LegacyEntryRow): EntryRow {
  return {
    ...entry,
    parent_id: entry.parent_id ?? null,
    heading: typeof entry.heading === "string" ? entry.heading.trim() : "",
    tag: normalizeEntryTag(entry.tag),
    note: typeof entry.note === "string" ? entry.note : "",
    link_url: typeof entry.link_url === "string" ? entry.link_url.trim() : "",
    satisfaction: normalizeSatisfaction(entry.satisfaction),
    is_completed: normalizeCompletion(entry.is_completed),
  };
}

/**
 * リンク入力を保存向けに整える。
 * `example.com` のような貼り付けには https を補い、HTTP(S)以外は受け付けない。
 */
export function normalizeLinkUrlForSave(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) return "";

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("リンクのURLを確認してください。");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("リンクには http:// または https:// のURLを入れてください。");
  }

  return parsed.href;
}

/**
 * 既存データに不正な値が混ざっていても、表示やリンク遷移で例外を出さない。
 */
export function getOpenableLinkUrl(value: unknown): string | null {
  try {
    const normalized = normalizeLinkUrlForSave(value);
    return normalized || null;
  } catch {
    return null;
  }
}

/**
 * メモタイトルに使う日付部分。
 * 年・時刻は created_at に保持し、タイトルには含めない。
 */
const JAPANESE_WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatMemoDatePrefix(date: Date): string {
  const weekday = JAPANESE_WEEKDAY_LABELS[date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()} ${weekday}`;
}

/**
 * 新規メモの空の初期タイトル。
 * 日付の後ろに空のかぎ括弧を置き、まだ題名がない状態も見分けやすくする。
 */
export function formatDefaultMemoTitle(date = new Date()): string {
  return `${formatMemoDatePrefix(date)}「」`;
}

/**
 * 項目を起点に別メモを作る時のタイトル。
 * 日付を先頭に残し、改行や連続空白を一行へ整えてから本文の冒頭を添える。
 */
export function formatDerivedMemoTitle(
  date: Date,
  content: string,
): string {
  const dateTitle = formatMemoDatePrefix(date);
  const condensed = content.replace(/\s+/gu, " ").trim();

  if (!condensed) return dateTitle;

  const titleCharacters = Array.from(condensed);
  const preview = titleCharacters.length > 30
    ? `${titleCharacters.slice(0, 29).join("")}…`
    : condensed;

  return `${dateTitle}｜${preview}`;
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
 * 完了済みは各階層の末尾へ寄せたまま、未完了・完了それぞれの中だけを選択順に並べる。
 * 表示順はローカルのUI設定であり、DBの sort_order / created_at は変更しない。
 */
function compareEntriesForDisplay(
  a: EntryRow,
  b: EntryRow,
  sortMode: EntrySortMode,
): number {
  // 完了項目は常に後ろへ寄せる。タグでまとめる表示では、この順を使って最下部の完了グループへ分ける。
  if (a.is_completed !== b.is_completed) {
    return Number(a.is_completed) - Number(b.is_completed);
  }

  if (sortMode === "created_asc") {
    return a.created_at.localeCompare(b.created_at) || compareEntries(a, b);
  }

  if (sortMode === "created_desc") {
    return b.created_at.localeCompare(a.created_at) || compareEntries(a, b);
  }

  // 評価順は高い方を先にし、同評価なら新しく追加した方を先に見せる。
  return (
    b.satisfaction - a.satisfaction ||
    b.created_at.localeCompare(a.created_at) ||
    compareEntries(a, b)
  );
}

/**
 * parent_id + sort_order を読み、表示専用の深さつきリストへ変換する。
 * 壊れた親参照・循環参照があっても、親なしの項目として安全に表示する。
 */
export function getEntryTree(
  entries: EntryRow[],
  kind: EntryKind,
  sortMode: EntrySortMode = "created_desc",
): EntryTreeNode[] {
  const activeEntries = entries
    .filter((entry) => entry.kind === kind && entry.deleted_at === null)
    .map(normalizeEntryRow)
    .sort((a, b) => compareEntriesForDisplay(a, b, sortMode));

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
    siblings.sort((a, b) => compareEntriesForDisplay(a, b, sortMode));
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

  /**
   * 振り番は保存しない。並び替えや子の追加のたびに
   * parent_id と sort_order から再計算するので、常に現在の階層と一致する。
   */
  const visit = (
    parentId: string | null,
    depth: number,
    parentNumber: number[],
  ) => {
    const siblings = childrenByParent.get(parentId) ?? [];

    siblings.forEach((entry, index) => {
      if (visited.has(entry.id)) return;

      visited.add(entry.id);

      const numberParts = [...parentNumber, index + 1];
      const children = childrenByParent.get(entry.id) ?? [];

      output.push({
        ...entry,
        outline_number: numberParts.join("."),
        depth,
        child_count: countDescendants(entry.id, new Set([entry.id])),
        has_children: children.length > 0,
        can_move_up:
          index > 0 && siblings[index - 1]?.is_completed === entry.is_completed,
        can_move_down:
          index < siblings.length - 1 &&
          siblings[index + 1]?.is_completed === entry.is_completed,
      });

      visit(entry.id, depth + 1, numberParts);
    });
  };

  visit(null, 0, []);

  // 循環参照などでrootから辿れないデータも、見えなくならないよう最後に表示する。
  // 通常のroot項目の続き番号を振ることで、番号が重複しないようにする。
  let nextOrphanRootNumber = (childrenByParent.get(null) ?? []).length + 1;

  activeEntries.forEach((entry) => {
    if (visited.has(entry.id)) return;

    const siblings = activeEntries.filter(
      (candidate) =>
        !visited.has(candidate.id) &&
        (candidate.parent_id === entry.parent_id || candidate.id === entry.id),
    );

    siblings.sort((a, b) => compareEntriesForDisplay(a, b, sortMode)).forEach((orphan, index) => {
      if (visited.has(orphan.id)) return;

      visited.add(orphan.id);
      const numberParts = [nextOrphanRootNumber + index];
      const children = childrenByParent.get(orphan.id) ?? [];

      output.push({
        ...orphan,
        parent_id: null,
        outline_number: numberParts.join("."),
        depth: 0,
        child_count: countDescendants(orphan.id, new Set([orphan.id])),
        has_children: children.length > 0,
        can_move_up:
          index > 0 && siblings[index - 1]?.is_completed === orphan.is_completed,
        can_move_down:
          index < siblings.length - 1 &&
          siblings[index + 1]?.is_completed === orphan.is_completed,
      });

      visit(orphan.id, 1, numberParts);
    });

    nextOrphanRootNumber += siblings.length;
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
  sortMode: EntrySortMode = "created_desc",
): EntryRow[] {
  return getEntryTree(entries, kind, sortMode).map(
    ({
      outline_number: _outlineNumber,
      depth: _depth,
      child_count: _childCount,
      has_children: _hasChildren,
      can_move_up: _canMoveUp,
      can_move_down: _canMoveDown,
      ...entry
    }) => entry,
  );
}
