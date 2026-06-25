-- kakidas v0.5.31
-- 各項目に任意の外部リンクを追加する。
-- 一度だけ実行すればよい。既に追加済みでも安全に再実行できる。

alter table public.entries
  add column if not exists link_url text not null default '';
