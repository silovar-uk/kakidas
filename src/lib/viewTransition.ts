import {flushSync} from "react-dom";
/** 機能のない端末と動きを減らす端末では、状態の更新だけ行う。 */
export async function withViewTransition(update:()=>void|Promise<unknown>):Promise<void>{
  if(typeof document==='undefined'||!document.startViewTransition||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches){await update();return;}
  const transition=document.startViewTransition(async()=>{
    let result:void|Promise<unknown> = undefined;
    flushSync(()=>{result=update()});
    await result;
  });
  // 新しい移行が始まると finished は AbortError で拒否される。
  // updateCallbackDone が成功していても未処理例外にならないよう監視する。
  void transition.finished.catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error("画面の移り変わりに失敗しました", error);
    }
  });
  try {
    await transition.updateCallbackDone;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  }
}

/** IndexedDB保存後の描画を少しだけ待ち、写しと行の形をつなぐ。 */
export async function waitForCreatedEntry(id:string, limitMs=300): Promise<void>{
  if(typeof document==='undefined')return;
  const selector=`[data-entry-id="${CSS.escape(id)}"]`;
  const until=performance.now()+limitMs;
  while(!document.querySelector(selector)&&performance.now()<until){
    await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
  }
}
