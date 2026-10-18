import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {selectKind} from '../amu/kinds.mjs';
const base=process.env.PW_FROM?pathToFileURL(resolve(process.env.PW_FROM)+'/').href:import.meta.url;
const {chromium}=createRequire(base)('playwright');
const URL0=process.env.BASE_URL||'http://127.0.0.1:4173/';
const widths=[320,360,375,390,430,560,768,920,921,1024,1200,1366,1600];
const out=process.env.QA_SHOTS_DIR||'./layout-shots';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
let passes=0,failures=0;
for(const width of widths){
 const mobile=width<=920;
 const ctx=await browser.newContext({viewport:{width,height:720},locale:'ja-JP',timezoneId:'Asia/Tokyo',...(mobile?{isMobile:true,hasTouch:true,deviceScaleFactor:2}:{})});
 ctx.setDefaultTimeout(8000);
 await ctx.route('**/api/link-preview**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"title":"URL"}'}));
 const page=await ctx.newPage(),problems=[];
 try{
  await page.goto(URL0,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/新しいメモ/}).first().click();
  await page.waitForURL(/\/memos\//);
  await page.getByRole('textbox',{name:'メモのタイトル'}).fill('長いタイトルで操作ボタンが重ならないことを検証する');
  const desk=page.getByRole('textbox',{name:'書く',exact:true});
  for(const [label,value] of [['アウトライン','文字数が長いアウトラインと操作ボタンの重なりを確認する。'.repeat(2)],['アウトライン','二つ目のアウトライン'],['段落','本文の段落を追加する'],['参考URL','https://example.com/path/long-123456789']]){
   await selectKind(page,{'アウトライン':'sentence','段落':'paragraph','参考URL':'word'}[label]);await desk.fill(value);await desk.press('Enter');await page.waitForTimeout(160);
  }
  if(mobile)await page.getByRole('tab',{name:/^アウトライン/}).first().click();
  const m=await page.evaluate(()=>{
   const R=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};
   const valid=e=>{if(!e)return false;const r=R(e),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity>0.1};
   const rects=sel=>[...document.querySelectorAll(sel)].filter(valid);
   const coll=(a,b)=>Math.max(0,Math.min(R(a).right,R(b).right)-Math.max(R(a).x,R(b).x))*Math.max(0,Math.min(R(a).bottom,R(b).bottom)-Math.max(R(a).y,R(b).y));
   const header=rects('.editor-header--shitate input,.editor-header--shitate button,.editor-header--shitate .back-link');
   const name=e=>e.getAttribute('aria-label')||e.textContent.trim().slice(0,15);
   const overlap=[];
   for(let i=0;i<header.length;i++)for(let j=i+1;j<header.length;j++)if(!header[i].contains(header[j])&&!header[j].contains(header[i])&&coll(header[i],header[j])>32)overlap.push([name(header[i]),name(header[j]),Math.round(coll(header[i],header[j]))]);
   const dest=rects('.entry-composer--desk .entry-composer__destinations button');
   const meta=rects('.entry-composer--desk .entry-composer__meta-controls button');
   const formOverlap=dest.flatMap(a=>meta.filter(b=>coll(a,b)>24).map(b=>[name(a),name(b)]));
   const rail=document.querySelector('.entry-column--collapsed .entry-column__collapsed-rail');
   const label=rail?.querySelector('.entry-column__collapsed-label');
   const count=rail?.querySelector('.entry-column__collapsed-count');
   const chevron=rail?.querySelector('.entry-column__collapsed-chevron');
   const railOverlap=rail&&label&&count&&chevron?Math.max(coll(label,count),coll(label,chevron),coll(count,chevron)):0;
   const row=rects('.outline__item')[0],text=row?.querySelector('.outline__content'),actions=row?.querySelector('.outline__actions');
   const visibleActions=row?[...row.querySelectorAll('.outline__actions button')].filter(valid):[];
   const col=document.querySelector('.entry-column--sentence');
   const outOfColumn=col?[...col.querySelectorAll('.outline__content')].filter(e=>R(e).right>R(col).right+2).length:0;
   const clickable=[...header,...dest,...meta,...visibleActions];
   const offscreen=clickable.filter(x=>R(x).x<-1||R(x).right>innerWidth+1).map(name);
   return {width:innerWidth,scroll:document.documentElement.scrollWidth,overlap,formOverlap,rowOverlap:text&&actions?coll(text,actions):0,outOfColumn,railOverlap,mobileActions:visibleActions.length,offscreen};
  });
  if(m.scroll>m.width+2)problems.push('水平スクロール '+m.scroll+'/'+m.width);
  if(m.overlap.length)problems.push('ヘッダー '+JSON.stringify(m.overlap));
  if(m.formOverlap.length)problems.push('入力操作 '+JSON.stringify(m.formOverlap));
  if(m.rowOverlap>16)problems.push('行本文とボタン '+m.rowOverlap);
  if(m.outOfColumn)problems.push('アウトラインの本文が隣の列へはみ出す '+m.outOfColumn);
  if(m.railOverlap>4)problems.push('収納URLレール内の操作が重なる '+m.railOverlap);
  if(mobile&&m.mobileActions!==1)problems.push('行のメニュー数 '+m.mobileActions);
  if(m.offscreen.length)problems.push('画面外 '+m.offscreen.join(','));
  // 移り変わりが落ち着いた通常画面も保存。操作シートを開いた後の画像と混同しない。
  await page.waitForTimeout(380);
  await page.screenshot({path:resolve(out,'layout-'+width+'.png')});
  if(mobile){
   await page.locator('.outline__item').first().getByRole('button',{name:'この項目の操作'}).click({timeout:3000});
   const modal=page.getByRole('dialog',{name:/.+/});
   const action=modal.getByRole('menuitem',{name:'階層・段落の操作'});
   await action.click({timeout:3000});
   await page.locator('.outline__details').first().waitFor({state:'visible',timeout:3000});
  }
  if(problems.length){failures++;console.error('NG',width,problems.join('; '));}
  else{passes++;console.log('OK',width,'overflow',m.scroll-m.width);}
 }catch(e){failures++;console.error('NG',width,String(e.stack||e).slice(0,850));try{await page.screenshot({path:resolve(out,'error-'+width+'.png')})}catch{}}
 finally{await ctx.close()}
}
await browser.close();
console.log('responsive-layout QA',passes,'passed',failures,'failed');
if(failures)process.exitCode=1;
