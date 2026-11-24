-- Kakidas: 段落見出しの色。既存レコード・RLS・本文は変更しない。
begin;
alter table public.entries add column if not exists heading_color text
  check (heading_color in ('red','orange','ochre','green','blue','purple'));
notify pgrst, 'reload schema';
commit;
