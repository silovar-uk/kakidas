import { useEffect, useRef, useState } from "react";
import { normalizeSatisfaction } from "../types/memo";

type EntrySatisfactionControlProps = {
  value: number;
  disabled?: boolean;
  onChange: (nextValue: number) => Promise<unknown> | unknown;
};

const SATISFACTION_VALUES = [0, 1, 2, 3, 4, 5] as const;

/**
 * 0〜5を選ぶコンパクトなプルダウン。
 * 以前の循環ボタンと違い、目的の値を一度で選べるため、
 * 評価順の表示で項目が移動しても連続操作にならない。
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
  }, [value, isSaving]);

  const change = async (nextValue: number) => {
    if (disabled || isSaving) return;

    const normalized = normalizeSatisfaction(nextValue);
    const previous = normalizeSatisfaction(displayValue);

    if (normalized === previous) return;

    // プルダウンを閉じた直後にも、選んだ値を即座に反映する。
    setDisplayValue(normalized);
    setIsSaving(true);

    try {
      await onChange(normalized);
      savedValueRef.current = normalized;
    } catch {
      // 保存に失敗した場合だけ、選択を直前の値へ戻す。
      setDisplayValue(savedValueRef.current);
    } finally {
      setIsSaving(false);
    }
  };

  const label = `満足度 ${displayValue} / 5`;

  return (
    <select
      className="entry-satisfaction"
      value={displayValue}
      data-satisfaction={displayValue}
      onChange={(event) => void change(Number(event.target.value))}
      disabled={disabled || isSaving}
      aria-label={label}
      title={label}
    >
      {SATISFACTION_VALUES.map((score) => (
        <option key={score} value={score}>
          {score}
        </option>
      ))}
    </select>
  );
}
