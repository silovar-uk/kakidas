import test from "node:test";
import assert from "node:assert/strict";
import { HEADING_COLORS, normalizeHeadingColor, headingColorHex, sharedHeadingColor, isMissingHeadingColorColumn, prepareHeadingColorUpload, legacyCloudWouldLoseHeadingColor } from "../src/lib/headingColor.js";
test("seven named choices, invalid and legacy values use default", () => {
  assert.equal(HEADING_COLORS.length, 7);
  for (const color of HEADING_COLORS) assert.equal(normalizeHeadingColor(color.id),color.id);
  for (const value of [undefined,"#ff0000","url(x)","unknown"]) assert.equal(normalizeHeadingColor(value),null);
  assert.equal(headingColorHex(null),undefined);
  assert.equal(headingColorHex("red"),"#a03932");
});
test("clean view shares a linked heading color only when all agree", () => {
  assert.equal(sharedHeadingColor([{heading_color:"red"},{heading_color:"red"}]),"red");
  assert.equal(sharedHeadingColor([{heading_color:"red"},{heading_color:"blue"}]),null);
  assert.equal(sharedHeadingColor([{heading_color:"red"},{}]),null);
  assert.equal(sharedHeadingColor([]),null);
});
test("old cloud schema detection is strict", () => {
  assert.equal(isMissingHeadingColorColumn({code:"42703",message:"column entries.heading_color does not exist"}),true);
  assert.equal(isMissingHeadingColorColumn({code:"PGRST204",message:"Could not find heading_color"}),true);
  assert.equal(isMissingHeadingColorColumn({code:"42501",message:"heading_color denied"}),false);
});
test("legacy cloud uploads remain compatible without silently discarding color", () => {
  const plain = {kind:"paragraph",heading:"abc",heading_color:null};
  assert.deepEqual(prepareHeadingColorUpload([plain],false),[{kind:"paragraph",heading:"abc"}]);
  assert.equal(prepareHeadingColorUpload([plain],true)[0].heading_color,null);
  assert.throws(()=>prepareHeadingColorUpload([{...plain,heading_color:"red"}],false));
  assert.equal(prepareHeadingColorUpload([{...plain,heading_color:"red"}],true)[0].heading_color,"red");
  assert.equal(plain.heading_color,null);
});
test("legacy cloud import cannot silently overwrite local heading colors", () => {
  const local=[{kind:"paragraph",deleted_at:null,heading_color:"red"}];
  assert.equal(legacyCloudWouldLoseHeadingColor(local,[{}]),true);
  assert.equal(legacyCloudWouldLoseHeadingColor(local,[{heading_color:null}]),false);
  assert.equal(legacyCloudWouldLoseHeadingColor([{...local[0],heading_color:null}],[{}]),false);
});
test("all seven colors exceed 4.5 to 1 on existing paper and sheet", () => {
  const luminance = hex => hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  for (const {hex} of HEADING_COLORS) for(const bg of ["#f5f4f0","#fffefb","#ffffff"]) assert.ok((luminance(bg)+.05)/(luminance(hex)+.05)>=4.5,hex);
});
