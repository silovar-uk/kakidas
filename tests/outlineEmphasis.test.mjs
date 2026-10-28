import test from "node:test";
import assert from "node:assert/strict";
import { toggleOutlineEmphasis, outlineEmphasisSegments, stripOutlineEmphasis } from "../src/lib/outlineEmphasis.js";

test("Ctrl+B: 選択文字列が赤太文字のトークンになる",()=>{
 const next=toggleOutlineEmphasis("国内企業を分析",0,4);
 assert.equal(next.value,"**国内企業**を分析");
 assert.deepEqual([next.start,next.end],[2,6]);
 assert.deepEqual(outlineEmphasisSegments(next.value),[
   {text:"国内企業",emphasized:true},{text:"を分析",emphasized:false}
 ]);
});
test("選択箇所をもう一度Ctrl+Bで解除できる",()=>{
 const next=toggleOutlineEmphasis("**国内企業**を分析",2,6);
 assert.equal(next.value,"国内企業を分析");
 assert.deepEqual([next.start,next.end],[0,4]);
});
test("未選択時は項目全体を強調、再実行で解除",()=>{
 const first=toggleOutlineEmphasis("TAM推計",4,4);
 assert.equal(first.value,"**TAM推計**");
 assert.equal(toggleOutlineEmphasis(first.value,4,4).value,"TAM推計");
});
test("クリップボードへのコピー時にはマークアップを除去",()=>{
 assert.equal(stripOutlineEmphasis("**重要**です"),"重要です");
 assert.equal(stripOutlineEmphasis("通常テキスト"),"通常テキスト");
});
