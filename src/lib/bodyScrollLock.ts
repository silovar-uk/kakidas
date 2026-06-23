/**
 * モーダル／ボトムシート用のスクロールロック。
 *
 * 各オーバーレイに固有のトークンを発行して管理する。React Strict Mode、
 * 画面遷移、モバイルの表示切替が重なっても、同じ解除関数が二度ロックを
 * 解除したり、古いオーバーレイのロックが残り続けたりしないようにする。
 */
type ScrollLockSnapshot = {
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  rootOverflow: string;
};

let activeLocks = new Set<number>();
let nextLockId = 0;
let snapshot: ScrollLockSnapshot | null = null;

function restoreScrollStyles() {
  if (typeof document === "undefined") return;

  if (snapshot) {
    document.body.style.overflow = snapshot.bodyOverflow;
    document.body.style.overscrollBehavior = snapshot.bodyOverscrollBehavior;
    document.documentElement.style.overflow = snapshot.rootOverflow;
    snapshot = null;
    return;
  }

  // 以前の画面・古いJSが残した inline style も、次の画面では引きずらない。
  document.body.style.overflow = "";
  document.body.style.overscrollBehavior = "";
  document.documentElement.style.overflow = "";
}

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }

  if (activeLocks.size === 0) {
    snapshot = {
      bodyOverflow: document.body.style.overflow,
      bodyOverscrollBehavior: document.body.style.overscrollBehavior,
      rootOverflow: document.documentElement.style.overflow,
    };

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
  }

  const lockId = ++nextLockId;
  activeLocks.add(lockId);
  let released = false;

  return () => {
    if (released || typeof document === "undefined") return;
    released = true;
    activeLocks.delete(lockId);

    if (activeLocks.size === 0) {
      restoreScrollStyles();
    }
  };
}

/**
 * 画面遷移・ページ離脱・モバイル表示切替用の安全弁。
 * 表示中のダイアログがないのに操作だけが止まる状態を解消する。
 */
export function resetBodyScrollLock() {
  if (typeof document === "undefined") return;

  activeLocks.clear();
  restoreScrollStyles();
}
