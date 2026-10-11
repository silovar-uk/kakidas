# 依頼書:kakidas「囲わずに、研ぐ」を実装し、本番まで出す

あなた(Sonnet)に、kakidasの見た目と手応えの仕上げを、実装から本番の受け入れ確認まで任せます。計画の理由は `docs/togu/PLAN.md` にあります。ここには、迷わず進めるための事実と手順だけを書きます。

---

## 1. 目的と完了条件

**目的**: v0.6.0の構造(書き口ひとつ・余白・清書)を保ったまま、色の取り違え・余白と文字の乱れ・線と箱の重ね過ぎを直し、置いた直後に画面が約4秒止まる不具合をなくします。

**完了条件(ここまで進めたら終わり)**

1. `main` にマージされ、Vercelの `kakidas-3gqw` 本番に反映されている。
2. 本番で `docs/togu/qa.mjs` が **30/30**、`docs/shitate/qa.mjs`(前回の受け入れ確認)が **29/29**。CIの本番ジョブで確認する。
3. PC 1366×633とスマホ375×667の撮影を、PRの説明に載せている(第7章)。
4. `HANDOVER.md` に v0.6.1 の節を足し、`RELEASE_NOTES_v0.6.1.md` を作り、`package.json` の版を `0.6.1` にしている。

---

## 2. 確認済みの事実

- リポジトリ: `silovar-uk/kakidas`。ローカルは `C:\Users\vediv\Documents\Claude\kakidas-repo`。基準は `main` の `f67abe5`(v0.6.0)。
- 本番: https://kakidas-3gqw.vercel.app/ 。`main` へのマージでVercelが自動デプロイする。
- ビルド: `npm ci` → `npm run build`(`tsc -b && vite build`)。Vite 8、React 19、Node 22。
- CSSは `src/main.tsx` が18本を順に読み込む。ほかの場所からCSSは読み込まれていない。
- `src/styles-mobile-word-compact.css`・`src/styles-mobile-word-single-row.css`・`src/styles-cloud-upload-header.css` は、どこからも読み込まれていない(v0.6.0で外れた)。
- Vite 8.0.16で `@import "./x.css" layer(legacy);` が `@layer legacy{…}` として順番どおりに組まれることを、計画時に手元のビルドで確かめた。
- 作業ツリーはCRLF(`core.autocrlf=true`)。`remap-colors.mjs` は行末を保ったまま書き換える。
- 計画の試作(本番+`docs/togu/styles-togu.css`+この依頼書のTSX変更)で、`docs/togu/qa.mjs` 30/30、`docs/shitate/qa.mjs` 29/29。

---

## 3. 範囲と保持する仕様

**変えるもの**: CSSの読み込み方(層)、色の役割(470行)、新しい仕上げの層、TS・TSXの小さな変更(6ファイル)、CIの手順、文書。

**変えないもの**

- データの形(IndexedDB・Supabase・バックアップ)、保存とクラウドの挙動。
- 書き口ひとつ、置き先の自動判定、Alt+1/2/3、段落のCtrl+Enter、清書・コピー・印刷、余白の保存先。
- 行の操作の集合(PCはホバー・フォーカスで現れる、スマホは「この項目の操作」ひとつ)。
- `vite.config.ts` の `applyKakidasUiConsistency` が置き換える文字列(付録A)。ここを変えると置き換えが黙って外れる。
- 旧CSSのファイルの中身(色の引き直しと `!important` 12行の削除を除く)。**新しい見た目は `src/styles-togu.css` にだけ書く**。

---

## 4. 手順(この順にコミットする)

ブランチ名は `togu-v0.6.1` などにする。コミットの要約は日本語。

### 4.1 置いた直後に止まらないようにする

`src/lib/viewTransition.ts` の `waitForCreatedEntry` を、描画待ちからタイマー待ちに替える。View Transitionの更新の間は描画が止まり、`requestAnimationFrame` が来ないため、上限の4秒まで止まっていた。

```ts
/** IndexedDB保存後の描画を少しだけ待ち、写しと行の形をつなぐ。
 *  移り変わりの更新中は描画が止まり、requestAnimationFrameが来ないため、タイマーで待つ。 */
export async function waitForCreatedEntry(id:string, limitMs=300): Promise<void>{
  if(typeof document==='undefined')return;
  const selector=`[data-entry-id="${CSS.escape(id)}"]`;
  const until=performance.now()+limitMs;
  while(!document.querySelector(selector)&&performance.now()<until){
    await new Promise<void>(resolve=>window.setTimeout(resolve,16));
  }
}
```

`src/components/EntryComposer.tsx`(519〜537行目付近)で、置いた行の印(`entry-item--fresh`)を付ける場所を、移り変わりの更新の中(`create` の中、`waitForCreatedEntry` の後)へ移す。移り変わりは更新が終わった時点の画面を写して飛ばすため、更新の後で印を付けると、飛んでいる間は墨の字で、着地した後に朱へ変わってちらつく。印を外す時間は、「墨が乾く」(1.6秒)を最後まで見せるため `1800` にする。

```ts
        const create = async (): Promise<void> => {
          if (canTransition) setFlyingCopy(null);
          await onSubmit(content, {
            heading: isParagraph ? submittedHeading.trim() : "",
            tag: lockedTag ?? normalizeEntryTag(submittedTag),
            note: submittedNote.trim(),
            link_url: normalizedLink,
          }, draftId, kind, createdId);
          if (createdId) {
            await waitForCreatedEntry(createdId, 300);
            // 移り変わりが新しい画面を写す前に印を付け、飛んで収まる間も「濡れた朱」を写す。
            const row = document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(createdId)}"]`);
            if (row) {
              row.classList.add("entry-item--fresh");
              window.setTimeout(() => row.classList.remove("entry-item--fresh"), 1800);
            }
          }
        };
        if (isDesk) await withViewTransition(create);
        else await create();
```

元の `if (createdId) { const row = … }` のかたまり(`await create();` の直後)は消す。`onPlaced?.(kind);` 以降はそのまま残す。

### 4.2 CSSを層に分ける

`src/styles-index.css` を新しく作る。順番は今の `main.tsx` と同じにする。

```css
/* 読み込み順 = 重なり順。既存の見た目は legacy 層に入れ、仕上げは togu 層(styles-togu.css)にだけ書く。 */
@layer legacy, togu;
@import "./styles-tokens.css" layer(legacy);
@import "./styles.css" layer(legacy);
@import "./styles-paragraph-heading.css" layer(legacy);
@import "./styles-keyboard-shortcuts.css" layer(legacy);
@import "./styles-paragraph-title-tag.css" layer(legacy);
@import "./styles-entry-tag-group-drag.css" layer(legacy);
@import "./styles-mobile-interaction-motion.css" layer(legacy);
@import "./styles-temporary-memo.css" layer(legacy);
@import "./styles-temporary-memo-mobile-refine.css" layer(legacy);
@import "./styles-temporary-memo-instant.css" layer(legacy);
@import "./styles-memo-tag-prompt.css" layer(legacy);
@import "./styles-entry-structure-actions.css" layer(legacy);
@import "./styles-completed-entry-danger.css" layer(legacy);
@import "./styles-memo-list-quiet.css" layer(legacy);
@import "./styles-canonical-host.css" layer(legacy);
@import "./styles-reference-url.css" layer(legacy);
@import "./styles-workspace-fold.css" layer(legacy);
@import "./styles-shitate.css" layer(legacy);
@import "./styles-togu.css";
```

`src/main.tsx` の18行の `import "./styles….css";` を、次の1行に置き換える。

```ts
import "./styles-index.css";
```

`docs/togu/styles-togu.css` を `src/styles-togu.css` へ写す(中身は `@layer togu { … }` で包んである。`@import` に `layer()` を付けない)。

**注意**: `src/styles-tokens.css` は、この環境の権限設定で読み取りが拒否されることがある。名前を `@import` に書くだけでよく、中身を読む必要も変える必要もない。新しい色の値は `styles-togu.css` の `:root` が上書きする。

ここで一度 `npm run build` が通ることを確かめる。

### 4.3 色の役割を引き直し、使っていないCSSと `!important` を片付ける

```powershell
node docs/togu/remap-colors.mjs           # 一覧と件数を見る(書き換えない)
node docs/togu/remap-colors.mjs --write   # src/*.css を書き換える
```

最後に「合計 470 行(対応づけできず飛ばした行 3)」と出ることを確かめる。件数が違えば、`git diff fad9299 f67abe5 -- src` 以降に旧CSSが変わっていないかを調べ、差を報告に書く。

使われていない3本を消す。

```powershell
git rm src/styles-mobile-word-compact.css src/styles-mobile-word-single-row.css src/styles-cloud-upload-header.css
```

一覧のカードの抜粋・種類・タグに付いた `!important` を外す(新しい層で文字の大きさと色を決めるため。前の層の `!important` は後の層に勝つ)。外すのは次の12行の ` !important` だけで、値は変えない。

| ファイル | 行 | 宣言 |
|---|---|---|
| `src/styles.css` | 324・325 | `.memo-card__preview-kind` の `color`・`font-size` |
| `src/styles.css` | 332・333 | `.memo-card__preview-content` の `color`・`font-size` |
| `src/styles.css` | 1927 | `.memo-card__preview-content` の `font-size` |
| `src/styles.css` | 5006・5008 | `.memo-card__tag` の `color`・`font-size` |
| `src/styles-memo-list-quiet.css` | 322・323 | `.memo-list-page .memo-card__preview-content` の `color`・`font-size` |
| `src/styles-memo-list-quiet.css` | 342 | `.memo-card__tag-text` の `color` |
| `src/styles-memo-list-quiet.css` | 582 | `.memo-list-page .memo-card__preview-content` の `font-size` |
| `src/styles-memo-tag-prompt.css` | 5 | `.memo-card__tag` の `color` |

行番号は `remap-colors.mjs` の前後で変わらない。ずれていたら、上の宣言の内容で探す。残りの `!important`(30か所)は、新しい層が触らない性質なので残す。

### 4.4 TSXの小さな変更

1. **戻る**(`src/pages/MemoEditorPage.tsx` 985行目付近): 文字「戻る」を線画の「‹」にし、左の余白へぶら下げる(位置はCSSが決める)。

   ```tsx
   <Link to="/" className="back-link" aria-label="メモ一覧へ戻る" title="メモ一覧へ"
     onClick={e=>{e.preventDefault();void handleReturnToMemoList()}}><BackIcon /></Link>
   ```

   `BackIcon` は `src/components/icons.tsx` にある。import を足す。

2. **保存の状態**(同じファイルの992行目付近): `data-state` を足す。保存中は朱、保存済みで墨の淡色へゆっくり戻る。

   ```tsx
   <span className="save-status" aria-live="polite" data-state={isSaving?'wet':'dry'}>{isSaving?'保存中…':'保存済み'}</span>
   ```

3. **スマホの操作シート**(`src/components/MobileEntryActionSheet.tsx` 187〜189行目): 3つのボタンの先頭に線画アイコンを入れる(`NoteIcon`・`LinkIcon`・`TagIcon`。`icons.tsx` にある)。並びと文言は変えない。

   ```tsx
   <button role="menuitem" type="button" onClick={…}><NoteIcon />気持ち・備考を書く</button>
   <button role="menuitem" type="button" onClick={…}><LinkIcon />{entry.link_url.trim()?"リンクを編集":"リンクを付ける"}</button>
   <button role="menuitem" type="button" onClick={…}><TagIcon />タグを変える</button>
   ```

4. **余白の呼び名**(`src/components/TemporaryMemoDock.tsx`): 画面に出る「一時メモ」を「余白」にそろえる。変数名・保存キー・コメントは変えない。
   - 113行目付近 `"一時メモを保存できませんでした。"` → `"余白を保存できませんでした。"`
   - 151行目付近 `"一時メモを読み込めませんでした。"` → `"余白を読み込めませんでした。"`
   - 278行目付近 `"このメモの一時メモをすべて消しますか？\nこの操作は元に戻せません。"` → `"このメモの余白をすべて消しますか？\nこの操作は元に戻せません。"`
   - 299行目付近 `"一時メモをクリアできませんでした。"` → `"余白を消せませんでした。"`
   - 331行目付近 `aria-label="一時メモを保存して閉じる"` → `aria-label="余白を閉じる"`
   - 387行目付近 ボタンの文字 `一時メモをクリア` → `余白を消す`

5. **一覧の検索欄**(`src/pages/MemoListPage.tsx` 951行目付近): `placeholder="タイトル・内容・タグを検索"` → `placeholder="題・本文・タグで探す"`(スマホの幅でも切れない長さ)。

付録Aの文字列には触れていないことを、`git diff` で確かめる。

### 4.5 CIに受け入れ確認を足す

`.github/workflows/verify-shitate.yml` の2つのジョブに、それぞれ1手順を足す。

- `verify` ジョブ: 既存の「P1〜P3 29項目の受け入れ確認」の後に、同じプレビューへ向けて `QA_PHASES=${{ matrix.phase }} BASE_URL=http://127.0.0.1:4173/ node docs/togu/qa.mjs` を流す手順を足す(プレビューの起動は既存の手順の中で行っているので、同じ `run` の末尾に1行足すのが簡単)。
- `production` ジョブ: 「本番29項目の受け入れ確認」の後に、`env` を同じにして `node docs/togu/qa.mjs` を流す手順を足す。

`docs/togu/qa.mjs` は `PW_FROM` が無ければ自分の場所から `playwright` を探す。CIの既存の「Playwrightを用意」で足りる。

### 4.6 文書

- `HANDOVER.md` に「## v0.6.1「囲わずに、研ぐ」見た目の型と受け入れ確認」を、v0.6.0の節の後に足す。書くこと: CSSは `styles-index.css` の層で読み込み、新しい見た目は `styles-togu.css` だけに書くこと/型(PLAN.mdの第5章)/行の道具は日時の行の右に出ること/余白はPCで右の便箋になること/View Transitionの更新の中で `requestAnimationFrame` を待たないこと/受け入れ確認 `docs/togu/qa.mjs`。消した3本のCSSへの言及は、ツリーの一覧から外す。
- `RELEASE_NOTES_v0.6.1.md`: 利用者に見える変化を3〜5行で書く(置いた後に止まらない/読みやすい文字と色/枠の少ない画面/清書の落款)。
- `package.json` と `package-lock.json` の `version` を `0.6.1` にする(`npm version 0.6.1 --no-git-tag-version`)。

---

## 5. 検証

### 5.1 手元

```powershell
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4173      # 別のターミナルで起動したままにする
$env:PW_FROM='C:\Users\vediv\repos\quicklinks'       # node_modules/playwright がある場所
$env:BASE_URL='http://127.0.0.1:4173/'
node docs/togu/qa.mjs                                # 30/30
$env:QA_TARGET='app'; node docs/shitate/qa.mjs       # 29/29
```

不合格が出たら、`$env:QA_DEBUG='1'` を付けて流すと、コントラストの不合格に背景の重なりが出る。直すのは `src/styles-togu.css` だけにする(旧CSSを直さない)。旧CSSの `!important` が邪魔をしている場合だけ、その行の `!important` を外し、報告に書く。

### 5.2 目で見る

```powershell
$env:OUT='C:\Users\vediv\AppData\Local\Temp\togu-shots'; node docs/togu/proto/shots.mjs
```

PC・スマホの書く画面、行に触れたとき、書き口(段落)、メモの操作、余白、清書、一覧が撮れる。計画の比較ページ(PLAN.mdの冒頭)の「試作」と見比べ、違う所があれば直す。とくに次を目で確かめる。

- 題・書き口・列見出し・行の左端が一本にそろう(PC)。スマホの字が画面の端に接していない。
- 枠線・破線・朱の枠がない。列の縦線がない。
- 置いた字が朱で現れ、1.6秒ほどで墨になる。置いた後、続けて打った字がすぐ見える。
- 清書の落款が枠の中に2字縦に収まり、かすれている。

### 5.3 本番

PRを作り、CIの `verify`(3段階)が通ったらマージする。`production` ジョブがVercelの反映を待って本番で両方の受け入れ確認を流すので、30/30と29/29を確かめる。

---

## 6. 確認なしで行ってよい操作と、確認が要る操作

- **確認なしでよい**: ブランチ作成、コミット、push、PR作成、CIの確認、`main` へのマージ(squash)、Vercelの本番反映の確認、受け入れ確認の実行、PRへの撮影の添付。silovar-ukの個人リポジトリで、本人がこの範囲を承認済み。
- **確認が要る**: force push・履歴の書き換え、本番データやSupabaseへの操作、環境変数・認証設定の変更、費用が発生する操作、この依頼書の範囲を超える仕様変更。
- **停止点**: 置かない。CIや本番反映の待ちでは止まらず、結果を確かめてから次へ進む。

---

## 7. 報告

最後に次をまとめる。

- PRのURL、マージのコミット、本番の受け入れ確認の結果(`docs/togu/qa.mjs` と `docs/shitate/qa.mjs`)
- `remap-colors.mjs` の件数(470行・3行)と、違った場合の理由
- 計画から変えた点と理由(とくに `styles-togu.css` に足した規則)
- 撮影(PC・スマホ)と、未確認のまま残したこと(iPhone実機、Windowsの実書体、ログイン時の表示)

PRの説明には、次の撮影を載せる: PCの書く画面、PCの行に触れたとき、スマホの書く画面、スマホの操作シート、清書(PC)、一覧(PC)。

---

## 8. 落とし穴

- **View Transitionの更新の中で `requestAnimationFrame` を待たない**。更新の間は描画が止まり、rAFは来ない。待つならタイマーかMutationObserverにする。
- **層と `!important`**: 前の層の `!important` は、後の層の通常の宣言に勝つ。`styles-togu.css` に `!important` を足して対抗しない。
- **旧CSSに新しい見た目を書かない**。見た目の変更は `styles-togu.css` に集める。旧CSSの整理は次の段で行う。
- **`display: contents`**: 列見出しの2つの入れ物(`.entry-column__heading-group`・`.entry-column__header-actions`)に使い、件数を見出しの隣へ寄せている。どちらも役割のない `div` なので、読み上げに影響しない。入れ物に役割や `aria-*` を足さない。
- **SVGの色**: 満足度の星と紙の目・かすれは、CSSのデータURIの中に色を直接書いている(`#6c675f`・`#b24e29`)。トークンの値を変えたら、ここも直す。
- **スマホの幅**: 921px未満では行の道具が「この項目の操作」だけになる(既存の仕様)。`styles-togu.css` のPC向けの規則は `@media (hover: hover) and (pointer: fine) and (min-width: 921px)` の中にある。外に出さない。
- **受け入れ確認は新しいブラウザー環境で見本を作る**ので、手元のメモやクラウドには触れない。本番に流してもよい。

---

## 付録A:`vite.config.ts` が置き換える文字列(変えない)

| ファイル | 置き換えの対象 |
|---|---|
| `src/components/EntryItem.tsx` | 気持ちアイコンの `<path d="m4 16.7-.7 4 4-.7L18.7 8.6l-3.3-3.3L4 16.7Z" />` と `<path d="m13.9 6.8 3.3 3.3" />`、`mobileParagraphEditorFocus` の `useState`、`beginLinkEdit` の関数、`initialFocus={mobileParagraphEditorFocus ?? "content"}` を含む props |
| `src/components/MobileParagraphEditorSheet.tsx` | props の型、既定値、`linkUrl` の `useState`、`setLinkUrl(entry.link_url)`、効果の依存配列 |
| `src/components/EntryComposer.tsx` | `onClick={() => openMetaPicker("link")}` と次の行の `aria-expanded={activeMetaPicker === "link"}` |
| `src/pages/MemoEditorPage.tsx` | `handleComposerAutoFocusHandled` の `useCallback`、`onMoveToKind={moveEntryToKind}` |
| `src/types/memo.ts` | `formatMemoDatePrefix` |

この依頼書の変更(`MemoEditorPage.tsx` の戻る・保存の状態、`EntryComposer.tsx` の1800ms)は、どれにも重ならない。

## 付録B:ファイル

| ファイル | 役割 |
|---|---|
| `docs/togu/PLAN.md` | 計画(理由・実測・決定・未確認) |
| `docs/togu/styles-togu.css` | 仕上げの層。`src/styles-togu.css` へ写す |
| `docs/togu/remap-colors.mjs` | 色の役割の引き直し(470行) |
| `docs/togu/qa.mjs` | 受け入れ確認30項目 |
| `docs/togu/baseline-2026-10-11.txt` | 本番の確認結果(0/30) |
| `docs/togu/proto/` | 試作の再現(本番に試作のCSS・JSを重ねる道具)。`shots.mjs` は実装の撮影にも使う |
