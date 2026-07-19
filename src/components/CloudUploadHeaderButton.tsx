import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const HEADER_TARGET_SELECTOR = ".editor-header__right";
const DISPLAY_TRIGGER_SELECTOR = ".editor-utility-menu__trigger";
const ORIGINAL_UPLOAD_BUTTON_SELECTOR =
  ".editor-display-options .cloud-upload-button";
const DISPLAY_ACTIONS_SELECTOR = ".editor-display-options__actions";

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * クラウド保存を「表示・整理」から切り離し、上部の保存状態の隣へ置く。
 * 既存のログイン判定・確認ダイアログ・アップロード処理は複製せず、
 * 元のクラウドボタンを経由して同じ処理を呼び出す。
 */
export function CloudUploadHeaderButton() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    let frame: number | null = null;

    const sync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const nextTarget = document.querySelector<HTMLElement>(
          HEADER_TARGET_SELECTOR,
        );
        setPortalTarget((current) =>
          current === nextTarget ? current : nextTarget,
        );

        document
          .querySelectorAll<HTMLElement>(DISPLAY_ACTIONS_SELECTOR)
          .forEach((actions) => actions.setAttribute("aria-label", "出力"));
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const openCloudUpload = async () => {
    if (isOpening) return;
    setIsOpening(true);

    try {
      const mountedUploadButton = document.querySelector<HTMLButtonElement>(
        ORIGINAL_UPLOAD_BUTTON_SELECTOR,
      );

      if (mountedUploadButton) {
        mountedUploadButton.click();
        return;
      }

      const displayTrigger = document.querySelector<HTMLButtonElement>(
        DISPLAY_TRIGGER_SELECTOR,
      );
      if (!displayTrigger) return;

      const wasExpanded = displayTrigger.getAttribute("aria-expanded") === "true";
      if (!wasExpanded) displayTrigger.click();

      await nextPaint();
      await nextPaint();

      document
        .querySelector<HTMLButtonElement>(ORIGINAL_UPLOAD_BUTTON_SELECTOR)
        ?.click();

      if (!wasExpanded) {
        await nextPaint();
        const currentTrigger = document.querySelector<HTMLButtonElement>(
          DISPLAY_TRIGGER_SELECTOR,
        );
        if (currentTrigger?.getAttribute("aria-expanded") === "true") {
          currentTrigger.click();
        }
      }
    } finally {
      setIsOpening(false);
    }
  };

  if (!portalTarget) return null;

  return createPortal(
    <button
      type="button"
      className="editor-header__cloud-save"
      onClick={() => void openCloudUpload()}
      disabled={isOpening}
      aria-label="このメモをクラウドへ保存"
      title="このメモをクラウドへ保存"
    >
      <span aria-hidden="true">☁</span>
      <span>{isOpening ? "準備中…" : "クラウド保存"}</span>
    </button>,
    portalTarget,
  );
}
