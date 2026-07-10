-- kakidas v0.5.73
-- 段落だけが任意タイトルを持てるようにする。
-- 単語・文ではアプリ側で使わず、既存行は空文字として扱う。

alter table public.entries
  add column if not exists heading text not null default '';
