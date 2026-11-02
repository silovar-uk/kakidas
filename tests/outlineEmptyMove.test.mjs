import test from "node:test";
import assert from "node:assert/strict";
import { siblingMoveIndex } from "../src/lib/outlineMove.js";
import { buildOutlineCopy } from "../src/lib/outlineCopy.js";
import { normalizeOutlineItems, serializeOutlineItems, analyzeOutlinePaste } from "../src/lib/outlinePaste.js";

const row = (id, parent_id=null, sort_order=0, content=id) => ({ id, parent_id, sort_order, content, created_at:"2026-11-02", is_completed:false });
test("Move a parent branch below the next visible sibling, skipping hidden completed rows",()=>{
 const all=[row("A",null,0),row("child","A",0),row("hidden",null,1),row("B",null,2),row("grand","B",0)];
 const shown=all.filter(x=>x.id!=="hidden");
 assert.equal(siblingMoveIndex(all,shown,"A","down"),2);
 assert.equal(siblingMoveIndex(all,shown,"B","up"),0);
 assert.equal(siblingMoveIndex(all,shown,"A","up"),null);
 assert.equal(siblingMoveIndex(all,shown,"B","down"),null);
});
test("Moves nested siblings by their own parent and never uses child count as index",()=>{
 const all=[row("p"),row("first","p",0),row("grand","first"),row("hidden","p",1),row("last","p",2)];
 const shown=all.filter(x=>x.id!=="hidden");
 assert.equal(siblingMoveIndex(all,shown,"first","down"),2);
 assert.equal(siblingMoveIndex(all,shown,"last","up"),0);
});
test("Blank root and nested items survive outline copy/paste as real empty content",()=>{
 const rows=[row("a",null,0,""),row("b","a",0,"inner"),row("c","a",1,"")];
 const plain=buildOutlineCopy(rows,{mode:"outliner"});
 assert.equal(plain.text,"•\n\tinner\n\t•");
 const parts=normalizeOutlineItems(plain.text);
 assert.deepEqual(parts,[{content:"",depth:0},{content:"inner",depth:1},{content:"",depth:1}]);
 assert.equal(serializeOutlineItems(parts),plain.text);
});
test("Numbered text copy also preserves blank items when pasted as outline",()=>{
 const rows=[row("a",null,0,""),row("b","a",0,"child")];
 const numbered=buildOutlineCopy(rows,{mode:"textMemo"});
 assert.equal(numbered.text,"1. •\n  1.1 child");
 const parsed=analyzeOutlinePaste(numbered.text,{mode:"two"}).items;
 assert.deepEqual(parsed,[{content:"",depth:0},{content:"child",depth:1}]);
});
test("Whitespace-only separation is NOT interpreted as empty items",()=>{
 assert.deepEqual(normalizeOutlineItems("a\n\n\tb"),[{content:"a",depth:0},{content:"b",depth:1}]);
});
