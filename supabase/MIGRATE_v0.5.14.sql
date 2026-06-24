-- kakidas v0.5.14
-- 各項目の完了状態。falseは未完了、trueは完了済み。
-- 既存の項目は未完了として扱う。

alter table public.entries
  add column if not exists is_completed boolean not null default false;
