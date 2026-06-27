# kakidas 引き継ぎ書

- **基準バージョン**：v0.5.40
- **最終確認対象**：`kakidas_tree.txt` に記録された現行構造
- **用途**：次の実装担当者・運用担当者が、設計意図と壊してはいけない境界を理解した上で改修できるようにする。

---

## 1. このアプリは何か

kakidasは、考えを「単語」「文」「段落」の粒度で、整える前に外へ置くためのメモアプリである。

目的は、情報を厳密に管理することよりも、**書き始める負荷を下げ、あとから思考を育てられる状態を残すこと**にある。画面は本文を主役にし、日時・番号・満足度・備考・リンク・完了などの補助情報は、必要な時だけ見えるようにする。

### 守るべき設計原則

1. **ローカルファースト**
   - 書いた内容は、まず端末ブラウザのIndexedDBへ保存する。
   - ログインしても自動でクラウド送信しない。
   - クラウドは「ユーザーが選んで送る」保管・移動先であり、ローカル作業を支配しない。

2. **本文優先、補助情報は静かに**
   - 本文を読んだり書いたりする流れを、操作ボタンやラベルで塞がない。
   - 備考が空なら余白も出さない。
   - 満足度は本文やコピー出力に混ぜない。
   - 番号、日時、並び順、完了の非表示などは、主に端末ごとの表示設定である。

3. **データ本体・派生表示・個人設定を混ぜない**
   - 本体データ：メモ本文、項目、親子関係、備考、リンク、満足度、完了状態。
   - 派生表示：振り番、階層深度、件数、表示上の並び。
   - 個人設定：日時表示、番号表示、本文だけ表示、完了非表示、追加位置、コピー設定、並び順。
   - 派生表示や個人設定を、安易にIndexedDBやSupabaseのカラムへ追加しない。

4. **モバイルは縮小版PCではない**
   - iPhone Safariで、入力・削除・コピー・モーダル操作が実際にできることを優先する。
   - 画面を覆う固定レイヤーや、閉じ残ったオーバーレイに特に注意する。

5. **履歴と安全性を雑に捨てない**
   - 既存データを破壊するスキーマ変更や、クラウドからの無条件上書きは避ける。
   - 競合時は、基本的にクラウド版を複製して残す。

---

## 2. 技術構成と起動方法

| 項目 | 内容 |
|---|---|
| UI | React 19 + TypeScript |
| ビルド | Vite 8 |
| 画面遷移 | React Router |
| ローカル保存 | IndexedDB |
| クラウド | Supabase（任意設定） |
| ログイン | Supabase Auth / Google OAuth |
| デプロイ | Vercel想定 |
| Node.js | 22.x |

### よく使うコマンド

```bash
npm ci
npm run dev
npm run build
npm run preview
```

`npm run build` は `tsc -b && vite build`。現行の`package.json`にはテスト用スクリプトがないため、改修時の最低条件は **型チェックを含むbuild成功** と **実機確認** である。

### 環境変数

`.env` には以下だけを置く。

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

- `service_role` keyは絶対にクライアントへ置かない。
- Supabase AuthではGoogleプロバイダを有効化する。
- Supabase AuthのRedirect URLsには、Vercelの本番URLと必要ならローカル開発URLを登録する。アプリは `window.location.origin` へ戻る設計。
- 環境変数がなくても、ローカル保存・閲覧・編集は動く。クラウド関連だけが未設定扱いになる。

### Vercel

`vercel.json` はSPA用のrewriteを設定している。`/memos/:memoId` を直接開いても `index.html` へ戻すため、ここは消さない。

---

## 3. 現行フォルダ構成と責務

### 完全ツリー（v0.5.40・引き継ぎ資料同梱版）

以下が、この引き継ぎ書をルートへ置いた配布版の実ファイル構成である。`HANDOVER.md` 以外は、受領した最新の `kakidas_tree.txt` を踏襲している。

```text
kakidas/
├── .env.example
├── .gitignore
├── .npmrc
├── HANDOVER.md                         # この引き継ぎ書
├── index.html
├── kakidas_tree.txt
├── package-lock.json
├── package.json
├── README.md
├── RELEASE_NOTES_v0.5.5.md
├── RELEASE_NOTES_v0.5.6.md
├── RELEASE_NOTES_v0.5.7.md
├── RELEASE_NOTES_v0.5.8.md
├── RELEASE_NOTES_v0.5.9.md
├── RELEASE_NOTES_v0.5.10.md
├── RELEASE_NOTES_v0.5.11.md
├── RELEASE_NOTES_v0.5.12.md
├── RELEASE_NOTES_v0.5.13.md
├── RELEASE_NOTES_v0.5.14.md
├── RELEASE_NOTES_v0.5.15.md
├── RELEASE_NOTES_v0.5.16.md
├── RELEASE_NOTES_v0.5.17.md
├── RELEASE_NOTES_v0.5.18.md
├── RELEASE_NOTES_v0.5.19.md
├── RELEASE_NOTES_v0.5.20.md
├── RELEASE_NOTES_v0.5.21.md
├── RELEASE_NOTES_v0.5.22.md
├── RELEASE_NOTES_v0.5.23.md
├── RELEASE_NOTES_v0.5.24.md
├── RELEASE_NOTES_v0.5.25.md
├── RELEASE_NOTES_v0.5.26.md
├── RELEASE_NOTES_v0.5.27.md
├── RELEASE_NOTES_v0.5.28.md
├── RELEASE_NOTES_v0.5.29.md
├── RELEASE_NOTES_v0.5.30.md
├── RELEASE_NOTES_v0.5.31.md
├── RELEASE_NOTES_v0.5.32.md
├── RELEASE_NOTES_v0.5.33.md
├── RELEASE_NOTES_v0.5.34.md
├── RELEASE_NOTES_v0.5.35.md
├── RELEASE_NOTES_v0.5.36.md
├── RELEASE_NOTES_v0.5.37.md
├── RELEASE_NOTES_v0.5.38.md
├── RELEASE_NOTES_v0.5.39.md
├── RELEASE_NOTES_v0.5.40.md
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
├── vercel.json
├── vite.config.ts
├── public/
│   ├── android-chrome-192x192.png
│   ├── android-chrome-512x512.png
│   ├── apple-touch-icon.png
│   ├── browserconfig.xml
│   ├── favicon-16x16.png
│   ├── favicon-32x32.png
│   ├── favicon-48x48.png
│   ├── favicon-head.html
│   ├── favicon.ico
│   ├── mstile-150x150.png
│   ├── README.md
│   └── site.webmanifest
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── vite-env.d.ts
│   ├── auth/
│   │   └── AuthProvider.tsx
│   ├── components/
│   │   ├── CloudAccountDialog.tsx
│   │   ├── CloudImportDialog.tsx
│   │   ├── CloudStatusBadge.tsx
│   │   ├── CloudUploadDialog.tsx
│   │   ├── EntryColumn.tsx
│   │   ├── EntryComposer.tsx
│   │   ├── EntryItem.tsx
│   │   ├── EntrySatisfactionControl.tsx
│   │   ├── MemoDeleteDialog.tsx
│   │   ├── NoticeToast.tsx
│   │   ├── MobileEntryActionSheet.tsx
│   │   └── UndoToast.tsx
│   ├── hooks/
│   │   ├── useCloudMemos.ts
│   │   └── useMemos.ts
│   ├── lib/
│   │   ├── bodyScrollLock.ts
│   │   ├── clipboard.ts
│   │   ├── copyPreferences.ts
│   │   ├── db.ts
│   │   ├── formatDate.ts
│   │   ├── memoText.ts
│   │   └── supabase.ts
│   ├── pages/
│   │   ├── MemoEditorPage.tsx
│   │   └── MemoListPage.tsx
│   ├── repositories/
│   │   ├── cloudMemoRepository.ts
│   │   └── memoRepository.ts
│   └── types/
│       └── memo.ts
└── supabase/
    ├── MIGRATE_v0.5.11.sql
    ├── MIGRATE_v0.5.13.sql
    ├── MIGRATE_v0.5.14.sql
    ├── MIGRATE_v0.5.31.sql
    └── schema.sql
```

```text
public/                 アプリ・ホーム画面用アイコン、manifest、Windows tile設定
src/
  App.tsx               RouterとAuthProviderの組み立て
  main.tsx              起動時のスクロールロック解除、IndexedDB接続の解放処理
  styles.css            アプリ全体のスタイル。モバイル上書きもここに集約
  auth/
    AuthProvider.tsx    Supabase Auth、Googleログイン、ログアウト、ユーザー状態
  components/
    Entry*.tsx          単語・文・段落の入力、表示、操作、満足度、モバイル操作シート
    MemoDeleteDialog.tsx 一覧からのメモ削除確認
    NoticeToast.tsx     成功通知の5秒自動消去・手動消去
    Cloud*.tsx          アカウント、送信、取り込み、同期状態表示
    UndoToast.tsx       項目削除のUndo表示
  hooks/
    useMemos.ts         一覧・詳細画面の非同期状態とRepository接続
    useCloudMemos.ts    クラウド一覧、取り込み、クラウド削除のUI用窓口
  lib/
    db.ts               IndexedDB接続、スキーマ、複数タブ対策
    bodyScrollLock.ts   モーダル・シート用スクロールロック
    clipboard.ts        iOS Safari向けフォールバックを含むコピー処理
    copyPreferences.ts  端末ごとのコピー・並び順設定
    formatDate.ts       項目作成日時の表示
    memoText.ts         コピー・.txt出力の整形
    supabase.ts         Supabaseクライアント生成
  pages/
    MemoListPage.tsx    一覧、新規作成、バックアップ、クラウド操作、一覧削除
    MemoEditorPage.tsx  編集、表示設定、項目操作、タイトル、編集画面削除
  repositories/
    memoRepository.ts       IndexedDBの実データ操作
    cloudMemoRepository.ts  Supabase送受信と同期状態判定
  types/
    memo.ts              データ型、正規化、階層生成、表示ラベル
supabase/
  schema.sql             新規Supabaseプロジェクト向けの全体定義
  MIGRATE_*.sql          既存Supabaseプロジェクト向けの追加カラム移行
RELEASE_NOTES_*.md       各バージョンの変更履歴
```

### まず読む順番

1. `README.md`：アプリの目的とローカルファースト方針
2. `RELEASE_NOTES_v0.5.34.md`〜`v0.5.40.md`：直近の事故対応と意図
3. `src/types/memo.ts`：データ構造と正規化ルール
4. `src/repositories/memoRepository.ts`：ローカル保存の実体
5. `src/repositories/cloudMemoRepository.ts`：クラウド同期の境界
6. `src/pages/MemoListPage.tsx` / `MemoEditorPage.tsx`：ユーザー操作の入口
7. `src/lib/db.ts` / `bodyScrollLock.ts`：Safari対策

> `README.md` はv0.5.32までの説明が中心で、v0.5.33〜v0.5.40の内容を十分に反映していない。最新の挙動は、該当するリリースノートと実装を正とする。

---

## 4. データ保存の仕組み

### 4-1. IndexedDB

データベース名は `kakidasu-db`、現行バージョンは `9`。

| Store | 内容 |
|---|---|
| `memos` | メモ本体。タイトル、作成・更新・削除日時 |
| `entries` | 単語・文・段落の項目。親子関係、本文、備考、リンク、満足度、完了状態、並び順 |
| `memo_sync_meta` | 本文とは切り離したクラウド送信状態 |

### 4-2. データの要点

- `entries.parent_id` により、単語と文だけが階層を持つ。段落は階層化しない。
- `sort_order` は保存する。画面上の「追加順・評価順」の切替は、保存値を書き換えず表示順だけを変える。
- `outline_number`、`depth`、`child_count` は表示用の派生値で、保存しない。
- 旧データに `parent_id` / `note` / `link_url` / `satisfaction` / `is_completed` がなくても、`normalizeEntryRow` が読込時に補完する。
- ローカルのメモ・項目削除は、`deleted_at` を付けるソフト削除。メモ一覧には出なくなる。
- メモ削除時は同じメモの項目もソフト削除し、`memo_sync_meta` は削除する。

### 4-3. バックアップ

- 一覧画面からJSONバックアップを書き出す。
- バックアップ形式の現行バージョンは `5`。
- 取り込みは `updated_at` を比較して、新しい方を残すupsert方式。
- 削除後に戻すためのUIはメモ単位では用意していない。削除前にバックアップを取る前提で案内する。

---

## 5. クラウド同期の仕組み

### 基本方針

- クラウド保存は明示操作のみ。自動アップロードしない。
- ローカルの本文を、クラウド操作が勝手に変更しない。
- 競合時に黙って上書きしない。

### 同期状態

| 状態 | 意味 | 基本操作 |
|---|---|---|
| `local_only` | まだクラウドへ送っていない | クラウドへ送る |
| `uploaded` | 送信時点では一致 | 操作不要 |
| `changed_after_upload` | この端末でその後更新した | クラウドへ送る |
| `remote_newer` | クラウド側が新しい | 更新を取り込む |
| `conflict` | ローカルとクラウドの両方が更新された | クラウド版を複製して取り込む |
| `error` | 送信エラー | エラー確認後に再送 |

### 取り込みルール

- 同じIDのローカルメモがなければ、通常取り込み。
- クラウドが新しく、ローカルが未更新なら、更新取り込みでクラウドの内容へ揃える。
- ローカルも更新済み・または競合中なら、クラウド版を別メモとして複製する。
- 複製したメモは `（クラウド版）` を付け、新しいメモIDを採番する。ただし項目の`created_at`は元の記録を保持する。

### 削除の区別

- **一覧の `×` / 編集画面の削除**：この端末のIndexedDBから削除する。クラウドへ送った同IDのメモは自動で消さない。
- **クラウドアカウント画面の削除**：クラウド上だけを削除する。端末のローカルメモは残る。

この二つを混同しない。クラウド連動で削除を自動反映する仕様は、今はない。

---

## 6. 画面と主要機能

### メモ一覧：`MemoListPage.tsx`

- 新規メモ作成
- 一覧からメモを開く
- 一覧コピー
- JSONバックアップの書き出し・取り込み
- 複数メモを選んでクラウド送信
- クラウド状態の表示・更新・競合時の複製取り込み
- 一覧からのローカル削除

#### v0.5.40の一覧プレビュー

- 一覧カードは、タイトルの下に単語・文・段落の抜粋を最大1件ずつ淡く表示する。
- 未完了項目を優先し、未完了がない場合だけ完了済み項目を表示する。
- 抜粋は表示専用で、DB・バックアップ・クラウドのデータ項目ではない。
- 一覧で既に行っているコピー用の詳細先読みを利用する。リスト取得APIやSupabase schemaを増やさない。

#### v0.5.39の並び替え操作

- `右へ下げる` / `左へ戻す` と、それに紐づくTab・左右矢印の階層移動は廃止。
- 既存の親子構造は保持する。新しく子を作る場合は `＋ 下に追加` を使う。
- 並び替えは同じ階層・同じ完了状態の中で行う。`上へ` / `下へ` はメニューを閉じず、連続実行できる。
- `一番上` / `一番下` は一度だけ動かしてメニューを閉じる。
- 区分移動は、文が青系・段落が紫系。

#### v0.5.36のメモ削除

一覧の`×`は、`MemoDeleteDialog.tsx` を開く。

- `window.confirm()` を使わない。
- `event.preventDefault()` と `event.stopPropagation()` で、カードを開くリンクとは明確に切り離す。
- `×`のサイズ・配置は変えていない。
- 確定すると、その端末のメモと項目をソフト削除する。

### 一時通知：`NoticeToast.tsx`

保存・コピー・削除・取り込みなどの成功通知は、`NoticeToast.tsx` を通す。

- 表示から5秒で自動消去する。
- 右側の`×`で手動消去できる。
- メモ一覧、編集画面、クラウドライブラリで共用する。
- エラーや確認ダイアログには使わず、必要な操作が済むまで残す。

### 編集画面：`MemoEditorPage.tsx`

- メモタイトル編集
- タイトルに合わせてブラウザタブ名を更新
- 単語・文・段落の追加・編集・削除
- 段落はEnterで改行。Shift＋Enter／Ctrl＋Enter、または `置く` ボタンで確定する。単語・文はEnterで確定する。
- Word / Sentenceの親子関係、子の追加・上下／一番上／一番下への並べ替え
- 満足度、完了、備考、リンク
- 項目・区分・メモ全体のコピー、`.txt`出力
- 表示・整理メニュー
- 単一メモのクラウド送信

### 端末ごとの表示設定

主に`localStorage`に保持する。クラウド同期しない。

- 項目日時表示
- 番号表示
- 完了済み非表示
- 新規項目を末尾に追加
- 本文だけ表示
- コピーに完了済みを含める
- 項目の並び順

設定を増やす時は、本文データ・バックアップ・クラウドデータへ混ぜないことをまず検討する。

---

## 7. iPhone Safari・モバイルでの重要な安全策

### 7-1. スクロールロックと前面レイヤー

`bodyScrollLock.ts` は、モーダル・ボトムシートのスクロール停止をトークンで管理する。

- 新しいモーダルを作る時は、開いた時に `lockBodyScroll()`、閉じた時に必ず解除する。
- 見えないオーバーレイが残ると、一覧・削除・コピーなどのタップを塞ぐ。
- `main.tsx` と編集画面のunmountで、残ったロックを安全に解除している。

### 7-2. 入力フォーム

モバイルの`EntryComposer`は通常の文書フローに置く。`position: fixed` の全画面入力欄へ戻さない。

### 7-3. コピー

iOS Safariでは、非同期処理の後にClipboard APIを呼ぶと権限拒否されることがある。

`clipboard.ts` は、必要に応じて一時textareaと `execCommand` にフォールバックする。コピー実装を追加する時は、この共通関数を通す。

### 7-4. 複数タブとIndexedDB

v0.5.34以降、複数タブの保存領域更新で詰まりにくくするため、以下を入れている。

- 背景タブになった時、`visibilitychange` でDB接続だけを閉じる。
- `pagehide` でも接続を閉じる。
- DB更新を別タブが待つ時、`onblocked` で即エラーにしない。
- `onversionchange` で古い接続を閉じる。
- IndexedDBアップグレード中にcursorで旧データを走査しない。

これは **DB接続・スキーマ更新の安定化** である。同じメモを複数タブで同時編集した時の、内容競合や最後に保存した内容の上書きまでは解決していない。

---

## 8. アイコン・ブラウザタブ名

### アイコン

`public/` に以下を置く。

- `favicon.ico`
- `favicon-16x16.png`
- `favicon-32x32.png`
- `favicon-48x48.png`
- `apple-touch-icon.png`
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- `mstile-150x150.png`
- `site.webmanifest`
- `browserconfig.xml`

`index.html` と `site.webmanifest` は、アイコンURLに `?v=0.5.36` を付けてキャッシュを更新しやすくしている。アイコンを差し替える時は、**画像差し替えだけで終わらせず、クエリのバージョンも更新**する。

iPhoneのホーム画面アイコンはSafari側のキャッシュが強い。反映しない場合は、ホーム画面ショートカットを削除してSafariから再追加する。

### ブラウザタブ名

- 一覧画面：`kakidas`
- 編集画面：開いているメモのタイトル
- タイトルを編集中も即時反映
- 空欄の場合：既定タイトル `M/D HH:MM 「」`

この処理は`MemoListPage.tsx` と `MemoEditorPage.tsx` に分かれている。ルーティング変更や画面追加時に、古いタイトルが残らないか確認する。

---

## 9. Supabaseスキーマと移行

### 新規Supabaseプロジェクト

`supabase/schema.sql` を実行する。`memos` と `entries`、RLS、ポリシー、インデックス、必要なカラムをまとめて作る。

### 既存Supabaseプロジェクト

以下の追加移行が存在する。

| ファイル | 内容 |
|---|---|
| `MIGRATE_v0.5.11.sql` | `entries.note` |
| `MIGRATE_v0.5.13.sql` | `entries.satisfaction` |
| `MIGRATE_v0.5.14.sql` | `entries.is_completed` |
| `MIGRATE_v0.5.31.sql` | `entries.link_url` |

現行環境では、これらは実行済み前提。追加機能でクラウドに保存するカラムを増やす時は、必ず以下を同時に確認する。

1. `types/memo.ts` の型とnormalize処理
2. `memoRepository.ts` のローカル保存・バックアップ・取り込み
3. `cloudMemoRepository.ts` の送受信payload
4. `schema.sql`
5. 既存環境向けの`MIGRATE_*.sql`
6. RLSと必要なインデックス

---

## 10. 改修時の基本手順

### UIだけの変更

1. `pages/` または `components/` を修正
2. `styles.css` のPC・モバイル双方を確認
3. `npm run build`
4. PCとiPhone Safariで確認
5. `RELEASE_NOTES_v0.5.xx.md` を追加

### データを持つ機能の追加

1. まず「これは本体データか、派生表示か、端末設定か」を決める。
2. 本体データなら `types/memo.ts` を先に変更する。
3. 旧データに対するnormalizeを追加する。
4. `memoRepository.ts` の作成・更新・取得・バックアップ・取り込みを更新する。
5. クラウド対象なら、`cloudMemoRepository.ts`、`schema.sql`、移行SQLを更新する。
6. コピーや`.txt`に含めるべきかを`memoText.ts`で判断する。
7. 既存データ、複製取り込み、競合、削除済みデータを確認する。

### モーダル・シートを追加する時

- `lockBodyScroll()` を使う。
- Escape、背景クリック、画面遷移、Strict Modeのmount/unmountを確認する。
- モバイルで見えないbackdropが残らないかを確認する。
- ネイティブの `window.confirm()` / `alert()` へ安易に戻さない。特にiPhone Safariではアプリ内ダイアログを優先する。

---

## 11. 現時点の注意点・未解決領域

1. **編集画面のメモ削除は、まだ `window.confirm()` を使っている**
   - 一覧の`×`はv0.5.36でアプリ内ダイアログへ移行済み。
   - 編集画面の「削除」もiPhone Safariで同じ問題が出る場合は、`MemoDeleteDialog` を共用する形へ統一する。

2. **同一メモの複数タブ同時編集は競合解決しない**
   - v0.5.34はDB接続の安定化であり、編集内容のマージ機能ではない。
   - 同じメモを複数タブで編集した場合、最後の保存が勝つ可能性がある。

3. **ローカル削除とクラウド削除は連動しない**
   - 安全のための仕様だが、利用者が混同しやすい。
   - UX変更を検討する時も、自動連動削除は慎重に扱う。

4. **自動テストは未整備**
   - 型・ビルドは確認できるが、Safari固有の挙動は実機確認が必要。

5. **READMEの更新遅れ**
   - v0.5.33〜v0.5.40の説明をREADMEにまだ統合していない。
   - 次の大きな更新時に、READMEを「最新の概要」に整理し、詳細はリリースノートへ寄せるのが望ましい。

---

## 12. リリース前チェックリスト

### 必須

- [ ] `npm ci` 後に `npm run build` が成功する
- [ ] 新規メモを作成し、タイトル・Word・Sentence・Paragraphを保存できる
- [ ] 備考、リンク、満足度、完了、階層、並び替えを確認する
- [ ] コピーと`.txt`出力に、設定どおりの内容が出る
- [ ] JSONバックアップの書き出し・読み込みを確認する
- [ ] 一覧の`×`から、アプリ内確認を経てローカル削除できる
- [ ] メモ編集時のブラウザタブ名がタイトルへ変わり、一覧で`kakidas`に戻る
- [ ] PCとiPhone Safariで、モーダルを閉じたあとに通常操作へ戻れる
- [ ] 2タブで開き、片方を背景へ回した後も読み書きできる

### クラウドを変更した時だけ

- [ ] 未ログイン時にローカル機能が壊れない
- [ ] Googleログイン・ログアウトが動く
- [ ] 明示送信したメモだけがSupabaseへ保存される
- [ ] `remote_newer` と `conflict` で意図しない上書きをしない
- [ ] クラウド削除でローカルメモが消えない
- [ ] 新しいカラムがあれば新規schemaと既存移行SQLの両方にある

---

## 13. 次の担当者への短い実装依頼テンプレート

```text
kakidas v0.5.40を基準に修正する。

目的：
- （ユーザーにとって何を楽にする変更か）

守ること：
- ローカルファースト。自動クラウド送信・自動上書きはしない。
- 本体データ／派生表示／端末設定を混ぜない。
- iPhone Safariで、画面を覆う残留レイヤーや標準confirm依存を避ける。
- 既存メモ、バックアップ、クラウド取り込み、複製取り込みを壊さない。
- 同じ機能のPC・モバイル両方を確認する。

変更後に行うこと：
- npm run build
- RELEASE_NOTES_v0.5.xx.md を追加
- データ構造を変える場合は schema.sql と MIGRATE_*.sql も更新
- 変更したファイルと、既知の未検証点を明記
```

---

## 14. 最後に

kakidasでは、機能を増やすこと自体よりも、**考えを置く瞬間を邪魔しないこと**が重要である。

改修時は「できることが増えたか」だけでなく、次を確認する。

- 書き始めるまでの手数は増えていないか。
- 本文より操作や説明が目立っていないか。
- 既存の記録・構造・同期データを雑に失っていないか。
- iPhone Safariで、本当に押せて、書けて、閉じられて、戻れるか。

この基準を守る限り、kakidasは単なるメモ帳ではなく、思考を安心して預けられる書く場所として拡張できる。
