import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const base=process.env.BASE_URL||'http://127.0.0.1:4173/';
const out=process.env.OUT||'/tmp/kakidas-write-focus';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const tests=[{w:375,h:700,mobile:true},{w:768,h:850,mobile:true},{w:921,h:800},{w:1366,h:850}];
let passed=0,failed=0;
function luminance(rgb){
  const vals=(rgb.match(/[0-9.]+/g)||[]).slice(0,3).map(Number);
  if(vals.length!==3)throw Error('Unexpected RGB '+rgb);
  const l=vals.map(c=>{const x=c/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});
  return l[0]*.2126+l[1]*.7152+l[2]*.0722;
}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
for(const v of tests){
 const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},locale:'ja-JP'});
 const page=await ctx.newPage();page.setDefaultTimeout(10000);
 try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/新しいメモ/}).first().click();
  await page.waitForURL(/\/memos\//);
  const desk=page.locator('.desk-host .entry-composer--desk').first();
  await desk.waitFor({state:'visible'});
  await page.getByRole('textbox',{name:'メモのタイトル'}).fill('配色テスト：書く場所を主役にする');
  const evidence=await page.evaluate(()=>{
    const get=(s)=>{const el=document.querySelector(s);if(!el)return null;const c=getComputedStyle(el),r=el.getBoundingClientRect();return{background:c.backgroundColor,color:c.color,border:c.borderLeftColor,rect:{x:r.x,right:r.right,y:r.y,bottom:r.bottom},focused:el.matches(':focus-within')}};
    return {desk:get('.desk-host .entry-composer--desk'),textarea:get('.entry-composer__textarea'),outline:get('.entry-column--sentence'),paragraph:get('.entry-column--paragraph'),word:get('.entry-column--word'),header:get('.entry-column--paragraph .entry-column__header h2'),viewport:innerWidth,scroll:document.documentElement.scrollWidth};
  });
  assert(evidence.desk,'Writing surface is missing');
  assert(evidence.textarea,'Writing textarea is missing');
  assert(contrast(evidence.textarea.color,evidence.desk.background)>=4.5,'Text contrast <4.5: '+JSON.stringify(evidence));
  assert(contrast('rgb(98,94,87)','rgb(246,245,242)')>=4.5,'Rest text contrast <4.5');
  assert(evidence.scroll<=evidence.viewport+2,'Horizontal overflow '+JSON.stringify(evidence));
  if(!v.mobile){
    assert(luminance(evidence.desk.background)>luminance(evidence.paragraph.background),'Writing paper is not brighter than inactive column');
    assert(luminance(evidence.outline.background)>luminance(evidence.paragraph.background),'Active column is not brighter');
    await page.getByRole('button',{name:'段落を書く',exact:true}).first().click();
    await page.locator('.entry-column--paragraph .desk-host .entry-composer--desk').waitFor({state:'visible'});
    // 明度は140msで変わる。移動の瞬間ではなく遷移後の安定状態を測定する。
    await page.waitForTimeout(240);
    const moved=await page.evaluate(()=>({active:getComputedStyle(document.querySelector('.entry-column--paragraph')).backgroundColor,other:getComputedStyle(document.querySelector('.entry-column--sentence')).backgroundColor}));
    assert(luminance(moved.active)>luminance(moved.other),'Light did not follow the moved writing surface: '+JSON.stringify(moved));
  }else{
    assert(luminance(evidence.desk.background)>luminance(evidence.outline.background),'Mobile writing surface is not brighter than list');
    await page.getByRole('tab',{name:/^段落/}).first().click();
    assert.equal(await page.locator('.editor-tab--active').count(),1,'Mobile tab activation lost');
  }
  await page.screenshot({path:resolve(out,'write-focus-'+v.w+'.png'),animations:'disabled'});
  console.log('PASS',v.w,JSON.stringify({textContrast:contrast(evidence.textarea.color,evidence.desk.background).toFixed(2),desk:evidence.desk.background,inactive:evidence.paragraph.background}));
  passed++;
 }catch(e){
  failed++;console.error('FAIL',v.w,e.stack||String(e));
  try{await page.screenshot({path:resolve(out,'error-'+v.w+'.png')})}catch{}
 }finally{await ctx.close()}
}
await browser.close();
console.log('Writing focus QA',passed,'passed',failed,'failed');
if(failed)process.exitCode=1;
