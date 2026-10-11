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
   if(e.altKey&&!e.ctrlKey&&!e.metaKey&&['1','2','3'].includes(digit)){
     e.preventDefault();window.dispatchEvent(new CustomEvent('kakidas:choose-entry-kind',{
       detail:({1:'word',2:'sentence',3:'paragraph'} as Record<string,string>)[digit]}));
   }
 };const show=()=>setOpen(true);window.addEventListener('keydown',action);
 window.addEventListener('kakidas:show-shortcuts',show);
 return()=>{window.removeEventListener('keydown',action);window.removeEventListener('kakidas:show-shortcuts',show)};
 },[pathname]);
 useEffect(()=>{if(!open)return;const release=lockBodyScroll();return release},[open]);
 return open?<div className="shortcut-overlay" role="presentation" onClick={()=>setOpen(false)}>
 <section role="dialog" aria-modal="true" aria-label="ショートカット" onClick={e=>e.stopPropagation()}>
 <h2>ショートカット</h2><p>Alt+1：参考URL、Alt+2：文、Alt+3：段落</p>
 <p>文・参考URLはEnterで置く。Shift+Enterは段落へ。段落はCtrl+Enterで置く。</p>
 <p>Ctrl+/：この説明を開く。Esc：閉じる。</p>
 <button onClick={()=>setOpen(false)}>閉じる</button></section></div>:null;
}
