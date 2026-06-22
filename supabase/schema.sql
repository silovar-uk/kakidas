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
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

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
