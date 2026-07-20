import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const MOBILE_MEDIA_QUERY = "(max-width: 920px)";
const ENTRY_ITEM_SELECTOR = ".entry-item";
const ENTRY_COUNT_SELECTOR = ".editor-tab__count, .entry-column__count";
const COMPLETE_CONTROL_SELECTOR =
  ".entry-item__complete, .mobile-action-sheet__complete";
const COMPOSER_SELECTOR = ".entry-composer";
const COMPOSER_SUBMIT_SELECTOR = ".entry-composer__submit";
const COMPOSER_CONTENT_INPUT_SELECTOR =
  ".entry-composer__input, .entry-composer__textarea";
const TAB_SELECTOR = ".editor-tab";
const TAB_CONTAINER_SELECTOR = ".editor-tabs";

function restartMotionClass(
  element: HTMLElement,
  className: string,
  duration: number,
  timers: Set<number>,
) {
  element.classList.remove(className);
  // 続けて同じ操作をしても、毎回ひとつの短い反応として再始動する。
  void element.offsetWidth;
  element.classList.add(className);

  const timer = window.setTimeout(() => {
    element.classList.remove(className);
    timers.delete(timer);
  }, duration);
  timers.add(timer);
}

function collectEntryItems(node: Node): HTMLElement[] {
  if (!(node instanceof Element)) return [];

  const items: HTMLElement[] = [];
  if (node.matches(ENTRY_ITEM_SELECTOR)) items.push(node as HTMLElement);
  node
    .querySelectorAll<HTMLElement>(ENTRY_ITEM_SELECTOR)
    .forEach((item) => items.push(item));
  return items;
}

function isComposerSubmitKey(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.isComposing) return false;
  if (
    !(
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
  ) {
    return false;
  }

  // 段落タイトル・タグ・リンク・気持ちの入力では追加演出を起動しない。
  if (!event.target.matches(COMPOSER_CONTENT_INPUT_SELECTOR)) return false;
  if (!event.target.closest(COMPOSER_SELECTOR)) return false;

  if (event.target instanceof HTMLTextAreaElement) {
    return event.shiftKey || event.ctrlKey;
  }

  return true;
}

/**
 * スマホで頻繁に使う「置く・切り替える・完了する」にだけ、短い手応えを加える。
 * 保存処理や一覧構造は変えず、初回表示や補助入力では反応させない。
 */
export function MobileInteractionMotion() {
  const { pathname } = useLocation();

  useEffect(() => {
    const mobileMedia = window.matchMedia(MOBILE_MEDIA_QUERY);
    const timers = new Set<number>();
    const frames = new Set<number>();
    const countValues = new WeakMap<HTMLElement, string>();

    let isPriming = true;
    let primingScheduled = false;
    let activeTabIndex: number | null = null;
    let pendingAdditionColumn: HTMLElement | null = null;
    let pendingAdditionUntil = 0;

    const requestFrame = (callback: FrameRequestCallback) => {
      const frame = window.requestAnimationFrame((time) => {
        frames.delete(frame);
        callback(time);
      });
      frames.add(frame);
      return frame;
    };

    const syncTabIndicator = (animateColumn = false) => {
      const container = document.querySelector<HTMLElement>(
        TAB_CONTAINER_SELECTOR,
      );
      if (!container) return;

      const tabs = [
        ...container.querySelectorAll<HTMLButtonElement>(TAB_SELECTOR),
      ];
      const nextIndex = tabs.findIndex(
        (tab) => tab.getAttribute("aria-selected") === "true",
      );
      if (nextIndex < 0) return;

      container.dataset.mobileMotionReady = "true";
      container.dataset.mobileMotionTab = String(nextIndex);

      const previousIndex = activeTabIndex;
      activeTabIndex = nextIndex;

      if (
        !animateColumn ||
        isPriming ||
        previousIndex === null ||
        previousIndex === nextIndex ||
        !mobileMedia.matches
      ) {
        return;
      }

      const direction = nextIndex > previousIndex ? "forward" : "back";
      requestFrame(() => {
        const activeColumn = document.querySelector<HTMLElement>(
          ".entry-column--active",
        );
        if (!activeColumn) return;

        restartMotionClass(
          activeColumn,
          direction === "forward"
            ? "mobile-motion-column-enter-forward"
            : "mobile-motion-column-enter-back",
          260,
          timers,
        );
      });
    };

    const seedCurrentScreen = () => {
      document
        .querySelectorAll<HTMLElement>(ENTRY_COUNT_SELECTOR)
        .forEach((count) => {
          countValues.set(count, count.textContent?.trim() ?? "");
        });
      syncTabIndicator(false);
      isPriming = false;
      primingScheduled = false;
    };

    const tryFinishPriming = () => {
      if (primingScheduled || !document.querySelector(".editor-grid")) return;
      primingScheduled = true;
      requestFrame(() => requestFrame(seedCurrentScreen));
    };

    const animateChangedCounts = () => {
      document
        .querySelectorAll<HTMLElement>(ENTRY_COUNT_SELECTOR)
        .forEach((count) => {
          const nextValue = count.textContent?.trim() ?? "";
          const previousValue = countValues.get(count);
          countValues.set(count, nextValue);

          if (
            previousValue === undefined ||
            previousValue === nextValue ||
            isPriming ||
            !mobileMedia.matches
          ) {
            return;
          }

          restartMotionClass(
            count,
            "mobile-motion-count-changed",
            260,
            timers,
          );
        });
    };

    const armAdditionFeedback = (composer: HTMLElement) => {
      if (!mobileMedia.matches) return;

      pendingAdditionColumn = composer.closest<HTMLElement>(".entry-column");
      pendingAdditionUntil = Date.now() + 2_000;
      restartMotionClass(
        composer,
        "mobile-motion-composer-submit",
        240,
        timers,
      );
    };

    const animateAddedItems = (node: Node) => {
      if (
        !pendingAdditionColumn ||
        Date.now() > pendingAdditionUntil ||
        !mobileMedia.matches
      ) {
        return;
      }

      const addedItem = collectEntryItems(node).find((item) =>
        pendingAdditionColumn?.contains(item),
      );
      if (!addedItem) return;

      restartMotionClass(
        addedItem,
        "mobile-motion-entry-added",
        520,
        timers,
      );
      pendingAdditionColumn = null;
      pendingAdditionUntil = 0;
    };

    const observer = new MutationObserver((mutations) => {
      if (isPriming) {
        tryFinishPriming();
        return;
      }

      let shouldScanCounts = false;
      let shouldSyncTabs = false;

      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          shouldScanCounts = true;
          mutation.addedNodes.forEach(animateAddedItems);
        }

        if (mutation.type === "characterData") {
          shouldScanCounts = true;
        }

        if (
          mutation.type === "attributes" &&
          mutation.target instanceof Element &&
          mutation.target.matches(TAB_SELECTOR)
        ) {
          shouldSyncTabs = true;
        }
      });

      if (shouldScanCounts) requestFrame(animateChangedCounts);
      if (shouldSyncTabs) requestFrame(() => syncTabIndicator(true));
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });

    const handleClickCapture = (event: MouseEvent) => {
      if (!mobileMedia.matches || !(event.target instanceof Element)) return;

      const submitButton = event.target.closest<HTMLElement>(
        COMPOSER_SUBMIT_SELECTOR,
      );
      if (submitButton && !submitButton.hasAttribute("disabled")) {
        const composer = submitButton.closest<HTMLElement>(COMPOSER_SELECTOR);
        if (composer) armAdditionFeedback(composer);
      }

      const completeControl = event.target.closest<HTMLElement>(
        COMPLETE_CONTROL_SELECTOR,
      );
      if (!completeControl || completeControl.hasAttribute("disabled")) return;

      const isRestoring =
        completeControl.getAttribute("aria-pressed") === "true" ||
        completeControl.textContent?.includes("未完了");
      const entryItem =
        completeControl.closest<HTMLElement>(ENTRY_ITEM_SELECTOR) ??
        document.querySelector<HTMLElement>(
          ".entry-item--mobile-action-open",
        );

      restartMotionClass(
        completeControl,
        isRestoring
          ? "mobile-motion-complete-control-restoring"
          : "mobile-motion-complete-control",
        300,
        timers,
      );

      if (entryItem) {
        restartMotionClass(
          entryItem,
          isRestoring
            ? "mobile-motion-entry-restoring"
            : "mobile-motion-entry-completing",
          360,
          timers,
        );
      }
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (!mobileMedia.matches || !isComposerSubmitKey(event)) return;
      const composer = (event.target as Element).closest<HTMLElement>(
        COMPOSER_SELECTOR,
      );
      if (composer) armAdditionFeedback(composer);
    };

    const handleMediaChange = () => {
      if (!mobileMedia.matches) return;
      document
        .querySelectorAll<HTMLElement>(ENTRY_COUNT_SELECTOR)
        .forEach((count) => {
          countValues.set(count, count.textContent?.trim() ?? "");
        });
      syncTabIndicator(false);
    };

    document.addEventListener("click", handleClickCapture, true);
    document.addEventListener("keydown", handleKeyDownCapture, true);
    mobileMedia.addEventListener("change", handleMediaChange);
    tryFinishPriming();

    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClickCapture, true);
      document.removeEventListener("keydown", handleKeyDownCapture, true);
      mobileMedia.removeEventListener("change", handleMediaChange);
      timers.forEach((timer) => window.clearTimeout(timer));
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [pathname]);

  return null;
}
