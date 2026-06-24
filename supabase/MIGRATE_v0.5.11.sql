-- kakidas v0.5.11
-- 既存のSupabaseプロジェクトへ、各項目用の任意「備考」を追加する。
-- 一度だけ実行すればよい。既に追加済みでも安全に再実行できる。

alter table public.entries
  add column if not exists note text not null default '';
