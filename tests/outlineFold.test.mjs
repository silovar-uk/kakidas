import test from "node:test";
import assert from "node:assert/strict";
import { foldableBranchesAtLevel, toggleFoldedLevel, parseFoldedIds } from "../src/lib/outlineFold.js";

const row = (id, parent_id, depth, has_children) => ({id,parent_id,depth,has_children});
const tree = [
 row("A",null,0,true),row("A1","A",1,true),row("A1a","A1",2,false),
 row("A2","A",1,false),row("B",null,0,true),
 row("B1","B",1,true),row("B1a","B1",2,false),row("C",null,0,false),
];
test("the number of each parent is its own fold control; only that branch changes",()=>{
 const initial=new Set(["B1"]);
 const next=new Set(initial); next.add("A");
 assert.deepEqual([...next].sort(),["A","B1"]);
 assert.equal(next.has("A1"),false);
});
test("fold all branches at selected depth without folding other levels",()=>{
 const closed=toggleFoldedLevel(new Set(),tree,1);
 assert.deepEqual([...closed].sort(),["A1","B1"]);
 assert.equal(closed.has("A"),false);
 const open=toggleFoldedLevel(closed,tree,1);
 assert.equal(open.size,0);
});
test("partly folded level becomes consistently folded, then fully expanded",()=>{
 const mixed=new Set(["A1","A"]);
 const closed=toggleFoldedLevel(mixed,tree,1);
 assert.deepEqual([...closed].sort(),["A","A1","B1"]);
 const opened=toggleFoldedLevel(closed,tree,1);
 assert.deepEqual([...opened],["A"]);
});
test("zoom scopes same-depth operation to descendants of active root",()=>{
 assert.deepEqual(foldableBranchesAtLevel(tree,1,"A"),["A1"]);
 assert.deepEqual(foldableBranchesAtLevel(tree,1,"B"),["B1"]);
 assert.deepEqual(foldableBranchesAtLevel(tree,0,"A"),[]);
 assert.deepEqual([...toggleFoldedLevel(new Set(),tree,1,"A")],["A1"]);
});
test("deep nesting and cycles cannot leak into unrelated subtrees",()=>{
 const corrupt=[row("loop1","loop2",3,true),row("loop2","loop1",3,true),row("valid",null,0,true)];
 assert.deepEqual(foldableBranchesAtLevel(corrupt,3,"valid"),[]);
});
test("read fold preference safely and deduplicate persisted IDs",()=>{
 assert.deepEqual(parseFoldedIds('["A","B","A",2]'),["A","B"]);
 assert.deepEqual(parseFoldedIds("broken"),[]);
 assert.deepEqual(parseFoldedIds('{"collapsed":["A"]}'),[]);
 assert.deepEqual(parseFoldedIds(null),[]);
});
