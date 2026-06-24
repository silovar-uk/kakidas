-- kakidas v0.5.13
-- 各項目の満足度（0〜5）を追加する。
-- 既存の項目はすべて0として扱う。

alter table public.entries
  add column if not exists satisfaction smallint not null default 0
  check (satisfaction between 0 and 5);
