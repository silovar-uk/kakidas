import test from "node:test";
import assert from "node:assert/strict";
import { siblingPositionAfter, visibleInsertionIndex, previousVisibleSiblingAt, indentPositionAt } from "../src/lib/outlineInsert.js";

const root = (id) => ({ id, parent_id: null, depth: 0 });
const child = (id, parent_id, depth = 1) => ({ id, parent_id, depth });
const tree = [
  root("A"), child("A1", "A"), child("A1a", "A1", 2), child("A2", "A"),
  root("B"), root("C"), child("C1", "C"),
];

test("親を展開していても次の兄弟位置を返す", () => {
  assert.deepEqual(siblingPositionAfter(tree, "A"), {parentId:null,index:1});
  assert.equal(visibleInsertionIndex(tree,tree,null,1),4);
});
test("子項目も同じ階層の次の兄弟へ",()=>{
  assert.deepEqual(siblingPositionAfter(tree,"A1"),{parentId:"A",index:1});
  assert.equal(visibleInsertionIndex(tree,tree,"A",1),3);
});
test("末尾の子の次は親の枝を出る前へ",()=>{
  assert.deepEqual(siblingPositionAfter(tree,"A2"),{parentId:"A",index:2});
  assert.equal(visibleInsertionIndex(tree,tree,"A",2),4);
});
test("完了済みを非表示でも保存順を使う",()=>{
  const visible=tree.filter(x=>x.id!=="B");
  assert.deepEqual(siblingPositionAfter(tree,"A"),{parentId:null,index:1});
  assert.equal(visibleInsertionIndex(tree,visible,null,1),4);
  assert.deepEqual(siblingPositionAfter(tree,"B"),{parentId:null,index:2});
  assert.equal(visibleInsertionIndex(tree,visible,null,2),4);
});
test("折りたたみ中の親でも子群の後ろへ",()=>{
  const visible=tree.filter(x=>!x.id.startsWith("A1")&&x.id!=="A2");
  assert.equal(visibleInsertionIndex(tree,visible,null,1),1);
});
test("最初の子は親の直下へ",()=>{
  const withoutAChildren=tree.filter(x=>!["A1","A1a","A2"].includes(x.id));
  assert.equal(visibleInsertionIndex(withoutAChildren,withoutAChildren,"A",0),1);
});
test("隠れた親の子の所属は変えない",()=>{
  const visible=tree.filter(x=>x.id!=="A");
  assert.deepEqual(siblingPositionAfter(tree,"A1"),{parentId:"A",index:1});
  assert.equal(visibleInsertionIndex(tree,visible,"A",1),2);
});
test("無効な行IDでは挿入しない",()=>{
  assert.equal(siblingPositionAfter(tree,"missing"),null);
});
test("範囲の先頭・末尾",()=>{
  assert.equal(visibleInsertionIndex(tree,tree,null,0),0);
  assert.equal(visibleInsertionIndex(tree,tree,null,100),tree.length);
});

test("表示中はA,Bでも保存順がA,完了H,Bなら、Bの直後からTabでBの子になる",()=>{
  const all=[root("A"),root("H"),root("B")];
  const visible=all.filter(row=>row.id!=="H");
  // This is the old behavior: visible[storedIndex-1] is undefined.
  assert.equal(visible[3-1],undefined);
  assert.equal(previousVisibleSiblingAt(all,visible,null,3)?.id,"B");
  assert.deepEqual(indentPositionAt(all,visible,null,3),{parentId:"B",index:0});
});
test("挿入位置の直前が非表示でも、最後の可視兄弟を基準にする",()=>{
  const all=[root("A"),root("H"),root("B")];
  const visible=all.filter(row=>row.id!=="H");
  assert.equal(previousVisibleSiblingAt(all,visible,null,2)?.id,"A");
  assert.equal(previousVisibleSiblingAt(all,visible,null,1)?.id,"A");
  assert.equal(previousVisibleSiblingAt(all,visible,null,0),null);
  assert.deepEqual(indentPositionAt(all,visible,null,2),{parentId:"A",index:0});
});
test("既存の子孫を保ったまま、子の末尾の保存位置を返す",()=>{
  const all=[root("A"),child("a1","A"),child("a2","A"),root("H"),root("B")];
  assert.deepEqual(indentPositionAt(all,all.filter(row=>row.id!=="H"),null,1),{parentId:"A",index:2});
  assert.deepEqual(indentPositionAt(all,all,"A",2),{parentId:"a2",index:0});
});
test("Shift+Tabの位置は画面の行番号でなく保存順から求める",()=>{
  const all=[root("A"),root("H"),root("B"),child("b1","B")];
  const visible=all.filter(row=>row.id!=="H");
  assert.deepEqual(siblingPositionAfter(all,"B"),{parentId:null,index:3});
  assert.deepEqual(siblingPositionAfter(all,"b1"),{parentId:"B",index:1});
  assert.equal(visible.findIndex(row=>row.id==="B")+1,2);
});
test("完了やズームで可視兄弟がなくても、別階層を親にしない",()=>{
  const all=[root("A"),child("a1","A"),child("a2","A"),root("B")];
  const visible=[root("B")];
  assert.equal(indentPositionAt(all,visible,"A",2),null);
  assert.equal(indentPositionAt(all,visible,null,0),null);
});
