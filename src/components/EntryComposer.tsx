import {withViewTransition, waitForCreatedEntry} from "../lib/viewTransition";
import {flushSync} from "react-dom";
import { NoteIcon, LinkIcon, TagIcon } from "./icons";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type EntryCreateMetadata,
  type EntryKind,
  ENTRY_KIND_LABEL,
  ENTRY_KIND_PLACEHOLDER,
  getLinkHostname,
  getReferenceUrlKey,
  normalizeEntryTag,
  normalizeLinkUrlForSave,
} from "../types/memo";
import {
  getRecommendedEntryTags,
  type EntryTagSummary,
} from "../lib/memoTags";
import { getEntryTagToneClassName } from "../lib/entryTagGroups";
import { releaseDeskFocus } from "../lib/deskFocus";
import { draftRepository } from "../repositories/draftRepository";
import { useDraftPersistence } from "../hooks/useDraftPersistence";
import {
  buildEntryDraftId,
  type EntryDraftSnapshot,
} from "../repositories/draftRepository";

export type EntryComposerHandle = {
  focus: (options?: { scroll?: boolean; delay?: number; heading?: boolean }) => void;
  /** 段落の欄で使う。見出しに文を入れ、本文は空にする(「段落にする」)。 */
  prefillParagraph: (heading: string) => void;
  /** 書き口へ文を入れる(どこで貼っても)。カーソルの位置へ差し込む。 */
  insertText: (text: string) => void;
  /** 打った字・見出し・添えるものが何もないか。空の書き口は、行を選ぶとついてくる。 */
  isEmpty: () => boolean;
};

type EntryComposerProps = {
  memoId: string;
  memoUpdatedAt: string;
  kind: EntryKind;
  disabled?: boolean;
  /** 現在のメモで使われている項目タグ。新規入力時の候補だけに使う。 */
  tagSuggestions: EntryTagSummary[];
  /** 指定時は、このタグへ直接追加する専用入力として使う。 */
  fixedTag?: string;
  /** タグ見出し直下で使う、余白を抑えた入力面。 */
  compact?: boolean;
  /** 共通の書き口。既存のタグ固定入力はこれまでどおり独立する。 */
  variant?: "desk";
  /** 書き口がいる欄。行き先はこれで決まる(URLだけを書いたときは参考URLへ)。 */
  slot?: EntryKind;
  /** 下書きの復元・引き継ぎで、書き口の欄を合わせてほしいときに呼ぶ。 */
  onSlotHint?: (kind: EntryKind) => void;
  /** アウトラインの欄でShift+Enter。改行を入れたあとに呼び、書き口ごと段落の欄へ移る。 */
  onGrowToParagraph?: () => void;
  onCaretIndent?: () => void;
  onCaretOutdent?: () => void;
  /** 空のときの↑。上の行へ戻る。 */
  onExitUp?: () => void;
  /** 空のときの↓。下の行へ行く。 */
  onExitDown?: () => void;
  /** Esc。書き口を離れる。 */
  onExit?: () => void;
  /** スマホのアウトラインの欄で「↰ 字上げ」「↳ 字下げ」を出す。 */
  showDepthButtons?: boolean;
  /** 次の一行が入る場所の説明(読み上げ用)。 */
  caretDescription?: string;
  /** 書きかけがあるかどうかが変わったときに呼ぶ(スマホの「ここに入ります」の灯りに使う)。 */
  onDraftChange?: (hasDraft: boolean) => void;
  /** 置く先(欄)が変わったときに呼ぶ。URLだけを書くと、いる欄に関わらず参考URLになる。 */
  onRouteChange?: (kind: EntryKind) => void;
  onPlaced?: (kind: EntryKind, createdId?: string) => void;
  /** 参考URLの重複判定に使う、このメモ内の既存URL。 */
  existingReferenceUrls?: string[];
  /** タグ見出しから開いた専用入力を閉じる。 */
  onDismiss?: () => void;
  onSubmit: (
    content: string,
    metadata: EntryCreateMetadata,
    draftId: string,
    placedKind?: EntryKind,
    entryId?: string,
  ) => Promise<unknown> | unknown;
};

type ParagraphResizeOptions = {
  /**
   * 通常入力中は高さを縮めない。iPhone Safariでキーボード表示中に
   * ページ位置が少しずつ補正されるのを避けるため、縮小は送信後・blur時だけにする。
   */
  allowShrink?: boolean;
};

type MetaPicker = "note" | "link" | "tag" | null;







/** 書き口の案内は、いる欄と画面の大きさで変える。 */
const DESK_PLACEHOLDER: Record<"pc" | "mobile", Record<EntryKind, string>> = {
  pc: {
    sentence: "書く(Enterで次の行・Tabで字下げ)",
    paragraph: "段落を書く(Ctrl+Enterで置く)",
    word: "URLを貼る(どこで貼っても入ります)",
  },
  mobile: {
    sentence: "書く(Enterで次の行)",
    paragraph: "段落を書く(改行できます)",
    word: "URLを貼る",
  },
};

function readCssPixel(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 単語・文はEnterで置く。長文を書く段落はEnterで改行し、
 * Shift + Enter / Ctrl + Enter または明示的な「置く」ボタンで確定する。
 * 日本語IMEの変換確定Enterは、保存操作として扱わない。
 */
export const EntryComposer = forwardRef<EntryComposerHandle, EntryComposerProps>(
  function EntryComposer(
    {
      memoId,
      memoUpdatedAt,
      kind: baseKind,
      variant,
      slot: slotProp = "sentence",
      onSlotHint,
      onGrowToParagraph,
      onCaretIndent,
      onCaretOutdent,
      onExitUp,
      onExitDown,
      onExit,
      showDepthButtons = false,
      caretDescription,
      onDraftChange,
      onRouteChange,
      onPlaced,
      disabled = false,
      tagSuggestions,
      fixedTag,
      compact = false,
      existingReferenceUrls = [],
      onDismiss,
      onSubmit,
    },
    ref,
  ) {
    const [value, setValue] = useState("");
    const [headingValue, setHeadingValue] = useState("");
    const isDesk = variant === "desk";
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width:920px)").matches;
    const slot: EntryKind = isDesk ? slotProp : baseKind;
    // 置く先は、書き口のいる欄で決まる。アウトライン・段落の欄でURLだけを書いたときは参考URLへ送る。
    const isUrlOnly = /^(https?:\/\/|www\.)\S+$/iu.test(value.trim());
    const kind: EntryKind = isDesk ? (slot !== "word" && isUrlOnly ? "word" : slot) : baseKind;

    const [tagValue, setTagValue] = useState("");
    const [noteValue, setNoteValue] = useState("");
    const [linkValue, setLinkValue] = useState("");
    const [tagDraft, setTagDraft] = useState("");
    const [noteDraft, setNoteDraft] = useState("");
    const [linkDraft, setLinkDraft] = useState("");
    const [activeMetaPicker, setActiveMetaPicker] = useState<MetaPicker>(null);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [referenceNotice, setReferenceNotice] = useState<string | null>(null);
    const [duplicateCandidate, setDuplicateCandidate] = useState<string | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [referenceNoteOpen, setReferenceNoteOpen] = useState(false);
    const [flyingCopy, setFlyingCopy] = useState<{id:string; text:string}|null>(null);
    const latestValueRef = useRef("");

    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const headingInputRef = useRef<HTMLInputElement | null>(null);
    const tagInputRef = useRef<HTMLInputElement | null>(null);
    const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
    const linkInputRef = useRef<HTMLInputElement | null>(null);
    const metaPickerRef = useRef<HTMLDivElement | null>(null);
    const paragraphResizeFrameRef = useRef<number | null>(null);
    const isComposingRef = useRef(false);
    const isParagraph = kind === "paragraph";
    const isReferenceUrl = kind === "word";
    const lockedTag = normalizeEntryTag(fixedTag);
    const selectedTag = lockedTag ?? normalizeEntryTag(tagValue);
    const hasNote = noteValue.trim().length > 0;
    const hasLink = linkValue.trim().length > 0;
    const canSubmit = value.trim().length > 0 && !disabled;
    /** 書きかけがあるときだけ、添える道具(気持ち・リンク・タグ)を出すための印。フォーカスでは変えない。 */
    const hasDraft = canSubmit || headingValue.trim().length > 0 || hasNote || hasLink
      || Boolean(selectedTag) || activeMetaPicker !== null;
    useEffect(() => {
      onDraftChange?.(hasDraft);
    }, [hasDraft]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
      if (isDesk) onRouteChange?.(kind);
    }, [isDesk, kind]); // eslint-disable-line react-hooks/exhaustive-deps
    const existingReferenceUrlKeys = useMemo(
      () =>
        new Set(
          existingReferenceUrls
            .map((url) => getReferenceUrlKey(url))
            .filter(Boolean),
        ),
      [existingReferenceUrls],
    );
    const recommendedTags = useMemo(
      () => getRecommendedEntryTags(tagSuggestions, tagDraft),
      [tagDraft, tagSuggestions],
    );
    const draftScope = lockedTag ? "tag-group" : "main";
    const draftId = useMemo(
      () => buildEntryDraftId(memoId, isDesk ? "sentence" : kind, draftScope, lockedTag),
      [draftScope, isDesk, kind, lockedTag, memoId],
    );
    const draftSnapshot = useMemo<EntryDraftSnapshot>(() => ({
      content: value,
      heading: headingValue,
      tag_value: tagValue,
      note_value: noteValue,
      link_value: linkValue,
      tag_draft: tagDraft,
      note_draft: noteDraft,
      link_draft: linkDraft,
      active_meta_picker: activeMetaPicker,
    }), [
      activeMetaPicker,
      headingValue,
      linkDraft,
      linkValue,
      noteDraft,
      noteValue,
      tagDraft,
      tagValue,
      value,
    ]);
    const {
      status: draftStatus,
      flush: flushDraft,
      markEdited: markDraftEdited,
      markCommitted: markDraftCommitted,
    } = useDraftPersistence({
      id: draftId,
      memo_id: memoId,
      kind: isDesk ? "sentence" : kind,
      scope: draftScope,
      fixed_tag: lockedTag,
      base_memo_updated_at: memoUpdatedAt,
      snapshot: draftSnapshot,
      onRestore: (draft) => {
        latestValueRef.current = draft.content;
        setValue(draft.content);
        setHeadingValue(draft.heading);
        setTagValue(draft.tag_value);
        setNoteValue(draft.note_value);
        setLinkValue(draft.link_value);
        setTagDraft(draft.tag_draft);
        setNoteDraft(draft.note_draft);
        setLinkDraft(draft.link_draft);
        setActiveMetaPicker(draft.active_meta_picker);
        setLinkError(null);
        // 見出しや改行のある下書きは、段落の欄で続きを書けるようにする。
        if (isDesk && (draft.heading.trim() || draft.content.includes("\n"))) onSlotHint?.("paragraph");
        window.requestAnimationFrame(() =>
          scheduleParagraphTextareaResize({ allowShrink: true })
        );
      },
    });

    useEffect(() => {
      if (!isDesk || !memoId) return;
      let cancelled = false;
      // 旧「段落・参考URL」のmain下書きを、新しい書き口へ安全に引き継ぐ。
      const migrate = async () => {
        const main = await draftRepository.get(draftId);
        if (main) return;
        const old = (await draftRepository.listForMemo(memoId)).filter(row =>
          row.scope === "main" && (row.kind === "word" || row.kind === "paragraph")
        )[0];
        if (!old || cancelled) return;
        await draftRepository.migrateOldMainDraft(old.id, draftId);
        if (cancelled || latestValueRef.current) return;
        latestValueRef.current = old.content;
        setValue(old.content); setHeadingValue(old.heading);
        setTagValue(old.tag_value); setNoteValue(old.note_value); setLinkValue(old.link_value);
        onSlotHint?.(old.kind);
      };
      void migrate().catch(error => console.error("下書きを移せませんでした", error));
      return () => { cancelled = true; };
    }, [draftId, isDesk, memoId]);

    function resetMetaDrafts() {
      markDraftEdited();
      setTagDraft(selectedTag ?? "");
      setNoteDraft(noteValue);
      setLinkDraft(linkValue);
      setLinkError(null);
    }

    function closeMetaPicker() {
      resetMetaDrafts();
      setActiveMetaPicker(null);
    }

    function openMetaPicker(picker: Exclude<MetaPicker, null>) {
      markDraftEdited();
      if (activeMetaPicker === picker) {
        closeMetaPicker();
        return;
      }

      resetMetaDrafts();
      setActiveMetaPicker(picker);
    }

    useEffect(() => {
      return () => {
        if (paragraphResizeFrameRef.current !== null) {
          window.cancelAnimationFrame(paragraphResizeFrameRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (!activeMetaPicker) return;

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (target && metaPickerRef.current?.contains(target)) return;
        closeMetaPicker();
      };

      const focusTarget = activeMetaPicker === "tag"
        ? tagInputRef.current
        : activeMetaPicker === "note"
          ? noteInputRef.current
          : linkInputRef.current;

      document.addEventListener("pointerdown", handlePointerDown);
      const frame = window.requestAnimationFrame(() => focusTarget?.focus());

      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        window.cancelAnimationFrame(frame);
      };
    }, [activeMetaPicker, linkValue, noteValue, selectedTag]);

    useImperativeHandle(ref, () => ({
      focus: ({ scroll = true, delay = 160, heading = false } = {}) => {
        const target = heading ? headingInputRef.current : inputRef.current;
        if (scroll) {
          target?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // キー操作の中で呼ばれたときは同期でフォーカスする(iOSでキーボードを閉じさせない)。
        if (delay === 0) {
          target?.focus({ preventScroll: !scroll });
          return;
        }
        window.setTimeout(() => target?.focus(), delay);
      },
      prefillParagraph: (headingText: string) => {
        markDraftEdited();
        latestValueRef.current = "";
        setValue("");
        setHeadingValue(headingText);
        scheduleParagraphTextareaResize({ allowShrink: true });
      },
      insertText: (text: string) => {
        markDraftEdited();
        const el = inputRef.current;
        const current = latestValueRef.current;
        const start = el?.selectionStart ?? current.length;
        const end = el?.selectionEnd ?? start;
        const next = current.slice(0, start) + text + current.slice(end);
        latestValueRef.current = next;
        setValue(next);
        scheduleParagraphTextareaResize();
        window.requestAnimationFrame(() => {
          el?.focus({ preventScroll: true });
          el?.setSelectionRange(start + text.length, start + text.length);
        });
      },
      isEmpty: () =>
        latestValueRef.current.trim().length === 0 &&
        headingValue.trim().length === 0 &&
        noteValue.trim().length === 0 &&
        linkValue.trim().length === 0 &&
        !selectedTag,
    }));

    const adjustParagraphTextareaHeight = ({
      allowShrink = false,
    }: ParagraphResizeOptions = {}) => {
      const textarea = inputRef.current;

      if (!(textarea instanceof HTMLTextAreaElement)) return;

      const computedStyle = window.getComputedStyle(textarea);
      const minHeight = readCssPixel(computedStyle.minHeight) ?? 132;
      const maxHeight =
        readCssPixel(computedStyle.maxHeight) ?? Number.POSITIVE_INFINITY;
      const currentHeight = textarea.getBoundingClientRect().height;

      /**
       * 縮める時だけ自然高を測り直す。入力中にこれを行うと、
       * `0px → 実寸` の連続レイアウト変化になり、iPhone Safariが
       * 画面のスクロール位置を少しずつ動かすことがある。
       */
      if (allowShrink) {
        textarea.style.height = "auto";
      }

      const contentHeight = textarea.scrollHeight;
      const nextHeight = Math.min(
        Math.max(contentHeight, minHeight),
        maxHeight,
      );
      const shouldGrow = nextHeight > currentHeight + 0.5;
      const shouldApplyHeight = allowShrink || shouldGrow;

      if (shouldApplyHeight) {
        textarea.style.height = `${nextHeight}px`;
      }

      const nextOverflow = contentHeight > maxHeight + 0.5 ? "auto" : "hidden";
      if (textarea.style.overflowY !== nextOverflow) {
        textarea.style.overflowY = nextOverflow;
      }
    };

    const scheduleParagraphTextareaResize = (
      options: ParagraphResizeOptions = {},
    ) => {
      if (!isParagraph && !isDesk) return;

      if (paragraphResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(paragraphResizeFrameRef.current);
      }

      paragraphResizeFrameRef.current = window.requestAnimationFrame(() => {
        paragraphResizeFrameRef.current = null;
        adjustParagraphTextareaHeight(options);
      });
    };

    const applyTag = (rawValue = tagDraft) => {
      markDraftEdited();
      setTagValue(normalizeEntryTag(rawValue) ?? "");
      setActiveMetaPicker(null);
      setLinkError(null);
    };

    const clearTag = () => {
      markDraftEdited();
      setTagValue("");
      setTagDraft("");
      setActiveMetaPicker(null);
    };

    const applyNote = () => {
      markDraftEdited();
      setNoteValue(noteDraft.trim());
      setActiveMetaPicker(null);
    };

    const clearNote = () => {
      markDraftEdited();
      setNoteValue("");
      setNoteDraft("");
      setActiveMetaPicker(null);
    };

    const applyLink = () => {
      markDraftEdited();
      try {
        setLinkValue(normalizeLinkUrlForSave(linkDraft));
        setLinkError(null);
        setActiveMetaPicker(null);
      } catch (error) {
        setLinkError(
          error instanceof Error ? error.message : "リンクのURLを確認してください。",
        );
      }
    };

    const clearLink = () => {
      markDraftEdited();
      setLinkValue("");
      setLinkDraft("");
      setLinkError(null);
      setActiveMetaPicker(null);
    };

    const resetAfterSubmit = () => {
      markDraftCommitted();
      setValue("");
      setHeadingValue("");
      // 補助情報は新しい項目へ勝手に持ち越さない。
      setTagValue("");
      setNoteValue("");
      setLinkValue("");
      setTagDraft("");
      setNoteDraft("");
      setLinkDraft("");
      setLinkError(null);
      setDuplicateCandidate(null);
      setActiveMetaPicker(null);
      scheduleParagraphTextareaResize({ allowShrink: true });
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    /** 置いている最中の保存。Tabや矢印は、次の一行が進んでから効かせる。 */
    const pendingSubmitRef = useRef<Promise<void> | null>(null);
    const submit = (options: { allowDuplicate?: boolean } = {}): Promise<void> => {
      const pending: Promise<void> = submitNow(options).finally(() => {
        if (pendingSubmitRef.current === pending) pendingSubmitRef.current = null;
      });
      pendingSubmitRef.current = pending;
      return pending;
    };
    const afterSubmit = (action: () => void) => {
      const previous = pendingSubmitRef.current;
      if (!previous) { action(); return; }
      // 置き終えたあと、新しい行が一覧へ描かれるのを一拍待ってから効かせる。
      // この操作も「置く」の列に並べ、次のEnterは、これが済んでから置く。
      const run: Promise<void> = previous
        .catch(() => undefined)
        .then(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
        .then(action);
      const tracked: Promise<void> = run.finally(() => {
        if (pendingSubmitRef.current === tracked) pendingSubmitRef.current = null;
      });
      pendingSubmitRef.current = tracked;
    };

    const submitNow = async (
      { allowDuplicate = false }: { allowDuplicate?: boolean } = {},
    ): Promise<void> => {
      const rawValue = latestValueRef.current.trim();

      if (!rawValue || disabled) return;
      // 前の「置く」や、Tab・矢印の操作が済むのを待ってから置く(打った順に、次の一行の位置へ)。
      const waitFor = pendingSubmitRef.current;

      let normalizedLink = "";
      let content = rawValue;

      if (isReferenceUrl) {
        try {
          normalizedLink = normalizeLinkUrlForSave(rawValue);
          setLinkError(null);
        } catch (error) {
          setLinkError(
            error instanceof Error ? error.message : "URLを確認してください。",
          );
          setReferenceNotice(null);
          return;
        }

        const referenceKey = getReferenceUrlKey(normalizedLink);
        if (
          !allowDuplicate &&
          referenceKey &&
          existingReferenceUrlKeys.has(referenceKey)
        ) {
          setDuplicateCandidate(normalizedLink);
          setReferenceNotice("このURLはすでに保存済みです。");
          return;
        }

        content = getLinkHostname(normalizedLink) || normalizedLink;
      } else {
        try {
          normalizedLink = normalizeLinkUrlForSave(linkValue);
        } catch (error) {
          setLinkDraft(linkValue);
          setLinkError(
            error instanceof Error ? error.message : "リンクのURLを確認してください。",
          );
          setActiveMetaPicker("link");
          return;
        }
      }

      // 入力欄を同期的に空け、保存中の続きの打鍵を受け入れる。
      const submittedValue = latestValueRef.current || value;
      const createdId = isDesk ? crypto.randomUUID() : undefined;
      // 文字の「飛行コピー」は長文・連続入力時に列をまたぐ残像になり、
      // ボタンを覆ってしまう。項目自体の朱→墨の乾燥表示は残し、
      // 保存時のレイヤー複製は行わない。
      const canTransition = false;
      latestValueRef.current = "";
      // Reactの状態更新をここで描画し、VTが古い画面を撮る時点で写しを置く。
      // VTの非同期コールバックで入力欄を空にすると、連続入力が失われる。
      if (canTransition && createdId) {
        flushSync(() => {
          setValue("");
          setFlyingCopy({id:createdId, text:submittedValue});
        });
      } else {
        setValue("");
      }
      const submittedHeading = headingValue;
      const submittedTag = tagValue;
      const submittedNote = noteValue;
      const submittedLink = linkValue;
      setHeadingValue(""); setTagValue(""); setNoteValue(""); setLinkValue("");
      setTagDraft(""); setNoteDraft(""); setLinkDraft(""); setActiveMetaPicker(null);
      markDraftEdited();
      try {
        const create = async (): Promise<void> => {
          if (canTransition) setFlyingCopy(null);
          await onSubmit(content, {
            heading: isParagraph ? submittedHeading.trim() : "",
            tag: lockedTag ?? normalizeEntryTag(submittedTag),
            note: submittedNote.trim(),
            link_url: normalizedLink,
          }, draftId, kind, createdId);
          if (createdId) {
            await waitForCreatedEntry(createdId, 300);
            // 遷移先を撮る前に朱を付け、着地してから朱に切り替わるちらつきを防ぐ。
            const row = document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(createdId)}"]`);
            if (row) {
              row.classList.add("entry-item--fresh");
              window.setTimeout(() => row.classList.remove("entry-item--fresh"), 1800);
            }
          }
        };
        if (waitFor) await waitFor.catch(() => undefined);
        if (isDesk) await withViewTransition(create);
        else await create();
        onPlaced?.(kind, createdId);
        // 「保存しました。」は参考URLの欄にいるときだけ。ほかの欄では、置いた行が見えれば足りる。
        setReferenceNotice(isReferenceUrl && slot === "word" ? "保存しました。" : null);
        // 作成側で旧下書きを消す。続きがあれば削除後に改めて保存する。
        if (latestValueRef.current.trim()) {
          markDraftEdited();
          window.setTimeout(() => void flushDraft(), 0);
        } else {
          markDraftCommitted();
        }
        scheduleParagraphTextareaResize({ allowShrink: true });
      } catch (error) {
        setFlyingCopy(null);
        const hadNewText = Boolean(latestValueRef.current);
        const restored = hadNewText
          ? `${latestValueRef.current}\n${submittedValue}` : submittedValue;
        latestValueRef.current = restored;
        setValue(restored);
        if (!hadNewText) {
          setHeadingValue(submittedHeading); setTagValue(submittedTag);
          setNoteValue(submittedNote); setLinkValue(submittedLink);
        }
        markDraftEdited();
        setReferenceNotice("保存できませんでした。入力内容を残しました。");
        window.setTimeout(() => void flushDraft(), 0);
      }
    };

    const saveReferenceBatch = async (urls: string[]) => {
      if (!isReferenceUrl || isSubmitting || disabled) return;

      const seen = new Set(existingReferenceUrlKeys);
      const uniqueUrls: string[] = [];
      let duplicateCount = 0;

      urls.forEach((url) => {
        const key = getReferenceUrlKey(url);
        if (!key || seen.has(key)) {
          duplicateCount += 1;
          return;
        }

        seen.add(key);
        uniqueUrls.push(url);
      });

      if (uniqueUrls.length === 0) {
        setReferenceNotice("貼り付けたURLはすべて保存済みです。");
        return;
      }

      setIsSubmitting(true);
      setLinkError(null);
      setDuplicateCandidate(null);

      try {
        await flushDraft();

        for (const [index, url] of uniqueUrls.entries()) {
          await onSubmit(
            getLinkHostname(url) || url,
            {
              heading: "",
              tag: selectedTag,
              note: "",
              link_url: url,
            },
            `${draftId}:bulk:${index}`,
          );
        }

        setReferenceNotice(
          duplicateCount > 0
            ? `${uniqueUrls.length}件保存しました（重複${duplicateCount}件はスキップ）。`
            : `${uniqueUrls.length}件保存しました。`,
        );
        resetAfterSubmit();
      } finally {
        setIsSubmitting(false);
      }
    };

    const handleReferencePaste = (event: ClipboardEvent<HTMLInputElement>) => {
      if (!isReferenceUrl || disabled || isSubmitting) return;

      const pastedText = event.clipboardData.getData("text");
      const lines = pastedText
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) return;

      if (noteValue.trim()) {
        event.preventDefault();
        setReferenceNotice("備考がある場合は、URLを1件ずつ保存してください。");
        return;
      }

      const urls: string[] = [];

      for (const line of lines) {
        try {
          urls.push(normalizeLinkUrlForSave(line));
        } catch {
          // 文章が混ざった貼り付けは通常入力へ戻し、誤分割を避ける。
          return;
        }
      }

      event.preventDefault();
      void saveReferenceBatch(urls);
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit();
    };

    const handleHeadingKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "Enter") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    const handleKeyDown = (
      event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      // 日本語IMEの変換中は、Enter・Tab・矢印・Escのどれも操作として扱わない。
      if (isComposing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.key === "Process") return;

      if (isDesk) {
        const empty = latestValueRef.current.length === 0;
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void submit();
          return;
        }
        if (slot === "paragraph") {
          // 段落の欄のEnterは改行。Shift+Enter・Ctrl+Enterで置く。
          if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            releaseDeskFocus();
            onExit?.();
          }
          return;
        }
        if (event.key === "Enter" && event.shiftKey && slot === "sentence") {
          // 一行から段落へ育てる。改行を入れたまま、書き口ごと段落の欄へ移る。
          event.preventDefault();
          const el = inputRef.current;
          const position = el?.selectionStart ?? latestValueRef.current.length;
          const next = latestValueRef.current.slice(0, position) + "\n" + latestValueRef.current.slice(position);
          latestValueRef.current = next;
          setValue(next);
          markDraftEdited();
          onGrowToParagraph?.();
          window.requestAnimationFrame(() => { el?.focus({ preventScroll: true }); el?.setSelectionRange(position + 1, position + 1); });
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
          return;
        }
        if (slot === "sentence" && event.key === "Tab") {
          event.preventDefault();
          afterSubmit(() => { if (event.shiftKey) onCaretOutdent?.(); else onCaretIndent?.(); });
          return;
        }
        if (slot === "sentence" && event.key === "ArrowUp" && empty) {
          event.preventDefault();
          releaseDeskFocus();
          afterSubmit(() => onExitUp?.());
          return;
        }
        if (slot === "sentence" && event.key === "ArrowDown" && empty) {
          event.preventDefault();
          releaseDeskFocus();
          afterSubmit(() => onExitDown?.());
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          releaseDeskFocus();
          onExit?.();
        }
        return;
      }

      if (event.key !== "Enter") return;

      if (isParagraph) {
        // 段落は長文入力が前提。Enterは改行としてそのまま通し、
        // 明示的なショートカットだけを「置く」に使う。
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return;

        event.preventDefault();
        void submit();
        return;
      }

      event.preventDefault();
      void submit();
    };

    const handlePickerInputKeyDown = (
      event: KeyboardEvent<HTMLInputElement>,
      apply: () => void,
    ) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMetaPicker();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    };

    const handleNoteInputKeyDown = (
      event: KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMetaPicker();
        return;
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        applyNote();
      }
    };

    const handleChange = (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      markDraftEdited();
      latestValueRef.current = event.target.value;
      setValue(event.target.value);

      if (isReferenceUrl) {
        setLinkError(null);
        setReferenceNotice(null);
        setDuplicateCandidate(null);
      }

      /**
       * IME変換中は高さ測定を保留する。変換の各候補更新でDOMを揺らさず、
       * 変換確定後に一度だけ伸長を判定する。
       */
      if ((isParagraph || isDesk) && !isComposingRef.current) {
        scheduleParagraphTextareaResize();
      }
    };

    const handleCompositionStart = () => {
      isComposingRef.current = true;
      setIsComposing(true);
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      setIsComposing(false);
      scheduleParagraphTextareaResize();
    };

    const commonProps = {
      value,
      disabled,
      placeholder: isDesk ? DESK_PLACEHOLDER[isMobile ? "mobile" : "pc"][slot] : ENTRY_KIND_PLACEHOLDER[kind],
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
    };


    return (
      <section aria-label={isDesk ? "書き口" : undefined} className={isDesk ? "entry-composer entry-composer--desk" : undefined}
        data-draft={isDesk ? String(hasDraft) : undefined} data-slot={isDesk ? slot : undefined}>
      <form
        aria-label={isDesk ? "書き口" : undefined}
        className={`entry-composer ${isDesk ? "entry-composer--desk-inner" : ""} ${compact ? "entry-composer--tag-group" : ""} ${
          isReferenceUrl ? "entry-composer--reference-url" : ""
        }`}
        onSubmit={handleSubmit}
      >
        {lockedTag ? (
          <div className="entry-composer__tag-group-context">
            <span
              className={`entry-composer__tag-group-context-tag ${getEntryTagToneClassName(lockedTag)}`}
            >
              <TagIcon />
              <span>#{lockedTag}</span>
            </span>
            <span className="entry-composer__tag-group-context-copy">に追加</span>
            {onDismiss ? (
              <button
                type="button"
                className="entry-composer__tag-group-context-close"
                onClick={onDismiss}
                disabled={disabled}
                aria-label={`タグ「${lockedTag}」への追加を閉じる`}
                title="閉じる"
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className={`entry-composer__control-row ${
            isParagraph ? "entry-composer__control-row--paragraph" : ""
          }`}
        >
          {isDesk && showDepthButtons && slot === "sentence" ? (
            <div className="entry-composer__depth" role="group" aria-label="入れる深さ">
              <button type="button" aria-label="字上げ" title="字上げ" onClick={() => { onCaretOutdent?.(); inputRef.current?.focus({ preventScroll: true }); }}>↰</button>
              <button type="button" aria-label="字下げ" title="字下げ" onClick={() => { onCaretIndent?.(); inputRef.current?.focus({ preventScroll: true }); }}>↳</button>
            </div>
          ) : null}
          {isDesk ? (
            <div className="entry-composer__desk-fields">
              <div className={`entry-composer__desk-heading ${slot === "paragraph" ? "entry-composer__desk-heading--open" : ""}`}>
                <input className="entry-composer__paragraph-title" type="text" value={headingValue}
                  ref={headingInputRef}
                  aria-label="段落の見出し" placeholder="見出し（任意）"
                  onChange={event => { markDraftEdited(); setHeadingValue(event.target.value); }}
                  onKeyDown={handleHeadingKeyDown} />
              </div>
              <textarea {...commonProps} className="entry-composer__textarea" ref={element => {inputRef.current = element;}}
                aria-label="書く" rows={1} onBlur={() => scheduleParagraphTextareaResize({allowShrink:true})}
                aria-description={slot === "sentence" ? caretDescription : undefined} />
              {flyingCopy ? <div className="entry-composer__copy-flight"
                style={{viewTransitionName:`e-${flyingCopy.id}`}} aria-hidden="true">{flyingCopy.text}</div> : null}
            </div>
          ) : isParagraph ? (
            <div className="entry-composer__paragraph-fields">
              <input
                className="entry-composer__paragraph-title"
                type="text"
                value={headingValue}
                disabled={disabled}
                placeholder="段落タイトル（任意）"
                onChange={(event) => {
                  markDraftEdited();
                  setHeadingValue(event.target.value);
                }}
                onKeyDown={handleHeadingKeyDown}
                aria-label="段落タイトルを入力"
              />
              <textarea
                {...commonProps}
              ref={(element) => {
                inputRef.current = element;
              }}
              className="entry-composer__textarea"
              rows={4}
              aria-label={`${ENTRY_KIND_LABEL[kind]}を入力`}
              aria-describedby="paragraph-shortcut-hint"
                onBlur={() => scheduleParagraphTextareaResize({ allowShrink: true })}
              />
            </div>
          ) : (
            <input
              {...commonProps}
              ref={(element) => {
                inputRef.current = element;
              }}
              className="entry-composer__input"
              type={isReferenceUrl ? "url" : "text"}
              inputMode={isReferenceUrl ? "url" : undefined}
              autoComplete={isReferenceUrl ? "url" : undefined}
              onPaste={isReferenceUrl ? handleReferencePaste : undefined}
              aria-label={isReferenceUrl ? "参考URLを入力" : `${ENTRY_KIND_LABEL[kind]}を入力`}
            />
          )}

          <button
            type="submit"
            className="entry-composer__submit"
            disabled={!canSubmit}
            aria-label={isDesk ? "置く" : isReferenceUrl ? "参考URLを保存" : `${ENTRY_KIND_LABEL[kind]}を置く`}
          >
            {isDesk ? "置く" : isReferenceUrl ? "保存" : "置く"}
          </button>
        </div>

        {isDesk && kind !== slot ? (
          <div className="entry-composer__route" role="status">
            → {ENTRY_KIND_LABEL[kind]}へ置きます
          </div>
        ) : null}

        {isDesk && slot === "word" ? (
          referenceNoteOpen || hasNote ? (
            <label className="entry-composer__reference-note">
              <span className="entry-composer__reference-note-label">
                備考 <small>任意</small>
              </span>
              <textarea
                value={noteValue}
                disabled={disabled}
                onChange={(event) => {
                  markDraftEdited();
                  setNoteValue(event.target.value);
                }}
                rows={2}
                placeholder="このURLについての短いメモ"
                aria-label="参考URLの備考"
              />
            </label>
          ) : (
            <button type="button" className="entry-composer__note-toggle" onClick={() => setReferenceNoteOpen(true)}>
              ＋ 備考
            </button>
          )
        ) : !isDesk && isReferenceUrl ? (
          <label className="entry-composer__reference-note">
            <span className="entry-composer__reference-note-label">
              備考 <small>任意</small>
            </span>
            <textarea
              value={noteValue}
              disabled={disabled}
              onChange={(event) => {
                markDraftEdited();
                setNoteValue(event.target.value);
              }}
              rows={2}
              placeholder="このURLについての短いメモ"
              aria-label="参考URLの備考"
            />
          </label>
        ) : null}

        {isReferenceUrl && (linkError || referenceNotice) ? (
          <div
            className={`entry-composer__reference-notice ${
              linkError ? "entry-composer__reference-notice--error" : ""
            }`}
            role={linkError ? "alert" : "status"}
          >
            <span>{linkError ?? referenceNotice}</span>
            {duplicateCandidate && !linkError ? (
              <button
                type="button"
                onClick={() => void submit({ allowDuplicate: true })}
                disabled={disabled}
              >
                もう一度追加
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="entry-composer__meta-row">
          {draftStatus === "error" ? (
            <p className="entry-composer__draft-error" role="alert">
              下書きを端末に保護できません。
            </p>
          ) : null}

          {isParagraph && !isDesk ? (
            <p id="paragraph-shortcut-hint" className="entry-composer__hint">
              Enterで改行。Shift＋Enter／Ctrl＋Enterで置く。
            </p>
          ) : null}

          <div className="entry-composer__meta-controls" ref={metaPickerRef}>
            {!isReferenceUrl ? (
            <div className="entry-composer__meta-picker">
              <button
                type="button"
                className={`entry-composer__meta-trigger ${
                  hasNote ? "entry-composer__meta-trigger--active" : ""
                }`}
                disabled={disabled}
                onClick={() => openMetaPicker("note")}
                aria-expanded={activeMetaPicker === "note"}
                aria-label={
                  isReferenceUrl
                    ? hasNote ? "一言メモを変更" : "一言メモを付ける"
                    : hasNote ? "気持ち・備考を変更" : "気持ち・備考を付ける"
                }
                title={
                  isReferenceUrl
                    ? hasNote ? "一言メモを変更" : "一言メモを付ける"
                    : hasNote ? "気持ち・備考を変更" : "気持ち・備考を付ける"
                }
              >
                <NoteIcon />
                <span>
                  {isReferenceUrl
                    ? hasNote ? "メモあり" : "一言メモ"
                    : hasNote ? "気持ちあり" : "気持ち"}
                </span>
              </button>

              {activeMetaPicker === "note" ? (
                <>
                  <button
                    type="button"
                    className="entry-composer__meta-backdrop"
                    aria-label="気持ち・備考入力を閉じる"
                    onClick={closeMetaPicker}
                  />
                  <div
                    className="entry-composer__meta-popover"
                    role="dialog"
                    aria-label="この項目の気持ち・備考を設定"
                  >
                    <div className="entry-composer__meta-popover-header">
                      <span>この項目の気持ち・備考</span>
                      <button
                        type="button"
                        onClick={closeMetaPicker}
                        aria-label="気持ち・備考入力を閉じる"
                        title="閉じる"
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      ref={noteInputRef}
                      value={noteDraft}
                      onChange={(event) => {
                        markDraftEdited();
                        setNoteDraft(event.target.value);
                      }}
                      onKeyDown={handleNoteInputKeyDown}
                      placeholder={isReferenceUrl ? "なぜ残した？" : "例：あとで確認したい"}
                      rows={3}
                      aria-label="気持ち・備考"
                    />
                    <div className="entry-composer__meta-popover-actions">
                      {hasNote || noteDraft.trim() ? (
                        <button type="button" onClick={clearNote}>
                          外す
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className="entry-composer__meta-apply"
                        onClick={applyNote}
                      >
                        決定
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            ) : null}

            {!isReferenceUrl ? (
            <div className="entry-composer__meta-picker">
              <button
                type="button"
                className={`entry-composer__meta-trigger ${
                  hasLink ? "entry-composer__meta-trigger--active" : ""
                }`}
                disabled={disabled}
                onClick={() => {
                  const isOpening = activeMetaPicker !== "link";
                  openMetaPicker("link");

                  // スマホで空のリンクを開くときは、クリップボードのURLを確認用に仮入力する。
                  const canReadClipboard =
                    isOpening &&
                    !hasLink &&
                    window.matchMedia("(max-width: 920px)").matches &&
                    Boolean(navigator.clipboard?.readText);

                  if (canReadClipboard) {
                    void navigator.clipboard.readText()
                      .then((clipboardText) => {
                        const pastedLink = clipboardText.trim();
                        if (!pastedLink) return;
                        setLinkDraft(pastedLink);
                        setLinkError(null);
                      })
                      .catch(() => {
                        // 権限がない場合も、空欄を開いて手入力できる。
                      });
                  }
                }}
                aria-expanded={activeMetaPicker === "link"}
                aria-label={hasLink ? "リンクを変更" : "リンクを付ける"}
                title={hasLink ? "リンクを変更" : "リンクを付ける"}
              >
                <LinkIcon />
                <span>{hasLink ? "リンクあり" : "リンク"}</span>
              </button>

              {activeMetaPicker === "link" ? (
                <>
                  <button
                    type="button"
                    className="entry-composer__meta-backdrop"
                    aria-label="リンク入力を閉じる"
                    onClick={closeMetaPicker}
                  />
                  <div
                    className="entry-composer__meta-popover"
                    role="dialog"
                    aria-label="この項目のリンクを設定"
                  >
                    <div className="entry-composer__meta-popover-header">
                      <span>この項目のリンク</span>
                      <button
                        type="button"
                        onClick={closeMetaPicker}
                        aria-label="リンク入力を閉じる"
                        title="閉じる"
                      >
                        ×
                      </button>
                    </div>
                    <input
                      ref={linkInputRef}
                      value={linkDraft}
                      onChange={(event) => {
                        markDraftEdited();
                        setLinkDraft(event.target.value);
                        setLinkError(null);
                      }}
                      onKeyDown={(event) => handlePickerInputKeyDown(event, applyLink)}
                      placeholder="https://example.com"
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      aria-label="リンクのURL"
                      aria-invalid={linkError ? true : undefined}
                    />
                    {linkError ? (
                      <p className="entry-composer__meta-error" role="alert">
                        {linkError}
                      </p>
                    ) : null}
                    <div className="entry-composer__meta-popover-actions">
                      {hasLink || linkDraft.trim() ? (
                        <button type="button" onClick={clearLink}>
                          外す
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className="entry-composer__meta-apply"
                        onClick={applyLink}
                      >
                        決定
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            ) : null}

            {!lockedTag ? (
              <div className="entry-composer__tag-picker">
              <button
                type="button"
                className={`entry-composer__tag-trigger ${
                  selectedTag ? getEntryTagToneClassName(selectedTag) : ""
                }`}
                disabled={disabled}
                onClick={() => openMetaPicker("tag")}
                aria-expanded={activeMetaPicker === "tag"}
                aria-label={selectedTag ? `タグ「${selectedTag}」を変更` : "タグを付ける"}
                title={selectedTag ? "タグを変更" : "タグを付ける"}
              >
                <TagIcon />
                <span>{selectedTag ? `#${selectedTag}` : "タグ"}</span>
              </button>

              {activeMetaPicker === "tag" ? (
                <>
                  <button
                    type="button"
                    className="entry-composer__meta-backdrop"
                    aria-label="タグ入力を閉じる"
                    onClick={closeMetaPicker}
                  />
                  <div
                    className="entry-composer__tag-popover"
                    role="dialog"
                    aria-label="項目タグを設定"
                  >
                    <div className="entry-composer__tag-popover-header">
                      <span>この項目のタグ</span>
                      <button
                        type="button"
                        onClick={closeMetaPicker}
                        aria-label="タグ入力を閉じる"
                        title="閉じる"
                      >
                        ×
                      </button>
                    </div>
                    <input
                      ref={tagInputRef}
                      value={tagDraft}
                      onChange={(event) => {
                        markDraftEdited();
                        setTagDraft(event.target.value);
                      }}
                      onKeyDown={(event) => handlePickerInputKeyDown(event, applyTag)}
                      placeholder="例：後日対応"
                      maxLength={30}
                      autoComplete="off"
                      aria-label="項目タグ"
                    />
                    {isParagraph && normalizeEntryTag(headingValue) ? (
                      <div className="entry-composer__tag-suggestions" aria-label="段落名のタグ候補">
                        <button
                          type="button"
                          className={getEntryTagToneClassName(normalizeEntryTag(headingValue) as string)}
                          aria-label="段落名をこの項目のタグにする"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyTag(normalizeEntryTag(headingValue) as string)}
                        >
                          #{normalizeEntryTag(headingValue)}
                        </button>
                      </div>
                    ) : null}
                    {recommendedTags.length > 0 ? (
                      <div
                        className="entry-composer__tag-suggestions"
                        aria-label="過去の項目タグ候補"
                      >
                        {recommendedTags.map((summary) => (
                          <button
                            key={summary.key}
                            type="button"
                            className={getEntryTagToneClassName(summary.label)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyTag(summary.label)}
                          >
                            #{summary.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="entry-composer__tag-popover-actions">
                      {selectedTag ? (
                        <button type="button" onClick={clearTag}>
                          外す
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className="entry-composer__tag-apply"
                        onClick={() => applyTag()}
                      >
                        決定
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
              </div>
            ) : null}
          </div>
        </div>

      </form>
      </section>
    );
  },
);
