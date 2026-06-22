# kakidas

Word / Sentence / Paragraphの3つの入口から、整える前に考えを外へ置くためのWebアプリです。

## 仕様

- メモはIndexedDBに自動保存
- メモ単位で作成・編集・削除
- Word / Sentence / Paragraphは完全に独立
- Word / SentenceはEnterで確定
- ParagraphはEnterで確定、Shift + Enterで改行
- 日本語IME変換中のEnterで誤保存しない
- **Word / Sentenceには階層を付けられる**
  - `⋯` → `＋ 子を追加`：その項目の下に続けて書く
  - `⋯` → `→ 下げる`：ひとつ上の項目の子にする
  - `⋯` → `← 戻す`：親と同じ階層へ戻す
  - `⋯` → `↑ 上へ` / `↓ 下へ`：同じ親の中で並び替える
  - 親を削除すると、その下の子項目も一緒に削除
- Paragraphは階層を付けず、まとまった文章を置く場所として維持
- スマホはWord / Sentence / Paragraphをタブで切り替え、入力欄はスクロール中も上部に留まる
- 画面ごとにRepository層だけを参照。UIからIndexedDBへ直接アクセスしない
- `memos` / `entries` の型はSupabaseテーブルのRow / Insert / Update構造と対応
- JSONのバックアップ・復元
- Markdown形式でコピー、`.txt`書き出し

## 使い方

### ふつうに書く

1. Word / Sentence / Paragraphのどれかを選ぶ
2. 書いてEnterを押す
3. 項目がその場に置かれ、入力欄は次の内容を待つ

### Word / Sentenceを階層化する

1. 親にしたい項目の右にある `⋯` をタップ
2. `＋ 子を追加` を押す
3. 上部の入力欄に「子として追加」が表示される
4. 書いてEnterを押すと、その項目の子として保存される
5. もう一度最上位に書きたいときは、入力欄の `×` で親の指定を外す

スマホでは、構造操作を長押しやドラッグに頼らず、1回のタップで開く操作トレイにまとめています。

## 動かし方

Node.js 22系を用意する。

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

`supabase/schema.sql` に最小スキーマ案を置いています。

- `memos`: `id`, `user_id`, `title`, `created_at`, `updated_at`, `deleted_at`
- `entries`: `id`, `memo_id`, `user_id`, `kind`, **`parent_id`**, `content`, `sort_order`, `created_at`, `updated_at`, `deleted_at`

`parent_id` がWord / Sentenceの階層を表します。深さそのものは保存せず、親子関係から導出します。

`deleted_at` は、端末間同期時に削除を同期するためのソフトデリート用カラムです。

### 2. Repositoryだけを置き換える

`src/repositories/memoRepository.ts` の `MemoRepository` interfaceを実装する `SupabaseMemoRepository` を作る。

UIとHookは `memoRepository` のinterfaceしか参照していないため、画面コンポーネントを変更せずに同期実装へ差し替えられます。階層操作の `indentEntry` / `outdentEntry` / `moveEntry` は、Supabase実装ではRPCまたはトランザクション相当の処理にまとめるのがおすすめです。

### 3. ローカルデータを移行する

既存ユーザーは、現行版で `JSONを書き出す` を実行し、同期版でそのJSONをImportする導線を用意する。

v1形式のJSON（`parent_id`なし）も読み込めます。読み込み時は全項目を最上位として扱います。

## 保存について

IndexedDBのデータは、このブラウザ・この端末に保存されます。ブラウザのサイトデータ削除、別ブラウザ・別端末への移動では引き継がれません。大切なメモは定期的にJSONバックアップを書き出してください。

## アイコン

`public/` には、ブラウザタブ・ブックマーク・ホーム画面追加用のアイコンを配置しています。

- `favicon.ico`：ブラウザタブ、ブックマークなど
- `apple-touch-icon.png`：iPhone / iPadのホーム画面追加
- `android-chrome-192x192.png` / `android-chrome-512x512.png`：Android / PWA用
- `favicon-16x16.png` / `favicon-32x32.png` / `favicon-48x48.png`：各表示サイズ用
- `mstile-150x150.png`：Windowsタイル用

画像を差し替える場合は、同じファイル名のまま `public/` 内で上書きしてください。`index.html` と `site.webmanifest` はこれらの名前を参照しています。
