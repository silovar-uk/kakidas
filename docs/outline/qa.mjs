// kakidas v0.7.0: アウトライナー固有の受け入れ確認。
// 既存の仕立て・研ぎのQAと独立して実施する。実ユーザーデータには触れない。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { selectKind, deskIsFor } from '../amu/kinds.mjs';
const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + '/').href : import.meta.url;
const { chromium } = createRequire(base)('playwright');
const url = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const phases = new Set((process.env.QA_PHASES || 'P1,P2,P3').split(',').map(x => x.trim()));
const checks = [];
function check(phase, name, fn) { checks.push({ phase, name, fn }); }
const outline = page => page.locator('.outline__tree');
const row = (page, text) => outline(page).locator('[role="treeitem"]').filter({ has: page.locator('.outline__content', { hasText: text }) }).first();
const entries = page => outline(page).locator('[role="treeitem"][data-outline-id]');
async function outlineCompletedMenu(page, { toggle = false } = {}) {
  await page.getByRole('button',{name:'アウトラインの操作'}).click();
  const item=page.getByRole('menuitemcheckbox',{name:'完了済みを表示'});
  const current=await item.getAttribute('aria-checked');
  if(toggle)await item.click();
  else await page.getByRole('button',{name:'アウトラインの操作'}).click();
  return current;
}
async function put(page, content) {
  await selectKind(page, 'sentence');
  const line = page.locator('.entry-column--sentence .outline__edit--pending');
  await line.waitFor({state:'visible'});
  await line.fill(content);
  await line.press('Enter');
  await row(page, content).waitFor({ state: 'visible' });
}
async function fresh(browser, width = 1366) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 667 : 633 }, locale:'ja-JP', timezoneId:'Asia/Tokyo' });
  context.setDefaultTimeout(7000);
  await context.route('**/api/link-preview**', r => r.fulfill({status:200,contentType:'application/json',body:'{"title":"QAタイトル"}'}));
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button',{name:/新しいメモ/}).first().click();
  await page.waitForURL(/\/memos\//);
  await page.getByRole('textbox',{name:'メモのタイトル'}).fill('アウトライナー品質試験');
  return { context, page };
}
check('P1','3領域の入力先をキーボードで選択できる',async(page)=>{
  for(const [key,label,kind] of [['Control+Shift+1','アウトライン','sentence'],['Control+Shift+2','段落','paragraph'],['Control+Shift+3','参考URL','word']]){
    await page.keyboard.press(key);
    // 書き口が使う欄(v0.8.0以降は書き口が運ばれた欄、それ以前は置き先の選択)を確かめる
    for(let i=0;i<20&&!(await deskIsFor(page,kind));i++)await page.waitForTimeout(100);
    assert.equal(await deskIsFor(page,kind),true,label+' '+key);
    const target=kind==='sentence'
      ? page.locator('.entry-column--sentence .outline__edit').first()
      : page.getByRole('region',{name:label,exact:true}).getByRole('textbox',{name:'書く',exact:true}).first();
    assert.equal(await target.evaluate(e=>document.activeElement===e),true,key+' フォーカス');
  }
});
check('P1','アウトラインに複数の行を入力できる',async(page)=>{
  for(const text of ['構造A','構造B','構造C'])await put(page,text);
  assert.equal(await entries(page).count(),3,'作成行数');
  const before=await outline(page).locator('.outline__content').allTextContents();
  assert.deepEqual([...before].sort(),['構造A','構造B','構造C'],'3項目の保持');
  await page.reload();
  assert.deepEqual(await outline(page).locator('.outline__content').allTextContents(),before,'作成順序の再現性');
});
check('P1','保存済みの行があっても独立した書く欄を置かない',async(page)=>{
  await put(page,'1行目');
  assert.equal(await page.locator('.entry-column--sentence .entry-composer__textarea').count(),0);
  assert.equal(await page.locator('.entry-column--sentence .outline__content').count(),1);
  await row(page,'1行目').getByText('1行目').click();
  assert.equal(await page.locator('.entry-column--sentence .outline__edit').count(),1);
});
check('P1','PCの単一行は28px基準、通常表示も31px基準で詰まる',async(page)=>{
  await put(page,'余白の計測A');
  await put(page,'余白の計測B');
  const measure=()=>row(page,'余白の計測A').evaluate(el=>({
    height:el.getBoundingClientRect().height,
    marker:el.querySelector('.outline__marker')?.getBoundingClientRect().height,
    padding:getComputedStyle(el.querySelector('.outline__content')).paddingTop,
  }));
  const dense=await measure();
  assert.ok(dense.height >= 27.5 && dense.height <= 29.5,'高密度の単一行は28px程度 '+JSON.stringify(dense));
  assert.equal(dense.padding,'2px','本文の上下余白は詰まっている');
  await page.getByRole('button',{name:'アウトラインの操作'}).click();
  await page.getByRole('menuitemcheckbox',{name:'高密度で表示'}).click();
  const normal=await measure();
  assert.ok(normal.height >= 30.5 && normal.height <= 32.5,'通常表示の単一行は31px程度 '+JSON.stringify(normal));
});
check('P1','高密度表示を切り替えられる',async(page)=>{
  // v0.7.2: 切り替えは列のメニューの「高密度で表示」へ移った(上の帯は無くなった)
  const toggle=async()=>{await page.getByRole('button',{name:'アウトラインの操作'}).click();await page.getByRole('menuitemcheckbox',{name:'高密度で表示'}).click();};
  assert.equal(await page.locator('.outline--dense').count(),1);
  await toggle();
  assert.equal(await page.locator('.outline--normal').count(),1);
  await toggle();
  assert.equal(await page.locator('.outline--dense').count(),1);
});
check('P1','完了済みは既定で非表示、表示・再非表示・再読込の状態を記憶する',async(page)=>{
  await put(page,'未完了の行');
  await put(page,'完了にする行');
  await row(page,'完了にする行').focus();
  await page.keyboard.press('Control+Enter');
  // 完了操作はIndexedDBへの非同期保存。DOMから外れたことを待って検証する。
  await row(page,'完了にする行').waitFor({state:'detached'});
  assert.equal(await row(page,'完了にする行').count(),0,'完了行は初期状態では表示されない');
  assert.equal(await row(page,'未完了の行').count(),1,'未完了の行は残る');
  assert.equal(await outlineCompletedMenu(page),'false','PCのアウトラインメニューで初期非表示');
  await outlineCompletedMenu(page,{toggle:true});
  assert.equal(await row(page,'完了にする行').count(),1,'表示操作で完了行が戻る');
  await page.reload();
  assert.equal(await row(page,'完了にする行').count(),1,'表示設定が再読込後も残る');
  assert.equal(await outlineCompletedMenu(page),'true','表示設定が記憶されている');
  await outlineCompletedMenu(page,{toggle:true});
  assert.equal(await row(page,'完了にする行').count(),0,'非表示に戻せる');
  await page.reload();
  assert.equal(await row(page,'完了にする行').count(),0,'非表示設定も再読込後に維持する');
});
check('P2','完了した親を隠しても未完了の子は消えず、再表示で階層が戻る',async(page)=>{
  await put(page,'親の作業');
  await put(page,'子の作業');
  await row(page,'子の作業').focus();
  await page.keyboard.press('Tab');
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="treeitem"][aria-level="2"]')].some(e=>e.textContent.includes('子の作業')));
  await row(page,'親の作業').focus();
  await page.keyboard.press('Control+Enter');
  assert.equal(await outlineCompletedMenu(page),'false');
  assert.equal(await row(page,'親の作業').count(),0);
  assert.equal(await row(page,'子の作業').count(),1,'未完了の子は消えない');
  assert.equal(await row(page,'子の作業').getAttribute('aria-level'),'1','非表示の親から一時的に表示階層を持ち上げる');
  await outlineCompletedMenu(page,{toggle:true});
  assert.equal(await row(page,'子の作業').getAttribute('aria-level'),'2','再表示すると元の親子関係を復元');
  await page.reload();
  assert.equal(await row(page,'子の作業').getAttribute('aria-level'),'2','実データの親子関係は変えていない');
});
check('P3','スマホでも完了済みを表示・非表示できる',async(page)=>{
  await put(page,'スマホで完了した行');
  await row(page,'スマホで完了した行').focus();
  await page.keyboard.press('Control+Enter');
  await page.getByRole('button',{name:'完了済み 1件を表示'}).click();
  assert.equal(await row(page,'スマホで完了した行').isVisible(),true);
  await page.getByRole('button',{name:'完了済み 1件を隠す'}).click();
  assert.equal(await row(page,'スマホで完了した行').count(),0);
  const tap=await page.getByRole('button',{name:'完了済み 1件を表示'}).boundingBox();
  assert.ok(tap && tap.height>=44,'スマホで押しやすい高さ '+tap?.height);
});
check('P2','字下げ・字上げは親子関係を保存する',async(page)=>{
  await put(page,'親A');await put(page,'子B');await put(page,'兄弟C');
  await row(page,'子B').focus();
  await page.keyboard.press('Tab');
  await page.waitForFunction(()=>document.querySelector('[role="treeitem"][aria-level="2"]')?.textContent?.includes('子B'));
  await page.reload();
  await assert.equal(await row(page,'子B').getAttribute('aria-level'),'2','再読込後の字下げ');
  await row(page,'子B').focus();await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="treeitem"][aria-level="1"]')].some(x=>x.textContent.includes('子B')));
  await page.reload();
  assert.equal(await row(page,'子B').getAttribute('aria-level'),'1','再読込後の字上げ');
});
check('P2','追加した項目のUndoはインラインの下書きに文章を戻す',async(page)=>{
  await put(page,'復元する行');
  await page.getByRole('button',{name:/追加した行を戻す/}).click();
  const pending=page.locator('.entry-column--sentence .outline__edit--pending');
  await pending.waitFor({state:'visible'});
  assert.equal(await pending.inputValue(),'復元する行');
  assert.equal(await row(page,'復元する行').count(),0);
});
check('P2','文章の途中でEnterすると、末尾を次の行へ分割できる',async(page)=>{
  await put(page,'左右');
  await row(page,'左右').locator('.outline__content').click();
  const editing=page.getByRole('textbox',{name:'アウトラインの本文を編集'});
  await editing.evaluate(el=>el.setSelectionRange(1,1));
  await editing.press('Enter');
  const pending=page.locator('.entry-column--sentence .outline__edit--pending');
  await pending.waitFor({state:'visible'});
  assert.equal(await pending.inputValue(),'右');
  await pending.press('Enter');
  await row(page,'左').waitFor({state:'visible'});
  await row(page,'右').waitFor({state:'visible'});
});
check('P2','複数行ペーストは空白行と記号を除いて兄弟項目になる',async(page)=>{
  await selectKind(page,'sentence');
  await page.evaluate(() => {
    const el=document.querySelector('.entry-column--sentence .outline__edit--pending');
    const data=new DataTransfer();
    data.setData('text/plain','先頭A\n\n• 中央B\n- 末尾C');
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  const expected=['先頭A','中央B','末尾C'];
  // 連続DB保存の途中でReactが一時的に一覧を再描画するため、3行の安定を待つ。
  const hasAll = items => JSON.stringify(items) === JSON.stringify(expected);
  await page.waitForFunction((items) =>
    JSON.stringify([...document.querySelectorAll('.outline__content')].map(el=>el.textContent))===JSON.stringify(items),
    expected);
  assert.ok(hasAll(await outline(page).locator('.outline__content').allTextContents()));
  await page.reload();
  await page.waitForFunction((items) =>
    JSON.stringify([...document.querySelectorAll('.outline__content')].map(el=>el.textContent))===JSON.stringify(items),
    expected);
  assert.ok(hasAll(await outline(page).locator('.outline__content').allTextContents()));
});
check('P2','兄弟行は密着し、子グループを抜けるところだけ5px空く',async(page)=>{
  for(const content of ['大項目A','子項目A1','子項目A2','大項目B'])await put(page,content);
  for(const content of ['子項目A1','子項目A2']){
    await row(page,content).focus();
    await page.keyboard.press('Tab');
    await page.waitForFunction(value => [...document.querySelectorAll('[role="treeitem"][aria-level="2"]')]
      .some(node=>node.textContent?.includes(value)),content);
  }
  const groupStart=row(page,'大項目B').locator('..');
  assert.ok((await groupStart.getAttribute('class'))?.includes('outline__item-wrap--group-start'));
  assert.equal(await groupStart.evaluate(el=>getComputedStyle(el).marginTop),'5px');
  const sibling=row(page,'子項目A2').locator('..');
  assert.equal(await sibling.evaluate(el=>getComputedStyle(el).marginTop),'0px');
});
check('P2','折り返す長文は編集時に本文が隠れない',async(page)=>{
  await put(page,'長文の編集対象');
  await row(page,'長文の編集対象').locator('.outline__content').click();
  const input=page.getByRole('textbox',{name:'アウトラインの本文を編集'});
  await input.fill('文章を途中で隠さず編集するための長文。'.repeat(12));
  const size=await input.evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));
  assert.ok(size.scroll>33,'長文は複数行に折り返される '+JSON.stringify(size));
  assert.ok(size.client>=size.scroll-2,'入力欄が全体を表示する '+JSON.stringify(size));
});
check('P2','上下キーで項目間の編集カーソルが移動し、書き続けられる',async(page)=>{
  for(const content of ['カーソルA','カーソルB','カーソルC']) await put(page,content);
  const order=await outline(page).locator('.outline__content').allTextContents();
  const firstId=await row(page,order[0]).getAttribute('data-outline-id');
  const targetId=await row(page,order[1]).getAttribute('data-outline-id');
  await row(page,order[0]).locator('.outline__content').click();
  const edit=page.getByRole('textbox',{name:'アウトラインの本文を編集'});
  await edit.press('ArrowDown');
  assert.equal(await edit.evaluate(el=>el.closest('[data-outline-id]')?.getAttribute('data-outline-id')),targetId,'下の行へ編集カーソル移動');
  assert.equal(await edit.evaluate(el=>document.activeElement===el),true,'移動先ですぐに入力できる');
  await page.keyboard.type('追記');
  await edit.press('Home');
  await edit.press('ArrowUp');
  assert.equal(await edit.evaluate(el=>el.closest('[data-outline-id]')?.getAttribute('data-outline-id')),firstId,'上の行へ編集カーソル移動');
  await page.waitForFunction(()=>[...document.querySelectorAll('.outline__content')].some(el=>el.textContent?.includes('追記')));
});
check('P2','Shift+Alt+上下で親子のまとまりごと兄弟順を入れ替える',async(page)=>{
  for(const content of ['移動親','移動子','移動先']) await put(page,content);
  const order=await outline(page).locator('.outline__content').allTextContents();
  await row(page,order[1]).focus();await page.keyboard.press('Tab');
  const parentId=await row(page,order[0]).getAttribute('data-outline-id');
  await page.waitForFunction(([id,txt])=>[...document.querySelectorAll('[data-outline-id]')].some(el=>el.getAttribute('data-outline-parent-id')===id&&el.textContent?.includes(txt)),[parentId,order[1]]);
  await row(page,order[0]).locator('.outline__content').click();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await page.waitForFunction(([last,head])=>[...document.querySelectorAll('.outline__tree [data-outline-id]')].filter(el=>!el.getAttribute('data-outline-parent-id')).map(el=>el.textContent).join('|').indexOf(last)<[...document.querySelectorAll('.outline__tree [data-outline-id]')].filter(el=>!el.getAttribute('data-outline-parent-id')).map(el=>el.textContent).join('|').indexOf(head),[order[2],order[0]]);
  await page.keyboard.press('Escape');
  assert.equal(await row(page,order[1]).getAttribute('data-outline-parent-id'),parentId,'子項目の所属は維持');
  await page.reload();
  assert.equal(await row(page,order[1]).getAttribute('data-outline-parent-id'),parentId,'保存後も親子関係を維持');
  const rootLabels=await outline(page).locator('[data-outline-id][data-outline-parent-id=""] .outline__content').allTextContents();
  assert.deepEqual(rootLabels,[order[2],order[0]],'入れ替えた兄弟順を保存');
});
check('P2','折り返した項目内では上下キーを通常の文字カーソルに使う',async(page)=>{
  await put(page,'折り返し検証');
  await put(page,'隣の項目');
  const order=await outline(page).locator('.outline__content').allTextContents();
  await row(page,order[0]).locator('.outline__content').click();
  const edit=page.getByRole('textbox',{name:'アウトラインの本文を編集'});
  const multiline='テスト文章'.repeat(100);
  await edit.fill(multiline);
  await edit.evaluate(el=>el.setSelectionRange(Math.floor(el.value.length/2),Math.floor(el.value.length/2)));
  const before=await edit.evaluate(el=>el.closest('[data-outline-id]').getAttribute('data-outline-id'));
  await edit.press('ArrowDown');
  assert.equal(await edit.evaluate(el=>el.closest('[data-outline-id]').getAttribute('data-outline-id')),before,'途中の表示行は同一項目内に留まる');
});
check('P2','追加ボタンは挿入先階層に揃っている',async(page)=>{
  await put(page,'追加階層親');await put(page,'追加階層子');
  const order=await outline(page).locator('.outline__content').allTextContents();
  await row(page,order[1]).focus();await page.keyboard.press('Tab');
  await page.waitForFunction(text=>[...document.querySelectorAll('[data-outline-id][aria-level="2"]')].some(el=>el.textContent?.includes(text)),order[1]);
  assert.equal(await page.getByRole('button',{name:'最上位に項目を追加'}).count(),1);
  const positions=await outline(page).locator('.outline__insert-between').evaluateAll(nodes=>nodes.map(el=>({
    level:Number(el.style.getPropertyValue('--outline-depth')),left:parseFloat(getComputedStyle(el).marginLeft)
  })));
  assert.ok(positions.some(p=>p.level===1&&p.left>=positions.find(x=>x.level===0).left+14),'子階層の追加口は15px右側: '+JSON.stringify(positions));
});
check('P2','兄弟を移動し、直前の移動を取り消せる',async(page)=>{
  await put(page,'上A');await put(page,'下B');
  const initial=await outline(page).locator('.outline__content').allTextContents();
  await row(page,initial[1]).focus();await page.keyboard.press('Control+Shift+ArrowUp');
  await page.waitForFunction(text=>document.querySelector('.outline__content')?.textContent===text,initial[1]);
  await page.getByRole('button',{name:/移動を戻す/}).click();
  await page.waitForFunction(text=>document.querySelector('.outline__content')?.textContent===text,initial[0]);
  assert.deepEqual(await outline(page).locator('.outline__content').allTextContents(),initial);
});
check('P2','作成・位置指定・再読込で重複しない',async(page)=>{
  await put(page,'先頭');await put(page,'末尾');
  // v0.8.0: 行を選んで直し、Enterで次の一行へ。そこへ書くと、直した行の直後に入る(行の下書きと項目の詳細は無くなった)
  await row(page,'先頭').focus();await page.keyboard.press('Enter');
  const edit=page.getByRole('textbox',{name:'アウトラインの本文を編集'});
  await edit.fill('先頭改訂');await edit.press('Enter');
  await page.keyboard.type('途中');await page.keyboard.press('Enter');
  await row(page,'途中').waitFor();
  await page.reload();
  const persisted=await outline(page).locator('.outline__content').allTextContents();
  assert.equal(persisted.filter(x=>x==='途中').length,1,'重複作成なし');
  assert.equal(persisted.indexOf('途中'),persisted.indexOf('先頭改訂')+1,'選択行の直後に挿入');
});
check('P3','折りたたみと集中表示を解除できる',async(page)=>{
  await put(page,'節A');await put(page,'節B');
  // 利用者の「先頭／末尾へ追加」設定に依存させない。先頭表示を親、次を子にする。
  const before=await outline(page).locator('.outline__content').allTextContents();
  assert.equal(before.length,2);
  const [parentText,childText]=before;
  await row(page,childText).focus();
  await page.keyboard.press('Tab');
  await page.waitForFunction(text=>[...document.querySelectorAll('[role="treeitem"][aria-level="2"]')].some(x=>x.textContent.includes(text)),childText);
  // sort_orderが同じでもparent_idだけ変わる移動をDBへ必ず保存する。
  const parentId=await row(page,parentText).getAttribute('data-outline-id');
  assert.equal(await row(page,childText).getAttribute('data-outline-parent-id'),parentId);
  await page.reload();
  await row(page,childText).waitFor({state:'visible'});
  assert.equal(await row(page,childText).getAttribute('aria-level'),'2','リロード後に親子関係が保たれる');
  await row(page,parentText).getByRole('button',{name:/子項目を折りたたむ/}).click();
  assert.equal(await row(page,childText).count(),0);
  await row(page,parentText).getByRole('button',{name:/子項目を展開/}).click();
  assert.equal(await row(page,childText).count(),1);
  await row(page,parentText).getByRole('button',{name:'この枝に集中'}).click();
  assert.equal(await page.getByRole('navigation',{name:'アウトラインのズーム位置'}).count(),1);
  await page.getByRole('button',{name:'全体'}).click();
  assert.equal(await row(page,parentText).count(),1);
});
check('P3','スマホでもアウトライン項目が表示される',async(page)=>{
  await put(page,'モバイル入力');
  const item=row(page,'モバイル入力');
  assert.equal(await item.isVisible(),true);
  const bb=await item.boundingBox();
  assert.ok(bb.height>=44 && bb.height<=50,'スマホの行高はタップ領域を残して約44px '+bb.height);
});
const browser=await chromium.launch({headless:true});
let failed=0, passed=0;
try {
 for(const phase of ['P1','P2','P3']) {
  if(!phases.has(phase))continue;
  for(const item of checks.filter(x=>x.phase===phase)) {
   const s=await fresh(browser,phase==='P3'&&item.name.includes('スマホ')?375:1366);
   try {await item.fn(s.page);console.log('OK',phase,item.name);passed++;}
   catch(e){failed++;console.error('NG',phase,item.name,String(e.stack||e));}
   finally {await s.context.close();}
  }
 }
} finally {await browser.close();}
console.log('アウトラインQA:',passed,'合格',failed,'不合格');
if(failed)process.exitCode=1;
