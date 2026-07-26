import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const TAG_SORT_VALUE = "tag_asc";
const UPDATED_SORT_VALUE = "updated_desc";
const TAG_SORT_STORAGE_KEY = "kakidas.memo-list-tag-sort";
const SORT_SELECT_SELECTOR = 'select[aria-label="メモの並び順"]';
const MEMO_LIST_SELECTOR = ".memo-list";
const MEMO_CARD_SELECTOR = ":scope > .memo-card";

const tagCollator = new Intl.Collator("ja", {
  sensitivity: "base",
  numeric: true,
});

function readTagSortEnabled(): boolean {
  try {
    return window.localStorage.getItem(TAG_SORT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeTagSortEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(TAG_SORT_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(TAG_SORT_STORAGE_KEY);
    }
  } catch {
    // 表示設定を保存できない場合も、その場の並び替えは続ける。
  }
}

function ensureTagSortOption(select: HTMLSelectElement): void {
  if (select.querySelector(`option[value="${TAG_SORT_VALUE}"]`)) return;

  const option = document.createElement("option");
  option.value = TAG_SORT_VALUE;
  option.textContent = "タグ順（あり→なし）";
  select.append(option);
}

function getCardTag(card: HTMLElement): string {
  const visibleTag = card.querySelector<HTMLElement>(
    ".memo-tag-chip, .memo-card__tag",
  );
  if (visibleTag) {
    const tag = visibleTag.textContent?.replace(/^#/, "").trim() ?? "";
    if (tag) card.dataset.memoTagSortKey = tag;
    return tag;
  }

  const editingInput = card.querySelector<HTMLInputElement>(
    ".memo-tag-control--editing input",
  );
  if (editingInput) {
    const tag = editingInput.value.trim();
    if (tag) card.dataset.memoTagSortKey = tag;
    return tag;
  }

  if (card.querySelector(".memo-tag-control__add")) {
    delete card.dataset.memoTagSortKey;
    return "";
  }

  return card.dataset.memoTagSortKey ?? "";
}

function clearCardOrders(): void {
  document
    .querySelectorAll<HTMLElement>(`${MEMO_LIST_SELECTOR} > .memo-card`)
    .forEach((card) => card.style.removeProperty("order"));
}

function applyTagSort(): void {
  const list = document.querySelector<HTMLElement>(MEMO_LIST_SELECTOR);
  if (!list) return;

  const cards = Array.from(
    list.querySelectorAll<HTMLElement>(MEMO_CARD_SELECTOR),
  );

  // 元のDOM順は更新が新しい順。タグが同じ場合とタグなし同士ではその順を保つ。
  const sorted = cards
    .map((card, index) => ({ card, index, tag: getCardTag(card) }))
    .sort((left, right) => {
      const leftHasTag = left.tag.length > 0;
      const rightHasTag = right.tag.length > 0;

      if (leftHasTag !== rightHasTag) return leftHasTag ? -1 : 1;
      if (!leftHasTag) return left.index - right.index;

      return tagCollator.compare(left.tag, right.tag) || left.index - right.index;
    });

  sorted.forEach(({ card }, index) => {
    card.style.order = String(index);
  });
}

/**
 * 既存の更新順・作成順を保ったまま、一覧にタグ順を追加する。
 * Reactのカード自体は移動せずCSSのorderだけを使うため、カード内操作を壊さない。
 */
export function MemoListTagSort() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname !== "/") {
      clearCardOrders();
      return;
    }

    let frame: number | null = null;
    let applyingBaseSort = false;

    const sync = () => {
      frame = null;
      const select = document.querySelector<HTMLSelectElement>(
        SORT_SELECT_SELECTOR,
      );
      if (!select) return;

      ensureTagSortOption(select);

      if (readTagSortEnabled()) {
        select.value = TAG_SORT_VALUE;
        applyTagSort();
      } else {
        clearCardOrders();
      }
    };

    const scheduleSync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    };

    const handleChange = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLSelectElement) ||
        !target.matches(SORT_SELECT_SELECTOR)
      ) {
        return;
      }

      if (applyingBaseSort) return;

      if (target.value === TAG_SORT_VALUE) {
        // タグ内・タグなし同士は更新順にするため、既存stateを更新順へ揃えてから装飾する。
        event.stopPropagation();
        writeTagSortEnabled(true);
        applyingBaseSort = true;
        target.value = UPDATED_SORT_VALUE;
        target.dispatchEvent(new Event("change", { bubbles: true }));
        applyingBaseSort = false;
        scheduleSync();
        return;
      }

      writeTagSortEnabled(false);
      clearCardOrders();
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener("change", handleChange, true);
    scheduleSync();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("change", handleChange, true);
      clearCardOrders();
    };
  }, [pathname]);

  return null;
}
