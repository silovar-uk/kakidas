# 実装依頼:kakidas 守破離「飾らずに、仕立てる」(P1〜P3)

あなた(Sonnet)に、kakidasの編集画面の作り直しを最後まで任せます。P1→P2→P3の順に、段階ごとにPR・マージ・本番の受け入れ確認まで進めてください。途中で報告のために止まる必要はありません。

---

## 0. 最初に読むもの

1. `docs/shitate/PLAN.md`(何をなぜ作るか。第4章が仕様の正)
2. `docs/shitate/mock.html`(動く試作。非公開Artifact https://claude.ai/artifact/QKgvnfcwAKqrY3bkS6WAZ5 。手元ではブラウザーで開けば動きます)
3. `docs/shitate/qa.mjs`(受け入れ確認。29項目。試作ではアプリ専用の1項目を除く28/28が合格)
4. `HANDOVER.md` の第1章(守る設計原則)と第7章(iPhone Safariの安全策)
5. `C:\Users\vediv\Documents\Claude\AGENTS.md`(作業の原則。リポジトリ直下にAGENTS.mdはありません)

試作は「見た目と振る舞いの正」です。コードの構造は試作をまねず、既存の部品を活かしてください。

---

## 1. 目的と完了条件

目的: 編集画面のやぼったさを取り、書く手を止めず、メモを誇れる成果物にします。データの形(IndexedDB・Supabase・バックアップ)は変えません。

完了条件(すべて満たしたら終わり):

- P1・P2・P3がそれぞれPRとして `main` にマージされ、Vercel(`kakidas-3gqw`)の本番に反映されている
- 本番URLに対して `qa.mjs`(QA_TARGET=app)が29/29合格
- `npm run build` が成功(型チェック込み)
- README.md・RELEASE_NOTES・HANDOVER.mdが新しい仕様に合っている
- 報告(第10章)を書いている

---

## 2. 確認なしで進めてよいこと/止まって確認すること

確認なしでよいこと:

- ブランチ作成、コミット、push、PR作成、CI確認、`main` へのsquashマージ、Vercelの自動デプロイ待ち、本番URLでの受け入れ確認
- 依頼の範囲のファイルの追加・削除(使われなくなった部品やCSSファイルの削除を含む)
- `docs/shitate/` をP1のPRに含めてコミットすること

止まって確認すること:

- force push・履歴の書き換え
- Supabaseのスキーマ・データ、Vercelのプロジェクト設定・環境変数、旧 `kakidas` プロジェクトへの変更
- 費用が発生する操作
- 受け入れ確認の基準値(`LIMIT`)を緩めたくなったとき。緩める前に理由を報告する

---

## 3. 始める前に

```powershell
cd C:\Users\vediv\Documents\Claude\kakidas-repo
git switch main; git pull --ff-only
git log --oneline -3     # fad9299 より進んでいたら、差分を読んで計画との衝突を確かめる
npm ci
npm run build
```

手元での確認は、ビルドした版を配信して行います(Vercelの関数 `/api/link-preview` は手元にありませんが、台本が差し替えます)。

```powershell
npm run preview -- --host 127.0.0.1 --port 4173      # 別のターミナルで起動したままにする
$env:PW_FROM='C:\Users\vediv\repos\quicklinks'        # Playwrightがあるフォルダ(Chromium入り)
$env:QA_TARGET='app'; $env:BASE_URL='http://127.0.0.1:4173/'
node docs/shitate/qa.mjs                               # 段階を絞るなら $env:QA_PHASES='P1'
```

着手前に一度流して、現状が不合格になることを確かめてください(本番の現状は `docs/shitate/baseline-2026-10-09.txt`)。試作で台本を確かめるときは `$env:QA_TARGET='mock'` で流します。

PC表示はユーザーのChrome最大化の実寸1366×633、スマホはiPhone SEの375×667で確認します(台本も同じ)。

---

## 4. 共通の約束

### 4.1 名前の約束(台本はこの名前で探す)

| 場所 | 要素 | 約束 |
|---|---|---|
| 上の帯 | 帯 | 編集画面の最初の `<header>`。印刷では非表示 |
| | 題 | textbox「メモのタイトル」(class `memo-title-input` は維持) |
| | 清書 | button「清書にする」(P3) |
| | 余白 | button「余白を開く」 |
| | メモの操作 | button「メモの操作」→ `role="menu"`。menuitem「クラウドに保存」「クラウドに合わせる」「ChatGPTで続きを考える」「メモをコピー」「.txtで書き出す」「ショートカット」「完了をまとめて削除」「メモを削除」、並び順は menuitemradio×3、表示設定は menuitemcheckbox |
| 書き口 | 領域 | `<section aria-label="書き口" class="entry-composer entry-composer--desk">` |
| | 本文 | textarea「書く」(class `entry-composer__textarea`) |
| | 段落タイトル | input「段落タイトル」(class `entry-composer__paragraph-title`) |
| | 置き先 | `role="radiogroup"`「置き先」の中に `role="radio"`「参考URL」「文」「段落」(`aria-checked`) |
| | 置く | button「置く」(class `entry-composer__submit`) |
| | 参考URLの備考 | input「参考URLの備考」 |
| 列 | 領域 | 今の `section aria-labelledby` → h2「参考URL」「文」「段落」を維持 |
| | 畳む | button「{列名}を折りたたむ」(今のまま) |
| | 列の操作 | button「{列名}の操作」→ menuitemcheckbox「タグでまとめる」「順番固定」(まとめている時だけ)、menuitem「{列名}をコピー」「畳む」「{列名}をすべて削除」 |
| 行 | 行 | class `entry-item`(維持)、`data-entry-id` 属性を持つ |
| | 操作のまとまり | `.entry-item__quick-actions` に `data-entry-actions` 属性 |
| | その他・スマホの入口 | button「この項目の操作」 |
| 操作シート(スマホ) | 満足度 | `role="group"`「満足度」の中に button「0」〜「5」(`aria-pressed`) |
| | 主な操作 | menuitem または button「完了にする」(完了済みは「未完了に戻す」)「気持ち・備考を書く」「リンクを付ける」「タグを変える」 |
| スマホのタブ | | `role="tab"`、名前が「参考URL」「文」「段落」で始まる(今のまま) |
| 余白 | 入力 | textarea「余白に書く」、閉じるは button「余白を閉じる」、Escでも閉じる |
| 清書 | 紙 | `<article aria-label="清書">`、h1(題)、h2「要点」「本文」「参考」、印 `aria-label="落款"` |
| | 操作 | button「書き口へ戻る」「書式つきでコピー」「印刷・PDF」 |

### 4.2 書き方

- 新しい見た目は `src/styles-tokens.css`(P1で新設、`main.tsx` で最初に読み込む)のトークンだけで書きます。色の直書き、新しい `!important`、新しい `styles-*.css` の追加はしません(例外はトークンのファイルと、P1で作る `src/styles-shitate.css` の1本だけ)。
- 既存の上書きCSSのうち、作り直しで使われなくなったものは削除します。削除は追加より優先です。
- 記号の文字(☁ ↧ ⌨ ⧉ ⋯ ‹ › ⌄ ⌃ ✎)をアイコンとして使わず、`src/components/icons.tsx` の線画(stroke 1.7、24の正方形)に置き換えます。
- コードコメントとコミットの要約は日本語にします。PRの本文の最後に `🤖 Generated with [Claude Code](https://claude.com/claude-code)` を付けます。
- iPhone Safariの安全策(HANDOVER第7章: スクロールのロック解除、16px以上の入力欄、前面レイヤーの閉じ残し)を崩さないでください。

---

## 5. P1 守「飾らない」(ブランチ `shitate-p1`、v0.5.77)

### 5.1 入力を止めない(`EntryComposer.tsx`・`MemoEditorPage.tsx`・`EntryColumn.tsx`)

1. 入力欄の `disabled` から `isSubmitting` を外します(`commonProps.disabled` と補助入力)。送信ボタンは「空なら押せない」だけにします。
2. `handleSubmit` の `isSubmitting` による早期returnを外します。送信の瞬間に、本文・段落タイトル・気持ち・リンク・タグの値を取り出し、**同期で**入力欄を空にしてから `onSubmit` を待ちます。
3. `onSubmit` が失敗したら、入力欄が空なら取り出した値を戻します。空でなければ、本文の末尾に改行して足し、エラーを出します。書いた字は決して捨てません。
4. 作成のトランザクションはDraftを消します。`onSubmit` の完了後、入力欄に続きがあれば `useDraftPersistence` の `markEdited` と `flush` で下書きを保存し直します(`markCommitted` の意味を読んでから使い分けてください)。
5. `MemoEditorPage` は `EntryColumn` に `disabled={isSaving || isUploading}` を渡しています。入力欄には `isUploading` だけを効かせ、`isSaving` は「すべて削除」など破壊的な操作だけに残します。
6. `isSubmitting` が不要になれば消します。

確認: P1-1(続けて4文)・P1-2(disabledにしない)。

### 5.2 行の操作は触れたときだけ(`EntryItem.tsx`・`styles-shitate.css`)

1. `.entry-item__quick-actions` に `data-entry-actions` を付けます。中の順番(満足度・完了・気持ち・リンク・タグ・その他)は変えません。その他のボタンの名前は「この項目の操作」にします。
2. PC(`(hover: hover) and (pointer: fine) and (min-width: 921px)`)では、まとまりを `opacity: 0; pointer-events: none` にし、`.entry-item:hover`・`.entry-item:focus-within`・まとまりの中にポップオーバーが開いている間(`:has([aria-expanded="true"])`)・行の編集中だけ表示します。`visibility: hidden` は使いません(キーボードで入れなくなる)。
3. 表示・非表示で行の高さや本文の幅が変わらないようにします。推奨は試作と同じく、行の右上に重ねて背景を左へぼかす形です。
4. 入力済みの気持ち・タグ・リンクは行の中に常に見せます(リンクはホスト名を小さく、押すと開く)。満足度は今の地色の段階を残し、色はトークン(`--sat-1`〜`--sat-5`)にします。
5. タッチ端末(`hover: none`)のPC幅(iPadなど)では、まとまりを常に表示します。

確認: P1-3。

### 5.3 スマホの行は「⋯」ひとつ(`EntryItem.tsx`・`EntryColumn.tsx`・`MobileEntryActionSheet.tsx`)

1. 920px以下では、まとまりのうち「この項目の操作」だけを見せます(押せる面は40px以上)。満足度が1以上なら、行の右下に数字を小さく出します。
2. `MobileEntryActionSheet` の先頭に、満足度(`role="group"`「満足度」、0〜5のボタン)・「完了にする/未完了に戻す」・「気持ち・備考を書く」・「リンクを付ける」(リンクがあれば「リンクを編集」)・「タグを変える」を足します。今ある移動・コピー・新しいメモ・削除はその下に残します。
3. 満足度は、シートから `onUpdate(entryId, { satisfaction })` を直接呼びます。気持ち・リンク・タグは、`EntryColumn` が「この行のこの編集を開いて」という要求(例: `{ entryId, target: "note" | "link" | "tag" }`)を状態に持ち、`EntryItem` が受け取って既存の `beginNoteEdit`・`beginLinkEdit`・タグの入力を開き、済んだら要求を消します。段落はスマホで専用編集シート(`MobileParagraphEditorSheet`)に入る既存の流れを使います。
4. スマホ単語の3列×2段の操作面(`styles-mobile-word-compact.css`・`styles-mobile-word-single-row.css`)は、参考URL化で前提が変わりました。不要になった規則を消し、ファイルごと不要なら削除します。

確認: P1-7・P1-8。

### 5.4 色・書体・アイコンの体系(`styles-tokens.css`・全CSS・`icons.tsx`)

1. `src/styles-tokens.css` を付録Cのとおりに作り、`main.tsx` で `styles.css` より前に読み込みます。
2. `:root` の書体を `var(--font-sans)` にし、`body` に `text-autospace: normal` を足します。`memo-title-input`・段落タイトル・見出しには `font-feature-settings: "palt"` を当てます。入力欄の本文には当てません(Blinkで括弧が重なる)。
3. `src/*.css` の色の直書きを、付録Bの規則でトークンへ置き換えます。一度だけ使うNodeの置換スクリプトを書いて流し、スクリプトはコミットしません。置き換えた後、危険(赤)・満足度・クラウドの状態の色を目で確かめます。
4. 影は `--shadow-1`・`--shadow-2`、角丸は `--radius-s`・`--radius-m`・`--radius-pill`、z-indexは付録Cの名前付きの層へ寄せます。
5. `src/components/icons.tsx` を作り、`EntryItem`・`EntryComposer` などに重複しているTag・Note・Linkのアイコンをまとめます。記号の文字を使っているボタンを線画アイコンに置き換えます。
6. 一覧(`/`)とタグ管理(`/tags`)も、同じトークンと書体で表示されることを確かめます(構造は変えません)。

確認: P1-4(色は26色まで)・P1-5(書体)。

### 5.5 スマホでキー表示を出さない(`TemporaryMemoDock.tsx`)

一時メモの「Alt+Q」などの表示を、`(hover: none)` では出しません。

確認: P1-6。

### 5.6 仕上げ

- `package.json` を0.5.77へ。README.mdの先頭に「## v0.5.77｜飾らない(守)」の節、`RELEASE_NOTES_v0.5.77.md` を追加します(書き方は既存の節に合わせる)。
- HANDOVER.mdの第1章の原則のうち、「PCでは気持ちのペンとリンクを完了の右側へまとめる」と「スマホ単語の3列×2段」を、新しい仕様に書き換えます。
- `QA_PHASES=P1` が全部合格したらPRを作ります(第8章)。

---

## 6. P2 破「迷わない」(ブランチ `shitate-p2`、v0.5.78)

### 6.1 上の帯を一本に(`MemoEditorPage.tsx`・新規 `MemoActionsMenu.tsx`)

1. 帯は `<header>` ひとつに、戻る・題(とメモのタグの小さなチップ)・保存状態・(P3で清書)・「余白を開く」・「メモの操作」を並べます。今の `editor-title-row` の並び順と削除、`editor-utility-menu`(表示・整理)の区画はなくします。
2. 「メモの操作」は、PCでは帯の下に開くポップオーバー、920px以下では下からのシートです。中身は4.1の表のとおりで、試作の並び(タグ・クラウド・渡す/出す・並び順・表示・ショートカット・削除)に合わせます。Escで閉じ、閉じたら「メモの操作」ボタンへフォーカスを戻します。
3. 帯へ外から差し込んでいた部品を、メニューの項目として作り直します。
   - `CloudUploadHeaderButton.tsx` の「保存」「クラウドに合わせる」の処理を、フック(例: `useCloudMemoActions`)へ移します。部品と `styles-cloud-upload-header.css` は削除し、`App.tsx` から外します。
   - `ChatGptMemoButton.tsx` の処理を関数へ移し、「ChatGPTで続きを考える」から呼びます。部品は削除します。新しいウィンドウを先に開いてから非同期で中身を入れる今の手順(ポップアップブロック対策)は残します。
   - `KeyboardShortcuts.tsx` からは、帯への差し込み・並び順と削除の橋渡し(`EDITOR_*` のセレクター、`editor-page--header-actions-bridged`)を消します。キー操作と説明ダイアログは残し、「ショートカット」項目から開けるようにします(例: `window` のカスタムイベント)。Alt+1/2/3は6.2で書き口へ移します。
   - Supabaseが未設定の手元でも、クラウドの項目は表示し、押せない理由を添えて無効にします。
4. `CloudStatusBadge` の「ローカルのみ」「送信済み」は通常の状態なので帯に出しません。クラウドの方が新しい・競合・失敗・送信後に変更のときだけ、「メモの操作」のボタンに点を付け、メニューの先頭に状態を書きます。
5. 「メモを削除」と「完了をまとめて削除」は、今の確認の流れ(`MemoDeleteDialog` など)をそのまま使います。

確認: P2-7・P2-8・P2-9。

### 6.2 書き口(`EntryComposer.tsx` に書き口の形を足す、`MemoEditorPage.tsx`・`EntryColumn.tsx`)

`EntryComposer` には、補助入力(気持ち・リンク・タグ)、参考URLの重複判定、IME対策、下書き保存がそろっています。新しい部品を作らず、`EntryComposer` に書き口の形(例: `variant="desk"`)を足してください。

1. 置き場所: `MemoEditorPage` の、タブ(`editor-tabs`)と棚(`editor-grid`)の間に置きます。PCではタブが隠れるので題の下、スマホでは棚のタブの下になります。
2. 入力欄は常に `textarea` 1本です。文と参考URLのときは1行から始めて自動で伸ばし、置き先が変わっても要素を作り直しません(フォーカスと打鍵を保つ)。
3. 置き先の判定(置き先を押すかAlt+1/2/3で選んだ後は、置くまで判定を止める):
   - 本文の前後の空白を除いた全体が、空白を含まない `http(s)://…` か `www.…` なら参考URL
   - 改行を含むか、段落タイトルに字があれば段落
   - それ以外はPCなら文、スマホなら開いている棚(参考URLの棚でURLでない字なら、置き先は参考URLのまま「置く」を押せない)
4. キー(IME変換中のEnterは無視。今の判定を使う):
   - 文・参考URL: Enterで置く。Shift+Enterは改行を入れて段落へ(選び直し済みでも段落にする)
   - 段落: Enterは改行。Ctrl+Enter(Macは⌘+Enter)かShift+Enterで置く
   - Alt+1/2/3: 参考URL・文・段落を選び、書き口にフォーカス。スマホではタブも移す
5. 段落タイトルの欄は、段落のときだけ本文の上に開きます(`grid-template-rows` の0fr→1frで高さを動かす)。参考URLのときは、サイト名(`getLinkHostname`)・ファビコン(`getReferenceFaviconUrl`)と「参考URLの備考」を本文の下に出します。
6. 置いた後: 置き先・補助入力の値・選び直しの状態を初期に戻します。スマホでは置いた棚のタブへ移ります(`onPlaced(kind)` などでページへ伝える)。
7. 作成: ページの `createEntry(kind, content, metadata, null, 位置, draftId)` を呼びます。参考URLなら、`EntryColumn` の `enrichReferenceTitle` を `src/lib/referenceTitle.ts` の `fetchReferenceTitle(url)` へ移し、作成後にタイトルを取りに行きます(`EntryColumn` の編集時の再取得も同じ関数を使う)。重複判定用の既存URLはページで計算して渡します。
8. 下書き: 書き口の下書きIDは `buildEntryDraftId(memoId, "sentence", "main")` に固定します。開いたとき書き口の下書きが空なら、同じメモの古い `paragraph`・`word` の `main` の下書きのうち新しい方を書き口へ移し(置き先もその種類にする)、同じトランザクションで古い方を消します(`draftRepository` に移す関数を足す)。書き口に字があるときは古い下書きを残し、書き口の下に「前の下書き(段落)を開く」を出します(書き口が空のときだけ押せる)。`StrictMode` で二度動いても壊れないようにします。
9. `EntryColumn` から各列の入力欄(`EntryComposer` の通常の形)を外します。タグ見出しの「#タグ ＋」から開く入力(`fixedTag` 付き)は今のまま残します。列が空のときの文は「まだありません。書き口から置けます。」、参考URLは「書き口にURLを貼ると、ここに並びます。」にします。
10. 新しいメモを開いたときのフォーカスは書き口へ向けます。スマホの新規メモを段落で始める今の動き(`MobileNewMemoTitleFocus`)は、書き口の置き先を段落にする形で残します。

確認: P2-1〜P2-5・P2-10〜P2-13。

### 6.3 列見出しを静かに(`EntryColumn.tsx`・`EntryTagGroupDragOrder.tsx`)

1. 見出しは h2・未完了の件数・畳む・「{列名}の操作」だけにします。表示方法の `select`、順番固定のボタン、コピーのボタンはメニューへ移します。
2. 列の `section` に `data-display-mode` と `data-order-locked` を付けます。`EntryTagGroupDragOrder` は、`.entry-column__order-lock` のボタンを探す代わりにこの属性を読み、順番固定を入れたいときはカスタムイベントで `EntryColumn` に頼みます。
3. 畳んだ列のレール(PR #9)と、1列しか残らないときに畳むを出さない動き(PR #10)は今のまま残します。

確認: P2-6。

### 6.4 余白(旧・一時メモ)(`TemporaryMemoDock.tsx`・`TemporaryMemoShortcut.tsx`)

1. 左下に浮いている付箋のボタンをなくし、帯の「余白を開く」から開きます(カスタムイベントで `TemporaryMemoDock` に伝える)。
2. PCは右から出る引き出し、920px以下は下からのシートです。見た目は紙の色に薄い罫線で、黄色・鉛筆の絵文字・折れ角はやめます。見出しは「余白」、入力欄は「余白に書く」です。
3. Alt+Qは `TemporaryMemoDock` の中で扱い、`TemporaryMemoShortcut.tsx` は削除します。保存先(`temporaryMemoRepository`)と保存の間隔は変えません。

確認: P2-14・P1-6。

### 6.5 仕上げ

- v0.5.78。README・RELEASE_NOTES・HANDOVER(第6章の画面の説明、付録Aの部品の一覧)を更新します。
- `QA_PHASES=P1,P2` が全部合格したらPRを作ります。

---

## 7. P3 離「仕立てる」(ブランチ `shitate-p3`、v0.6.0)

### 7.1 移り変わりの関数(新規 `src/lib/viewTransition.ts`)

`withViewTransition(update)` を作ります。`document.startViewTransition` がない、または `prefers-reduced-motion: reduce` なら `update` をそのまま実行します。あれば `document.startViewTransition` で包み、Reactの状態更新は `flushSync` の中で行います。`update` が非同期なら、そのPromiseを待ちます。

### 7.2 清書(新規 `src/components/SeishoView.tsx`、`MemoEditorPage.tsx`)

1. 帯に「清書にする」(表示は「清書」、朱の枠の丸いボタン)を置きます。押すと `useSearchParams` で `?view=seisho` を積み(ブラウザーの戻るで作業台に戻れる)、書き口と棚の代わりに `SeishoView` を出します。帯は残します。
2. 紙の組み方(試作の `renderSeisho` と同じ):
   - 題が `M/D 曜「…」` の形なら、h1は「」の中身、日付行は `YYYY年M月D日(曜)` とメモのタグ(年は `memo.created_at` から)。形が違えば題をそのままh1にします。
   - 「要点」: 文(階層は入れ子の箇条書き)、「本文」: 段落(段落タイトルはh3)、「参考」: 参考URL(タイトル・ホスト名・備考)。空の節は出しません。
   - 並び順は、コピーと同じく `getEntryTree` と今の並び順の設定に従います。完了は「コピーに完了を含める」の設定に従います。満足度と、文・段落の気持ち・備考は入れません。紙の下に「完了したn件、満足度、文と段落の気持ち・備考は清書に含めていません。」と小さく添えます。
   - 書体は題と本文が `var(--font-serif)`、節の見出し(要点・本文・参考)は字間を広げた小さなゴシックで朱の文字にします。
3. 落款: 紙の右下に、朱の枠の正方形で縦書きの「書出」(`aria-label="落款"`)。清書を開くと、拡大から縮んで押される動き(0.5秒、0.35秒遅れ)を付けます。動きを減らす設定では動かしません。
4. 移り変わり: 題(`memo-title-input` と h1)に `view-transition-name: memo-title`、項目(行の本文と紙の行)に `e-{項目ID}` を付けます。名前は表示順で先頭60件までにし、同じ名前が同時に2つ出ないようにします(作業台と紙は同時に描画しない)。清書へ行くとき・戻るときを `withViewTransition` で包みます。
5. 道具: 「書き口へ戻る」(`?view` を外す)、「書式つきでコピー」(描画済みの紙を `Range` で選び、`document.execCommand("copy")` で同期的にコピーし、選択を外す。失敗したら既存の `copyToClipboard(formatMemoText(...))`)、「印刷・PDF」(`window.print()`)。結果は既存の `NoticeToast` で伝えます。
6. 印刷: `@media print` で帯・道具・注記・余白・トーストを隠し、紙の影と枠を外します。

確認: P3-1〜P3-6。

### 7.3 置く手応え(`EntryComposer.tsx`・`memoRepository.ts`・`useMemos.ts`・`EntryItem.tsx`)

1. `memoRepository.createEntry` の入力型から `id` を除く指定を外し、`input.id ?? createId()` にします。`useMemos.createEntry` も素通しします。
2. 書き口で置くとき、`crypto.randomUUID()` でIDを先に作ります。5.1のとおり値を取り出して同期で空にした後、書き口の本文の位置に同じ字の「写し」の要素を重ね、`view-transition-name: e-{ID}` を付けます。
3. `withViewTransition(async () => { 写しを消す; await 作成; 行(data-entry-id)が出るまで最大300ms待つ })` で包みます。作成に失敗したら、5.1の3のとおり字を戻します。移り変わりが使えない端末では写しを作りません。
4. 置いた行には、朱の細い縦線が左から消えていく `entry-item--fresh` の印を1.2秒付けます。

確認: P3-7(清書・戻る・置くで3回以上、動きを減らす設定では0回)。

### 7.4 仕上げ

- v0.6.0。README・RELEASE_NOTES・HANDOVERに清書の仕様を書きます。
- `QA_PHASES=P1,P2,P3` が全部合格したらPRを作ります。

---

## 8. 各段階のPR・マージ・本番確認

1. 手元: `npm run build` 成功 → `npm run preview` → `node docs/shitate/qa.mjs`(その段階までが全部合格)。
2. 画面の確認: 1366×633と375×667で、編集画面・一覧・タグ管理を開き、スクリーンショットを撮ってPRに貼ります(試作と並べて違いを一言)。
3. PR: タイトルは日本語の要約、本文に変更点・受け入れ確認の結果・未確認事項を書きます。CI(GitHub ActionsのPagesビルド、Vercelのプレビュー)が成功したらsquashマージします。
4. 本番: `gh api repos/silovar-uk/kakidas/commits/<マージのSHA>/status` で「Vercel – kakidas-3gqw」が `success` になるまで待ちます(待つ間に応答を終えない)。その後、本番URLに台本を流します。

   ```powershell
   $env:QA_TARGET='app'; $env:BASE_URL='https://kakidas-3gqw.vercel.app/'; node docs/shitate/qa.mjs
   ```

   台本は新しいブラウザー環境で動くので、ユーザーの端末のメモやクラウドには触れません。
5. 本番で不合格なら、直して同じ流れでもう一度出します。

---

## 9. 気をつけること

- **移り変わりの中で入力欄を空にしない**: `startViewTransition` のコールバックは次の描画まで遅れて動きます。その中で空にすると、続けて打った字が消えるか前の文とつながります(試作で実際に起きました)。値は送信の瞬間に取り出して同期で空にします。
- **後付け部品の連鎖**: 付録Aの部品は、互いのクラス名を探し合っています。1つ外すたびに、該当の操作(ショートカット、タグ見出しの並べ替え、スマホの新規メモ、一時メモ)を手で試します。
- **書き口のクラス名**: `MobileInteractionMotion`(`.entry-composer`・`.entry-composer__submit`・`.entry-composer__textarea`)と `ParagraphTitleTagAssist`(段落タイトル)は、クラス名で書き口を探します。書き口にも同じクラス名を付けるか、探す側を直します。
- **IME**: 日本語の変換確定のEnterで置かないこと。既存の `isComposing` の扱いを書き口でも使います。
- **iPhone Safari**: 入力欄は16px以上(拡大を防ぐ)。シートを開くときは `bodyScrollLock` を使い、閉じ残しを作らない。
- **VTの名前**: CSSの識別子は数字で始められないので、項目IDには必ず `e-` を付けます。
- **データ**: IndexedDBのストア・Supabaseのカラム・バックアップの形式は変えません。`createEntry` の `id` の素通し以外に、リポジトリの意味を変えないでください。
- **残すもの**: ルートの `app.js`・`diff-core.js`・`styles.css`・`tests/` は別アプリの残りですが、今回は触りません。

---

## 10. 報告に書くこと

- 段階ごとのPRのURL、マージのSHA、本番への反映の確認結果
- 受け入れ確認の結果(手元・本番、何項目中何項目)
- 試作との違いと理由
- 確認できなかったこと(iPhone実機、Windowsでの書体の当たり方、Supabaseログイン時のメニュー)を、確認済みのことと分けて
- 基準値を変えた場合はその理由

---

## 付録A 後付け部品と、頼っているもの

| 部品 | 頼っているクラス名など | 扱い |
|---|---|---|
| `CloudUploadHeaderButton` | `.editor-header__cloud-slot`・`.editor-header__right`・`.editor-utility-menu__trigger`・`.editor-display-options__actions` | P2でフックへ移して削除 |
| `ChatGptMemoButton` | `.editor-display-options__actions`・`.memo-title-input` | P2で関数へ移して削除 |
| `KeyboardShortcuts` | `.editor-header__right`・`.editor-page`・`.editor-title-row__actions`(並び順・削除の橋渡し)、Alt+1/2/3でタブと各列の入力欄 | P2で帯の部分を削除、Alt+1/2/3は書き口へ。キー操作と説明は残す |
| `EntryTagGroupDragOrder` | `.entry-column--{種類}`・`.entry-column__order-lock`・`.entry-list__tag-group*` | P2で順番固定を `data-order-locked` から読む |
| `ParagraphTitleTagAssist` | `.entry-item__heading`・`.entry-composer__tag-popover`・段落タイトルの入力欄 | P2で書き口でも動くか確かめる |
| `MobileInteractionMotion` | `.entry-item`・`.editor-tab__count`・`.entry-column__count`・`.entry-composer`・`.entry-composer__submit`・入力欄・`.editor-tab(s)`・`.entry-item__complete` | 書き口に同じクラス名を付ける。完了のクラス名は維持 |
| `MobileNewMemoTitleFocus` | `.editor-page .memo-title-input`・`.editor-tabs [role="tab"]`・`.entry-column--paragraph .entry-composer__textarea` | P2で書き口の入力欄へ向ける |
| `TemporaryMemoShortcut` | `.temporary-memo-trigger`・`.temporary-memo-panel__close`・`.temporary-memo-panel__textarea` | P2でDockへ統合して削除 |
| `TemporaryMemoDock` | `.memo-title-input`(題を読む) | P2で帯のボタンとイベントで開く形へ |

## 付録B 色の置き換え規則

直書きの色をHSLにして、次の順に当てます。当てはまらない色や意味の色は、手で決めて報告に書きます。

| 条件 | 置き換え先 |
|---|---|
| 彩度12%未満で明度98%以上 | `--color-sheet` |
| 同 94〜98% | `--color-paper` |
| 同 85〜94% | `--color-line` |
| 同 75〜85% | `--color-line-strong` |
| 同 50〜75% | `--color-ink-3` |
| 同 30〜50% | `--color-ink-2` |
| 同 30%未満 | `--color-ink` |
| 色相10〜40°で彩度12%以上、明度45%未満 | `--color-shu-ink` |
| 同 明度45〜65% | `--color-shu` |
| 同 明度85%以上 | `--color-shu-wash` |
| 同 明度65〜85% | `color-mix(in srgb, var(--color-shu) 35%, var(--color-sheet))` |
| 色相340〜10°で彩度25%以上、明度60%未満 | `--color-danger` |
| 同 明度60%以上 | `--color-danger-wash` |
| 上記以外の有彩色(満足度の青、クラウドの青など) | 無彩色の規則へ。意味を持つ状態だけ `--color-shu`・`--color-danger` で表す |
| 透明度0.2以下の影 | `--shadow-1`・`--shadow-2` |
| 半透明の背景 | `color-mix(in srgb, var(--color-ink) n%, transparent)` |
| 満足度1〜5の地色 | `--sat-1`〜`--sat-5` |

## 付録C トークン(`src/styles-tokens.css`)

```css
/* kakidasの見た目の体系。紙・墨・朱。朱は「置く」「清書」「落款」とフォーカスだけに使う */
:root {
  --color-paper: #f5f4f0;
  --color-sheet: #fffefb;
  --color-ink: #23211d;
  --color-ink-2: #5c5952;
  --color-ink-3: #8e8a81;
  --color-line: #e6e2da;
  --color-line-strong: #d4cec3;
  --color-shu: #bd562f;
  --color-shu-ink: #9f4321;
  --color-shu-wash: #f7ebe4;
  --color-danger: #b23a32;
  --color-danger-wash: #f9e9e7;
  --color-ok: #7a9a6c;
  --sat-1: color-mix(in srgb, var(--color-shu) 3%, var(--color-paper));
  --sat-2: color-mix(in srgb, var(--color-shu) 5%, var(--color-paper));
  --sat-3: color-mix(in srgb, var(--color-shu) 7%, var(--color-paper));
  --sat-4: color-mix(in srgb, var(--color-shu) 9%, var(--color-paper));
  --sat-5: color-mix(in srgb, var(--color-shu) 12%, var(--color-paper));

  --font-sans: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "BIZ UDPGothic", "Yu Gothic UI", Meiryo, sans-serif;
  --font-serif: "Hiragino Mincho ProN", "Noto Serif JP", "BIZ UDPMincho", "Yu Mincho", serif;
  --text-xs: 12px; --text-s: 13px; --text-m: 15px; --text-l: 17px; --text-xl: 22px; --text-xxl: 28px;

  --radius-s: 6px; --radius-m: 10px; --radius-pill: 999px;
  --shadow-1: 0 1px 2px rgb(35 33 29 / .06), 0 1px 1px rgb(35 33 29 / .04);
  --shadow-2: 0 10px 30px rgb(35 33 29 / .13), 0 2px 6px rgb(35 33 29 / .06);
  --ease: cubic-bezier(.2, .8, .2, 1);

  --z-sticky: 20;    /* 帯・列見出し */
  --z-popover: 60;   /* メニュー・補助入力 */
  --z-sheet: 70;     /* 下からのシート・余白 */
  --z-toast: 80;
  --z-dialog: 90;    /* 確認ダイアログ */
  --z-top: 100;      /* 旧URLの案内など */
}
```

試作の `mock.html` は短い名前(`--paper` など)を使っていますが、値は同じです。
