/**
 * Supabase移行時にそのままテーブル定義へ対応できるよう、
 * DBのカラム名は snake_case のまま扱う。
 *
 * 想定するテーブル:
 * - public.memos
 * - public.entries
 */

export const ENTRY_KINDS = ["word", "sentence", "paragraph"] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

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
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type EntryInsert = {
  id?: string;
  memo_id: string;
  user_id?: string | null;
  kind: EntryKind;
  content: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type EntryUpdate = Partial<
  Pick<EntryRow, "content" | "sort_order" | "updated_at" | "deleted_at" | "user_id">
>;

export type MemoWithEntries = MemoRow & {
  entries: EntryRow[];
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
      };
      entries: {
        Row: EntryRow;
        Insert: EntryInsert;
        Update: EntryUpdate;
      };
    };
  };
};

export type BackupPayload = {
  version: 1;
  exported_at: string;
  memos: MemoRow[];
  entries: EntryRow[];
};

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  word: "Word",
  sentence: "Sentence",
  paragraph: "Paragraph",
};

export const ENTRY_KIND_GUIDE: Record<EntryKind, string> = {
  word: "断片、名詞、違和感、タイトル案",
  sentence: "いま考えていることを、一文で",
  paragraph: "まとまっていなくてOK。あとで直せる",
};

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
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

export function getActiveEntries(
  entries: EntryRow[],
  kind: EntryKind,
): EntryRow[] {
  return entries
    .filter((entry) => entry.kind === kind && entry.deleted_at === null)
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return a.sort_order - b.sort_order;
      }

      return a.created_at.localeCompare(b.created_at);
    });
}
