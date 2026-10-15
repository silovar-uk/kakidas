import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs';
const url=process.env.BASE_URL||'http://127.0.0.1:4173/outliner-lab.html';
const browser=await chromium.launch({headless:true});
let pass=0,fail=0;
const sizes=[320,375,430,768,920,1366];
const shots=process.env.SHOT_DIR||'/tmp/outliner-lab-shots';
fs.mkdirSync(shots,{recursive:true});
async function fresh(width=1366){
 const context=await browser.newContext({viewport:{width,height:800},locale:'ja-JP'});
 const page=await context.newPage();
 page.setDefaultTimeout(9000);
 await page.goto(url);
 await page.evaluate(()=>localStorage.removeItem('kakidas-p0-lab.v1'));
 await page.reload();
 return {context,page};
}
async function trial(name,fn,width=1366){
 const {context,page}=await fresh(width);
 try{await fn(page);console.log('PASS',name);pass++;}
 catch(e){console.error('FAIL',name,String(e.stack||e).slice(0,1600));fail++;try{await page.screenshot({path:shots+'/failed-'+fail+'.png'})}catch{}}
 finally{await context.close()}
}
const state=page=>page.evaluate(()=>window.__kakidasLab.getState());
await trial('30行を連続入力しフォーカスと保存を維持',async page=>{
 await page.locator('[data-editor-id="n7"]').click();
 for(let i=0;i<30;i++){await page.keyboard.press('Enter');assert.equal(await page.locator('textarea.node-text:focus').count(),1,i);await page.keyboard.type('検証の行 '+i)}
 await page.keyboard.press('Escape');
 assert.equal((await state(page)).nodes.length,37);
 assert.equal((await state(page)).nodes.at(-1).text,'検証の行 29');
 await page.reload();assert.equal((await state(page)).nodes.length,37);
});
await trial('字下げ・字上げの親IDが正しい',async page=>{
 await page.locator('[data-editor-id="n3"]').click();await page.keyboard.press('Tab');
 assert.equal((await state(page)).nodes.find(x=>x.id==='n3').parent,'n2');
 await page.keyboard.press('Shift+Tab');
 assert.equal((await state(page)).nodes.find(x=>x.id==='n3').parent,'n1');
});
await trial('枝の一括移動と複数段Undo・Redo',async page=>{
 const before=(await state(page)).nodes;
 await page.evaluate(()=>window.__kakidasLab.action('down','n1'));
 const moved=(await state(page)).nodes;
 assert.deepEqual(moved.slice(0,3).map(x=>x.id),['n4','n5','n6']);
 await page.evaluate(()=>window.__kakidasLab.action('indent','n3'));
 await page.getByRole('button',{name:'元に戻す'}).first().click();
 assert.equal((await state(page)).nodes.find(x=>x.id==='n3').parent,'n1');
 await page.getByRole('button',{name:'元に戻す'}).first().click();
 assert.deepEqual((await state(page)).nodes,before);
 await page.getByRole('button',{name:'やり直す'}).click();
 assert.deepEqual((await state(page)).nodes,moved);
});
await trial('葉ノードにズームして見出しを直接編集',async page=>{
 await page.getByRole('button',{name:'「まだ分からないこと」に集中'}).click();
 assert.equal((await state(page)).zoom,'n7');
 await page.locator('.zoom-title').fill('葉の見出し');
 await page.locator('.zoom-title').blur();
 await page.getByRole('button',{name:'全体'}).click();
 assert.equal(await page.locator('[data-editor-id="n7"]').inputValue(),'葉の見出し');
});
await trial('日本語IME合成Enterで行は増えない',async page=>{
 const t=page.locator('[data-editor-id="n7"]');await t.focus();
 await t.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true})));
 assert.equal((await state(page)).nodes.length,7);
});
await trial('未整理欄から即時保存',async page=>{
 await page.locator('#capture-text').fill('未整理案');
 await page.locator('#capture-text').press('Enter');
 const x=(await state(page)).nodes.at(-1);
 assert.equal(x.text,'未整理案');assert.equal(x.parent,null);
});
await trial('閲覧中の矢印移動とTabによるコンポーネント離脱',async page=>{
 await page.locator('[data-editor-id="n2"]').click();await page.keyboard.press('Escape');
 assert(await page.locator('[data-node-id="n2"]').evaluate(el=>el===document.activeElement));
 await page.keyboard.press('ArrowDown');
 assert(await page.locator('[data-node-id="n3"]').evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Tab');
 assert(!await page.locator('[data-node-id="n3"]').evaluate(el=>el===document.activeElement));
});
await trial('インラインの構造操作メニューから字下げ',async page=>{
 await page.locator('[data-node-id="n3"] .more').click();
 assert.equal(await page.getByRole('menuitem',{name:'字下げ'}).count(),1);
 await page.getByRole('menuitem',{name:'字下げ'}).click();
 assert.equal((await state(page)).nodes.find(x=>x.id==='n3').parent,'n2');
});
for(const width of sizes)await trial(width+'pxでの本文・ボタンはみ出し確認',async page=>{
 const result=await page.evaluate(()=>{const t=document.querySelector('.node-text').getBoundingClientRect();return {vp:innerWidth,sw:document.documentElement.scrollWidth,right:t.right}});
 assert(result.sw<=result.vp+2,JSON.stringify(result));
 assert(result.right<=result.vp+1,JSON.stringify(result));
 await page.screenshot({path:shots+'/viewport-'+width+'.png'});
},width);
await browser.close();
console.log('P0 QA',pass,'/',pass+fail,'passed');
if(fail)process.exitCode=1;