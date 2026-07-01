-- kakidas v0.5.53
-- 単語・文・段落の各項目に、0または1つの自由入力タグを追加する。
-- 同じタグを付けた項目は、アプリ上で折りたたみグループとして表示できる。
-- 既存項目はタグなし（NULL）のまま。何度実行しても安全。

alter table public.entries
  add column if not exists tag text;

create index if not exists entries_memo_kind_tag_idx
  on public.entries (memo_id, kind, tag)
  where deleted_at is null and tag is not null;
