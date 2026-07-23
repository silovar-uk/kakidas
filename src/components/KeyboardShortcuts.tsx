import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { lockBodyScroll } from "../lib/bodyScrollLock";

type ShortcutScope = "list" | "editor";

type ShortcutItem = {
  keys: string[];
  label: string;
  note?: string;
};

type EditorSortOption = {
  value: string;
  label: string;
};

type EditorControlsState = {
  sortValue: string;
  sortOptions: EditorSortOption[];
  deleteDisabled: boolean;
};

const MOBILE_MEDIA_QUERY = "(max-width: 920px)";
const LIST_BUTTON_ANCHOR_SELECTOR =
  ".memo-list-toolbar__organize .memo-list-select";
const EDITOR_HEADER_RIGHT_SELECTOR = ".editor-header__right";
const EDITOR_PAGE_SELECTOR = ".editor-page";
const EDITOR_ORIGINAL_ACTIONS_SELECTOR = ".editor-title-row__actions";
const EDITOR_ORIGINAL_SORT_SELECTOR =
  `${EDITOR_ORIGINAL_ACTIONS_SELECTOR} .entry-sort-control--editor select`;
const EDITOR_ORIGINAL_DELETE_SELECTOR =
  `${EDITOR_ORIGINAL_ACTIONS_SELECTOR} .danger-button`;

const LIST_SHORTCUTS: ShortcutItem[] = [
  {
    keys: ["Ctrl", "N"],
    label: "新しいメモを作る",
    note: "一覧画面で使えます。",
  },
  {
    keys: ["Ctrl", "/"],
    label: "ショートカット説明を開く・閉じる",
  },
  {
    keys: ["Esc"],
    label: "説明やダイアログを閉じる",
  },
];

const EDITOR_SHORTCUTS: ShortcutItem[] = [
  {
    keys: ["Ctrl", "Enter"],
    label: "タイトルを確定して、項目入力へ移る",
    note: "タイトル欄にカーソルがある時に使えます。",
  },
  {
    keys: ["Alt", "1"],
    label: "単語へ移動して入力する",
  },
  {
    keys: ["Alt", "2"],
    label: "文へ移動して入力する",
  },
  {
    keys: ["Alt", "3"],
    label: "段落へ移動して入力する",
  },
  {
    keys: ["Enter"],
    label: "単語・文を置く",
    note: "日本語変換中のEnterでは確定しません。",
  },
  {
    keys: ["Ctrl", "Enter"],
    label: "段落を置く",
    note: "段落本文ではEnterが改行になります。Shift＋Enterでも置けます。",
  },
  {
    keys: ["Ctrl", "/"],
    label: "ショートカット説明を開く・閉じる",
  },
  {
    keys: ["Esc"],
    label: "説明や開いている補助入力を閉じる",
  },
];

function getScope(pathname: string): ShortcutScope | null {
  if (pathname === "/") return "list";
  if (pathname.startsWith("/memos/")) return "editor";
  return null;
}

function isModifierShortcut(event: KeyboardEvent, key: string): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === key
  );
}

function hasOpenModal(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

function focusEntryComposer(kind?: "word" | "sentence" | "paragraph") {
  const columnSelector = kind
    ? `.entry-column--${kind}`
    : ".entry-column--active";
  const input = document.querySelector<HTMLElement>(
    `${columnSelector} .entry-composer__input, ${columnSelector} .entry-composer__textarea`,
  );

  if (!input) return;

  input.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => input.focus({ preventScroll: true }), 120);
}

function createNewMemoFromList() {
  const button = document.querySelector<HTMLButtonElement>(
    ".memo-list-page .memo-list-hero .primary-button:not(:disabled)",
  );
  button?.click();
}

function switchEntryKind(index: number) {
  const kinds = ["word", "sentence", "paragraph"] as const;
  const kind = kinds[index];
  if (!kind) return;

  const tab = document.querySelector<HTMLButtonElement>(
    `.editor-tabs [role="tab"]:nth-of-type(${index + 1})`,
  );
  tab?.click();
  window.requestAnimationFrame(() => focusEntryComposer(kind));
}

function readEditorControls(): EditorControlsState | null {
  const select = document.querySelector<HTMLSelectElement>(
    EDITOR_ORIGINAL_SORT_SELECTOR,
  );
  const deleteButton = document.querySelector<HTMLButtonElement>(
    EDITOR_ORIGINAL_DELETE_SELECTOR,
  );

  if (!select || !deleteButton) return null;

  return {
    sortValue: select.value,
    sortOptions: Array.from(select.options).map((option) => ({
      value: option.value,
      label: option.textContent?.trim() || option.value,
    })),
    deleteDisabled: deleteButton.disabled,
  };
}

function applyEditorSortValue(value: string) {
  const select = document.querySelector<HTMLSelectElement>(
    EDITOR_ORIGINAL_SORT_SELECTOR,
  );
  if (!select) return;

  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickOriginalDeleteButton() {
  document
    .querySelector<HTMLButtonElement>(EDITOR_ORIGINAL_DELETE_SELECTOR)
    ?.click();
}

export function KeyboardShortcuts() {
  const location = useLocation();
  const scope = getScope(location.pathname);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  );
  const [buttonTarget, setButtonTarget] = useState<HTMLElement | null>(null);
  const [editorControls, setEditorControls] = useState<EditorControlsState | null>(
    null,
  );
  const panelRef = useRef<HTMLElement | null>(null);
  const shortcuts = useMemo(
    () => (scope === "editor" ? EDITOR_SHORTCUTS : LIST_SHORTCUTS),
    [scope],
  );

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const syncMobile = () => {
      setIsMobile(media.matches);
      if (media.matches) setOpen(false);
    };

    syncMobile();
    media.addEventListener("change", syncMobile);
    return () => media.removeEventListener("change", syncMobile);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!scope || isMobile) {
      setButtonTarget(null);
      setEditorControls(null);
      return;
    }

    let frame: number | null = null;
    let listSlot: HTMLSpanElement | null = null;
    let actionRow: HTMLDivElement | null = null;
    let cloudSlot: HTMLSpanElement | null = null;
    let localSlot: HTMLSpanElement | null = null;
    let bridgedPage: HTMLElement | null = null;
    let originalActions: HTMLElement | null = null;

    const clearEditorBridge = () => {
      actionRow?.remove();
      actionRow = null;
      cloudSlot = null;
      localSlot = null;
      bridgedPage?.classList.remove("editor-page--header-actions-bridged");
      originalActions?.removeAttribute("aria-hidden");
      bridgedPage = null;
      originalActions = null;
      setEditorControls(null);
    };

    const syncListTarget = () => {
      const anchor = document.querySelector<HTMLElement>(
        LIST_BUTTON_ANCHOR_SELECTOR,
      );
      const parent = anchor?.parentElement;

      if (!anchor || !parent) {
        listSlot?.remove();
        listSlot = null;
        setButtonTarget(null);
        return;
      }

      if (
        listSlot?.isConnected &&
        listSlot.parentElement === parent &&
        listSlot.nextElementSibling === anchor
      ) {
        return;
      }

      listSlot?.remove();
      listSlot = document.createElement("span");
      listSlot.className = "keyboard-shortcuts-slot";
      listSlot.dataset.shortcutScope = "list";
      parent.insertBefore(listSlot, anchor);
      setButtonTarget(listSlot);
    };

    const syncEditorTarget = () => {
      const headerRight = document.querySelector<HTMLElement>(
        EDITOR_HEADER_RIGHT_SELECTOR,
      );
      const page = document.querySelector<HTMLElement>(EDITOR_PAGE_SELECTOR);
      const nextOriginalActions = document.querySelector<HTMLElement>(
        EDITOR_ORIGINAL_ACTIONS_SELECTOR,
      );
      const controls = readEditorControls();

      if (!headerRight || !page || !nextOriginalActions || !controls) {
        clearEditorBridge();
        setButtonTarget(null);
        return;
      }

      if (!actionRow?.isConnected || actionRow.parentElement !== headerRight) {
        actionRow?.remove();

        actionRow = document.createElement("div");
        actionRow.className = "editor-header__action-row";
        actionRow.setAttribute("aria-label", "メモ操作");

        cloudSlot = document.createElement("span");
        cloudSlot.className = "editor-header__cloud-slot";

        localSlot = document.createElement("span");
        localSlot.className = "editor-header__local-actions";

        actionRow.append(cloudSlot, localSlot);
        headerRight.append(actionRow);
      }

      if (bridgedPage !== page) {
        bridgedPage?.classList.remove("editor-page--header-actions-bridged");
        bridgedPage = page;
      }
      bridgedPage.classList.add("editor-page--header-actions-bridged");

      if (originalActions !== nextOriginalActions) {
        originalActions?.removeAttribute("aria-hidden");
        originalActions = nextOriginalActions;
      }
      originalActions.setAttribute("aria-hidden", "true");

      setEditorControls((current) => {
        const sameOptions =
          current?.sortOptions.length === controls.sortOptions.length &&
          current.sortOptions.every(
            (option, index) =>
              option.value === controls.sortOptions[index]?.value &&
              option.label === controls.sortOptions[index]?.label,
          );

        if (
          current &&
          current.sortValue === controls.sortValue &&
          current.deleteDisabled === controls.deleteDisabled &&
          sameOptions
        ) {
          return current;
        }

        return controls;
      });
      setButtonTarget(localSlot);
    };

    const syncTarget = () => {
      frame = null;
      if (scope === "editor") {
        listSlot?.remove();
        listSlot = null;
        syncEditorTarget();
      } else {
        clearEditorBridge();
        syncListTarget();
      }
    };

    const scheduleSync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncTarget);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "disabled"],
    });
    scheduleSync();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
      listSlot?.remove();
      clearEditorBridge();
    };
  }, [isMobile, location.pathname, scope]);

  useEffect(() => {
    if (!open || isMobile) return;

    const releaseScrollLock = lockBodyScroll();
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(frame);
      releaseScrollLock();
    };
  }, [isMobile, open]);

  useEffect(() => {
    if (!scope || isMobile) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;

      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (event.key === "/" || event.key === "?")
      ) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      if (open || hasOpenModal()) return;

      if (scope === "list" && isModifierShortcut(event, "n")) {
        event.preventDefault();
        createNewMemoFromList();
        return;
      }

      if (scope !== "editor") return;

      const target = event.target;
      if (
        event.key === "Enter" &&
        (event.ctrlKey || event.metaKey) &&
        target instanceof HTMLInputElement &&
        target.classList.contains("memo-title-input")
      ) {
        event.preventDefault();
        target.blur();
        window.requestAnimationFrame(() => focusEntryComposer());
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const index = Number.parseInt(event.key, 10) - 1;
        if (index >= 0 && index <= 2) {
          event.preventDefault();
          switchEntryKind(index);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, open, scope]);

  if (!scope || isMobile) return null;

  const trigger = (
    <button
      type="button"
      className="keyboard-shortcuts-button"
      onClick={() => setOpen(true)}
      aria-label="キーボードショートカットを見る"
      title="キーボードショートカット（Ctrl＋/）"
    >
      <span className="keyboard-shortcuts-button__icon" aria-hidden="true">⌨</span>
      <span className="keyboard-shortcuts-button__label">ショートカット</span>
    </button>
  );

  const editorActions = scope === "editor" && editorControls ? (
    <>
      {trigger}
      <label className="entry-sort-control entry-sort-control--editor editor-header__sort-control">
        <span>並び順</span>
        <select
          value={editorControls.sortValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setEditorControls((current) =>
              current ? { ...current, sortValue: nextValue } : current,
            );
            applyEditorSortValue(nextValue);
          }}
          aria-label="項目の並び順"
        >
          {editorControls.sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="danger-button editor-header__delete-button"
        disabled={editorControls.deleteDisabled}
        onClick={clickOriginalDeleteButton}
      >
        削除
      </button>
    </>
  ) : trigger;

  return (
    <>
      {buttonTarget ? createPortal(editorActions, buttonTarget) : null}

      {open ? (
        <div className="cloud-dialog keyboard-shortcuts-dialog" role="presentation">
          <button
            type="button"
            className="cloud-dialog__backdrop"
            onClick={() => setOpen(false)}
            aria-label="ショートカット説明を閉じる"
          />
          <section
            ref={panelRef}
            className="cloud-dialog__panel keyboard-shortcuts-dialog__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-shortcuts-title"
            tabIndex={-1}
          >
            <div className="keyboard-shortcuts-dialog__header">
              <div>
                <p>KEYBOARD SHORTCUTS</p>
                <h2 id="keyboard-shortcuts-title">ショートカット</h2>
              </div>
              <button
                type="button"
                className="keyboard-shortcuts-dialog__close"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                title="閉じる"
              >
                ×
              </button>
            </div>

            <p className="keyboard-shortcuts-dialog__intro">
              入力中の日本語変換を邪魔しない範囲で、よく使う操作だけを割り当てています。
            </p>

            <dl className="keyboard-shortcuts-list">
              {shortcuts.map((shortcut, index) => (
                <div
                  key={`${shortcut.keys.join("-")}-${index}`}
                  className="keyboard-shortcuts-list__item"
                >
                  <dt>
                    {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                  </dt>
                  <dd>
                    <strong>{shortcut.label}</strong>
                    {shortcut.note ? <span>{shortcut.note}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="keyboard-shortcuts-dialog__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpen(false)}
              >
                閉じる
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
