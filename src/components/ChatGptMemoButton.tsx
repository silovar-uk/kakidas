import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import {
  readCopyIncludeCompleted,
  readEntrySortMode,
} from "../lib/copyPreferences";
import { formatMemoText } from "../lib/memoText";
import { memoRepository } from "../repositories/memoRepository";

const ACTIONS_SELECTOR = ".editor-display-options__actions";
const TITLE_INPUT_SELECTOR = ".memo-title-input";
const ENTRY_NUMBER_VISIBILITY_STORAGE_KEY = "kakidas.show-entry-numbers";

function getMemoIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/memos\/([^/?#]+)/);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function readEntryNumberVisibility(): boolean {
  try {
    return window.localStorage.getItem(ENTRY_NUMBER_VISIBILITY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 「表示・整理」の出力操作に、メモ全体をChatGPTへ受け渡す導線を追加する。
 * 新しいタブはクリック同期中に先に開き、IndexedDBの読み込み後にprompt付きURLへ遷移する。
 */
export function ChatGptMemoButton() {
  const { pathname } = useLocation();
  const memoId = getMemoIdFromPathname(pathname);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    let frame: number | null = null;

    const sync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const nextTarget = memoId
          ? document.querySelector<HTMLElement>(ACTIONS_SELECTOR)
          : null;
        setPortalTarget((current) =>
          current === nextTarget ? current : nextTarget,
        );
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [memoId]);

  const openChatGpt = async () => {
    if (!memoId || isOpening) return;

    // 非同期のIndexedDB読み込みより先にタブを開き、ブラウザのpopup判定をユーザー操作内に収める。
    const chatWindow = window.open("about:blank", "_blank");
    if (!chatWindow) {
      window.alert(
        "ChatGPTを新しいタブで開けませんでした。ポップアップの許可をご確認ください。",
      );
      return;
    }

    chatWindow.opener = null;
    setIsOpening(true);

    try {
      const memo = await memoRepository.getMemo(memoId);
      if (!memo) {
        throw new Error("このメモを読み込めませんでした。");
      }

      const titleInput = document.querySelector<HTMLInputElement>(
        TITLE_INPUT_SELECTOR,
      );
      const liveTitle = titleInput?.value.trim() || memo.title;
      const prompt = formatMemoText(
        { ...memo, title: liveTitle },
        {
          includeEntryNumbers: readEntryNumberVisibility(),
          excludeCompleted: !readCopyIncludeCompleted(),
          entrySortMode: readEntrySortMode(),
        },
      );

      const chatGptUrl = new URL("https://chatgpt.com/");
      chatGptUrl.searchParams.set("prompt", prompt);
      chatWindow.location.replace(chatGptUrl.toString());
    } catch (caught) {
      chatWindow.close();
      window.alert(
        caught instanceof Error
          ? caught.message
          : "ChatGPTへメモを渡せませんでした。",
      );
    } finally {
      setIsOpening(false);
    }
  };

  if (!portalTarget || !memoId) return null;

  return createPortal(
    <button
      type="button"
      className="secondary-button"
      onClick={() => void openChatGpt()}
      disabled={isOpening}
      title="タイトルと本文をChatGPTの新しいチャットへ渡す"
    >
      {isOpening ? "ChatGPTを開いています…" : "ChatGPTで話す"}
    </button>,
    portalTarget,
  );
}
