/** 書き口を運んだ・描き直したときに外れたフォーカスを戻す。人が別の場所を押したら戻さない。 */
let keep = false;
let last: { el: HTMLInputElement | HTMLTextAreaElement; s: number | null; e: number | null } | null = null;

const remember = (target: EventTarget | null) => {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    last = { el: target, s: target.selectionStart, e: target.selectionEnd };
  }
};

/** 書き口の箱(host)の中の入力を見張る。戻り値で見張りをやめる。 */
export function trackDeskFocus(host: HTMLElement): () => void {
  const onIn = (event: FocusEvent) => { keep = true; remember(event.target); };
  const onEdit = (event: Event) => remember(event.target);
  const onDown = (event: PointerEvent) => { if (!host.contains(event.target as Node)) keep = false; };
  const onAnyIn = (event: FocusEvent) => { if (!host.contains(event.target as Node)) keep = false; };
  const edits = ["input", "keyup", "select", "click"];

  host.addEventListener("focusin", onIn);
  edits.forEach((type) => host.addEventListener(type, onEdit));
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("focusin", onAnyIn);

  return () => {
    host.removeEventListener("focusin", onIn);
    edits.forEach((type) => host.removeEventListener(type, onEdit));
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("focusin", onAnyIn);
  };
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
