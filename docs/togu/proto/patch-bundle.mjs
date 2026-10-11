// 試作専用:本番のJSの写しに、依頼書で行うTSXの小さな変更を当てる(本番のコードは触らない)
// 使い方: node patch-bundle.mjs <本番のindex.js> <出力>
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out] = process.argv.slice(2);
let js = readFileSync(src, 'utf8');
const swaps = [
  // 1. 置くときの待ちを描画待ち(rAF)からタイマーへ。移り変わりの最中は描画が止まり、rAFが来ないため4秒止まる
  ['await new Promise(e=>window.requestAnimationFrame(()=>e()))}', 'await new Promise(e=>setTimeout(e,16))}'],
  // 2. 置いた行の印を、移り変わりが新しい画面を写す前(更新の中)で付ける。飛んで収まる間も「濡れた朱」が写る
  ['s&&await Xu(s,300)};if(x?await Yu(e):await e(),s){',
    's&&(await Xu(s,300),(i=>{let r=document.querySelector(`[data-entry-id="${CSS.escape(i)}"]`);r&&(r.classList.add(`entry-item--fresh`),window.setTimeout(()=>r.classList.remove(`entry-item--fresh`),1800))})(s))};if(x?await Yu(e):await e(),!1){'],
  // 2b. 「墨が乾く」(1.6秒)を最後まで見せる(更新の外で付ける古い経路。上の変更で通らなくなる)
  ['entry-item--fresh`),1200)', 'entry-item--fresh`),1800)'],
  // 3. 呼び名を「余白」へそろえる
  ['一時メモを保存して閉じる', '余白を閉じる'],
  ['一時メモをクリアできませんでした。', '余白を消せませんでした。'],
  ['一時メモをクリア', '余白を消す'],
  // 4. 一覧の検索欄:スマホでも切れない長さに
  ['タイトル・内容・タグを検索', '題・本文・タグで探す'],
];
for (const [a, b] of swaps) {
  const n = js.split(a).length - 1;
  if (!n) { console.error('見つからない:', a); process.exitCode = 1; continue; }
  js = js.split(a).join(b);
  console.log(`${n}か所 ${a.slice(0, 40)} → ${b.slice(0, 40)}`);
}
writeFileSync(out, js);
