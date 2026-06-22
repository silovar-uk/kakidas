-- kakidas: Supabaseへ移行するときの最小スキーマ案
-- Row / Insert / Update の型は src/types/memo.ts と対応する。
-- RLSポリシーと認証導線は、ログイン実装のタイミングで追加する。

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references public.memos(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('word', 'sentence', 'paragraph')),
  parent_id uuid references public.entries(id) on delete cascade,
  content text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 同一メモ・同一粒度・同一親の中で並び順を引けるようにする。
create index if not exists entries_memo_kind_parent_order_idx
  on public.entries (memo_id, kind, parent_id, sort_order, created_at)
  where deleted_at is null;

create index if not exists entries_parent_id_idx
  on public.entries (parent_id)
  where deleted_at is null;

create index if not exists memos_user_updated_idx
  on public.memos (user_id, updated_at desc)
  where deleted_at is null;
