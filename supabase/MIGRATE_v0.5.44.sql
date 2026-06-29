-- kakidas v0.5.44
-- メモごとの単一タグ。タグ候補はメモから集計するため、専用テーブルは作らない。

alter table public.memos
  add column if not exists tag text;

create index if not exists memos_user_tag_idx
  on public.memos (user_id, tag)
  where deleted_at is null and tag is not null;
