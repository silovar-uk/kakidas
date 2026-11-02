import test from "node:test";
import assert from "node:assert/strict";
import {planOutlineCompletion,visibleOutlineWithAncestors} from "../src/lib/outlineCompletion.js";
const row=(id,parent_id=null,is_completed=false)=>({id,parent_id,is_completed,kind:"sentence",deleted_at:null});
test("completion cascades, leaving siblings untouched",()=>{
 const changes=planOutlineCompletion([row("root"),row("child","root"),row("grand","child"),row("prior","root",true),row("sibling")],"root",true);
 assert.deepEqual(new Set(changes.map(x=>x.id)),new Set(["root","child","grand"]));
});
test("reopen child also reopens ancestors",()=>{
 const changes=planOutlineCompletion([row("root",null,true),row("child","root",true),row("sibling","root",true)],"child",false);
 assert.deepEqual(new Set(changes.map(x=>x.id)),new Set(["root","child"]));
});
test("legacy completed parent remains visible when a child is not completed",()=>{
 const result=visibleOutlineWithAncestors([row("root",null,true),row("child","root"),row("sibling",null,true)]);
 assert.deepEqual(result.map(x=>x.id),["root","child"]);
});
test("cycles are safely bounded",()=>{
 assert.equal(planOutlineCompletion([row("a","b"),row("b","a")],"a",true).length,2);
});
