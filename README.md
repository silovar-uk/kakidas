# kakidas

> v0.4.0 — Phase 1: Googleログイン / Phase 2: 選んだメモだけクラウドへ送る

Word / Sentence / Paragraphの3つの入口から、整える前に考えを外へ置くためのWebアプリです。

## この版の保存方針

**ローカルファースト**です。

- すべてのメモは、まずこの端末のブラウザ（IndexedDB）へ自動保存される
- ログインしても、既存メモや入力中の内容が自動でクラウド送信されることはない
- ユーザーがメモ一覧または編集画面で選び、確認して送ったメモだけがSupabaseへ保存される
- ローカル側のメモは、送信後も残る
- この版は「送る」まで。クラウドから別端末へ「取り込む」はPhase 3で追加予定

## 主な機能

- メモはIndexedDBに自動保存
- メモ単位で作成・編集・削除
- Word / Sentence / Paragraphは完全に独立
- Word / SentenceはEnterで確定
- ParagraphはEnterで確定、Shift + Enterで改行
- 日本語IME変換中のEnterで誤保存しない
- Word / Sentenceは親子関係を持つアウトライン（`entries.parent_id`）
- PCでは `Tab` / `Shift + Tab`、`Ctrl / ⌘ + Shift + 矢印` で階層・並び替え
- モバイルでは、項目を長押しまたは `⋯` タップで下から操作シートを開く
- JSONのバックアップ・復元
- Markdown形式でコピー、`.txt`書き出し
- Googleログイン（Supabase Auth）
- 選んだメモだけをクラウドへ送る明示アップロード
- クラウド状態の表示
  - ローカルのみ
  - クラウド保存済み
  - ローカルで更新あり
  - 送信エラー

## 動かし方

Node.js 22系を用意する。

```bash
npm install
npm run dev
```

表示されたURLをブラウザで開く。

本番ビルド確認:

```bash
npm run build
npm run preview
```

## Supabaseの設定

クラウド機能を使わない場合、この章は不要です。環境変数が未設定でも、ローカル保存アプリとして動きます。

### 1. Supabaseプロジェクトを作る

Supabaseで新規プロジェクトを作成する。

### 2. テーブルとRLSを作る

Supabase Dashboardの `SQL Editor` を開き、以下のファイル内容をそのまま実行する。

```text
supabase/schema.sql
```

このSQLは `memos` / `entries` テーブルを作り、RLSを有効化する。ログイン中のユーザーは、自分の `user_id` の行だけを読み書きできる。

### 3. Googleログインを有効にする

Supabase Dashboardで以下を行う。

1. `Authentication` → `Providers` → `Google` を開く
2. Google providerを有効にする
3. Google Cloud ConsoleでWeb application用のOAuth Client IDを作成する
4. Google Cloud Consoleの `Authorized JavaScript origins` に以下を追加する

```text
http://localhost:5173
https://あなたのVercelドメイン
```

5. Google Cloud Consoleの `Authorized redirect URIs` には、SupabaseのGoogle provider画面に表示されるCallback URLを追加する
6. GoogleのClient IDとClient SecretをSupabaseのGoogle provider設定へ貼り付けて保存する

### 4. Supabase AuthのURL設定

Supabase Dashboardの `Authentication` → `URL Configuration` で設定する。

```text
Site URL
https://あなたのVercelドメイン

Redirect URLs
http://localhost:5173
https://あなたのVercelドメイン
```

Preview DeploymentもGoogleログインで確認したい場合は、VercelのPreview URLパターンもRedirect URLsに追加する。

### 5. ローカル環境変数を置く

`.env.example` をコピーして `.env.local` を作成する。

```bash
cp .env.example .env.local
```

Supabase Dashboardの `Project Settings` → `API` から以下を入れる。

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

**service_role keyは絶対に使わない。** ブラウザに置くのはPublishable keyだけ。

### 6. Vercelの環境変数を設定する

Vercelプロジェクトの `Settings` → `Environment Variables` に、次の2つを追加する。

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

`Production` と `Preview` と `Development` のうち、使いたい環境へチェックを入れる。追加後はRedeployする。

## クラウドへ送る操作

### メモ一覧から複数送る

1. 右上の `クラウド` からGoogleでログイン
2. `クラウドへ送る` を押す
3. 送信したいメモだけを選択
4. `○件を確認` を押す
5. 件数・内容を確認して `○件を送る`

### 編集画面から1件送る

1. メモ右上の `クラウドへ送る` を押す
2. 未ログインならログイン画面が開く
3. 内容を確認して送る

## データ構造

### ローカル（IndexedDB）

- `memos`
- `entries`
- `memo_sync_meta`

`memo_sync_meta` はローカル限定の送信状態を持つ。本文データと分けることで、送信失敗やログアウトがメモ本文へ影響しないようにしている。

### クラウド（Supabase）

- `public.memos`
- `public.entries`

ローカルとクラウドで同じUUIDを使う。Phase 3で取り込み機能を足す時も、同じメモかどうかを判定できる。

## 現時点でやらないこと

- 入力ごとの自動クラウド同期
- 全メモの自動送信
- 複数端末でのリアルタイム共同編集
- クラウドからの取り込み
- 競合の自動解決
- 共有リンク

書く体験を止めず、データが勝手に移動しないことを優先している。

## Vercelデプロイ

### GitHub経由

1. このプロジェクトをGitHubリポジトリへpushする
2. Vercelで `Add New...` → `Project`
3. GitHubリポジトリをImportする
4. Framework Presetは `Vite`
5. Build Commandは `npm run build`、Output Directoryは `dist`
6. `Deploy`
7. Supabaseを使う場合は、環境変数を追加してRedeployする

`vercel.json` は、`/memos/:memoId` をブラウザで直接開いた時もSPAとして表示するためのrewrites設定です。

## アイコン

`public/` には、ブラウザタブ・ブックマーク・ホーム画面追加用のアイコンを置いています。

- `favicon.ico`：ブラウザタブ、ブックマークなど
- `apple-touch-icon.png`：iPhone / iPadのホーム画面追加
- `android-chrome-192x192.png` / `android-chrome-512x512.png`：Android / PWA用

画像を差し替える場合は、同じファイル名のまま `public/` 内で上書きしてください。
