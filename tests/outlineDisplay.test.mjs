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


const displayRows = (rows) => rows.map((r, i) => ({
  id: r.id, parent_id: r.parent_id ?? null, content: r.content ?? "", heading: r.heading ?? "",
  outline_number: "stale", child_count: 0, has_children: false, sort_order: i,
}));

test("blank rows keep their identity and position but are not numbered", () => {
  const rows = displayRows([
    {id:"A", content:"市場分析"}, {id:"gap", content:""}, {id:"space", content:" \t\n "},
    {id:"B", content:"競合分析"}, {id:"C", content:"事業戦略"},
  ]);
  const before = JSON.stringify(rows);
  const result = numberMeaningfulOutline(rows);
  assert.deepEqual(result.map(r => r.outline_number), ["1","","","2","3"]);
  assert.deepEqual(result.map(r => r.id), rows.map(r => r.id));
  assert.equal(JSON.stringify(rows), before, "numbering does not mutate rows");
});

test("empty ancestors are transparent to numbering but keep their tree structure", () => {
  const rows = displayRows([
    {id:"A", content:"市場分析"},
    {id:"blankA", parent_id:"A", content:""},
    {id:"B", parent_id:"blankA", content:"国内市場"},
    {id:"C", parent_id:"A", content:"海外市場"},
    {id:"blankRoot", content:""},
    {id:"D", parent_id:"blankRoot", content:"競合分析"},
    {id:"E", content:"事業戦略"},
  ]);
  const result = numberVisibleOutline(rows);
  assert.deepEqual(result.map(r => r.outline_number), ["1","","1.1","1.2","","2","3"]);
  assert.equal(result[1].has_children, true, "blank parent can still be folded");
  assert.equal(result[1].child_count, 1);
  assert.equal(result[2].parent_id, "blankA", "actual parent_id is preserved");
});

test("heading-only paragraph counts, metadata-only and whitespace-only paragraphs do not", () => {
  const rows = displayRows([
    {id:"a", content:"", heading:"第1章"},
    {id:"b", content:"", heading:""},
    {id:"c", content:"  ", heading:" \t "},
    {id:"d", content:"本文", heading:""},
  ]);
  rows[1].tag = "important";
  assert.equal(isNumberableEntry(rows[0]), true);
  assert.equal(isNumberableEntry(rows[1]), false);
  assert.deepEqual(numberMeaningfulOutline(rows).map(r=>r.outline_number), ["1","","","2"]);
});

test("typing and clearing a formerly blank row renumbers siblings without saving", () => {
  const rows = displayRows([{id:"A", content:"A"}, {id:"draft", content:""}, {id:"B", content:"B"}]);
  assert.deepEqual(numberMeaningfulOutline(rows).map(r=>r.outline_number), ["1","","2"]);
  const typing = rows.map(r=>r.id==="draft" ? {...r, content:"作成中"} : r);
  assert.deepEqual(numberMeaningfulOutline(typing).map(r=>r.outline_number), ["1","2","3"]);
  const cleared = typing.map(r=>r.id==="draft" ? {...r,content:""} : r);
  assert.deepEqual(numberMeaningfulOutline(cleared).map(r=>r.outline_number), ["1","","2"]);
});

test("only the focused empty row receives a provisional number", () => {
  const rows = displayRows([
    {id:"A",content:"市場分析"}, {id:"blank1"}, {id:"blank2"}, {id:"B",content:"競合分析"},
  ]);
  const before = JSON.stringify(rows);
  assert.deepEqual(numberMeaningfulOutline(rows).map(r=>r.outline_number), ["1","","","2"]);
  assert.deepEqual(numberMeaningfulOutline(rows,{previewId:"blank1"}).map(r=>r.outline_number),
    ["1","2","","3"]);
  assert.deepEqual(numberMeaningfulOutline(rows,{previewId:"blank2"}).map(r=>r.outline_number),
    ["1","","2","3"]);
  assert.deepEqual(numberMeaningfulOutline(rows).map(r=>r.outline_number), ["1","","","2"]);
  assert.equal(JSON.stringify(rows),before,"preview never changes saved rows");
});

test("focused empty parents gain a hierarchical number without moving descendants", () => {
  const rows = displayRows([
    {id:"A",content:"親"}, {id:"blank",parent_id:"A"},
    {id:"child",parent_id:"blank",content:"子"}, {id:"sibling",parent_id:"A",content:"兄弟"},
    {id:"B",content:"次の親"},
  ]);
  assert.deepEqual(numberMeaningfulOutline(rows).map(r=>r.outline_number),
    ["1","","1.1","1.2","2"]);
  const preview = numberMeaningfulOutline(rows,{previewId:"blank"});
  assert.deepEqual(preview.map(r=>r.outline_number), ["1","1.1","1.1.1","1.2","2"]);
  assert.equal(preview[2].parent_id,"blank","real parent stays unchanged");
});

test("preview on draft row at sibling insertion point renumbers only the view", () => {
  const rows = displayRows([
    {id:"A",content:"A"},{id:"__pending__"},{id:"B",content:"B"},
  ]);
  assert.deepEqual(numberMeaningfulOutline(rows,{previewId:"__pending__"}).map(r=>r.outline_number),
    ["1","2","3"]);
  assert.deepEqual(numberMeaningfulOutline(rows).map(r=>r.outline_number), ["1","","2"]);
});

test("completion filtering and blank rows both skip counts", () => {
  const rows = displayRows([
    {id:"A", content:"A"},
    {id:"blank",content:""},
    {id:"done", content:"done"},
    {id:"B",content:"B"},
  ]);
  rows[2].is_completed = true;
  const visible = numberVisibleOutline(visibleOutlineWithAncestors(rows));
  assert.deepEqual(visible.map(r=>[r.id,r.outline_number]),
    [["A","1"],["blank",""],["B","2"]]);
});
