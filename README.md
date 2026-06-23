# kakidas

> v0.5.5 — スマホの入力フォームを通常フローへ戻し、前面に残って操作を塞ぐ問題を修正



## v0.5.5｜スマホ入力フォームの前面レイヤー修正

- スマホの `.entry-composer` を常時 `position: fixed` で表示する設計を廃止
- 入力フォームを通常の文書フロー内に戻し、メモ一覧・タブ・コピー・削除ボタンへのタップを遮らないよう修正
- Paragraph入力欄は長くなっても画面全体を覆わず、欄内だけをスクロール
- 旧版のCSSが再び固定配置を指定しても、モバイル幅では固定化されない安全弁を追加


## v0.5.4｜スマホの操作シート復旧

- Word / Sentenceのモバイル操作シートを、画面本体から切り離して安全に表示
- タブ切替、画面遷移、ブラウザの戻る操作、画面の非表示、PC幅への変更時に必ず閉じる
- オーバーレイのスクロール停止をトークン方式で管理し、見えていない前面レイヤーが残って通常操作を塞ぐ状態を防止
- 誤って開かないよう、長押しでは操作シートを開かず、明示的な `⋯` タップでのみ開く
- シート下部に大きな「閉じる」ボタンを追加
- アプリ起動時とメモ画面を離れる時に、残ったスクロール停止を安全に解除


## v0.5.3｜モバイルのクラウド取り込み復帰

- クラウド取り込みが成功したら、クラウド一覧と確認画面をまとめて閉じ、通常の操作画面へ戻る
- 同IDのメモを複製して取り込んだ場合も、取り込み後に前面の確認ダイアログが残らない
- 取り込み確認画面へ明示的な閉じるボタンを追加
- モバイルでタブを切り替えた後、非表示のWord / Sentence操作シートが前面へ残らないように修正

## v0.4.2｜区分ごとの一括削除

- Word / Sentence / Paragraphの見出し右側に「すべて削除」を追加
- 削除前に件数を表示して確認
- Word / Sentenceは、親子関係も含めてその区分だけ削除
- 削除後はローカル保存とクラウド送信状態を更新


## v0.4.1の更新

- スマホの固定入力欄に、Enter以外で確定できる `置く` ボタンを追加
- 全項目に、個別コピーと直接削除の操作を追加
- PCはホバー／フォーカス時に操作を強調、スマホは常時タップ可能な大きさで表示
- Word / Sentenceの操作シートにも、個別コピーを追加

Word / Sentence / Paragraphの3つの入口から、整える前に考えを外へ置くためのWebアプリです。

## この版の保存方針

**ローカルファースト**です。

- すべてのメモは、まずこの端末のブラウザ（IndexedDB）へ自動保存される
- ログインしても、既存メモや入力中の内容が自動でクラウド送信されることはない
- ユーザーがメモ一覧または編集画面で選び、確認して送ったメモだけがSupabaseへ保存される
- ローカル側のメモは、送信後も残る
- クラウドから別端末へ取り込む場合も、勝手な上書きは行わない
- 同じメモが両方で更新されている場合は、クラウド版を複製して残す

## 主な機能

- メモはIndexedDBに自動保存
- メモ単位で作成・編集・削除
- Word / Sentence / Paragraphは完全に独立
- Word / SentenceはEnterまたは「置く」ボタンで確定
- ParagraphはEnterまたは「置く」ボタンで確定、Shift + Enterで改行
- スマホでは画面下の「置く」ボタンで、Enterを使わずに確定できる
- 日本語IME変換中のEnterで誤保存しない
- Word / Sentenceは親子関係を持つアウトライン（`entries.parent_id`）
- PCでは `Tab` / `Shift + Tab`、`Ctrl / ⌘ + Shift + 矢印` で階層・並び替え
- モバイルでは、項目右側の `⋯` タップで下から操作シートを開く
- 各項目の右側から、個別コピー・削除を直接実行できる
- 階層項目のモバイル操作シートにも「この項目をコピー」を追加
- JSONのバックアップ・復元
- Markdown形式でコピー、`.txt`書き出し
- Googleログイン（Supabase Auth）
- 選んだメモだけをクラウドへ送る明示アップロード
- クラウド状態の表示と状態ごとの操作
  - ローカルのみ → クラウドへ送る
  - クラウド保存済み → 操作不要
  - ローカルで更新あり → クラウドへ送る
  - クラウドが新しい → 更新を取り込む
  - 更新が競合 → クラウド版を複製して取り込む
  - 送信エラー → クラウドへ再送する
- クラウドのメモ一覧と、この端末への取り込み
- 親子階層・並び順・Word / Sentence / Paragraph種別を保った復元

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
- 競合の自動解決（現在は安全な複製取り込み）
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

## v0.4.3（モバイル作成・削除の安定化）

- 新規メモ作成後、Wordタブの入力欄へ一度だけ自動フォーカス
- 連打によるメモの二重作成を防止
- 子を持たない項目は即時削除し、5.5秒間の「元に戻す」トーストを表示
- 子を持つ親を削除するときだけ、子項目数を明示した確認ダイアログを表示
- Undoは親子構造と並び順を保ったまま復元


## v0.5.0｜クラウド一覧・取り込み

- クラウド画面を「アカウント」「クラウドのメモ」の2タブに分割
- クラウド一覧にタイトル、最終更新日時、Word / Sentence / Paragraph件数を表示
- ローカルにないメモは、そのままこの端末へ取り込み
- 同じIDのローカルメモがある場合は、ローカルを残すかクラウド版を複製して取り込むかを選択


## v0.5.3｜クラウド取り込み後のスクロール復旧

- クラウド画面と「クラウド版を複製して取り込む」確認画面が重なった際の、スクロールロック解除順を修正
- ネストしたダイアログを閉じても、`body` / `html` に `overflow: hidden` が残らないよう参照カウント式のロックへ変更
- クラウド画面のパネル自体は、スマホでも縦スクロールできるよう `touch-action` と慣性スクロールを明示


## v0.5.1｜更新判定・状態別アクション

`memo_sync_meta` に以下を保存する。

```text
cloud_state
last_uploaded_at
last_downloaded_at
last_cloud_updated_at
```

- ログイン済みでメモ一覧を開くと、クラウド側の最終更新日時とローカルの更新日時を照合
- ローカルだけが更新されている場合は「ローカルで更新あり」
- クラウドだけが更新されている場合は「クラウドが新しい」
- 両方が更新されている場合は「更新が競合」
- 「更新を取り込む」は、ローカルに未送信の変更がない場合だけクラウド内容で置き換える
- 競合時は上書きせず、クラウド版を別メモとして複製する
- 送信は従来どおりSupabaseのupsertを使い、同じIDがあれば更新、なければ追加する

v0.5.1のためにSupabaseテーブルへ列を追加する必要はない。既存のIndexedDBは、アプリを開いた時点でローカルの同期メタを自動補完する。
