import { useEffect, useId, useRef, useState } from "react";
import { HEADING_COLORS, normalizeHeadingColor, headingColorHex, type HeadingColor } from "../lib/headingColor.js";

type Props = { value?: HeadingColor; disabled?: boolean; onChange: (value: HeadingColor) => Promise<unknown> };
export function HeadingColorPicker({ value, disabled = false, onChange }: Props) {
  const current = normalizeHeadingColor(value);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = HEADING_COLORS.find(color => color.id === current)?.label ?? "標準";
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !root.current?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const apply = async (next: HeadingColor) => {
    if (pending || disabled) return;
    if (current === next) { setOpen(false); trigger.current?.focus({ preventScroll: true }); return; }
    setPending(true);
    setError("");
    try {
      await onChange(next);
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    } catch {
      setError("色を保存できませんでした。もう一度お試しください。");
    } finally { setPending(false); }
  };
  return <div className="heading-color-picker" ref={root} onClick={event => event.stopPropagation()}>
    <button type="button" ref={trigger} className="heading-color-picker__trigger" disabled={disabled || pending}
      title="見出しの色" aria-label={`見出しの色を変更（現在：${label}）`} aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { setError(""); setOpen(v => !v); }}>
      <span className="heading-color-picker__dot" style={{ backgroundColor: headingColorHex(current) ?? "transparent" }} aria-hidden="true"/>
    </button>
    {open ? <div className="heading-color-picker__panel" id={panelId} role="group" aria-label="見出しの色を選択">
      <span className="heading-color-picker__caption">見出しの色</span>
      <div className="heading-color-picker__swatches">
        {HEADING_COLORS.map(color => <button type="button" key={color.id ?? "default"} className="heading-color-picker__swatch"
          disabled={disabled || pending} aria-pressed={current === color.id} aria-label={color.label} title={color.label}
          onClick={() => void apply(color.id)}>
          <span style={{ backgroundColor: color.hex }} aria-hidden="true">{current === color.id ? "✓" : ""}</span>
          <small>{color.label}</small>
        </button>)}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </div>;
}
