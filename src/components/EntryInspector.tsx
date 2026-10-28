import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EntryMetaCard, type EntryMetaKind } from "./EntryMetaCard";
import { LinkIcon, NoteIcon, TagIcon } from "./icons";
import { formatEntryCreatedAt } from "../lib/formatDate";
import type { OutlineCopyMode } from "../lib/outlineCopy.js";
import type { EntryTagSummary } from "../lib/memoTags";
import {
  type EntryKind,
  type EntryTreeNode,
  type EntryUpdate,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_MOVE_TARGETS,
} from "../types/memo";

export type RowMove = "indent" | "outdent" | "up" | "down";

/** アウトラインの行を動かせるか(押せない札は薄くする)。 */
export type RowMoveState = Record<RowMove, boolean>;

/** 項目の詳細・スマホの操作シートが共有する、項目への操作。 */
export type EntryActions = {
  onUpdate: (entryId: string, patch: EntryUpdate) => Promise<unknown>;
  onToggleCompleted: (entryId: string) => Promise<unknown>;
  /** アウトラインの行だけ。 */
  onMoveRow?: (entryId: string, action: RowMove) => void;
  moveState?: RowMoveState;
  onZoom?: (entryId: string) => void;
  /** 「段落に複製」(P2) / 「段落にする」(P3)。 */
  onGrow?: (entryId: string) => void;
  growLabel?: string;
  /** 参考URLだけ。「アウトラインに引く」。 */
  onPull?: (entryId: string) => void;
  /** falseを返したときは、確認を取り消したものとして閉じない。 */
  onCopy: (entryId: string) => Promise<boolean>;
  /** 選択した項目を根として、その子孫も含めてコピーする。 */
  onCopyBranch?: (entryId: string, mode: OutlineCopyMode) => Promise<boolean>;
  onCreateMemoFromEntry: (entryId: string) => Promise<boolean>;
  onMoveToKind: (entryId: string, targetKind: EntryKind) => Promise<boolean>;
  onDelete: (entryId: string) => Promise<unknown>;
};

type PanelProps = {
  entry: EntryTreeNode;
  kind: EntryKind;
  variant: "popover" | "sheet";
  disabled?: boolean;
  tagSuggestions: EntryTagSummary[];
  actions: EntryActions;
  onClose: () => void;
  /** スマホ: 気持ち・リンク・タグは、閉じてから画面の上半分のカードで書く。 */
  onRequestMeta?: (entryId: string, meta: EntryMetaKind) => void;
};

/** 項目の詳細の中身。PCは行のそばの小窓、スマホは下からのシートで、同じ順番に並べる。 */
export function EntryActionsPanel({
  entry,
  kind,
  variant,
  disabled = false,
  tagSuggestions,
  actions,
  onClose,
  onRequestMeta,
}: PanelProps) {
  const [meta, setMeta] = useState<EntryMetaKind | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const isSheet = variant === "sheet";
  const isReferenceUrl = kind === "word" && Boolean(entry.link_url.trim());
  const isOutline = kind === "sentence";
  const busy = disabled || isWorking;
  const moveTargets = ENTRY_KIND_MOVE_TARGETS[kind];
  const state = actions.moveState;

  const run = async (action: () => Promise<unknown> | unknown, { keepOpen = false }: { keepOpen?: boolean } = {}) => {
    if (busy) return;
    setIsWorking(true);
    let shouldClose = !keepOpen;
    try {
      const result = await action();
      // 確認をキャンセルした場合は、操作内容を見直せるよう開いたままにする。
      shouldClose = !keepOpen && result !== false;
    } catch {
      shouldClose = false;
    } finally {
      setIsWorking(false);
      if (shouldClose) onClose();
    }
  };

  const openMeta = (next: EntryMetaKind) => {
    if (isSheet && onRequestMeta) {
      onRequestMeta(entry.id, next);
      onClose();
      return;
    }
    setMeta((current) => (current === next ? null : next));
  };

  const linkMeta: EntryMetaKind = isReferenceUrl ? "url" : "link";
  const noteLabel = entry.note.trim() ? "気持ち・備考を直す" : "気持ち・備考を書く";
  const linkLabel = isReferenceUrl ? "URLを直す" : entry.link_url.trim() ? "リンクを直す" : "リンクを付ける";
  const tagLabel = isSheet ? "タグを変える" : entry.tag ? `タグ #${entry.tag} を変える` : "タグを付ける";
  const moves: { action: RowMove; glyph: string; label: string }[] = [
    { action: "outdent", glyph: "↰", label: "上げる" },
    { action: "indent", glyph: "↳", label: "下げる" },
    { action: "up", glyph: "↑", label: "上へ" },
    { action: "down", glyph: "↓", label: "下へ" },
  ];

  return (
    <div className={`entry-inspector__body entry-inspector__body--${variant}`}>
      {isOutline && actions.onMoveRow ? (
        <section className="entry-inspector__section" aria-label="動かす">
          <p className="entry-inspector__caption">動かす</p>
          <div className="entry-inspector__moves">
            {moves.map((move) => (
              <button
                key={move.action}
                type="button"
                aria-label={move.label}
                disabled={busy || (state ? !state[move.action] : false)}
                onClick={() => actions.onMoveRow?.(entry.id, move.action)}
              >
                <span aria-hidden="true">{move.glyph}</span>
                <span className="entry-inspector__move-label" aria-hidden="true">{move.label}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="entry-inspector__section entry-inspector__chips">
        {!isReferenceUrl ? (
          <button type="button" className="entry-inspector__chip" disabled={busy} onClick={() => void run(() => actions.onToggleCompleted(entry.id))}>
            {entry.is_completed ? "未完了に戻す" : "完了にする"}
          </button>
        ) : null}
        {isOutline && actions.onGrow ? (
          <button type="button" className="entry-inspector__chip" disabled={busy} aria-label={actions.growLabel ?? "段落に複製"} onClick={() => void run(() => actions.onGrow?.(entry.id))}>
            {actions.growLabel ?? "段落に複製"}
          </button>
        ) : null}
        {isOutline && actions.onZoom ? (
          <button type="button" className="entry-inspector__chip" disabled={busy} aria-label="この枝に集中" onClick={() => void run(() => actions.onZoom?.(entry.id))}>
            集中
          </button>
        ) : null}
        {isReferenceUrl && actions.onPull ? (
          <button type="button" className="entry-inspector__chip" disabled={busy} onClick={() => void run(() => actions.onPull?.(entry.id))}>
            アウトラインに引く
          </button>
        ) : null}
      </section>

      <section className="entry-inspector__section" aria-label="書き添える">
        <p className="entry-inspector__caption">書き添える</p>
        <div className="entry-inspector__chips">
          <button type="button" className="entry-inspector__chip" aria-label={noteLabel} aria-expanded={meta === "note"} disabled={busy} onClick={() => openMeta("note")}>
            <NoteIcon />気持ち・備考
          </button>
          <button type="button" className="entry-inspector__chip" aria-label={linkLabel} aria-expanded={meta === linkMeta} disabled={busy} onClick={() => openMeta(linkMeta)}>
            <LinkIcon />{isReferenceUrl ? "URL" : "リンク"}
          </button>
          <button type="button" className="entry-inspector__chip" aria-label={tagLabel} aria-expanded={meta === "tag"} disabled={busy} onClick={() => openMeta("tag")}>
            <TagIcon />{entry.tag ? `#${entry.tag}` : "タグ"}
          </button>
        </div>
        {meta ? (
          <EntryMetaCard
            key={meta}
            kind={meta}
            entry={entry}
            tagSuggestions={tagSuggestions}
            layout="inline"
            onApply={(patch) => actions.onUpdate(entry.id, patch)}
            onClose={() => setMeta(null)}
          />
        ) : null}
        <div role="group" aria-label={isSheet ? "満足度" : "評価"} className="entry-inspector__stars">
          {isSheet ? null : <p className="entry-inspector__caption">評価</p>}
          <div className="entry-inspector__star-buttons">
            {[0, 1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={entry.satisfaction === value}
                disabled={busy}
                onClick={() => void run(() => actions.onUpdate(entry.id, { satisfaction: value }), { keepOpen: true })}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="entry-inspector__section entry-inspector__chips">
        <button type="button" className="entry-inspector__chip" disabled={busy} onClick={() => void run(() => actions.onCopy(entry.id))}>
          {isOutline ? "本文だけコピー" : "コピー"}
        </button>
        {isOutline && actions.onCopyBranch ? (
          <div className="entry-inspector__copy-branch" role="group" aria-label="この項目以下をコピー">
            <p className="entry-inspector__caption">この項目以下をコピー</p>
            <button type="button" className="entry-inspector__chip" disabled={busy} onClick={() => void run(() => actions.onCopyBranch?.(entry.id, "outliner"))}>アウトライナー用 <span aria-hidden="true">↳</span></button>
            <button type="button" className="entry-inspector__chip" disabled={busy} onClick={() => void run(() => actions.onCopyBranch?.(entry.id, "textMemo"))}>テキストメモ用 <span aria-hidden="true">1.1</span></button>
          </div>
        ) : null}
        {!isReferenceUrl ? (
          <button type="button" className="entry-inspector__chip" disabled={busy} onClick={() => void run(() => actions.onCreateMemoFromEntry(entry.id))}>
            新しいメモにする
          </button>
        ) : null}
        {moveTargets.map((target) => (
          <button key={target} type="button" className="entry-inspector__chip" disabled={busy} onClick={() => void run(() => actions.onMoveToKind(entry.id, target))}>
            {ENTRY_KIND_LABEL[target]}へ移動
          </button>
        ))}
      </section>

      <section className="entry-inspector__section entry-inspector__chips entry-inspector__chips--end">
        <button type="button" className="entry-inspector__chip entry-inspector__chip--danger" disabled={busy} onClick={() => void run(() => actions.onDelete(entry.id))}>
          削除
        </button>
      </section>
    </div>
  );
}

type InspectorProps = Omit<PanelProps, "variant" | "onRequestMeta"> & {
  /** 位置合わせの基準にする、押された「⋯」。 */
  anchor: HTMLElement | null;
  showEntryNumbers?: boolean;
  displayNumber?: string;
};

const POPOVER_WIDTH = 320;

/** PCの「項目の詳細」。行のそばの小窓。 */
export function EntryInspector({ anchor, showEntryNumbers = false, displayNumber, onClose, ...panel }: InspectorProps) {
  const { entry, kind } = panel;
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 押された「⋯」のそばに置く。画面の下にはみ出すときは、上へ回す。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = anchor?.getBoundingClientRect();
    const height = el.offsetHeight;
    const left = rect ? Math.min(window.innerWidth - POPOVER_WIDTH - 12, Math.max(12, rect.right - POPOVER_WIDTH)) : 12;
    let top = rect ? rect.bottom + 6 : 12;
    if (top + height > window.innerHeight - 12) top = Math.max(12, (rect ? rect.top - height - 6 : 12));
    setPosition({ left, top });
  }, [anchor, entry.id]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("keydown", onKeyDown); };
  }, []);

  if (typeof document === "undefined") return null;

  const titleText = kind === "paragraph" && entry.heading ? entry.heading : entry.content;
  const created = formatEntryCreatedAt(entry.created_at);

  return createPortal(
    <>
      <button type="button" className="entry-inspector__scrim" aria-label="項目の詳細を閉じる" onClick={onClose} tabIndex={-1} />
      <div
        ref={ref}
        className="entry-inspector"
        role="dialog"
        aria-label="項目の詳細"
        style={position ? { left: position.left, top: position.top } : { left: 12, top: 12, visibility: "hidden" }}
      >
        <h4 className="entry-inspector__title">{showEntryNumbers && displayNumber ? `${displayNumber} ${titleText}` : titleText}</h4>
        <p className="entry-inspector__sub">{ENTRY_KIND_LABEL[kind]}・作成 {created}</p>
        <EntryActionsPanel {...panel} variant="popover" onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}
