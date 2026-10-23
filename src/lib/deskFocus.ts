/** 書き口を運んだ・描き直したときに外れたフォーカスを戻す。人が別の場所を押したら戻さない。 */
let keep = false;
let last: { el: HTMLInputElement | HTMLTextAreaElement; s: number | null; e: number | null } | null = null;

const remember = (target: EventTarget | null) => {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    last = { el: target, s: target.selectionStart, e: target.selectionEnd };
  }
};

/** 複数の独立した書き口を一つのフォーカス領域として監視する。
 * 旧方式で各hostに監視を付けると、他hostのpointerdownリスナーがkeep=falseにしてしまう。
 * documentの監視は一度だけにし、「いずれかの書き口の中か」を判定する。
 */
export function trackDeskFocusGroup(hosts: readonly HTMLElement[]): () => void {
  const onIn = (event: FocusEvent) => { keep = true; remember(event.target); };
  const onEdit = (event: Event) => remember(event.target);
  const inside = (target: EventTarget | null) =>
    target instanceof Node && hosts.some((host) => host.contains(target));
  const onDown = (event: PointerEvent) => { if (!inside(event.target)) keep = false; };
  const onAnyIn = (event: FocusEvent) => { if (!inside(event.target)) keep = false; };
  const edits = ["input", "keyup", "select", "click"];

  hosts.forEach((host) => {
    host.addEventListener("focusin", onIn);
    edits.forEach((type) => host.addEventListener(type, onEdit));
  });
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("focusin", onAnyIn);

  return () => {
    hosts.forEach((host) => {
      host.removeEventListener("focusin", onIn);
      edits.forEach((type) => host.removeEventListener(type, onEdit));
    });
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("focusin", onAnyIn);
  };
}

/** 単一の書き口向けの互換API。 */
export function trackDeskFocus(host: HTMLElement): () => void {
  return trackDeskFocusGroup([host]);
}

/** Escや↑で自分から書き口を離れるときは、先にこれを呼んで、戻さないようにする。 */
export const releaseDeskFocus = () => { keep = false; };

export function restoreDeskFocus(host: HTMLElement): void {
  if (!keep || !last || !host.contains(last.el) || document.activeElement === last.el) return;
  last.el.focus({ preventScroll: true });
  try {
    last.el.setSelectionRange(last.s ?? last.el.value.length, last.e ?? last.el.value.length);
  } catch {
    /* type=url など、選択位置を持たない入力 */
  }
}
