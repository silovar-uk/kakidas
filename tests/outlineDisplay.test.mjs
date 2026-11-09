import test from "node:test";
import assert from "node:assert/strict";
import { isNumberableEntry, numberMeaningfulOutline, numberVisibleOutline } from "../src/lib/outlineDisplay.js";
import { visibleOutlineWithAncestors } from "../src/lib/outlineCompletion.js";

const row = (id, parent_id, number, completed = false, child_count = 0) =>
  ({id, parent_id, content:id, heading:"", outline_number:number, is_completed:completed, child_count,
    has_children:child_count>0, sort_order:Number(number.split(".").at(-1))-1});

test("hidden completed root no longer occupies a display number",()=>{
  const all=[row("A",null,"1"),row("H",null,"2",true),row("B",null,"3")];
  const original=JSON.stringify(all);
  const visible=numberVisibleOutline(visibleOutlineWithAncestors(all));
  assert.deepEqual(visible.map(r=>[r.id,r.outline_number]),[["A","1"],["B","2"]]);
  assert.equal(JSON.stringify(all),original);
  assert.deepEqual(all.map(r=>r.outline_number),["1","2","3"]);
});
test("hidden completed children are skipped independently within each parent",()=>{
  const all=[
    row("A",null,"1",false,3),row("A1","A","1.1",true),row("A2","A","1.2"),row("A3","A","1.3"),
    row("B",null,"2",false,2),row("B1","B","2.1",true),row("B2","B","2.2"),
  ];
  assert.deepEqual(numberVisibleOutline(visibleOutlineWithAncestors(all)).map(r=>r.outline_number),
    ["1","1.1","1.2","2","2.1"]);
});
test("completed parent remains numbered when an incomplete child needs it",()=>{
  const all=[row("A",null,"1"),row("H",null,"2",true,2),row("H1","H","2.1",true),row("H2","H","2.2"),row("B",null,"3")];
  const visible=numberVisibleOutline(visibleOutlineWithAncestors(all));
  assert.deepEqual(visible.map(r=>[r.id,r.outline_number]),[["A","1"],["H","2"],["H2","2.1"],["B","3"]]);
  assert.equal(visible.find(r=>r.id==="H").has_children,true);
});
test("parent with only hidden completed children no longer shows a misleading fold control",()=>{
  const all=[row("A",null,"1",false,1),row("A1","A","1.1",true),row("B",null,"2")];
  const visible=numberVisibleOutline(visibleOutlineWithAncestors(all));
  assert.equal(visible[0].has_children,false);
  assert.equal(visible[0].child_count,0);
  assert.equal(all[0].has_children,true);
});
test("collapsed branches do not change numbering; only completion filtering does",()=>{
  const all=[row("A",null,"1",false,2),row("A1","A","1.1"),row("A2","A","1.2"),row("B",null,"2")];
  const visible=numberVisibleOutline(all);
  assert.deepEqual(visible.map(r=>r.outline_number),all.map(r=>r.outline_number));
  assert.equal(visible[0].child_count,2);
  assert.equal(visible[0].has_children,true);
});
test("multiple ancestors, deep numbering and descendants after filtering",()=>{
  const all=[
    row("A",null,"1",false,4),row("A1","A","1.1",false,3),
    row("A11","A1","1.1.1",true),row("A12","A1","1.1.2",false,1),
    row("A121","A12","1.1.2.1"),row("B",null,"2")
  ];
  const visible=numberVisibleOutline(visibleOutlineWithAncestors(all));
  assert.deepEqual(visible.map(r=>r.outline_number),["1","1.1","1.1.1","1.1.1.1","2"]);
  assert.equal(visible[0].child_count,3);
  assert.equal(visible[1].child_count,2);
});
