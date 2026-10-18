import {flushSync} from "react-dom";

type ViewTransitionOptions = {
  /**
   * 清書の切り替え・「段落にする」・「アウトラインに引く」のように、動きを見せたいときだけtrue。
   * 始める前に <html> へ amu-vt を付け(動きを止める規則を外し)、終わったら外す。
   * 置くときの移り変わりは、今までどおり動かさない(残像がボタンの上に乗るため)。
   */
  scoped?: boolean;
};

/** 機能のない端末と動きを減らす端末では、状態の更新だけ行う。 */
export async function withViewTransition(update:()=>void|Promise<unknown>,options:ViewTransitionOptions={}):Promise<void>{
  if(typeof document==='undefined'||!document.startViewTransition||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches){await update();return;}
  const root=document.documentElement;
  if(options.scoped)root.classList.add('amu-vt');
  const transition=document.startViewTransition(async()=>{
    let result:void|Promise<unknown> = undefined;
    flushSync(()=>{result=update()});
    await result;
  });
  // 新しい移行が始まると finished は AbortError で拒否される。
  // updateCallbackDone が成功していても未処理例外にならないよう監視する。
  // ready も開始前の中断で拒否される。標準的な競合は無害。
  void transition.ready.catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error("画面遷移の開始に失敗しました", error);
    }
  });
  void transition.finished.catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error("画面の移り変わりに失敗しました", error);
    }
  }).finally(() => {
    if(options.scoped)root.classList.remove('amu-vt');
  });
  try {
    await transition.updateCallbackDone;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  }
}

/** IndexedDB保存後の描画を少しだけ待ち、写しと行の形をつなぐ。
 * 移り変わりの更新中は描画が止まり、requestAnimationFrameが来ないため、タイマーで待つ。 */
export async function waitForCreatedEntry(id:string, limitMs=300): Promise<void>{
  if(typeof document==='undefined')return;
  const selector=`[data-entry-id="${CSS.escape(id)}"]`;
  const until=performance.now()+limitMs;
  while(!document.querySelector(selector)&&performance.now()<until){
    await new Promise<void>(resolve=>window.setTimeout(resolve,16));
  }
}
