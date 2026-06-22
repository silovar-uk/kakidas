# かきだす

Word / Sentence / Paragraphの3つの入口から、整える前に考えを外へ置くためのWebアプリです。

## 仕様

- メモはIndexedDBに自動保存
- メモ単位で作成・編集・削除
- Word / Sentence / Paragraphは完全に独立
- Word / SentenceはEnterで確定
- ParagraphはEnterで確定、Shift + Enterで改行
- 日本語IME変換中のEnterで誤保存しない
- 画面ごとにRepository層だけを参照。UIからIndexedDBへ直接アクセスしない
- `memos` / `entries` の型はSupabaseテーブルのRow / Insert / Update構造と対応
- JSONのバックアップ・復元
- Markdown形式でコピー、`.txt`書き出し

## 動かし方

Node.js 20以上を用意する。

```bash
npm install
npm run dev
```

表示されたURLをブラウザで開く。

本番ビルドの確認:

```bash
npm run build
npm run preview
```

## Vercelデプロイ

### GitHub経由

1. このプロジェクトをGitHubリポジトリへpushする。
2. Vercelへログインし、`Add New...` → `Project` を選ぶ。
3. GitHubリポジトリをImportする。
4. Framework Presetは `Vite` を選ぶ。Vercelが自動判定した場合もそのままでよい。
5. Build Commandが `npm run build`、Output Directoryが `dist` であることを確認する。
6. `Deploy` を押す。

`vercel.json` は、`/memos/:memoId` をブラウザで直接開いたときもSPAとして表示するためのrewrites設定です。

### Vercel CLI経由

```bash
npm install -g vercel
vercel
```

画面の案内に沿ってプロジェクトを接続する。

## 将来Supabaseへ移行する方法

### 1. テーブルを作る

`src/types/memo.ts` の `MemoRow` と `EntryRow` がカラム定義です。

- `memos`: `id`, `user_id`, `title`, `created_at`, `updated_at`, `deleted_at`
- `entries`: `id`, `memo_id`, `user_id`, `kind`, `content`, `sort_order`, `created_at`, `updated_at`, `deleted_at`

`deleted_at` は、端末間同期時に削除を同期するためのソフトデリート用カラムです。

### 2. Repositoryだけを置き換える

`src/repositories/memoRepository.ts` の `MemoRepository` interfaceを実装する `SupabaseMemoRepository` を作る。

UIとHookは `memoRepository` のinterfaceしか参照していないため、画面コンポーネントを変更せずに同期実装へ差し替えられる。

### 3. ローカルデータを移行する

既存ユーザーは、現行版で `JSONを書き出す` を実行し、同期版でそのJSONをImportする導線を用意する。

## 保存について

IndexedDBのデータは、このブラウザ・この端末に保存されます。ブラウザのサイトデータ削除、別ブラウザ・別端末への移動では引き継がれません。大切なメモは定期的にJSONバックアップを書き出してください。
