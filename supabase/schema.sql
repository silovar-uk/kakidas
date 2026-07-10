-- kakidas v0.4.0
-- Phase 1: Google login
-- Phase 2: user-selected memo upload
--
-- ローカルIndexedDBが基本の保存先。
-- このスキーマは「ユーザーが選んで送ったメモ」だけのクラウド保存先です。

create extension if not exists "pgcrypto";

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  -- メモに付けるタグは0または1つ。候補はメモから集計する。
  tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references public.memos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('word', 'sentence', 'paragraph')),
  parent_id uuid references public.entries(id) on delete cascade,
  content text not null,
  -- 段落だけが持つ任意の小見出し。空文字なら表示しない。
  heading text not null default '',
  -- 項目に付けるタグは0または1つ。タグ表示の折りたたみグループに使う。
  tag text,
  -- 任意の気持ち・備考。空文字ならアプリ画面には表示しない。
  note text not null default '',
  -- 任意の外部リンク。通常時はURL文字列を出さず、リンクアイコンとして扱う。
  link_url text not null default '',
  -- 0〜5の満足度。画面ではタップごとに1ずつ進める。
  satisfaction smallint not null default 0 check (satisfaction between 0 and 5),
  -- 完了済みなら一覧の末尾へ寄せ、コピー対象から除外できる。
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);


-- v0.5.11: 既存プロジェクトにも任意の備考カラムを追加する。
alter table public.entries
  add column if not exists note text not null default '';

-- v0.5.13: 既存プロジェクトにも各項目の満足度を追加する。
alter table public.entries
  add column if not exists satisfaction smallint not null default 0
  check (satisfaction between 0 and 5);

-- v0.5.14: 既存プロジェクトにも完了状態を追加する。
alter table public.entries
  add column if not exists is_completed boolean not null default false;

-- v0.5.31: 既存プロジェクトにも項目ごとの外部リンクを追加する。
alter table public.entries
  add column if not exists link_url text not null default '';

-- v0.5.44: メモに0または1つだけタグを付ける。
alter table public.memos
  add column if not exists tag text;

create index if not exists memos_user_tag_idx
  on public.memos (user_id, tag)
  where deleted_at is null and tag is not null;

-- v0.5.53: 単語・文・段落ごとの項目タグ。表示上のタググループに使う。
alter table public.entries
  add column if not exists tag text;

-- v0.5.73: 段落だけが任意タイトルを持てるようにする。
alter table public.entries
  add column if not exists heading text not null default '';

create index if not exists entries_memo_kind_tag_idx
  on public.entries (memo_id, kind, tag)
  where deleted_at is null and tag is not null;

create index if not exists entries_memo_kind_parent_order_idx
  on public.entries (memo_id, kind, parent_id, sort_order, created_at)
  where deleted_at is null;

create index if not exists entries_parent_id_idx
  on public.entries (parent_id)
  where deleted_at is null;

create index if not exists memos_user_updated_idx
  on public.memos (user_id, updated_at desc)
  where deleted_at is null;

-- ブラウザのPublishable keyでアクセスするため、RLSを必ず有効にする。
alter table public.memos enable row level security;
alter table public.entries enable row level security;

-- 何度実行しても更新できるよう、既存ポリシーを置き換える。
drop policy if exists "kakidas_select_own_memos" on public.memos;
drop policy if exists "kakidas_insert_own_memos" on public.memos;
drop policy if exists "kakidas_update_own_memos" on public.memos;
drop policy if exists "kakidas_delete_own_memos" on public.memos;
drop policy if exists "kakidas_select_own_entries" on public.entries;
drop policy if exists "kakidas_insert_own_entries" on public.entries;
drop policy if exists "kakidas_update_own_entries" on public.entries;
drop policy if exists "kakidas_delete_own_entries" on public.entries;

create policy "kakidas_select_own_memos"
  on public.memos for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "kakidas_insert_own_memos"
  on public.memos for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "kakidas_update_own_memos"
  on public.memos for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "kakidas_delete_own_memos"
  on public.memos for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "kakidas_select_own_entries"
  on public.entries for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "kakidas_insert_own_entries"
  on public.entries for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.memos
      where public.memos.id = memo_id
        and public.memos.user_id = (select auth.uid())
    )
  );

create policy "kakidas_update_own_entries"
  on public.entries for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.memos
      where public.memos.id = memo_id
        and public.memos.user_id = (select auth.uid())
    )
  );

create policy "kakidas_delete_own_entries"
  on public.entries for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- SQL Editorで作成したテーブルをログイン済みユーザーが利用できるようにする。
-- RLSポリシーが、ここで許可された操作のうち「自分の行だけ」に絞り込む。
grant usage on schema public to authenticated;

grant select, insert, update, delete
on table public.memos
to authenticated;

grant select, insert, update, delete
on table public.entries
to authenticated;
