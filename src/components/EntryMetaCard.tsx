import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getRecommendedEntryTags, type EntryTagSummary } from "../lib/memoTags";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";
import {
  type EntryTreeNode,
  type EntryUpdate,
  normalizeEntryTag,
  normalizeLinkUrlForSave,
} from "../types/memo";

export type EntryMetaKind = "note" | "link" | "tag" | "url";

const META_LABEL: Record<EntryMetaKind, string> = {
  note: "気持ち・備考",
  link: "リンク",
  tag: "タグ",
  url: "URL",
};

type EntryMetaCardProps = {
  kind: EntryMetaKind;
  entry: EntryTreeNode;
  tagSuggestions: EntryTagSummary[];
  /** inline=項目の詳細の中に出す。card=スマホで画面の上半分に出す(キーボードが来ても動かない場所)。 */
  layout: "inline" | "card";
  onApply: (patch: EntryUpdate) => Promise<unknown>;
  onClose: () => void;
};

/**
 * 気持ち・備考、リンク、タグ、URLを、その場の欄で書き足す。
 * Enterで決め(気持ち・備考はCtrl+Enter)、Escで閉じる。
 */
export function EntryMetaCard({ kind, entry, tagSuggestions, layout, onApply, onClose }: EntryMetaCardProps) {
  const initial = kind === "note" ? entry.note
    : kind === "tag" ? entry.tag ?? ""
      : entry.link_url;
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // 段落の見出しは、タグの第一候補にする(段落名をそのままタグにできる)。
  const headingTag = kind === "tag" && entry.kind === "paragraph" ? normalizeEntryTag(entry.heading) : null;
  const recommended = useMemo(
    () => (kind === "tag" ? getRecommendedEntryTags(tagSuggestions, value) : []),
    [kind, tagSuggestions, value],
  );

  const apply = async (rawValue: string) => {
    if (isSaving) return;
    const text = rawValue.trim();
    let patch: EntryUpdate;

    try {
      if (kind === "note") patch = { note: text };
      else if (kind === "tag") patch = { tag: normalizeEntryTag(text) };
      else {
        if (kind === "url" && !text) { setError("URLを入力してください。"); return; }
        patch = { link_url: normalizeLinkUrlForSave(text) };
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "URLを確認してください。");
      return;
    }

    setIsSaving(true);
    try {
      await onApply(patch);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした。");
    } finally {
      setIsSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.key === "Process") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter" && (kind !== "note" || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void apply(value);
    }
  };

  const label = META_LABEL[kind];
  const card = (
    <div
      className={`entry-meta-card entry-meta-card--${layout}`}
      role={layout === "card" ? "dialog" : "group"}
      aria-label={label}
    >
      <p className="entry-meta-card__title">{label}</p>
      {kind === "note" ? (
        <textarea
          ref={(element) => { fieldRef.current = element; }}
          className="entry-meta-card__field"
          rows={3}
          value={value}
          aria-label={label}
          placeholder="そのときの気持ち・補足"
          onChange={(event) => { setValue(event.target.value); setError(null); }}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          ref={(element) => { fieldRef.current = element; }}
          className="entry-meta-card__field"
          value={value}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          maxLength={kind === "tag" ? 30 : undefined}
          autoComplete="off"
          {...(kind === "tag"
            ? { placeholder: "例：後日対応" }
            : { type: "url", inputMode: "url" as const, placeholder: "https://", autoCapitalize: "off", spellCheck: false })}
          onChange={(event) => { setValue(event.target.value); setError(null); }}
          onKeyDown={onKeyDown}
        />
      )}
      {kind === "tag" && (headingTag || recommended.length > 0) ? (
        <div className="entry-meta-card__suggestions" aria-label="タグの候補">
          {headingTag ? (
            <button
              type="button"
              className={`entry-meta-card__heading-tag ${getEntryTagToneClassName(headingTag)}`}
              aria-label="段落名をこの項目のタグにする"
              onClick={() => setValue(headingTag)}
            >
              #{headingTag}
            </button>
          ) : null}
          {recommended.filter((summary) => summary.label !== headingTag).map((summary) => (
            <button
              key={summary.key}
              type="button"
              className={getEntryTagToneClassName(summary.label)}
              onClick={() => setValue(summary.label)}
            >
              #{summary.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="entry-meta-card__error" role="alert">{error}</p> : null}
      <div className="entry-meta-card__actions">
        {initial.trim() && kind !== "url" ? (
          <button type="button" onClick={() => void apply("")} disabled={isSaving}>外す</button>
        ) : <span />}
        <button type="button" onClick={onClose}>閉じる</button>
        <button type="button" className="entry-meta-card__ok" onClick={() => void apply(value)} disabled={isSaving}>決める</button>
      </div>
    </div>
  );

  if (layout === "card" && typeof document !== "undefined") {
    return createPortal(
      <div className="entry-meta-card__layer">
        <button type="button" className="entry-meta-card__scrim" aria-label={`${label}の入力を閉じる`} onClick={onClose} />
        {card}
      </div>,
      document.body,
    );
  }

  return card;
}
