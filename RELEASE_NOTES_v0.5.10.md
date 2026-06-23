# kakidas v0.5.10 — 項目日時の年表示を省略

## 変更

- Word / Sentence / Paragraphの各項目に表示する作成日時を、`YYYY/MM/DD HH:MM` から `MM/DD HH:MM` に変更。
- 年を含む元の `created_at` はIndexedDB・Supabase・クラウド取り込み時のデータとしてそのまま保持。
- 日時を表示する設定、コピー、階層、番号表示、クラウド同期の動作は変更なし。
