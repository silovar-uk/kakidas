import type {RefObject} from "react";
import {getOutlineBindings} from "../lib/outlineBinding";
import {getEntryTree,getLinkHostname, type EntryRow,type EntryTreeNode,type EntrySortMode,type MemoWithEntries} from "../types/memo";
type Props={memo:MemoWithEntries; title:string;sortMode:EntrySortMode;includeCompleted:boolean;
  onBack:()=>void;onCopy:()=>void;onPrint:()=>void;paperRef:RefObject<HTMLElement|null>};
function displayedTitle(value:string,created:string){
 const m=value.match(/^(\d{1,2})\/(\d{1,2})\s*([^「]+)「([^」]+)」$/u);
 if(!m)return {headline:value,day:""};
 const year=new Date(created).getFullYear();
 return {headline:m[4],day:`${year}年${Number(m[1])}月${Number(m[2])}日(${m[3].trim()})`};
}
/** 先頭60件までに移り変わりの名前を付ける(行・段落が紙へ収まる)。 */
const nameOf=(id:string,ordinal:number)=>ordinal<60?`e-${id}`:undefined;
function Entries({items,knit}:{items:EntryTreeNode[];knit:Map<string,EntryRow[]>}){
 // 親子の順序を保ちながら字下げする。入れ子の視覚表現は余白で示す。
 // 行に結ばれた段落は、その行のすぐ後に編み込む(行頭の点なし・一字下げ)。
 let ordinal=0;
 return <ul className="seisho__list">{items.flatMap(item=>{
  const row=<li key={item.id} style={{paddingInlineStart:`${item.depth*1.25}em`,viewTransitionName:nameOf(item.id,ordinal++)}}>{item.content}</li>;
  const woven=(knit.get(item.id)??[]).map(paragraph=><li key={`knit-${paragraph.id}`} className="seisho__knit"
   style={{paddingInlineStart:`${item.depth*1.25}em`,viewTransitionName:nameOf(paragraph.id,ordinal++)}}>{paragraph.content}</li>);
  return [row,...woven];
 })}</ul>;
}
export function SeishoView({memo,title,sortMode,includeCompleted,onBack,onCopy,onPrint,paperRef}:Props){
 const all=includeCompleted?memo.entries:memo.entries.filter(e=>!e.is_completed);
 const words=getEntryTree(all,'word',sortMode).filter(e=>Boolean(e.link_url));
 const sentences=getEntryTree(all,'sentence',sortMode);
 const paragraphs=getEntryTree(all,'paragraph',sortMode);
 // 結ばれた段落は要点の行の下へ編み込み、本文の節には、結ばれていない段落だけを並べる。
 const {rowByParagraphId}=getOutlineBindings(all);
 const knit=new Map<string,EntryRow[]>();
 for(const paragraph of paragraphs){
  const row=rowByParagraphId.get(paragraph.id);
  if(row)knit.set(row.id,[...(knit.get(row.id)??[]),paragraph]);
 }
 const loose=paragraphs.filter(paragraph=>!rowByParagraphId.has(paragraph.id));
 const done=memo.entries.filter(e=>e.is_completed).length;
 const heading=displayedTitle(title,memo.created_at);
 let ordinal=sentences.length+(Array.from(knit.values()).reduce((sum,list)=>sum+list.length,0));
 return <div className="seisho-view">
  <div className="seisho-tools" aria-label="清書の道具">
    <button onClick={onBack}>書き口へ戻る</button>
    <button onClick={onCopy}>書式つきでコピー</button>
    <button onClick={onPrint}>印刷・PDF</button>
  </div>
  <article className="seisho-paper" ref={paperRef} aria-label="清書">
    <div className="seisho-paper__date">{heading.day}{memo.tag?`　#${memo.tag}`:""}</div>
    <h1 style={{viewTransitionName:'memo-title'}}>{heading.headline}</h1>
    {sentences.length>0?<section><h2>要点</h2><Entries items={sentences} knit={knit}/></section>:null}
    {loose.length>0?<section><h2>本文</h2>{loose.map(entry=><div className="seisho-paragraph" key={entry.id} style={{viewTransitionName:nameOf(entry.id,ordinal++)}}>
      {entry.heading?<h3>{entry.heading}</h3>:null}<p>{entry.content}</p></div>)}</section>:null}
    {words.length>0?<section><h2>参考</h2><ul className="seisho-references">{words.map(entry=><li key={entry.id} style={{viewTransitionName:nameOf(entry.id,ordinal++)}}>
      <a href={entry.link_url} target="_blank" rel="noreferrer">{entry.content}</a>
      <small>{getLinkHostname(entry.link_url)}</small>{entry.note?<p>{entry.note}</p>:null}
    </li>)}</ul></section>:null}
    <span className="seisho-stamp" aria-label="落款">書出</span>
  </article>
  <p className="seisho-note">完了した{done}件、満足度、文と段落の気持ち・備考は清書に含めていません。</p>
 </div>;
}
