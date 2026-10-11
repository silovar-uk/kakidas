import type {RefObject} from "react";
import {getEntryTree,getLinkHostname, type EntryTreeNode,type EntrySortMode,type MemoWithEntries} from "../types/memo";
type Props={memo:MemoWithEntries; title:string;sortMode:EntrySortMode;includeCompleted:boolean;
  onBack:()=>void;onCopy:()=>void;onPrint:()=>void;paperRef:RefObject<HTMLElement|null>};
function displayedTitle(value:string,created:string){
 const m=value.match(/^(\d{1,2})\/(\d{1,2})\s*([^「]+)「([^」]+)」$/u);
 if(!m)return {headline:value,day:""};
 const year=new Date(created).getFullYear();
 return {headline:m[4],day:`${year}年${Number(m[1])}月${Number(m[2])}日(${m[3].trim()})`};
}
function Entries({items}: {items:EntryTreeNode[]}){
 // 親子の順序を保ちながら字下げする。入れ子の視覚表現は余白で示す。
 return <ul className="seisho__list">{items.map((item,index)=><li key={item.id} style={{paddingInlineStart:`${item.depth*1.25}em`,viewTransitionName:index<60?`e-${item.id}`:undefined}}>{item.content}</li>)}</ul>;
}
export function SeishoView({memo,title,sortMode,includeCompleted,onBack,onCopy,onPrint,paperRef}:Props){
 const all=includeCompleted?memo.entries:memo.entries.filter(e=>!e.is_completed);
 const words=getEntryTree(all,'word',sortMode).filter(e=>Boolean(e.link_url));
 const sentences=getEntryTree(all,'sentence',sortMode);
 const paragraphs=getEntryTree(all,'paragraph',sortMode);
 const done=memo.entries.filter(e=>e.is_completed).length;
 const heading=displayedTitle(title,memo.created_at);
 let ordinal=0;
 return <div className="seisho-view">
  <div className="seisho-tools" aria-label="清書の道具">
    <button onClick={onBack}>書き口へ戻る</button>
    <button onClick={onCopy}>書式つきでコピー</button>
    <button onClick={onPrint}>印刷・PDF</button>
  </div>
  <article className="seisho-paper" ref={paperRef} aria-label="清書">
    <div className="seisho-paper__date">{heading.day}{memo.tag?`　#${memo.tag}`:""}</div>
    <h1 style={{viewTransitionName:'memo-title'}}>{heading.headline}</h1>
    {sentences.length>0?<section><h2>要点</h2><Entries items={sentences}/></section>:null}
    {paragraphs.length>0?<section><h2>本文</h2>{paragraphs.map(entry=><div className="seisho-paragraph" key={entry.id} style={{viewTransitionName:ordinal++<60?`e-${entry.id}`:undefined}}>
      {entry.heading?<h3>{entry.heading}</h3>:null}<p>{entry.content}</p></div>)}</section>:null}
    {words.length>0?<section><h2>参考</h2><ul className="seisho-references">{words.map(entry=><li key={entry.id} style={{viewTransitionName:ordinal++<60?`e-${entry.id}`:undefined}}>
      <a href={entry.link_url} target="_blank" rel="noreferrer">{entry.content}</a>
      <small>{getLinkHostname(entry.link_url)}</small>{entry.note?<p>{entry.note}</p>:null}
    </li>)}</ul></section>:null}
    <span className="seisho-stamp" aria-label="落款">書出</span>
  </article>
  <p className="seisho-note">完了した{done}件、満足度、文と段落の気持ち・備考は清書に含めていません。</p>
 </div>;
}
