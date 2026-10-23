import { useLayoutEffect, useRef } from "react";
import { restoreDeskFocus } from "../lib/deskFocus";

type DeskSlotProps = {
  /** 書き口がこの欄にいるか。 */
  active: boolean;
  /** 書き口の箱。ひとつだけ作り、いる欄へ運ぶ(作り直さない)。 */
  host: HTMLElement;
  /** いない欄の入口ボタンの読み上げ名。 */
  label: string;
  /** いない欄の入口ボタンに見せる文。省略時は label。 */
  text?: string;
  onActivate: () => void;
  className?: string;
};

/** 書き口の置き場所。いる欄では書き口の箱を受け取り、いない欄では入口だけを見せる。 */
export function DeskSlot({ active, host, label, text, onActivate, className }: DeskSlotProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el || host.parentElement === el) return;
    // スマホでは同じ表示スロットを3つの独立した書き口が交代で使う。
    // 前のhostは破棄せずDOMから外すだけ。入力値・選択範囲はそのまま保持する。
    el.replaceChildren(host);
    restoreDeskFocus(host);
  });

  if (active) return <div ref={ref} className={className} />;

  return (
    <button type="button" className="desk-slot__open" aria-label={label} onClick={onActivate}>
      <span aria-hidden="true">＋</span>
      {text ?? label}
    </button>
  );
}
