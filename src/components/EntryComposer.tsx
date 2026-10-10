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
import { draftRepository } from "../repositories/draftRepository";
import { useDraftPersistence } from "../hooks/useDraftPersistence";
import {
  buildEntryDraftId,
  type EntryDraftSnapshot,
} from "../repositories/draftRepository";

export type EntryComposerHandle = {
  focus: (options?: { scroll?: boolean; delay?: number }) => void;
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
  mobileKind?: EntryKind;
  onPlaced?: (kind: EntryKind) => void;
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
      mobileKind = "sentence",
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
    const [chosenKind, setChosenKind] = useState<EntryKind | null>(null);
    const isDesk = variant === "desk";
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width:920px)").matches;
    const automaticKind: EntryKind = /^(https?:\/\/|www\.)\S+$/iu.test(value.trim())
      ? "word" : value.includes("\n") || headingValue.trim()
        ? "paragraph" : isMobile ? mobileKind : "sentence";
    const kind: EntryKind = isDesk ? chosenKind ?? automaticKind : baseKind;

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
    const [flyingCopy, setFlyingCopy] = useState<{id:string; text:string}|null>(null);
    const latestValueRef = useRef("");

    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
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
        setChosenKind(old.kind);
      };
      void migrate().catch(error => console.error("下書きを移せませんでした", error));
      return () => { cancelled = true; };
    }, [draftId, isDesk, memoId]);

    useEffect(() => {
      if (!isDesk) return;
      const changeKind = (event: Event) => {
        const target = (event as CustomEvent<EntryKind>).detail;
        if (target !== "word" && target !== "sentence" && target !== "paragraph") return;
        setChosenKind(target);
        inputRef.current?.focus({preventScroll:true});
      };
      window.addEventListener("kakidas:choose-entry-kind", changeKind);
      return () => window.removeEventListener("kakidas:choose-entry-kind", changeKind);
    }, [isDesk]);

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
      focus: ({ scroll = true, delay = 160 } = {}) => {
        if (scroll) {
          inputRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        window.setTimeout(() => inputRef.current?.focus(), delay);
      },
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

    const submit = async (
      { allowDuplicate = false }: { allowDuplicate?: boolean } = {},
    ) => {
      const rawValue = latestValueRef.current.trim();

      if (!rawValue || disabled) return;

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
      const canTransition = Boolean(isDesk && createdId && typeof document.startViewTransition === "function" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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
          if (createdId) await waitForCreatedEntry(createdId, 300);
        };
        if (isDesk) await withViewTransition(create);
        else await create();
        if (createdId) {
          const row = document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(createdId)}"]`);
          if (row) {
            row.classList.add("entry-item--fresh");
            window.setTimeout(() => row.classList.remove("entry-item--fresh"), 1200);
          }
        }
        onPlaced?.(kind);
        if (isDesk) setChosenKind(null);
        setReferenceNotice(isReferenceUrl ? "保存しました。" : null);
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
      if (event.key !== "Enter") return;

      // 日本語IMEの変換確定Enterを「保存」に使わない。
      if (isComposing || event.nativeEvent.isComposing) return;

      if (isDesk && !isParagraph && event.shiftKey) {
        // 一行から段落へ育てる。IME確定のEnterとは分ける。
        event.preventDefault();
        const el = inputRef.current;
        const position = el?.selectionStart ?? latestValueRef.current.length;
        const next = latestValueRef.current.slice(0, position) + "\n" + latestValueRef.current.slice(position);
        latestValueRef.current = next; setValue(next); setChosenKind("paragraph");
        markDraftEdited();
        window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(position+1, position+1); });
        return;
      }
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
      placeholder: isDesk ? "ここに書く。Enterで置く" : ENTRY_KIND_PLACEHOLDER[kind],
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
    };


    return (
      <section aria-label={isDesk ? "書き口" : undefined} className={isDesk ? "entry-composer entry-composer--desk" : undefined}>
      <form
        aria-label={isDesk ? "書き口" : undefined}
        className={`entry-composer ${isDesk ? "entry-composer--desk" : ""} ${compact ? "entry-composer--tag-group" : ""} ${
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

        {isDesk ? (
          <div className="entry-composer__destinations" role="radiogroup" aria-label="置き先">
            {(["word", "sentence", "paragraph"] as EntryKind[]).map((target) => (
              <button key={target} type="button" role="radio" aria-label={ENTRY_KIND_LABEL[target]}
                aria-checked={kind === target} onClick={() => { setChosenKind(target); inputRef.current?.focus(); }}>
                {ENTRY_KIND_LABEL[target]}
              </button>
            ))}
          </div>
        ) : null}
        <div
          className={`entry-composer__control-row ${
            isParagraph ? "entry-composer__control-row--paragraph" : ""
          }`}
        >
          {isDesk ? (
            <div className="entry-composer__desk-fields">
              <div className={`entry-composer__desk-heading ${isParagraph ? "entry-composer__desk-heading--open" : ""}`}>
                <input className="entry-composer__paragraph-title" type="text" value={headingValue}
                  aria-label="段落タイトル" placeholder="段落タイトル（任意）"
                  onChange={event => { markDraftEdited(); setHeadingValue(event.target.value); }}
                  onKeyDown={handleHeadingKeyDown} />
              </div>
              <textarea {...commonProps} className="entry-composer__textarea" ref={element => {inputRef.current = element;}}
                aria-label="書く" rows={1} onBlur={() => scheduleParagraphTextareaResize({allowShrink:true})} />
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

        {isReferenceUrl ? (
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

          {isParagraph ? (
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
                onClick={() => openMetaPicker("link")}
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
