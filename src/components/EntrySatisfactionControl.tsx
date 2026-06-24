import { useEffect, useRef, useState } from "react";
import { normalizeSatisfaction } from "../types/memo";

type EntrySatisfactionControlProps = {
  value: number;
  disabled?: boolean;
  onChange: (nextValue: number) => Promise<unknown> | unknown;
};

/**
 * 0〜5を一つの小さな数字で示す満足度コントロール。
 * タップごとに 0 → 1 → … → 5 → 0 と循環する。
 * 色は青から赤へ寄せるが、kakidasの落ち着いた紙色に馴染む低彩度に留める。
 */
export function EntrySatisfactionControl({
  value,
  disabled = false,
  onChange,
}: EntrySatisfactionControlProps) {
  const [displayValue, setDisplayValue] = useState(() =>
    normalizeSatisfaction(value),
  );
  const [isSaving, setIsSaving] = useState(false);
  const savedValueRef = useRef(normalizeSatisfaction(value));

  useEffect(() => {
    const normalized = normalizeSatisfaction(value);
    savedValueRef.current = normalized;

    if (!isSaving) {
      setDisplayValue(normalized);
    }
  }, [value]);

  const advance = async () => {
    if (disabled || isSaving) return;

    const current = normalizeSatisfaction(displayValue);
    const next = current >= 5 ? 0 : current + 1;

    // 先に数字だけ更新する。小さな操作なので、体感を止めずに反映する。
    setDisplayValue(next);
    setIsSaving(true);

    try {
      await onChange(next);
      savedValueRef.current = next;
    } catch {
      // 保存に失敗した場合だけ、画面上の数字を直前の値へ戻す。
      setDisplayValue(savedValueRef.current);
    } finally {
      setIsSaving(false);
    }
  };

  const label = `満足度 ${displayValue} / 5。タップで1ずつ上がり、5の次は0になります。`;

  return (
    <button
      type="button"
      className="entry-satisfaction"
      data-satisfaction={displayValue}
      onClick={() => void advance()}
      disabled={disabled || isSaving}
      aria-label={label}
      title={label}
    >
      {displayValue}
    </button>
  );
}
