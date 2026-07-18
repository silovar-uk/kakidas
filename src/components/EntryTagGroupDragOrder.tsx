import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { getEntryTagKey } from "../types/memo";

type EntryKind = "word" | "sentence" | "paragraph";

type DragState = {
  pointerId: number;
  handle: HTMLButtonElement;
  section: HTMLElement;
  list: HTMLElement;
  column: HTMLElement;
};

const STORAGE_PREFIX = "kakidas.entry-tag-group-order.v1";
const HANDLE_CLASS = "entry-tag-group-drag-handle";
const DRAGGING_CLASS = "entry-list__tag-group--dragging";
const LIST_DRAGGING_CLASS = "entry-list--tag-group-dragging";
const BODY_DRAGGING_CLASS = "kakidas-tag-group-dragging";
const ENTRY_KINDS: EntryKind[] = ["word", "sentence", "paragraph"];

function getMemoScope(pathname: string): string | null {
  const match = pathname.match(/^\/memos\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getColumnKind(column: HTMLElement): EntryKind | null {
  return ENTRY_KINDS.find((kind) => column.classList.contains(`entry-column--${kind}`)) ?? null;
}

function getMovableGroups(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && (
      child.classList.contains("entry-list__tag-group--untagged") ||
      child.classList.contains("entry-list__tag-group--tag")
    ),
  );
}

function getCompletedGroup(list: HTMLElement): HTMLElement | null {
  return Array.from(list.children).find((child): child is HTMLElement =>
    child instanceof HTMLElement && child.classList.contains("entry-list__tag-group--completed"),
  ) ?? null;
}

function getGroupKey(section: HTMLElement): string | null {
  if (section.classList.contains("entry-list__tag-group--untagged")) {
    return "system:untagged";
  }

  const label = section
    .querySelector<HTMLElement>(".entry-list__tag-group-add-label")
    ?.textContent
    ?.replace(/^#/, "")
    .trim();
  const tagKey = getEntryTagKey(label);
  return tagKey ? `tag:${tagKey}` : null;
}

function getGroupLabel(section: HTMLElement): string {
  if (section.classList.contains("entry-list__tag-group--untagged")) {
    return "タグなし";
  }

  return section
    .querySelector<HTMLElement>(".entry-list__tag-group-add-label")
    ?.textContent
    ?.trim() || "タググループ";
}

function getStorageKey(memoScope: string, kind: EntryKind): string {
  return `${STORAGE_PREFIX}.${encodeURIComponent(memoScope)}.${kind}`;
}

function readStoredOrder(memoScope: string, kind: EntryKind): string[] {
  try {
    const raw = window.localStorage.getItem(getStorageKey(memoScope, kind));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeStoredOrder(memoScope: string, kind: EntryKind, order: string[]) {
  try {
    window.localStorage.setItem(getStorageKey(memoScope, kind), JSON.stringify(order));
  } catch {
    // 保存できない端末でも、現在の画面上では並べ替えを維持する。
  }
}

function isOrderLocked(column: HTMLElement): boolean {
  return column
    .querySelector<HTMLButtonElement>(".entry-column__order-lock")
    ?.getAttribute("aria-pressed") === "true";
}

function enableOrderLock(column: HTMLElement) {
  const button = column.querySelector<HTMLButtonElement>(".entry-column__order-lock");
  if (button?.getAttribute("aria-pressed") === "false") {
    button.click();
  }
}

function persistCurrentOrder(column: HTMLElement, memoScope: string) {
  const kind = getColumnKind(column);
  const list = column.querySelector<HTMLElement>(".entry-list");
  if (!kind || !list) return;

  const order = getMovableGroups(list)
    .map(getGroupKey)
    .filter((key): key is string => Boolean(key));
  writeStoredOrder(memoScope, kind, order);
}

function applyStoredOrder(column: HTMLElement, memoScope: string) {
  if (!isOrderLocked(column)) return;

  const kind = getColumnKind(column);
  const list = column.querySelector<HTMLElement>(".entry-list");
  if (!kind || !list) return;

  const groups = getMovableGroups(list);
  if (groups.length < 2) return;

  const storedOrder = readStoredOrder(memoScope, kind);
  if (storedOrder.length === 0) return;

  const groupByKey = new Map<string, HTMLElement>();
  groups.forEach((group) => {
    const key = getGroupKey(group);
    if (key) groupByKey.set(key, group);
  });

  const orderedGroups = storedOrder
    .map((key) => groupByKey.get(key))
    .filter((group): group is HTMLElement => Boolean(group));
  const knownGroups = new Set(orderedGroups);
  groups.forEach((group) => {
    if (!knownGroups.has(group)) orderedGroups.push(group);
  });

  const currentKeys = groups.map(getGroupKey);
  const nextKeys = orderedGroups.map(getGroupKey);
  if (currentKeys.every((key, index) => key === nextKeys[index])) return;

  const completed = getCompletedGroup(list);
  orderedGroups.forEach((group) => list.insertBefore(group, completed));
}

function moveGroupByKeyboard(
  section: HTMLElement,
  direction: "up" | "down" | "first" | "last",
) {
  const list = section.parentElement;
  if (!(list instanceof HTMLElement)) return;

  const groups = getMovableGroups(list);
  const currentIndex = groups.indexOf(section);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (direction === "up") nextIndex = Math.max(0, currentIndex - 1);
  if (direction === "down") nextIndex = Math.min(groups.length - 1, currentIndex + 1);
  if (direction === "first") nextIndex = 0;
  if (direction === "last") nextIndex = groups.length - 1;
  if (nextIndex === currentIndex) return;

  const withoutCurrent = groups.filter((group) => group !== section);
  withoutCurrent.splice(nextIndex, 0, section);
  const completed = getCompletedGroup(list);
  withoutCurrent.forEach((group) => list.insertBefore(group, completed));
}

/** タグ名部分のクリックを、既存の一括名称変更ボタンへ橋渡しする。 */
function openRenameFromTagLabel(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const label = target.closest<HTMLElement>(".entry-list__tag-group-add-label");
  if (!label) return false;

  const section = label.closest<HTMLElement>(".entry-list__tag-group--tag");
  const renameButton = section?.querySelector<HTMLButtonElement>(
    ".entry-list__tag-group-rename",
  );

  if (!renameButton || renameButton.disabled) return false;
  renameButton.click();
  return true;
}

/** タグ名側が編集、区切り線より右の＋側が追加であることを補助情報にも反映する。 */
function prepareTagNameShortcut(section: HTMLElement) {
  if (!section.classList.contains("entry-list__tag-group--tag")) return;

  const label = section.querySelector<HTMLElement>(".entry-list__tag-group-add-label");
  const addButton = label?.closest<HTMLButtonElement>(".entry-list__tag-group-add");
  const renameButton = section.querySelector<HTMLButtonElement>(
    ".entry-list__tag-group-rename",
  );
  if (!label || !addButton || !renameButton) return;

  const tagName = label.textContent?.replace(/^#/, "").trim() || "このタグ";
  label.title = `タグ「${tagName}」の名前を変更`;
  label.setAttribute("data-tag-rename-shortcut", "true");
  addButton.title = `＋を押してタグ「${tagName}」に追加`;

  // 見た目のペンは撤去するが、既存のReact処理を呼ぶ橋としてDOMには残す。
  renameButton.tabIndex = -1;
  renameButton.setAttribute("aria-hidden", "true");
}

/**
 * タグ表示の各グループにドラッグハンドルを差し込み、表示順だけを端末へ保存する。
 * 項目データやタグ名は書き換えず、「完了」は従来どおり最後に固定する。
 */
export function EntryTagGroupDragOrder() {
  const location = useLocation();
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const memoScope = getMemoScope(location.pathname);
    if (!memoScope) return;

    let observer: MutationObserver | null = null;

    const finishDrag = (pointerId?: number) => {
      const drag = dragRef.current;
      if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;

      drag.section.classList.remove(DRAGGING_CLASS);
      drag.list.classList.remove(LIST_DRAGGING_CLASS);
      document.body.classList.remove(BODY_DRAGGING_CLASS);

      try {
        if (drag.handle.hasPointerCapture(drag.pointerId)) {
          drag.handle.releasePointerCapture(drag.pointerId);
        }
      } catch {
        // 既に解放済みでも終了処理は続ける。
      }

      persistCurrentOrder(drag.column, memoScope);
      dragRef.current = null;
      enableOrderLock(drag.column);
      window.requestAnimationFrame(() => applyStoredOrder(drag.column, memoScope));
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.preventDefault();
      const groups = getMovableGroups(drag.list).filter((group) => group !== drag.section);
      const completed = getCompletedGroup(drag.list);
      let inserted = false;

      for (const candidate of groups) {
        const rect = candidate.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          drag.list.insertBefore(drag.section, candidate);
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        drag.list.insertBefore(drag.section, completed);
      }

      const edge = 72;
      if (event.clientY < edge) {
        window.scrollBy({ top: -14, behavior: "auto" });
      } else if (event.clientY > window.innerHeight - edge) {
        window.scrollBy({ top: 14, behavior: "auto" });
      }
    };

    const handlePointerUp = (event: PointerEvent) => finishDrag(event.pointerId);
    const handlePointerCancel = (event: PointerEvent) => finishDrag(event.pointerId);
    const handleTagNameClick = (event: MouseEvent) => {
      if (!openRenameFromTagLabel(event.target)) return;

      // 親の「タグへ追加」ボタンへクリックを渡さず、名称変更だけを開く。
      event.preventDefault();
      event.stopPropagation();
    };

    const addHandle = (section: HTMLElement, column: HTMLElement) => {
      const header = section.querySelector<HTMLElement>(".entry-list__tag-group-header");
      if (!header) return;

      prepareTagNameShortcut(section);

      const label = getGroupLabel(section);
      const existing = header.querySelector<HTMLButtonElement>(`.${HANDLE_CLASS}`);
      if (existing) {
        existing.setAttribute("aria-label", `${label}をドラッグして並べ替え`);
        existing.title = `${label}を並べ替え`;
        return;
      }

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = HANDLE_CLASS;
      handle.textContent = "⠿";
      handle.setAttribute("aria-label", `${label}をドラッグして並べ替え`);
      handle.title = `${label}を並べ替え`;

      handle.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
        const list = section.parentElement;
        if (!(list instanceof HTMLElement) || getMovableGroups(list).length < 2) return;

        event.preventDefault();
        event.stopPropagation();
        dragRef.current = {
          pointerId: event.pointerId,
          handle,
          section,
          list,
          column,
        };

        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          // Pointer Capture非対応でもwindowイベントでドラッグを続ける。
        }

        section.classList.add(DRAGGING_CLASS);
        list.classList.add(LIST_DRAGGING_CLASS);
        document.body.classList.add(BODY_DRAGGING_CLASS);
      });

      handle.addEventListener("keydown", (event) => {
        let direction: "up" | "down" | "first" | "last" | null = null;
        if (event.key === "ArrowUp") direction = "up";
        if (event.key === "ArrowDown") direction = "down";
        if (event.key === "Home") direction = "first";
        if (event.key === "End") direction = "last";
        if (!direction) return;

        event.preventDefault();
        event.stopPropagation();
        moveGroupByKeyboard(section, direction);
        persistCurrentOrder(column, memoScope);
        enableOrderLock(column);
        handle.focus({ preventScroll: true });
      });

      header.prepend(handle);
    };

    const sync = () => {
      frameRef.current = null;
      if (dragRef.current) return;

      document.querySelectorAll<HTMLElement>(".entry-column").forEach((column) => {
        const list = column.querySelector<HTMLElement>(".entry-list");
        if (!list) return;

        getMovableGroups(list).forEach((section) => addHandle(section, column));
        applyStoredOrder(column, memoScope);
      });
    };

    const scheduleSync = () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(sync);
    };

    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "class"],
    });
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("click", handleTagNameClick, true);
    scheduleSync();

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      finishDrag();
      observer?.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("click", handleTagNameClick, true);
      document.querySelectorAll(`.${HANDLE_CLASS}`).forEach((handle) => handle.remove());
      document.body.classList.remove(BODY_DRAGGING_CLASS);
    };
  }, [location.pathname]);

  return null;
}
