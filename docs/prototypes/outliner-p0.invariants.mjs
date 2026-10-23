// P0構造編集の再現可能な性質ベース検査。ユーザーデータを使わない。
// 既存の14ケースとは独立に、seed付きランダム操作で木構造・Undo/Redo・再読込を評価する。
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const pageUrl=process.env.BASE_URL||'http://127.0.0.1:4173/outliner-lab.html';
const SEEDS=Number(process.env.FUZZ_SEEDS||24);
const STEPS=Number(process.env.FUZZ_STEPS||45);
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({locale:'ja-JP'});
const page=await ctx.newPage();
page.setDefaultTimeout(10000);
let checked=0,changes=0,failures=[];
for(let seed=1;seed<=SEEDS;seed++){
  await page.goto(pageUrl);
  await page.evaluate(()=>localStorage.removeItem('kakidas-p0-lab.v1'));
  await page.reload();
  const result=await page.evaluate(({seed,steps})=>{
    let x=seed*2654435761>>>0;
    const rand=(max)=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)%max;};
    const state=()=>window.__kakidasLab.getState().nodes;
    const normalize=ns=>ns.map(n=>({id:n.id,parent:n.parent,text:n.text}));
    const snap=()=>JSON.stringify(normalize(state()));
    function verify(nodes,trace){
      const ids=nodes.map(n=>n.id);
      if(new Set(ids).size!==ids.length)throw Error('duplicate ids');
      const map=new Map(nodes.map(n=>[n.id,n]));
      for(const n of nodes){if(n.parent!==null&&!map.has(n.parent))throw Error('missing parent '+n.id);
        let at=n,seen=new Set();
        while(at){if(seen.has(at.id))throw Error('parent cycle '+n.id);seen.add(at.id);at=at.parent?map.get(at.parent):null;}
      }
      // 階層DFS順 = ノード配列順を検証。枝が一続きにならない場合、移動でデータ欠損する可能性がある。
      const out=[],walk=(pid)=>{for(const n of nodes.filter(v=>v.parent===pid)){out.push(n.id);walk(n.id)}};
      walk(null);
      if(out.length!==ids.length||out.some((v,i)=>v!==ids[i]))throw Error('invalid preorder at '+trace.join(' > ').slice(-320)+' expected '+out.join(',')+' got '+ids.join(','));
    }
    const trace=[];
    verify(state(),trace);
    let changes=0,checks=0;
    for(let i=0;i<steps;i++){
      const before=snap(), ids=state().map(n=>n.id);
      const pick=ids[rand(ids.length)];
      const actions=['indent','outdent','up','down','new','undo','redo'];
      const kind=actions[rand(actions.length)];
      trace.push(kind+':'+pick);
      if(kind==='new')window.__kakidasLab.addAfter(pick,false);
      else window.__kakidasLab.action(kind,pick);
      if(snap()!==before)changes++;
      verify(state(),trace);checks++;
    }
    return {seed,changes,checks,last:snap(),trace:trace.slice(-8)};
  },{seed,steps:STEPS}).catch(e=>({seed,error:String(e.stack||e)}));
  if(result.error){failures.push(result);console.error('FAIL seed',seed,result.error.slice(0,1800));break;}
  try{
    const before=result.last;
    await page.reload();
    const after=await page.evaluate(()=>JSON.stringify(window.__kakidasLab.getState().nodes.map(n=>({id:n.id,parent:n.parent,text:n.text}))));
    assert.equal(after,before,'保存・再読み込み後の不一致 seed='+seed);
    checked+=result.checks;changes+=result.changes;
    console.log('PASS seed',seed,'checks',result.checks,'actualChanges',result.changes);
  }catch(e){failures.push({seed,error:String(e)});console.error('FAIL',seed,String(e));break;}
}
await browser.close();
console.log(JSON.stringify({kind:'p0_property_test',seedCount:SEEDS,stepsPerSeed:STEPS,invariantChecks:checked,stateChanges:changes,failureCount:failures.length,failures},null,2));
if(failures.length)process.exitCode=1;
