import {useEffect,useRef,useState} from "react";
import {lockBodyScroll} from "../lib/bodyScrollLock";
import {MoreIcon} from "./icons";
import {ENTRY_SORT_MODES,ENTRY_SORT_MODE_LABEL,type EntrySortMode} from "../types/memo";
type Props={
  sortMode:EntrySortMode; onSort:(mode:EntrySortMode)=>void;
  options:{label:string;value:boolean;onChange:(value:boolean)=>void}[];
  onCloudSave:()=>void;onCloudSync:()=>void; cloudEnabled:boolean;
  onChat:()=>void;onCopy:()=>void;onDownload:()=>void;onShortcuts:()=>void;
  onDeleteCompleted:()=>void; onDeleteMemo:()=>void;
  attention?:string|null;
};
export function MemoActionsMenu(props:Props){
 const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);const buttonRef=useRef<HTMLButtonElement>(null);
 const close=()=>{setOpen(false);window.requestAnimationFrame(()=>buttonRef.current?.focus({preventScroll:true}));};
 useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}};
 const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))close();};
 const release=window.matchMedia('(max-width:920px)').matches?lockBodyScroll():()=>{};
 window.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);
 return()=>{release();window.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};},[open]);
 const action=(fn:()=>void)=>()=>{setOpen(false);fn()};
 return <div className="memo-actions" ref={ref}>
  <button className="memo-actions__trigger" ref={buttonRef} aria-label="メモの操作" aria-expanded={open} onClick={()=>setOpen(o=>!o)}><MoreIcon />{props.attention?<span className="memo-actions__alert"/>:null}</button>
  {open?<><button className="memo-actions__backdrop" type="button" aria-label="メニューを閉じる" onClick={close}/><div role="menu" className="memo-actions__panel" aria-label="メモの操作">
  {props.attention?<p className="memo-actions__status">{props.attention}</p>:null}
  <p className="memo-actions__caption">クラウド</p>
  <button role="menuitem" disabled={!props.cloudEnabled} title={!props.cloudEnabled?'ログインすると使えます':undefined} onClick={action(props.onCloudSave)}>クラウドに保存</button>
  <button role="menuitem" disabled={!props.cloudEnabled} title={!props.cloudEnabled?'ログインすると使えます':undefined} onClick={action(props.onCloudSync)}>クラウドに合わせる</button>
  <p className="memo-actions__caption">渡す・書き出す</p>
  <button role="menuitem" onClick={action(props.onChat)}>ChatGPTで続きを考える</button>
  <button role="menuitem" onClick={action(props.onCopy)}>メモをコピー</button>
  <button role="menuitem" onClick={action(props.onDownload)}>.txtで書き出す</button>
  <p className="memo-actions__caption">並び順</p>
  {ENTRY_SORT_MODES.map(mode=><button key={mode} role="menuitemradio" aria-checked={mode===props.sortMode} onClick={()=>{props.onSort(mode);close()}}>{ENTRY_SORT_MODE_LABEL[mode]}</button>)}
  <p className="memo-actions__caption">表示</p>
  {props.options.map(option=><button role="menuitemcheckbox" key={option.label} aria-checked={option.value} onClick={()=>option.onChange(!option.value)}>{option.label}</button>)}
  <button role="menuitem" onClick={action(props.onShortcuts)}>ショートカット</button>
  <p className="memo-actions__caption">整理</p>
  <button role="menuitem" onClick={action(props.onDeleteCompleted)}>完了をまとめて削除</button>
  <button role="menuitem" className="memo-actions__danger" onClick={action(props.onDeleteMemo)}>メモを削除</button>
  </div></>:null}
 </div>;
}
