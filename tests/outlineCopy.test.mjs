import test from "node:test";
import assert from "node:assert/strict";
import { buildOutlineCopy } from "../src/lib/outlineCopy.js";

const rows = [
  { id:"r1", parent_id:null, content:"市場調査", is_completed:false },
  { id:"r2", parent_id:"r1", content:"競合分析", is_completed:false },
  { id:"r3", parent_id:"r2", content:"国内企業", is_completed:false },
  { id:"r4", parent_id:"r2", content:"海外企業", is_completed:false },
  { id:"r5", parent_id:"r1", content:"TAM推計", is_completed:false },
  { id:"r6", parent_id:null, content:"結論", is_completed:false },
];
test("アウトライナー用: Tabで階層を表し、HTMLは入れ子のリスト", () => {
  const result=buildOutlineCopy(rows,{mode:"outliner"});
  assert.equal(result.text,"市場調査\n\t競合分析\n\t\t国内企業\n\t\t海外企業\n\tTAM推計\n結論");
  assert.equal(result.count,6);
  assert.match(result.html, /<ul><li>市場調査<ul><li>競合分析<ul><li>国内企業<\/li><li>海外企業<\/li><\/ul><\/li><li>TAM推計<\/li><\/ul><\/li><li>結論<\/li><\/ul>/);
});
test("テキストメモ用: 番号は常に1から、階層ごとに連番", () => {
  const result=buildOutlineCopy(rows,{mode:"textMemo"});
  assert.equal(result.text,"1 市場調査\n  1.1 競合分析\n    1.1.1 国内企業\n    1.1.2 海外企業\n  1.2 TAM推計\n2 結論");
  assert.equal(result.html,null);
});
test("枝コピー: 選択した親と子孫だけを相対階層で出す", () => {
  const result=buildOutlineCopy(rows,{mode:"textMemo",rootId:"r2"});
  assert.equal(result.text,"1 競合分析\n  1.1 国内企業\n  1.2 海外企業");
  assert.equal(buildOutlineCopy(rows,{mode:"outliner",rootId:"r2"}).text,"競合分析\n\t国内企業\n\t海外企業");
});
test("完了済みの親を除外しても子を保持し番号を振り直す", () => {
  const edited=rows.map(r=>({ ...r, is_completed:r.id==="r2"||r.id==="r5" }));
  assert.equal(buildOutlineCopy(edited,{mode:"textMemo"}).text,"1 市場調査\n  1.1 国内企業\n  1.2 海外企業\n2 結論");
  assert.equal(buildOutlineCopy(edited,{mode:"textMemo",rootId:"r2"}).text,"1 国内企業\n2 海外企業");
  assert.equal(buildOutlineCopy(edited,{mode:"textMemo",includeCompleted:true}).count,6);
});
test("折りたたみなどUI状態に依存しない・本文の改行は1行へ", () => {
  const data=rows.map(r=>({...r,depth:5,outline_number:"99",has_children:false}));
  data[2].content="a\nb\tc";
  const result=buildOutlineCopy(data,{mode:"outliner"});
  assert.match(result.text,/\t\ta b c/);
  assert.doesNotMatch(result.text,/99/);
});
test("HTMLはエスケープ・無効な枝の指定は空", () => {
  const data=[{id:"x",parent_id:null,content:"<hello>&\"",is_completed:false}];
  assert.match(buildOutlineCopy(data,{mode:"outliner"}).html,/&lt;hello&gt;&amp;&quot;/);
  assert.deepEqual(buildOutlineCopy(data,{mode:"outliner",rootId:"missing"}),{text:"",html:null,count:0});
  assert.throws(()=>buildOutlineCopy(data,{mode:"unknown"}));
});
test("100件の枝も欠落・重複しない", () => {
  const many=[{id:"root",parent_id:null,content:"Root",is_completed:false}];
  for(let i=0;i<100;i++)many.push({id:"i"+i,parent_id:"root",content:"Entry "+i,is_completed:false});
  const result=buildOutlineCopy(many,{mode:"textMemo",rootId:"root"});
  assert.equal(result.count,101);
  assert.equal(result.text.split("\n").at(-1),"  1.100 Entry 99");
});
