import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { resetBodyScrollLock } from "./lib/bodyScrollLock";
import { closeDatabaseConnection } from "./lib/db";
import "./styles.css";
import "./styles-mobile-word-compact.css";
import "./styles-paragraph-heading.css";
import "./styles-keyboard-shortcuts.css";
import "./styles-paragraph-title-tag.css";
import "./styles-entry-tag-group-drag.css";
import "./styles-cloud-upload-header.css";
import "./styles-mobile-interaction-motion.css";
import "./styles-mobile-word-single-row.css";
import "./styles-temporary-memo.css";
import "./styles-temporary-memo-mobile-refine.css";
import "./styles-temporary-memo-instant.css";
import "./styles-memo-tag-prompt.css";
import "./styles-entry-structure-actions.css";
import "./styles-completed-entry-danger.css";

// 以前のオーバーレイが残したスクロール停止を、起動時に必ず初期化する。
resetBodyScrollLock();

// iPhone Safariでは、タブを切り替えただけでは pagehide が発火しない。
// 一時メモなどのvisibilitychange保存処理が同じイベント内でトランザクションを
// 開けるよう、DB接続の解放は次のタスクへ譲る。
const releaseDatabaseConnection = () => {
  window.setTimeout(() => closeDatabaseConnection(), 0);
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    releaseDatabaseConnection();
  }
});

// Safariの戻る／進むやタブ破棄でも、古い画面がメモDBを握り続けないようにする。
window.addEventListener("pagehide", releaseDatabaseConnection);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
