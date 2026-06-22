# kakidas

> v0.3.0 — mobile outline interaction update

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
- Word / Sentenceは親子関係を持つアウトライン（`entries.parent_id`）
- PCでは `Tab` / `Shift + Tab`、`Ctrl / ⌘ + Shift + 矢印` で階層・並び替え
- モバイルでは、項目を**長押し**または `⋯` タップで下から操作シートを開く
- モバイルの操作シートから、子の追加・上下移動・階層変更・削除を片手で操作
- モバイルでは入力欄を画面下部に固定。子追加中は「○○の下に追加」を表示

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


## モバイルでの使い方

- **タップ**：項目を編集
- **長押し / `⋯`**：下から操作シートを開く
- **この項目の子を追加**：入力欄が親指定モードへ切り替わり、そのまま子項目を書く
- **上へ移動 / 下へ移動**：同じ階層の中で順番を変える
- **ひとつ戻す / 子にする**：階層を浅く・深くする
- **入力欄は画面下部に固定**：書くことを止めず、スクロール中でもすぐ追加できる

連続ドラッグで階層まで動かす操作は、誤操作と実装上の不安定さが出やすいため、現時点では入れていません。代わりに、長押しから大きい操作ボタンで確実に動かす設計です。

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
- `entries`: `id`, `memo_id`, `user_id`, `kind`, `parent_id`, `content`, `sort_order`, `created_at`, `updated_at`, `deleted_at`

`deleted_at` は、端末間同期時に削除を同期するためのソフトデリート用カラムです。

### 2. Repositoryだけを置き換える

`src/repositories/memoRepository.ts` の `MemoRepository` interfaceを実装する `SupabaseMemoRepository` を作る。

UIとHookは `memoRepository` のinterfaceしか参照していないため、画面コンポーネントを変更せずに同期実装へ差し替えられる。

### 3. ローカルデータを移行する

既存ユーザーは、現行版で `JSONを書き出す` を実行し、同期版でそのJSONをImportする導線を用意する。

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
