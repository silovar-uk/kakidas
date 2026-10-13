// kakidas v0.7.0: アウトライナー固有の受け入れ確認。
// 既存の仕立て・研ぎのQAと独立して実施する。実ユーザーデータには触れない。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + '/').href : import.meta.url;
const { chromium } = createRequire(base)('playwright');
const url = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const phases = new Set((process.env.QA_PHASES || 'P1,P2,P3').split(',').map(x => x.trim()));
const checks = [];
function check(phase, name, fn) { checks.push({ phase, name, fn }); }
const outline = page => page.locator('.outline__tree');
const row = (page, text) => outline(page).locator('[role="treeitem"]').filter({ has: page.locator('.outline__content', { hasText: text }) }).first();
const entries = page => outline(page).locator('[role="treeitem"]');
async function put(page, content) {
  await page.getByRole('radio', { name: 'アウトライン', exact: true }).click();
  const desk = page.getByRole('textbox', { name: '書く', exact: true });
  await desk.fill(content);
  await desk.press('Enter');
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
  for(const [key,label] of [['Control+Shift+1','アウトライン'],['Control+Shift+2','段落'],['Control+Shift+3','参考URL']]){
    await page.keyboard.press(key);
    await page.waitForFunction(name=>[...document.querySelectorAll('[role="radio"]')].some(el=>el.getAttribute('aria-label')===name && el.getAttribute('aria-checked')==='true'),label);
    assert.equal(await page.getByRole('radio',{name:label,exact:true}).getAttribute('aria-checked'),'true',key);
    assert.equal(await page.getByRole('textbox',{name:'書く',exact:true}).evaluate(e=>document.activeElement===e),true,key+' フォーカス');
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
check('P1','高密度表示を切り替えられる',async(page)=>{
  assert.equal(await page.locator('.outline--dense').count(),1);
  await page.getByRole('button',{name:'標準に戻す'}).click();
  assert.equal(await page.locator('.outline--normal').count(),1);
  await page.getByRole('button',{name:'高密度',exact:true}).click();
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
check('P2','兄弟を移動し、直前の移動を取り消せる',async(page)=>{
  await put(page,'上A');await put(page,'下B');
  const initial=await outline(page).locator('.outline__content').allTextContents();
  await row(page,initial[1]).focus();await page.keyboard.press('Control+Shift+ArrowUp');
  await page.waitForFunction(text=>document.querySelector('.outline__content')?.textContent===text,initial[1]);
  await page.getByRole('button',{name:'直前の移動を戻す'}).click();
  await page.waitForFunction(text=>document.querySelector('.outline__content')?.textContent===text,initial[0]);
  assert.deepEqual(await outline(page).locator('.outline__content').allTextContents(),initial);
});
check('P2','作成・位置指定・再読込で重複しない',async(page)=>{
  await put(page,'先頭');await put(page,'末尾');
  await row(page,'先頭').getByRole('button',{name:'項目の詳細'}).click();
  await row(page,'先頭').getByRole('button',{name:'項目の詳細'}).click();
  await row(page,'先頭').focus();await page.keyboard.press('Enter');
  const edit=page.getByRole('textbox',{name:'アウトラインの本文を編集'});
  await edit.fill('先頭改訂');await edit.press('Enter');
  const draft=page.getByRole('textbox',{name:'新しいアウトライン項目'});
  await draft.fill('途中');await draft.press('Enter');
  await row(page,'途中').waitFor();
  await page.reload();
  const persisted=await outline(page).locator('.outline__content').allTextContents();
  assert.equal(persisted.filter(x=>x==='途中').length,1,'重複作成なし');
  assert.equal(persisted.indexOf('途中'),persisted.indexOf('先頭改訂')+1,'選択行の直後に挿入');
});
check('P3','折りたたみと集中表示を解除できる',async(page)=>{
  await put(page,'子節');await put(page,'親節');
  const before=await outline(page).locator('.outline__content').allTextContents();
  if(before.indexOf('親節') > before.indexOf('子節')) {
    await row(page,'親節').focus();await page.keyboard.press('Control+Shift+ArrowUp');
    await page.waitForFunction(()=>document.querySelector('.outline__content')?.textContent==='親節');
  }
  await row(page,'子節').focus();await page.keyboard.press('Tab');
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="treeitem"][aria-level="2"]')].some(x=>x.textContent.includes('子節')));
  await row(page,'親節').getByRole('button',{name:'子を折りたたむ'}).click();
  assert.equal(await row(page,'子節').count(),0);
  await row(page,'親節').getByRole('button',{name:'子を展開'}).click();
  assert.equal(await row(page,'子節').count(),1);
  await row(page,'親節').getByRole('button',{name:'この枝に集中'}).click();
  assert.equal(await page.getByRole('navigation',{name:'アウトラインのズーム位置'}).count(),1);
  await page.getByRole('button',{name:'全体'}).click();
  assert.equal(await row(page,'親節').count(),1);
});
check('P3','スマホでもアウトライン項目が表示される',async(page)=>{
  await put(page,'モバイル入力');
  const item=row(page,'モバイル入力');
  assert.equal(await item.isVisible(),true);
  const bb=await item.boundingBox();
  assert.ok(bb.height>=44,'スマホの行高 '+bb.height);
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
