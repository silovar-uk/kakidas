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

const MOBILE_MEDIA_QUERY = "(max-width: 920px)";
const EDITOR_BUTTON_ANCHOR_SELECTOR =
  ".editor-title-row__actions .entry-sort-control--editor";
const LIST_BUTTON_ANCHOR_SELECTOR =
  ".memo-list-toolbar__organize .memo-list-select";

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

function getButtonAnchorSelector(scope: ShortcutScope): string {
  return scope === "editor"
    ? EDITOR_BUTTON_ANCHOR_SELECTOR
    : LIST_BUTTON_ANCHOR_SELECTOR;
}

export function KeyboardShortcuts() {
  const location = useLocation();
  const scope = getScope(location.pathname);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  );
  const [buttonTarget, setButtonTarget] = useState<HTMLElement | null>(null);
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
      return;
    }

    let frame: number | null = null;
    let slot: HTMLSpanElement | null = null;

    const syncTarget = () => {
      frame = null;
      const anchor = document.querySelector<HTMLElement>(
        getButtonAnchorSelector(scope),
      );
      const parent = anchor?.parentElement;

      if (!anchor || !parent) {
        if (slot?.isConnected) slot.remove();
        slot = null;
        setButtonTarget(null);
        return;
      }

      if (slot?.isConnected && slot.parentElement === parent && slot.nextElementSibling === anchor) {
        return;
      }

      if (slot?.isConnected) slot.remove();

      slot = document.createElement("span");
      slot.className = "keyboard-shortcuts-slot";
      slot.dataset.shortcutScope = scope;
      parent.insertBefore(slot, anchor);
      setButtonTarget(slot);
    };

    const scheduleSync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncTarget);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleSync();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
      slot?.remove();
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

  return (
    <>
      {buttonTarget ? createPortal(trigger, buttonTarget) : null}

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
