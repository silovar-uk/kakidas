import {useEffect,useState} from "react";
import {useLocation} from "react-router-dom";
import {lockBodyScroll} from "../lib/bodyScrollLock";
export function KeyboardShortcuts(){
 const {pathname}=useLocation();const[open,setOpen]=useState(false);
 useEffect(()=>{const action=(e:KeyboardEvent)=>{
   if((e.ctrlKey||e.metaKey)&&e.key==='/'){e.preventDefault();setOpen(o=>!o);return;}
   if(e.key==='Escape'){setOpen(false);return;}
   if(!pathname.startsWith('/memos/')||e.isComposing)return;
   const digit = /^Digit[123]$/.test(e.code) ? e.code.slice(-1) : e.key;
   // Alt系は他のアプリ・OSとの競合を避ける。番号は画面の左から順に対応する。
   if((e.ctrlKey||e.metaKey)&&e.shiftKey&&!e.altKey&&['1','2','3'].includes(digit)){
     e.preventDefault();window.dispatchEvent(new CustomEvent('kakidas:choose-entry-kind',{
       detail:({1:'sentence',2:'paragraph',3:'word'} as Record<string,string>)[digit]}));
   }
 };const show=()=>setOpen(true);window.addEventListener('keydown',action);
 window.addEventListener('kakidas:show-shortcuts',show);
 return()=>{window.removeEventListener('keydown',action);window.removeEventListener('kakidas:show-shortcuts',show)};
 },[pathname]);
 useEffect(()=>{if(!open)return;const release=lockBodyScroll();return release},[open]);
 return open?<div className="shortcut-overlay" role="presentation" onClick={()=>setOpen(false)}>
 <section role="dialog" aria-modal="true" aria-label="ショートカット" onClick={e=>e.stopPropagation()}>
 <h2>ショートカット</h2><p>Ctrl+Shift+1：アウトライン、Ctrl+Shift+2：段落、Ctrl+Shift+3：URL（直接入力）</p>
 <p>アウトライン：Enterで編集・次の行、Tab / Shift+Tabで階層変更、Ctrl+Shift+↑↓で並べ替え。編集中のShift+Enterは改行。</p>
 <p>Ctrl+/：この説明を開く。Esc：閉じる。</p>
 <button onClick={()=>setOpen(false)}>閉じる</button></section></div>:null;
}
