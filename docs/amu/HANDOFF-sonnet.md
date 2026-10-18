# 依頼書:kakidas「並べずに、編む」を実装し、本番まで出す

あなた(Sonnet)に、kakidasの編集画面(URL・アウトライン・段落の3機能)のUIの組み直しを、実装から本番の受け入れ確認まで任せます。計画の理由は `docs/amu/PLAN.md` にあります。ここには、迷わず進めるための事実と手順だけを書きます。動く完成形は `docs/amu/mock.html` です。迷ったら試作の振る舞いに合わせてください。

---

## 1. 目的と完了条件

**目的**: 3つの機能を「並べた一覧」から「1つの書き物」へ組み直します。書き口は1つのまま、いる欄へ運ばれます。アウトラインでは行の間の「次の一行」になり、一行は段落へ育ち、URLはアウトラインへ引用でき、清書で段落が編み込まれます。保存できるもの・できる操作は減らしません。データの形(IndexedDB・Supabase・バックアップ)は変えません。

**完了条件(ここまで進めたら終わり)**

1. P1(v0.7.2)・P2(v0.8.0)・P3(v0.8.1)の3つのPRが、この順に `main` へマージされ、Vercelの `kakidas-3gqw` 本番に反映されている。
2. 本番で `docs/amu/qa.mjs` が **35/35**。CIの本番ジョブで確認する。
3. 旧台本(`docs/outline/qa.mjs`・`docs/shitate/qa.mjs`・`docs/togu/qa.mjs`・`docs/layout/qa.mjs`)が、付録Bの置き換えをしたうえで全件合格している。項目を消して合格させない。
4. 各PRの説明に、PC 1366×633とスマホ375×667の撮影を載せている(第6章)。
5. `HANDOVER.md` に各版の節を足し、`RELEASE_NOTES_v0.7.2.md`・`RELEASE_NOTES_v0.8.0.md`・`RELEASE_NOTES_v0.8.1.md` を作り、`package.json` と `package-lock.json` の版を上げている。
6. 本人に実機の確認(第8章のU1〜U3)を頼む文を、最後の報告に入れている。

---

## 2. 確認済みの事実

- リポジトリ: `silovar-uk/kakidas`。ローカルは `C:\Users\vediv\Documents\Claude\kakidas-repo`。基準は `main` の `f44a9c4`(v0.7.1)。作業ツリーはCRLF(`core.autocrlf=true`)。
- 本番: https://kakidas-3gqw.vercel.app/ 。`main` へのマージでVercelが自動デプロイする。
- ビルド: `npm ci` → `npm run build`(`tsc -b && vite build`)。Vite 8、React 19、Node 22。
- CI: `.github/workflows/verify-shitate.yml`。PRでP1〜P3の3段×(outline・shitate・togu)と13幅(layout)を流し、`main` へのpush後にVercelの成功を待って本番で同じ台本を流す。
- 手元のPlaywright: `$env:PW_FROM='C:\Users\vediv\repos\quicklinks'`(`node_modules/playwright` 1.55がある)。台本はこの変数で読み込む。
- 計画時の測定: 本番v0.7.1で `docs/amu/qa.mjs` は3/35(合格はP2-1・P2-7・P3-6)、試作は35/35。内訳は `docs/amu/baseline-2026-10-18.txt`。
- `src/styles-tokens.css` は、この環境の権限設定で読めないことがある。中身を読む必要も変える必要もない。
- `docs/amu/`(この依頼書・計画書・試作・台本・出発点の記録)は計画時点で未追跡。P1の最初のコミットで追加する。ローカルの `main` は計画時に `origin/main`(`f44a9c4`)へ早送り済み。
- 見本のメモは `docs/amu/qa.mjs` の `seedBackup()` が作る(バックアップv8)。アプリでは一覧の「JSONを読み込む」(`input[type=file][accept*="json"]`)で入れ、`/memos/11111111-2222-4333-8444-555555555555` を開く。

---

## 3. 範囲と保持する仕様

**変えるもの**: 編集画面の構成(帯・書き口・3つの欄・スマホの棚)、行と項目の道具、項目の詳細、清書の組み、移り変わりの使い方、保存のうち「並べ替え・挿入位置・結び目の見出しの書き換え」の3点、既定値3つ(並び順・段落のまとめ方・日時)、ビルド時の置き換えの撤去、台本とCI。

**変えないもの**

- データの形と保存先(IndexedDB・Supabase・バックアップ・下書き)。新しい列・表・ストアを足さない。
- メモ一覧・タグ管理・クラウドの各ダイアログ。
- 書き口がひとつであること、URL→参考URL・改行→段落の自動の行き先、段落のCtrl+Enter、Ctrl+Shift+1/2/3、Alt+Q、Ctrl+/。
- 清書のURL(`?view=seisho`)、書式つきコピー、印刷で紙だけが出ること、落款。
- v0.6.1の型(色・余白・文字・角丸・影・動きの長さ)。新しい色を足さない。
- 次のクラス名(後付けの部品と旧台本が探す): `.entry-item`・`.entry-item__heading`・`.entry-item__content`・`.entry-list__tag-group*`・`.entry-column--{word,sentence,paragraph}`・`.entry-column--collapsed`・`.entry-column__collapsed-rail`・`.outline__item`・`.outline__content`・`.editor-header--shitate`・`.memo-actions__trigger`・`.seisho-*`・`data-entry-id`・`data-outline-id`。

---

## 4. 手順

ブランチは段階ごとに `amu-p1`・`amu-p2`・`amu-p3` を `main` から切る。コミットの要約は日本語。各段階の終わりに第5章の確認を流し、PR→CI→マージ→本番の受け入れ確認まで進めてから次の段階へ移る。

### 4.1 P1 守「揃える」(v0.7.2)

1. **一つの順番**
   - `src/types/memo.ts` に `export const ENTRY_KIND_ORDER: EntryKind[] = ["sentence", "paragraph", "word"];` を足す。`ENTRY_KINDS` 自体の順は変えない(検証やクラウドの件数で使っている)。
   - `src/pages/MemoEditorPage.tsx:87` の `WORKSPACE_KINDS` を `ENTRY_KIND_ORDER` にする。
   - `src/components/EntryComposer.tsx:816` の置き先の3択を `ENTRY_KIND_ORDER` の順にする(P2で3択ごと消す)。
   - `src/lib/memoText.ts:38` の `ENTRY_KINDS` を `ENTRY_KIND_ORDER` にする(コピー・.txt・ChatGPTの文がアウトライン→段落→参考URLになる。計画のD1)。
   - `src/components/KeyboardShortcuts.tsx` の説明文は今の順(1アウトライン・2段落・3参考URL)のままでよい。
2. **スマホの字下げ**: `src/styles-layout-guard.css:175` の `padding: 2px 0;` を `padding: 2px 0 2px calc(var(--outline-depth, 0) * 16px);` にする。
3. **完了した行**: `src/components/OutlineList.tsx` の行の `className` に `row.is_completed ? "outline__item--completed" : ""` を足し、`src/styles-outline.css` に `.outline__item--completed .outline__content { color: var(--color-ink-3); text-decoration: line-through; text-decoration-color: var(--color-line-strong); }` を足す。
4. **見えた場所に入る(下書き)**: `OutlineList` の `draft` を `{anchorId, parentId, index, value}` にし、`draftAfter(row)` を「開いている子を持つ行なら `parentId=row.id, index=0`、それ以外は `parentId=row.parent_id, index=兄弟での位置+1`」にする。描く場所は `anchorId` の行の直後のまま。`commitDraft` は `onCreate(value, draft.parentId, draft.index)`。
5. **開いたときの棚**: `MemoEditorPage.tsx:78` の既定 `"word"` を `"sentence"` にする。
6. **連れて行かない、でも知らせる**
   - `MemoEditorPage.tsx:924` の `setActiveKind(kind)` を消し、`:1078` の `onPlaced={setActiveKind}` を `onPlaced={handlePlaced}` にする。
   - `handlePlaced(kind)`: スマホで `kind !== activeKind` のとき、`receipt` を `{kind, at}` で立てる。4秒で消す。
   - 書き口の直後に `<div className="editor-receipt" role="status">{LABEL}に置きました <button>{LABEL}を見る</button></div>` を描く。**`position:absolute` で一覧に重ね、一覧を押し下げない**(押し下げると、指の下で押す場所がずれる。試作で再現した)。ボタンで棚を移る。棚の数字は `bump` のクラスで弾ませる(試作の `.bump`)。
   - 「段落へ移動」など、項目を移す操作(`handleMoveEntryToKind`)は、今までどおり移した先の棚を開く。
7. **新しいメモの道**
   - 題の入力欄に `onKeyDown` を足す。変換中(`isComposing`・`keyCode===229`)は何もしない。Enterで `preventDefault` → `saveTitle(title)` → 書き口へフォーカス。**フォーカスはキーの処理の中で同期して呼ぶ**(iOSでキーボードを閉じないため)。`EntryComposerHandle.focus` は `delay:0` のとき `setTimeout` を使わず、その場で `focus()` する。
   - `src/components/MobileNewMemoTitleFocus.tsx` を消し、`App.tsx` から外す。iPhoneで題の「」の中のカーソルが末尾へ戻る対策(60・180・360・560msに位置を直す)は、`MemoEditorPage` の題へのフォーカス(`shouldFocusNewMemoTitle` の効果)へ移す。直すのは、値が変わっていない・題がフォーカスを持っている間だけ。
8. **段落の案内**: `EntryComposer.tsx:773` の書き口の案内を、段落のとき `段落を書く(Ctrl+Enterで置く)`、それ以外は `書く(Enterで置く)` にする。
9. **スマホの帯を1行に**(`styles-layout-guard.css` の920px以下)
   - 帯を `grid-template-columns: 40px minmax(0,1fr) auto auto 44px; grid-template-rows: 48px;` の1行にする(戻る・題+タグ・保存の点・清書・メモの操作)。
   - 保存の状態は、`data-state` の点(7px、wetは朱、dryは罫の強め)にし、「保存中…/保存済み」の字は視覚的に隠して `aria-live` に残す。
   - 帯の「余白」はスマホでは出さず、`MemoActionsMenu` にスマホだけ「余白を開く」を足す(`kakidas:open-margin` を投げる)。PCの帯は今のまま。
10. **日時の既定をオフ**(計画のD3): `MemoEditorPage.tsx:81` の保存名を `kakidas.show-entry-timestamps.v2` にし、未設定なら `false` とする。旧い保存名は、開くたびに既定値 `true` が書き込まれてきたため、本人の選択と区別できない。引き継がない。
11. **ビルド時の置き換えをやめる**: `vite.config.ts` の `applyKakidasUiConsistency` を消し、`plugins: [react()]` にする。今も効いているのは、`EntryComposer.tsx` のリンクの小窓を開くときにスマホでクリップボードのURLを仮に入れる1件だけ(計画時に確認)。その処理を `EntryComposer.tsx` のリンクのボタンの `onClick` へ書き写す(`vite.config.ts:165-198` の置き換え後の文と同じ)。`EntryItem`・`MobileParagraphEditorSheet` の `initialLinkValue` の配線は、値が一度も入らない(置き換え4番が当たっていない)ため、写さない。
12. 版を `0.7.2` に上げ、`RELEASE_NOTES_v0.7.2.md` と `HANDOVER.md` の節を書く。

### 4.2 P2 破「そこで書く」(v0.8.0)

#### 4.2.1 書き口を運ぶ仕組み(いちばん大事)

書き口(`EntryComposer` の `variant="desk"`)は**1つだけ作り、作り直さない**。中の状態(打った字・見出し・添えたもの・下書き)を保ったまま、DOMの置き場所だけを動かす。

- `MemoEditorPage` で、運ぶ箱を1つ作る: `const deskHost = useMemo(() => { const el = document.createElement("div"); el.className = "desk-host"; return el; }, []);`
- 書き口はこの箱へポータルで描く: `{createPortal(<EntryComposer ref={deskRef} variant="desk" slot={...} … />, deskHost)}`。ReactはポータルのDOMがどこにあっても状態を保つ。イベントはReactの木(`MemoEditorPage`)へ伝わる。
- 置き場所は新しい小さな部品 `src/components/DeskSlot.tsx` が持つ。いる欄では空の `div` を描き、`useLayoutEffect` で `deskHost` を自分の中へ移す。いない欄では細い入口のボタンを描く。

```tsx
/** 書き口の置き場所。いる欄では書き口の箱を受け取り、いない欄では入口だけを見せる。 */
export function DeskSlot({ active, host, label, text, onActivate, className }: {
  active: boolean; host: HTMLElement; label: string; text?: string; onActivate: () => void; className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el || host.parentElement === el) return;
    el.appendChild(host);
    restoreDeskFocus(host);
  });
  if (active) return <div ref={ref} className={className} />;
  return <button type="button" className="desk-slot__open" aria-label={label} onClick={onActivate}>
    <span aria-hidden="true">＋</span>{text ?? label}</button>;
}
```

- **フォーカスを守る** `src/lib/deskFocus.ts`(新規、30行ほど)。DOMの中で要素を動かすと、ブラウザーはフォーカスを外す。React が欄を描き直して置き場所の要素を作り直したときも外れる。そこで「書き口にいるはずか」を覚えておき、描き直しのたびに戻す。

```ts
/** 書き口を運んだ・描き直したときに外れたフォーカスを戻す。人が別の場所を押したら戻さない。 */
let keep = false;
let last: { el: HTMLInputElement | HTMLTextAreaElement; s: number | null; e: number | null } | null = null;
const remember = (t: EventTarget | null) => {
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) last = { el: t, s: t.selectionStart, e: t.selectionEnd };
};
export function trackDeskFocus(host: HTMLElement): () => void {
  const onIn = (ev: FocusEvent) => { keep = true; remember(ev.target); };
  const onEdit = (ev: Event) => remember(ev.target);
  const onDown = (ev: PointerEvent) => { if (!host.contains(ev.target as Node)) keep = false; };
  const onAnyIn = (ev: FocusEvent) => { if (!host.contains(ev.target as Node)) keep = false; };
  host.addEventListener("focusin", onIn);
  ["input", "keyup", "select", "click"].forEach((t) => host.addEventListener(t, onEdit));
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("focusin", onAnyIn);
  return () => { host.removeEventListener("focusin", onIn); ["input", "keyup", "select", "click"].forEach((t) => host.removeEventListener(t, onEdit));
    document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("focusin", onAnyIn); };
}
export const releaseDeskFocus = () => { keep = false; };
export function restoreDeskFocus(host: HTMLElement): void {
  if (!keep || !last || !host.contains(last.el) || document.activeElement === last.el) return;
  last.el.focus({ preventScroll: true });
  try { last.el.setSelectionRange(last.s ?? last.el.value.length, last.e ?? last.el.value.length); } catch { /* type=url など */ }
}
```

- `MemoEditorPage` で `useEffect(() => trackDeskFocus(deskHost), [deskHost])` と、依存なしの `useLayoutEffect(() => restoreDeskFocus(deskHost))` を置く(行が増えて置き場所が動いたときも戻る)。
- 書き口でEscを押したとき・↑で行へ戻るときは `releaseDeskFocus()` を先に呼ぶ。
- **日本語の変換中は運ばない**。運ぶきっかけ(Tab・Shift+Tab・Shift+Enter・Ctrl+Shift+数字・行の選択・段落にする)は、どれも `isComposing`・`keyCode===229` のときは何もしない。

#### 4.2.2 書き口の欄(スロット)と行き先

- `MemoEditorPage` に `const [deskSlot, setDeskSlot] = useState<EntryKind>("sentence")` と `const [paragraphAfterId, setParagraphAfterId] = useState<string | null>(null)`(`null`=末尾、`"^"`=先頭)を置く。スマホでは `deskSlot` を使わず、棚(`activeKind`)が書き口の欄になる。
- `EntryComposer` の desk の形:
  - 置き先の3択(`.entry-composer__destinations`)と `mobileKind`・`chosenKind` の手動選択を消す。欄は `slot` で受け取る。
  - 置く先: `slot` が `word` 以外で、文がURLだけ(今の正規表現)なら `word`。それ以外は `slot`。
  - アウトラインの欄でShift+Enter(変換中でない)なら、改行を入れてから `onGrowToParagraph()` を呼ぶ(`MemoEditorPage` が `setDeskSlot("paragraph")`)。段落の欄ではEnterは改行、Ctrl+Enter・Shift+Enterで置く(今の動き)。
  - アウトラインの欄のTab・Shift+Tabは `onCaretIndent()`・`onCaretOutdent()`、空のときの↑は `onExitUp()`、Escは `onExit()` を呼ぶ。
  - 案内: アウトライン `書く(Enterで次の行・Tabで字下げ)`、段落 `段落を書く(Ctrl+Enterで置く)`、参考URL `URLを貼る(どこで貼っても入ります)`。スマホは短く `書く(Enterで次の行)` など。
  - 行き先が `slot` と違う間は、書き口の下に `→ 参考URLへ置きます` を出す(`role="status"`。P3で欄の予告も灯す)。
  - 添える道具(気持ち・リンク・タグ)は、**書きかけがあるときだけ**出す。フォーカスの出入りでは出し入れしない(指の下で画面が動く)。スマホでは2段目に置き、入力欄の幅を削らない。
  - 参考URLの欄の備考は、既定で畳み、「＋ 備考」で開く。
  - `EntryComposerHandle` に `focus`(今のもの)、`prefillParagraph(heading: string)`(P3)、`insertText(text: string)`(どこで貼っても)を足す。
- **置き場所**
  - アウトライン: `OutlineList` が「次の一行」の位置に `<DeskSlot active={deskSlot==="sentence"} label="アウトラインに書く" …/>` を描く(4.2.3)。
  - 段落: 段落の一覧の `paragraphAfterId` の後ろ(なければ末尾)に `<DeskSlot active={deskSlot==="paragraph"} label="段落を書く" …/>`。
  - 参考URL: 一覧の先頭に `<DeskSlot active={deskSlot==="word"} label="参考URLを貼る" …/>`。
  - スマホ: 棚の直下に、いつも `active` の `DeskSlot` を1つ。
  - **どの画面でも「書く」の欄は1つだけ**になる(受け入れ確認P2-1)。
- **作るときの位置**(`handleDeskCreate`)
  - アウトライン: `const pos = outlineRef.current?.insertPosition()` → `createEntry("sentence", content, metadata, pos.parentId, "bottom", draftId, entryId, pos.index)` → 成功したら `outlineRef.current?.advance()`。
  - 段落: 位置 = `paragraphAfterId` から求めた添字。`createEntry("paragraph", …, null, "bottom", draftId, entryId, index)` → `setParagraphAfterId(created.id)`。
  - 参考URL: 今のまま(先頭、「新しい項目を一番下に追加」なら末尾)。
  - スマホで、置いた先が今の棚と違うとき・置いた行が画面の外のときは、P1の受け取り表示を出す。
- **欄の移り方**: `kakidas:choose-entry-kind`(Ctrl+Shift+1/2/3)で `setDeskSlot(kind)` と書き口へのフォーカス。行を選んだとき、書き口が空で別の欄にいるなら `setDeskSlot("sentence")`(空の書き口はついてくる。書きかけはその場に残る)。
- **どこで貼っても**: `MemoEditorPage` で `document` の `paste` を聞く。入力欄・`contenteditable`・ダイアログの中なら何もしない。行がすべてURL(`normalizeLinkUrlForSave` が通る)なら、重複(`getReferenceUrlKey`)を除いて参考URLへ置き、題名を取りに行く(`handleDeskCreate` の `word` と同じ処理を関数にまとめて使う)。PCは知らせ「参考URLに◯件置きました」、スマホは受け取り表示。それ以外の文は `deskRef.current?.insertText(text)` で書き口へ入れる(置くのはEnter)。

#### 4.2.3 アウトラインの「次の一行」

`OutlineList` に「次の一行」の位置 `caret: {parentId: string | null; index: number} | null`(`null` は今の範囲の末尾)を持たせ、`forwardRef` で次の手を出す。`EntryColumn` は `outlineRef` を素通しする。

```ts
export type OutlineHandle = {
  insertPosition(): { parentId: string | null; index: number };
  advance(): void;                  // 置いた後、次の一行を新しい行の下へ進める
  indentCaret(): void;              // 直前の兄弟の子(末尾)へ。直前の兄弟がなければ何もしない
  outdentCaret(): void;             // 親の次の兄弟へ。範囲の一番上なら何もしない
  focusRowAboveCaret(): boolean;    // 次の一行の上の行を選んでフォーカス
  placeCaretAfter(rowId: string): void;
  resetCaret(): void;               // 範囲(全体か集中中の枝)の末尾へ
};
```

- **見えた場所に入る**: 行を選ぶと `placeCaretAfter`。開いている子を持つ行なら `{parentId: row.id, index: 0}`、それ以外は `{parentId: row.parent_id, index: 兄弟での位置+1}`。
- **描く位置**(試作の `caretSpot` と同じ):
  - `index` の位置に兄弟がいれば、その行の直前に描く。
  - 末尾なら、親の枝の最後に見えている子孫の直後。範囲の一番上(全体か集中中の枝)の末尾なら、木の最後。
  - 深さは「親の深さ+1」(範囲の一番上なら0)。`--outline-depth` で字下げする。
  - 木の最後にあるときは `.outline__caret--end` を付け、`position: sticky; bottom: 0` で欄の下端に貼り付ける(背景は机の色へ溶かす)。
- 次の一行は `role="none"` の `div` にし、書き口の欄に `aria-description`(例「「論点」の下、2段目に入ります」)を付ける。
- Tabで字下げしても、見える位置は変わらず深さだけが変わる(直前の兄弟の枝の直後=同じ場所)。
- **消すもの**: `draft` と `.outline__new`(新しい行の欄)、`.outline__footer`(「＋ 項目を追加」は次の一行へ、「直前の移動を戻す」は知らせへ)、`.outline__toolbar`(案内は書き口の案内とショートカットの説明へ、高密度は列のメニューへ)、`.outline__details`(項目の詳細へ)。
- **行の編集のEnter**: 保存してから `placeCaretAfter(row)` → 書き口をアウトラインの欄へ運んでフォーカス(続けて次の行を書ける)。
- **動かした直後の知らせ**: `relocate` の後に知らせ「動かしました」を出し、ボタン(見える字は「戻す」、`aria-label="直前の移動を戻す"`)で戻す。`UndoToast` に `actionLabel`・`actionAriaLabel` を足して使う。
- 行の道具(PC): 触れたときに「⌕ この枝に集中」「⋯ 項目の詳細」。P3で先頭に「¶ 段落にする」を足す。スマホは「⋯ この項目の操作」だけ(今のまま)。

#### 4.2.4 PCの画面:動かない帯と、流れる欄

- 921px以上で、編集画面を `height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr);` にする(帯+欄)。`.editor-grid` は `min-height: 0`、各列は `display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0;`、`.entry-list` は `overflow-y: auto; min-height: 0; scrollbar-gutter: stable; scrollbar-width: thin; overscroll-behavior: contain;`。
- 上の書き口の箱(`.entry-composer--desk` を帯の下に置く今の描き方)はなくす。
- 清書(`?view=seisho`)のときは今までどおりページで流す(`height` の指定を外す)。
- 帯は52px。v0.7.1の幅の比(42:38:20)と、921〜1199pxで参考URLをレールに畳む動きは残す。レールのときにCtrl+Shift+3を押したら、今までどおりレールを開いてから書き口を運ぶ。

#### 4.2.5 段落は文書の順

- **並び順の既定**(計画のD2): `src/lib/copyPreferences.ts` の保存名を `kakidas.entry-sort-mode.v2` にする。未設定なら旧い保存名を読み、`created_asc`・`satisfaction_desc`(既定以外を選んでいた人)ならその値、それ以外は `manual` にする。旧い保存名は開くたびに既定値が書き込まれてきたため、`created_desc` は本人の選択と区別できない。段落は先頭に足してきたので、手動の順でも最初の見え方は新しい順のまま変わらない。
- **段落のまとめ方の既定**: `src/lib/entryTagGroups.ts` で、段落だけ保存名を `kakidas.entry-list-display-mode.v2.paragraph` にし、未設定なら `plain`。参考URLとアウトラインは今のまま。
- **並べ替え**: `memoRepository.relocateOutlineEntry`(`:869`)を、段落の一番上の階層(`targetParentId === null`)でも動くように広げる。種類の確認(`:879-882`)を「アウトライン、または親なしの段落」にし、`all` を `entry.kind === current.kind` で絞る。`useMemos.ts` の `relocateOutlineEntry` もそのまま使える(名前は変えなくてよい)。
- **挿入位置**: `memoRepository.createEntry`(`:809`)の `insertAt` を、段落(`parentId === null`)にも効かせる。
- 段落の行の道具: 手動の順のときだけ「上へ移す」「下へ移す」(`aria-label` も同じ)と「⋯ 項目の詳細」。手動以外の順では上下を出さない。
- 「新しい項目を一番下に追加」は、参考URLにだけ効く。メニューの文言を「参考URLを下に足す」にする。

#### 4.2.6 行の道具と、項目の詳細

- `EntryItem` の触れたときの道具(`.entry-item__quick-actions`)を3つまでにする。段落は「上へ移す・下へ移す・項目の詳細」、参考URLは「URLを編集・項目の詳細」(P3で「アウトラインに引く」を先頭に)。満足度・完了・気持ち・リンク・タグのボタンは詳細へ移す。書いてある気持ちの文・タグ・リンクの印は今までどおり行に見せる。
- **項目の詳細**(新規 `src/components/EntryInspector.tsx`、PCは行のそばの小窓、`role="dialog"`・`aria-label="項目の詳細"`)。中身と順番は試作の `openInspector` と同じ:
  1. 題(1行)と「種類・作成 日時」
  2. 動かす(アウトラインだけ): 上げる・下げる・上へ・下へ(4つの札)
  3. 完了にする/未完了に戻す、段落に複製(P2は今の動きのまま。P3で「段落にする」に置き換える)、集中(アウトライン)
  4. 書き添える: 気持ち・備考、リンク(参考URLはURL)、タグ。評価(0〜5、`role="group"`・`aria-label="評価"`)
  5. コピー、新しいメモにする(参考URL以外)、段落へ移動/アウトラインへ移動
  6. 削除(赤、罫で分ける)
- 小窓の中の気持ち・リンク・タグは、その場の欄で書く(Enterで決める、Escで閉じる)。タグの候補は `getRecommendedEntryTags` に、段落なら見出しを先頭に足す(今の `ParagraphTitleTagAssist` の役目。書き口のタグ候補にも同じことをする)。役目を移したら `ParagraphTitleTagAssist.tsx` を消し、`App.tsx` から外す。
- **スマホ**は `MobileEntryActionSheet` を同じ中身・順番に組み直す。「動かす」の4つを一番上に置く(2タップで字下げ)。「↳ 階層・段落の操作」はなくす。気持ち・リンク・タグは、シートを閉じてから**画面の上半分のカード**(`position: fixed; top: 56px`)で書く。下からのシートの中に入力欄を置かない(キーボードで押し上げられる)。
- スマホの「満足度」は、シートの中ほど(書き添えるの下)へ移す。

#### 4.2.7 スマホの書き口

- 帯48px→棚40px→書き口→一覧の順。書き口は流れの中に置く。`position: fixed`・`visualViewport` の追いかけは使わない(Quick Linksの教訓。計画書2.4)。
- アウトラインの棚では、書き口の左に「↰ 字上げ」「↳ 字下げ」(44×44px、`aria-label` も同じ)を置き、`outlineRef` の `outdentCaret`・`indentCaret` を呼ぶ。
- 書きかけがある間だけ、一覧の次の一行の位置に「↳ ここに入ります」を灯す(`.outline__ghost`)。
- 行を1回押すと選ぶ(次の一行がその下へ)。選んだ行をもう1回押すと、その場で直す。
- `MobileInteractionMotion.tsx` は、書き口が列の外にあるため「置いた行が弾む」がすでに効いていない。棚の数字が弾む・完了の手応えが新しい構造でも出るか確かめ、出なければ削除して、受け取り表示と `.bump` に任せる。

#### 4.2.8 ほかの片付け

- アウトラインの列のメニューに「高密度で表示」(`menuitemcheckbox`)を足す。保存名 `kakidas.outline-density.v1` はそのまま。
- `EntryTagGroupDragOrder.tsx` はタグのまとまりのクラス名を探して動く。段落・参考URLのタグのまとまりの描き方とクラス名を変えない。
- ショートカットの説明(`KeyboardShortcuts.tsx`)を、試作の `toggleHelp` の文にする。
- 版を `0.8.0` に上げ、リリースノートと `HANDOVER.md` を書く。リリースノートには、変えた既定(並び順・段落のまとめ方・日時)と戻し方を書く。

### 4.3 P3 離「編み上げる」(v0.8.1)

1. **結び目**(新規 `src/lib/outlineBinding.ts`): データは変えず、見出しの一致から毎回求める。

```ts
/** 段落の見出しが、アウトラインの1行と同じ文なら結ばれているとみなす。同じ文の行が2つ以上なら結ばない。 */
export function getOutlineBindings(entries: EntryRow[]) {
  const live = entries.filter((e) => e.deleted_at === null);
  const rowByText = new Map<string, EntryRow | null>();
  for (const e of live) if (e.kind === "sentence") {
    const key = e.content.trim();
    rowByText.set(key, rowByText.has(key) ? null : e);
  }
  const rowByParagraphId = new Map<string, EntryRow>();
  const paragraphsByRowId = new Map<string, EntryRow[]>();
  for (const p of live) if (p.kind === "paragraph" && p.heading.trim()) {
    const row = rowByText.get(p.heading.trim());
    if (!row) continue;
    rowByParagraphId.set(p.id, row);
    paragraphsByRowId.set(row.id, [...(paragraphsByRowId.get(row.id) ?? []), p]);
  }
  return { rowByParagraphId, paragraphsByRowId };
}
```

   - アウトラインの行: 結ばれていれば「¶」(`aria-label="段落を開く"`)を見せる。
   - 段落: 結ばれていれば見出しの前に「↖ 2.2」(行の振り番。`aria-label="アウトラインの「{行の文}」へ"`)。押すと行を選び、両方を朱の淡色で1.6秒灯す。
2. **段落にする**: 行の道具の先頭と詳細に「¶ 段落にする」(結ばれていれば「段落を開く」)。
   - 結ばれていなければ: 段落の挿入位置を「アウトラインの順」で決める(試作の `grow`: 前の行に結ばれた最後の段落の後ろ、なければ後の行に結ばれた最初の段落の前、どちらもなければ末尾)→ `deskRef.current?.prefillParagraph(row.content)`(見出しに入れ、本文は空)→ `setDeskSlot("paragraph")` → 本文へフォーカス。
   - 結ばれていれば: その段落へ送り(`scrollIntoView({block:"center"})`)、灯す。
   - 今の「段落に複製」(`EntryColumn.tsx:1144` の `onGrow`)はこの操作に置き換える。「段落へ移動」は詳細に残す。
   - 移り変わり: 行の文に `view-transition-name: amu-grow` を付けてから `withViewTransition` で状態を変え、更新の中で段落の見出しの欄に同じ名前を付け替える。終わったら名前を外す。
3. **結び目の見出しを直す**(計画のD5): `memoRepository.updateEntry`(`:928`)で、アウトラインの文が変わったとき、同じトランザクションの中で次を行う。変わる前の文と同じ文の行がほかになければ、同じメモの段落のうち `heading.trim() === 変わる前の文` のものの見出しを新しい文にする(`updated_at` も更新)。
4. **アウトラインに引く**: 参考URLの行の道具の先頭と詳細に「↖ アウトラインに引く」。`outlineRef.current.insertPosition()` の位置へ `createEntry("sentence", w.content, {link_url: w.link_url}, …)` → `advance()`。参考URLの行には、同じURL(`getReferenceUrlKey` が同じ)を持つアウトラインの行の数を「引用 1」(`aria-label="アウトラインで引用 1件"`)で見せ、押すと最初の行を選ぶ。アウトラインの行は、リンクがあれば「↗」(`aria-label="リンクを開く"`)を見せる。
5. **行き先の予告**: 書き口の行き先が `word` で、書き口が参考URLの欄にいないとき、参考URLの欄の入口の下に「ここに入ります(題名はあとから届きます)」を朱の淡色で灯す(破線の枠は使わない。v0.6.1の決まり)。
6. **清書で編み上がる**(`src/components/SeishoView.tsx`)
   - 要点の各行の直後に、結ばれた段落の本文を `<li class="seisho__knit">`(行頭の点なし、一字下げ)で入れる。本文の節には、結ばれていない段落だけを並べる。
   - 完了を含めない設定のときは、完了した段落も入れない(今と同じ規則)。
7. **移り変わりを戻す範囲**: `src/styles-layout-guard.css:271-282` の「動きをすべて止める」規則を `:root:not(.amu-vt)` の中だけに効かせる。`withViewTransition` に `{ scoped: true }` を足し、清書の切り替え・段落にする・アウトラインに引くのときだけ、始める前に `document.documentElement.classList.add("amu-vt")`、終わったら外す。置くときは今までどおり移り変わりを使わない。清書へ切り替えるときは、見えている先頭60行の本文と段落の行に `view-transition-name: e-{id}` を付ける(清書側は今も付けている)。動きを減らす設定では使わない(`withViewTransition` が見ている)。
8. 版を `0.8.1` に上げ、リリースノートと `HANDOVER.md` を書く。

---

## 5. 確認

各段階で、次をこの順に流す。

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173   # 別の端末で
$env:PW_FROM='C:\Users\vediv\repos\quicklinks'; $env:QA_TARGET='app'; $env:BASE_URL='http://127.0.0.1:4173/'
$env:QA_PHASES='P1'; node docs/amu/qa.mjs           # P1のとき。P2では 'P1,P2'、P3では 'P1,P2,P3'
$env:QA_PHASES=$null                                # 旧台本は全段階を流す
node docs/outline/qa.mjs; node docs/shitate/qa.mjs; node docs/togu/qa.mjs; node docs/layout/qa.mjs
```

- 新しい台本 `docs/amu/qa.mjs` を、CIのPRジョブと本番ジョブに足す。段階の行列(P1・P2・P3)を、今の3本と同じように `QA_PHASES=${{ matrix.phase }}` で分ける。**まだ作っていない段階の項目で落とさないため、amuの行だけ段階で絞る**。P1のPRでは `if [ "${{ matrix.phase }}" = P1 ]; then … node docs/amu/qa.mjs; fi`、P2のPRでは P1・P2 に広げ、P3のPRで条件を外す。CIのステップ名「P1〜P3 29項目の受け入れ確認」は「受け入れ確認(amu・outline・shitate・togu)」にする。
- 旧台本は付録Bのとおりに直す。意味の残る項目は残し、置き換わった項目は新しい項目のIDを注記に書いて消す。
- `docs/togu/proto/shots.mjs` の撮影(CIのP3ジョブ)が、消した3択や上の書き口を探していれば、新しい構造に合わせる。
- 失敗したら、台本ではなくアプリを直す。台本の誤りだと判断したときは、その理由をPRの説明に書く。

---

## 6. 撮影と記録

- PRごとに、PC 1366×633とスマホ375×667で、見本のメモの「最初の画面」「書き口に打っている途中」「項目の詳細」「清書(P3)」を撮って説明に載せる。CIの成果物(`kakidas-responsive-13-widths` など)へのリンクでもよい。
- 次の数字を、計画時の値(本番 → 試作)と並べて説明に書く。PCの最初の行の上端(274px → 98px)、PCのページの高さ(748px → 633px)、PCの見える操作(36 → 25)、スマホの帯(92px → 48px)、スマホの最初の行(378px → 149px)、スマホの字下げ(0px → 16px)。
- `HANDOVER.md` の各版の節には、何を変え、何を変えていないか(データの形)、既定の変更と戻し方、未確認事項を書く。

---

## 7. 進めてよい操作と、確認が要る操作

- **確認なしで進めてよい**: ブランチ作成、コミット、push、PR作成、CIの確認、CIの失敗の修正、`main` へのマージ(squash)、本番の受け入れ確認、リリースノートと `HANDOVER.md` の更新。silovar-ukの個人リポジトリで、本人が承認している範囲。
- **先に確認する**: force push・履歴の書き換え、本番データの削除、Supabaseのスキーマやポリシーの変更、Vercelの設定・公開範囲・認証の変更、費用が発生する操作。この計画では、どれも要らない。
- 停止点は置かない。CIやデプロイの結果を待つ間に応答を終えず、結果を確かめてから次へ進む。

---

## 8. 本人の実機確認(最後の報告で頼む)

Playwrightでは確かめられないため、本人にiPhone SE(iOS 26・Safari)で次を頼む。

- **U1**: アウトラインの棚で書き口に触れ、日本語で一行打ってEnter。キーボードが閉じず、画面が寄らず、書き口が上半分にとどまる。「↳ 字下げ」→もう一行で、子として入る。
- **U2**: 行の「⋯」→「気持ち・備考を書く」で上のカードが開き、打っている間に画面が押し上げられない。
- **U3**: 新しいメモで、題の「」の中にカーソルが来て、題を書いてEnterで書き口へ移る(キーボードが閉じない)。

---

## 9. 落とし穴

- **書き口を描き直さない**: `EntryComposer` の desk をスロットごとに描くと、欄を移るたびに作り直され、打った字・下書き・IMEの状態が消える。必ず4.2.1の「1つの箱を運ぶ」形にする。
- **フォーカス**: 要素を動かすとフォーカスは外れる。描き直しのたびに `restoreDeskFocus` で戻す。人が別の場所を押したら戻さない(`pointerdown` で判断)。
- **指の下で画面を動かさない**: フォーカスの出入りで段や灯りを出し入れしない。知らせは重ねて出す。試作では、書き口から指を離した瞬間に段が消えて、隣のボタンを押し損ねた。
- **キーボードを追いかけない**: スマホの書き口・カードは上半分の流れの中か `top` 固定にする。`visualViewport` に合わせて動かす処理を足さない。
- **変換中のキー**: Enter・Tab・Shift+Tab・↑・Escは、`isComposing`・`keyCode===229`・`key==="Process"` のとき何もしない。
- **既定値の書き込み**: 並び順・タグでまとめる・日時の設定は、開いた時点で既定値を保存している。既定を変えるときは保存名を新しくする(4.1の10、4.2.5)。
- **移り変わり**: v0.7.1が止めた残像は、画面全体の写しが重なって起きていた。名前付きの要素だけを動かし、`::view-transition { pointer-events: none; }` は残す。移り変わりの更新の中で `requestAnimationFrame` を待たない(v0.6.1で直した4秒の止まり)。
- **見出しの一致**: 前後の空白だけを除いて完全に一致させる。大文字小文字・全角半角を寄せない(結び目が勝手に増える)。
- **ARIA**: 木(`role="tree"`)の中に置く次の一行は `role="none"` にし、木の項目(`treeitem`)と数を混ぜない。受け入れ確認は `treeitem` の数と `aria-level` を見ている。
- **後付けの部品**: `EntryTagGroupDragOrder` はクラス名で動く。`MobileInteractionMotion` は一部がすでに効いていない。消すときは役目が残っていないか確かめる。
- **中間の幅**: 921〜1199pxでは参考URLがレールに畳まれ、そのスロットは見えない。どこで貼っても・Ctrl+Shift+3で使えることを確かめる。

---

## 付録A:受け入れ確認が探す名前

| 種類 | 名前 |
|---|---|
| 入力 | `書く`(書き口。どの画面でも1つ)、`段落の見出し`、`参考URLの備考`、`メモのタイトル`、`アウトラインの本文を編集` |
| 欄 | `region` の名前 `アウトライン`・`段落`・`参考URL`(列の見出しの文) |
| 入口 | `アウトラインに書く`・`段落を書く`・`参考URLを貼る` |
| アウトラインの行 | `treeitem`(`aria-level`・`aria-selected`)。道具 `段落にする`/`段落を開く`・`この枝に集中`・`項目の詳細`、スマホ `この項目の操作`、開閉 `子を折りたたむ`/`子を展開`、リンク `リンクを開く` |
| 段落の行 | `上へ移す`・`下へ移す`・`項目の詳細`、結び目 `アウトラインの「…」へ` |
| 参考URLの行 | `アウトラインに引く`・`URLを編集`・`項目の詳細`、引用 `アウトラインで引用 N件` |
| 項目の詳細 | `dialog` の名前 `項目の詳細`。`上げる`・`下げる`・`上へ`・`下へ`・`完了にする`・`段落にする`・`気持ち・備考を書く`・`リンクを付ける`・`タグを付ける`・`コピー`・`新しいメモにする`・`段落へ移動`・`削除`、`group` `評価` |
| スマホ | `tab` の `アウトライン`・`段落`・`参考URL`(この順)、`字上げ`・`字下げ`・`置く`、知らせは `role="status"` に「参考URL」などの欄の名前 |
| 帯 | `清書にする`・`メモの操作`(メニューの `menuitem` `メモをコピー`)、`余白を開く` |
| 清書 | `article` の名前 `清書`、節の見出し `要点`・`本文`・`参考` |
| 知らせ | 動かした後のボタン `直前の移動を戻す` |
| 行き先 | 書き口の下の「→ 参考URLへ置きます」 |

## 付録B:旧台本の置き換え

| 台本 | 項目・行 | 置き換え |
|---|---|---|
| shitate・togu・outline・layout | `getByRole('radio', {name})` で置き先を選ぶ所(shitate 74・339、togu 46、outline 17、layout 27) | PCはCtrl+Shift+1/2/3(アウトライン・段落・参考URL)、スマホは棚を押す。共通の小さな関数にまとめる |
| shitate | P2-2〜P2-5の置き先の `aria-checked` の確認(261・273・282・295) | 書き口がどの欄にあるか(`docs/amu/qa.mjs` の `inRegion`)と、置いた項目がどの欄に入ったかで確かめる |
| shitate | P2-12「スマホで置くと、置いた棚のタブへ移る」 | 計画のD4で置き換え。amu P1-8を参照と注記して消す |
| shitate | P2-13「前の段落の下書きを、書き口が拾う」 | 意味は残る。段落の欄(Ctrl+Shift+2)で拾えることを確かめる形にする |
| togu | P1-10「余白の呼び名がそろい…」のスマホ側(258行の `button '余白を開く'`) | スマホは「メモの操作」→ `menuitem` 「余白を開く」で開く形にする(P1で帯から移すため) |
| togu | P2-7「書き口は2段で、高さ112px以内(PC)」 | 上の箱がなくなる。amu P2-2を参照と注記して消す |
| togu | 297・356・411・420 の `.entry-composer--desk` の測り方 | 書き口は `.desk-host` の中。アウトラインの欄の次の一行で測る |
| togu | P3-2「書き口に触れると墨の線が走り…」、P3-3「置く」に朱が灯る | 意味は残る。次の一行の書き口で同じ表現を出し、測る場所を直す |
| outline | 「高密度表示を切り替えられる」(50〜54) | 列のメニュー「高密度で表示」で切り替える |
| outline | 「直前の移動を戻す」(73) | 動かした後の知らせのボタン(名前は同じ) |
| outline | 「作成・位置指定・再読込で重複しない」(79〜84の `項目の詳細` と `新しいアウトライン項目`) | 行を選んで次の一行へ書く形にする。重複しないこと・再読み込み後に同じ位置にあることは変えずに確かめる |
| layout | 39〜40 の3択と添える道具の重なり | 3択はない。添える道具と「置く」が重ならないことを、書きかけの状態で測る |
| layout | 69〜71 の「階層・段落の操作」→`.outline__details` | シートの「下げる」が画面内にあり、押すと深さが変わることを確かめる |

## 付録C:よく触るファイル

- `src/pages/MemoEditorPage.tsx`(画面の組み立て、書き口の箱、どこで貼っても、受け取り表示)
- `src/components/EntryComposer.tsx`(書き口。欄ごとの形、行き先、キー)
- `src/components/DeskSlot.tsx`・`src/lib/deskFocus.ts`(新規)
- `src/components/OutlineList.tsx`(次の一行、行の道具、知らせ)
- `src/components/EntryColumn.tsx`(欄、段落と参考URLのスロット、列のメニュー)
- `src/components/EntryItem.tsx`(段落・参考URLの行の道具)
- `src/components/EntryInspector.tsx`(新規)・`src/components/MobileEntryActionSheet.tsx`
- `src/components/SeishoView.tsx`・`src/lib/outlineBinding.ts`(新規)・`src/lib/viewTransition.ts`
- `src/repositories/memoRepository.ts`(`createEntry`・`relocateOutlineEntry`・`updateEntry`)
- `src/lib/memoText.ts`・`src/lib/copyPreferences.ts`・`src/lib/entryTagGroups.ts`・`src/types/memo.ts`
- `src/styles-outline.css`・`src/styles-layout-guard.css`(新しい見た目は `@layer outline` か新しい層に書き、旧CSSを書き換えない)
- `vite.config.ts`・`src/App.tsx`
